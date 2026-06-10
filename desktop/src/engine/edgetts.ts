// 🔊 무료 고품질 음성 — Microsoft Edge 신경망 TTS. 키·GPU 불필요. 자연스러운 한국어(선희·인준 등).
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export async function edgeTTS(voice: string, text: string, prosody?: { rate?: string; pitch?: string }): Promise<{ ok: boolean; dataUri?: string; error?: string }> {
  if (!text) return { ok: false, error: '텍스트 없음' };
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice || 'ko-KR-SunHiNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // 🎭 음높이·속도 변주 — 같은 보이스라도 에이전트마다 다른 목소리처럼 (낮은 pitch = 자비스 톤)
    const opts: any = {};
    if (prosody?.rate) opts.rate = prosody.rate;
    if (prosody?.pitch) opts.pitch = prosody.pitch;
    const { audioStream } = tts.toStream(text.slice(0, 1500), opts);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (c: Buffer) => chunks.push(c));
      audioStream.on('end', () => resolve());
      audioStream.on('error', reject);
      setTimeout(() => resolve(), 15000);
    });
    if (!chunks.length) return { ok: false, error: '음성을 받지 못했어요 (네트워크 확인).' };
    return { ok: true, dataUri: `data:audio/mpeg;base64,${Buffer.concat(chunks).toString('base64')}` };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}
