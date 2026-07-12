/**
 * You.com Search API provider
 * Docs: https://api.you.com/docs/search
 *
 * Provides real-time web search capability for the Researcher agent.
 * Uses the You.com Search API with the user-configured API key.
 */

export interface YouComSearchResult {
  title: string;
  url: string;
  description: string;
  snippet?: string;
}

export interface YouComSearchResponse {
  results: YouComSearchResult[];
  total: number;
  query: string;
}

export interface YouComProviderOptions {
  apiKey: string;
  timeout?: number;
}

/**
 * Search the web using You.com Search API.
 * Returns formatted results with title, URL, description, and snippet.
 */
export async function youComSearch(
  query: string,
  options: YouComProviderOptions
): Promise<YouComSearchResponse> {
  const { apiKey, timeout = 15000 } = options;

  if (!apiKey || !apiKey.trim()) {
    throw new Error('You.com API key not configured. Set connectAiLab.youComApiKey in VS Code settings.');
  }

  const url = `https://api.you.com/v1/search?query=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'X-API-Key': apiKey.trim(),
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid You.com API key. Please check your API key at https://api.you.com/apiKey');
    }
    throw new Error(`You.com Search API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;

  // Parse You.com /v1/search response format: { results: { web: [], news: [] } }
  const results: YouComSearchResult[] = [];

  if (data.results) {
    // /v1/search format: results.web and results.news
    const webResults = data.results.web || [];
    const newsResults = data.results.news || [];
    const combined = [...webResults, ...newsResults];
    for (const item of combined.slice(0, 10)) {
      results.push({
        title: item.title || 'Untitled',
        url: item.url || '',
        description: item.description || '',
        snippet: Array.isArray(item.snippets) ? item.snippets[0] : (item.snippet || ''),
      });
    }
  } else if (Array.isArray(data)) {
    // Direct array of results
    for (const item of data.slice(0, 10)) {
      results.push({
        title: item.title || item.name || 'Untitled',
        url: item.url || item.link || item.href || '',
        description: item.description || item.snippet || item.content || '',
        snippet: item.snippet || item.description || '',
      });
    }
  } else if (data.hits && Array.isArray(data.hits)) {
    // Algolia-style response
    for (const item of data.hits.slice(0, 10)) {
      results.push({
        title: item.title || item.name || 'Untitled',
        url: item.url || item.link || item.href || item.objectID || '',
        description: item.description || item.snippet || item.content || '',
        snippet: item.snippet || '',
      });
    }
  } else if (typeof data === 'object') {
    // Fallback: try common field names
    const keys = Object.keys(data);
    for (const key of keys) {
      if (Array.isArray(data[key])) {
        for (const item of data[key].slice(0, 10)) {
          if (item && typeof item === 'object' && (item.url || item.link)) {
            results.push({
              title: item.title || item.name || 'Untitled',
              url: item.url || item.link || '',
              description: item.description || item.snippet || '',
              snippet: item.snippet || '',
            });
          }
        }
        if (results.length > 0) break;
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    results: deduped,
    total: deduped.length,
    query,
  };
}

/**
 * Format search results as a readable markdown string for agent consumption.
 */
export function formatSearchResults(response: YouComSearchResponse): string {
  if (response.results.length === 0) {
    return `No results found for: "${response.query}"\n`;
  }

  const lines = [
    `## 🔍 Web Search Results: "${response.query}"`,
    `Found ${response.total} result(s)\n`,
  ];

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    lines.push(`${i + 1}. **[${r.title}](${r.url})**`);
    if (r.description) {
      lines.push(`   ${r.description}`);
    }
    if (r.snippet && r.snippet !== r.description) {
      lines.push(`   > ${r.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
