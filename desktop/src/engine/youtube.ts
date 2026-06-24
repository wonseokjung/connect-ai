// 📺 YouTube — Data API(채널·영상, API Key) + Analytics(시청지속률 등, OAuth).
import axios from 'axios';
const API = 'https://www.googleapis.com/youtube/v3';

export async function fetchChannel(apiKey: string, channelId: string): Promise<any> {
  if (!apiKey || !channelId) return { ok: false, error: 'YouTube API Key와 Channel ID를 🗂️ 연동에서 입력하세요.' };
  try {
    const ch = await axios.get(`${API}/channels`, { params: { part: 'snippet,statistics,contentDetails', id: channelId, key: apiKey }, timeout: 15000 });
    const c = ch.data?.items?.[0]; if (!c) return { ok: false, error: '채널을 찾을 수 없어요. Channel ID(UC…)를 확인하세요.' };
    const uploads = c.contentDetails?.relatedPlaylists?.uploads;
    let videos: any[] = [];
    if (uploads) {
      const pl = await axios.get(`${API}/playlistItems`, { params: { part: 'contentDetails', playlistId: uploads, maxResults: 6, key: apiKey }, timeout: 15000 });
      const ids = (pl.data?.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      if (ids.length) {
        const vd = await axios.get(`${API}/videos`, { params: { part: 'snippet,statistics', id: ids.join(','), key: apiKey }, timeout: 15000 });
        videos = (vd.data?.items || []).map((v: any) => ({ id: v.id, title: v.snippet?.title, thumb: v.snippet?.thumbnails?.medium?.url, publishedAt: v.snippet?.publishedAt, views: +(v.statistics?.viewCount || 0), likes: +(v.statistics?.likeCount || 0), comments: +(v.statistics?.commentCount || 0) }));
      }
    }
    const s = c.statistics || {};
    return { ok: true, channel: { id: c.id, title: c.snippet?.title, thumb: c.snippet?.thumbnails?.default?.url, subs: +(s.subscriberCount || 0), views: +(s.viewCount || 0), videos: +(s.videoCount || 0) }, videos };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.error?.message || e?.message || String(e) }; }
}

// OAuth refresh_token → access_token
export async function ytAccessToken(clientId: string, secret: string, refresh: string): Promise<string | null> {
  try {
    const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }), { timeout: 15000 });
    return r.data?.access_token || null;
  } catch { return null; }
}

// Analytics (최근 28일) — 시청 지속률·시청시간·구독 증감
export async function fetchAnalytics(accessToken: string): Promise<any> {
  try {
    const end = new Date(), start = new Date(end.getTime() - 28 * 864e5);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const r = await axios.get('https://youtubeanalytics.googleapis.com/v2/reports', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { ids: 'channel==MINE', startDate: iso(start), endDate: iso(end), metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained', dimensions: '' },
      timeout: 15000,
    });
    const row = r.data?.rows?.[0] || [];
    return { ok: true, analytics: { views: row[0] || 0, minutesWatched: row[1] || 0, avgViewDuration: row[2] || 0, avgViewPercentage: row[3] || 0, subscribersGained: row[4] || 0 } };
  } catch (e: any) { return { ok: false, error: e?.response?.data?.error?.message || e?.message }; }
}
