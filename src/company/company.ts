/* company/company.ts — 회사(1인 기업 모드) 상태·마이그레이션·메타데이터.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: vscode·fs·path·os + ./paths(두뇌·회사 폴더) + core/fs-safe(_safeReadText)
 *       + runtime-state(확장 컨텍스트). extension 내부 상태 직접 참조 없음. */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { _getBrainDir, getCompanyDir, COMPANY_SUBDIR } from '../paths';
import { _safeReadText } from '../core/fs-safe';
import { runtime } from '../runtime-state';

export const COMPANY_INTERNAL_DIRS = new Set(['_cache', '_tmp']);

/* One-shot migration: when the user upgrades from a layout where company
   files lived at the brain root, transparently move them under _company/.
   Runs at activation. Idempotent — does nothing if already migrated. */
export function _migrateCompanyToSubdir() {
  try {
    const root = _getBrainDir();
    if (!fs.existsSync(root)) return;
    const target = path.join(root, COMPANY_SUBDIR);
    if (fs.existsSync(target)) return; // already migrated
    const legacyDirs = ['_shared', '_agents', 'sessions', 'approvals'];
    const present = legacyDirs.filter(d => {
      try { return fs.statSync(path.join(root, d)).isDirectory(); } catch { return false; }
    });
    if (present.length === 0) return; // nothing to migrate
    fs.mkdirSync(target, { recursive: true });
    for (const d of present) {
      const src = path.join(root, d);
      const dst = path.join(target, d);
      try { fs.renameSync(src, dst); } catch (e) {
        console.warn(`[Connect AI] migration: rename ${d} failed`, e);
      }
    }
    console.log(`[Connect AI] migrated ${present.length} legacy folders under ${target}`);
  } catch (e) {
    console.warn('[Connect AI] _company/ migration failed', e);
  }
}

export async function setCompanyDir(absPath: string) {
  // Redirects to localBrainPath: choosing a company location now means
  // choosing where the brain (and therefore the company) lives.
  try {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    await cfg.update('localBrainPath', absPath, vscode.ConfigurationTarget.Global);
  } catch {
    if (runtime.extCtx) {
      try { await runtime.extCtx.globalState.update('localBrainPath', absPath); } catch {}
    }
  }
}

/* v2.89.16 — YouTube creds 자동 동기화. API 패널 v2.89.14 이전엔 키를 config.md에만
   저장했고 tools/youtube_account.json은 그대로 빈 채로. 도구 실행 시 빈 값 보고
   "API 키 없음" 에러. 활성화 시 한 번 점검해서 누락된 값 자동 복구. */
