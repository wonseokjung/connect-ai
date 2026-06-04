// 🧠 두뇌 — Connect AI의 핵심. 지식 노트를 쌓고, 분야로 나누고, 연결하고, RAG로 끌어온다.
//   저장: JSON 한 파일(노트 배열). 검색: 임베딩 코사인(있으면) → 키워드(폴백).
//   분야(category): 마케팅·코딩·디자인·사업·일반 — 에이전트별 두뇌 라우팅 + 분야별 파인튜닝의 척추.
//   출처(source): 누가 준 지식인가 — me(나)·jay(구독)·agent(에이전트 수집)·ezerai. 검증(verified) 구분.
//   그래프: 노트=노드, 유사도/공유태그=엣지.
import * as fs from 'fs';
import * as path from 'path';

export type Category = 'marketing' | 'coding' | 'design' | 'business' | 'general';
export type Source = 'me' | 'jay' | 'agent' | 'ezerai';

export interface Note { id: string; text: string; tags: string[]; ts: number; emb?: number[]; category?: Category; source?: Source; verified?: boolean; }

// 분야 정의 — 라벨·이모지·대표 에이전트(어느 두뇌로 가는지)·분류 키워드.
export const CATEGORIES: Record<Category, { label: string; emoji: string; agent: string; brain: string; keywords: string[] }> = {
  marketing: { label: '마케팅', emoji: '📣', agent: '레오·콘텐츠팀', brain: '마케팅 두뇌',
    keywords: '유튜브 youtube 영상 콘텐츠 content 인스타 instagram 릴스 reels 쇼츠 shorts 브이로그 vlog 썸네일 후크 hook 후킹 훅 텐션 리텐션 retention 떡밥 도입부 인트로 intro 오프닝 카피 copy 마케팅 marketing 브랜딩 branding seo 조회수 시청 시청자 구독 구독자 subscriber 해시태그 hashtag 캡션 caption 트렌드 trend 광고 ad 도달 reach 노출 인게이지 engagement 바이럴 viral 스크립트 채널 channel 팔로워 follower 크리에이터 creator 클릭률 ctr 미스터비스트 mrbeast'.split(' ') },
  coding: { label: '코딩', emoji: '💻', agent: '코다리', brain: '코딩 두뇌',
    keywords: '코드 code 함수 function 버그 bug api 배포 deploy 서버 server python javascript typescript 리액트 react node git 데이터베이스 database db 스크립트 script 자동화 automation 컴파일 compile 에러 error 라이브러리 library 프레임워크 framework 알고리즘 algorithm 리팩터 refactor 테스트 test 빌드 build 패키지 npm 엔드포인트 webhook'.split(' ') },
  design: { label: '디자인', emoji: '🎨', agent: 'Designer', brain: '디자인 두뇌',
    keywords: '디자인 design 컬러 color 색상 타이포 typo 폰트 font 레이아웃 layout ui ux 비주얼 visual 로고 logo 팔레트 palette 그래픽 graphic 일러스트 illust 무드보드 moodboard 브랜드 brand 아이콘 icon 그라데이션 여백 정렬 컴포지션 스타일가이드'.split(' ') },
  business: { label: '사업', emoji: '💼', agent: '현빈', brain: '사업 두뇌',
    keywords: '수익 매출 revenue 가격 price pricing 전략 strategy roi kpi 시장 market 경쟁 competitor 비즈니스 business 투자 invest 마진 margin 수익화 monetize 고객 customer b2b b2c 펀딩 funding 비용 cost 손익 단가 구독료 결제 paypal stripe 전환율 ltv cac 리텐션'.split(' ') },
  general: { label: '일반', emoji: '🗂️', agent: '영숙·비서', brain: '일반 두뇌', keywords: [] },
};
export const CATEGORY_IDS: Category[] = ['marketing', 'coding', 'design', 'business', 'general'];

// 텍스트 → 분야 자동 분류(키워드 점수 최댓값). LLM 없이 즉시·무료·오프라인. 동점/0점 → general.
export function classify(text: string): Category {
  const lc = (text || '').toLowerCase();
  let best: Category = 'general', bestScore = 0;
  for (const id of CATEGORY_IDS) {
    if (id === 'general') continue;
    let s = 0; for (const k of CATEGORIES[id].keywords) if (lc.includes(k)) s++;
    if (s > bestScore) { bestScore = s; best = id; }
  }
  return best;
}
const normCat = (c?: string): Category => (c && (CATEGORY_IDS as string[]).includes(c)) ? c as Category : 'general';

let _file = '';
export function setBrainFile(p: string) { _file = p; }
function load(): Note[] { try { return JSON.parse(fs.readFileSync(_file, 'utf8')); } catch { return []; } }
function persist(n: Note[]) { try { fs.mkdirSync(path.dirname(_file), { recursive: true }); fs.writeFileSync(_file, JSON.stringify(n)); } catch { /* */ } }

