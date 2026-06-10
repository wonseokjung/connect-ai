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
  ttsSpeakAgent: (id: string, text: string) => ipcRenderer.invoke('tts:speakAgent', id, text),  // 🎭 에이전트별 목소리
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
  // 🧠 내장 추론 엔진(LM Studio 불필요) + 🤗 HuggingFace 모델
  localStatus: () => ipcRenderer.invoke('local:status'),
  localStart: (modelPath: string) => ipcRenderer.invoke('local:start', modelPath),
  localStop: () => ipcRenderer.invoke('local:stop'),
  localModels: () => ipcRenderer.invoke('local:models'),
  localDelete: (p: string) => ipcRenderer.invoke('local:delete', p),
  localOptions: () => ipcRenderer.invoke('local:options'),
  localSetOptions: (o: any) => ipcRenderer.invoke('local:setOptions', o),
  onLocalStatus: (cb: (s: any) => void) => { const h = (_e: any, s: any) => cb(s); ipcRenderer.on('local:status', h); return () => ipcRenderer.removeListener('local:status', h); },
  hfRecommended: () => ipcRenderer.invoke('hf:recommended'),
  hfSearch: (q: string) => ipcRenderer.invoke('hf:search', q),
  hfFiles: (repo: string) => ipcRenderer.invoke('hf:files', repo),
  hfDownload: (repo: string, file: string) => ipcRenderer.invoke('hf:download', repo, file),
  onHfProgress: (cb: (p: any) => void) => { const h = (_e: any, p: any) => cb(p); ipcRenderer.on('hf:progress', h); return () => ipcRenderer.removeListener('hf:progress', h); },
  stop: () => ipcRenderer.invoke('company:stop'),                          // 생성 중단
  reset: () => ipcRenderer.invoke('company:reset'),
  listModels: () => ipcRenderer.invoke('models:list'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  // 🧠 두뇌 / 지식 네트워크
  brainGraph: () => ipcRenderer.invoke('brain:graph'),
  brainList: () => ipcRenderer.invoke('brain:list'),
  brainCount: () => ipcRenderer.invoke('brain:count'),
  brainDelete: (id: string) => ipcRenderer.invoke('brain:delete', id),
  brainStats: () => ipcRenderer.invoke('brain:stats'),                                  // 📊 분야별 성장
  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),                              // 🔌 에제르 브릿지 상태
  brainPublishPack: (password: string) => ipcRenderer.invoke('brain:publishPack', password),       // 📤 제이 브레인 게시(대장)
  brainLinkBrain: (repo: string, password: string) => ipcRenderer.invoke('brain:linkBrain', repo, password),  // 🧠 제이 브레인 연동(구독자)
  // ⚡ 단기=GitHub · 🧬 장기=HuggingFace
  memStatus: () => ipcRenderer.invoke('memstatus'),
  githubPush: () => ipcRenderer.invoke('github:push'),
  githubPull: () => ipcRenderer.invoke('github:pull'),
  trainNotebook: (modelName?: string, opts?: any) => ipcRenderer.invoke('train:notebook', modelName, opts),
  trainAutotrain: (modelName?: string, opts?: any) => ipcRenderer.invoke('train:autotrain', modelName, opts),
  // 🧬 장기기억 만들기: ① 변환 ② 업로드 ③ 모델이름
  brainBuildDataset: (augment?: boolean) => ipcRenderer.invoke('brain:buildDataset', augment),
  hfUploadBrain: () => ipcRenderer.invoke('hf:uploadBrain'),
  trainCloud: () => ipcRenderer.invoke('train:cloud'),                    // ☁️ 내 AI 키우기(HF Jobs)
  trainCloudStatus: () => ipcRenderer.invoke('train:cloudStatus'),
  trainCloudInstall: () => ipcRenderer.invoke('train:cloudInstall'),
  authSignup: (email: string, pw: string) => ipcRenderer.invoke('auth:signup', email, pw),   // 👤 회원
  authLogin: (email: string, pw: string) => ipcRenderer.invoke('auth:login', email, pw),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authCurrent: () => ipcRenderer.invoke('auth:current'),
  brainBuildPreference: () => ipcRenderer.invoke('brain:buildPreference'),   // ⚖️ AI 자동 피드백
  hfUploadPreference: () => ipcRenderer.invoke('hf:uploadPreference'),
  brainModelName: () => ipcRenderer.invoke('brain:modelName'),
  methodsList: () => ipcRenderer.invoke('methods:list'),               // 🎓 학습 방법론 목록
  onDatasetProgress: (cb: (d: any) => void) => { const h = (_e: any, d: any) => cb(d); ipcRenderer.on('dataset:progress', h); return () => ipcRenderer.removeListener('dataset:progress', h); },
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
  approvalsTest: () => ipcRenderer.invoke('approvals:test'),
  // 💰 매출 대시보드 (별도 창)
  openRevenue: () => ipcRenderer.invoke('revenue:open'),
  revReady: () => ipcRenderer.invoke('revenue:ready'),
  reportBriefing: () => ipcRenderer.invoke('report:briefing'),
  reportSpeak: (text: string) => ipcRenderer.invoke('report:speak', text),
  revRefresh: () => ipcRenderer.invoke('revenue:refresh'),
  revOpenSettings: () => ipcRenderer.invoke('revenue:openSettings'),
  // 🤖 자율 운영 — 실데이터 분석 → 작전 생성 + 24시간 반복 루프
  opsStart: () => ipcRenderer.invoke('ops:start'),
  opsStatus: () => ipcRenderer.invoke('ops:status'),
  opsNextCycle: () => ipcRenderer.invoke('ops:nextCycle'),
  opsExecuteSelected: (titles: string[], humanTitles?: string[]) => ipcRenderer.invoke('ops:executeSelected', titles, humanTitles || []),
  opsStop: () => ipcRenderer.invoke('ops:stop'),
  opsOpenReview: () => ipcRenderer.invoke('ops:openReview'),       // 🔗 대시보드 → 메인 창 작전 검토
  opsClearShipped: () => ipcRenderer.invoke('ops:clearShipped'),   // 🧹 지난 기록 비우기
  onOpsOpenPanel: (cb: () => void) => { const h = () => cb(); ipcRenderer.on('ops:openPanel', h); return () => ipcRenderer.removeListener('ops:openPanel', h); },
  officeBanter: () => ipcRenderer.invoke('office:banter'),   // 💬 사무실 진짜 AI 대화
  onOpsUpdate: (cb: (s: any) => void) => {
    const h = (_e: any, s: any) => cb(s);
    ipcRenderer.on('ops:update', h);
    return () => ipcRenderer.removeListener('ops:update', h);
  },
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
