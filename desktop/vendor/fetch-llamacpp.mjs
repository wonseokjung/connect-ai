// 📥 llama.cpp 공식 prebuilt(llama-server)를 플랫폼별로 받아 vendor/llamacpp/<plat>/ 에 둔다.
//   빌드 전에 실행: `node vendor/fetch-llamacpp.mjs` (이미 있으면 건너뜀).
//   왜 git 에 안 넣나: 바이너리 100MB+ 를 저장소에 커밋하지 않으려고. 버전은 BUILD 로 고정 → 재현 가능.
//   gemma-4 등 최신 아키텍처 지원을 위해 b8642 이상 필요(여기선 b9548).
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = process.env.LLAMACPP_BUILD || 'b9548';
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}`;

// 플랫폼별 받을 에셋. 맥은 두 아키텍처 모두(arm64+x64 슬라이스 빌드), 윈도우는 CPU(드라이버 의존 없이 어디서나 기동).
const TARGETS = process.platform === 'win32'
  ? [{ plat: 'win-x64', asset: `llama-${BUILD}-bin-win-cpu-x64.zip`, exe: 'llama-server.exe', libRe: /\.dll$/i }]
  : [
      { plat: 'mac-arm64', asset: `llama-${BUILD}-bin-macos-arm64.tar.gz`, exe: 'llama-server', libRe: /\.dylib$/ },
      { plat: 'mac-x64', asset: `llama-${BUILD}-bin-macos-x64.tar.gz`, exe: 'llama-server', libRe: /\.dylib$/ },
    ];

async function dl(url, out) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(out, buf);
  return buf.length;
}

// tar(bsdtar)는 맥·윈도우(Win10+) 모두 .tar.gz 와 .zip 을 풀 수 있다.
function extract(file, dir) { fs.mkdirSync(dir, { recursive: true }); execFileSync('tar', ['-xf', file, '-C', dir]); }

for (const t of TARGETS) {
  const dest = path.join(__dirname, 'llamacpp', t.plat);
  if (fs.existsSync(path.join(dest, t.exe))) { console.log(`✓ ${t.plat} 이미 있음 — 건너뜀`); continue; }
  console.log(`↓ ${t.plat}: ${t.asset}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-'));
  const arc = path.join(tmp, t.asset);
  const n = await dl(`${BASE}/${t.asset}`, arc);
  console.log(`  ${(n / 1e6).toFixed(1)}MB → 압축 해제`);
  const ex = path.join(tmp, 'x'); extract(arc, ex);
  // llama-server(.exe) 를 품은 폴더 찾기
  let srcDir = null;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === t.exe) srcDir = d; } };
  walk(ex);
  if (!srcDir) throw new Error(`${t.exe} 를 찾을 수 없어요 (${t.asset})`);
  fs.mkdirSync(dest, { recursive: true });
  // llama-server + 모든 라이브러리(dylib/dll)만 복사 (다른 실행파일 제외)
  let copied = 0;
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (e.name === t.exe || t.libRe.test(e.name) || e.name === 'LICENSE') {
      fs.copyFileSync(path.join(srcDir, e.name), path.join(dest, e.name));
      if (e.name === t.exe && process.platform !== 'win32') fs.chmodSync(path.join(dest, e.name), 0o755);
      copied++;
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  console.log(`✅ ${t.plat}: ${copied}개 파일 → vendor/llamacpp/${t.plat}/`);
}
console.log('완료.');
