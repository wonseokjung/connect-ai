// 렌더러에 안전하게 노출되는 API (contextIsolation).
import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('connect', {
  // 설정
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: any) => ipcRenderer.invoke('config:set', patch),
  // 🛡️ 안전 모드 (GPU 끄기) — 흰 화면/크래시 대비
  safeModeGet: () => ipcRenderer.invoke('safemode:get'),
  safeModeSet: (on: boolean) => ipcRenderer.invoke('safemode:set', on),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  ttsSpeak: (text: string) => ipcRenderer.invoke('tts:speak', text),  // 🔊 Qwen3-TTS
  openDiagnostics: () => ipcRenderer.invoke('diag:open'),

  // 비서 엔진
  run: (text: string, attach?: any) => ipcRenderer.invoke('company:run', text, attach),  // 통합 에이전트 (+첨부 파일/이미지)
  pathForFile: (file: File) => webUtils.getPathForFile(file),              // 드롭된 파일의 실제 경로 (Electron 33)
  // 💻 작업실 — 파일 트리/읽기/Finder
  fsTree: (root?: string) => ipcRenderer.invoke('fs:tree', root),
  fsRead: (p: string) => ipcRenderer.invoke('fs:read', p),
  fsWrite: (p: string, content: string) => ipcRenderer.invoke('fs:write', p, content),
  fsReveal: (p: string) => ipcRenderer.invoke('fs:reveal', p),
  // ⌨️ 터미널 (서버도 여기서 실행·중지)
  termRun: (cmd: string, ws?: string) => ipcRenderer.invoke('term:run', cmd, ws),
  termKill: () => ipcRenderer.invoke('term:kill'),
  onTermData: (cb: (s: string) => void) => { const h = (_e: any, s: string) => cb(s); ipcRenderer.on('term:data', h); return () => ipcRenderer.removeListener('term:data', h); },
  onTermShow: (cb: () => void) => { const h = () => cb(); ipcRenderer.on('term:show', h); return () => ipcRenderer.removeListener('term:show', h); },
  // 🔌 EZERAI 브레인팩 주입 알림
  onBridgeInject: (cb: (d: any) => void) => { const h = (_e: any, d: any) => cb(d); ipcRenderer.on('bridge:inject', h); return () => ipcRenderer.removeListener('bridge:inject', h); },
  officeOpen: () => ipcRenderer.invoke('office:open'),   // 🪟 별도 사무실 창
  // ⬆️ 자동 업데이트
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: any) => void) => { const h = (_e: any, s: any) => cb(s); ipcRenderer.on('update:status', h); return () => ipcRenderer.removeListener('update:status', h); },
  stop: () => ipcRenderer.invoke('company:stop'),                          // 생성 중단
  reset: () => ipcRenderer.invoke('company:reset'),
  listModels: () => ipcRenderer.invoke('models:list'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  // 🧠 두뇌 / 지식 네트워크
  brainGraph: () => ipcRenderer.invoke('brain:graph'),
  brainList: () => ipcRenderer.invoke('brain:list'),
  brainCount: () => ipcRenderer.invoke('brain:count'),
  brainAdd: (text: string) => ipcRenderer.invoke('brain:add', text),
  brainDelete: (id: string) => ipcRenderer.invoke('brain:delete', id),
  brainExportTraining: (hf: any) => ipcRenderer.invoke('brain:exportTraining', hf),  // 🧬 장기 기억 (로컬 JSONL)
  // ⚡ 단기=GitHub · 🧬 장기=HuggingFace
  memStatus: () => ipcRenderer.invoke('memstatus'),
  githubPush: () => ipcRenderer.invoke('github:push'),
  githubPull: () => ipcRenderer.invoke('github:pull'),
  hfUpload: () => ipcRenderer.invoke('hf:upload'),
  trainNotebook: () => ipcRenderer.invoke('train:notebook'),
  // 📋 아침 브리핑(능동성) + 트레이
  briefingRun: () => ipcRenderer.invoke('briefing:run'),
  onBriefing: (cb: (t: string) => void) => { const h = (_e: any, t: string) => cb(t); ipcRenderer.on('briefing:show', h); return () => ipcRenderer.removeListener('briefing:show', h); },
  onTrayNewChat: (cb: () => void) => { const h = () => cb(); ipcRenderer.on('tray:newchat', h); return () => ipcRenderer.removeListener('tray:newchat', h); },
  // 🗂️ 관리 — 서비스·연동·대시보드
  servicesList: () => ipcRenderer.invoke('services:list'),
  servicesAdd: (s: any) => ipcRenderer.invoke('services:add', s),
  servicesDelete: (id: string) => ipcRenderer.invoke('services:delete', id),
  servicesIntel: () => ipcRenderer.invoke('services:intel'),
  integrationsGet: () => ipcRenderer.invoke('integrations:get'),
  integrationsSave: (patch: any) => ipcRenderer.invoke('integrations:save', patch),
  telegramTest: () => ipcRenderer.invoke('telegram:test'),
  // 🔌 서비스 정의 기반 API 패널
  apiGet: () => ipcRenderer.invoke('api:get'),
  apiSave: (serviceId: string, values: any) => ipcRenderer.invoke('api:save', serviceId, values),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  // 📺 YouTube
  youtubeGet: () => ipcRenderer.invoke('youtube:get'),
  youtubeOAuth: () => ipcRenderer.invoke('youtube:oauth'),
  // 🔌 MCP
  mcpGet: () => ipcRenderer.invoke('mcp:get'),
  mcpSave: (cfg: any) => ipcRenderer.invoke('mcp:save', cfg),
  mcpTest: () => ipcRenderer.invoke('mcp:test'),
  mcpTools: () => ipcRenderer.invoke('mcp:tools'),
  dashboardStats: () => ipcRenderer.invoke('dashboard:stats'),
  // 📋 태스크 보드
  tasksList: () => ipcRenderer.invoke('tasks:list'),
  tasksAdd: (title: string) => ipcRenderer.invoke('tasks:add', title),
  tasksDone: (id: string) => ipcRenderer.invoke('tasks:done', id),
  tasksCancel: (id: string) => ipcRenderer.invoke('tasks:cancel', id),
  // ✅ 승인 큐
  approvalsList: () => ipcRenderer.invoke('approvals:list'),
  approvalsApprove: (id: string) => ipcRenderer.invoke('approvals:approve', id),
  approvalsReject: (id: string) => ipcRenderer.invoke('approvals:reject', id),
  // 💰 매출 대시보드 (별도 창)
  openRevenue: () => ipcRenderer.invoke('revenue:open'),
  revReady: () => ipcRenderer.invoke('revenue:ready'),
  reportBriefing: () => ipcRenderer.invoke('report:briefing'),
  reportSpeak: (text: string) => ipcRenderer.invoke('report:speak', text),
  revRefresh: () => ipcRenderer.invoke('revenue:refresh'),
  revOpenSettings: () => ipcRenderer.invoke('revenue:openSettings'),
  onRevenueState: (cb: (m: any) => void) => {
    const h = (_e: any, m: any) => cb(m);
    ipcRenderer.on('revenue:state', h);
    return () => ipcRenderer.removeListener('revenue:state', h);
  },
  onEngineEvent: (cb: (e: any) => void) => {
    const h = (_e: any, ev: any) => cb(ev);
    ipcRenderer.on('engine:event', h);
    return () => ipcRenderer.removeListener('engine:event', h);
  },

  // 광장
  plazaEnter: () => ipcRenderer.invoke('plaza:enter'),
  plazaLeave: () => ipcRenderer.invoke('plaza:leave'),
  plazaSend: (text: string) => ipcRenderer.invoke('plaza:send', text),
  plazaTopic: (text: string) => ipcRenderer.invoke('plaza:topic', text),
  plazaDemoBot: (on: boolean) => ipcRenderer.invoke('plaza:demobot', on),
  plazaGrade: () => ipcRenderer.invoke('plaza:grade'),
  plazaDbUrl: () => ipcRenderer.invoke('plaza:dburl'),
  onPlazaPeer: (cb: (m: any) => void) => {
    const h = (_e: any, m: any) => cb(m);
    ipcRenderer.on('plaza:peer', h);
    return () => ipcRenderer.removeListener('plaza:peer', h);
  },
});
