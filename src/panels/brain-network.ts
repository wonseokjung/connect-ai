/* panels/brain-network.ts — 지식 그래프 빌더 + 그래프 웹뷰 HTML 렌더.
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: fs·path + company/company(COMPANY_INTERNAL_DIRS).
 * 순수 로직만 분리 — vscode 패널을 띄우는 showBrainNetwork() 는 _activeChatProvider
 * 싱글톤을 참조하므로 extension.ts 에 남기고, 여기서 buildKnowledgeGraph·_RENDER_GRAPH_HTML 만 가져다 쓴다.
 * buildKnowledgeGraph·_RENDER_GRAPH_HTML 은 ThinkingPanel 등에서도 재사용된다. */
import * as fs from 'fs';
import * as path from 'path';
import { COMPANY_INTERNAL_DIRS } from '../company/company';

// Knowledge Graph Builder — REAL connections (not random!)
// Parses [[wikilinks]], markdown links, and #tags from .md files
// to build a true semantic graph of the user's brain.
// ============================================================
export interface BrainNode {
    id: string;            // relative path inside brainDir
    name: string;          // display name (basename without .md)
    folder: string;        // top-level folder (for color clustering)
    tags: string[];
    incoming: number;      // backlink count (for size)
    outgoing: number;
    mtime: number;         // last modified time (for memory decay/hotness)
}
export interface BrainLink {
    source: string;
    target: string;
    type: 'wikilink' | 'mdlink' | 'tag' | 'semantic';
}
export interface BrainGraph {
    nodes: BrainNode[];
    links: BrainLink[];
    tags: string[];        // all unique tags found
}

