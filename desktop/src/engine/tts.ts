// 🔊 고품질 음성 — Qwen3-TTS via Replicate (사람 같은 한국어 음성). 키 필요·클라우드.
import axios from 'axios';

// 🖥️ 로컬 Qwen3-TTS 서버 — 누군가 모델을 로컬 HTTP 서버로 띄우면(Python+GPU) 그걸 호출. 완전 로컬·무료.
//   기대 계약: POST {url}/tts  { text, voice }  → 오디오 바이트(wav/mp3)
export async function localTTS(url: string, text: string, voice = ''): Promise<{ ok: boolean; dataUri?: string; error?: string }> {
  if (!url) return { ok: false, error: '로컬 TTS 서버 주소(예: http://127.0.0.1:7920)를 설정에서 입력하세요.' };
  try {
    const r = await axios.post(url.replace(/\/$/, '') + '/tts', { text: text.slice(0, 1200), voice }, { responseType: 'arraybuffer', timeout: 60000 });
    const ct = String(r.headers['content-type'] || 'audio/wav').split(';')[0];
    return { ok: true, dataUri: `data:${ct};base64,${Buffer.from(r.data).toString('base64')}` };
  } catch (e: any) { return { ok: false, error: `로컬 TTS 서버 연결 실패: ${e?.message || e}` }; }
}

export async function qwenTTS(token: string, text: string, voice = ''): Promise<{ ok: boolean; dataUri?: string; error?: string }> {
  if (!token) return { ok: false, error: 'Replicate API 토큰을 🗂️ 연동에서 입력하세요.' };
  if (!text) return { ok: false, error: '텍스트 없음' };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const input: any = { text: text.slice(0, 1200) };
    if (voice) input.voice = voice;
    // Prefer: wait → 동기 응답(최대 60s). 모델 슬러그로 바로 예측 생성.
    const r = await axios.post('https://api.replicate.com/v1/models/qwen/qwen3-tts/predictions', { input },
      { headers: { ...headers, Prefer: 'wait' }, timeout: 90000 });
    let data = r.data;
    // 아직 안 끝났으면 폴링
    if (data?.status && data.status !== 'succeeded' && data?.urls?.get) {
      for (let i = 0; i < 40 && data.status !== 'succeeded' && data.status !== 'failed' && data.status !== 'canceled'; i++) {
        await new Promise(s => setTimeout(s, 1500));
        data = (await axios.get(data.urls.get, { headers, timeout: 15000 })).data;
      }
    }
    if (data?.status === 'failed' || data?.status === 'canceled') return { ok: false, error: data?.error || '합성 실패' };
    const out = data?.output;
    const url = Array.isArray(out) ? out[0] : (typeof out === 'string' ? out : (out?.audio || out?.audio_url || out?.url));
    if (!url) return { ok: false, error: '오디오 URL을 받지 못했어요 (모델 입력 형식 확인 필요).' };
    const a = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const mime = /\.mp3(\?|$)/i.test(url) ? 'audio/mpeg' : (/\.ogg/i.test(url) ? 'audio/ogg' : 'audio/wav');
    return { ok: true, dataUri: `data:${mime};base64,${Buffer.from(a.data).toString('base64')}` };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.detail || e?.response?.data?.title || e?.message || String(e) }; }
}
