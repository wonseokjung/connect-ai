// 🔌 MCP 클라이언트 — 원격(HTTP/SSE) 또는 로컬(stdio) MCP 서버에 붙어 도구를 에이전트에 노출.
//   설정 형식은 Cursor/Antigravity 와 동일: { "mcpServers": { "stitch": { "url": "...", "headers": {...} } } }
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpServerCfg { url?: string; serverUrl?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string>; disabled?: boolean; }

let SERVERS: Record<string, McpServerCfg> = {};
const clients: Record<string, { client: any; tools: any[] }> = {};

export function setMcpConfig(cfg: any) {
  SERVERS = (cfg && cfg.mcpServers) ? cfg.mcpServers : (cfg && typeof cfg === 'object' ? cfg : {});
}

async function connectOne(name: string, s: McpServerCfg): Promise<{ client: any; tools: any[] } | null> {
  try {
    const client = new Client({ name: 'connect-ai-desktop', version: '0.1.0' }, { capabilities: {} });
    const url = s.url || s.serverUrl;
    if (url) {
      const opts: any = s.headers ? { requestInit: { headers: s.headers } } : {};
      try { await client.connect(new StreamableHTTPClientTransport(new URL(url), opts)); }
      catch { await client.connect(new SSEClientTransport(new URL(url), opts)); }
    } else if (s.command) {
      await client.connect(new StdioClientTransport({ command: s.command, args: s.args || [], env: { ...process.env, ...(s.env || {}) } as any }));
    } else return null;
    const list = await client.listTools();
    return { client, tools: list.tools || [] };
  } catch { return null; }
}

export async function ensureConnected(): Promise<void> {
  for (const [name, s] of Object.entries(SERVERS)) {
    if (s.disabled || clients[name]) continue;
    const c = await connectOne(name, s); if (c) clients[name] = c;
  }
}

export async function listMcpTools(): Promise<{ server: string; name: string; description: string; schema: any }[]> {
  try { await ensureConnected(); } catch { /* */ }
  const out: any[] = [];
  for (const [name, c] of Object.entries(clients)) for (const t of c.tools) out.push({ server: name, name: t.name, description: t.description || '', schema: t.inputSchema });
  return out;
}

export async function callMcpTool(server: string, tool: string, args: any): Promise<string> {
  let c = clients[server];
  if (!c && SERVERS[server]) { const nc = await connectOne(server, SERVERS[server]); if (nc) c = clients[server] = nc; }
  if (!c) return `(MCP 서버 '${server}' 미연결)`;
  try {
    const r: any = await c.client.callTool({ name: tool, arguments: args || {} });
    const text = (r.content || []).map((x: any) => x?.type === 'text' ? x.text : JSON.stringify(x)).join('\n');
    return (text || '(빈 응답)').slice(0, 6000);
  } catch (e: any) { return `(MCP 호출 실패: ${e?.message || e})`; }
}

// 설정 화면용 — 각 서버 연결 테스트 + 도구 수
export async function testMcp(): Promise<{ name: string; ok: boolean; tools: number; toolNames: string[]; error?: string }[]> {
  const res: any[] = [];
  for (const [name, s] of Object.entries(SERVERS)) {
    if (s.disabled) { res.push({ name, ok: false, tools: 0, toolNames: [], error: '비활성' }); continue; }
    delete clients[name];
    const c = await connectOne(name, s);
    if (c) { clients[name] = c; res.push({ name, ok: true, tools: c.tools.length, toolNames: c.tools.map((t: any) => t.name).slice(0, 12) }); }
    else res.push({ name, ok: false, tools: 0, toolNames: [], error: '연결 실패 (URL/헤더/명령 확인)' });
  }
  return res;
}
