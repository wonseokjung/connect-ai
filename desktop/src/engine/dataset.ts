// 🧬 장기기억 데이터셋 — 단기 지식(노트)을 검증된 conversations Q&A 형식으로 변환.
//   각 지식(=정답)에 대해 "사용자가 물어볼 질문"을 만들어 {user:Q, assistant:A} 쌍을 만든다.
//   질문은 로컬 모델이 생성(다양성=과적합/echo 방지) → 실패 시 카테고리별 템플릿 폴백.
import type { Note, Category } from './brain';

export function noteTitle(t: string): string {
  const first = (t.split('\n').map(l => l.trim()).find(l => l && l !== '---') || t).replace(/^#+\s*/, '').replace(/[*_`>#\[\]]/g, '').trim();
  return first.slice(0, 60);
}

// LLM 실패 시 폴백 질문(카테고리 톤). 결정적 선택(노트 길이 기반).
export function fallbackQuestion(note: Note): string {
  const title = noteTitle(note.text);
  const cat = (note.category || 'general') as Category;
  const tmpl: Record<string, string[]> = {
    marketing: [`${title} 어떻게 해?`, `${title}에 대해 알려줘`, `${title} 전략이 뭐야?`],
    coding: [`${title} 어떻게 구현해?`, `${title} 설명해줘`, `${title} 어떻게 해?`],
    design: [`${title} 어떻게 디자인해?`, `${title}에 대해 알려줘`, `${title} 가이드 알려줘`],
    business: [`${title} 전략 알려줘`, `${title}에 대해 설명해줘`, `${title} 어떻게 접근해?`],
    general: [`${title}에 대해 알려줘`, `${title} 설명해줘`, `${title}이 뭐야?`],
  };
  const arr = tmpl[cat] || tmpl.general;
  return arr[note.text.length % arr.length];
}

// 답변 길이 제한 — 너무 긴 문서는 SFT에 부적합(긴 건 RAG가 담당). 핵심만 가중치에.
export function trimAnswer(text: string): string {
  // 프론트매터(맨 앞 ---…---)만 제거 — 본문 중간 구분선(---)은 건드리지 않게 문서 시작에만 앵커
  const body = text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '').trim();
  return body.slice(0, 1200);
}

// Q&A 쌍 배열 → conversations JSONL
export function toConversationsJsonl(pairs: { q: string; a: string }[]): string {
  return pairs
    .filter(p => p.q && p.a && p.a.trim().length > 4)
    .map(p => JSON.stringify({ conversations: [
      { role: 'user', content: p.q.trim() },
      { role: 'assistant', content: p.a.trim() },
    ] }))
    .join('\n');
}

// 내가 로드한 모델명 → Unsloth 베이스 추정(누적 학습: 내 모델 위에 쌓기).
export function guessBase(llmModel?: string): string {
  const m = (llmModel || '').toLowerCase();
  if (m.includes('gemma-4') || m.includes('gemma4')) return 'unsloth/gemma-4-E2B-it';
  if (m.includes('gemma-2') || m.includes('gemma2')) return 'unsloth/gemma-2-2b-it';
  if (m.includes('llama-3') || m.includes('llama3')) return 'unsloth/Llama-3.2-3B-Instruct';
  if (m.includes('qwen')) return 'unsloth/Qwen2.5-3B-Instruct';
  return 'unsloth/gemma-4-E2B-it';
}

// "내두뇌-v2" 식 다음 버전 이름 제안
export function nextModelName(prev?: string): string {
  // HF repo는 영어만 — 기본 제안도 영어로 (한글 이름은 학습 실패)
  if (!prev) return 'my-brain-v1';
  const m = /^(.*?-v)(\d+)$/.exec(prev.trim());
  if (m) return `${m[1]}${parseInt(m[2], 10) + 1}`;
  return `${prev.replace(/\/+$/, '')}-v2`;
}
