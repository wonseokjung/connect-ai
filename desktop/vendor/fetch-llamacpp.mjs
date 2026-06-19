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

// 플랫폼별 받을 에셋. 맥은 두 아키텍처 모두(arm64+x64 슬라이스 빌드).
// 🪟 윈도우 기본 = 'cpu' 빌드: ggml-cpu 가 런타임에 CPU 명령어(AVX2/AVX-512 등)를 자동 감지해 가장 맞는 백엔드를 로드 → 구형 CPU(i5-10400F 등)에서도 안 죽음.
//   vulkan 빌드는 단일 ggml-cpu라 최신 명령어로 빌드돼 구형 CPU에서 0xC0000005(액세스 위반)로 즉시 종료되는 제보 다수.
//   GPU 가속이 필요하면 LLAMACPP_WIN_VARIANT=vulkan 으로 빌드.
// 🪟 윈도우는 두 빌드 다 받는다: win-x64(cpu·모든 CPU 호환 폴백) + win-x64-gpu(vulkan·GPU 가속).
//   앱(localengine)이 GPU 빌드를 먼저 띄우고, 구형 CPU에서 0xC0000005로 죽으면 자동으로 cpu 빌드로 폴백 → GPU 되는 사람 빠르고, 안 되는 사람도 안 죽음.
const TARGETS = process.platform === 'win32'
  ? [
      { plat: 'win-x64', asset: `llama-${BUILD}-bin-win-cpu-x64.zip`, exe: 'llama-server.exe', libRe: /\.dll$/i },          // CPU 폴백
      { plat: 'win-x64-gpu', asset: `llama-${BUILD}-bin-win-vulkan-x64.zip`, exe: 'llama-server.exe', libRe: /\.dll$/i },   // GPU(vulkan)
    ]
  : process.platform === 'linux'
  ? [{ plat: 'linux-x64', asset: `llama-${BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, exe: 'llama-server', libRe: /\.so(\.\d+)*$/i }]   // 우분투 vulkan = GPU + CPU 폴백
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
    if (!(e.name === t.exe || t.libRe.test(e.name) || e.name === 'LICENSE')) continue;
    const src = path.join(srcDir, e.name), dst = path.join(dest, e.name);
    if (fs.lstatSync(src).isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(src), dst);   // dylib 심볼릭 링크 보존(실파일 복사 시 3배 부풀음 방지)
    } else {
      fs.copyFileSync(src, dst);
      if (e.name === t.exe && process.platform !== 'win32') fs.chmodSync(dst, 0o755);
    }
    copied++;
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  console.log(`✅ ${t.plat}: ${copied}개 파일 → vendor/llamacpp/${t.plat}/`);
}
console.log('완료.');
