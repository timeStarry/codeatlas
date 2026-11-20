export function getCanvasHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeAtlas Canvas</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --muted: var(--vscode-descriptionForeground, #9da5b4);
      --panel: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, rgba(128,128,128,0.28));
      --accent: var(--vscode-textLink-foreground, #4da6ff);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --input-bg: var(--vscode-input-background, #2d2d30);
      --input-fg: var(--vscode-input-foreground, #d4d4d4);
      --input-border: var(--vscode-input-border, rgba(128,128,128,0.35));
      --mono: var(--vscode-editor-font-family, Consolas, monospace);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: 13px;
      user-select: none;
    }
    .app {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      z-index: 20;
      flex-shrink: 0;
    }
    .toolbar-left, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .brand {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.3px;
    }
    .git-pill {
      font-family: var(--mono);
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(128,128,128,0.14);
      color: var(--muted);
    }
    button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--btn-hover); }
    button.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    button.secondary:hover { background: rgba(128,128,128,0.14); }
    button.secondary.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(77,166,255,0.12);
    }
    input, select, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      font-family: inherit;
    }
    .workspace {
      position: relative;
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .viewport {
      position: relative;
      flex: 1;
      overflow: hidden;
      cursor: grab;
      background-image: radial-gradient(rgba(128,128,128,0.22) 1px, transparent 1px);
      background-size: 22px 22px;
    }
    .viewport.panning { cursor: grabbing; }
    .stage {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      width: 1px;
      height: 1px;
    }
    svg.edges {
      position: absolute;
      top: 0;
      left: 0;
      overflow: visible;
      pointer-events: none;
    }
    .edge-path {
      fill: none;
      stroke: rgba(139,148,158,0.5);
      stroke-width: 2;
      transition: stroke 0.15s, opacity 0.15s;
    }
    .edge-path.flow { stroke: #4da6ff; stroke-width: 2.2; }
    .edge-path.blocking { stroke: #f0883e; stroke-width: 2.2; stroke-dasharray: 6 4; }
    .edge-path.directive { stroke: #a371f7; stroke-width: 2; stroke-dasharray: 3 3; }
    .edge-path.dimmed { opacity: 0.18; }
    .edge-label {
      fill: var(--muted);
      font-size: 10px;
      font-family: var(--mono);
    }

    .node {
      position: absolute;
      width: 248px;
      background: var(--panel);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 9px 11px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.22);
      cursor: pointer;
      transition: box-shadow 0.12s, border-color 0.12s, opacity 0.15s;
    }
    .node:hover {
      border-color: var(--accent);
      box-shadow: 0 6px 18px rgba(0,0,0,0.32);
    }
    .node.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(77,166,255,0.35), 0 8px 22px rgba(0,0,0,0.35);
    }
    .node.dimmed { opacity: 0.25; }
    .node.kind-root { border-left: 4px solid #4da6ff; width: 260px; }
    .node.kind-domain { border-left: 4px solid #3fb950; }
    .node.kind-entrypoint { border-left: 4px solid #58a6ff; }
    .node.kind-claim { border-left: 4px solid #79c0ff; }
    .node.kind-evidence { border-left: 4px solid #56d364; }
    .node.kind-blocking { border-left: 4px solid #f0883e; background: rgba(240,136,62,0.08); }
    .node.kind-diff-file { border-left: 4px solid #d29922; }
    .node.kind-directive { border-left: 4px solid #a371f7; background: rgba(163,113,247,0.09); }

    .node-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
    }
    .node-kind {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      font-weight: 600;
    }
    .node-title {
      font-weight: 600;
      font-size: 12.5px;
      margin-top: 2px;
      word-break: break-word;
    }
    .node-sub {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--muted);
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-body {
      font-size: 11px;
      color: var(--muted);
      margin-top: 5px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .node-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 10.5px;
    }
    .diff-stat { font-family: var(--mono); }
    .diff-add { color: #3fb950; }
    .diff-del { color: #f85149; }

    .collapse-btn {
      position: absolute;
      right: -11px;
      top: 50%;
      transform: translateY(-50%);
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--fg);
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      z-index: 5;
    }
    .collapse-btn:hover {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    .badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }
    .badge-verified { background: rgba(46,160,67,0.22); color: #3fb950; }
    .badge-mismatch { background: rgba(248,81,73,0.22); color: #f85149; }
    .badge-stale { background: rgba(210,153,34,0.22); color: #d29922; }
    .badge-unverified { background: rgba(139,148,158,0.22); color: var(--muted); }
    .badge-unknown { background: rgba(139,148,158,0.18); color: var(--muted); }

    .inspector {
      width: 360px;
      max-width: 44vw;
      background: var(--panel);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 15;
      flex-shrink: 0;
      user-select: text;
    }
    .inspector.hidden { display: none; }
    .inspector-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .inspector-content {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
    }
    .code-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 8px;
      font-family: var(--mono);
      font-size: 11.5px;
      overflow-x: auto;
      margin: 8px 0;
      line-height: 1.5;
    }
    .code-line {
      display: flex;
      gap: 10px;
      white-space: pre;
    }
    .code-line.hl {
      background: rgba(77,166,255,0.16);
      margin: 0 -8px;
      padding: 0 8px;
    }
    .line-no {
      color: var(--muted);
      min-width: 32px;
      text-align: right;
      user-select: none;
    }
    .hud {
      position: absolute;
      bottom: 14px;
      left: 14px;
      display: flex;
      gap: 6px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      z-index: 12;
    }
    .legend {
      position: absolute;
      bottom: 14px;
      right: 14px;
      display: flex;
      gap: 10px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 10.5px;
      color: var(--muted);
      z-index: 12;
    }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="brand">CodeAtlas Canvas</span>
        <span class="git-pill" id="gitPill">Loading...</span>
        <input id="searchInput" placeholder="Find node / symbol / file..." style="width:190px;" />
      </div>
      <div class="toolbar-right">
        <button class="secondary" id="btnDeltaToggle">Delta Overlay: OFF</button>
        <button class="secondary" id="btnAutoLayout">Auto Layout</button>
        <button class="secondary" id="btnFitView">Fit View</button>
        <button class="secondary" id="btnCopyDirs">Copy Directives</button>
        <button id="btnVerifyBriefing">Verify Briefing JSON</button>
      </div>
    </div>

    <div class="workspace">
      <div class="viewport" id="viewport">
        <div class="stage" id="stage">
          <svg class="edges" id="edgesSvg"></svg>
          <div id="nodesLayer"></div>
        </div>
        <div class="hud">
          <button class="secondary" id="btnZoomOut" style="padding:1px 7px;">-</button>
          <span id="zoomLabel" style="min-width:40px;text-align:center;">100%</span>
          <button class="secondary" id="btnZoomIn" style="padding:1px 7px;">+</button>
          <span style="color:var(--muted);margin-left:4px;">Drag canvas to pan · Wheel to zoom · Drag nodes to arrange</span>
        </div>
        <div class="legend">
          <span><i class="dot" style="background:#3fb950;"></i>Domain</span>
          <span><i class="dot" style="background:#79c0ff;"></i>Claim</span>
          <span><i class="dot" style="background:#56d364;"></i>Evidence</span>
          <span><i class="dot" style="background:#f0883e;"></i>Blocking Fork</span>
          <span><i class="dot" style="background:#a371f7;"></i>Directive</span>
        </div>
      </div>

      <aside class="inspector hidden" id="inspector">
        <div class="inspector-header">
          <strong id="inspTitle">Node Inspector</strong>
          <button class="secondary" id="btnCloseInsp" style="padding:2px 7px;">✕</button>
        </div>
        <div class="inspector-content" id="inspContent"></div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let graph = { nodes: [], edges: [] };
    let gitCtx = null;
    let deltaOverlay = false;
    let searchQuery = '';
    let selectedNodeId = null;
    let collapsedIds = new Set();
    let positions = new Map(); // nodeId -> { x, y }
    let snippetCache = new Map();

    // Camera state
    let cam = { x: 60, y: 80, scale: 1 };

    const NODE_W = 248;
    const NODE_H = 104;
    const X_GAP = 315;
    const Y_GAP = 132;

    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const edgesSvg = document.getElementById('edgesSvg');
    const nodesLayer = document.getElementById('nodesLayer');
    const inspector = document.getElementById('inspector');

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function applyCamera() {
      stage.style.transform = 'translate(' + cam.x + 'px, ' + cam.y + 'px) scale(' + cam.scale + ')';
      document.getElementById('zoomLabel').textContent = Math.round(cam.scale * 100) + '%';
    }

    function getChildrenMap() {
      const map = new Map();
      for (const n of graph.nodes) {
        if (n.parentId) {
          if (!map.has(n.parentId)) map.set(n.parentId, []);
          map.get(n.parentId).push(n.id);
        }
      }
      return map;
    }

    function getVisibleNodeIds() {
      const childrenMap = getChildrenMap();
      const visible = new Set();
      function visit(id) {
        visible.add(id);
        if (collapsedIds.has(id)) return;
        for (const cid of childrenMap.get(id) || []) {
          visit(cid);
        }
      }
      const roots = graph.nodes.filter(n => !n.parentId);
      for (const r of roots) visit(r.id);
      return visible;
    }

    // Clean horizontal mind-map / tree layout
    function computeTidyLayout(forceReset = false) {
      const childrenMap = getChildrenMap();
      const visible = getVisibleNodeIds();
      let nextLeafY = 0;

      function layoutNode(id, depth) {
        const kids = (childrenMap.get(id) || []).filter(cid => visible.has(cid));
        let y;
        if (kids.length === 0) {
          y = nextLeafY * Y_GAP;
          nextLeafY += 1;
        } else {
          const ys = kids.map(cid => layoutNode(cid, depth + 1));
          y = (ys[0] + ys[ys.length - 1]) / 2;
        }
        if (forceReset || !positions.has(id)) {
          positions.set(id, { x: depth * X_GAP, y });
        }
        return y;
      }

      const roots = graph.nodes.filter(n => !n.parentId);
      for (const r of roots) layoutNode(r.id, 0);
    }

    function fitView() {
      const visible = getVisibleNodeIds();
      if (visible.size === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of visible) {
        const p = positions.get(id);
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + NODE_W);
        maxY = Math.max(maxY, p.y + NODE_H);
      }
      const rect = viewport.getBoundingClientRect();
      const pad = 60;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scale = Math.min(1.1, Math.max(0.35, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h)));
      cam.scale = scale;
      cam.x = (rect.width - w * scale) / 2 - minX * scale;
      cam.y = (rect.height - h * scale) / 2 - minY * scale;
      applyCamera();
    }

    function renderEdges(visible, matchedIds) {
      let svgHtml = '';
      for (const e of graph.edges) {
        if (!visible.has(e.from) || !visible.has(e.to)) continue;
        const p1 = positions.get(e.from);
        const p2 = positions.get(e.to);
        if (!p1 || !p2) continue;
        const x1 = p1.x + NODE_W;
        const y1 = p1.y + NODE_H / 2;
        const x2 = p2.x;
        const y2 = p2.y + NODE_H / 2;
        const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
        const d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;

        const targetNode = graph.nodes.find(n => n.id === e.to);
        const dimmed =
          (deltaOverlay && targetNode && !targetNode.changed && targetNode.kind !== 'root' && targetNode.kind !== 'directive') ||
          (matchedIds && !matchedIds.has(e.to) && !matchedIds.has(e.from));

        svgHtml += '<path class="edge-path ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + '" d="' + d + '" />';
        if (e.label) {
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - 5;
          svgHtml += '<text class="edge-label" x="' + mx + '" y="' + my + '" text-anchor="middle">' + esc(e.label) + '</text>';
        }
      }
      edgesSvg.innerHTML = svgHtml;
    }

    function renderCanvas() {
      const childrenMap = getChildrenMap();
      const visible = getVisibleNodeIds();

      let matchedIds = null;
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        matchedIds = new Set();
        for (const n of graph.nodes) {
          const hay = (n.title + ' ' + (n.subtitle || '') + ' ' + (n.body || '') + ' ' + (n.path || '')).toLowerCase();
          if (hay.includes(q)) matchedIds.add(n.id);
        }
      }

      renderEdges(visible, matchedIds);
      nodesLayer.innerHTML = '';

      for (const n of graph.nodes) {
        if (!visible.has(n.id)) continue;
        const p = positions.get(n.id) || { x: 0, y: 0 };
        const kids = childrenMap.get(n.id) || [];
        const isCollapsed = collapsedIds.has(n.id);
        const dimmed =
          (deltaOverlay && !n.changed && n.kind !== 'root' && n.kind !== 'directive') ||
          (matchedIds && !matchedIds.has(n.id));

        const el = document.createElement('div');
        el.className = 'node kind-' + n.kind + (selectedNodeId === n.id ? ' selected' : '') + (dimmed ? ' dimmed' : '');
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        el.dataset.id = n.id;

        const diffHtml = n.changed && (n.additions !== undefined || n.deletions !== undefined)
          ? '<span class="diff-stat"><span class="diff-add">+' + (n.additions || 0) + '</span> <span class="diff-del">-' + (n.deletions || 0) + '</span></span>'
          : (n.changed ? '<span class="diff-stat" style="color:#d29922;">modified</span>' : '<span></span>');

        el.innerHTML =
          '<div class="node-top">' +
            '<div><div class="node-kind">' + esc(n.kind) + '</div></div>' +
            (n.badge ? '<span class="badge badge-' + esc(n.badge) + '">' + esc(n.badge) + '</span>' : '') +
          '</div>' +
          '<div class="node-title">' + esc(n.title) + '</div>' +
          (n.subtitle ? '<div class="node-sub" title="' + esc(n.subtitle) + '">' + esc(n.subtitle) + '</div>' : '') +
          (n.body ? '<div class="node-body">' + esc(n.body) + '</div>' : '') +
          '<div class="node-footer">' + diffHtml + '<span>' + (kids.length > 0 ? kids.length + ' branch' + (kids.length > 1 ? 'es' : '') : '') + '</span></div>';

        if (kids.length > 0) {
          const btn = document.createElement('button');
          btn.className = 'collapse-btn';
          btn.title = isCollapsed ? 'Expand subtree' : 'Collapse subtree';
          btn.textContent = isCollapsed ? '+' : '−';
          btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (collapsedIds.has(n.id)) collapsedIds.delete(n.id);
            else collapsedIds.add(n.id);
            computeTidyLayout(true);
            renderCanvas();
          });
          el.appendChild(btn);
        }

        // Drag individual node OR click to inspect
        el.addEventListener('mousedown', (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          const startMouseX = ev.clientX;
          const startMouseY = ev.clientY;
          const startPos = { ...(positions.get(n.id) || { x: 0, y: 0 }) };
          let dragged = false;

          function onMove(mv) {
            const dx = (mv.clientX - startMouseX) / cam.scale;
            const dy = (mv.clientY - startMouseY) / cam.scale;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true;
            if (dragged) {
              positions.set(n.id, { x: startPos.x + dx, y: startPos.y + dy });
              el.style.left = (startPos.x + dx) + 'px';
              el.style.top = (startPos.y + dy) + 'px';
              renderEdges(visible, matchedIds);
            }
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!dragged) {
              selectNode(n.id);
            }
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        nodesLayer.appendChild(el);
      }
    }

    function selectNode(nodeId) {
      selectedNodeId = nodeId;
      renderCanvas();
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) {
        inspector.classList.add('hidden');
        return;
      }
      inspector.classList.remove('hidden');
      document.getElementById('inspTitle').textContent = node.title;
      renderInspector(node);
      if (node.path) {
        vscode.postMessage({
          type: 'requestSnippet',
          nodeId: node.id,
          path: node.path,
          startLine: node.startLine || 1,
          endLine: node.endLine || (node.startLine || 1)
        });
      }
    }

    function renderInspector(node) {
      const el = document.getElementById('inspContent');
      const snippet = snippetCache.get(node.id);
      let html =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<span class="node-kind">' + esc(node.kind) + '</span>' +
          (node.badge ? '<span class="badge badge-' + esc(node.badge) + '">' + esc(node.badge) + '</span>' : '') +
        '</div>';

      if (node.subtitle) {
        html += '<div style="font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-bottom:8px;">' + esc(node.subtitle) + '</div>';
      }
      if (node.body) {
        html += '<p style="margin:0 0 10px;">' + esc(node.body) + '</p>';
      }
      if (node.notes && node.notes.length > 0) {
        for (const nt of node.notes) {
          html += '<div style="font-size:11.5px;color:#f85149;margin-bottom:4px;">! ' + esc(nt) + '</div>';
        }
      }

      if (node.path) {
        html +=
          '<div style="display:flex;gap:6px;margin:10px 0;">' +
            '<button id="btnJumpCode">Jump to Source in Editor</button>' +
          '</div>';
        if (snippet && snippet.lines) {
          html += '<div class="code-box">';
          for (const ln of snippet.lines) {
            html +=
              '<div class="code-line' + (ln.highlight ? ' hl' : '') + '">' +
                '<span class="line-no">' + ln.num + '</span>' +
                '<span>' + esc(ln.text) + '</span>' +
              '</div>';
          }
          html += '</div>';
        } else {
          html += '<div style="font-size:11.5px;color:var(--muted);">Loading real source preview...</div>';
        }

        html +=
          '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border);">' +
            '<div style="font-weight:600;font-size:12px;margin-bottom:6px;">Attach Canvas Directive / Note</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
              '<select id="inspDirKind">' +
                '<option value="rework">Rework</option>' +
                '<option value="constraint">Constraint</option>' +
                '<option value="question">Question</option>' +
              '</select>' +
              '<input id="inspDirLine" type="number" min="1" value="' + esc(node.startLine || 1) + '" style="width:74px;" />' +
            '</div>' +
            '<textarea id="inspDirNote" rows="3" style="width:100%;" placeholder="Add constraint or rework instruction wired to this node..."></textarea>' +
            '<button id="btnAddCanvasDir" style="margin-top:6px;">+ Add Node to Canvas</button>' +
          '</div>';
      }

      el.innerHTML = html;

      const jumpBtn = document.getElementById('btnJumpCode');
      if (jumpBtn && node.path) {
        jumpBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'openFile', path: node.path, line: node.startLine || 1 });
        });
      }

      const addBtn = document.getElementById('btnAddCanvasDir');
      if (addBtn && node.path) {
        addBtn.addEventListener('click', () => {
          const note = document.getElementById('inspDirNote').value.trim();
          const kind = document.getElementById('inspDirKind').value;
          const line = parseInt(document.getElementById('inspDirLine').value, 10);
          if (!note) return;
          vscode.postMessage({
            type: 'addDirective',
            kind,
            path: node.path,
            startLine: Number.isFinite(line) ? line : (node.startLine || 1),
            note
          });
        });
      }
    }

    // Pan viewport
    viewport.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      viewport.classList.add('panning');
      const startX = ev.clientX - cam.x;
      const startY = ev.clientY - cam.y;
      function onMove(mv) {
        cam.x = mv.clientX - startX;
        cam.y = mv.clientY - startY;
        applyCamera();
      }
      function onUp() {
        viewport.classList.remove('panning');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Zoom viewport around cursor
    viewport.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.12 : 0.89;
      const nextScale = Math.min(2.2, Math.max(0.25, cam.scale * factor));
      cam.x = mx - (mx - cam.x) * (nextScale / cam.scale);
      cam.y = my - (my - cam.y) * (nextScale / cam.scale);
      cam.scale = nextScale;
      applyCamera();
    }, { passive: false });

    document.getElementById('btnZoomIn').addEventListener('click', () => {
      cam.scale = Math.min(2.2, cam.scale * 1.18);
      applyCamera();
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      cam.scale = Math.max(0.25, cam.scale * 0.85);
      applyCamera();
    });
    document.getElementById('btnFitView').addEventListener('click', fitView);
    document.getElementById('btnAutoLayout').addEventListener('click', () => {
      computeTidyLayout(true);
      renderCanvas();
      fitView();
    });
    document.getElementById('btnDeltaToggle').addEventListener('click', (ev) => {
      deltaOverlay = !deltaOverlay;
      ev.target.textContent = 'Delta Overlay: ' + (deltaOverlay ? 'ON' : 'OFF');
      ev.target.classList.toggle('active', deltaOverlay);
      renderCanvas();
    });
    document.getElementById('btnVerifyBriefing').addEventListener('click', () => {
      vscode.postMessage({ type: 'pickBriefing' });
    });
    document.getElementById('btnCopyDirs').addEventListener('click', () => {
      vscode.postMessage({ type: 'copyDirectives' });
    });
    document.getElementById('btnCloseInsp').addEventListener('click', () => {
      selectedNodeId = null;
      inspector.classList.add('hidden');
      renderCanvas();
    });
    document.getElementById('searchInput').addEventListener('input', (ev) => {
      searchQuery = ev.target.value;
      renderCanvas();
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'canvasState') {
        const firstLoad = graph.nodes.length === 0;
        gitCtx = msg.payload.git;
        graph = msg.payload.graph || { nodes: [], edges: [] };
        document.getElementById('gitPill').textContent = gitCtx
          ? (gitCtx.branch + ' @ ' + gitCtx.shortSha + ' · ' + graph.nodes.length + ' nodes')
          : 'No Git repo';
        computeTidyLayout(firstLoad);
        renderCanvas();
        if (firstLoad) fitView();
        if (selectedNodeId) {
          const cur = graph.nodes.find(n => n.id === selectedNodeId);
          if (cur) renderInspector(cur);
        }
      } else if (msg.type === 'snippet') {
        snippetCache.set(msg.payload.nodeId, msg.payload);
        if (selectedNodeId === msg.payload.nodeId) {
          const cur = graph.nodes.find(n => n.id === selectedNodeId);
          if (cur) renderInspector(cur);
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