const STOP = new Set('그 이 저 것 수 등 및 더 좀 잘 안 못 의 가 이 은 는 을 를 에 와 과 도 로 으로 에서 the a an of to and or is are for in on with that this 합니다 입니다 있다 없다 하는 한 할 함'.split(/\s+/));
function keywords(text: string): string[] {
  const wiki = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
  const words = (text.toLowerCase().match(/[a-z0-9]{3,}|[가-힣]{2,}/g) || []).filter(w => !STOP.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  return [...new Set([...wiki, ...top])];
}

export function allNotes(): Note[] { return load(); }
export function noteCount(): number { return load().length; }

export interface AddOpts { category?: Category; source?: Source; verified?: boolean; }
export function addNote(text: string, emb?: number[], opts: AddOpts = {}): Note {
  const notes = load();
  const t = text.trim();
  const source: Source = opts.source || 'me';
  const note: Note = {
    id: 'n' + Date.now() + Math.floor(Math.random() * 1e4), text: t, tags: keywords(t), ts: Date.now(), emb,
    category: opts.category || classify(t), source, verified: opts.verified ?? (source !== 'agent'),   // 에이전트 자동수집만 후보, 나머지(나·구독·에제르)는 검증
  };
  notes.push(note); persist(notes); return note;
}
export function deleteNote(id: string) { persist(load().filter(n => n.id !== id)); }

// 노트의 분야를 수동 변경(사용자가 자동분류를 고칠 때).
export function setCategory(id: string, category: Category) {
  const notes = load(); const n = notes.find(x => x.id === id); if (!n) return;
  n.category = normCat(category); persist(notes);
}

// GitHub/구독 등에서 불러온 노트를 병합(중복 텍스트 제외). 추가된 개수 반환.
export function importNotes(incoming: Partial<Note>[], opts: AddOpts = {}): number {
  const cur = load(); const have = new Set(cur.map(n => n.text.trim()));
  let added = 0;
  for (const n of incoming) {
    const t = (n.text || '').trim(); if (!t || have.has(t)) continue;
    cur.push({
      id: 'n' + Date.now() + Math.floor(Math.random() * 1e4), text: t, tags: n.tags || keywords(t), ts: n.ts || Date.now(), emb: n.emb,
      category: normCat(n.category || opts.category || classify(t)), source: (n.source as Source) || opts.source || 'me', verified: n.verified ?? opts.verified ?? false,
    });
    have.add(t); added++;
  }
  if (added) persist(cur); return added;
}

// 분야별 통계 — 개수·검증된 개수·파인튜닝 준비 여부(임계점 도달). 성장 대시보드용.
export const FINETUNE_THRESHOLD = 30;   // 이 정도 쌓이면 분야 전용 모델 파인튜닝 추천
export function categoryStats(): { id: Category; label: string; emoji: string; brain: string; count: number; verified: number; ready: boolean; pct: number }[] {
  const notes = load();
  return CATEGORY_IDS.map(id => {
    const ns = notes.filter(n => normCat(n.category) === id);
    const verified = ns.filter(n => n.verified).length;
    return { id, label: CATEGORIES[id].label, emoji: CATEGORIES[id].emoji, brain: CATEGORIES[id].brain, count: ns.length, verified, ready: ns.length >= FINETUNE_THRESHOLD, pct: Math.min(100, Math.round(ns.length / FINETUNE_THRESHOLD * 100)) };
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// 질문과 관련 있는 노트 top-K. queryEmb 주면 의미 검색, 없으면 키워드 겹침.
//   prefer: 특정 분야 두뇌(에이전트)면 그 분야 + 검증된 지식에 가중치 → "내 분야 지식 먼저".
export function search(query: string, topK = 4, queryEmb?: number[], prefer?: Category): Note[] {
  const notes = load();
  if (!notes.length) return [];
  const boost = (n: Note) => (prefer && normCat(n.category) === prefer ? 0.15 : 0) + (n.verified ? 0.05 : 0);
  if (queryEmb && notes.some(n => n.emb)) {
    return notes.filter(n => n.emb).map(n => ({ n, s: cosine(queryEmb, n.emb!) + boost(n) }))
      .sort((a, b) => b.s - a.s).filter(x => x.s > 0.3).slice(0, topK).map(x => x.n);
  }
  const qk = new Set(keywords(query));
  return notes.map(n => ({ n, s: n.tags.filter(t => qk.has(t)).length + (qk.size && [...qk].some(k => n.text.toLowerCase().includes(k)) ? 0.5 : 0) + boost(n) * 4 }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, topK).map(x => x.n);
}

// 그래프 데이터: 노드 + 엣지(임베딩 유사도 또는 공유 태그). 노드에 분야 포함(색칠용).
export function graph(): { nodes: { id: string; label: string; tags: string[]; category: Category }[]; links: { source: string; target: string; w: number }[] } {
  const notes = load();
  const nodes = notes.map(n => ({ id: n.id, label: n.text.replace(/\[\[|\]\]/g, '').slice(0, 22), tags: n.tags, category: normCat(n.category) }));
  const links: { source: string; target: string; w: number }[] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i], b = notes[j];
      let w = 0;
      if (a.emb && b.emb) w = cosine(a.emb, b.emb);
      else { const shared = a.tags.filter(t => b.tags.includes(t)).length; w = shared ? Math.min(1, shared / 2) : 0; }
      if (w > 0.45) links.push({ source: a.id, target: b.id, w });
    }
  }
  return { nodes, links };
}