export function buildKnowledgeGraph(brainDir: string): BrainGraph {
    const nodes: BrainNode[] = [];
    const nodeByPath = new Map<string, BrainNode>();
    const nodeByBasename = new Map<string, BrainNode[]>();
    const links: BrainLink[] = [];
    const tagSet = new Set<string>();
    let scanned = 0;

    if (!fs.existsSync(brainDir)) return { nodes, links, tags: [] };

    // --- Pass 1: collect all .md files as nodes ---
    function walk(dir: string) {
        if (scanned >= 1000) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            if (COMPANY_INTERNAL_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.isFile() || !full.endsWith('.md')) continue;
            const rel = path.relative(brainDir, full);
            const base = e.name.replace(/\.md$/i, '');
            const parts = rel.split(path.sep);
            const folder = parts.length > 1 ? parts[0] : '_root';
            let mtime = 0;
            try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
            const node: BrainNode = { id: rel, name: base, folder, tags: [], incoming: 0, outgoing: 0, mtime };
            nodes.push(node);
            nodeByPath.set(rel, node);
            const list = nodeByBasename.get(base.toLowerCase()) || [];
            list.push(node);
            nodeByBasename.set(base.toLowerCase(), list);
            scanned++;
        }
    }
    walk(brainDir);

    // --- Pass 2: parse each file for links + tags ---
    const wikilinkRe = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
    const mdlinkRe = /\[[^\]]+\]\(([^)]+\.md)\)/gi;
    const tagRe = /(?:^|[\s>(])#([A-Za-z가-힣0-9_-]{2,40})/g;

    function resolveLink(target: string, fromNode: BrainNode): BrainNode | null {
        const cleaned = target.trim().replace(/^\.\//, '').replace(/\\/g, '/');
        // Try exact relative path match (with or without .md)
        const exact = cleaned.endsWith('.md') ? cleaned : cleaned + '.md';
        if (nodeByPath.has(exact)) return nodeByPath.get(exact)!;
        // Try resolved relative to source file's folder
        const fromDir = path.dirname(fromNode.id);
        const joined = path.normalize(path.join(fromDir, exact));
        if (nodeByPath.has(joined)) return nodeByPath.get(joined)!;
        // Fall back to basename match (Obsidian style)
        const base = path.basename(cleaned, '.md').toLowerCase();
        const matches = nodeByBasename.get(base) || [];
        if (matches.length === 0) return null;
        // Prefer same-folder match if multiple
        if (matches.length > 1) {
            const sameFolder = matches.find(m => path.dirname(m.id) === fromDir);
            if (sameFolder) return sameFolder;
        }
        return matches[0];
    }

    for (const node of nodes) {
        let content: string;
        try { content = fs.readFileSync(path.join(brainDir, node.id), 'utf-8').slice(0, 200_000); }
        catch { continue; }

        // Wikilinks → real edges
        let m: RegExpExecArray | null;
        wikilinkRe.lastIndex = 0;
        while ((m = wikilinkRe.exec(content)) !== null) {
            const target = resolveLink(m[1], node);
            if (target && target.id !== node.id) {
                links.push({ source: node.id, target: target.id, type: 'wikilink' });
                node.outgoing++;
                target.incoming++;
            }
        }

        // Markdown links → real edges
        mdlinkRe.lastIndex = 0;
        while ((m = mdlinkRe.exec(content)) !== null) {
            // Skip external URLs
            if (/^https?:\/\//i.test(m[1])) continue;
            const target = resolveLink(m[1], node);
            if (target && target.id !== node.id) {
                links.push({ source: node.id, target: target.id, type: 'mdlink' });
                node.outgoing++;
                target.incoming++;
            }
        }

        // Tags
        tagRe.lastIndex = 0;
        const localTags = new Set<string>();
        while ((m = tagRe.exec(content)) !== null) {
            localTags.add(m[1]);
        }
        node.tags = [...localTags];
        localTags.forEach(t => tagSet.add(t));
    }

    // --- Pass 2.5: Semantic Implicit Links (Brain Pattern Recognition) ---
    // If a document mentions another document's exact basename (and it's >= 2 chars), create a semantic link.
    const validBasenames = nodes.filter(n => n.name.length >= 2);
    for (const node of nodes) {
        let content: string;
        try { content = fs.readFileSync(path.join(brainDir, node.id), 'utf-8').slice(0, 100_000); }
        catch { continue; }
        // Fast plain-text match
        const contentLower = content.toLowerCase();
        for (const target of validBasenames) {
            if (target.id === node.id) continue;
            // Prevent overly broad matching (e.g. matching "it" or "at") by checking word boundaries
            // We use simple substring check first for performance, then regex for word boundary
            const targetLower = target.name.toLowerCase();
            if (contentLower.includes(targetLower)) {
                // Confirm with boundaries if alphabet
                const isAlpha = /^[a-z]+$/.test(targetLower);
                if (isAlpha) {
                    const regex = new RegExp(`\\b${targetLower}\\b`, 'i');
                    if (!regex.test(content)) continue;
                }
                links.push({ source: node.id, target: target.id, type: 'semantic' });
                // We don't increment incoming/outgoing for semantic links to keep sizes strictly based on explicit structure
            }
        }
    }

    // --- Pass 3: tag co-occurrence edges (cap to top 8 tags to avoid explosion) ---
    const tagToNodes = new Map<string, BrainNode[]>();
    for (const node of nodes) {
        for (const t of node.tags) {
            const list = tagToNodes.get(t) || [];
            list.push(node);
            tagToNodes.set(t, list);
        }
    }
    const topTags = [...tagToNodes.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8);
    for (const [, nodesWithTag] of topTags) {
        if (nodesWithTag.length < 2 || nodesWithTag.length > 25) continue;
        for (let i = 0; i < nodesWithTag.length; i++) {
            for (let j = i + 1; j < nodesWithTag.length; j++) {
                links.push({ source: nodesWithTag[i].id, target: nodesWithTag[j].id, type: 'tag' });
            }
        }
    }

    // De-duplicate links (a→b and b→a counted once)
    const seen = new Set<string>();
    const dedup: BrainLink[] = [];
    for (const l of links) {
        const key = l.source < l.target ? `${l.source}|${l.target}|${l.type}` : `${l.target}|${l.source}|${l.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(l);
    }

    return { nodes, links: dedup, tags: [...tagSet] };
}


/** Returns the full graph webview HTML. Reused by showBrainNetwork + ThinkingPanel. */
export function _RENDER_GRAPH_HTML(graphJson: string, isEmpty: boolean, forceGraphSrc: string, cspSource: string): string {
    // NOTE: force-graph.min.js is loaded as an external script (not inlined).
    // Inlining via template literal corrupts the bundle because the minified
    // library contains `${...}` sequences that get evaluated as template parts.
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <title>Connect AI — 지식 네트워크</title>
  <style>
    body { margin: 0; padding: 0; background: #131419; overflow: hidden; width: 100vw; height: 100vh; font-family: 'SF Pro Display', -apple-system, sans-serif; color: #d8d9de; }
    /* Subtle vignette behind the canvas — z-index -1 so it never obscures nodes */
    body::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: -1;
      background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.55) 100%); }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; max-width: 60%; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 700; letter-spacing: -0.4px; color: #e8e9ee; }
    #ui-layer h1 span { color: #5DE0E6; text-shadow: 0 0 14px rgba(93,224,230,.45); }
    #stats { color: #6c6e78; font-family: 'SF Mono', monospace; font-size: 11px; margin-top: 2px; letter-spacing: .2px; }
    #legend { position: absolute; top: 20px; right: 24px; z-index: 10; background: rgba(20,21,28,.78); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 12px 14px; font-size: 11px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
    #legend .row { display: flex; align-items: center; gap: 8px; margin: 4px 0; color: #9094a0; }
    #legend .swatch { width: 18px; height: 2px; border-radius: 1px; }
    #legend .row.synapse .swatch { box-shadow: 0 0 6px #5DE0E6; }
    #empty { position: absolute; inset: 0; display: ${isEmpty ? 'flex' : 'none'}; flex-direction: column; align-items: center; justify-content: center; color: #555; font-size: 14px; gap: 10px; pointer-events: none; }
    #empty .big { font-size: 22px; color: #888; }
    #tooltip { position: absolute; pointer-events: none; background: rgba(20,21,28,.95); border: 1px solid rgba(93,224,230,.28); border-radius: 10px; padding: 10px 13px; font-size: 12px; color: #e0e2e8; box-shadow: 0 8px 32px rgba(93,224,230,.12), 0 4px 12px rgba(0,0,0,.5); display: none; z-index: 20; max-width: 260px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    #tooltip .t-name { font-weight: 700; color: #5DE0E6; margin-bottom: 4px; letter-spacing: .1px; }
    #tooltip .t-meta { color: #7c7f8a; font-size: 10px; font-family: 'SF Mono', monospace; }
    #tooltip .t-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    #tooltip .t-tag { background: rgba(93,224,230,.08); color: #5DE0E6; padding: 2px 7px; border-radius: 8px; font-size: 9px; border: 1px solid rgba(93,224,230,.2); }
    #graph { position: absolute; inset: 0; width: 100vw; height: 100vh; z-index: 0; }
    canvas { cursor: grab; }
    canvas:active { cursor: grabbing; }
    /* Search/filter bar — toggle with the slash key */
    #search-bar { position: absolute; top: 64px; left: 24px; z-index: 12;
      background: rgba(20,21,28,.92); border: 1px solid rgba(93,224,230,.32);
      border-radius: 10px; padding: 6px 10px;
      display: none; align-items: center; gap: 8px;
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 8px 32px rgba(0,0,0,.4), 0 0 16px rgba(93,224,230,.08);
      min-width: 260px; max-width: 380px; }
    #search-bar.active { display: flex; animation: searchSlideIn .25s cubic-bezier(.16,1,.3,1); }
    @keyframes searchSlideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    #search-input { background: transparent; border: 0; outline: 0;
      color: #e8e9ee; font-size: 13px; font-family: 'SF Pro Display', -apple-system, sans-serif;
      flex: 1; padding: 4px 0; min-width: 0; }
    #search-input::placeholder { color: #5a5d68; }
    #search-count { color: #5DE0E6; font-size: 11px; font-family: 'SF Mono', monospace; white-space: nowrap; }
    #search-count.zero { color: #FFB266; }
    /* Legend folder chips + toggles */
    #legend .folders { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); display: flex; flex-direction: column; gap: 3px; max-height: 180px; overflow-y: auto; }
    #legend .folder-row { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: #9094a0; }
    #legend .folder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    #legend .folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #legend .folder-count { color: #5a5d68; font-family: 'SF Mono', monospace; font-size: 9px; }
    #legend .toggle-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.06); display: flex; align-items: center; gap: 8px; font-size: 11px; color: #9094a0; cursor: pointer; user-select: none; }
    #legend .toggle-row:hover { color: #d8d9de; }
    #legend .toggle-row .switch { width: 22px; height: 12px; border-radius: 7px; background: #2a2a30; position: relative; transition: background .2s; flex-shrink: 0; }
    #legend .toggle-row .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: #888; transition: left .2s, background .2s; }
    #legend .toggle-row.on .switch { background: rgba(93,224,230,.4); }
    #legend .toggle-row.on .switch::after { left: 12px; background: #5DE0E6; }
    /* Thinking Mode — neural HUD */
    #thinking-overlay { position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 15;
      background: linear-gradient(180deg, rgba(18,22,32,.94), rgba(12,15,22,.92));
      border: 1px solid rgba(93,224,230,.30); border-radius: 16px;
      padding: 16px 22px 14px; font-size: 13px; color: #e0e2e8;
      backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%);
      box-shadow: 0 16px 56px rgba(0,0,0,.55), 0 0 0 1px rgba(93,224,230,.06) inset, 0 24px 64px rgba(93,224,230,.10);
      display: none; min-width: 360px; max-width: 620px; overflow: hidden;
    }
    #thinking-overlay::before { content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background: linear-gradient(90deg, transparent, rgba(93,224,230,.65), transparent);
      animation: scanLine 2.4s ease-in-out infinite;
    }
    @keyframes scanLine { 0% { transform: translateX(-30%); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateX(30%); opacity: 0; } }
    #thinking-overlay.active { display: block; animation: slideUp .5s cubic-bezier(.16,1,.3,1); }
    @keyframes slideUp { from { opacity: 0; transform: translate(-50%, 24px); } to { opacity: 1; transform: translate(-50%, 0); } }
    #thinking-overlay .phases { display: flex; flex-direction: column; gap: 2px; position: relative; }
    /* Vertical connector line linking the three phase dots */
    #thinking-overlay .phases::before { content: ''; position: absolute;
      left: 9px; top: 14px; bottom: 14px; width: 1px;
      background: linear-gradient(180deg, rgba(93,224,230,.10), rgba(255,178,102,.10));
    }
    #thinking-overlay .phase { display: flex; align-items: center; gap: 12px; padding: 5px 0; opacity: .38;
      transition: opacity .35s ease, color .35s ease, transform .35s ease; font-size: 12.5px; letter-spacing: .1px;
      position: relative;
    }
    #thinking-overlay .phase .icon {
      width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
      background: rgba(40,44,56,.7); border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(255,255,255,.06) inset;
      font-size: 11px; flex-shrink: 0; transition: background .35s ease, box-shadow .35s ease, transform .35s ease;
      position: relative; z-index: 1;
    }
    #thinking-overlay .phase .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #thinking-overlay .phase.active { opacity: 1; color: #5DE0E6; }
    #thinking-overlay .phase.active .icon {
      background: radial-gradient(circle, rgba(93,224,230,.45), rgba(93,224,230,.10));
      box-shadow: 0 0 0 1px rgba(93,224,230,.55) inset, 0 0 14px rgba(93,224,230,.55);
      animation: phasePulse 1.4s ease-in-out infinite;
    }
    @keyframes phasePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    #thinking-overlay .phase.done { opacity: .8; color: #FFB266; }
    #thinking-overlay .phase.done .icon {
      background: radial-gradient(circle, rgba(255,178,102,.30), rgba(255,178,102,.05));
      box-shadow: 0 0 0 1px rgba(255,178,102,.40) inset;
    }
    #thinking-overlay .answer-preview { margin-top: 12px; padding: 10px 12px;
      background: rgba(93,224,230,.04); border: 1px solid rgba(93,224,230,.10); border-radius: 8px;
      font-size: 11.5px; color: #b8bac4; max-height: 64px; overflow: hidden; line-height: 1.55;
      font-family: 'SF Mono', 'JetBrains Mono', monospace; letter-spacing: .15px;
    }
    body.thinking::before { content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse at center, rgba(93,224,230,.07), transparent 60%);
      pointer-events: none; z-index: 1; animation: thinkingPulse 3.2s ease-in-out infinite;
    }
    @keyframes thinkingPulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
  </style>
  <script src="${forceGraphSrc}"></script>
</head>
<body>
  <div id="ui-layer">
    <h1>✦ <span id="titleSpan">지식 네트워크</span></h1>
    <p id="stats">로딩 중...</p>
  </div>
  <div id="thinking-overlay">
    <div class="phases">
      <div class="phase" id="phase-context"><span class="icon">📂</span><span class="text">컨텍스트 모으는 중...</span></div>
      <div class="phase" id="phase-brain"><span class="icon">🧠</span><span class="text">관련 노트 찾는 중...</span></div>
      <div class="phase" id="phase-answer"><span class="icon">✍️</span><span class="text">답변 생성 중...</span></div>
    </div>
    <div class="answer-preview" id="answer-preview" style="display:none"></div>
  </div>
  <div id="legend">
    <div class="folders" id="folders-list"></div>
  </div>
  <div id="empty">
    <div class="big">📂 아직 지식이 없어요</div>
    <div>지식 폴더에 .md 파일을 넣고 다시 열어주세요</div>
    <div style="font-size:10px;color:#444">팁: <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px">[[다른노트]]</code> 형식으로 링크하면 자동 연결됩니다</div>
  </div>
  <div id="search-bar">
    <span style="color:#5DE0E6;font-size:13px">⌕</span>
    <input id="search-input" type="text" placeholder="이름·태그·폴더 검색  (ESC로 닫기)" autocomplete="off" spellcheck="false" />
    <span id="search-count"></span>
  </div>
  <div id="graph"></div>
  <div id="tooltip"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const data = ${graphJson};
    const tooltip = document.getElementById('tooltip');

    // Folder palette — Obsidian-style desaturated tones, optimized for dark canvas.
    const PALETTE = ['#7DA8E6','#8FD3A8','#E89B6E','#C28BE5','#E5C07B','#7FCBC0','#E68FB0','#A8B2D1','#9DC4A0','#D9A89B'];
    const folders = [...new Set(data.nodes.map(n => n.folder))].sort();
    const folderColor = {};
    folders.forEach((f, i) => { folderColor[f] = PALETTE[i % PALETTE.length]; });

    // Edge color by type — softer, more "neural" (cyan synapse / lilac bridge / faint tag mist)
    const EDGE_COLOR = {
      wikilink: 'rgba(125,200,232,0.55)',
      mdlink:   'rgba(168,155,217,0.40)',
      tag:      'rgba(180,180,200,0.10)',
      semantic: 'rgba(93,224,230,0.15)' // Faint cyan for implicit brain connections
    };
    const EDGE_WIDTH = { wikilink: 1.2, mdlink: 0.9, tag: 0.4, semantic: 0.6 };
    // Active synapse color used during thinking
    const SYNAPSE = '#5DE0E6';   // electric cyan — "fired" feeling
    const TRAIL   = '#FFB266';   // warm amber — "this knowledge was used"

    document.getElementById('stats').textContent =
      data.nodes.length + ' 지식 · ' + data.links.length + ' 연결 · ' + folders.length + ' 폴더';

    // ── Folder chip list in legend (informational; folder→color mapping) ──
    (() => {
      const el = document.getElementById('folders-list');
      if (!el) return;
      const counts = {};
      data.nodes.forEach(n => { counts[n.folder] = (counts[n.folder] || 0) + 1; });
      folders.forEach(f => {
        const row = document.createElement('div');
        row.className = 'folder-row';
        const dot = document.createElement('div');
        dot.className = 'folder-dot';
        dot.style.background = folderColor[f] || '#888';
        const name = document.createElement('div');
        name.className = 'folder-name';
        name.textContent = f || '/';
        const count = document.createElement('div');
        count.className = 'folder-count';
        count.textContent = counts[f] || 0;
        row.appendChild(dot); row.appendChild(name); row.appendChild(count);
        el.appendChild(row);
      });
    })();

    // ── Orphan-hide toggle ──
    let hideOrphans = false;
    const orphanToggleEl = document.getElementById('toggle-orphans');
    orphanToggleEl?.addEventListener('click', () => {
      hideOrphans = !hideOrphans;
      orphanToggleEl.classList.toggle('on', hideOrphans);
      // Trigger a layout/render refresh
      Graph.nodeVisibility(Graph.nodeVisibility());
    });

    let hoverNode = null;
    let highlightNodes = new Set();
    let highlightLinks = new Set();

    function applyHighlight(node) {
      highlightNodes = new Set();
      highlightLinks = new Set();
      if (!node) return;
      highlightNodes.add(node.id);
      data.links.forEach(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (sId === node.id || tId === node.id) {
          highlightLinks.add(l);
          highlightNodes.add(sId);
          highlightNodes.add(tId);
        }
      });
    }

    // Compute node radius — Obsidian-style hierarchy + Recency (Hotness)
    // Hubs (many connections) get noticeably larger.
    // Recently modified nodes get a "hotness" bump.
    const now = Date.now();
    function nodeRadius(n) {
      const c = n.connections;
      let r = 3.5;
      if (c > 0 && c <= 2) r = 5.5;                                  // leaf
      else if (c > 2 && c <= 5) r = 8 + Math.log2(c) * 0.8;          // mid
      else if (c > 5) r = Math.min(22, 11 + Math.log2(c) * 2.2);     // hub
      
      // Memory decay / Hotness: files modified in the last 24 hours get slightly larger
      if (n.mtime && (now - n.mtime < 86400000)) {
         // linearly scale bump based on recency within 24 hours
         const ageRatio = (now - n.mtime) / 86400000;
         r += 2 * (1 - ageRatio);
      }
      return r;
    }
    function isHub(n) { return n.connections > 5; }
    // Precompute neighbor map — used for synapse highlights when a node is "fired"
    const neighborsOf = {};
    data.nodes.forEach(n => { neighborsOf[n.id] = new Set(); });
    data.links.forEach(l => {
      const sId = (l.source && l.source.id) || l.source;
      const tId = (l.target && l.target.id) || l.target;
      if (neighborsOf[sId]) neighborsOf[sId].add(tId);
      if (neighborsOf[tId]) neighborsOf[tId].add(sId);
    });

    // ── Thinking-mode state — must be declared BEFORE Graph creation
    // because force-graph invokes linkColor/linkDirectionalParticles
    // synchronously during .graphData() and would otherwise hit TDZ.
    const thinkingActive = new Set();          // node ids currently being read (electric cyan)
    const thinkingAdjacent = new Set();        // 1-hop neighbors of active nodes (faint glow)
    const thinkingDoneOrder = new Map();       // node id → 1-based usage index (warm amber trail)
    let thinkingDoneCounter = 0;
    let thinkPulseTime = 0;
    const nodeById = {};
    data.nodes.forEach(n => { nodeById[n.id] = n; });
    function recomputeAdjacent() {
      thinkingAdjacent.clear();
      thinkingActive.forEach(id => {
        (neighborsOf[id] || new Set()).forEach(n => { if (!thinkingActive.has(n)) thinkingAdjacent.add(n); });
      });
    }
    function markDone(id) {
      if (!thinkingDoneOrder.has(id)) thinkingDoneOrder.set(id, ++thinkingDoneCounter);
    }
    function clearThinkingTrail() {
      thinkingActive.clear();
      thinkingAdjacent.clear();
      thinkingDoneOrder.clear();
      thinkingDoneCounter = 0;
    }

    const Graph = ForceGraph()(document.getElementById('graph'))
      .width(window.innerWidth)
      .height(window.innerHeight)
      .backgroundColor('#0a0a0a')
      .graphData(data)
      .nodeId('id')
      .nodeVal(n => nodeRadius(n) * 0.6)
      .nodeCanvasObject((node, ctx, globalScale) => {
        // (NOTE: this is the base renderer; thinking-mode renderer below overrides it.)
        renderNode(node, ctx, globalScale);
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        const r = nodeRadius(node) + 6;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color; ctx.fill();
      })
      .linkColor(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        const isSynapse = thinkingActive.has(sId) || thinkingActive.has(tId);
        const isTrail   = thinkingDoneOrder.has(sId) && thinkingDoneOrder.has(tId);
        if (isSynapse) return 'rgba(93,224,230,0.85)';
        if (isTrail)   return 'rgba(255,178,102,0.55)';
        if (highlightLinks.size > 0 && !highlightLinks.has(l)) return 'rgba(60,60,70,0.10)';
        return EDGE_COLOR[l.type] || 'rgba(255,255,255,0.08)';
      })
      .linkWidth(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        const isSynapse = thinkingActive.has(sId) || thinkingActive.has(tId);
        const isTrail   = thinkingDoneOrder.has(sId) && thinkingDoneOrder.has(tId);
        if (isSynapse) return 2.4;
        if (isTrail)   return 1.6;
        return highlightLinks.has(l) ? (EDGE_WIDTH[l.type] || 1) * 2 : (EDGE_WIDTH[l.type] || 1);
      })
      // Every link breathes a slow particle — synapse-active ones fire faster + brighter
      .linkDirectionalParticles(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (thinkingActive.has(sId) || thinkingActive.has(tId)) return 4;
        if (l.type === 'wikilink') return 2;
        if (l.type === 'mdlink')   return 1;
        return 0; // tag links stay quiet
      })
      .linkDirectionalParticleWidth(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        return (thinkingActive.has(sId) || thinkingActive.has(tId)) ? 2.4 : 1.4;
      })
      .linkDirectionalParticleSpeed(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        return (thinkingActive.has(sId) || thinkingActive.has(tId)) ? 0.018 : 0.005;
      })
      .linkDirectionalParticleColor(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (thinkingActive.has(sId) || thinkingActive.has(tId)) return SYNAPSE;
        return EDGE_COLOR[l.type] || '#7DA8E6';
      })
      .nodeVisibility(n => !(hideOrphans && n.connections === 0))
      .d3VelocityDecay(0.25)
      .warmupTicks(120)
      .cooldownTicks(1200)
      .onNodeHover(node => {
        hoverNode = node || null;
        // Sticky selection / active search win — when either is pinning the
        // highlight set, hover doesn't disturb it (Obsidian-style behavior).
        if (!stickyNode && !(searchActive && searchInput.value)) applyHighlight(hoverNode);
        document.body.style.cursor = node ? 'pointer' : 'grab';
        if (node) {
          tooltip.style.display = 'block';
          const tagsHtml = (node.tags || []).slice(0, 5).map(t => '<span class="t-tag">#' + t + '</span>').join('');
          tooltip.innerHTML =
            '<div class="t-name">' + (node.name || '(이름 없음)') + '</div>' +
            '<div class="t-meta">' + (node.folder || '/') + ' · ' + (node.connections || 0) + '개 연결</div>' +
            (tagsHtml ? '<div class="t-tags">' + tagsHtml + '</div>' : '');
        } else {
          tooltip.style.display = 'none';
        }
      })
      .onNodeRightClick(node => {
        vscode.postMessage({ type: 'openFile', id: node.id });
      });

    // ── Sticky selection (Obsidian signature behavior) ──
    // Single click → pin a node + its 1-hop neighbors as the highlight set
    //                (everything else dims).
    // Same node clicked again → unpin.
    // Different node clicked → repin.
    // Double-click → open file.
    // Background click → unpin.
    let stickyNode = null;
    function pinNode(node) {
      stickyNode = node;
      applyHighlight(node);
    }
    function unpinNode() {
      stickyNode = null;
      applyHighlight(hoverNode);  // fall back to hover state if any
    }

    let lastClick = { id: null, t: 0 };
    Graph.onNodeClick(node => {
      // Click during active search → close the search panel and act as a normal pin
      if (searchActive) closeSearch();
      const now = Date.now();
      if (lastClick.id === node.id && now - lastClick.t < 400) {
        // Double-click on the same node → open file
        vscode.postMessage({ type: 'openFile', id: node.id });
        lastClick = { id: null, t: 0 };
        return;
      }
      lastClick = { id: node.id, t: now };

      if (stickyNode && stickyNode.id === node.id) {
        unpinNode();
      } else {
        pinNode(node);
        Graph.centerAt(node.x, node.y, 600);
        Graph.zoom(3, 800);
      }
    });

    let lastBgClickT = 0;
    Graph.onBackgroundClick(() => {
      const now = Date.now();
      if (now - lastBgClickT < 400) {
        // Background double-click → reset zoom to fit the whole graph
        Graph.zoomToFit(800, 60);
        lastBgClickT = 0;
        return;
      }
      lastBgClickT = now;
      if (searchActive) closeSearch();
      else if (stickyNode) unpinNode();
    });

    // -- Search/filter bar (slash to open, ESC to close) --
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    let searchActive = false;
    function openSearch() {
      searchActive = true;
      searchBar.classList.add('active');
      searchInput.focus();
      searchInput.select();
    }
    function closeSearch() {
      searchActive = false;
      searchBar.classList.remove('active');
      searchInput.value = '';
      searchCount.textContent = '';
      searchCount.classList.remove('zero');
      // Restore prior state (sticky pin or current hover)
      applyHighlight(stickyNode || hoverNode);
    }
    function runSearch(q) {
      q = q.trim().toLowerCase();
      if (!q) {
        searchCount.textContent = '';
        searchCount.classList.remove('zero');
        applyHighlight(stickyNode || hoverNode);
        return;
      }
      const matches = new Set();
      data.nodes.forEach(n => {
        const hay = ((n.name || '') + ' ' + (n.folder || '') + ' ' +
                     (n.tags || []).map(t => '#' + t).join(' ')).toLowerCase();
        if (hay.includes(q)) matches.add(n.id);
      });
      searchCount.textContent = matches.size + '개';
      searchCount.classList.toggle('zero', matches.size === 0);
      if (matches.size === 0) {
        // Don't dim the whole graph for zero results — feels punishing
        highlightNodes = new Set(); highlightLinks = new Set();
        return;
      }
      highlightNodes = new Set(matches);
      highlightLinks = new Set();
      data.links.forEach(l => {
        const sId = (l.source && l.source.id) || l.source;
        const tId = (l.target && l.target.id) || l.target;
        if (matches.has(sId) && matches.has(tId)) highlightLinks.add(l);
      });
    }
    searchInput.addEventListener('input', () => runSearch(searchInput.value));
    document.addEventListener('keydown', (e) => {
      if (e.target === searchInput) {
        if (e.key === 'Escape') { closeSearch(); e.preventDefault(); }
        return;
      }
      if (e.key === '/' && !searchActive) {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'Escape' && searchActive) {
        closeSearch();
      }
    });

    // Force tuning: hubs repel more, semantic links are gentle.
    const sparseFactor = Math.max(0.4, Math.min(1, data.links.length / Math.max(1, data.nodes.length)));
    Graph.d3Force('charge').strength(n => -50 - 25 * sparseFactor - (isHub(n) ? 60 : 0));
    Graph.d3Force('link')
      .distance(l => l.type === 'tag' ? 90 : l.type === 'semantic' ? 70 : l.type === 'mdlink' ? 50 : 36)
      .strength(l => l.type === 'tag' ? 0.15 : l.type === 'semantic' ? 0.25 : l.type === 'mdlink' ? 0.5 : 0.85);
    if (typeof window.d3 !== 'undefined' && window.d3.forceCenter) {
      Graph.d3Force('center', window.d3.forceCenter(0, 0).strength(0.06));
    }

    // Tooltip follow mouse
    document.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });

    // Initial framing: the force simulation needs time to spread nodes from
    // their origin spawn before zoomToFit can frame anything meaningful. Doing
    // it too early frames a tiny clump → zooms way in → nodes then explode
    // outward off-screen. We wait for the engine to actually settle, with one
    // safety fit as a fallback if cooldown is unusually long.
    const zoomPad = data.nodes.length < 10 ? 120 : data.nodes.length < 30 ? 90 : 60;
    let _initialFitDone = false;
    function _initialFit(duration) {
      if (_initialFitDone) return;
      _initialFitDone = true;
      try { Graph.zoomToFit(duration, zoomPad); } catch (e) {}
      const ts = document.getElementById('titleSpan'); if (ts) ts.innerText = '지식 네트워크 · LIVE';
    }
    // Authoritative fit — fires once the layout has fully settled.
    Graph.onEngineStop(() => _initialFit(900));
    // Safety net: if the engine never reports stop (rare, but possible with
    // very large graphs or external re-heats), frame what we have at ~2.5s.
    setTimeout(() => _initialFit(1100), 2500);

    window.addEventListener('resize', () => {
      Graph.width(window.innerWidth).height(window.innerHeight);
    });

    // ============================================================
    // 🎬 THINKING MODE — receive realtime events from chat extension
    // ============================================================
    const thinkingOverlay = document.getElementById('thinking-overlay');
    const phaseContext = document.getElementById('phase-context');
    const phaseBrain = document.getElementById('phase-brain');
    const phaseAnswer = document.getElementById('phase-answer');
    const answerPreview = document.getElementById('answer-preview');

    // Map basename → node for fast lookup when AI sends "read this brain note"
    const nodesByBasename = {};
    data.nodes.forEach(n => {
      const k = n.name.toLowerCase();
      nodesByBasename[k] = nodesByBasename[k] || [];
      nodesByBasename[k].push(n);
    });
    function findNodeForReadRequest(req) {
      if (typeof req !== 'string' || !req) return null;
      // Try by exact id first
      const direct = data.nodes.find(n => n.id === req || n.id === req + '.md');
      if (direct) return direct;
      // Then by basename match
      const base = (req.split(/[\\\\/]/).pop() || '').replace(/\\.md$/i, '').toLowerCase();
      const matches = nodesByBasename[base];
      return matches && matches.length > 0 ? matches[0] : null;
    }

    // (thinkingActive / thinkingAdjacent / thinkingDone / recomputeAdjacent
    //  were hoisted above the Graph constructor to avoid TDZ when force-graph
    //  invokes link callbacks synchronously during .graphData().)

    // Single canonical renderer — Obsidian + brain look, thinking effects layered on top.
    function renderNode(node, ctx, globalScale) {
      // Skip the very first ticks before force-graph has assigned coords —
      // createRadialGradient throws if any value is non-finite.
      if (!isFinite(node.x) || !isFinite(node.y)) return;
      const baseR = Math.max(1, nodeRadius(node) || 0);
      const isHL = highlightNodes.size === 0 || highlightNodes.has(node.id);
      const isActive = thinkingActive.has(node.id);
      const isAdj    = thinkingAdjacent.has(node.id);
      const isDone   = thinkingDoneOrder.has(node.id);
      const isOrphan = node.connections === 0;
      const hub      = isHub(node);
      const color    = folderColor[node.folder] || '#9aa0a6';

      // ── 1. Active synapse halo: pulsing electric cyan ──
      if (isActive) {
        const pulse = 0.5 + 0.5 * Math.sin(thinkPulseTime * 0.09);
        const haloR = baseR * (2.6 + pulse * 0.9);
        const grad = ctx.createRadialGradient(node.x, node.y, baseR, node.x, node.y, haloR);
        grad.addColorStop(0, 'rgba(93,224,230,0.55)');
        grad.addColorStop(0.5, 'rgba(93,224,230,0.20)');
        grad.addColorStop(1,  'rgba(93,224,230,0)');
        ctx.beginPath(); ctx.arc(node.x, node.y, haloR, 0, 2 * Math.PI);
        ctx.fillStyle = grad; ctx.fill();
      }

      // ── 2. Adjacent ghost glow: faint cyan whisper ──
      if (isAdj && !isActive) {
        ctx.beginPath(); ctx.arc(node.x, node.y, baseR * 1.8, 0, 2 * Math.PI);
        const g = ctx.createRadialGradient(node.x, node.y, baseR * 0.6, node.x, node.y, baseR * 1.8);
        g.addColorStop(0, 'rgba(93,224,230,0.22)');
        g.addColorStop(1, 'rgba(93,224,230,0)');
        ctx.fillStyle = g; ctx.fill();
      }

      // ── 3. Ambient glow for hubs / done-trail ──
      const r = isHL ? baseR : baseR * 0.7;
      const ambientColor = isActive ? SYNAPSE : isDone ? TRAIL : color;
      const ambientStrength = isActive ? 'cc' : isDone ? '99' : (hub && isHL ? '88' : (isHL ? '55' : '22'));
      ctx.beginPath(); ctx.arc(node.x, node.y, r + (hub ? 5 : 3), 0, 2 * Math.PI);
      const ambient = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, r + (hub ? 5 : 3));
      ambient.addColorStop(0, ambientColor + ambientStrength);
      ambient.addColorStop(1, ambientColor + '00');
      ctx.fillStyle = ambient; ctx.fill();

      // ── 4. Solid core ──
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      if (isActive) {
        ctx.shadowBlur = 24; ctx.shadowColor = SYNAPSE;
        ctx.fillStyle = SYNAPSE; ctx.fill();
      } else if (isDone) {
        ctx.shadowBlur = 12; ctx.shadowColor = TRAIL;
        ctx.fillStyle = TRAIL; ctx.fill();
      } else if (isOrphan) {
        ctx.fillStyle = '#0a0a0a'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = color + (isHL ? 'a0' : '50'); ctx.stroke();
      } else if (hub && isHL) {
        ctx.shadowBlur = 14; ctx.shadowColor = color;
        ctx.fillStyle = color; ctx.fill();
      } else {
        ctx.fillStyle = isHL ? color : color + '88'; ctx.fill();
      }
      ctx.shadowBlur = 0;

      // ── 5. Zoom-aware label ──
      // Obsidian behavior: only hubs always show; mids appear as you zoom in;
      // leaves only at high zoom. Active/done nodes always show their name.
      const labelMinScale = isActive || isDone ? 0 : hub ? 0 : node.connections >= 2 ? 1.4 : 2.6;
      if (globalScale < labelMinScale) return;

      const fs = isActive || isDone || hub
        ? Math.max(4, Math.min(8, 13 / globalScale + (hub ? 1.5 : 0)))
        : Math.max(3, Math.min(6, 11 / globalScale));
      const fontWeight = isActive ? '700 ' : (hub || isDone) ? '600 ' : '';
      ctx.font = fontWeight + fs + "px -apple-system, 'SF Pro Display', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';

      const dimAlpha = highlightNodes.size > 0 && !isHL ? '40' : '';
      ctx.fillStyle = isActive ? SYNAPSE
                    : isDone   ? TRAIL
                    : hub      ? '#f0f0f0' + dimAlpha
                    :            '#a0a0a8' + dimAlpha;
      // subtle text shadow for active/hub legibility
      if (isActive || isDone) { ctx.shadowBlur = 6; ctx.shadowColor = isActive ? SYNAPSE : TRAIL; }
      ctx.fillText(node.name || '', node.x, node.y + r + 2);
      ctx.shadowBlur = 0;

      // ── 6. Usage-order index chip on cited nodes (1, 2, 3...) ──
      if (isDone) {
        const idx = thinkingDoneOrder.get(node.id);
        if (idx) {
          const chipR = Math.max(4.5, 6 / globalScale);
          const cx = node.x + r + chipR + 1;
          const cy = node.y - r - 1;
          ctx.beginPath(); ctx.arc(cx, cy, chipR, 0, 2 * Math.PI);
          ctx.fillStyle = TRAIL; ctx.fill();
          ctx.lineWidth = 0.6; ctx.strokeStyle = '#131419'; ctx.stroke();
          ctx.fillStyle = '#131419';
          ctx.font = '700 ' + Math.max(5, 7 / globalScale) + "px -apple-system, sans-serif";
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(idx), cx, cy + 0.5);
        }
      }
    }

    // Re-bind renderer (override of the placeholder bound earlier).
    Graph.nodeCanvasObject(renderNode);

    // ── Trail path: dashed amber line connecting cited nodes in usage order ──
    Graph.onRenderFramePost((ctx) => {
      if (thinkingDoneOrder.size < 2) return;
      const ordered = [...thinkingDoneOrder.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => nodeById[id])
        .filter(n => n && isFinite(n.x) && isFinite(n.y));
      if (ordered.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,178,102,0.45)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ordered.forEach((n, i) => {
        if (i === 0) ctx.moveTo(n.x, n.y);
        else ctx.lineTo(n.x, n.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    // Pulse animation tick — drive both thinking pulse and a slow ambient breath.
    setInterval(() => {
      thinkPulseTime++;
      // Force redraw only when there's an active animation to avoid wasted work.
      if (thinkingActive.size > 0 || thinkingAdjacent.size > 0) {
        Graph.nodeRelSize(Graph.nodeRelSize());
      }
    }, 40);

    function setPhase(id, state) {
      const el = document.getElementById('phase-' + id);
      if (!el) return;
      el.classList.remove('active', 'done');
      if (state) el.classList.add(state);
    }

    function showThinkingOverlay() {
      thinkingOverlay.classList.add('active');
      document.body.classList.add('thinking');
    }
    function hideThinkingOverlay() {
      // Keep the thinking trail visible (done nodes stay highlighted) but remove pulse overlay
      document.body.classList.remove('thinking');
      // Auto-hide overlay after a delay so user can see the final state
      setTimeout(() => {
        thinkingOverlay.classList.remove('active');
        thinkingActive.clear();
      }, 6000);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'thinking_start': {
          showThinkingOverlay();
          phaseContext.querySelector('.text').textContent = '컨텍스트 모으는 중...';
          phaseBrain.querySelector('.text').textContent = '관련 노트 찾는 중...';
          phaseAnswer.querySelector('.text').textContent = '답변 생성 중...';
          setPhase('context', 'active'); setPhase('brain', null); setPhase('answer', null);
          answerPreview.style.display = 'none';
          answerPreview.textContent = '';
          clearThinkingTrail();   // fresh session — drop the previous trail entirely
          break;
        }
        case 'context_done': {
          const summary = (msg.workspace ? '📂 워크스페이스' : '') +
                          (msg.brainCount > 0 ? '  🧠 ' + msg.brainCount + '개 노트' : '') +
                          (msg.web ? '  🌐 인터넷' : '');
          phaseContext.querySelector('.text').textContent = '컨텍스트 모음 완료' + (summary ? ' · ' + summary : '');
          setPhase('context', 'done');
          setPhase('brain', 'active');
          break;
        }
        case 'brain_read': {
          const node = findNodeForReadRequest(msg.note || '');
          if (node) {
            thinkingActive.add(node.id);
            recomputeAdjacent();
            // Camera nudge — gently center on the active node
            try { Graph.centerAt(node.x, node.y, 800); } catch(e){}
            phaseBrain.querySelector('.text').textContent = '🧠 ' + (node.name || '(노트)') + ' 읽는 중...';
            // After 1.4s, mark as done (trail) and remove from active
            setTimeout(() => {
              thinkingActive.delete(node.id);
              markDone(node.id);
              recomputeAdjacent();
            }, 1400);
          } else {
            phaseBrain.querySelector('.text').textContent = '🧠 ' + (msg.note || '...') + ' 검색 중...';
          }
          break;
        }
        case 'url_read': {
          phaseBrain.querySelector('.text').textContent = '🌐 ' + (msg.url || '').slice(0, 60) + '...';
          break;
        }
        case 'answer_start': {
          setPhase('brain', 'done');
          setPhase('answer', 'active');
          answerPreview.style.display = 'block';
          break;
        }
        case 'answer_chunk': {
          // Show last ~120 chars as live preview
          if (typeof msg.text === 'string') {
            answerPreview.textContent = (answerPreview.textContent + msg.text).slice(-180);
          }
          break;
        }
        case 'answer_complete': {
          setPhase('answer', 'done');
          phaseAnswer.querySelector('.text').textContent = '✅ 답변 완료';
          if (Array.isArray(msg.sources)) {
            msg.sources.forEach(req => {
              const node = findNodeForReadRequest(req);
              if (node) markDone(node.id);
            });
          }
          hideThinkingOverlay();
          // Auto-frame the cluster of cited notes — "this answer came from
          // these notes" — so the trail isn't lost in a sea of unrelated nodes.
          // Falls back to full-graph fit when nothing was cited.
          setTimeout(() => {
            if (thinkingDoneOrder.size > 0) {
              try {
                Graph.zoomToFit(1200, 120, n => thinkingDoneOrder.has(n.id));
              } catch(e){ Graph.zoomToFit(1000, 80); }
            } else {
              Graph.zoomToFit(1000, 80);
            }
          }, 400);
          break;
        }
        case 'highlight_node': {
          // External request to focus on a specific note (citation badge click)
          const node = findNodeForReadRequest(msg.note || '');
          if (node) {
            markDone(node.id);
            try { Graph.centerAt(node.x, node.y, 600); Graph.zoom(3, 800); } catch(e){}
            applyHighlight(node);
          }
          break;
        }
        case 'graphData': {
          // Live refresh — new knowledge was injected (EZER / A.U Training).
          // Replace data + tell force-graph to layout incrementally so existing
          // nodes keep their positions and only new nodes settle in.
          if (!msg.data || !Array.isArray(msg.data.nodes)) break;
          data.nodes = msg.data.nodes;
          data.links = msg.data.links || [];
          // Refresh derived lookups
          for (const k in nodeById) delete nodeById[k];
          data.nodes.forEach(n => { nodeById[n.id] = n; });
          for (const k in neighborsOf) delete neighborsOf[k];
          data.nodes.forEach(n => { neighborsOf[n.id] = new Set(); });
          data.links.forEach(l => {
            const sId = (l.source && l.source.id) || l.source;
            const tId = (l.target && l.target.id) || l.target;
            if (neighborsOf[sId]) neighborsOf[sId].add(tId);
            if (neighborsOf[tId]) neighborsOf[tId].add(sId);
          });
          for (const k in nodesByBasename) delete nodesByBasename[k];
          data.nodes.forEach(n => {
            const k = (n.name || '').toLowerCase();
            nodesByBasename[k] = nodesByBasename[k] || [];
            nodesByBasename[k].push(n);
          });
          // Push new graph data into force-graph
          Graph.graphData(data);
          // Stats refresh
          const newFolders = [...new Set(data.nodes.map(n => n.folder))].sort();
          newFolders.forEach((f, i) => { if (!folderColor[f]) folderColor[f] = PALETTE[i % PALETTE.length]; });
          document.getElementById('stats').textContent =
            data.nodes.length + ' 지식 · ' + data.links.length + ' 연결 · ' + newFolders.length + ' 폴더';
          // Append any newly seen folders to legend chip list
          const folderListEl = document.getElementById('folders-list');
          if (folderListEl) {
            const existing = new Set([...folderListEl.querySelectorAll('.folder-name')].map(el => el.textContent));
            const counts = {};
            data.nodes.forEach(n => { counts[n.folder] = (counts[n.folder] || 0) + 1; });
            newFolders.forEach(f => {
              if (existing.has(f || '/')) return;
              const row = document.createElement('div');
              row.className = 'folder-row';
              const dot = document.createElement('div');
              dot.className = 'folder-dot';
              dot.style.background = folderColor[f] || '#888';
              const name = document.createElement('div');
              name.className = 'folder-name';
              name.textContent = f || '/';
              const count = document.createElement('div');
              count.className = 'folder-count';
              count.textContent = counts[f] || 0;
              row.appendChild(dot); row.appendChild(name); row.appendChild(count);
              folderListEl.appendChild(row);
            });
          }
          // Pulse the freshly injected node so the user actually sees it
          if (msg.highlightTitle) {
            const node = findNodeForReadRequest(msg.highlightTitle);
            if (node) {
              thinkingActive.add(node.id);
              recomputeAdjacent();
              try { Graph.centerAt(node.x || 0, node.y || 0, 800); Graph.zoom(2.4, 900); } catch(e){}
              setTimeout(() => {
                thinkingActive.delete(node.id);
                markDone(node.id);
                recomputeAdjacent();
              }, 2200);
            }
          }
          break;
        }
      }
    });

    // Notify extension we're ready to receive events
    vscode.postMessage({ type: 'graph_ready' });
  </script>
</body>
</html>`;
}
