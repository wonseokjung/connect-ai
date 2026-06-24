// 🌐 웹 도구 — 에이전트가 인터넷을 검색하고 페이지를 읽는다 (키 불필요). SDK의 google_search/url_context에 해당.
import axios from 'axios';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Connect-AI/0.1';

const htmlToText = (html: string) =>
  String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();

// 페이지 읽기 (url_context)
export async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, maxContentLength: 6e6, maxRedirects: 5 });
    const text = htmlToText(r.data);
    return text ? text.slice(0, 4500) : '(빈 페이지)';
  } catch (e: any) { return `(불러오기 실패: ${e?.response?.status || ''} ${e?.message || e})`; }
}

// 사이트 메타 — 카드용 (제목·대표이미지 og:image·파비콘·요약)
export async function siteMeta(url: string): Promise<{ title: string; image: string; favicon: string; text: string }> {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const meta = (html: string, key: string) => {
    const a = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']+)["\']', 'i'));
    const b = html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i'));
    return (a && a[1]) || (b && b[1]) || '';
  };
  let favicon = '';
  try { favicon = 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=128'; } catch { /* */ }
  try {
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, maxContentLength: 6e6, maxRedirects: 5 });
    const html = String(r.data || '');
    let image = meta(html, 'og:image') || meta(html, 'twitter:image') || '';
    if (image && !/^https?:\/\//i.test(image)) { try { image = new URL(image, url).href; } catch { /* */ } }
    const title = meta(html, 'og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
    return { title: title.slice(0, 80), image, favicon, text: htmlToText(html).slice(0, 220) };
  } catch { return { title: '', image: '', favicon, text: '' }; }
}

// 웹 검색 (google_search) — DuckDuckGo HTML(키 불필요)에서 상위 결과
export async function webSearch(query: string): Promise<string> {
  if (!query) return '(검색어 없음)';
  try {
    const r = await axios.get('https://html.duckduckgo.com/html/', { params: { q: query }, timeout: 15000, headers: { 'User-Agent': UA } });
    const html = String(r.data || '');
    const out: string[] = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 5) {
      const title = htmlToText(m[2]); const snip = htmlToText(m[4]);
      let link = m[1]; const u = link.match(/uddg=([^&]+)/); if (u) { try { link = decodeURIComponent(u[1]); } catch { /* */ } }
      if (title) out.push(`• ${title}\n  ${snip}\n  ${link}`);
    }
    return out.length ? out.join('\n\n') : '(검색 결과를 파싱하지 못했어요)';
  } catch (e: any) { return `(검색 실패: ${e?.message || e})`; }
}
