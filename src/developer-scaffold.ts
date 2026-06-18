/* developer-scaffold.ts — Developer 에이전트의 프로젝트 스캐폴딩 (vite-vanilla/react·static 템플릿).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path + paths·core/proc(_pythonCmd)·telegram-send·conversation-log·tracker.
 * 주의: 함수 본문에 vite config·React App.tsx 등 코드 template 문자열이 들어있어(col-0 export/function),
 *       추출 시 perl export 일괄치환을 쓰지 않고 진짜 top-level 선언에만 수동으로 export 를 붙였다. */
import * as fs from 'fs';
import * as path from 'path';
import { getCompanyDir } from './paths';
import { _pythonCmd } from './core/proc';
import { sendTelegramReport } from './telegram-send';
import { appendConversationLog } from './conversation-log';
import { addTrackerTask } from './tracker';

/* P1-10: Developer project scaffolder ────────────────────────────────────
   Creates `_company/projects/<name>/` with a minimal working web template
   so the Developer agent (and the user) have a real folder to iterate in.
   Three templates cover the common cases:
     - vite-vanilla: dependency-free dev server, no React
     - vite-react:   React + TS for app-style projects
     - static:       single index.html with Tailwind CDN — for landing pages
   We don't run npm install — that's a privileged action, the user runs it
   when they're ready. We DO write a README that tells them the next steps. */
export async function scaffoldDeveloperProject(name: string, template: 'vite-vanilla' | 'vite-react' | 'static'): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safe) return { ok: false, error: '유효하지 않은 이름' };
        const root = path.join(getCompanyDir(), 'projects', safe);
        if (fs.existsSync(root)) return { ok: false, error: `이미 존재: ${root}` };
        fs.mkdirSync(path.join(root, 'site'), { recursive: true });
        fs.mkdirSync(path.join(root, 'logs'), { recursive: true });

        if (template === 'static') {
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe}</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center">
  <main class="text-center space-y-4">
    <h1 class="text-4xl font-bold">${safe}</h1>
    <p class="text-zinc-400">Connect AI · Developer 에이전트가 만든 페이지</p>
  </main>
</body>
</html>
`);
        } else if (template === 'vite-vanilla') {
            fs.writeFileSync(path.join(root, 'site', 'package.json'),
                JSON.stringify({
                    name: safe,
                    private: true,
                    type: 'module',
                    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
                    devDependencies: { vite: '^5.0.0' },
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${safe}</title>
</head>
<body>
<h1>${safe}</h1>
<script type="module" src="/main.js"></script>
</body>
</html>
`);
            fs.writeFileSync(path.join(root, 'site', 'main.js'),
`document.querySelector('h1').addEventListener('click', () => {
  console.log('hi from ${safe}');
});
`);
        } else if (template === 'vite-react') {
            fs.writeFileSync(path.join(root, 'site', 'package.json'),
                JSON.stringify({
                    name: safe,
                    private: true,
                    type: 'module',
                    scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview' },
                    dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' },
                    devDependencies: {
                        '@types/react': '^18.3.0',
                        '@types/react-dom': '^18.3.0',
                        '@vitejs/plugin-react': '^4.3.0',
                        typescript: '^5.4.0',
                        vite: '^5.0.0',
                    },
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'tsconfig.json'),
                JSON.stringify({
                    compilerOptions: {
                        target: 'ES2020',
                        useDefineForClassFields: true,
                        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                        module: 'ESNext',
                        skipLibCheck: true,
                        moduleResolution: 'bundler',
                        allowImportingTsExtensions: true,
                        resolveJsonModule: true,
                        isolatedModules: true,
                        noEmit: true,
                        jsx: 'react-jsx',
                        strict: true,
                    },
                    include: ['src'],
                }, null, 2));
            fs.writeFileSync(path.join(root, 'site', 'vite.config.ts'),
`import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
`);
            fs.writeFileSync(path.join(root, 'site', 'index.html'),
`<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${safe}</title></head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
`);
            fs.mkdirSync(path.join(root, 'site', 'src'), { recursive: true });
            fs.writeFileSync(path.join(root, 'site', 'src', 'main.tsx'),
`import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <h1>${safe}</h1>;
}

createRoot(document.getElementById('root')!).render(<App />);
`);
        }

        fs.writeFileSync(path.join(root, 'README.md'),
`# ${safe}

Developer 에이전트가 ${new Date().toISOString().slice(0, 10)}에 만든 프로젝트.
템플릿: \`${template}\`

## 다음 스텝

${template === 'static'
    ? `\`\`\`bash\ncd site && ${_pythonCmd()} -m http.server 5173\n# 또는: npx serve site\n\`\`\`\n브라우저에서 http://127.0.0.1:5173 열기.`
    : `\`\`\`bash\ncd site && npm install && npm run dev\n\`\`\`\nVite dev server가 http://localhost:5173 에서 실행됩니다.`}

## 결정 로그
\`decisions.md\`에 누적됩니다.
`);
        fs.writeFileSync(path.join(root, 'decisions.md'),
`# 📌 ${safe} 결정 로그

_Developer 에이전트와 사용자가 내린 디자인·기술 의사결정이 시간순으로 누적됩니다._

## [${new Date().toISOString().slice(0, 10)}] 프로젝트 생성
- 템플릿: \`${template}\`
- 위치: \`${path.relative(getCompanyDir(), root)}\`
`);
        try { appendConversationLog({ speaker: 'Developer', emoji: '💻', section: '프로젝트 생성', body: `${safe} (\`${template}\`) 생성 → ${root}` }); } catch { /* ignore */ }
        /* Tracker entry so the user sees it in the sidebar Task panel. */
        try {
            addTrackerTask({
                title: `${safe} 프로젝트 셋업 (${template})`,
                description: `다음 스텝: cd site && ${template === 'static' ? 'serve' : 'npm install && npm run dev'}`,
                owner: 'mixed',
                agentIds: ['developer'],
                status: 'in_progress',
                priority: 'normal',
            });
        } catch { /* ignore */ }
        /* Telegram ping so the user knows from any channel. */
        sendTelegramReport(`💻 *Developer*: \`${safe}\` 프로젝트 만들었어요 (${template})\n\n로컬: \`${path.relative(getCompanyDir(), root)}\`\n다음: ${template === 'static' ? `\`cd site && ${_pythonCmd()} -m http.server 5173\`` : '`cd site && npm install && npm run dev`'}`).catch(() => { /* silent */ });
        return { ok: true, path: root };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}
