"use strict";

// src/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("connect", {
  // 설정
  getConfig: () => import_electron.ipcRenderer.invoke("config:get"),
  setConfig: (patch) => import_electron.ipcRenderer.invoke("config:set", patch),
  // 🛡️ 안전 모드 (GPU 끄기) — 흰 화면/크래시 대비
  safeModeGet: () => import_electron.ipcRenderer.invoke("safemode:get"),
  safeModeSet: (on) => import_electron.ipcRenderer.invoke("safemode:set", on),
  relaunch: () => import_electron.ipcRenderer.invoke("app:relaunch"),
  ttsSpeak: (text) => import_electron.ipcRenderer.invoke("tts:speak", text),
  // 🔊 Qwen3-TTS
  ttsSpeakAgent: (id, text) => import_electron.ipcRenderer.invoke("tts:speakAgent", id, text),
  // 🎭 에이전트별 목소리
  openDiagnostics: () => import_electron.ipcRenderer.invoke("diag:open"),
  // 비서 엔진
  run: (text, attach) => import_electron.ipcRenderer.invoke("company:run", text, attach),
  // 통합 에이전트 (+첨부 파일/이미지)
  pathForFile: (file) => import_electron.webUtils.getPathForFile(file),
  // 드롭된 파일의 실제 경로 (Electron 33)
  // 💻 작업실 — 파일 트리/읽기/Finder
  fsTree: (root) => import_electron.ipcRenderer.invoke("fs:tree", root),
  fsRead: (p) => import_electron.ipcRenderer.invoke("fs:read", p),
  fsWrite: (p, content) => import_electron.ipcRenderer.invoke("fs:write", p, content),
  fsReveal: (p) => import_electron.ipcRenderer.invoke("fs:reveal", p),
  // ⌨️ 터미널 (서버도 여기서 실행·중지)
  termRun: (cmd, ws) => import_electron.ipcRenderer.invoke("term:run", cmd, ws),
  termKill: () => import_electron.ipcRenderer.invoke("term:kill"),
  onTermData: (cb) => {
    const h = (_e, s) => cb(s);
    import_electron.ipcRenderer.on("term:data", h);
    return () => import_electron.ipcRenderer.removeListener("term:data", h);
  },
  onTermShow: (cb) => {
    const h = () => cb();
    import_electron.ipcRenderer.on("term:show", h);
    return () => import_electron.ipcRenderer.removeListener("term:show", h);
  },
  // 🔌 EZERAI 브레인팩 주입 알림
  onBridgeInject: (cb) => {
    const h = (_e, d) => cb(d);
    import_electron.ipcRenderer.on("bridge:inject", h);
    return () => import_electron.ipcRenderer.removeListener("bridge:inject", h);
  },
  officeOpen: () => import_electron.ipcRenderer.invoke("office:open"),
  // 🪟 별도 사무실 창
  // ⬆️ 자동 업데이트
  updateCheck: () => import_electron.ipcRenderer.invoke("update:check"),
  updateInstall: () => import_electron.ipcRenderer.invoke("update:install"),
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s);
    import_electron.ipcRenderer.on("update:status", h);
    return () => import_electron.ipcRenderer.removeListener("update:status", h);
  },
  // 🧠 내장 추론 엔진(LM Studio 불필요) + 🤗 HuggingFace 모델
  localStatus: () => import_electron.ipcRenderer.invoke("local:status"),
  localStart: (modelPath) => import_electron.ipcRenderer.invoke("local:start", modelPath),
  localStop: () => import_electron.ipcRenderer.invoke("local:stop"),
  localModels: () => import_electron.ipcRenderer.invoke("local:models"),
  localModelsDir: () => import_electron.ipcRenderer.invoke("local:modelsDir"),
  localPickModelsDir: () => import_electron.ipcRenderer.invoke("local:pickModelsDir"),
  localOpenModelsDir: () => import_electron.ipcRenderer.invoke("local:openModelsDir"),
  localResetModelsDir: () => import_electron.ipcRenderer.invoke("local:resetModelsDir"),
  localDelete: (p) => import_electron.ipcRenderer.invoke("local:delete", p),
  localOptions: () => import_electron.ipcRenderer.invoke("local:options"),
  localSetOptions: (o) => import_electron.ipcRenderer.invoke("local:setOptions", o),
  onLocalStatus: (cb) => {
    const h = (_e, s) => cb(s);
    import_electron.ipcRenderer.on("local:status", h);
    return () => import_electron.ipcRenderer.removeListener("local:status", h);
  },
  hfRecommended: () => import_electron.ipcRenderer.invoke("hf:recommended"),
  hfSearch: (q) => import_electron.ipcRenderer.invoke("hf:search", q),
  hfFiles: (repo) => import_electron.ipcRenderer.invoke("hf:files", repo),
  hfDownload: (repo, file) => import_electron.ipcRenderer.invoke("hf:download", repo, file),
  onHfProgress: (cb) => {
    const h = (_e, p) => cb(p);
    import_electron.ipcRenderer.on("hf:progress", h);
    return () => import_electron.ipcRenderer.removeListener("hf:progress", h);
  },
  stop: () => import_electron.ipcRenderer.invoke("company:stop"),
  // 생성 중단
  reset: () => import_electron.ipcRenderer.invoke("company:reset"),
  listModels: () => import_electron.ipcRenderer.invoke("models:list"),
  getWorkspace: () => import_electron.ipcRenderer.invoke("workspace:get"),
  pickWorkspace: () => import_electron.ipcRenderer.invoke("workspace:pick"),
  // 🧠 두뇌 / 지식 네트워크
  brainGraph: () => import_electron.ipcRenderer.invoke("brain:graph"),
  brainList: () => import_electron.ipcRenderer.invoke("brain:list"),
  brainCount: () => import_electron.ipcRenderer.invoke("brain:count"),
  brainDelete: (id) => import_electron.ipcRenderer.invoke("brain:delete", id),
  brainStats: () => import_electron.ipcRenderer.invoke("brain:stats"),
  // 📊 분야별 성장
  bridgeStatus: () => import_electron.ipcRenderer.invoke("bridge:status"),
  // 🔌 에제르 브릿지 상태
  brainPublishPack: (password) => import_electron.ipcRenderer.invoke("brain:publishPack", password),
  // 📤 제이 브레인 게시(대장)
  brainLinkBrain: (repo, password) => import_electron.ipcRenderer.invoke("brain:linkBrain", repo, password),
  // 🧠 제이 브레인 연동(구독자)
  // ⚡ 단기=GitHub · 🧬 장기=HuggingFace
  memStatus: () => import_electron.ipcRenderer.invoke("memstatus"),
  githubPush: () => import_electron.ipcRenderer.invoke("github:push"),
  githubPull: () => import_electron.ipcRenderer.invoke("github:pull"),
  trainNotebook: (modelName, opts) => import_electron.ipcRenderer.invoke("train:notebook", modelName, opts),
  trainAutotrain: (modelName, opts) => import_electron.ipcRenderer.invoke("train:autotrain", modelName, opts),
  // 🧬 장기기억 만들기: ① 변환 ② 업로드 ③ 모델이름
  brainBuildDataset: (augment) => import_electron.ipcRenderer.invoke("brain:buildDataset", augment),
  hfUploadBrain: () => import_electron.ipcRenderer.invoke("hf:uploadBrain"),
  trainCloud: (code) => import_electron.ipcRenderer.invoke("train:cloud", code || ""),
  // ☁️ 내 AI 키우기(HF Jobs)
  trainCloudStatus: () => import_electron.ipcRenderer.invoke("train:cloudStatus"),
  surgeryMerge: (a, b, method, t, outName, password) => import_electron.ipcRenderer.invoke("surgery:merge", a, b, method || "slerp", t || "0.5", outName || "", password || ""),
  // 🔪 합치기 수술(HF Jobs)
  surgeryNotebook: (a, b, method, scale, outName) => import_electron.ipcRenderer.invoke("surgery:notebook", a, b, method || "task_add", scale ?? 1, outName || ""),
  // 🆓 무료 합성(Colab)
  cloudCancel: () => import_electron.ipcRenderer.invoke("cloud:cancel"),
  // 🚫 진행/멈춘 클라우드 작업 취소
  createdList: () => import_electron.ipcRenderer.invoke("created:list"),
  // 🧬 내 AI 팀 목록
  createdSave: (id, patch) => import_electron.ipcRenderer.invoke("created:save", id, patch),
  // 🧬 캐릭터 편집 저장
  gpuUsage: (kind) => import_electron.ipcRenderer.invoke("gpu:usage", kind || "train"),
  // 🔒 GPU 월 사용량(학습/수술 각각)
  hfMyModels: () => import_electron.ipcRenderer.invoke("hf:myModels"),
  // 🧬 내가 만든 AI(내 HF 모델)
  hfSearchModels: (q) => import_electron.ipcRenderer.invoke("hf:searchModels", q),
  // 🔍 HF 모델 검색(gemma·llama 등)
  trainCloudInstall: () => import_electron.ipcRenderer.invoke("train:cloudInstall"),
  authSignup: (email, pw, profile) => import_electron.ipcRenderer.invoke("auth:signup", email, pw, profile),
  // 👤 회원(이름·전화·약관)
  authLogin: (email, pw) => import_electron.ipcRenderer.invoke("auth:login", email, pw),
  authLogout: () => import_electron.ipcRenderer.invoke("auth:logout"),
  authCurrent: () => import_electron.ipcRenderer.invoke("auth:current"),
  brainBuildPreference: () => import_electron.ipcRenderer.invoke("brain:buildPreference"),
  // ⚖️ AI 자동 피드백
  hfUploadPreference: () => import_electron.ipcRenderer.invoke("hf:uploadPreference"),
  brainModelName: () => import_electron.ipcRenderer.invoke("brain:modelName"),
  methodsList: () => import_electron.ipcRenderer.invoke("methods:list"),
  // 🎓 학습 방법론 목록
  onDatasetProgress: (cb) => {
    const h = (_e, d) => cb(d);
    import_electron.ipcRenderer.on("dataset:progress", h);
    return () => import_electron.ipcRenderer.removeListener("dataset:progress", h);
  },
  // 📋 아침 브리핑(능동성) + 트레이
  briefingRun: () => import_electron.ipcRenderer.invoke("briefing:run"),
  onBriefing: (cb) => {
    const h = (_e, t) => cb(t);
    import_electron.ipcRenderer.on("briefing:show", h);
    return () => import_electron.ipcRenderer.removeListener("briefing:show", h);
  },
  onTrayNewChat: (cb) => {
    const h = () => cb();
    import_electron.ipcRenderer.on("tray:newchat", h);
    return () => import_electron.ipcRenderer.removeListener("tray:newchat", h);
  },
  // 🗂️ 관리 — 서비스·연동·대시보드
  servicesList: () => import_electron.ipcRenderer.invoke("services:list"),
  servicesAdd: (s) => import_electron.ipcRenderer.invoke("services:add", s),
  servicesUpdate: (id, patch) => import_electron.ipcRenderer.invoke("services:update", id, patch),
  servicesDelete: (id) => import_electron.ipcRenderer.invoke("services:delete", id),
  servicesIntel: () => import_electron.ipcRenderer.invoke("services:intel"),
  integrationsGet: () => import_electron.ipcRenderer.invoke("integrations:get"),
  integrationsSave: (patch) => import_electron.ipcRenderer.invoke("integrations:save", patch),
  telegramTest: () => import_electron.ipcRenderer.invoke("telegram:test"),
  // 🔌 서비스 정의 기반 API 패널
  apiGet: () => import_electron.ipcRenderer.invoke("api:get"),
  apiSave: (serviceId, values) => import_electron.ipcRenderer.invoke("api:save", serviceId, values),
  openExternal: (url) => import_electron.ipcRenderer.invoke("open:external", url),
  // 📺 YouTube
  youtubeGet: () => import_electron.ipcRenderer.invoke("youtube:get"),
  youtubeOAuth: () => import_electron.ipcRenderer.invoke("youtube:oauth"),
  // 🔌 MCP
  mcpGet: () => import_electron.ipcRenderer.invoke("mcp:get"),
  mcpSave: (cfg) => import_electron.ipcRenderer.invoke("mcp:save", cfg),
  mcpTest: () => import_electron.ipcRenderer.invoke("mcp:test"),
  mcpTools: () => import_electron.ipcRenderer.invoke("mcp:tools"),
  dashboardStats: () => import_electron.ipcRenderer.invoke("dashboard:stats"),
  cycleIdea: () => import_electron.ipcRenderer.invoke("cycle:idea"),
  // 🎯 성장 사이클 1단계 — 아이디어 제안(웹검색 기반)
  cycleReport: () => import_electron.ipcRenderer.invoke("cycle:report"),
  // 🎯 2단계 — 분석 리포트(공부)
  cycleMarketing: (channel) => import_electron.ipcRenderer.invoke("cycle:marketing", channel || "youtube"),
  // 🎯 3단계 — 마케팅 자동 발행
  // 📋 태스크 보드
  tasksList: () => import_electron.ipcRenderer.invoke("tasks:list"),
  tasksAdd: (title) => import_electron.ipcRenderer.invoke("tasks:add", title),
  tasksDone: (id) => import_electron.ipcRenderer.invoke("tasks:done", id),
  tasksCancel: (id) => import_electron.ipcRenderer.invoke("tasks:cancel", id),
  // ✅ 승인 큐
  approvalsList: () => import_electron.ipcRenderer.invoke("approvals:list"),
  approvalsApprove: (id) => import_electron.ipcRenderer.invoke("approvals:approve", id),
  approvalsReject: (id) => import_electron.ipcRenderer.invoke("approvals:reject", id),
  approvalsTest: () => import_electron.ipcRenderer.invoke("approvals:test"),
  // 💰 매출 대시보드 (별도 창)
  openRevenue: () => import_electron.ipcRenderer.invoke("revenue:open"),
  revReady: () => import_electron.ipcRenderer.invoke("revenue:ready"),
  reportBriefing: () => import_electron.ipcRenderer.invoke("report:briefing"),
  reportSpeak: (text) => import_electron.ipcRenderer.invoke("report:speak", text),
  revRefresh: () => import_electron.ipcRenderer.invoke("revenue:refresh"),
  revOpenSettings: () => import_electron.ipcRenderer.invoke("revenue:openSettings"),
  // 🤖 자율 운영 — 실데이터 분석 → 작전 생성 + 24시간 반복 루프
  opsStart: () => import_electron.ipcRenderer.invoke("ops:start"),
  opsStatus: () => import_electron.ipcRenderer.invoke("ops:status"),
  opsFeedback: (title, good) => import_electron.ipcRenderer.invoke("ops:feedback", title, good),
  // 👍👎 강화학습 피드백
  opsNextCycle: () => import_electron.ipcRenderer.invoke("ops:nextCycle"),
  opsExecuteSelected: (titles, humanTitles) => import_electron.ipcRenderer.invoke("ops:executeSelected", titles, humanTitles || []),
  opsStop: () => import_electron.ipcRenderer.invoke("ops:stop"),
  opsOpenReview: () => import_electron.ipcRenderer.invoke("ops:openReview"),
  // 🔗 대시보드 → 메인 창 작전 검토
  remoteInfo: () => import_electron.ipcRenderer.invoke("remote:info"),
  // 📱 폰 웹 리모컨 주소
  opsClearShipped: () => import_electron.ipcRenderer.invoke("ops:clearShipped"),
  // 🧹 지난 기록 비우기
  opsOpenArtifact: (rel) => import_electron.ipcRenderer.invoke("ops:openArtifact", rel),
  // 📄 산출물 파일 열기
  onOpsOpenPanel: (cb) => {
    const h = () => cb();
    import_electron.ipcRenderer.on("ops:openPanel", h);
    return () => import_electron.ipcRenderer.removeListener("ops:openPanel", h);
  },
  officeBanter: () => import_electron.ipcRenderer.invoke("office:banter"),
  // 💬 사무실 진짜 AI 대화
  onOpsUpdate: (cb) => {
    const h = (_e, s) => cb(s);
    import_electron.ipcRenderer.on("ops:update", h);
    return () => import_electron.ipcRenderer.removeListener("ops:update", h);
  },
  onRevenueState: (cb) => {
    const h = (_e, m) => cb(m);
    import_electron.ipcRenderer.on("revenue:state", h);
    return () => import_electron.ipcRenderer.removeListener("revenue:state", h);
  },
  onEngineEvent: (cb) => {
    const h = (_e, ev) => cb(ev);
    import_electron.ipcRenderer.on("engine:event", h);
    return () => import_electron.ipcRenderer.removeListener("engine:event", h);
  },
  // 광장
  plazaEnter: () => import_electron.ipcRenderer.invoke("plaza:enter"),
  plazaLeave: () => import_electron.ipcRenderer.invoke("plaza:leave"),
  plazaSend: (text) => import_electron.ipcRenderer.invoke("plaza:send", text),
  plazaTopic: (text) => import_electron.ipcRenderer.invoke("plaza:topic", text),
  plazaDemoBot: (on) => import_electron.ipcRenderer.invoke("plaza:demobot", on),
  plazaGrade: () => import_electron.ipcRenderer.invoke("plaza:grade"),
  plazaIsAdmin: () => import_electron.ipcRenderer.invoke("plaza:isAdmin"),
  // 🛡️ 선생님(관리자) 여부
  plazaLab: (opts) => import_electron.ipcRenderer.invoke("plaza:lab", opts),
  // 🧪 실험 에이전트 소환
  plazaLabStop: () => import_electron.ipcRenderer.invoke("plaza:labStop"),
  plazaLabPersonas: () => import_electron.ipcRenderer.invoke("plaza:labPersonas"),
  plazaDbUrl: () => import_electron.ipcRenderer.invoke("plaza:dburl"),
  plazaProfile: (uid) => import_electron.ipcRenderer.invoke("plaza:profile", uid),
  // 🎒 캐릭터 보유 현황 조회
  inventory: () => import_electron.ipcRenderer.invoke("inventory:get"),
  // 🎒 내 AI 보유 현황(모델·데이터셋·합성·레벨)
  onPlazaPeer: (cb) => {
    const h = (_e, m) => cb(m);
    import_electron.ipcRenderer.on("plaza:peer", h);
    return () => import_electron.ipcRenderer.removeListener("plaza:peer", h);
  },
  onPlazaPresence: (cb) => {
    const h = (_e, list) => cb(list);
    import_electron.ipcRenderer.on("plaza:presence", h);
    return () => import_electron.ipcRenderer.removeListener("plaza:presence", h);
  },
  onPlazaLearned: (cb) => {
    const h = (_e, d) => cb(d);
    import_electron.ipcRenderer.on("plaza:learned", h);
    return () => import_electron.ipcRenderer.removeListener("plaza:learned", h);
  }
});
//# sourceMappingURL=preload.js.map