export function _migrateYouTubeCredsToCanonical() {
  try {
    const dir = getCompanyDir();
    const cfgPath = path.join(dir, '_agents', 'youtube', 'config.md');
    if (!fs.existsSync(cfgPath)) return;
    const cfgTxt = _safeReadText(cfgPath);
    /* 라인 시작 앵커 — 이전 read regex 버그 회피 */
    const apiKeyM = cfgTxt.match(/^YOUTUBE_API_KEY[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const channelM = cfgTxt.match(/^YOUTUBE_CHANNEL_ID[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    /* v2.89.18 — OAuth Client ID/Secret도 같이 마이그레이션 */
    const oauthIdM = cfgTxt.match(/^YOUTUBE_OAUTH_CLIENT_ID[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const oauthSecretM = cfgTxt.match(/^YOUTUBE_OAUTH_CLIENT_SECRET[ \t]*[:：=][ \t]*([^\r\n]+?)[ \t]*$/m);
    const apiKey = apiKeyM ? apiKeyM[1].trim() : '';
    const channelId = channelM ? channelM[1].trim() : '';
    const oauthId = oauthIdM ? oauthIdM[1].trim() : '';
    const oauthSecret = oauthSecretM ? oauthSecretM[1].trim() : '';
    if (!apiKey && !channelId && !oauthId && !oauthSecret) return;
    const toolDir = path.join(dir, '_agents', 'youtube', 'tools');
    if (!fs.existsSync(toolDir)) return;
    const jsonPath = path.join(toolDir, 'youtube_account.json');
    let existing: Record<string, any> = {};
    if (fs.existsSync(jsonPath)) {
      try { existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8') || '{}'); } catch { /* malformed */ }
    }
    const existingKey = String(existing['YOUTUBE_API_KEY'] || '').trim();
    const existingChannel = String(existing['MY_CHANNEL_ID'] || '').trim();
    const existingOauthId = String(existing['YOUTUBE_OAUTH_CLIENT_ID'] || '').trim();
    const existingOauthSecret = String(existing['YOUTUBE_OAUTH_CLIENT_SECRET'] || '').trim();
    const needSync = (apiKey && !existingKey) || (channelId && !existingChannel) || (oauthId && !existingOauthId) || (oauthSecret && !existingOauthSecret);
    if (!needSync) return;
    /* 누락된 것만 채워줌 — 기존 값은 보존 */
    if (apiKey && !existingKey) existing['YOUTUBE_API_KEY'] = apiKey;
    if (channelId && !existingChannel) existing['MY_CHANNEL_ID'] = channelId;
    if (oauthId && !existingOauthId) existing['YOUTUBE_OAUTH_CLIENT_ID'] = oauthId;
    if (oauthSecret && !existingOauthSecret) existing['YOUTUBE_OAUTH_CLIENT_SECRET'] = oauthSecret;
    /* 누락 필드 기본값 */
    if (!('MY_CHANNEL_HANDLE' in existing)) existing['MY_CHANNEL_HANDLE'] = '';
    if (!('WATCHED_CHANNELS' in existing)) existing['WATCHED_CHANNELS'] = [];
    if (!('COMPETITOR_CHANNELS' in existing)) existing['COMPETITOR_CHANNELS'] = [];
    fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2));
    console.log('[migration] youtube_account.json synced from config.md');
  } catch (e: any) {
    console.warn('[migration] youtube_account.json sync failed:', e?.message || e);
  }
}

// One-time migration from the old `<brain>/Company/...` (or custom
// `companyDir`) layout to the unified flat layout. Called once on activate.
export function _migrateCompanyToBrain() {
  try {
    const brain = _getBrainDir();
    if (fs.existsSync(path.join(brain, '_shared'))) return; // already unified

    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    let legacy = ((cfg.get('companyDir') as string | undefined) || '').trim();
    if (!legacy && runtime.extCtx) {
      legacy = (runtime.extCtx.globalState.get<string>('companyDir') || '').trim();
    }
    if (legacy.startsWith('~/')) legacy = path.join(os.homedir(), legacy.slice(2));
    if (!legacy) legacy = path.join(brain, 'Company');

    if (!fs.existsSync(path.join(legacy, '_shared'))) return; // nothing to migrate

    fs.mkdirSync(brain, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const src = path.join(legacy, name);
      const dst = path.join(brain, name);
      if (fs.existsSync(dst)) continue; // never overwrite user data
      try { fs.renameSync(src, dst); } catch { /* skip on cross-device */ }
    }
    if (legacy === path.join(brain, 'Company')) {
      try { fs.rmdirSync(legacy); } catch {}
    }
    try { cfg.update('companyDir', undefined, vscode.ConfigurationTarget.Global); } catch {}
    if (runtime.extCtx) {
      try { runtime.extCtx.globalState.update('companyDir', undefined); } catch {}
    }
    console.log(`Connect AI: migrated ${legacy} → ${brain}`);
  } catch (e) {
    console.error('Connect AI: company → brain migration failed', e);
  }
}

export function getCompanyMetrics(): { tasksCompleted: number, knowledgeInjected: number, lastSessionDate: string, foundedAt?: string } {
    try {
        const brain = _getBrainDir();
        const file = path.join(brain, 'company_state.json');
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch { /* fall through to default */ }
    return { tasksCompleted: 0, knowledgeInjected: 0, lastSessionDate: '' };
}

/** Returns the company's "Day N" relative to when the user first set up the
 *  company. First call also stamps `foundedAt` so the counter is stable across
 *  PCs that share the brain folder via GitHub. Returns 1 on day 0. */
export function getCompanyDay(): number {
    try {
        const m = getCompanyMetrics();
        let founded = m.foundedAt;
        if (!founded) {
            founded = new Date().toISOString().slice(0, 10);
            updateCompanyMetrics({ foundedAt: founded });
        }
        const start = Date.parse(founded + 'T00:00:00');
        const now = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00');
        if (!isFinite(start) || !isFinite(now)) return 1;
        return Math.max(1, Math.floor((now - start) / 86400000) + 1);
    } catch { return 1; }
}

export function updateCompanyMetrics(updates: any) {
    try {
        const brain = _getBrainDir();
        /* v2.89.25 — 디렉토리 없으면 만들고 쓰기. 이전엔 brain 디렉토리가 첫 활성화
           시점에 없을 수 있어서 write 조용히 실패 → foundedAt 영원히 영속화 안 됨 →
           Day 카운터 매번 1로 재설정. */
        try { fs.mkdirSync(brain, { recursive: true }); } catch { /* ignore */ }
        const file = path.join(brain, 'company_state.json');
        const s = getCompanyMetrics();
        Object.assign(s, updates);
        fs.writeFileSync(file, JSON.stringify(s, null, 2));
    } catch (e: any) {
        console.warn('[updateCompanyMetrics] write failed:', e?.message || e);
    }
}

export function _extractCompanyName(idMd: string): string {
  const m = idMd.match(/회사\s*이름\s*[:：]\s*(.+)/);
  if (!m || !m[1]) return '';
  let v = m[1].trim().replace(/\*+/g, '').replace(/^_+|_+$/g, '').trim();
  if (!v) return '';
  if (/\(여기에|\(아직 미설정|\(미설정|미설정$|^_자가학습/.test(v)) return '';
  return v;
}

export function isCompanyConfigured(): boolean {
  const dir = getCompanyDir();
  const idPath = path.join(dir, '_shared', 'identity.md');
  if (!fs.existsSync(idPath)) return false;
  return _extractCompanyName(_safeReadText(idPath)).length > 0;
}

export function readCompanyName(): string {
  const dir = getCompanyDir();
  const idPath = path.join(dir, '_shared', 'identity.md');
  return _extractCompanyName(_safeReadText(idPath));
}
