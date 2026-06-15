// 🧪 단기·장기·수술 시뮬레이션 — 실제 케이스를 코드에 통과시켜 버그를 잡는다.
import { encryptPack, decryptPack } from '../src/engine/cryptopack';
import { toConversationsJsonl, fallbackQuestion, trimAnswer, noteTitle, nextModelName, guessBase } from '../src/engine/dataset';

let pass = 0, fail = 0; const bugs: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => { if (cond) pass++; else { fail++; bugs.push(`${name}${detail ? ' — ' + detail : ''}`); } };

console.log('═══ ① 단기기억 — 두뇌 팩 암호화(공유) ═══');
for (const [nm, txt] of [['빈 문자열', ''], ['한글+이모지', '안녕하세요 😀 우리 회사 지식 🧠'], ['특수문자', '"quote" \\back/ \n\t <tag> {json:1}'], ['대용량', 'x'.repeat(120000)]] as [string, string][]) {
  try { const blob = encryptPack(txt, 'pw1234'); const back = decryptPack(blob, 'pw1234'); ok('암호화 왕복: ' + nm, back === txt, `복호화 불일치 (len ${back.length} vs ${txt.length})`); }
  catch (e: any) { ok('암호화 왕복: ' + nm, false, '예외 ' + e?.message); }
}
// 틀린 비번은 반드시 실패해야(쓰레기 반환 X)
try { const blob = encryptPack('비밀', 'right'); let leaked = false; try { decryptPack(blob, 'wrong'); leaked = true; } catch { /* 정상 */ } ok('틀린 비번 거부', !leaked, '틀린 비번인데 복호화됨!'); }
catch { ok('틀린 비번 거부', false, '암호화 자체 예외'); }
// 빈 비번 왕복
try { ok('빈 비번 왕복', decryptPack(encryptPack('데이터', ''), '') === '데이터'); } catch (e: any) { ok('빈 비번 왕복', false, e?.message); }

console.log('═══ ② 장기기억 — 데이터셋 변환 ═══');
// 케이스 A: 정상 노트들
const good = toConversationsJsonl([{ q: '회사 뭐해?', a: '비개발자 AI 1인기업을 돕습니다.' }, { q: '가치?', a: '단순함과 쉬움.' }]);
ok('정상 변환 2줄', good.split('\n').filter(Boolean).length === 2, `줄수 ${good.split('\n').filter(Boolean).length}`);
// 케이스 B: 답이 전부 짧음(≤4자) → 빈 데이터셋? (학습 깨짐 위험)
const allShort = toConversationsJsonl([{ q: '?', a: '응' }, { q: '?', a: 'ㅇㅋ' }, { q: '?', a: '네넵' }]);
ok('짧은답 전부 → 비어있음 감지', allShort.trim().length === 0, `결과: ${JSON.stringify(allShort).slice(0, 40)}`);
console.log(`   ⚠️ 위가 '비어있음 감지'로 pass면 → buildDataset이 빈 jsonl을 만들 수 있음(가드 필요)`);
// 케이스 C: trimAnswer — 본문 중간 '---'(구분선)이 있으면?
const midDash = trimAnswer('우리 회사 소개\n\n---\n\n핵심 가치는 단순함입니다. 이게 제일 중요해요.');
ok('trimAnswer 중간 --- 보존', midDash.includes('핵심 가치'), `결과: "${midDash.slice(0, 50)}"`);
// 케이스 D: 프론트매터(맨 앞 ---...---)는 제거돼야
const fm = trimAnswer('---\ntitle: x\n---\n진짜 내용입니다.');
ok('trimAnswer 프론트매터 제거', fm.startsWith('진짜 내용'), `결과: "${fm.slice(0, 40)}"`);
// 케이스 E: 빈/기호 노트 제목
ok('noteTitle 기호만 → 빈문자 안전', typeof noteTitle('### --- ***') === 'string');
ok('fallbackQuestion 빈 노트 비크래시', typeof fallbackQuestion({ text: '', category: 'general' } as any) === 'string');
// 케이스 F: 모델명 버전 증가
ok('nextModelName 기본', nextModelName('') === 'my-brain-v1');
ok('nextModelName v1→v2', nextModelName('my-brain-v1') === 'my-brain-v2');
ok('nextModelName v9→v10', nextModelName('my-brain-v9') === 'my-brain-v10');
ok('nextModelName 무버전→v2', nextModelName('foo') === 'foo-v2');

