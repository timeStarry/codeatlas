export function getCanvasHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeAtlas Canvas</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #181a1f);
      --fg: var(--vscode-editor-foreground, #d8dee9);
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --panel: var(--vscode-sideBar-background, #21242b);
      --panel-2: var(--vscode-editorWidget-background, #262a33);
      --border: var(--vscode-panel-border, rgba(140,150,165,0.26));
      --accent: var(--vscode-textLink-foreground, #4da6ff);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --input-bg: var(--vscode-input-background, #2b2f38);
      --input-fg: var(--vscode-input-foreground, #d8dee9);
      --input-border: var(--vscode-input-border, rgba(140,150,165,0.34));
      --mono: var(--vscode-editor-font-family, Consolas, monospace);
      --green: var(--vscode-charts-green, #3fb950);
      --red: var(--vscode-charts-red, #f85149);
      --amber: var(--vscode-charts-orange, #f0883e);
      --yellow: var(--vscode-charts-yellow, #d29922);
      --purple: var(--vscode-charts-purple, #a371f7);
      --diff-add-bg: var(--vscode-diffEditor-insertedTextBackground, rgba(63,185,80,0.16));
      --diff-del-bg: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,0.16));
      --surface-subtle: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
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
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif);
      font-size: 13px;
      user-select: none;
    }
    .app { display: flex; flex-direction: column; width: 100%; height: 100%; }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      z-index: 25;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .brand { font-weight: 700; font-size: 13px; letter-spacing: 0.2px; }
    .git-pill, .arch-pill {
      font-family: var(--mono);
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--surface-subtle);
      color: var(--muted);
    }
    .arch-pill {
      font-family: inherit;
      color: var(--accent);
      background: rgba(77,166,255,0.12);
      font-weight: 600;
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 5px;
      overflow: hidden;
    }
    .segmented button {
      background: transparent;
      color: var(--muted);
      border: none;
      border-radius: 0;
      padding: 3px 9px;
      font-size: 11.5px;
    }
    .segmented button + button { border-left: 1px solid var(--border); }
    .segmented button.active {
      background: rgba(77,166,255,0.18);
      color: var(--fg);
      font-weight: 600;
    }
    .search-wrap { position: relative; display: inline-flex; align-items: center; }
    .search-count {
      position: absolute;
      right: 6px;
      font-size: 10px;
      font-family: var(--mono);
      color: var(--muted);
      pointer-events: none;
    }

    .subbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 5px 12px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      font-size: 11.5px;
      z-index: 20;
      flex-shrink: 0;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 4px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--muted);
      min-width: 120px;
    }
    .crumb { cursor: pointer; color: var(--fg); padding: 1px 5px; border-radius: 3px; }
    .crumb:hover { background: var(--surface-subtle); color: var(--accent); }
    .trust-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
    .chip {
      font-size: 10.5px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--surface-subtle);
      color: var(--muted);
      border: 1px solid transparent;
      cursor: pointer;
    }
    .chip:hover { border-color: var(--accent); }
    .chip.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .chip.ok { background: rgba(63,185,80,0.18); color: var(--green); }
    .chip.err { background: rgba(248,81,73,0.2); color: var(--red); }
    .chip.warn { background: rgba(240,136,62,0.2); color: var(--amber); }
    .chip.dir { background: rgba(163,113,247,0.2); color: var(--purple); }

    .stale-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 12px;
      background: rgba(210,153,34,0.18);
      border-bottom: 1px solid rgba(210,153,34,0.45);
      color: var(--yellow);
      font-size: 11.5px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .stale-banner.hidden { display: none; }

    button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 9px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--btn-hover); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    button.secondary:hover { background: var(--surface-subtle); }
    button.secondary.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(77,166,255,0.14);
    }
    button.danger {
      background: transparent;
      color: var(--red);
      border: 1px solid rgba(248,81,73,0.45);
    }
    button.danger:hover { background: rgba(248,81,73,0.15); }
    input, select, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 3px 7px;
      font-size: 12px;
      font-family: inherit;
    }

    .workspace { position: relative; flex: 1; display: flex; overflow: hidden; }

    /* Left Branch Summary Drawer (Scenario C) */
    .summary-drawer {
      width: 280px;
      max-width: 34vw;
      background: var(--panel);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 14;
      flex-shrink: 0;
      user-select: text;
    }
    .summary-drawer.hidden { display: none; }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 11px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 12.5px;
    }
    .drawer-body {
      padding: 10px 11px;
      overflow-y: auto;
      flex: 1;
    }
    .summary-sec {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      margin: 12px 0 6px;
      letter-spacing: 0.3px;
    }
    .summary-sec:first-child { margin-top: 0; }
    .summary-item {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 9px;
      margin-bottom: 6px;
      cursor: pointer;
      background: var(--bg);
      transition: border-color 0.12s;
    }
    .summary-item:hover { border-color: var(--accent); }
    .summary-item-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .summary-item-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 3px;
      font-family: var(--mono);
    }
    .commit-row {
      font-size: 11.5px;
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 6px;
      align-items: baseline;
    }
    .commit-sha {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--accent);
      flex-shrink: 0;
    }

    .viewport {
      position: relative;
      flex: 1;
      overflow: hidden;
      cursor: grab;
      background-image: radial-gradient(rgba(140,150,165,0.22) 1px, transparent 1px);
      background-size: 24px 24px;
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
    svg.edges { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
    .edge-path {
      fill: none;
      stroke: rgba(139,148,158,0.45);
      stroke-width: 1.8;
      transition: opacity 0.14s, stroke-width 0.14s;
    }
    .edge-path.flow { stroke: #4da6ff; stroke-width: 2.2; }
    .edge-path.blocking { stroke: var(--amber); stroke-width: 2.3; stroke-dasharray: 6 4; }
    .edge-path.impact { stroke: #39c5cf; stroke-width: 2.1; stroke-dasharray: 5 3; }
    .edge-path.dep { stroke: #58a6ff; stroke-width: 2; stroke-dasharray: 4 4; }
    .edge-path.directive { stroke: var(--purple); stroke-width: 2; stroke-dasharray: 3 3; }
    .edge-path.dimmed { opacity: 0.12; }
    .edge-path.focused { stroke-width: 2.8; opacity: 1; }
    .edge-pill { fill: var(--panel); stroke: var(--border); stroke-width: 1; }
    .edge-pill.blocking { stroke: var(--amber); }
    .edge-pill.impact { stroke: #39c5cf; }
    .edge-pill.dep { stroke: #58a6ff; }
    .edge-pill.directive { stroke: var(--purple); }
    .edge-pill.dimmed, .edge-label.dimmed { opacity: 0.14; }
    .edge-label { fill: var(--muted); font-size: 9.5px; font-weight: 700; font-family: var(--mono); }
    .edge-label.blocking { fill: var(--amber); }
    .edge-label.impact { fill: #39c5cf; }
    .edge-label.dep { fill: #58a6ff; }
    .edge-label.directive { fill: var(--purple); }

    .node {
      position: absolute;
      width: 262px;
      background: var(--panel);
      border: 1.5px solid var(--border);
      border-radius: 9px;
      padding: 10px 12px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
      cursor: pointer;
      transition: box-shadow 0.12s, border-color 0.12s, opacity 0.14s;
    }
    .node:hover { border-color: var(--accent); box-shadow: 0 6px 20px rgba(0,0,0,0.28); }
    .node.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(77,166,255,0.4), 0 8px 24px rgba(0,0,0,0.34);
    }
    .node.dimmed { opacity: 0.16; }

    .node.kind-root { border: 2px solid var(--accent); background: linear-gradient(145deg, rgba(77,166,255,0.14), var(--panel)); }
    .node.kind-domain { border-top: 3px solid var(--green); background: linear-gradient(180deg, rgba(63,185,80,0.08), var(--panel)); }
    .node.kind-folder { border-left: 4px solid #79c0ff; background: linear-gradient(180deg, rgba(121,192,255,0.08), var(--panel)); }
    .node.kind-entrypoint { border-left: 4px solid #58a6ff; }
    .node.kind-file { border-left: 4px solid rgba(139,148,158,0.65); background: var(--panel-2); }
    .node.is-summary { border-style: dashed; opacity: 0.88; }
    .node.kind-claim { border-left: 4px solid #79c0ff; }
    .node.kind-evidence { border-left: 4px solid var(--green); background: var(--panel-2); }
    .node.kind-blocking {
      border: 1.5px solid rgba(240,136,62,0.75);
      border-left: 5px solid var(--amber);
      background: linear-gradient(135deg, rgba(240,136,62,0.14), var(--panel));
    }
    .node.kind-diff-file { border-left: 4px solid var(--yellow); }
    .node.kind-impact {
      border: 1.5px solid rgba(57,197,207,0.65);
      border-left: 5px solid #39c5cf;
      background: linear-gradient(135deg, rgba(57,197,207,0.12), var(--panel));
    }
    .node.kind-directive {
      border: 1.5px dashed rgba(163,113,247,0.75);
      border-left: 5px solid var(--purple);
      background: linear-gradient(135deg, rgba(163,113,247,0.14), var(--panel));
    }

    .node-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .node-kind { font-size: 9.5px; letter-spacing: 0.3px; color: var(--muted); font-weight: 700; }
    .layer-tag {
      font-size: 9.5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(77,166,255,0.14);
      color: var(--accent);
      font-weight: 600;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .node-title { font-weight: 600; font-size: 12.5px; margin-top: 4px; word-break: break-word; }
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
      font-size: 11.5px;
      color: var(--muted);
      margin-top: 5px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .blocking-box {
      margin-top: 6px;
      padding: 5px 7px;
      border-radius: 5px;
      background: var(--surface-subtle);
      border-left: 2px solid var(--amber);
      font-size: 11px;
      line-height: 1.4;
    }
    .blocking-if { color: var(--amber); font-weight: 700; }
    .blocking-then { color: var(--fg); margin-top: 2px; }

    .node-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 7px;
      font-size: 10.5px;
      color: var(--muted);
      gap: 6px;
    }
    .quick-btn {
      font-size: 10.5px;
      color: var(--accent);
      background: transparent;
      border: 1px solid rgba(77,166,255,0.45);
      padding: 1px 6px;
      border-radius: 3px;
    }
    .quick-btn:hover { background: rgba(77,166,255,0.15); }
    .quick-jump { opacity: 0; transition: opacity 0.12s; }
    .node:hover .quick-jump, .node.selected .quick-jump { opacity: 1; }
    .diff-add { color: var(--green); font-family: var(--mono); }
    .diff-del { color: var(--red); font-family: var(--mono); }

    .collapse-btn {
      position: absolute;
      right: -12px;
      top: 50%;
      transform: translateY(-50%);
      width: 24px;
      height: 24px;
      border-radius: 999px;
      border: 1.5px solid var(--border);
      background: var(--panel);
      color: var(--fg);
      font-size: 10.5px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      z-index: 6;
    }
    .collapse-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

    .badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      flex-shrink: 0;
    }
    .badge-verified { background: rgba(63,185,80,0.2); color: var(--green); }
    .badge-mismatch { background: rgba(248,81,73,0.22); color: var(--red); }
    .badge-stale { background: rgba(210,153,34,0.24); color: var(--yellow); }
    .badge-unverified { background: var(--surface-subtle); color: var(--muted); }
    .badge-unknown { background: var(--surface-subtle); color: var(--muted); }

    .empty-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 8;
    }
    .empty-overlay.hidden { display: none; }
    .empty-card {
      pointer-events: auto;
      max-width: 400px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .inspector {
      width: 390px;
      max-width: 46vw;
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
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .inspector-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
      gap: 2px;
    }
    .insp-tab {
      background: transparent;
      color: var(--muted);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 6px 9px;
      font-size: 11.5px;
    }
    .insp-tab.active { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
    .inspector-content { padding: 12px; overflow-y: auto; flex: 1; }
    .code-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
      font-family: var(--mono);
      font-size: 11.5px;
      overflow-x: auto;
      margin: 8px 0;
      line-height: 1.5;
    }
    .code-line { display: flex; gap: 10px; white-space: pre; }
    .code-line.hl { background: rgba(77,166,255,0.16); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-plus { background: var(--diff-add-bg); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-minus { background: var(--diff-del-bg); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-hunk { color: var(--accent); font-weight: 600; }
    .line-no { color: var(--muted); min-width: 30px; text-align: right; user-select: none; }

    .hud {
      position: absolute;
      bottom: 12px;
      left: 12px;
      display: flex;
      gap: 5px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 4px 8px;
      font-size: 11px;
      z-index: 12;
      box-shadow: 0 4px 14px rgba(0,0,0,0.22);
    }
    .hud-sep { width: 1px; height: 14px; background: var(--border); margin: 0 2px; }
    .legend-wrap {
      position: absolute;
      bottom: 12px;
      right: 12px;
      z-index: 12;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .legend-popover {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px 10px;
      font-size: 11px;
      color: var(--muted);
      box-shadow: 0 6px 18px rgba(0,0,0,0.28);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .legend-popover.hidden { display: none; }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="toolbar">
      <div class="group">
        <span class="brand">CodeAtlas</span>
        <span class="git-pill" id="gitPill">加载中...</span>
        <span class="arch-pill" id="archPill" style="display:none;"></span>
        <div class="segmented" id="modeControl">
          <button data-mode="atlas" id="mAtlas">全景底图</button>
          <button data-mode="briefing" id="mBriefing">因果简报</button>
          <button data-mode="hybrid" id="mHybrid" class="active">融合视图</button>
        </div>
        <select id="briefingSelect" style="max-width:175px;"></select>
        <select id="baseRefSelect" style="max-width:115px;"></select>
      </div>
      <div class="group">
        <button class="secondary" id="btnSummaryToggle">分支摘要</button>
        <button class="secondary" id="btnPruneToggle">仅看变更: 关</button>
        <button class="secondary" id="btnRunImpact">分析影响面</button>
        <div class="search-wrap">
          <input id="searchInput" placeholder="搜索 (/)..." style="width:140px;padding-right:38px;" />
          <span class="search-count" id="searchCount"></span>
        </div>
        <button class="secondary" id="btnDeltaToggle">变更叠加: 关</button>
        <button class="secondary" id="btnFocusToggle">聚焦: 关</button>
        <button class="secondary" id="btnRefresh">刷新</button>
        <button id="btnInitManifest" style="display:none;">保存骨架</button>
        <button class="secondary" id="btnCopyDirs">导出指令</button>
        <button class="secondary" id="btnVerifyBriefing">核验简报</button>
        <button class="secondary" id="btnLangToggle" style="padding:3px 7px;font-size:11px;">EN</button>
      </div>
    </div>

    <div class="stale-banner hidden" id="staleBanner">
      <span id="staleBannerText"></span>
      <button class="secondary" id="btnReverifyStale" style="padding:2px 8px;font-size:11px;">立即重验</button>
    </div>

    <div class="subbar">
      <div class="breadcrumbs" id="breadcrumbs"></div>
      <div class="trust-chips" id="trustChips"></div>
    </div>

    <div class="workspace">
      <aside class="summary-drawer hidden" id="summaryDrawer">
        <div class="drawer-header">
          <span id="summaryDrawerTitle">分支变更摘要</span>
          <button class="secondary" id="btnCloseSummary" style="padding:1px 7px;">✕</button>
        </div>
        <div class="drawer-body" id="summaryBody"></div>
      </aside>

      <div class="viewport" id="viewport">
        <div class="stage" id="stage">
          <svg class="edges" id="edgesSvg"></svg>
          <div id="nodesLayer"></div>
        </div>

        <div class="empty-overlay hidden" id="emptyOverlay">
          <div class="empty-card">
            <strong id="emptyTitle" style="font-size:14px;"></strong>
            <p id="emptyDesc" style="color:var(--muted);font-size:12px;margin:8px 0 12px;"></p>
            <button id="btnEmptyVerify"></button>
          </div>
        </div>

        <div class="hud">
          <button class="secondary" id="btnZoomOut" style="padding:1px 7px;">−</button>
          <span id="zoomLabel" style="min-width:38px;text-align:center;">100%</span>
          <button class="secondary" id="btnZoomIn" style="padding:1px 7px;">+</button>
          <div class="hud-sep"></div>
          <button class="secondary" id="btnFitView" style="padding:1px 7px;">适配</button>
          <button class="secondary" id="btnAutoLayout" style="padding:1px 7px;">整理</button>
          <button class="secondary" id="btnExpandAll" style="padding:1px 7px;">展开</button>
          <button class="secondary" id="btnCollapseDomains" style="padding:1px 7px;">收拢</button>
          <button class="secondary" id="btnIndexFiles" style="padding:1px 7px;display:none;">展开至文件层</button>
        </div>

        <div class="legend-wrap">
          <div class="legend-popover hidden" id="legendPopover"></div>
          <button class="secondary" id="btnLegendToggle" style="padding:3px 9px;font-size:11px;">? 图例</button>
        </div>
      </div>

      <aside class="inspector hidden" id="inspector">
        <div class="inspector-header">
          <strong id="inspTitle" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">节点精读</strong>
          <div class="group" style="gap:4px;">
            <button class="secondary" id="btnInspFocus" style="padding:2px 7px;font-size:11px;">聚焦</button>
            <button class="secondary" id="btnCloseInsp" style="padding:2px 7px;">✕</button>
          </div>
        </div>
        <div class="inspector-tabs">
          <button class="insp-tab active" data-itab="overview" id="tabCode">源码</button>
          <button class="insp-tab" data-itab="diff" id="tabDiff">Diff</button>
          <button class="insp-tab" data-itab="directive" id="tabDir">+ 批注</button>
          <button class="insp-tab" data-itab="trust" id="tabTrust">可信度</button>
        </div>
        <div class="inspector-content" id="inspContent"></div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const I18N = {
      zh: {
        atlas: '全景底图', briefing: '因果简报', hybrid: '融合视图',
        summaryBtn: '分支摘要', pruneOn: '仅看变更: 开', pruneOff: '仅看变更: 关', impactBtn: '分析影响面',
        searchPh: '搜索 (/)...', deltaOn: '变更叠加: 开', deltaOff: '变更叠加: 关',
        focusOn: '聚焦: 开', focusOff: '聚焦: 关', refresh: '刷新索引', initManifest: '保存骨架', exportDir: '导出指令',
        verifyJson: '核验 JSON', reverify: '立即重验', langBtn: 'EN',
        selectBriefing: '-- 选择简报 --', fit: '适配', tidy: '整理', expand: '展开', collapse: '收拢',
        indexFiles: '展开至文件层', collapseFiles: '收起文件层', legendBtn: '? 图例',
        summaryTitle: '分支变更摘要', tabCode: '源码', tabDiff: 'Diff', tabDir: '+ 批注', tabTrust: '可信度',
        inspFocus: '聚焦', defaultCrumb: '点击节点精读源码 · 双击节点聚焦分支 · 点域卡片按需展开文件',
        openBtn: '打开 ↗', expandDomainFiles: '展开文件', collapseDomainFiles: '收起文件',
        kind: {
          root: '仓库快照', domain: '职责域', folder: '子目录', entrypoint: '业务入口', file: '文件',
          claim: '因果声明', evidence: '代码证据', blocking: '阻断分叉', 'diff-file': '变更文件', impact: '间接影响', directive: '纠偏批注'
        },
        badge: { verified: '已核验', mismatch: '失配', stale: '过期', unverified: '未核验', unknown: '未知' },
        legendHtml:
          '<div><i class="dot" style="background:var(--green);"></i>职责域 / 已核验代码证据</div>' +
          '<div><i class="dot" style="background:#79c0ff;"></i>简报因果声明</div>' +
          '<div><i class="dot" style="background:var(--amber);"></i>显式阻断分叉 (IF → 结果)</div>' +
          '<div><i class="dot" style="background:var(--purple);"></i>画布纠偏批注节点</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:5px;margin-top:2px;font-family:var(--mono);font-size:10px;">/ 搜索 · F 适配 · 0 100% · D 变更叠加 · E/C 展开收拢 · Enter 跳源码 · Esc 返回</div>',
        emptyBriefingTitle: '尚未加载简报',
        emptyBriefingDesc: '请在上方选择自动发现的简报，或点击“核验简报”加载 Agent 提交的 JSON（Schema v0.1）。',
        noGit: '未检测到 Git 仓库',
        summaryImpacted: '受影响职责域（点击定位并展开）',
        summaryNoDiff: '当前相对基准无文件改动。',
        summaryCommits: '本分支提交记录',
        summaryNoCommits: '相对基准无新增提交。',
        summaryClaims: '关联简报声明',
        summaryPruneHint: '开启“仅看变更”可隐藏无关逻辑分支，只保留本次改动与关联影响。',
        jumpEditor: '在编辑器中打开 (Enter)',
        loadingSnippet: '正在读取真实源码...',
        loadingDiff: '正在加载 Git Diff...',
        noDiffForFile: '当前文件相对所选基准无变更：',
        notFileNode: '当前节点未绑定具体文件路径。',
        dirHelp: '向当前节点直接挂接一条约束、疑问或返工指令：',
        dirPathReq: '必须填写仓库相对路径。',
        dirPlaceholder: '必填：描述需要 Agent 修复、保留或核验的具体要求...',
        dirWireBtn: '+ 挂接到画布',
        dirCopyBtn: '复制 Markdown 指令',
        delDirBtn: '删除此批注节点',
        signalsTitle: '验证信号 (Verification Signals)',
        noSignals: '未附带验证信号（状态：未知）。',
        blindSpotsTitle: '已声明的盲区 (Blind Spots)',
        noBlindSpots: '无已声明盲区。',
        guardrailsTitle: '仓库架构红线 (.atlas/manifest.json)',
        noGuardrails: '未在 .atlas/manifest.json 中声明红线。',
        staleText: (t, h) => '简报已过期：目标提交 (' + t + ') 与当前 HEAD (' + h + ') 不一致，请重新核验。'
      },
      en: {
        atlas: 'Atlas', briefing: 'Briefing', hybrid: 'Hybrid',
        summaryBtn: 'Branch Summary', pruneOn: 'Changed Only: ON', pruneOff: 'Changed Only: OFF', impactBtn: 'Impact',
        searchPh: 'Search (/)...', deltaOn: 'Delta: ON', deltaOff: 'Delta: OFF',
        focusOn: 'Focus: ON', focusOff: 'Focus: OFF', refresh: 'Re-Index', initManifest: 'Save Skeleton', exportDir: 'Export',
        verifyJson: 'Verify JSON', reverify: 'Re-verify', langBtn: '中',
        selectBriefing: '-- Briefing --', fit: 'Fit', tidy: 'Tidy', expand: 'Expand', collapse: 'Collapse',
        indexFiles: 'Expand to Files', collapseFiles: 'Collapse Files', legendBtn: '? Legend',
        summaryTitle: 'Branch Summary', tabCode: 'Code', tabDiff: 'Diff', tabDir: '+ Directive', tabTrust: 'Trust',
        inspFocus: 'Focus', defaultCrumb: 'Click to inspect · Double-click to focus · Click Domain to lazy-expand files',
        openBtn: 'Open ↗', expandDomainFiles: 'Files', collapseDomainFiles: 'Hide Files',
        kind: {
          root: 'Repository', domain: 'Domain', folder: 'Folder', entrypoint: 'Entrypoint', file: 'File',
          claim: 'Claim', evidence: 'Evidence', blocking: 'Blocking Fork', 'diff-file': 'Changed File', impact: 'Indirect Impact', directive: 'Directive'
        },
        badge: { verified: 'verified', mismatch: 'mismatch', stale: 'stale', unverified: 'unverified', unknown: 'unknown' },
        legendHtml:
          '<div><i class="dot" style="background:var(--green);"></i>Domain / Verified Evidence</div>' +
          '<div><i class="dot" style="background:#79c0ff;"></i>Briefing Claim</div>' +
          '<div><i class="dot" style="background:var(--amber);"></i>Explicit Blocking Fork (IF → Outcome)</div>' +
          '<div><i class="dot" style="background:var(--purple);"></i>Wired Directive Node</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:5px;margin-top:2px;font-family:var(--mono);font-size:10px;">/ Search · F Fit · 0 100% · D Delta · E/C Expand/Collapse · Enter Jump · Esc Back</div>',
        emptyBriefingTitle: 'No Briefing Loaded',
        emptyBriefingDesc: 'Select a discovered briefing above or click Verify JSON to inspect claims and blocking forks.',
        noGit: 'No Git repository',
        summaryImpacted: 'Impacted Domains (click to focus)',
        summaryNoDiff: 'No changed files vs current base ref.',
        summaryCommits: 'Branch Commits',
        summaryNoCommits: 'No new commits relative to base ref.',
        summaryClaims: 'Briefing Claims',
        summaryPruneHint: 'Toggle "Changed Only" to prune unrelated branches from the Canvas.',
        jumpEditor: 'Jump to Editor (Enter)',
        loadingSnippet: 'Loading source preview...',
        loadingDiff: 'Loading git diff...',
        noDiffForFile: 'No git diff changes for: ',
        notFileNode: 'This node is not bound to a specific file path.',
        dirHelp: 'Wire a Constraint, Question, or Rework node directly to:',
        dirPathReq: 'File path is required.',
        dirPlaceholder: 'Required: describe what the Agent must fix, preserve, or verify...',
        dirWireBtn: '+ Wire to Canvas',
        dirCopyBtn: 'Copy Markdown',
        delDirBtn: 'Delete Directive Node',
        signalsTitle: 'Verification Signals',
        noSignals: 'No verification signals attached (UNKNOWN).',
        blindSpotsTitle: 'Declared Blind Spots',
        noBlindSpots: 'None declared.',
        guardrailsTitle: 'Repository Guardrails (.atlas/manifest.json)',
        noGuardrails: 'No guardrails declared.',
        staleText: (t, h) => 'STALE BRIEFING: Target ref (' + t + ') differs from HEAD (' + h + ').'
      }
    };

    let lang = 'zh';
    let graph = { mode: 'hybrid', nodes: [], edges: [], summary: {}, architecture: null, branchSummary: null };
    let nodeById = new Map();
    let gitCtx = null;
    let baseRef = 'HEAD';
    let availableBriefings = [];
    let activeBriefingPath = '';
    let lastBriefingKey = '';
    let viewMode = 'hybrid';
    let deltaOverlay = false;
    let pruneUnchanged = false;
    let showSupportAssets = false;
    let lastTopologyKey = '';
    let summaryOpen = false;
    let focusMode = false;
    let activeChipFilter = '';
    let searchQuery = '';
    let searchMatches = [];
    let searchMatchIdx = 0;
    let selectedNodeId = null;
    let inspectorTab = 'overview';
    let collapsedIds = new Set();
    let positions = new Map();
    let manualPositions = new Set();
    let measuredHeights = new Map();
    let snippetCache = new Map();
    let diffCache = new Map();
    let edgeRaf = 0;
    let pendingCenterNodeId = null;

    let cam = { x: 60, y: 60, scale: 1 };

    const NODE_W = 262;
    const X_GAP = 330;
    const Y_PAD = 24;

    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const edgesSvg = document.getElementById('edgesSvg');
    const nodesLayer = document.getElementById('nodesLayer');
    const inspector = document.getElementById('inspector');
    const summaryDrawer = document.getElementById('summaryDrawer');

    function t(key) {
      return (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
    }

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function applyStaticTranslations() {
      document.getElementById('mAtlas').textContent = t('atlas');
      document.getElementById('mBriefing').textContent = t('briefing');
      document.getElementById('mHybrid').textContent = t('hybrid');
      document.getElementById('btnSummaryToggle').textContent = t('summaryBtn');
      document.getElementById('btnPruneToggle').textContent = pruneUnchanged ? t('pruneOn') : t('pruneOff');
      document.getElementById('btnPruneToggle').classList.toggle('active', pruneUnchanged);
      document.getElementById('btnRunImpact').textContent = t('impactBtn');
      document.getElementById('searchInput').placeholder = t('searchPh');
      document.getElementById('btnDeltaToggle').textContent = deltaOverlay ? t('deltaOn') : t('deltaOff');
      document.getElementById('btnFocusToggle').textContent = focusMode ? t('focusOn') : t('focusOff');
      document.getElementById('btnRefresh').textContent = t('refresh');
      document.getElementById('btnInitManifest').textContent = t('initManifest');
      document.getElementById('btnCopyDirs').textContent = t('exportDir');
      document.getElementById('btnVerifyBriefing').textContent = t('verifyJson');
      document.getElementById('btnReverifyStale').textContent = t('reverify');
      document.getElementById('btnLangToggle').textContent = t('langBtn');
      document.getElementById('btnFitView').textContent = t('fit');
      document.getElementById('btnAutoLayout').textContent = t('tidy');
      document.getElementById('btnExpandAll').textContent = t('expand');
      document.getElementById('btnCollapseDomains').textContent = t('collapse');
      document.getElementById('btnLegendToggle').textContent = t('legendBtn');
      document.getElementById('legendPopover').innerHTML = t('legendHtml');
      document.getElementById('summaryDrawerTitle').textContent = t('summaryTitle');
      document.getElementById('tabCode').textContent = t('tabCode');
      document.getElementById('tabDiff').textContent = t('tabDiff');
      document.getElementById('tabDir').textContent = t('tabDir');
      document.getElementById('tabTrust').textContent = t('tabTrust');
      document.getElementById('btnInspFocus').textContent = t('inspFocus');
    }

    function applyCamera() {
      stage.style.transform = 'translate(' + cam.x + 'px, ' + cam.y + 'px) scale(' + cam.scale + ')';
      document.getElementById('zoomLabel').textContent = Math.round(cam.scale * 100) + '%';
    }

    function zoomAroundViewportCenter(nextScale) {
      const clamped = Math.min(2.2, Math.max(0.15, nextScale));
      const rect = viewport.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      cam.x = cx - (cx - cam.x) * (clamped / cam.scale);
      cam.y = cy - (cy - cam.y) * (clamped / cam.scale);
      cam.scale = clamped;
      applyCamera();
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
        for (const cid of childrenMap.get(id) || []) visit(cid);
      }
      for (const r of graph.nodes.filter(n => !n.parentId)) visit(r.id);
      return visible;
    }

    function getFocusedSet() {
      if (!focusMode || !selectedNodeId || !nodeById.has(selectedNodeId)) return null;
      const childrenMap = getChildrenMap();
      const set = new Set();
      let cur = nodeById.get(selectedNodeId);
      while (cur) {
        set.add(cur.id);
        cur = cur.parentId ? nodeById.get(cur.parentId) : null;
      }
      function addDesc(id) {
        set.add(id);
        for (const cid of childrenMap.get(id) || []) addDesc(cid);
      }
      addDesc(selectedNodeId);
      return set;
    }

    function getNodeHeight(id) {
      return measuredHeights.get(id) || 128;
    }

    function computeTidyLayout(forceReset = false) {
      const childrenMap = getChildrenMap();
      const visible = getVisibleNodeIds();
      const subtreeHeights = new Map();

      function measureSubtree(id) {
        const selfH = getNodeHeight(id);
        const kids = (childrenMap.get(id) || []).filter(cid => visible.has(cid));
        if (kids.length === 0) {
          subtreeHeights.set(id, selfH);
          return selfH;
        }
        let sum = 0;
        for (let i = 0; i < kids.length; i++) {
          sum += measureSubtree(kids[i]);
          if (i > 0) sum += Y_PAD;
        }
        const total = Math.max(selfH, sum);
        subtreeHeights.set(id, total);
        return total;
      }

      function placeSubtree(id, depth, bandTop) {
        const selfH = getNodeHeight(id);
        const bandH = subtreeHeights.get(id) || selfH;
        const topY = bandTop + (bandH - selfH) / 2;

        if (forceReset || (!positions.has(id) && !manualPositions.has(id))) {
          positions.set(id, { x: depth * X_GAP, y: topY });
        }

        const kids = (childrenMap.get(id) || []).filter(cid => visible.has(cid));
        if (kids.length === 0) return;

        let kidsTotal = 0;
        for (let i = 0; i < kids.length; i++) {
          kidsTotal += subtreeHeights.get(kids[i]) || getNodeHeight(kids[i]);
          if (i > 0) kidsTotal += Y_PAD;
        }
        let childCursor = bandTop + (bandH - kidsTotal) / 2;
        for (const cid of kids) {
          const ch = subtreeHeights.get(cid) || getNodeHeight(cid);
          placeSubtree(cid, depth + 1, childCursor);
          childCursor += ch + Y_PAD;
        }
      }

      const roots = graph.nodes.filter(n => !n.parentId);
      let rootCursor = 0;
      for (const r of roots) {
        const h = measureSubtree(r.id);
        placeSubtree(r.id, 0, rootCursor);
        rootCursor += h + Y_PAD * 2;
      }
    }

    function centerOnNode(id) {
      const p = positions.get(id);
      if (!p) return;
      const rect = viewport.getBoundingClientRect();
      const h = getNodeHeight(id);
      cam.x = rect.width / 2 - (p.x + NODE_W / 2) * cam.scale;
      cam.y = rect.height / 2 - (p.y + h / 2) * cam.scale;
      applyCamera();
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
        maxY = Math.max(maxY, p.y + getNodeHeight(id));
      }
      const rect = viewport.getBoundingClientRect();
      const pad = 52;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scale = Math.min(1.05, Math.max(0.15, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h)));
      cam.scale = scale;
      cam.x = (rect.width - w * scale) / 2 - minX * scale;
      cam.y = (rect.height - h * scale) / 2 - minY * scale;
      applyCamera();
    }

    function computeFilterSet() {
      if (!activeChipFilter) return null;
      const set = new Set();
      let expandedAny = false;
      let firstHitId = null;
      for (const n of graph.nodes) {
        const hit =
          (activeChipFilter === 'mismatch' && n.badge === 'mismatch') ||
          (activeChipFilter === 'blocking' && n.kind === 'blocking') ||
          (activeChipFilter === 'impact' && n.kind === 'impact') ||
          (activeChipFilter === 'directive' && n.kind === 'directive');
        if (hit) {
          if (!firstHitId) firstHitId = n.id;
          let cur = n;
          while (cur) {
            set.add(cur.id);
            if (cur.id !== n.id && collapsedIds.has(cur.id)) {
              collapsedIds.delete(cur.id);
              expandedAny = true;
            }
            cur = cur.parentId ? nodeById.get(cur.parentId) : null;
          }
        }
      }
      if (expandedAny) {
        manualPositions.clear();
        computeTidyLayout(true);
        buildNodeDom(false);
        if (firstHitId) centerOnNode(firstHitId);
      }
      return set;
    }

    function computeSearchMatches() {
      const q = searchQuery.trim().toLowerCase();
      if (!q) {
        searchMatches = [];
        document.getElementById('searchCount').textContent = '';
        return null;
      }
      const matched = new Set();
      const list = [];
      let expandedAny = false;
      for (const n of graph.nodes) {
        const hay = (n.title + ' ' + (n.subtitle || '') + ' ' + (n.body || '') + ' ' + (n.path || '') + ' ' + (n.layer || '')).toLowerCase();
        if (hay.includes(q)) {
          matched.add(n.id);
          list.push(n.id);
          let cur = n.parentId ? nodeById.get(n.parentId) : null;
          while (cur) {
            if (collapsedIds.has(cur.id)) {
              collapsedIds.delete(cur.id);
              expandedAny = true;
            }
            cur = cur.parentId ? nodeById.get(cur.parentId) : null;
          }
        }
      }
      searchMatches = list;
      if (searchMatchIdx >= list.length) searchMatchIdx = 0;
      document.getElementById('searchCount').textContent = list.length > 0 ? ((searchMatchIdx + 1) + '/' + list.length) : '0/0';
      if (expandedAny) {
        manualPositions.clear();
        computeTidyLayout(true);
        buildNodeDom(false);
      }
      return matched;
    }

    function isNodeDimmed(n, focusedSet, chipSet, matchedIds) {
      if (focusedSet && !focusedSet.has(n.id)) return true;
      if (chipSet && !chipSet.has(n.id)) return true;
      if (deltaOverlay && !n.changed && n.kind !== 'root' && n.kind !== 'directive') return true;
      if (matchedIds && !matchedIds.has(n.id)) return true;
      return false;
    }

    function renderEdges() {
      const visible = getVisibleNodeIds();
      const focusedSet = getFocusedSet();
      const chipSet = computeFilterSet();
      const matchedIds = searchQuery.trim() ? new Set(searchMatches) : null;

      let svgHtml = '';
      for (const e of graph.edges) {
        if (!visible.has(e.from) || !visible.has(e.to)) continue;
        // Progressive disclosure: only draw workspace dependency arcs for the inspected domain
        if (e.kind === 'dep' && selectedNodeId !== e.from && selectedNodeId !== e.to) continue;
        const p1 = positions.get(e.from);
        const p2 = positions.get(e.to);
        if (!p1 || !p2) continue;

        let d = '';
        let mx = 0;
        let my = 0;
        if (e.kind === 'dep' && Math.abs(p1.x - p2.x) < NODE_W) {
          // Same-column vertical arc on the left edge so it never crosses sibling cards
          const x1 = p1.x;
          const y1 = p1.y + getNodeHeight(e.from) / 2;
          const x2 = p2.x;
          const y2 = p2.y + getNodeHeight(e.to) / 2;
          const arcOffset = Math.min(110, Math.max(46, Math.abs(y2 - y1) * 0.22));
          d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 - arcOffset) + ' ' + y1 + ', ' + (x2 - arcOffset) + ' ' + y2 + ', ' + x2 + ' ' + y2;
          mx = x1 - arcOffset * 0.78;
          my = (y1 + y2) / 2;
        } else {
          const x1 = p1.x + NODE_W;
          const y1 = p1.y + getNodeHeight(e.from) / 2;
          const x2 = p2.x;
          const y2 = p2.y + getNodeHeight(e.to) / 2;
          const dx = Math.max(44, Math.abs(x2 - x1) * 0.48);
          d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
          mx = (x1 + x2) / 2;
          my = (y1 + y2) / 2;
        }

        const targetNode = nodeById.get(e.to);
        const dimmed =
          e.kind !== 'dep' && (
            (focusedSet && (!focusedSet.has(e.from) || !focusedSet.has(e.to))) ||
            (chipSet && (!chipSet.has(e.from) || !chipSet.has(e.to))) ||
            (targetNode && deltaOverlay && !targetNode.changed && targetNode.kind !== 'root' && targetNode.kind !== 'directive') ||
            (matchedIds && !matchedIds.has(e.to) && !matchedIds.has(e.from))
          );
        const isFocused = e.kind === 'dep' || (focusedSet && focusedSet.has(e.from) && focusedSet.has(e.to));

        svgHtml += '<path class="edge-path ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + (isFocused ? ' focused' : '') + '" d="' + d + '" />';
        if (e.label) {
          const pw = e.label.length * 8 + 14;
          svgHtml += '<rect class="edge-pill ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + '" x="' + (mx - pw / 2) + '" y="' + (my - 9) + '" width="' + pw + '" height="16" rx="8" />';
          svgHtml += '<text class="edge-label ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + '" x="' + mx + '" y="' + (my + 3) + '" text-anchor="middle">' + esc(e.label) + '</text>';
        }
      }
      edgesSvg.innerHTML = svgHtml;
    }

    function scheduleRenderEdges() {
      if (edgeRaf) return;
      edgeRaf = requestAnimationFrame(() => {
        edgeRaf = 0;
        renderEdges();
      });
    }

    function renderBranchSummaryDrawer() {
      const el = document.getElementById('summaryBody');
      const bs = graph.branchSummary;
      if (!bs) {
        el.innerHTML = '<div style="color:var(--muted);font-size:12px;">' + esc(t('noGit')) + '</div>';
        return;
      }

      let html =
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">' +
          '<code>' + esc(bs.branch) + '</code> vs <code>' + esc(bs.baseRef) + '</code>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">' + esc(t('summaryPruneHint')) + '</div>';

      // Impacted Domains
      html += '<div class="summary-sec">' + esc(t('summaryImpacted')) + ' (' + bs.impactedDomains.length + ')</div>';
      if (bs.impactedDomains.length === 0) {
        html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(t('summaryNoDiff')) + '</div>';
      } else {
        for (const d of bs.impactedDomains) {
          html +=
            '<div class="summary-item" data-jump-node="' + esc(d.nodeId) + '" data-expand-dom="' + esc(d.domainId) + '">' +
              '<div class="summary-item-top">' +
                '<span>' + esc(d.name) + '</span>' +
                '<span><span class="diff-add">+' + d.additions + '</span> <span class="diff-del">-' + d.deletions + '</span></span>' +
              '</div>' +
              '<div class="summary-item-sub">' +
                (d.layer ? esc(d.layer) + ' · ' : '') + d.changedFiles + (lang === 'zh' ? ' 个变更文件' : ' changed files') +
              '</div>' +
            '</div>';
        }
      }

      // Briefing Claims linked directly to Canvas
      if (bs.claimItems && bs.claimItems.length > 0) {
        html += '<div class="summary-sec">' + esc(t('summaryClaims')) + ' (' + bs.claimItems.length + ')</div>';
        for (const c of bs.claimItems) {
          html +=
            '<div class="summary-item" data-jump-node="' + esc(c.nodeId) + '">' +
              '<div class="summary-item-top">' +
                '<span>' + esc(c.id + ' · ' + c.title) + '</span>' +
                '<span class="badge badge-' + esc(c.badge) + '">' + esc((t('badge')[c.badge] || c.badge)) + '</span>' +
              '</div>' +
            '</div>';
        }
      }

      // Commits on this branch
      html += '<div class="summary-sec">' + esc(t('summaryCommits')) + ' (' + bs.commits.length + ')</div>';
      if (bs.commits.length === 0) {
        html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(t('summaryNoCommits')) + '</div>';
      } else {
        for (const cm of bs.commits) {
          html +=
            '<div class="commit-row">' +
              '<span class="commit-sha">' + esc(cm.sha) + '</span>' +
              '<span>' + esc(cm.subject) + '</span>' +
            '</div>';
        }
      }

      el.innerHTML = html;

      el.querySelectorAll('[data-jump-node]').forEach(item => {
        item.addEventListener('click', () => {
          const nid = item.dataset.jumpNode;
          const domId = item.dataset.expandDom;
          if (domId) {
            pendingCenterNodeId = nid;
            vscode.postMessage({ type: 'expandDomainFiles', domainId: domId });
          }
          if (nodeById.has(nid)) {
            collapsedIds.delete(nid);
            selectedNodeId = nid;
            focusMode = true;
            syncFocusButtons();
            selectNode(nid);
            centerOnNode(nid);
          }
        });
      });
    }

    function renderSubbar() {
      const bcEl = document.getElementById('breadcrumbs');
      if (!selectedNodeId || !nodeById.has(selectedNodeId)) {
        bcEl.innerHTML = '<span>' + esc(t('defaultCrumb')) + '</span>';
      } else {
        const chain = [];
        let cur = nodeById.get(selectedNodeId);
        while (cur) {
          chain.unshift(cur);
          cur = cur.parentId ? nodeById.get(cur.parentId) : null;
        }
        bcEl.innerHTML = chain.map((n, idx) =>
          (idx > 0 ? '<span style="opacity:0.4;">›</span>' : '') +
          '<span class="crumb" data-crumb="' + esc(n.id) + '">' + esc(n.title) + '</span>'
        ).join('');
        bcEl.querySelectorAll('[data-crumb]').forEach(el => {
          el.addEventListener('click', () => {
            selectNode(el.dataset.crumb);
            centerOnNode(el.dataset.crumb);
          });
        });
      }

      const s = graph.summary || {};
      const chips = [];
      if (s.verified > 0) chips.push('<span class="chip ok" data-chip="trust">' + (lang === 'zh' ? '已核验 ' : 'Verified ') + s.verified + '</span>');
      if (s.mismatch > 0) chips.push('<span class="chip err' + (activeChipFilter === 'mismatch' ? ' active' : '') + '" data-chip="mismatch">' + (lang === 'zh' ? '失配 ' : 'Mismatch ') + s.mismatch + '</span>');
      if (s.stale > 0) chips.push('<span class="chip warn" data-chip="trust">' + (lang === 'zh' ? '过期 ' : 'Stale ') + s.stale + '</span>');
      if (s.blockingCount > 0) chips.push('<span class="chip warn' + (activeChipFilter === 'blocking' ? ' active' : '') + '" data-chip="blocking">' + (lang === 'zh' ? '阻断 ' : 'Guards ') + s.blockingCount + '</span>');
      if (s.impactCount > 0) chips.push('<span class="chip' + (activeChipFilter === 'impact' ? ' active' : '') + '" style="color:#39c5cf;background:rgba(57,197,207,0.16);" data-chip="impact">' + (lang === 'zh' ? '间接影响 ' : 'Impact ') + s.impactCount + '</span>');
      if (s.manifestIssues && s.manifestIssues.length > 0) chips.push('<span class="chip err" data-chip="trust">' + (lang === 'zh' ? '骨架漂移 ' : 'Manifest Drift ') + s.manifestIssues.length + '</span>');
      if (s.signals && s.signals.length > 0) chips.push('<span class="chip" data-chip="trust">' + (lang === 'zh' ? '信号 ' : 'Signals ') + s.signals.length + '</span>');
      if (s.blindSpots && s.blindSpots.length > 0) chips.push('<span class="chip warn" data-chip="trust">' + (lang === 'zh' ? '盲区 ' : 'Blind Spots ') + s.blindSpots.length + '</span>');
      if (s.directiveCount > 0) chips.push('<span class="chip dir' + (activeChipFilter === 'directive' ? ' active' : '') + '" data-chip="directive">' + (lang === 'zh' ? '批注 ' : 'Directives ') + s.directiveCount + '</span>');
      if (s.prunedCount > 0) chips.push('<span class="chip">' + (lang === 'zh' ? '已剪枝 ' : 'Pruned ') + s.prunedCount + '</span>');
      if (s.hiddenSupportFiles > 0 || showSupportAssets) {
        const supLabel = showSupportAssets
          ? (lang === 'zh' ? '已显示非源码资源' : 'Support/Assets: ON')
          : (lang === 'zh' ? '已折叠非源码 ' + s.hiddenSupportFiles + ' 文件' : 'Hidden Assets/Config ' + s.hiddenSupportFiles);
        chips.push('<span class="chip' + (showSupportAssets ? ' active' : '') + '" data-chip="toggleSupport" title="' + (lang === 'zh' ? '点击切换显示/隐藏静态资源与配置目录' : 'Toggle non-code support & asset domains') + '">' + supLabel + '</span>');
      }

      const tc = document.getElementById('trustChips');
      tc.innerHTML = chips.join('');
      tc.querySelectorAll('[data-chip]').forEach(el => {
        el.addEventListener('click', () => {
          const kind = el.dataset.chip;
          if (kind === 'toggleSupport') {
            vscode.postMessage({ type: 'toggleSupportAssets' });
            return;
          }
          if (kind === 'trust') {
            inspectorTab = 'trust';
            selectNode('root');
            return;
          }
          activeChipFilter = activeChipFilter === kind ? '' : kind;
          syncVisualClasses();
        });
      });
    }

    function syncVisualClasses() {
      const focusedSet = getFocusedSet();
      const chipSet = computeFilterSet();
      const matchedIds = computeSearchMatches();

      nodesLayer.querySelectorAll('.node').forEach(el => {
        const n = nodeById.get(el.dataset.id);
        if (!n) return;
        el.classList.toggle('selected', selectedNodeId === n.id);
        el.classList.toggle('dimmed', isNodeDimmed(n, focusedSet, chipSet, matchedIds));
      });
      renderEdges();
      renderSubbar();
    }

    function buildNodeDom(remeasure = false) {
      const childrenMap = getChildrenMap();
      const visible = getVisibleNodeIds();
      nodesLayer.innerHTML = '';
      const kindLabels = t('kind');
      const badgeLabels = t('badge');

      for (const n of graph.nodes) {
        if (!visible.has(n.id)) continue;
        const p = positions.get(n.id) || { x: 0, y: 0 };
        const kids = childrenMap.get(n.id) || [];
        const isCollapsed = collapsedIds.has(n.id);

        const el = document.createElement('div');
        el.className = 'node kind-' + n.kind + (n.isSummary ? ' is-summary' : '');
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        el.dataset.id = n.id;

        const diffHtml = n.changed && (n.additions !== undefined || n.deletions !== undefined)
          ? '<span><span class="diff-add">+' + (n.additions || 0) + '</span> <span class="diff-del">-' + (n.deletions || 0) + '</span></span>'
          : (n.changed ? '<span style="color:var(--yellow);">' + (lang === 'zh' ? '有变更' : 'modified') + '</span>' : '<span></span>');

        let middleHtml = '';
        if (n.kind === 'blocking' && n.condition) {
          middleHtml =
            '<div class="blocking-box">' +
              '<div class="blocking-if">IF: ' + esc(n.condition) + '</div>' +
              '<div class="blocking-then">→ ' + esc(n.outcome || '') + '</div>' +
            '</div>';
        } else if (n.body) {
          middleHtml = '<div class="node-body">' + esc(n.body) + '</div>';
        }

        let footerRight = '';
        if (n.kind === 'domain' && n.canExpandFiles && n.domainId) {
          const lbl = n.filesExpanded
            ? t('collapseDomainFiles')
            : (t('expandDomainFiles') + ' (' + (n.fileCount || 0) + ')');
          footerRight = '<button class="quick-btn" data-toggle-dom="' + esc(n.domainId) + '">' + esc(lbl) + '</button>';
        } else if (n.kind === 'folder' && n.canExpandFiles && n.folderId) {
          const lbl = n.filesExpanded
            ? t('collapseDomainFiles')
            : (t('expandDomainFiles') + ' (' + (n.fileCount || 0) + ')');
          footerRight = '<button class="quick-btn" data-toggle-folder="' + esc(n.folderId) + '">' + esc(lbl) + '</button>';
        } else if (n.path) {
          footerRight = '<button class="quick-btn quick-jump" data-jump-path="' + esc(n.path) + '" data-jump-line="' + esc(n.startLine || 1) + '">' + esc(t('openBtn')) + '</button>';
        } else if (kids.length > 0) {
          footerRight = '<span>' + kids.length + (lang === 'zh' ? ' 项' : ' items') + '</span>';
        }

        const topRight = n.badge
          ? '<span class="badge badge-' + esc(n.badge) + '">' + esc(badgeLabels[n.badge] || n.badge) + '</span>'
          : (n.layer ? '<span class="layer-tag" title="' + esc(n.layer) + '">' + esc(n.layer) + '</span>' : '');

        el.innerHTML =
          '<div class="node-top">' +
            '<span class="node-kind">' + esc(kindLabels[n.kind] || n.kind) + '</span>' +
            topRight +
          '</div>' +
          '<div class="node-title">' + esc(n.title) + '</div>' +
          (n.subtitle ? '<div class="node-sub" title="' + esc(n.subtitle) + '">' + esc(n.subtitle) + '</div>' : '') +
          middleHtml +
          '<div class="node-footer">' + diffHtml + footerRight + '</div>';

        const qj = el.querySelector('[data-jump-path]');
        if (qj) {
          qj.addEventListener('mousedown', (ev) => ev.stopPropagation());
          qj.addEventListener('click', (ev) => {
            ev.stopPropagation();
            vscode.postMessage({ type: 'openFile', path: qj.dataset.jumpPath, line: parseInt(qj.dataset.jumpLine || '1', 10) });
          });
        }

        const domToggle = el.querySelector('[data-toggle-dom]');
        if (domToggle) {
          domToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
          domToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            pendingCenterNodeId = n.id;
            collapsedIds.delete(n.id);
            vscode.postMessage({ type: 'toggleDomainFiles', domainId: domToggle.dataset.toggleDom });
          });
        }

        const folderToggle = el.querySelector('[data-toggle-folder]');
        if (folderToggle) {
          folderToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
          folderToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            pendingCenterNodeId = n.id;
            collapsedIds.delete(n.id);
            vscode.postMessage({ type: 'toggleFolderFiles', folderId: folderToggle.dataset.toggleFolder });
          });
        }

        if (kids.length > 0) {
          const btn = document.createElement('button');
          btn.className = 'collapse-btn';
          btn.textContent = isCollapsed ? String(kids.length) : '−';
          btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (collapsedIds.has(n.id)) collapsedIds.delete(n.id);
            else collapsedIds.add(n.id);
            manualPositions.clear();
            computeTidyLayout(true);
            buildNodeDom(false);
          });
          el.appendChild(btn);
        }

        el.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          selectedNodeId = n.id;
          focusMode = !focusMode;
          syncFocusButtons();
          syncVisualClasses();
          centerOnNode(n.id);
        });

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
              manualPositions.add(n.id);
              positions.set(n.id, { x: startPos.x + dx, y: startPos.y + dy });
              el.style.left = (startPos.x + dx) + 'px';
              el.style.top = (startPos.y + dy) + 'px';
              scheduleRenderEdges();
            }
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!dragged) selectNode(n.id);
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        nodesLayer.appendChild(el);
      }

      if (remeasure) {
        let changed = false;
        nodesLayer.querySelectorAll('.node').forEach(el => {
          const h = el.offsetHeight;
          if (h > 0 && Math.abs((measuredHeights.get(el.dataset.id) || 0) - h) > 3) {
            measuredHeights.set(el.dataset.id, h);
            changed = true;
          }
        });
        if (changed && manualPositions.size === 0) {
          computeTidyLayout(true);
          nodesLayer.querySelectorAll('.node').forEach(el => {
            const p = positions.get(el.dataset.id);
            if (p) {
              el.style.left = p.x + 'px';
              el.style.top = p.y + 'px';
            }
          });
        }
      }

      syncVisualClasses();
    }

    function syncFocusButtons() {
      const btn = document.getElementById('btnFocusToggle');
      btn.textContent = focusMode ? t('focusOn') : t('focusOff');
      btn.classList.toggle('active', focusMode);
      const ibtn = document.getElementById('btnInspFocus');
      if (ibtn) ibtn.classList.toggle('active', focusMode);
    }

    function selectNode(nodeId) {
      selectedNodeId = nodeId;
      const node = nodeById.get(nodeId);
      if (!node) {
        inspector.classList.add('hidden');
        syncVisualClasses();
        return;
      }
      inspector.classList.remove('hidden');
      document.getElementById('inspTitle').textContent = node.title;
      syncVisualClasses();
      renderInspector(node);
      if (node.path) {
        if (!snippetCache.has(node.id)) {
          vscode.postMessage({
            type: 'requestSnippet',
            nodeId: node.id,
            path: node.path,
            startLine: node.startLine || 1,
            endLine: node.endLine || (node.startLine || 1),
            fromBriefing: Boolean(node.fromBriefing)
          });
        }
        if (!diffCache.has(node.id)) {
          vscode.postMessage({
            type: 'requestDiff',
            nodeId: node.id,
            path: node.path
          });
        }
      }
    }

    function renderInspector(node) {
      const el = document.getElementById('inspContent');
      document.querySelectorAll('.insp-tab').forEach(tb => {
        tb.classList.toggle('active', tb.dataset.itab === inspectorTab);
      });
      const kindLabels = t('kind');
      const badgeLabels = t('badge');

      if (inspectorTab === 'trust') {
        const s = graph.summary || {};
        let html = '<div style="font-weight:600;margin-bottom:6px;">' + esc(t('signalsTitle')) + '</div>';
        if (!s.signals || s.signals.length === 0) {
          html += '<div style="color:var(--muted);font-size:12px;margin-bottom:12px;">' + esc(t('noSignals')) + '</div>';
        } else {
          for (const sig of s.signals) {
            const sb = sig.status === 'passed' ? 'verified' : (sig.status === 'failed' ? 'mismatch' : 'unknown');
            html +=
              '<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:8px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;"><strong>' + esc(sig.kind) + '</strong><span class="badge badge-' + sb + '">' + esc(sig.status) + '</span></div>' +
                '<div style="font-size:12px;margin-top:4px;">' + esc(sig.description) + '</div>' +
                (sig.command ? '<div style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:4px;">' + esc(sig.command) + '</div>' : '') +
              '</div>';
          }
        }

        html += '<div style="font-weight:600;margin:12px 0 6px;color:var(--amber);">' + esc(t('blindSpotsTitle')) + '</div>';
        if (!s.blindSpots || s.blindSpots.length === 0) {
          html += '<div style="color:var(--muted);font-size:12px;margin-bottom:12px;">' + esc(t('noBlindSpots')) + '</div>';
        } else {
          html += '<ul style="margin:0 0 12px;padding-left:18px;font-size:12px;">' + s.blindSpots.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>';
        }

        html += '<div style="font-weight:600;margin:12px 0 6px;">' + esc(t('guardrailsTitle')) + '</div>';
        if (!s.guardrails || s.guardrails.length === 0) {
          html += '<div style="color:var(--muted);font-size:12px;">' + esc(t('noGuardrails')) + '</div>';
        } else {
          html += '<ul style="margin:0;padding-left:18px;font-size:12px;">' + s.guardrails.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>';
        }

        if (s.manifestIssues && s.manifestIssues.length > 0) {
          html += '<div style="font-weight:600;margin:12px 0 6px;color:var(--red);">' + (lang === 'zh' ? 'Manifest 漂移与校验告警' : 'Manifest Drift Issues') + '</div>';
          for (const mi of s.manifestIssues) {
            html += '<div style="font-size:11.5px;color:var(--red);margin-bottom:5px;">[' + esc(mi.domainId) + '] ' + esc(mi.target) + ': ' + esc(mi.message) + '</div>';
          }
        }
        if (s.impactStatus && s.impactStatus !== 'ok' && s.impactReason) {
          html += '<div style="font-weight:600;margin:12px 0 6px;color:var(--amber);">' + (lang === 'zh' ? 'LSP 影响面状态' : 'LSP Impact Status') + '</div>';
          html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(s.impactReason) + '</div>';
        }

        el.innerHTML = html;
        return;
      }

      if (inspectorTab === 'diff') {
        if (!node.path) {
          el.innerHTML = '<div style="color:var(--muted);">' + esc(t('notFileNode')) + '</div>';
          return;
        }
        const diffText = diffCache.get(node.id);
        if (diffText === undefined) {
          el.innerHTML = '<div style="color:var(--muted);">' + esc(t('loadingDiff')) + '</div>';
          return;
        }
        if (!diffText.trim()) {
          el.innerHTML = '<div style="color:var(--muted);">' + esc(t('noDiffForFile')) + '<code>' + esc(node.path) + '</code></div>';
          return;
        }
        let dHtml = '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">vs <code>' + esc(baseRef) + '</code></div><div class="code-box">';
        for (const line of diffText.split(/\\r?\\n/)) {
          let cls = '';
          if (line.startsWith('+') && !line.startsWith('+++')) cls = ' diff-plus';
          else if (line.startsWith('-') && !line.startsWith('---')) cls = ' diff-minus';
          else if (line.startsWith('@@')) cls = ' diff-hunk';
          dHtml += '<div class="code-line' + cls + '"><span>' + esc(line) + '</span></div>';
        }
        dHtml += '</div>';
        el.innerHTML = dHtml;
        return;
      }

      if (inspectorTab === 'directive') {
        const defaultPath = node.defaultDirectivePath || node.path || '';
        el.innerHTML =
          '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">' + esc(t('dirHelp')) + ' <strong>' + esc(node.title) + '</strong></div>' +
          '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
            '<select id="inspDirKind">' +
              '<option value="rework">' + (lang === 'zh' ? '返工' : 'Rework') + '</option>' +
              '<option value="constraint">' + (lang === 'zh' ? '约束红线' : 'Constraint') + '</option>' +
              '<option value="question">' + (lang === 'zh' ? '疑问' : 'Question') + '</option>' +
            '</select>' +
            '<input id="inspDirPath" value="' + esc(defaultPath) + '" placeholder="relative/path.ts" style="flex:1;" />' +
            '<input id="inspDirLine" type="number" min="1" value="' + esc(node.startLine || 1) + '" style="width:68px;" />' +
          '</div>' +
          '<textarea id="inspDirNote" rows="4" style="width:100%;" placeholder="' + esc(t('dirPlaceholder')) + '"></textarea>' +
          '<div id="dirValidation" style="font-size:11px;color:var(--red);margin-top:4px;min-height:15px;"></div>' +
          '<div style="display:flex;gap:6px;margin-top:6px;">' +
            '<button id="btnAddCanvasDir" disabled>' + esc(t('dirWireBtn')) + '</button>' +
            '<button class="secondary" id="btnInspCopyDirs">' + esc(t('dirCopyBtn')) + '</button>' +
          '</div>';

        const pathInput = document.getElementById('inspDirPath');
        const noteInput = document.getElementById('inspDirNote');
        const addBtn = document.getElementById('btnAddCanvasDir');
        const valEl = document.getElementById('dirValidation');

        function validateForm() {
          const p = pathInput.value.trim();
          const n = noteInput.value.trim();
          if (!p) { valEl.textContent = t('dirPathReq'); addBtn.disabled = true; }
          else if (!n) { valEl.textContent = ''; addBtn.disabled = true; }
          else { valEl.textContent = ''; addBtn.disabled = false; }
        }
        pathInput.addEventListener('input', validateForm);
        noteInput.addEventListener('input', validateForm);
        validateForm();

        addBtn.addEventListener('click', () => {
          const note = noteInput.value.trim();
          const p = pathInput.value.trim();
          const kind = document.getElementById('inspDirKind').value;
          const line = parseInt(document.getElementById('inspDirLine').value, 10);
          if (!note || !p) return;
          vscode.postMessage({
            type: 'addDirective',
            kind,
            path: p,
            startLine: Number.isFinite(line) ? line : 1,
            targetNodeId: node.id,
            note
          });
          inspectorTab = 'overview';
        });
        document.getElementById('btnInspCopyDirs').addEventListener('click', () => {
          vscode.postMessage({ type: 'copyDirectives' });
        });
        return;
      }

      // Overview & Code tab
      const snippet = snippetCache.get(node.id);
      let html =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<span class="node-kind">' + esc(kindLabels[node.kind] || node.kind) + '</span>' +
          (node.badge ? '<span class="badge badge-' + esc(node.badge) + '">' + esc(badgeLabels[node.badge] || node.badge) + '</span>' : '') +
          (node.layer ? '<span class="layer-tag">' + esc(node.layer) + '</span>' : '') +
        '</div>';

      if (node.subtitle) {
        html += '<div style="font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-bottom:8px;">' + esc(node.subtitle) + '</div>';
      }
      if (node.kind === 'blocking' && node.condition) {
        html +=
          '<div class="blocking-box" style="margin-bottom:10px;">' +
            '<div class="blocking-if">IF: ' + esc(node.condition) + '</div>' +
            '<div class="blocking-then">→ ' + esc(node.outcome || '') + '</div>' +
          '</div>';
      } else if (node.body) {
        html += '<p style="margin:0 0 10px;">' + esc(node.body) + '</p>';
      }

      if (node.notes && node.notes.length > 0) {
        for (const nt of node.notes) {
          html += '<div style="font-size:11.5px;color:var(--red);margin-bottom:4px;">! ' + esc(nt) + '</div>';
        }
      }

      if (node.directiveId) {
        html += '<div style="margin:8px 0;"><button class="danger" id="btnRemoveDir">' + esc(t('delDirBtn')) + '</button></div>';
      }

      // Show clickable internal workspace dependencies for Domain nodes
      if (node.kind === 'domain') {
        const depsOut = graph.edges.filter(e => e.kind === 'dep' && e.from === node.id).map(e => nodeById.get(e.to)).filter(Boolean);
        const depsIn = graph.edges.filter(e => e.kind === 'dep' && e.to === node.id).map(e => nodeById.get(e.from)).filter(Boolean);
        if (depsOut.length > 0 || depsIn.length > 0) {
          html += '<div style="margin:10px 0;padding:8px;border:1px solid var(--border);border-radius:6px;">';
          if (depsOut.length > 0) {
            html += '<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;">' + (lang === 'zh' ? '依赖的模块 (Depends On)' : 'Depends On') + '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">' +
              depsOut.map(d => '<span class="chip" data-dep-jump="' + esc(d.id) + '">→ ' + esc(d.title) + '</span>').join('') + '</div>';
          }
          if (depsIn.length > 0) {
            html += '<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;">' + (lang === 'zh' ? '被以下模块依赖 (Used By)' : 'Used By') + '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">' +
              depsIn.map(d => '<span class="chip" data-dep-jump="' + esc(d.id) + '">← ' + esc(d.title) + '</span>').join('') + '</div>';
          }
          html += '</div>';
        }
      }

      if (node.path) {
        html +=
          '<div style="display:flex;gap:6px;align-items:center;margin:10px 0;">' +
            '<button id="btnJumpCode">' + esc(t('jumpEditor')) + '</button>' +
            (snippet && snippet.refUsed ? '<span style="font-family:var(--mono);font-size:10.5px;color:var(--muted);">ref: ' + esc(snippet.refUsed) + '</span>' : '') +
          '</div>';
        if (snippet && snippet.error) {
          html += '<div style="padding:8px;border-radius:5px;background:rgba(248,81,73,0.14);color:var(--red);font-size:11.5px;">' + esc(snippet.error) + '</div>';
        } else if (snippet && snippet.lines && snippet.lines.length > 0) {
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
          html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(t('loadingSnippet')) + '</div>';
        }
      }

      el.innerHTML = html;

      const jumpBtn = document.getElementById('btnJumpCode');
      if (jumpBtn && node.path) {
        jumpBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'openFile', path: node.path, line: node.startLine || 1 });
        });
      }
      const delBtn = document.getElementById('btnRemoveDir');
      if (delBtn && node.directiveId) {
        delBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'removeDirective', id: node.directiveId });
          selectedNodeId = null;
          inspector.classList.add('hidden');
        });
      }
      el.querySelectorAll('[data-dep-jump]').forEach(chip => {
        chip.addEventListener('click', () => {
          selectNode(chip.dataset.depJump);
          centerOnNode(chip.dataset.depJump);
        });
      });
    }

    // Bind UI events
    document.querySelectorAll('.insp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        inspectorTab = btn.dataset.itab;
        const cur = selectedNodeId ? nodeById.get(selectedNodeId) : nodeById.get('root');
        if (cur) renderInspector(cur);
      });
    });

    document.querySelectorAll('#modeControl button').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.mode;
        document.querySelectorAll('#modeControl button').forEach(b => b.classList.toggle('active', b === btn));
        positions.clear();
        manualPositions.clear();
        collapsedIds.clear();
        vscode.postMessage({ type: 'setMode', mode: viewMode });
      });
    });

    document.getElementById('briefingSelect').addEventListener('change', (ev) => {
      if (ev.target.value) vscode.postMessage({ type: 'selectBriefing', path: ev.target.value });
    });
    document.getElementById('baseRefSelect').addEventListener('change', (ev) => {
      if (ev.target.value) {
        baseRef = ev.target.value;
        vscode.postMessage({ type: 'setBaseRef', baseRef });
      }
    });
    document.getElementById('btnLangToggle').addEventListener('click', () => {
      lang = lang === 'zh' ? 'en' : 'zh';
      vscode.postMessage({ type: 'setLang', lang });
    });
    document.getElementById('btnSummaryToggle').addEventListener('click', () => {
      summaryOpen = !summaryOpen;
      summaryDrawer.classList.toggle('hidden', !summaryOpen);
      document.getElementById('btnSummaryToggle').classList.toggle('active', summaryOpen);
    });
    document.getElementById('btnCloseSummary').addEventListener('click', () => {
      summaryOpen = false;
      summaryDrawer.classList.add('hidden');
      document.getElementById('btnSummaryToggle').classList.remove('active');
    });
    document.getElementById('btnPruneToggle').addEventListener('click', () => {
      pruneUnchanged = !pruneUnchanged;
      positions.clear();
      manualPositions.clear();
      vscode.postMessage({ type: 'setPruneUnchanged', value: pruneUnchanged });
    });
    document.getElementById('btnRunImpact').addEventListener('click', () => {
      vscode.postMessage({ type: 'runImpactAnalysis' });
    });

    document.getElementById('btnIndexFiles').addEventListener('click', () => {
      const domainNodes = graph.nodes.filter(n => n.kind === 'domain' && n.domainId);
      const anyExpanded = domainNodes.some(n => n.filesExpanded);
      positions.clear();
      manualPositions.clear();
      if (anyExpanded) {
        vscode.postMessage({ type: 'collapseAllFiles' });
      } else {
        vscode.postMessage({ type: 'expandAllFiles', domainIds: domainNodes.map(n => n.domainId) });
      }
    });

    // Pan & Zoom
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

    viewport.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.12 : 0.89;
      const nextScale = Math.min(2.2, Math.max(0.15, cam.scale * factor));
      cam.x = mx - (mx - cam.x) * (nextScale / cam.scale);
      cam.y = my - (my - cam.y) * (nextScale / cam.scale);
      cam.scale = nextScale;
      applyCamera();
    }, { passive: false });

    document.getElementById('btnZoomIn').addEventListener('click', () => zoomAroundViewportCenter(cam.scale * 1.2));
    document.getElementById('btnZoomOut').addEventListener('click', () => zoomAroundViewportCenter(cam.scale * 0.83));
    document.getElementById('btnFitView').addEventListener('click', fitView);
    document.getElementById('btnAutoLayout').addEventListener('click', () => {
      manualPositions.clear();
      computeTidyLayout(true);
      buildNodeDom(true);
      fitView();
    });
    document.getElementById('btnExpandAll').addEventListener('click', () => {
      collapsedIds.clear();
      manualPositions.clear();
      computeTidyLayout(true);
      buildNodeDom(true);
      fitView();
    });
    document.getElementById('btnCollapseDomains').addEventListener('click', () => {
      collapsedIds.clear();
      for (const n of graph.nodes) {
        if (n.kind === 'domain' || n.kind === 'claim') collapsedIds.add(n.id);
      }
      manualPositions.clear();
      computeTidyLayout(true);
      buildNodeDom(true);
      fitView();
    });
    document.getElementById('btnDeltaToggle').addEventListener('click', (ev) => {
      deltaOverlay = !deltaOverlay;
      ev.target.textContent = deltaOverlay ? t('deltaOn') : t('deltaOff');
      ev.target.classList.toggle('active', deltaOverlay);
      syncVisualClasses();
    });
    document.getElementById('btnFocusToggle').addEventListener('click', () => {
      focusMode = !focusMode;
      syncFocusButtons();
      syncVisualClasses();
    });
    document.getElementById('btnInspFocus').addEventListener('click', () => {
      focusMode = !focusMode;
      syncFocusButtons();
      syncVisualClasses();
    });
    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh', baseRef }));
    document.getElementById('btnInitManifest').addEventListener('click', () => vscode.postMessage({ type: 'initManifestDraft' }));
    document.getElementById('btnReverifyStale').addEventListener('click', () => vscode.postMessage({ type: 'refresh', baseRef }));
    document.getElementById('btnVerifyBriefing').addEventListener('click', () => vscode.postMessage({ type: 'pickBriefing' }));
    document.getElementById('btnEmptyVerify').addEventListener('click', () => vscode.postMessage({ type: 'pickBriefing' }));
    document.getElementById('btnCopyDirs').addEventListener('click', () => vscode.postMessage({ type: 'copyDirectives' }));
    document.getElementById('btnLegendToggle').addEventListener('click', () => {
      document.getElementById('legendPopover').classList.toggle('hidden');
    });
    document.getElementById('btnCloseInsp').addEventListener('click', () => {
      selectedNodeId = null;
      focusMode = false;
      syncFocusButtons();
      inspector.classList.add('hidden');
      syncVisualClasses();
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (ev) => {
      searchQuery = ev.target.value;
      searchMatchIdx = 0;
      syncVisualClasses();
      if (searchMatches.length > 0) centerOnNode(searchMatches[0]);
    });
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && searchMatches.length > 0) {
        ev.preventDefault();
        searchMatchIdx = (searchMatchIdx + 1) % searchMatches.length;
        document.getElementById('searchCount').textContent = (searchMatchIdx + 1) + '/' + searchMatches.length;
        selectNode(searchMatches[searchMatchIdx]);
        centerOnNode(searchMatches[searchMatchIdx]);
      }
    });

    window.addEventListener('keydown', (ev) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (ev.key === 'Escape') {
        if (inInput) {
          document.activeElement.blur();
          if (searchQuery) { searchQuery = ''; searchInput.value = ''; syncVisualClasses(); }
          return;
        }
        if (searchQuery || activeChipFilter) {
          searchQuery = ''; searchInput.value = ''; activeChipFilter = ''; syncVisualClasses();
        } else if (focusMode) {
          focusMode = false; syncFocusButtons(); syncVisualClasses();
        } else if (selectedNodeId) {
          selectedNodeId = null; inspector.classList.add('hidden'); syncVisualClasses();
        }
        return;
      }
      if (inInput) return;
      if (ev.key === '/') { ev.preventDefault(); searchInput.focus(); }
      else if (ev.key === 'f' || ev.key === 'F') fitView();
      else if (ev.key === '0') zoomAroundViewportCenter(1);
      else if (ev.key === 'd' || ev.key === 'D') document.getElementById('btnDeltaToggle').click();
      else if (ev.key === 'e' || ev.key === 'E') document.getElementById('btnExpandAll').click();
      else if (ev.key === 'c' || ev.key === 'C') document.getElementById('btnCollapseDomains').click();
      else if (ev.key === 'Enter' && selectedNodeId) {
        const cur = nodeById.get(selectedNodeId);
        if (cur && cur.path) vscode.postMessage({ type: 'openFile', path: cur.path, line: cur.startLine || 1 });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'canvasState') {
        const prevCount = graph.nodes.length;
        const incomingBriefing = msg.payload.activeBriefingPath || '';
        const briefingChanged = incomingBriefing !== lastBriefingKey;
        lastBriefingKey = incomingBriefing;

        lang = msg.payload.lang || lang;
        pruneUnchanged = Boolean(msg.payload.pruneUnchanged);
        showSupportAssets = Boolean(msg.payload.showSupportAssets);
        snippetCache.clear();
        diffCache.clear();

        gitCtx = msg.payload.git;
        baseRef = msg.payload.baseRef || 'HEAD';
        graph = msg.payload.graph || { mode: viewMode, nodes: [], edges: [], summary: {} };
        viewMode = graph.mode || 'hybrid';
        document.querySelectorAll('#modeControl button').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === viewMode);
        });
        nodeById = new Map(graph.nodes.map(n => [n.id, n]));
        availableBriefings = msg.payload.availableBriefings || [];
        activeBriefingPath = incomingBriefing;

        applyStaticTranslations();

        // Primary workflow: show Save Skeleton CTA only when repo has no .atlas/manifest.json
        const initBtn = document.getElementById('btnInitManifest');
        initBtn.style.display = (gitCtx && graph.architecture && !graph.architecture.hasManifest) ? 'inline-block' : 'none';

        // Architecture pill + small-project 1-click file expansion button
        const archPill = document.getElementById('archPill');
        const indexBtn = document.getElementById('btnIndexFiles');
        if (graph.architecture) {
          const a = graph.architecture;
          archPill.style.display = 'inline-block';
          archPill.textContent = (lang === 'zh' ? a.patternLabelZh : a.patternLabelEn) + ' · ' + a.totalFiles + (lang === 'zh' ? ' 文件' : ' files');
          if (a.scale === 'small' && viewMode !== 'briefing') {
            const anyExp = graph.nodes.some(n => n.kind === 'domain' && n.filesExpanded);
            indexBtn.style.display = 'inline-block';
            indexBtn.textContent = anyExp ? t('collapseFiles') : t('indexFiles');
          } else {
            indexBtn.style.display = 'none';
          }
        } else {
          archPill.style.display = 'none';
          indexBtn.style.display = 'none';
        }

        const bSel = document.getElementById('briefingSelect');
        if (availableBriefings.length === 0) {
          bSel.style.display = 'none';
        } else {
          bSel.style.display = 'inline-block';
          bSel.innerHTML = '<option value="">' + esc(t('selectBriefing')) + '</option>' +
            availableBriefings.map(b =>
              '<option value="' + esc(b.path) + '"' + (b.path === activeBriefingPath ? ' selected' : '') + '>' + esc(b.label) + '</option>'
            ).join('');
        }

        const rSel = document.getElementById('baseRefSelect');
        const refs = (gitCtx && gitCtx.recentRefs) ? gitCtx.recentRefs : ['HEAD'];
        rSel.innerHTML = refs.map(r =>
          '<option value="' + esc(r) + '"' + (r === baseRef ? ' selected' : '') + '>vs ' + esc(r) + '</option>'
        ).join('');

        const staleEl = document.getElementById('staleBanner');
        if (graph.summary && graph.summary.isStale) {
          staleEl.classList.remove('hidden');
          document.getElementById('staleBannerText').textContent = t('staleText')(graph.summary.targetRefClaimed || '?', gitCtx?.shortSha || '?');
        } else {
          staleEl.classList.add('hidden');
        }

        const emptyEl = document.getElementById('emptyOverlay');
        if (msg.payload.error) {
          emptyEl.classList.remove('hidden');
          document.getElementById('emptyTitle').textContent = t('noGit');
          document.getElementById('emptyDesc').textContent = msg.payload.error;
          document.getElementById('btnEmptyVerify').style.display = 'none';
        } else if (graph.mode === 'briefing' && !(graph.summary && graph.summary.hasBriefing)) {
          emptyEl.classList.remove('hidden');
          document.getElementById('emptyTitle').textContent = t('emptyBriefingTitle');
          document.getElementById('emptyDesc').textContent = t('emptyBriefingDesc');
          document.getElementById('btnEmptyVerify').textContent = t('verifyJson');
          document.getElementById('btnEmptyVerify').style.display = 'inline-block';
        } else {
          emptyEl.classList.add('hidden');
        }

        document.getElementById('gitPill').textContent = gitCtx
          ? (gitCtx.branch + ' @ ' + gitCtx.shortSha)
          : t('noGit');

        // Auto-open Branch Summary if user has changes and it's first load? Keep toggle button badge visible
        const sumBtn = document.getElementById('btnSummaryToggle');
        const diffCnt = (graph.summary && graph.summary.changedFiles) || 0;
        sumBtn.textContent = t('summaryBtn') + (diffCnt > 0 ? ' (' + diffCnt + ')' : '');

        const topologyKey = graph.nodes.map(n => n.id + '@' + (n.parentId || '')).join('|');
        const topologyChanged = topologyKey !== lastTopologyKey;
        lastTopologyKey = topologyKey;

        const shouldReset = prevCount === 0 || briefingChanged || positions.size === 0;
        if (briefingChanged) {
          positions.clear();
          manualPositions.clear();
          collapsedIds.clear();
        }
        if (topologyChanged) {
          manualPositions.clear();
          for (const id of [...positions.keys()]) {
            if (!nodeById.has(id)) positions.delete(id);
          }
        }
        if (shouldReset && graph.nodes.length > 28) {
          for (const n of graph.nodes) {
            if (n.kind === 'domain') collapsedIds.add(n.id);
          }
        }

        if (selectedNodeId && !nodeById.has(selectedNodeId)) {
          selectedNodeId = null;
          focusMode = false;
          syncFocusButtons();
          inspector.classList.add('hidden');
        }

        computeTidyLayout(shouldReset || topologyChanged || manualPositions.size === 0);
        buildNodeDom(true);
        renderBranchSummaryDrawer();

        if (pendingCenterNodeId && nodeById.has(pendingCenterNodeId)) {
          centerOnNode(pendingCenterNodeId);
          pendingCenterNodeId = null;
        } else if (shouldReset) {
          fitView();
        }

        if (selectedNodeId && nodeById.has(selectedNodeId)) {
          selectNode(selectedNodeId);
        }
      } else if (msg.type === 'snippet') {
        snippetCache.set(msg.payload.nodeId, msg.payload);
        if (selectedNodeId === msg.payload.nodeId && inspectorTab === 'overview') {
          const cur = nodeById.get(selectedNodeId);
          if (cur) renderInspector(cur);
        }
      } else if (msg.type === 'fileDiff') {
        diffCache.set(msg.payload.nodeId, msg.payload.diff);
        if (selectedNodeId === msg.payload.nodeId && inspectorTab === 'diff') {
          const cur = nodeById.get(selectedNodeId);
          if (cur) renderInspector(cur);
        }
      }
    });

    applyStaticTranslations();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
