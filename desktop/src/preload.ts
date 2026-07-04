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
  localModelsDir: () => ipcRenderer.invoke('local:modelsDir'),
  localPickModelsDir: () => ipcRenderer.invoke('local:pickModelsDir'),
  localOpenModelsDir: () => ipcRenderer.invoke('local:openModelsDir'),
  localResetModelsDir: () => ipcRenderer.invoke('local:resetModelsDir'),
  localDelete: (p: string) => ipcRenderer.invoke('local:delete', p),
  localOptions: () => ipcRenderer.invoke('local:options'),
  localSetOptions: (o: any) => ipcRenderer.invoke('local:setOptions', o),
  onLocalStatus: (cb: (s: any) => void) => { const h = (_e: any, s: any) => cb(s); ipcRenderer.on('local:status', h); return () => ipcRenderer.removeListener('local:status', h); },
  hfRecommended: () => ipcRenderer.invoke('hf:recommended'),
  recommendedForRam: () => ipcRenderer.invoke('hf:recommendedForRam'),   // v0.4.10 — RAM 맞춤 1개 (welcome 1-클릭)
  hfSearch: (q: string) => ipcRenderer.invoke('hf:search', q),
  hfFiles: (repo: string) => ipcRenderer.invoke('hf:files', repo),
  hfDownload: (repo: string, file: string) => ipcRenderer.invoke('hf:download', repo, file),
  onHfProgress: (cb: (p: any) => void) => { const h = (_e: any, p: any) => cb(p); ipcRenderer.on('hf:progress', h); return () => ipcRenderer.removeListener('hf:progress', h); },
  stop: () => ipcRenderer.invoke('company:stop'),                          // 생성 중단
  reset: () => ipcRenderer.invoke('company:reset'),
  orderList: () => ipcRenderer.invoke('order:list'),                       // v0.4.9 — /order 오더 목록·상태
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
  trainCloud: (code?: string) => ipcRenderer.invoke('train:cloud', code || ''),                    // ☁️ 내 AI 키우기(HF Jobs)
  trainCloudStatus: () => ipcRenderer.invoke('train:cloudStatus'),
  surgeryMerge: (a: string, b: string, method?: string, t?: string, outName?: string, password?: string) => ipcRenderer.invoke('surgery:merge', a, b, method || 'slerp', t || '0.5', outName || '', password || ''),   // 🔪 합치기 수술(HF Jobs)
  surgeryNotebook: (a: string, b: string, method?: string, scale?: number, outName?: string) => ipcRenderer.invoke('surgery:notebook', a, b, method || 'task_add', scale ?? 1.0, outName || ''),   // 🆓 무료 합성(Colab)
  cloudCancel: () => ipcRenderer.invoke('cloud:cancel'),   // 🚫 진행/멈춘 클라우드 작업 취소
  createdList: () => ipcRenderer.invoke('created:list'),   // 🧬 내 AI 팀 목록
  createdSave: (id: string, patch: any) => ipcRenderer.invoke('created:save', id, patch),   // 🧬 캐릭터 편집 저장
  gpuUsage: (kind?: string) => ipcRenderer.invoke('gpu:usage', kind || 'train'),   // 🔒 GPU 월 사용량(학습/수술 각각)
  hfMyModels: () => ipcRenderer.invoke('hf:myModels'),   // 🧬 내가 만든 AI(내 HF 모델)
  hfSearchModels: (q: string) => ipcRenderer.invoke('hf:searchModels', q),   // 🔍 HF 모델 검색(gemma·llama 등)
  trainCloudInstall: () => ipcRenderer.invoke('train:cloudInstall'),
  authSignup: (email: string, pw: string, profile?: any) => ipcRenderer.invoke('auth:signup', email, pw, profile),   // 👤 회원(이름·전화·약관)
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
  servicesUpdate: (id: string, patch: any) => ipcRenderer.invoke('services:update', id, patch),
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
  cycleIdea: () => ipcRenderer.invoke('cycle:idea'),   // 🎯 성장 사이클 1단계 — 아이디어 제안(웹검색 기반)
  cycleReport: () => ipcRenderer.invoke('cycle:report'),   // 🎯 2단계 — 분석 리포트(공부)
  cycleMarketing: (channel?: string) => ipcRenderer.invoke('cycle:marketing', channel || 'youtube'),   // 🎯 3단계 — 마케팅 자동 발행
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
  opsFeedback: (title: string, good: boolean) => ipcRenderer.invoke('ops:feedback', title, good),   // 👍👎 강화학습 피드백

  opsNextCycle: () => ipcRenderer.invoke('ops:nextCycle'),
  opsExecuteSelected: (titles: string[], humanTitles?: string[]) => ipcRenderer.invoke('ops:executeSelected', titles, humanTitles || []),
  opsStop: () => ipcRenderer.invoke('ops:stop'),
  opsOpenReview: () => ipcRenderer.invoke('ops:openReview'),       // 🔗 대시보드 → 메인 창 작전 검토
  remoteInfo: () => ipcRenderer.invoke('remote:info'),             // 📱 폰 웹 리모컨 주소
  opsClearShipped: () => ipcRenderer.invoke('ops:clearShipped'),   // 🧹 지난 기록 비우기
  opsOpenArtifact: (rel: string) => ipcRenderer.invoke('ops:openArtifact', rel),   // 📄 산출물 파일 열기
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
  plazaIsAdmin: () => ipcRenderer.invoke('plaza:isAdmin'),   // 🛡️ 선생님(관리자) 여부
  plazaLab: (opts: any) => ipcRenderer.invoke('plaza:lab', opts),   // 🧪 실험 에이전트 소환
  plazaLabStop: () => ipcRenderer.invoke('plaza:labStop'),
  plazaLabPersonas: () => ipcRenderer.invoke('plaza:labPersonas'),
  plazaDbUrl: () => ipcRenderer.invoke('plaza:dburl'),
  plazaProfile: (uid: string) => ipcRenderer.invoke('plaza:profile', uid),   // 🎒 캐릭터 보유 현황 조회
  inventory: () => ipcRenderer.invoke('inventory:get'),                        // 🎒 내 AI 보유 현황(모델·데이터셋·합성·레벨)
  onPlazaPeer: (cb: (m: any) => void) => {
    const h = (_e: any, m: any) => cb(m);
    ipcRenderer.on('plaza:peer', h);
    return () => ipcRenderer.removeListener('plaza:peer', h);
  },
  onPlazaPresence: (cb: (list: any[]) => void) => {
    const h = (_e: any, list: any[]) => cb(list);
    ipcRenderer.on('plaza:presence', h);
    return () => ipcRenderer.removeListener('plaza:presence', h);
  },
  onPlazaLearned: (cb: (d: any) => void) => {   // 🧠 광장에서 배운 지식 알림
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('plaza:learned', h);
    return () => ipcRenderer.removeListener('plaza:learned', h);
  },
});