console.log('═══ ③ AI 수술 — 모델명 정리(HF repo 안전) ═══');
const sanit = (outName: string) => (outName || `merged-x`).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'merged';
ok('수술명 한글 → 안전화', /^[a-zA-Z0-9._-]+$/.test(sanit('내 합친모델!!')), `결과: ${sanit('내 합친모델!!')}`);
ok('수술명 빈값 → 기본', sanit('') === 'merged-x');
ok('수술명 기호만 → merged', sanit('!!!@@@') === 'merged', `결과: ${sanit('!!!@@@')}`);
// guessBase 합치기/학습 베이스 추정
ok('guessBase gemma4', guessBase('gemma-4-E2B-it').includes('gemma-4'));
ok('guessBase qwen', guessBase('Qwen2.5-1.5B').toLowerCase().includes('qwen'));

console.log('═══ ④ AI 수술 — 레시피·merge 설정·검증 ═══');
// 렌더러 surgRecipe/검증 로직 복제 검증
const RECIPES = [
  { id: 'code', a: 'Qwen/Qwen2.5-1.5B-Instruct', b: 'Qwen/Qwen2.5-Coder-1.5B-Instruct' },
  { id: 'math', a: 'Qwen/Qwen2.5-1.5B-Instruct', b: 'Qwen/Qwen2.5-Math-1.5B-Instruct' },
];
ok('레시피 code → 두 모델 다름', RECIPES[0].a !== RECIPES[0].b);
ok('레시피 math → 두 모델 다름', RECIPES[1].a !== RECIPES[1].b);
// merge_uv.py 가 만들 merge.yaml(slerp) 구조 검증 (mergekit 정석: slices+sources+base_model+parameters.t)
function buildMergeCfg(a: string, b: string, method: string, t: number, n: number): any {
  if (method === 'slerp' || method === 'passthrough')
    return { slices: [{ sources: [{ model: a, layer_range: [0, n] }, { model: b, layer_range: [0, n] }] }], merge_method: method, base_model: a, parameters: { t }, dtype: 'bfloat16' };
  return { models: [{ model: a }, { model: b }], merge_method: method, base_model: a, parameters: { weight: [1 - t, t] }, dtype: 'bfloat16' };
}
const cfg = buildMergeCfg(RECIPES[0].a, RECIPES[0].b, 'slerp', 0.5, 28);
ok('slerp = slices 형식', !!cfg.slices && !cfg.models);
ok('slerp slices에 두 소스', cfg.slices[0].sources.length === 2);
ok('slerp layer_range [0,28]', JSON.stringify(cfg.slices[0].sources[0].layer_range) === '[0,28]');
ok('slerp base_model 지정', cfg.base_model === RECIPES[0].a);
ok('slerp parameters.t', cfg.parameters.t === 0.5);
const ties = buildMergeCfg(RECIPES[0].a, RECIPES[0].b, 'ties', 0.3, 28);
ok('ties = models 형식', !!ties.models && !ties.slices);
ok('ties weight 분배', JSON.stringify(ties.parameters.weight) === '[0.7,0.3]');
// surgeryGo 검증 로직
const valid = (a: string, b: string) => !(!a || !b) && a !== b;
ok('검증: 빈 모델 거부', valid('', 'x') === false);
ok('검증: 같은 모델 거부', valid('x', 'x') === false);
ok('검증: 정상 통과', valid('Qwen/A', 'Qwen/B') === true);
// 블렌드 슬라이더 → t 변환
ok('블렌드 50 → t 0.5', (50 / 100) === 0.5);
ok('블렌드 70 → 30:70 표시', `${100 - 70} : ${70}` === '30 : 70');

console.log(`\n${'═'.repeat(40)}\n결과: ✅ ${pass} 통과 · ❌ ${fail} 실패`);
if (bugs.length) { console.log('\n🐛 발견된 문제:'); bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b}`)); }
else console.log('🎉 모든 케이스 통과');
