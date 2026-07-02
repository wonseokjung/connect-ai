// 🤗 HuggingFace 모델 검색·다운로드 — 비개발자가 "검색 → 양자화 고르기 → 다운로드 → 바로 실행".
//   공개 GGUF 모델 대상(토큰 불필요). 다운로드는 진행률 콜백으로 UI에 표시.
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface HfModel { id: string; downloads: number; likes: number; params: string; updated: string; vision: boolean; }

// 모델 이름/태그에서 파라미터 규모 추출 (예: 7B, 8x7B, 3.8B)
function paramOf(id: string): string {
  const m = (id || '').match(/\b(\d+(?:\.\d+)?x\d+(?:\.\d+)?b|\d+(?:\.\d+)?b)\b/i);
  return m ? m[1].toUpperCase() : '';
}

// GGUF 모델 검색(다운로드순). filter=gguf 로 GGUF 보유 레포만. 파라미터 규모·인기·갱신일·비전 여부까지.
export async function searchGGUF(query: string): Promise<HfModel[]> {
  const q = (query || '').trim() || 'gguf';
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=24`;
  const r = await axios.get(url, { timeout: 15000, headers: { Accept: 'application/json' } });
  return (r.data || []).map((m: any) => {
    const id = m.id || m.modelId; const tags: string[] = m.tags || [];
    const vision = tags.some(t => /vision|image-text|multimodal|vlm|mmproj/i.test(t)) || /vl|vision|llava/i.test(id);
    return { id, downloads: m.downloads || 0, likes: m.likes || 0, params: paramOf(id), updated: m.lastModified || m.createdAt || '', vision };
  }).filter((m: HfModel) => m.id);
}

export interface GgufFile { path: string; size: number; quant: string; }
const QUANT_RE = /(Q\d[0-9A-Z_]*|IQ\d[0-9A-Z_]*|BF16|F16|F32)/i;

// 레포 안의 .gguf 파일 목록(양자화·용량). mmproj(비전 보조) 는 제외.
export async function listGGUF(repo: string): Promise<GgufFile[]> {
  const url = `https://huggingface.co/api/models/${repo}/tree/main?recursive=1`;
  const r = await axios.get(url, { timeout: 20000, headers: { Accept: 'application/json' } });
  return (r.data || [])
    .filter((f: any) => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj/i.test(f.path))
    .map((f: any) => ({ path: f.path, size: f.size || (f.lfs && f.lfs.size) || 0, quant: (f.path.match(QUANT_RE) || ['GGUF'])[0].toUpperCase() }))
    .sort((a: GgufFile, b: GgufFile) => a.size - b.size);
}

export interface DlProgress { received: number; total: number; percent: number; }

// GGUF 파일 다운로드(.part 로 받고 완료 시 rename). 진행률 콜백.
export async function downloadGGUF(repo: string, filePath: string, destDir: string, onProgress: (p: DlProgress) => void): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  const out = path.join(destDir, path.basename(filePath));
  const tmp = out + '.part';
  if (fs.existsSync(out)) return out;   // 이미 받음
  const url = `https://huggingface.co/${repo}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}?download=true`;
  const r = await axios.get(url, { responseType: 'stream', timeout: 0, maxRedirects: 5, headers: { Accept: 'application/octet-stream' } });
  const total = Number(r.headers['content-length']) || 0;
  let received = 0, lastTick = 0;
  const ws = fs.createWriteStream(tmp);
  r.data.on('data', (c: Buffer) => {
    received += c.length;
    const now = Date.now();
    if (now - lastTick > 300 || (total && received >= total)) { lastTick = now; onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : 0 }); }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      r.data.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      r.data.on('error', reject);
      r.data.on('aborted', () => reject(new Error('다운로드가 중단됐어요 — 네트워크 확인 후 다시 받아주세요')));   // 🩹 CDN 끊김이 error 없이 끝나면 영원히 대기하던 것 방지
    });
    // 🛡️ 무결성 — 조기 종료로 잘린 파일을 .gguf 로 두면 "모델을 못 켰어요"만 반복(재다운로드도 불가). 크기 검증 후에만 완성 처리.
    if (total && received < total) throw new Error(`다운로드가 중간에 끊겼어요 (${Math.round(received / 1e6)}MB/${Math.round(total / 1e6)}MB) — 다시 받아주세요`);
    fs.renameSync(tmp, out);
  } catch (e) {
    try { ws.destroy(); fs.unlinkSync(tmp); } catch { /* 찌꺼기 정리 실패는 무시 */ }
    throw e;
  }
  onProgress({ received: total || received, total: total || received, percent: 100 });
  return out;
}

// 채팅용 아닌 모델(오디오·임베딩 등)은 목록에서 제외.
const NON_CHAT_GGUF = /ace[-_]?step|mmproj|embed|whisper|\btts\b|nomic|\bbge\b|rerank|musicgen|bark|wavtokenizer|sdxl|flux|stable-diffusion/i;

export interface LocalModel { name: string; path: string; size: number; source: string; removable: boolean; }
function walkGGUF(root: string, out: LocalModel[], source: string, removable: boolean, depth = 0) {
  if (depth > 5) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkGGUF(p, out, source, removable, depth + 1);
    else if (/\.gguf$/i.test(e.name) && !NON_CHAT_GGUF.test(e.name)) {
      try { out.push({ name: e.name.replace(/\.gguf$/i, ''), path: p, size: fs.statSync(p).size, source, removable }); } catch { /* */ }
    }
  }
}

// 받은 로컬 모델 — 앱 다운로드 폴더 + LM Studio 받아둔 것까지 (다운로드 없이 내장 엔진으로 사용).
//   LM Studio 모델은 removable:false (실수로 사용자 LM Studio 모델 삭제 방지). 경로는 맥·윈도 동일(os.homedir).
export function listLocalModels(dir: string): LocalModel[] {
  const out: LocalModel[] = [];
  walkGGUF(dir, out, '앱', true);
  walkGGUF(path.join(os.homedir(), '.lmstudio', 'models'), out, 'LM Studio', false);
  walkGGUF(path.join(os.homedir(), '.cache', 'lm-studio', 'models'), out, 'LM Studio', false);
  const seen = new Set<string>();
  return out.filter((m) => { if (seen.has(m.path)) return false; seen.add(m.path); return true; }).sort((a, b) => a.size - b.size);
}

export function deleteLocalModel(filePath: string): boolean {
  try { fs.unlinkSync(filePath); return true; } catch { return false; }
}

// 비개발자용 추천(잘 지원되고 가벼운 모델). 한 번 클릭으로 받게.
export const RECOMMENDED: { label: string; repo: string; hint: string; sizeGB: number }[] = [
  { label: 'Llama 3.2 1B', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', hint: '0.8GB · 초경량', sizeGB: 0.8 },
  { label: 'Qwen2.5 1.5B', repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', hint: '1GB · 가벼움', sizeGB: 1.0 },
  { label: 'Llama 3.2 3B', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', hint: '2GB · 균형', sizeGB: 2.0 },
  { label: 'Qwen2.5 7B', repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', hint: '4.5GB · 똑똑함', sizeGB: 4.5 },
];
