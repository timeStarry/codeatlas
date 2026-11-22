import { getFileIconsClientJs } from './fileIcons.js';

export interface CanvasHtmlOptions {
  host?: 'vscode' | 'mcp-app';
  inlineClientJs?: string;
  initialWorktreePath?: string;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getCanvasHtml(nonce: string, options?: CanvasHtmlOptions): string {
  const host = options?.host ?? (nonce ? 'vscode' : 'mcp-app');
  const isMcpApp = host === 'mcp-app' || !nonce;
  const cspContent = isMcpApp
    ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
    : `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const mainScriptAttr = isMcpApp ? '' : ` nonce="${nonce}"`;
  const inlineClientScript = options?.inlineClientJs
    ? `<script${mainScriptAttr}>${options.inlineClientJs.replace(/<\/script/gi, '<\\/script')}</script>\n  `
    : '';
  const initialWorktreeAttr = escapeHtmlAttr(options?.initialWorktreePath ?? '');
  const bodyHostClass = isMcpApp ? 'host-mcp-app' : 'host-vscode';
  const fileIconsJs = getFileIconsClientJs();

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${cspContent}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeAtlas Canvas</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-editor-background, var(--color-background-primary, #16181d));
      --fg: var(--vscode-editor-foreground, var(--color-text-primary, #dcdfe4));
      --muted: var(--vscode-descriptionForeground, var(--color-text-secondary, #8b949e));
      --panel: var(--vscode-sideBar-background, #1b1e25);
      --panel-2: var(--vscode-editorWidget-background, #212630);
      --popover-bg: var(--vscode-menu-background, #1e232d);
      --popover-surface: #151921;
      --popover-hover: var(--vscode-list-hoverBackground, #2a3140);
      --popover-border: var(--vscode-menu-border, #3b4456);
      --input-solid: var(--vscode-input-background, #181c24);
      --border: var(--vscode-panel-border, var(--color-border-primary, rgba(140,150,168,0.22)));
      --border-strong: rgba(140,150,168,0.38);
      --accent: var(--vscode-textLink-foreground, var(--color-text-info, #4da6ff));
      --btn-bg: var(--vscode-button-background, #1f6feb);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #388bfd);
      --input-bg: var(--input-solid);
      --input-fg: var(--vscode-input-foreground, var(--color-text-primary, #dcdfe4));
      --input-border: var(--vscode-input-border, rgba(140,150,168,0.34));
      --mono: var(--vscode-editor-font-family, var(--font-mono, "JetBrains Mono", Consolas, monospace));
      --green: var(--vscode-charts-green, var(--color-text-success, #3fb950));
      --red: var(--vscode-charts-red, var(--color-text-danger, #f85149));
      --amber: var(--vscode-charts-orange, var(--color-text-warning, #f0883e));
      --yellow: var(--vscode-charts-yellow, #d29922);
      --purple: var(--vscode-charts-purple, #a371f7);
      --cyan: #39c5cf;
      --diff-add-bg: var(--vscode-diffEditor-insertedTextBackground, rgba(63,185,80,0.15));
      --diff-del-bg: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,0.15));
      --surface-subtle: var(--vscode-textCodeBlock-background, rgba(135,145,160,0.12));
      --surface-hover: rgba(135,145,160,0.18);
    }
    [data-theme="light"], body.vscode-light {
      color-scheme: light;
      --panel: var(--vscode-sideBar-background, #f6f8fa);
      --panel-2: var(--vscode-editorWidget-background, #ffffff);
      --popover-bg: var(--vscode-menu-background, #ffffff);
      --popover-surface: #f6f8fa;
      --popover-hover: var(--vscode-list-hoverBackground, #eaeef2);
      --popover-border: var(--vscode-menu-border, #d0d7de);
      --input-solid: var(--vscode-input-background, #ffffff);
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
      font-family: var(--vscode-font-family, var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif));
      font-size: 12.5px;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    body.host-mcp-app, body.host-mcp-app .app { min-height: 620px; }
    body.host-mcp-app .vscode-only { display: none !important; }
    body.host-vscode .mcp-only { display: none !important; }
    body.no-analyze-cap .analyze-action { display: none !important; }
    body.no-ctx-cap .ctx-attach-action { display: none !important; }
    body.is-busy .toolbar .tb-zone > *:not(.brand) { pointer-events: none; opacity: 0.58; }
    body.is-busy .subbar { pointer-events: none; opacity: 0.65; }
    .app { display: flex; flex-direction: column; width: 100%; height: 100%; }

    .atlas-ico {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: inline-block;
      vertical-align: middle;
    }

    /* Unified Single-Row Top Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      min-height: 42px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      z-index: 30;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .tb-zone {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.1px;
      padding-right: 4px;
      white-space: nowrap;
    }
    .brand-mark {
      width: 16px;
      height: 16px;
      color: var(--accent);
      flex-shrink: 0;
    }

    /* Repo / Branch Pill + MCP Worktree Popover */
    .repo-wrap { position: relative; display: inline-flex; align-items: center; }
    .git-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: var(--mono);
      font-size: 11px;
      height: 26px;
      padding: 0 9px;
      border-radius: 6px;
      background: var(--surface-subtle);
      border: 1px solid transparent;
      color: var(--fg);
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    button.git-pill { cursor: pointer; }
    button.git-pill:hover {
      border-color: var(--border-strong);
      background: var(--surface-hover);
    }
    .select-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      height: 26px;
      padding: 0 9px;
      border-radius: 6px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--fg);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      max-width: 196px;
      overflow: hidden;
    }
    .select-trigger:hover:not(:disabled) {
      background: var(--popover-hover);
      border-color: var(--border-strong);
    }
    .select-trigger.is-open {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(77,166,255,0.2);
    }
    .select-trigger-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .select-caret {
      font-size: 9px;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .repo-popover {
      position: fixed;
      top: 44px;
      left: 12px;
      width: 396px;
      max-width: calc(100vw - 16px);
      background: var(--popover-bg);
      border: 1px solid var(--popover-border);
      border-radius: 10px;
      padding: 11px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.52);
      z-index: 620;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .repo-popover.hidden { display: none; }
    .repo-popover-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .repo-popover-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      letter-spacing: 0.2px;
    }
    .repo-quick-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .repo-quick-actions button {
      flex: 1;
      height: 28px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .repo-sec-title {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .repo-discovered-list, .repo-dir-list {
      max-height: 184px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--popover-surface);
      padding: 3px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .repo-disc-row, .repo-dir-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.12s;
      text-align: left;
    }
    .repo-disc-row:hover, .repo-dir-row:hover {
      background: var(--surface-hover);
    }
    .repo-disc-row.is-current {
      background: rgba(77,166,255,0.12);
      border: 1px solid rgba(77,166,255,0.32);
    }
    .repo-disc-main {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .repo-disc-top {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .repo-disc-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .repo-disc-path {
      font-family: var(--mono);
      font-size: 10px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .repo-branch-tag {
      font-family: var(--mono);
      font-size: 9.5px;
      padding: 0 5px;
      border-radius: 4px;
      background: var(--surface-subtle);
      color: var(--accent);
      flex-shrink: 0;
    }
    .repo-git-tag {
      font-size: 9.5px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(63,185,80,0.16);
      color: var(--green);
      flex-shrink: 0;
    }
    .repo-dir-browser {
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      background: var(--panel);
      padding: 7px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .repo-dir-browser.hidden { display: none; }
    .repo-dir-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5px;
      flex-wrap: wrap;
    }
    .repo-drives-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .drive-chip {
      height: 20px;
      padding: 0 6px;
      font-family: var(--mono);
      font-size: 10.5px;
      border-radius: 4px;
      background: var(--surface-subtle);
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .drive-chip:hover { border-color: var(--accent); color: var(--accent); }
    .drive-chip.active {
      background: rgba(77,166,255,0.16);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 700;
    }
    .repo-cur-dir {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--muted);
      background: var(--surface-subtle);
      padding: 3px 7px;
      border-radius: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .repo-notice {
      font-size: 10.5px;
      color: var(--amber);
      background: rgba(240,136,62,0.12);
      border: 1px solid rgba(240,136,62,0.32);
      border-radius: 5px;
      padding: 4px 7px;
    }
    .worktree-bar {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .worktree-input {
      flex: 1;
      min-width: 0;
      font-family: var(--mono);
      font-size: 11.5px;
      height: 28px;
      padding: 0 8px;
    }

    /* Segmented View Switcher */
    .segmented {
      display: inline-flex;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 1px;
    }
    .segmented button {
      background: transparent;
      color: var(--muted);
      border: none;
      border-radius: 4px;
      height: 22px;
      padding: 0 9px;
      font-size: 11.5px;
      font-weight: 500;
    }
    .segmented button:hover { color: var(--fg); background: transparent; }
    .segmented button.active {
      background: var(--panel-2);
      color: var(--fg);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.22);
    }

    /* Search Input */
    .search-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .search-ico {
      position: absolute;
      left: 7px;
      width: 13px;
      height: 13px;
      color: var(--muted);
      pointer-events: none;
    }
    #searchInput {
      width: 152px;
      height: 26px;
      padding: 0 36px 0 25px;
      border-radius: 6px;
      font-size: 11.5px;
      transition: width 0.16s ease, border-color 0.14s ease;
    }
    #searchInput:focus {
      width: 200px;
      outline: none;
      border-color: var(--accent);
    }
    .search-count {
      position: absolute;
      right: 7px;
      font-size: 10px;
      font-family: var(--mono);
      color: var(--muted);
      pointer-events: none;
    }

    /* Buttons & Inputs */
    button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: 1px solid transparent;
      height: 26px;
      padding: 0 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11.5px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      white-space: nowrap;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    button:hover:not(:disabled) { background: var(--btn-hover); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.secondary {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
    }
    button.secondary:hover:not(:disabled) {
      color: var(--fg);
      background: var(--surface-subtle);
      border-color: var(--border-strong);
    }
    button.secondary.active {
      border-color: rgba(77,166,255,0.55);
      color: var(--accent);
      background: rgba(77,166,255,0.12);
      font-weight: 600;
    }
    button.icon-btn {
      width: 26px;
      padding: 0;
    }
    button.danger {
      background: transparent;
      color: var(--red);
      border: 1px solid rgba(248,81,73,0.45);
    }
    button.danger:hover:not(:disabled) { background: rgba(248,81,73,0.14); }
    input, select, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      height: 26px;
      padding: 0 7px;
      font-size: 11.5px;
      font-family: inherit;
    }
    textarea { height: auto; padding: 6px 8px; }
    select { cursor: pointer; }

    /* Filter Pill Group */
    .filter-group {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      background: transparent;
    }
    .filter-group button {
      border: none;
      border-radius: 0;
      height: 24px;
      padding: 0 8px;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
    }
    .filter-group button + button { border-left: 1px solid var(--border); }
    .filter-group button:hover:not(:disabled) { color: var(--fg); background: var(--surface-subtle); }
    .filter-group button.active {
      background: rgba(77,166,255,0.15);
      color: var(--accent);
      font-weight: 600;
    }

    /* Split Analyze Button + Batch Dispatch Pill */
    .split-analyze {
      display: inline-flex;
      align-items: center;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .split-analyze > button {
      border-radius: 0;
      background: var(--btn-bg);
      color: #fff;
      font-weight: 600;
    }
    .split-analyze > button:hover:not(:disabled) { background: var(--btn-hover); }
    .split-analyze > .split-caret {
      padding: 0 6px;
      border-left: 1px solid rgba(255,255,255,0.22);
      font-size: 9.5px;
    }
    .btn-analyze {
      background: var(--btn-bg);
      color: #ffffff;
      font-weight: 600;
      border: 1px solid rgba(121,192,255,0.32);
    }
    .btn-analyze:hover:not(:disabled) { background: var(--btn-hover); }
    .btn-batch-dispatch {
      background: rgba(163,113,247,0.18);
      color: #d2a8ff;
      border: 1px solid rgba(163,113,247,0.5);
      font-weight: 600;
      font-size: 11px;
      padding: 0 9px;
    }
    .btn-batch-dispatch:hover:not(:disabled) {
      background: rgba(163,113,247,0.3);
      color: #ffffff;
    }
    .btn-batch-dispatch.hidden { display: none; }

    /* Overflow More Menu & Floating Depth / Context Menus */
    .more-wrap { position: relative; display: inline-flex; }
    .more-dot {
      position: absolute;
      top: 3px;
      right: 3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      pointer-events: none;
    }
    .more-dot.hidden { display: none; }
    .more-menu, .floating-menu {
      position: fixed;
      background: var(--popover-bg);
      border: 1px solid var(--popover-border);
      border-radius: 9px;
      padding: 5px;
      box-shadow: 0 14px 36px rgba(0,0,0,0.52);
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 620;
      max-height: min(440px, calc(100vh - 20px));
      overflow-y: auto;
    }
    .more-menu { width: 286px; }
    .floating-menu { width: 264px; }
    .more-menu.hidden, .floating-menu.hidden { display: none; }
    .more-sec-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--muted);
      padding: 5px 8px 2px;
      letter-spacing: 0.3px;
    }
    .more-sep {
      height: 1px;
      background: var(--border);
      margin: 3px 4px;
    }
    .more-menu button, .floating-menu button {
      width: 100%;
      height: auto;
      min-height: 28px;
      justify-content: flex-start;
      text-align: left;
      background: transparent;
      color: var(--fg);
      border: none;
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      white-space: normal;
    }
    .more-menu button:hover:not(:disabled), .floating-menu button:hover:not(:disabled) {
      background: var(--popover-hover);
    }
    .more-menu button.is-selected, .floating-menu button.is-selected {
      background: rgba(77,166,255,0.15);
      color: var(--accent);
    }
    .top-progress {
      position: relative;
      height: 2px;
      width: 100%;
      background: rgba(77,166,255,0.14);
      overflow: hidden;
      flex-shrink: 0;
      z-index: 35;
    }
    .top-progress.hidden { display: none; }
    .top-progress-bar {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 38%;
      background: linear-gradient(90deg, transparent, var(--accent), #79c0ff, transparent);
      animation: atlas-indeterminate 1.05s ease-in-out infinite;
    }
    @keyframes atlas-indeterminate {
      0% { left: -40%; }
      100% { left: 102%; }
    }
    .canvas-busy-scrim {
      position: absolute;
      inset: 0;
      z-index: 95;
      background: rgba(12, 14, 19, 0.38);
      backdrop-filter: blur(1.5px);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: all;
      cursor: progress;
    }
    .canvas-busy-scrim.hidden { display: none; }
    .canvas-busy-pill {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 8px 16px;
      border-radius: 999px;
      background: var(--popover-bg);
      border: 1px solid var(--popover-border);
      color: var(--fg);
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 10px 28px rgba(0,0,0,0.45);
    }
    .menu-item-col { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; }
    .menu-item-top { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; }
    .agent-menu-desc {
      font-size: 10px;
      color: var(--muted);
      line-height: 1.3;
    }
    .storage-check {
      color: var(--accent);
      font-weight: 700;
      width: 12px;
      display: inline-block;
      flex-shrink: 0;
    }

    /* Subbar: Scope Breadcrumbs + Architecture Meta + Semantic Trust Chips */
    .subbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 12px;
      min-height: 29px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      z-index: 20;
      flex-shrink: 0;
    }
    .subbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
    }
    .arch-pill {
      font-size: 10.5px;
      padding: 1px 7px;
      border-radius: 4px;
      background: var(--surface-subtle);
      color: var(--muted);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 3px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--muted);
      min-width: 0;
    }
    .crumb {
      cursor: pointer;
      color: var(--fg);
      padding: 1px 5px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .crumb:hover { background: var(--surface-subtle); color: var(--accent); }
    .crumb.scope-active {
      background: rgba(77,166,255,0.14);
      color: var(--accent);
      font-weight: 600;
    }
    .scope-exit-btn {
      height: 18px;
      padding: 0 5px;
      font-size: 10px;
      border-radius: 4px;
      background: var(--surface-subtle);
      color: var(--muted);
      border: 1px solid var(--border);
      margin-left: 3px;
    }
    .scope-exit-btn:hover { color: var(--fg); border-color: var(--accent); }
    .trust-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
    .chip {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--surface-subtle);
      color: var(--muted);
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
    }
    .chip:hover { border-color: var(--border-strong); color: var(--fg); }
    .chip.active { border-color: var(--accent); color: var(--accent); background: rgba(77,166,255,0.14); }
    .chip.ok { background: rgba(63,185,80,0.14); color: var(--green); }
    .chip.err { background: rgba(248,81,73,0.16); color: var(--red); }
    .chip.warn { background: rgba(240,136,62,0.16); color: var(--amber); }
    .chip.dir { background: rgba(163,113,247,0.16); color: var(--purple); }

    /* Status Banners */
    .stale-banner, .analyze-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 12px;
      font-size: 11.5px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .stale-banner {
      background: rgba(210,153,34,0.14);
      border-bottom: 1px solid rgba(210,153,34,0.38);
      color: var(--yellow);
    }
    .analyze-banner {
      background: rgba(56,139,253,0.14);
      border-bottom: 1px solid rgba(88,166,255,0.36);
      color: var(--accent);
    }
    .analyze-banner.is-error {
      background: rgba(248,81,73,0.14);
      border-bottom-color: rgba(248,81,73,0.4);
      color: var(--red);
    }
    .stale-banner.hidden, .analyze-banner.hidden { display: none; }
    .analyze-banner-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .analyze-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(88,166,255,0.28);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: atlas-spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    .analyze-spinner.hidden { display: none; }
    @keyframes atlas-spin { to { transform: rotate(360deg); } }

    .workspace { position: relative; flex: 1; display: flex; overflow: hidden; }

    /* Left Branch Summary Drawer */
    .summary-drawer {
      width: 276px;
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
      padding: 8px 11px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 12px;
    }
    .drawer-body { padding: 10px 11px; overflow-y: auto; flex: 1; }
    .summary-sec {
      font-size: 10.5px;
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
      font-size: 10.5px;
      color: var(--muted);
      margin-top: 3px;
      font-family: var(--mono);
    }
    .commit-row {
      font-size: 11px;
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

    /* Infinite Canvas Stage & Subtle Dot Grid */
    .viewport {
      position: relative;
      flex: 1;
      overflow: hidden;
      cursor: grab;
      background-image: radial-gradient(rgba(140,150,168,0.16) 1px, transparent 1px);
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

    /* Edges: Calm Orthogonal Tree Spine vs Semantic Causal Curves */
    svg.edges { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
    .edge-bus {
      fill: none;
      stroke: rgba(140,150,168,0.26);
      stroke-width: 1.25;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .edge-bus.dimmed { opacity: 0.12; }
    .edge-bus.focused {
      stroke: var(--accent);
      stroke-width: 1.85;
      opacity: 0.92;
    }
    .edge-path {
      fill: none;
      stroke: rgba(140,150,168,0.34);
      stroke-width: 1.5;
      transition: opacity 0.14s, stroke-width 0.14s;
    }
    .edge-path.flow { stroke: rgba(77,166,255,0.68); stroke-width: 1.75; }
    .edge-path.blocking { stroke: var(--amber); stroke-width: 1.85; stroke-dasharray: 5 3.5; }
    .edge-path.impact { stroke: var(--cyan); stroke-width: 1.75; stroke-dasharray: 4 3; }
    .edge-path.dep { stroke: #58a6ff; stroke-width: 1.75; stroke-dasharray: 4 3; }
    .edge-path.directive { stroke: var(--purple); stroke-width: 1.75; stroke-dasharray: 3 3; }
    .edge-path.external { stroke: #56b6c2; stroke-width: 1.65; stroke-dasharray: 4 4; }
    .edge-path.dimmed { opacity: 0.1; }
    .edge-path.focused { stroke-width: 2.3; opacity: 1; }
    .edge-pill { fill: var(--panel); stroke: var(--border-strong); stroke-width: 1; }
    .edge-pill.blocking { stroke: rgba(240,136,62,0.55); }
    .edge-pill.impact { stroke: rgba(57,197,207,0.55); }
    .edge-pill.dep { stroke: rgba(88,166,255,0.55); }
    .edge-pill.directive { stroke: rgba(163,113,247,0.55); }
    .edge-pill.external { stroke: rgba(86,182,194,0.55); }
    .edge-pill.dimmed, .edge-label.dimmed { opacity: 0.12; }
    .edge-label { fill: var(--muted); font-size: 9px; font-weight: 600; font-family: var(--mono); }
    .edge-label.blocking { fill: var(--amber); }
    .edge-label.impact { fill: var(--cyan); }
    .edge-label.dep { fill: #58a6ff; }
    .edge-label.directive { fill: var(--purple); }
    .edge-label.external { fill: #56b6c2; }

    /* Nodes: Clean Zero-Stripe Architectural Hierarchy */
    .node {
      position: absolute;
      width: 268px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 10px 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      cursor: pointer;
      transition: box-shadow 0.12s, border-color 0.12s, opacity 0.14s, background 0.12s;
    }
    .node:hover {
      border-color: rgba(88,166,255,0.5);
      box-shadow: 0 5px 16px rgba(0,0,0,0.26);
    }
    .node.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(77,166,255,0.28), 0 8px 22px rgba(0,0,0,0.32);
    }
    .node.dimmed { opacity: 0.15; }

    /* Archetype A: Repository, Domain & Causal Cards */
    .node.kind-root {
      background: linear-gradient(155deg, rgba(77,166,255,0.09), var(--panel));
      border-color: rgba(77,166,255,0.38);
    }
    .node.kind-domain.is-support { opacity: 0.88; }
    .node.kind-blocking {
      border-color: rgba(240,136,62,0.42);
      background: linear-gradient(155deg, rgba(240,136,62,0.07), var(--panel));
    }
    .node.kind-impact {
      border-color: rgba(57,197,207,0.4);
      background: linear-gradient(155deg, rgba(57,197,207,0.06), var(--panel));
    }
    .node.kind-directive {
      border: 1px dashed rgba(163,113,247,0.62);
      background: linear-gradient(155deg, rgba(163,113,247,0.08), var(--panel));
    }
    .node.kind-directive.is-resolved {
      border: 1px dashed rgba(63,185,80,0.55);
      background: linear-gradient(155deg, rgba(63,185,80,0.07), var(--panel));
    }
    .node.kind-external-dep {
      border: 1px dashed rgba(86,182,194,0.62);
      background: linear-gradient(155deg, rgba(86,182,194,0.08), var(--panel-2));
    }
    .node.has-mismatch {
      border-color: rgba(248,81,73,0.68);
      box-shadow: 0 0 0 1px rgba(248,81,73,0.22), 0 3px 12px rgba(0,0,0,0.22);
    }

    /* Archetype B & C: Compact Folder, External Port & IDE File Rows */
    .node.node-compact {
      width: 246px;
      padding: 6px 10px;
      border-radius: 7px;
      background: var(--panel-2);
      box-shadow: 0 1px 4px rgba(0,0,0,0.14);
    }
    .node.node-compact:hover { background: var(--panel); }
    .node.node-compact.is-summary {
      border-style: dashed;
      background: transparent;
      opacity: 0.84;
    }
    .node.kind-diff-file {
      border-color: rgba(210,153,34,0.36);
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .card-head-left {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1;
    }
    .node-title {
      font-weight: 600;
      font-size: 12.5px;
      line-height: 1.3;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kind-claim .node-title, .kind-blocking .node-title, .kind-directive .node-title {
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .layer-tag {
      font-size: 9.5px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--surface-subtle);
      color: var(--muted);
      font-weight: 500;
      max-width: 116px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .ext-badge {
      font-size: 9.5px;
      font-weight: 600;
      padding: 0 5px;
      height: 16px;
      line-height: 16px;
      border-radius: 4px;
      background: rgba(86,182,194,0.15);
      color: #56b6c2;
      border: 1px dashed rgba(86,182,194,0.42);
      flex-shrink: 0;
    }
    .node-sub {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--muted);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-body {
      font-size: 11.5px;
      line-height: 1.42;
      color: var(--muted);
      margin-top: 5px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .kind-claim .node-body, .kind-directive .node-body { -webkit-line-clamp: 3; }

    .blocking-box, .resolution-box {
      margin-top: 6px;
      padding: 5px 8px;
      border-radius: 5px;
      background: var(--surface-subtle);
      border-left: 2px solid var(--amber);
      font-size: 11px;
      line-height: 1.4;
    }
    .resolution-box {
      border-left-color: var(--green);
      color: var(--fg);
    }
    .blocking-if { color: var(--amber); font-weight: 600; }
    .blocking-then { color: var(--fg); margin-top: 2px; }

    .node-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(140,150,168,0.12);
      font-size: 10.5px;
      color: var(--muted);
      gap: 6px;
    }
    .node-footer-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .node-footer-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .quick-btn {
      height: 20px;
      font-size: 10.5px;
      color: var(--muted);
      background: var(--surface-subtle);
      border: 1px solid transparent;
      padding: 0 7px;
      border-radius: 4px;
    }
    .quick-btn:hover:not(:disabled) {
      color: var(--fg);
      background: var(--surface-hover);
      border-color: var(--border-strong);
    }
    .card-split-analyze {
      display: inline-flex;
      align-items: center;
      border-radius: 4px;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .node:hover .card-split-analyze, .node.selected .card-split-analyze { opacity: 1; }
    .card-split-analyze > button {
      height: 20px;
      font-size: 10px;
      padding: 0 6px;
      border-radius: 0;
      color: var(--accent);
      background: rgba(77,166,255,0.12);
      border: none;
      font-weight: 600;
    }
    .card-split-analyze > button + button {
      padding: 0 4px;
      border-left: 1px solid rgba(77,166,255,0.25);
    }
    .card-split-analyze > button:hover:not(:disabled) {
      background: rgba(77,166,255,0.24);
      color: #fff;
    }

    /* Compact IDE File / Folder Row Internals */
    .leaf-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .leaf-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .leaf-title-row {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .leaf-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kind-entrypoint .leaf-title, .kind-folder .leaf-title, .kind-external-dep .leaf-title { font-weight: 600; }
    .leaf-sub {
      font-family: var(--mono);
      font-size: 10px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .leaf-role {
      font-size: 10.5px;
      color: var(--fg);
      opacity: 0.82;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 1px;
    }
    .leaf-right {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .micro-tag {
      font-size: 9px;
      font-weight: 600;
      padding: 0 4px;
      height: 15px;
      line-height: 15px;
      border-radius: 3px;
      background: rgba(88,166,255,0.14);
      color: var(--accent);
      flex-shrink: 0;
    }
    .micro-tag.star-tag {
      background: rgba(210,153,34,0.18);
      color: var(--yellow);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .leaf-diff {
      font-family: var(--mono);
      font-size: 10px;
      display: inline-flex;
      gap: 3px;
    }
    .leaf-open {
      width: 20px;
      height: 20px;
      padding: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--muted);
      border: none;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .node:hover .leaf-open, .node.selected .leaf-open { opacity: 1; }
    .leaf-open:hover { background: var(--surface-hover); color: var(--fg); }

    .diff-add { color: var(--green); font-family: var(--mono); }
    .diff-del { color: var(--red); font-family: var(--mono); }

    /* Port Collapse Pill */
    .collapse-btn {
      position: absolute;
      right: -10px;
      top: 50%;
      transform: translateY(-50%);
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: var(--panel-2);
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      padding: 0 5px;
      z-index: 6;
      opacity: 0;
      transition: opacity 0.12s, background 0.12s, color 0.12s;
    }
    .collapse-btn.is-collapsed, .node:hover .collapse-btn, .node.selected .collapse-btn {
      opacity: 1;
    }
    .collapse-btn.is-collapsed {
      background: var(--panel);
      color: var(--accent);
      border-color: rgba(77,166,255,0.45);
    }
    .collapse-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 9.5px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      flex-shrink: 0;
    }
    .badge-verified { background: rgba(63,185,80,0.16); color: var(--green); }
    .badge-mismatch { background: rgba(248,81,73,0.18); color: var(--red); }
    .badge-stale { background: rgba(210,153,34,0.2); color: var(--yellow); }
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
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      padding: 18px 20px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    /* Right Inspector */
    .inspector {
      width: 396px;
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
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
    }
    .insp-title-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1;
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
      height: 30px;
      padding: 0 10px;
      font-size: 11.5px;
    }
    .insp-tab:hover:not(:disabled) { color: var(--fg); background: transparent; }
    .insp-tab.active { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
    .inspector-content { padding: 12px; overflow-y: auto; flex: 1; }
    .insp-file-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      margin: 8px 0;
    }
    .insp-file-path {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
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
    .code-line.hl { background: rgba(77,166,255,0.15); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-plus { background: var(--diff-add-bg); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-minus { background: var(--diff-del-bg); margin: 0 -8px; padding: 0 8px; }
    .code-line.diff-hunk { color: var(--accent); font-weight: 600; }
    .line-no {
      color: var(--muted);
      min-width: 30px;
      text-align: right;
      user-select: none;
      cursor: pointer;
    }
    .line-no:hover { color: var(--accent); text-decoration: underline; }

    /* Bottom Floating Canvas Controls */
    .hud {
      position: absolute;
      bottom: 12px;
      left: 12px;
      display: flex;
      gap: 3px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 3px 6px;
      font-size: 11px;
      z-index: 12;
      box-shadow: 0 4px 16px rgba(0,0,0,0.24);
    }
    .hud button.secondary {
      border: none;
      height: 22px;
      padding: 0 7px;
      font-size: 11px;
      border-radius: 5px;
    }
    .hud-sep { width: 1px; height: 13px; background: var(--border); margin: 0 2px; }
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
      background: var(--popover-bg);
      border: 1px solid var(--popover-border);
      border-radius: 8px;
      padding: 9px 11px;
      font-size: 11px;
      color: var(--muted);
      box-shadow: 0 12px 28px rgba(0,0,0,0.45);
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
      margin-right: 6px;
      vertical-align: middle;
    }
  </style>
</head>
<body class="${bodyHostClass}">
  <div class="app">
    <div class="toolbar">
      <!-- Left Zone: Brand + Repo/Branch + Diff Base -->
      <div class="tb-zone">
        <span class="brand">
          <svg class="brand-mark" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1.6 13.8 4.9v6.2L8 14.4 2.2 11.1V4.9L8 1.6Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
          </svg>
          CodeAtlas
        </span>
        <div class="repo-wrap">
          <button class="git-pill" id="btnRepoToggle" title="切换 Git 仓库或工作树 (Worktree)">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5" cy="4.5" r="1.7" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="11.5" r="1.7" stroke="currentColor" stroke-width="1.4"/><circle cx="11.5" cy="7.5" r="1.7" stroke="currentColor" stroke-width="1.4"/><path d="M5 6.2v3.6M9.8 7.5H7.2A2.2 2.2 0 0 1 5 5.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            <span id="gitPill">加载中...</span>
            <span style="opacity:0.6;font-size:9px;">▾</span>
          </button>
        </div>
        <button class="select-trigger" id="btnBaseRefSelect" title="选择 Git Diff 对比基准引用 (Base Ref)">
          <span class="select-trigger-label" id="lblBaseRefVal" style="font-family:var(--mono);font-size:11px;">基准: HEAD</span>
          <span class="select-caret">▾</span>
        </button>
      </div>

      <!-- Center Zone: View Mode + Verification Report Picker + Search -->
      <div class="tb-zone">
        <div class="segmented" id="modeControl">
          <button data-mode="atlas" id="mAtlas">架构拓扑</button>
          <button data-mode="hybrid" id="mHybrid" class="active">变更叠加</button>
          <button data-mode="briefing" id="mBriefing">变更核验</button>
        </div>
        <button class="select-trigger" id="btnBriefingSelect" style="display:none;max-width:186px;" title="选择已保存的核验简报">
          <span class="select-trigger-label" id="lblBriefingVal"></span>
          <span class="select-caret">▾</span>
        </button>
        <div class="search-wrap">
          <svg class="search-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.4"/>
            <path d="m10.5 10.5 3.2 3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input id="searchInput" placeholder="搜索模块或文件 (/)..." />
          <span class="search-count" id="searchCount"></span>
        </div>
      </div>

      <!-- Right Zone: Batch Dispatch Pill + Clean Filters + Split Analyze CTA + Overflow Menu -->
      <div class="tb-zone">
        <button class="btn-batch-dispatch analyze-action hidden" id="btnDispatchBatch"></button>
        <button class="secondary" id="btnSummaryToggle">变更概览</button>
        <div class="filter-group">
          <button id="btnPruneToggle" title="仅保留当前 Git Diff 涉及的模块">仅改动模块</button>
          <button id="btnDeltaToggle" title="压暗未改动节点以突出变更影响范围">突出变更</button>
          <button id="btnFocusToggle" title="仅高亮当前选中节点的上下游依赖链路">链路聚焦</button>
        </div>
        <div class="split-analyze analyze-action">
          <button id="btnAnalyzeBranch">⚡ 分析变更</button>
          <button class="split-caret" id="btnAnalyzeBranchMenu" title="选择分析粒度层级">▾</button>
        </div>
        <button class="secondary icon-btn" id="btnRefresh" title="重新扫描仓库与核验状态">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6M13.4 2.6v2.8h-2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="more-wrap">
          <button class="secondary icon-btn" id="btnMoreMenu" title="偏好设置与工程选项">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3.2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.8" cy="8" r="1.3"/>
            </svg>
            <span class="more-dot hidden" id="moreMenuDot"></span>
          </button>
        </div>
      </div>
    </div>

    <div class="top-progress hidden" id="topBusyBar"><div class="top-progress-bar"></div></div>

    <div class="analyze-banner hidden" id="analyzeBanner">
      <div class="analyze-banner-main">
        <span class="analyze-spinner" id="analyzeSpinner"></span>
        <span id="analyzeBannerText"></span>
      </div>
      <button class="secondary" id="btnDismissAnalyze" style="height:20px;padding:0 7px;font-size:11px;display:none;">✕</button>
    </div>

    <div class="stale-banner hidden" id="staleBanner">
      <span id="staleBannerText"></span>
      <button class="secondary" id="btnReverifyStale" style="height:22px;padding:0 8px;font-size:11px;">立即重验</button>
    </div>

    <div class="subbar">
      <div class="subbar-left">
        <span class="arch-pill" id="archPill" style="display:none;"></span>
        <div class="breadcrumbs" id="breadcrumbs"></div>
      </div>
      <div class="trust-chips" id="trustChips"></div>
    </div>

    <div class="workspace">
      <aside class="summary-drawer hidden" id="summaryDrawer">
        <div class="drawer-header">
          <span id="summaryDrawerTitle">分支变更摘要</span>
          <button class="secondary icon-btn" id="btnCloseSummary" style="width:22px;height:22px;">✕</button>
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
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <button id="btnEmptyPickRepo" style="display:none;">📁 选择本地文件夹...</button>
              <button id="btnEmptyVerify"></button>
            </div>
          </div>
        </div>

        <div class="hud">
          <button class="secondary" id="btnZoomOut">−</button>
          <span id="zoomLabel" style="min-width:38px;text-align:center;font-family:var(--mono);font-size:10.5px;">100%</span>
          <button class="secondary" id="btnZoomIn">+</button>
          <div class="hud-sep"></div>
          <button class="secondary" id="btnFitView">适配</button>
          <button class="secondary" id="btnAutoLayout">整理</button>
          <button class="secondary" id="btnExpandAll">展开</button>
          <button class="secondary" id="btnCollapseDomains">收拢</button>
          <button class="secondary" id="btnIndexFiles" style="display:none;">展开至文件层</button>
        </div>

        <div class="legend-wrap">
          <div class="legend-popover hidden" id="legendPopover"></div>
          <button class="secondary" id="btnLegendToggle" style="height:24px;padding:0 9px;font-size:11px;">? 图例</button>
        </div>
      </div>

      <aside class="inspector hidden" id="inspector">
        <div class="inspector-header">
          <div class="insp-title-wrap">
            <span id="inspIcon"></span>
            <strong id="inspTitle" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">节点精读</strong>
          </div>
          <div class="tb-zone" style="gap:4px;flex-shrink:0;">
            <button class="secondary" id="btnInspScopeRoot" style="height:22px;padding:0 7px;font-size:11px;display:none;"></button>
            <div class="split-analyze analyze-action" id="inspAnalyzeWrap" style="display:none;">
              <button id="btnInspAnalyzeQuick" style="height:22px;padding:0 7px;font-size:11px;">⚡ 概览</button>
              <button class="split-caret" id="btnInspAnalyzeMenu" style="height:22px;padding:0 5px;">▾</button>
            </div>
            <button class="secondary" id="btnInspFocus" style="height:22px;padding:0 7px;font-size:11px;">聚焦</button>
            <button class="secondary icon-btn" id="btnCloseInsp" style="width:22px;height:22px;">✕</button>
          </div>
        </div>
        <div class="inspector-tabs">
          <button class="insp-tab active" data-itab="overview" id="tabCode">源码</button>
          <button class="insp-tab" data-itab="diff" id="tabDiff">Diff</button>
          <button class="insp-tab" data-itab="directive" id="tabDir">💬 提问与批注</button>
          <button class="insp-tab" data-itab="trust" id="tabTrust">可信度</button>
        </div>
        <div class="inspector-content" id="inspContent"></div>
      </aside>

      <!-- Blocking Canvas Busy Scrim -->
      <div class="canvas-busy-scrim hidden" id="canvasBusyScrim">
        <div class="canvas-busy-pill">
          <span class="analyze-spinner"></span>
          <span id="canvasBusyText">正在同步仓库状态...</span>
        </div>
      </div>
    </div>

    <!-- Top-Level Portal Popovers (Zero z-index clipping or bleed-through) -->
    <div class="repo-popover hidden" id="repoPopover">
      <div class="repo-popover-head">
        <div class="repo-popover-label" id="lblSwitchRepo">选择或切换 Git 仓库 / Worktree</div>
      </div>
      <div class="repo-quick-actions">
        <button id="btnPickRepoDialog">📁 选择本地文件夹...</button>
        <button class="secondary" id="btnToggleInlineBrowser">📂 浏览目录树</button>
      </div>
      <div class="repo-dir-browser hidden" id="inlineDirBrowser"></div>
      <div id="discoveredReposSec" style="display:none;">
        <div class="repo-sec-title"><span id="lblDiscoveredRepos">已发现 / 最近仓库</span></div>
        <div class="repo-discovered-list" id="discoveredReposList"></div>
      </div>
      <div>
        <div class="repo-sec-title"><span id="lblManualPath">或输入本地路径</span></div>
        <div class="worktree-bar" id="worktreeBar">
          <input id="worktreeInput" class="worktree-input" value="${initialWorktreeAttr}" placeholder="输入本地 Git 仓库路径 (如 D:\\Project\\aster)..." />
          <button class="secondary" id="btnSetWorktree">载入</button>
        </div>
      </div>
    </div>

    <div class="more-menu hidden" id="moreMenu">
      <div class="more-sec-label mcp-only analyze-action" id="lblSessionTargetSec">Agent 执行会话</div>
      <button class="mcp-only analyze-action" data-agent-target="new" id="btnTargetNew">
        <span class="storage-check" id="chkTargetNew">✓</span>
        <span class="menu-item-col">
          <strong id="lblTargetNew">独立后台会话（推荐）</strong>
          <span class="agent-menu-desc" id="descTargetNew">在后台新会话执行分析，不打断当前对话上下文</span>
        </span>
      </button>
      <button class="mcp-only analyze-action" data-agent-target="current" id="btnTargetCurrent">
        <span class="storage-check" id="chkTargetCurrent"></span>
        <span class="menu-item-col">
          <strong id="lblTargetCurrent">当前对话窗口</strong>
          <span class="agent-menu-desc" id="descTargetCurrent">将分析指令直接发入当前对话流以便实时查看</span>
        </span>
      </button>
      <div class="more-sep mcp-only analyze-action"></div>
      <div class="more-sec-label" id="lblStorageSec">Git 元数据存储模式</div>
      <button data-storage-mode="git-hidden" id="btnStHidden">
        <span class="storage-check" id="chkStHidden">✓</span>
        <span class="menu-item-col">
          <strong id="lblStHidden">Git 元数据区 (.git/codeatlas)</strong>
          <span class="agent-menu-desc" id="descStHidden">默认保持工作区洁净 (Working Tree Clean)，不改 .gitignore</span>
        </span>
      </button>
      <button data-storage-mode="worktree-excluded" id="btnStExcluded">
        <span class="storage-check" id="chkStExcluded"></span>
        <span class="menu-item-col">
          <strong id="lblStExcluded">本地排除目录 (.git/info/exclude)</strong>
          <span class="agent-menu-desc" id="descStExcluded">生成工作区 .atlas/ 清单，写入 info/exclude 仅本机忽略</span>
        </span>
      </button>
      <button data-storage-mode="worktree-tracked" id="btnStTracked">
        <span class="storage-check" id="chkStTracked"></span>
        <span class="menu-item-col">
          <strong id="lblStTracked">版本库跟踪 (.atlas/ 入库)</strong>
          <span class="agent-menu-desc" id="descStTracked">纳入 Git 版本控制，共享 .atlas/manifest.json 架构清单</span>
        </span>
      </button>
      <div class="more-sep"></div>
      <button id="btnInitManifest" style="display:none;"></button>
      <button class="vscode-only" id="btnRunImpact"></button>
      <button class="vscode-only" id="btnVerifyBriefing"></button>
      <button class="vscode-only" id="btnCopyDirs"></button>
      <div class="more-sep vscode-only"></div>
      <div class="more-sec-label vscode-only" id="lblAgentBridgeSec">外部 Agent 接入</div>
      <button class="vscode-only" id="btnCopyMcpCfg">
        <span class="menu-item-col">
          <strong id="lblCopyMcp">1. 复制 MCP Server 配置 JSON</strong>
          <span class="agent-menu-desc" id="descCopyMcp">自动填入当前仓库路径，粘贴至 Agent MCP 配置</span>
        </span>
      </button>
      <button class="vscode-only" id="btnCopyBranchPrompt">
        <span class="menu-item-col">
          <strong id="lblCopyBranch">2. 复制“分析分支 Diff” Prompt</strong>
          <span class="agent-menu-desc" id="descCopyBranch">由外部 Agent 生成核验简报并写回当前仓库</span>
        </span>
      </button>
      <button class="vscode-only" id="btnCopyManifestPrompt">
        <span class="menu-item-col">
          <strong id="lblCopyManifest">3. 复制“生成架构清单” Prompt</strong>
          <span class="agent-menu-desc" id="descCopyManifest">由外部 Agent 梳理模块划分与架构约束 (manifest.json)</span>
        </span>
      </button>
      <div class="more-sep"></div>
      <button id="btnLangToggle"></button>
    </div>

    <!-- Unified Custom Select Popover -->
    <div class="floating-menu hidden" id="customSelectPopover"></div>

    <!-- Shared Floating Progressive Depth Picker -->
    <div class="floating-menu hidden" id="depthPopover"></div>

    <!-- Node Right-Click Context Menu -->
    <div class="floating-menu hidden" id="nodeCtxMenu"></div>
  </div>

  ${inlineClientScript}<script${mainScriptAttr}>
    const hostApi = window.__CODEATLAS_HOST__ || acquireVsCodeApi();
    const isMcpAppHost = document.body.classList.contains('host-mcp-app');

    ${fileIconsJs}

    const I18N = {
      zh: {
        atlas: '架构拓扑', briefing: '变更核验', hybrid: '变更叠加',
        baseRefPrefix: '基准: ', briefingPrefix: '简报: ',
        switchRepoTitle: '选择或切换 Git 仓库 / Worktree',
        pickRepoDialogBtn: '📁 选择本地文件夹...', pickRepoWaiting: '⏳ 等待系统弹窗选择...',
        browseInlineBtn: '📂 浏览目录树', browseInlineClose: '📂 收起目录树',
        discoveredReposTitle: '已发现仓库与 Worktree（点击即切）', manualPathTitle: '或输入本地仓库路径',
        upDirBtn: '⬆ 上级目录', openThisRepoBtn: '✓ 载入此仓库', currentRepoTag: '当前',
        dirLoading: '正在读取目录结构...', dirEmpty: '当前目录下无子目录。',
        nonRepoPickedFmt: (p) => '所选目录非 Git 工作树根，请从下方子目录中选择仓库：' + p,
        loadRepoBtn: '载入', worktreePh: '输入本地 Git 仓库路径 (如 D:\\\\Project\\\\aster)...',
        mcpNoRepoDesc: '点击下方按钮或左上角仓库栏，选择本地文件夹、浏览目录树或直接载入已发现的 Git 仓库。',
        analyzeBranchBtn: '⚡ 分析变更', analyzeScopeBtn: '⚡ 分析作用域',
        depthBtnOverview: '⚡ 职责概览', depthBtnFlow: '⚡ 调用链路', depthBtnDeep: '⚡ 守卫核验',
        depthL1Title: 'L1 · 模块职责概览（默认）', depthL1Desc: '梳理模块与各源码文件职责分工，标注建议优先阅读入口',
        depthL2Title: 'L2 · 调用与数据流', depthL2Desc: '追踪模块内 3–5 条核心调用链 (Call Graph) 与控制流',
        depthL3Title: 'L3 · 守卫与影响核验', depthL3Desc: '逐行核验前置守卫条件 (Guard Clauses)、跨模块影响与盲区',
        analyzingPrefix: '⚡ 正在执行: ', analyzingDefault: '⚡ 正在分析并执行确定性核验...',
        analyzeErrorPrefix: '⚠ 执行异常: ',
        busySwitchView: '正在切换视图与重算拓扑...',
        busyFilterDiff: '正在按 Git Diff 筛选受影响模块...',
        busySwitchBase: '正在重新计算对比基准 (Base Ref) Diff...',
        busyLoadRepo: '正在载入 Git 仓库与工作树状态...',
        busyExpandFiles: '正在加载源码树节点...',
        busyScope: '正在切换局部作用域并扫描跨边界引用...',
        busySync: '正在同步仓库与核验状态...',
        batchDispatchFmt: (n) => '📌 待办批注 (' + n + ') · 🚀 批量提交',
        sessionTargetSec: 'Agent 执行会话模式',
        targetNew: '独立后台会话（推荐）', targetNewDesc: '新建后台会话执行分析并自动刷新，不打断当前对话上下文',
        targetCurrent: '当前对话窗口', targetCurrentDesc: '将分析指令直接发入当前会话流以便实时查看推理过程',
        storageSec: 'Git 元数据存储模式',
        stHidden: 'Git 元数据区 (.git/codeatlas)', stHiddenDesc: '默认保持工作区洁净 (Working Tree Clean)，不改 .gitignore',
        stExcluded: '本地排除目录 (.git/info/exclude)', stExcludedDesc: '生成工作区 .atlas/ 清单，写入 info/exclude 仅本机忽略',
        stTracked: '版本库跟踪 (.atlas/ 入库)', stTrackedDesc: '纳入 Git 版本控制，供团队共享 .atlas/manifest.json',
        setScopeRoot: '🎯 设为当前作用域根 (Scope Root)', exitScopeRoot: '🏠 返回全仓拓扑', switchScopeToExt: '🎯 切换作用域至此模块',
        ctxAskAgent: '💬 添加代码提问 / 评审批注...', ctxAttachChat: '📎 附加至下次对话上下文', ctxFocus: '🔍 聚焦上下游依赖链',
        ctxAttachedFmt: (t) => '✓ 已将「' + t + '」挂载至下次对话输入框上下文',
        summaryBtn: '变更概览', pruneBtn: '仅改动模块', impactBtn: '运行 LSP 引用影响分析',
        searchPh: '搜索模块、符号或文件 (/)...', deltaBtn: '突出变更',
        focusBtn: '链路聚焦', refreshTip: '重新扫描 Git 状态与简报核验', initManifest: '导出架构清单 (manifest.json)',
        agentSec: '外部 Agent 接入', exportDir: '导出评审批注 (Markdown)',
        copyMcp: '1. 复制 MCP Server 配置 JSON', copyMcpDesc: '自动填入当前仓库路径，粘贴至 Agent MCP 配置',
        copyBranch: '2. 复制“分析分支 Diff” Prompt', copyBranchDesc: '由外部 Agent 生成变更核验简报并写回画布',
        copyManifest: '3. 复制“生成架构清单” Prompt', copyManifestDesc: '由外部 Agent 梳理模块划分与架构约束 (manifest.json)',
        copyNodePrompt: '复制模块分析 Prompt',
        verifyJson: '加载并核验简报 JSON...', reverify: '重新核验', langBtn: 'Language: English',
        selectBriefing: '未选择简报 (仅架构拓扑)', fit: '适应画布', tidy: '自动布局', expand: '全部展开', collapse: '全部折叠',
        indexFiles: '显示文件层', collapseFiles: '收起文件层', legendBtn: '? 图例',
        summaryTitle: 'Git 变更概览', tabCode: '源码与概览', tabDiff: 'Git Diff', tabDir: '💬 评审批注', tabTrust: '核验详情',
        inspFocus: '链路聚焦', defaultCrumb: '右键节点可设为作用域根或提问 · 点击源码行号可锚定行级批注',
        openBtn: '源码 ↗', expandDomainFiles: '文件', collapseDomainFiles: '收起',
        entryTag: '入口', recStarTag: '★ 入口', extBadgeFmt: (n) => '⇄ ' + n + ' 外部引用',
        dirKindQuestion: '💬 代码疑问 (Question)', dirKindRework: '🔧 修改要求 (Rework)', dirKindConstraint: '🛡 架构约束 (Constraint)',
        kind: {
          root: '工作树根', domain: '架构模块', folder: '目录', entrypoint: '入口点', file: '源码文件',
          claim: '行为断言', evidence: '代码锚点', blocking: '守卫条件', 'diff-file': '变更文件',
          impact: '跨模块影响', directive: '评审批注', 'external-dep': '外部依赖引用'
        },
        badge: { verified: '✓ 已核验', mismatch: '✕ 失配', stale: '⟳ 陈旧', unverified: '待核验', unknown: '未声明' },
        legendHtml:
          '<div><i class="dot" style="background:rgba(140,150,168,0.65);"></i>正交折线：仓库目录与模块包含层级 (Containment)</div>' +
          '<div><i class="dot" style="background:#4da6ff;"></i>蓝色实线：调用流 / 模块依赖 / 行为断言锚定</div>' +
          '<div><i class="dot" style="background:var(--amber);"></i>橙色虚线：前置守卫条件 (Guard Clause: IF → 拦截)</div>' +
          '<div><i class="dot" style="background:#56b6c2;"></i>青色虚线：当前作用域外的跨模块引用 (External Ref)</div>' +
          '<div><i class="dot" style="background:var(--purple);"></i>紫色虚线：代码评审批注与提问 (Review Directive)</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:5px;margin-top:2px;font-family:var(--mono);font-size:10px;">右键节点：设为作用域根 / 提问 / 分析粒度 · / 搜索 · F 适应画布 · Esc 返回</div>',
        emptyBriefingTitle: '当前未加载变更核验简报',
        emptyBriefingDesc: '请点击右上角「⚡ 分析变更」生成确定性核验简报，或切换至「变更叠加 / 架构拓扑」视图浏览模块结构。',
        noGit: '未加载 Git 仓库',
        summaryImpacted: '受影响架构模块（点击定位并展开）',
        summaryNoDiff: '相对所选基准引用 (Base Ref) 无文件变更。',
        summaryCommits: '提交记录 (Commits)',
        summaryNoCommits: '相对对比基准无新增提交。',
        summaryClaims: '核验断言列表',
        summaryPruneHint: '开启顶部「仅改动模块」可隐藏未涉及变更的模块分支。',
        jumpEditor: '在编辑器打开 ↗',
        loadingSnippet: '正在读取仓库源码快照...',
        loadingDiff: '正在计算 Git Diff...',
        noDiffForFile: '相对当前对比基准无代码变更：',
        notFileNode: '当前节点未关联具体源码文件。',
        dirHelp: '针对当前代码锚点添加提问、纠偏或修改要求：',
        dirPathReq: '请填写仓库相对路径。',
        dirPlaceholder: '输入代码疑问（如“此处为何未做并发锁保护？”）、简报断言纠偏或具体修改要求...',
        askNowBtn: '🚀 立即发送给 Agent',
        dirWireBtn: '📌 挂入画布待办',
        dirCopyBtn: '导出 Markdown',
        delDirBtn: '删除此评审批注',
        signalsTitle: '验证与测试信号 (Verification Signals)',
        noSignals: '未提供测试或类型检查信号。',
        blindSpotsTitle: '未覆盖盲区 (Blind Spots)',
        noBlindSpots: '未声明已知盲区。',
        guardrailsTitle: '架构约束红线 (Architecture Guardrails)',
        noGuardrails: '未在 manifest.json 中配置架构约束。',
        staleText: (t, h) => '简报快照已陈旧 (STALE)：简报基于提交 (' + t + ')，而当前 HEAD 为 (' + h + ')。'
      },
      en: {
        atlas: 'Architecture', briefing: 'Verification', hybrid: 'Diff Overlay',
        baseRefPrefix: 'Base: ', briefingPrefix: 'Report: ',
        switchRepoTitle: 'Switch Git Repository / Worktree',
        pickRepoDialogBtn: '📁 Select Local Folder...', pickRepoWaiting: '⏳ Waiting for dialog...',
        browseInlineBtn: '📂 Browse Directory', browseInlineClose: '📂 Hide Directory',
        discoveredReposTitle: 'Discovered Repos & Worktrees', manualPathTitle: 'Or Enter Local Path',
        upDirBtn: '⬆ Parent Dir', openThisRepoBtn: '✓ Open Repo', currentRepoTag: 'current',
        dirLoading: 'Reading directory tree...', dirEmpty: 'No subdirectories found.',
        nonRepoPickedFmt: (p) => 'Not a Git working tree root; select a child repository inside: ' + p,
        loadRepoBtn: 'Open', worktreePh: 'Local Git repo path (e.g. D:\\\\Project\\\\aster)...',
        mcpNoRepoDesc: 'Click below or open the top-left repository selector to pick a folder, browse directories, or open a discovered Git repo.',
        analyzeBranchBtn: '⚡ Analyze Diff', analyzeScopeBtn: '⚡ Analyze Scope',
        depthBtnOverview: '⚡ L1 Overview', depthBtnFlow: '⚡ L2 Call Flow', depthBtnDeep: '⚡ L3 Guard Audit',
        depthL1Title: 'L1 · Module Overview (Default)', depthL1Desc: 'Summarize module & file responsibilities and highlight entry points',
        depthL2Title: 'L2 · Call & Data Flow', depthL2Desc: 'Trace 3–5 primary call chains and control flows',
        depthL3Title: 'L3 · Guard & Impact Audit', depthL3Desc: 'Verify guard clauses, cross-module impacts, and test signals',
        analyzingPrefix: '⚡ Running: ', analyzingDefault: '⚡ Running deterministic verification...',
        analyzeErrorPrefix: '⚠ Error: ',
        busySwitchView: 'Switching view & computing layout...',
        busyFilterDiff: 'Filtering modules by Git diff...',
        busySwitchBase: 'Recomputing diff against base ref...',
        busyLoadRepo: 'Loading Git repository & working tree...',
        busyExpandFiles: 'Loading source tree nodes...',
        busyScope: 'Updating scope root & scanning external refs...',
        busySync: 'Synchronizing repository state...',
        batchDispatchFmt: (n) => '📌 Pending Notes (' + n + ') · 🚀 Dispatch All',
        sessionTargetSec: 'Agent Session Mode',
        targetNew: 'Background Session (Recommended)', targetNewDesc: 'Run in a new background session without interrupting current chat',
        targetCurrent: 'Current Conversation', targetCurrentDesc: 'Send prompt directly into the active chat stream',
        storageSec: 'Git Metadata Storage',
        stHidden: 'Git Metadata (.git/codeatlas)', stHiddenDesc: 'Keep working tree clean; zero changes to .gitignore',
        stExcluded: 'Local Exclude (.git/info/exclude)', stExcludedDesc: 'Write .atlas/ in worktree, ignored locally via info/exclude',
        stTracked: 'Tracked in Git (.atlas/)', stTrackedDesc: 'Commit .atlas/manifest.json for team-shared architecture',
        setScopeRoot: '🎯 Set as Scope Root', exitScopeRoot: '🏠 Reset to Full Repo', switchScopeToExt: '🎯 Focus Scope on Module',
        ctxAskAgent: '💬 Add Review Question / Directive...', ctxAttachChat: '📎 Attach to Next Chat Prompt', ctxFocus: '🔍 Focus Dependency Chain',
        ctxAttachedFmt: (t) => '✓ Attached "' + t + '" to your next chat prompt context',
        summaryBtn: 'Diff Summary', pruneBtn: 'Changed Only', impactBtn: 'Run LSP Reference Impact',
        searchPh: 'Search modules, symbols, or files (/)...', deltaBtn: 'Highlight Diff',
        focusBtn: 'Focus Graph', refreshTip: 'Rescan Git status & verification', initManifest: 'Export Manifest (manifest.json)',
        agentSec: 'External Agent Setup', exportDir: 'Export Review Directives (Markdown)',
        copyMcp: '1. Copy MCP Server Config JSON', copyMcpDesc: 'Pre-filled with current worktree & dist/mcp-server.js',
        copyBranch: '2. Copy Diff Verification Prompt', copyBranchDesc: 'Ask external Agent to submit a verified briefing',
        copyManifest: '3. Copy Architecture Manifest Prompt', copyManifestDesc: 'Ask external Agent to author manifest.json & guardrails',
        copyNodePrompt: 'Copy Module Analysis Prompt',
        verifyJson: 'Load & Verify Briefing JSON...', reverify: 'Re-verify', langBtn: '切换语言: 中文',
        selectBriefing: 'None (Architecture Only)', fit: 'Fit View', tidy: 'Auto Layout', expand: 'Expand All', collapse: 'Collapse All',
        indexFiles: 'Show Files', collapseFiles: 'Hide Files', legendBtn: '? Legend',
        summaryTitle: 'Git Diff Summary', tabCode: 'Source & Overview', tabDiff: 'Git Diff', tabDir: '💬 Review Notes', tabTrust: 'Verification',
        inspFocus: 'Focus', defaultCrumb: 'Right-click node to set Scope Root or Ask · Click line number to anchor review note',
        openBtn: 'Open ↗', expandDomainFiles: 'Files', collapseDomainFiles: 'Hide',
        entryTag: 'ENTRY', recStarTag: '★ ENTRY', extBadgeFmt: (n) => '⇄ ' + n + ' ext refs',
        dirKindQuestion: '💬 Question', dirKindRework: '🔧 Rework', dirKindConstraint: '🛡 Constraint',
        kind: {
          root: 'Worktree Root', domain: 'Module', folder: 'Directory', entrypoint: 'Entry Point', file: 'Source File',
          claim: 'Claim', evidence: 'Code Anchor', blocking: 'Guard Clause', 'diff-file': 'Modified File',
          impact: 'Cross-Impact', directive: 'Review Note', 'external-dep': 'External Ref'
        },
        badge: { verified: '✓ verified', mismatch: '✕ mismatch', stale: '⟳ stale', unverified: 'unverified', unknown: 'untested' },
        legendHtml:
          '<div><i class="dot" style="background:rgba(140,150,168,0.65);"></i>Orthogonal line: directory &amp; module containment</div>' +
          '<div><i class="dot" style="background:#4da6ff;"></i>Blue solid: call flow, dependency &amp; claim anchor</div>' +
          '<div><i class="dot" style="background:var(--amber);"></i>Amber dashed: explicit guard clause (IF → Outcome)</div>' +
          '<div><i class="dot" style="background:#56b6c2;"></i>Cyan dashed: out-of-scope external reference</div>' +
          '<div><i class="dot" style="background:var(--purple);"></i>Purple dashed: anchored review directive / question</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:5px;margin-top:2px;font-family:var(--mono);font-size:10px;">Right-click: Scope Root / Ask / Depth · / Search · F Fit View · Esc Back</div>',
        emptyBriefingTitle: 'No Verification Report Loaded',
        emptyBriefingDesc: 'Click ⚡ Analyze Diff in the toolbar to generate a verified report, or switch to Diff Overlay / Architecture view.',
        noGit: 'No Git Repository',
        summaryImpacted: 'Modified Modules (click to focus)',
        summaryNoDiff: 'Working tree has no changes relative to base ref.',
        summaryCommits: 'Commits Since Base Ref',
        summaryNoCommits: 'No commits ahead of base ref.',
        summaryClaims: 'Verified & Checked Claims',
        summaryPruneHint: 'Toggle "Changed Only" in the toolbar to hide untouched modules.',
        jumpEditor: 'Open in Editor ↗',
        loadingSnippet: 'Reading repository file snapshot...',
        loadingDiff: 'Computing Git diff...',
        noDiffForFile: 'No diff relative to base ref for: ',
        notFileNode: 'This node is not anchored to a file path.',
        dirHelp: 'Add an anchored question, claim challenge, or rework directive on:',
        dirPathReq: 'Repository-relative file path is required.',
        dirPlaceholder: 'Describe your question, verification correction, or code rework requirement...',
        askNowBtn: '🚀 Send to Agent Now',
        dirWireBtn: '📌 Queue on Canvas',
        dirCopyBtn: 'Export Markdown',
        delDirBtn: 'Delete Directive',
        signalsTitle: 'Verification & Test Signals',
        noSignals: 'No test or typecheck signals attached.',
        blindSpotsTitle: 'Declared Blind Spots',
        noBlindSpots: 'None declared.',
        guardrailsTitle: 'Architecture Guardrails (manifest.json)',
        noGuardrails: 'No guardrails configured in manifest.json.',
        staleText: (t, h) => 'STALE REPORT: Anchored to (' + t + '), while current HEAD is (' + h + ').'
      }
    };

    let lang = 'zh';
    let agentTarget = 'new';
    let currentDirKind = 'question';
    let isCanvasBusy = false;
    let busyWatchdog = null;
    let analyzeState = { running: false, label: '', error: '' };
    let graph = { mode: 'hybrid', scopeRoot: '', scopeAncestors: [], storageMode: 'git-hidden', nodes: [], edges: [], summary: {}, architecture: null, branchSummary: null };
    let nodeById = new Map();
    let gitCtx = null;
    let baseRef = 'HEAD';
    let scopeRoot = '';
    let storageMode = 'git-hidden';
    let availableBriefings = [];
    let activeBriefingPath = '';
    let discoveredRepos = [];
    let dirBrowserOpen = false;
    let dirListingState = null;
    let dirBrowserLoading = false;
    let pickingDialog = false;
    let lastBriefingKey = '';
    let lastScopeKey = '';
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
    let prefilledDirLine = null;
    let inspectorTab = 'overview';
    let collapsedIds = new Set();
    let positions = new Map();
    let manualPositions = new Set();
    let measuredHeights = new Map();
    let measuredWidths = new Map();
    let snippetCache = new Map();
    let diffCache = new Map();
    let edgeRaf = 0;
    let pendingCenterNodeId = null;

    let cam = { x: 60, y: 60, scale: 1 };

    const CARD_W = 268;
    const COMPACT_W = 246;
    const COL_GAP = 54;
    const Y_GAP_CARD = 14;
    const Y_GAP_COMPACT = 7;

    const viewport = document.getElementById('viewport');
    const stage = document.getElementById('stage');
    const edgesSvg = document.getElementById('edgesSvg');
    const nodesLayer = document.getElementById('nodesLayer');
    const inspector = document.getElementById('inspector');
    const summaryDrawer = document.getElementById('summaryDrawer');
    const customSelectPopover = document.getElementById('customSelectPopover');
    const depthPopover = document.getElementById('depthPopover');
    const nodeCtxMenu = document.getElementById('nodeCtxMenu');
    const topBusyBar = document.getElementById('topBusyBar');
    const canvasBusyScrim = document.getElementById('canvasBusyScrim');
    const canvasBusyText = document.getElementById('canvasBusyText');

    function setCanvasBusy(busy, label) {
      isCanvasBusy = Boolean(busy);
      if (busyWatchdog) {
        clearTimeout(busyWatchdog);
        busyWatchdog = null;
      }
      document.body.classList.toggle('is-busy', isCanvasBusy);
      if (topBusyBar) topBusyBar.classList.toggle('hidden', !isCanvasBusy);
      if (canvasBusyScrim) canvasBusyScrim.classList.toggle('hidden', !isCanvasBusy);
      if (isCanvasBusy) {
        if (canvasBusyText) canvasBusyText.textContent = label || t('busySync');
        busyWatchdog = setTimeout(() => {
          setCanvasBusy(false);
        }, 18000);
      }
    }

    function postStateAction(msg, busyLabel) {
      if (isCanvasBusy) return;
      closePopovers();
      setCanvasBusy(true, busyLabel || t('busySync'));
      hostApi.postMessage(msg);
    }

    function positionPopover(popoverEl, anchorEl, alignRight) {
      if (!popoverEl || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const popW = popoverEl.offsetWidth || 264;
      const popH = popoverEl.offsetHeight || 220;
      const left = alignRight
        ? Math.max(8, Math.min(window.innerWidth - popW - 8, rect.right - popW))
        : Math.max(8, Math.min(window.innerWidth - popW - 8, rect.left));
      let top = rect.bottom + 6;
      if (top + popH > window.innerHeight - 8 && rect.top > popH + 12) {
        top = Math.max(8, rect.top - popH - 6);
      } else {
        top = Math.max(8, Math.min(window.innerHeight - popH - 8, top));
      }
      popoverEl.style.left = left + 'px';
      popoverEl.style.top = top + 'px';
    }

    function openCustomSelect(opts) {
      const anchorEl = opts.anchorEl;
      if (!anchorEl || !customSelectPopover) return;
      const alreadyOpenForAnchor =
        !customSelectPopover.classList.contains('hidden') &&
        customSelectPopover.dataset.anchorId === anchorEl.id;
      closePopovers();
      if (alreadyOpenForAnchor) return;

      customSelectPopover.dataset.anchorId = anchorEl.id || '';
      anchorEl.classList.add('is-open');
      if (opts.width) {
        customSelectPopover.style.width = opts.width + 'px';
      } else {
        customSelectPopover.style.width = Math.max(220, Math.round(anchorEl.getBoundingClientRect().width)) + 'px';
      }

      let html = '';
      if (opts.title) {
        html += '<div class="more-sec-label">' + esc(opts.title) + '</div>';
      }
      html += (opts.items || []).map((it, idx) => {
        const isSel = String(it.value) === String(opts.activeValue ?? '');
        return '<button class="' + (isSel ? 'is-selected' : '') + '" data-csel-idx="' + idx + '">' +
          '<span class="storage-check">' + (isSel ? '✓' : '') + '</span>' +
          '<span class="menu-item-col">' +
            '<span class="menu-item-top"><span style="' + (it.mono ? 'font-family:var(--mono);font-size:11px;' : 'font-weight:500;') + '">' + esc(it.label) + '</span>' +
              (it.tag ? '<span class="repo-branch-tag">' + esc(it.tag) + '</span>' : '') +
            '</span>' +
            (it.desc ? '<span class="agent-menu-desc">' + esc(it.desc) + '</span>' : '') +
          '</span>' +
        '</button>';
      }).join('');

      customSelectPopover.innerHTML = html;
      customSelectPopover.classList.remove('hidden');
      positionPopover(customSelectPopover, anchorEl, Boolean(opts.alignRight));

      customSelectPopover.querySelectorAll('[data-csel-idx]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const chosen = opts.items[parseInt(btn.dataset.cselIdx, 10)];
          closePopovers();
          if (chosen && opts.onSelect) opts.onSelect(chosen.value, chosen);
        });
      });
    }

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

    function isCompactNode(node) {
      if (!node) return false;
      return (
        node.kind === 'file' ||
        node.kind === 'diff-file' ||
        node.kind === 'entrypoint' ||
        node.kind === 'evidence' ||
        node.kind === 'folder' ||
        node.kind === 'external-dep'
      );
    }

    function getNodeWidth(id) {
      if (measuredWidths.has(id)) return measuredWidths.get(id);
      const n = nodeById.get(id);
      return isCompactNode(n) ? COMPACT_W : CARD_W;
    }

    function getNodeHeight(id) {
      if (measuredHeights.has(id)) return measuredHeights.get(id);
      const n = nodeById.get(id);
      return isCompactNode(n) ? 40 : 96;
    }

    function nextRecommendedDepth(node) {
      if (!node) return 'overview';
      if (node.kind === 'file' || node.kind === 'diff-file' || node.kind === 'entrypoint') {
        return node.completedDepth === 'flow' ? 'deep' : 'flow';
      }
      const cd = node.completedDepth || 'none';
      if (cd === 'none') return 'overview';
      if (cd === 'overview') return 'flow';
      return 'deep';
    }

    function depthButtonLabel(depth) {
      if (depth === 'overview') return t('depthBtnOverview');
      if (depth === 'flow') return t('depthBtnFlow');
      return t('depthBtnDeep');
    }

    function findAncestorDomainPrefix(node) {
      let cur = node && node.parentId ? nodeById.get(node.parentId) : null;
      while (cur) {
        if (cur.kind === 'domain') {
          if (cur.scopePath) return cur.scopePath.replace(/\\/+$/, '');
          if (cur.defaultDirectivePath && cur.defaultDirectivePath.indexOf('.') === -1) {
            return cur.defaultDirectivePath.replace(/\\/+$/, '');
          }
        }
        cur = cur.parentId ? nodeById.get(cur.parentId) : null;
      }
      return scopeRoot || '';
    }

    function formatCompactSubtitle(node) {
      if (!node) return '';
      if (node.isSummary || node.kind === 'external-dep') return node.subtitle || '';
      if (node.kind === 'folder') return '';
      if (!node.path) return node.subtitle || '';

      const norm = String(node.path);
      const slashIdx = norm.lastIndexOf('/');
      const baseName = slashIdx >= 0 ? norm.slice(slashIdx + 1) : norm;
      let dirPart = slashIdx >= 0 ? norm.slice(0, slashIdx) : '';

      const domPrefix = findAncestorDomainPrefix(node);
      if (domPrefix && (dirPart === domPrefix || dirPart.indexOf(domPrefix + '/') === 0)) {
        dirPart = dirPart.slice(domPrefix.length).replace(/^\\/+/, '');
      }

      const parent = node.parentId ? nodeById.get(node.parentId) : null;
      if (parent && parent.kind === 'folder' && parent.title && dirPart === parent.title) {
        dirPart = '';
      }

      const lineSuffix =
        node.startLine && (node.startLine > 1 || node.kind === 'evidence')
          ? ':' + node.startLine + (node.endLine && node.endLine !== node.startLine ? '-' + node.endLine : '')
          : '';

      if (node.title !== baseName) {
        return (dirPart ? dirPart + '/' : '') + baseName + lineSuffix;
      }
      if (dirPart) return dirPart + lineSuffix;
      if (lineSuffix) return 'L' + lineSuffix.slice(1);
      return '';
    }

    function isAnalyzableNode(node) {
      if (!node || node.isSummary) return false;
      return (
        node.kind === 'root' ||
        node.kind === 'domain' ||
        node.kind === 'folder' ||
        node.kind === 'entrypoint' ||
        node.kind === 'file' ||
        node.kind === 'diff-file'
      );
    }

    function triggerNodeAnalyze(node, explicitDepth, overrideTarget) {
      if (!node || analyzeState.running) return;
      const depth = explicitDepth || nextRecommendedDepth(node);
      const targetPath =
        node.kind === 'root'
          ? (scopeRoot || '')
          : (node.scopePath || node.path || node.defaultDirectivePath || '');
      hostApi.postMessage({
        type: 'analyzeTarget',
        scope: 'node',
        depth,
        agentTarget: overrideTarget || agentTarget,
        scopeRoot,
        nodeId: node.id,
        title: node.title,
        kind: node.kind,
        path: targetPath
      });
    }

    function triggerTopAnalyze(explicitDepth, overrideTarget) {
      if (analyzeState.running || !gitCtx) return;
      if (scopeRoot && !explicitDepth) {
        const rootNode = nodeById.get('root');
        triggerNodeAnalyze(rootNode || { id: 'root', kind: 'root', title: scopeRoot, scopePath: scopeRoot }, nextRecommendedDepth(rootNode), overrideTarget);
        return;
      }
      const depth = explicitDepth || 'deep';
      if (depth === 'overview') {
        hostApi.postMessage({
          type: 'analyzeTarget',
          scope: 'node',
          depth: 'overview',
          agentTarget: overrideTarget || agentTarget,
          scopeRoot,
          title: scopeRoot || 'Repository',
          kind: 'root',
          path: scopeRoot || ''
        });
        return;
      }
      hostApi.postMessage({
        type: 'analyzeTarget',
        scope: 'branch',
        depth,
        agentTarget: overrideTarget || agentTarget,
        scopeRoot,
        baseRef
      });
    }

    function openDepthPopover(anchorEl, targetNodeOrNull) {
      closePopovers();
      const done = targetNodeOrNull ? (targetNodeOrNull.completedDepth || 'none') : 'none';
      const items = [
        { d: 'overview', title: t('depthL1Title'), desc: t('depthL1Desc'), check: done === 'overview' || done === 'flow' || done === 'deep' },
        { d: 'flow', title: t('depthL2Title'), desc: t('depthL2Desc'), check: done === 'flow' || done === 'deep' },
        { d: 'deep', title: t('depthL3Title'), desc: t('depthL3Desc'), check: done === 'deep' }
      ];
      depthPopover.innerHTML = items.map(it =>
        '<button data-pick-depth="' + it.d + '">' +
          '<span class="menu-item-col">' +
            '<span class="menu-item-top"><strong>' + esc(it.title) + '</strong>' + (it.check ? '<span style="color:var(--green);font-size:10px;">✓</span>' : '') + '</span>' +
            '<span class="agent-menu-desc">' + esc(it.desc) + '</span>' +
          '</span>' +
        '</button>'
      ).join('');
      depthPopover.classList.remove('hidden');
      positionPopover(depthPopover, anchorEl, true);

      depthPopover.querySelectorAll('[data-pick-depth]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          depthPopover.classList.add('hidden');
          const d = btn.dataset.pickDepth;
          if (targetNodeOrNull) triggerNodeAnalyze(targetNodeOrNull, d);
          else triggerTopAnalyze(d);
        });
      });
    }

    function openNodeContextMenu(ev, node) {
      ev.preventDefault();
      ev.stopPropagation();
      closePopovers();
      let html = '';

      if (node.kind === 'external-dep' && node.scopePath) {
        html += '<button data-ctx="setScope"><strong>' + esc(t('switchScopeToExt')) + '</strong></button>';
      } else if (node.scopePath && node.scopePath !== scopeRoot && (node.kind === 'domain' || node.kind === 'folder')) {
        html += '<button data-ctx="setScope"><strong>' + esc(t('setScopeRoot')) + '</strong></button>';
      }
      if (scopeRoot) {
        html += '<button data-ctx="exitScope">' + esc(t('exitScopeRoot')) + '</button>';
      }

      html += '<button data-ctx="ask">' + esc(t('ctxAskAgent')) + '</button>';
      if (isMcpAppHost && !document.body.classList.contains('no-ctx-cap')) {
        html += '<button class="ctx-attach-action" data-ctx="attachCtx">' + esc(t('ctxAttachChat')) + '</button>';
      }

      if (isAnalyzableNode(node) && !document.body.classList.contains('no-analyze-cap')) {
        html += '<div class="more-sep"></div>';
        html += '<button data-ctx="d-overview">' + esc(t('depthL1Title')) + '</button>';
        html += '<button data-ctx="d-flow">' + esc(t('depthL2Title')) + '</button>';
        html += '<button data-ctx="d-deep">' + esc(t('depthL3Title')) + '</button>';
      }

      html += '<div class="more-sep"></div>';
      html += '<button data-ctx="focus">' + esc(t('ctxFocus')) + '</button>';
      if (node.path) {
        html += '<button data-ctx="open">' + esc(t('jumpEditor')) + '</button>';
      }

      nodeCtxMenu.innerHTML = html;
      nodeCtxMenu.classList.remove('hidden');
      const popW = nodeCtxMenu.offsetWidth || 264;
      const popH = nodeCtxMenu.offsetHeight || 240;
      nodeCtxMenu.style.left = Math.min(window.innerWidth - popW - 8, Math.max(8, ev.clientX)) + 'px';
      nodeCtxMenu.style.top = Math.min(window.innerHeight - popH - 8, Math.max(8, ev.clientY)) + 'px';

      nodeCtxMenu.querySelectorAll('[data-ctx]').forEach(btn => {
        btn.addEventListener('click', (ce) => {
          ce.stopPropagation();
          nodeCtxMenu.classList.add('hidden');
          const act = btn.dataset.ctx;
          if (act === 'setScope' && node.scopePath) {
            setScopeRootAction(node.scopePath);
          } else if (act === 'exitScope') {
            setScopeRootAction('');
          } else if (act === 'ask') {
            prefilledDirLine = node.startLine || 1;
            inspectorTab = 'directive';
            selectNode(node.id);
            setTimeout(() => document.getElementById('inspDirNote')?.focus(), 30);
          } else if (act === 'attachCtx') {
            hostApi.postMessage({
              type: 'attachNodeContext',
              title: node.title,
              kind: node.kind,
              path: node.path || node.scopePath || node.defaultDirectivePath || '',
              startLine: node.startLine,
              endLine: node.endLine,
              scopeRoot,
              contextBody: node.body || node.roleSummary || ''
            });
          } else if (act === 'd-overview') {
            triggerNodeAnalyze(node, 'overview');
          } else if (act === 'd-flow') {
            triggerNodeAnalyze(node, 'flow');
          } else if (act === 'd-deep') {
            triggerNodeAnalyze(node, 'deep');
          } else if (act === 'focus') {
            selectedNodeId = node.id;
            focusMode = true;
            syncFocusButtons();
            selectNode(node.id);
            centerOnNode(node.id);
          } else if (act === 'open' && node.path) {
            hostApi.postMessage({ type: 'openFile', path: node.path, line: node.startLine || 1 });
          }
        });
      });
    }

    function setScopeRootAction(nextScope) {
      positions.clear();
      manualPositions.clear();
      collapsedIds.clear();
      selectedNodeId = null;
      inspector.classList.add('hidden');
      postStateAction({ type: 'setScopeRoot', scopeRoot: nextScope }, t('busyScope'));
    }

    function syncAnalyzeUi() {
      const banner = document.getElementById('analyzeBanner');
      const spinner = document.getElementById('analyzeSpinner');
      const textEl = document.getElementById('analyzeBannerText');
      const dismissBtn = document.getElementById('btnDismissAnalyze');

      if (analyzeState.running) {
        banner.classList.remove('hidden', 'is-error');
        spinner.classList.remove('hidden');
        textEl.textContent = analyzeState.label
          ? (t('analyzingPrefix') + analyzeState.label)
          : t('analyzingDefault');
        dismissBtn.style.display = 'none';
      } else if (analyzeState.error) {
        banner.classList.remove('hidden');
        banner.classList.add('is-error');
        spinner.classList.add('hidden');
        textEl.textContent = t('analyzeErrorPrefix') + analyzeState.error;
        dismissBtn.style.display = 'inline-flex';
      } else {
        banner.classList.add('hidden');
        banner.classList.remove('is-error');
        dismissBtn.style.display = 'none';
      }

      const branchBtn = document.getElementById('btnAnalyzeBranch');
      const branchMenuBtn = document.getElementById('btnAnalyzeBranchMenu');
      if (branchBtn) {
        branchBtn.disabled = analyzeState.running || !gitCtx;
        if (scopeRoot) {
          const rNode = nodeById.get('root');
          branchBtn.textContent = depthButtonLabel(nextRecommendedDepth(rNode));
        } else {
          branchBtn.textContent = t('analyzeBranchBtn');
        }
      }
      if (branchMenuBtn) branchMenuBtn.disabled = analyzeState.running || !gitCtx;

      const quickInspBtn = document.getElementById('btnInspAnalyzeQuick');
      const quickInspMenu = document.getElementById('btnInspAnalyzeMenu');
      if (quickInspBtn) quickInspBtn.disabled = analyzeState.running;
      if (quickInspMenu) quickInspMenu.disabled = analyzeState.running;

      const inspNodeBtn = document.getElementById('btnAnalyzeNode');
      if (inspNodeBtn) inspNodeBtn.disabled = analyzeState.running;

      nodesLayer.querySelectorAll('[data-analyze-node],[data-analyze-menu]').forEach(btn => {
        btn.disabled = analyzeState.running;
      });
    }

    function syncStorageMenu() {
      const sesSec = document.getElementById('lblSessionTargetSec');
      if (sesSec) sesSec.textContent = t('sessionTargetSec');
      const tNew = document.getElementById('lblTargetNew');
      if (tNew) tNew.textContent = t('targetNew');
      const dNew = document.getElementById('descTargetNew');
      if (dNew) dNew.textContent = t('targetNewDesc');
      const tCur = document.getElementById('lblTargetCurrent');
      if (tCur) tCur.textContent = t('targetCurrent');
      const dCur = document.getElementById('descTargetCurrent');
      if (dCur) dCur.textContent = t('targetCurrentDesc');
      const cNew = document.getElementById('chkTargetNew');
      if (cNew) cNew.textContent = agentTarget === 'new' ? '✓' : '';
      const cCur = document.getElementById('chkTargetCurrent');
      if (cCur) cCur.textContent = agentTarget === 'current' ? '✓' : '';

      document.getElementById('lblStorageSec').textContent = t('storageSec');
      document.getElementById('lblStHidden').textContent = t('stHidden');
      document.getElementById('descStHidden').textContent = t('stHiddenDesc');
      document.getElementById('lblStExcluded').textContent = t('stExcluded');
      document.getElementById('descStExcluded').textContent = t('stExcludedDesc');
      document.getElementById('lblStTracked').textContent = t('stTracked');
      document.getElementById('descStTracked').textContent = t('stTrackedDesc');
      document.getElementById('chkStHidden').textContent = storageMode === 'git-hidden' ? '✓' : '';
      document.getElementById('chkStExcluded').textContent = storageMode === 'worktree-excluded' ? '✓' : '';
      document.getElementById('chkStTracked').textContent = storageMode === 'worktree-tracked' ? '✓' : '';
    }

    function applyStaticTranslations() {
      document.getElementById('mAtlas').textContent = t('atlas');
      document.getElementById('mBriefing').textContent = t('briefing');
      document.getElementById('mHybrid').textContent = t('hybrid');
      const lblRepo = document.getElementById('lblSwitchRepo');
      if (lblRepo) lblRepo.textContent = t('switchRepoTitle');
      const pickBtn = document.getElementById('btnPickRepoDialog');
      if (pickBtn) {
        pickBtn.textContent = pickingDialog ? t('pickRepoWaiting') : t('pickRepoDialogBtn');
        pickBtn.disabled = pickingDialog;
      }
      const emptyPickBtn = document.getElementById('btnEmptyPickRepo');
      if (emptyPickBtn) {
        emptyPickBtn.textContent = pickingDialog ? t('pickRepoWaiting') : t('pickRepoDialogBtn');
        emptyPickBtn.disabled = pickingDialog;
      }
      const inlineBtn = document.getElementById('btnToggleInlineBrowser');
      if (inlineBtn) inlineBtn.textContent = dirBrowserOpen ? t('browseInlineClose') : t('browseInlineBtn');
      const lblDisc = document.getElementById('lblDiscoveredRepos');
      if (lblDisc) lblDisc.textContent = t('discoveredReposTitle');
      const lblMan = document.getElementById('lblManualPath');
      if (lblMan) lblMan.textContent = t('manualPathTitle');
      const wtBtn = document.getElementById('btnSetWorktree');
      if (wtBtn) wtBtn.textContent = t('loadRepoBtn');
      const wtInput = document.getElementById('worktreeInput');
      if (wtInput) wtInput.placeholder = t('worktreePh');

      const openDirs = (graph.summary && graph.summary.openDirectiveCount) || 0;
      const batchBtn = document.getElementById('btnDispatchBatch');
      if (batchBtn) {
        batchBtn.classList.toggle('hidden', openDirs === 0);
        if (openDirs > 0) batchBtn.textContent = t('batchDispatchFmt')(openDirs);
      }

      const diffCnt = (graph.summary && graph.summary.changedFiles) || 0;
      document.getElementById('btnSummaryToggle').textContent = t('summaryBtn') + (diffCnt > 0 ? ' (' + diffCnt + ')' : '');
      document.getElementById('btnPruneToggle').textContent = t('pruneBtn');
      document.getElementById('btnPruneToggle').classList.toggle('active', pruneUnchanged);
      document.getElementById('btnRunImpact').textContent = t('impactBtn');
      document.getElementById('searchInput').placeholder = t('searchPh');
      document.getElementById('btnDeltaToggle').textContent = t('deltaBtn');
      document.getElementById('btnDeltaToggle').classList.toggle('active', deltaOverlay);
      document.getElementById('btnFocusToggle').textContent = t('focusBtn');
      document.getElementById('btnFocusToggle').classList.toggle('active', focusMode);
      document.getElementById('btnRefresh').title = t('refreshTip');
      document.getElementById('btnInitManifest').textContent = t('initManifest');
      const agSec = document.getElementById('lblAgentBridgeSec');
      if (agSec) agSec.textContent = t('agentSec');
      document.getElementById('lblCopyMcp').textContent = t('copyMcp');
      document.getElementById('descCopyMcp').textContent = t('copyMcpDesc');
      document.getElementById('lblCopyBranch').textContent = t('copyBranch');
      document.getElementById('descCopyBranch').textContent = t('copyBranchDesc');
      document.getElementById('lblCopyManifest').textContent = t('copyManifest');
      document.getElementById('descCopyManifest').textContent = t('copyManifestDesc');
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
      syncStorageMenu();
      syncAnalyzeUi();
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

    function isExternalNodeRevealed(n) {
      if (n.kind !== 'external-dep') return true;
      if (!selectedNodeId) return false;
      return (
        selectedNodeId === n.id ||
        selectedNodeId === n.parentId ||
        selectedNodeId === 'root'
      );
    }

    function getVisibleNodeIds() {
      const childrenMap = getChildrenMap();
      const visible = new Set();
      function visit(id) {
        const node = nodeById.get(id);
        if (!node || !isExternalNodeRevealed(node)) return;
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

    function pairVerticalGap(prevId, nextId) {
      const a = nodeById.get(prevId);
      const b = nodeById.get(nextId);
      return (isCompactNode(a) && isCompactNode(b)) ? Y_GAP_COMPACT : Y_GAP_CARD;
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
          if (i > 0) sum += pairVerticalGap(kids[i - 1], kids[i]);
          sum += measureSubtree(kids[i]);
        }
        const total = Math.max(selfH, sum);
        subtreeHeights.set(id, total);
        return total;
      }

      function placeSubtree(id, colLeftX, bandTop) {
        const selfH = getNodeHeight(id);
        const selfW = getNodeWidth(id);
        const bandH = subtreeHeights.get(id) || selfH;
        const topY = bandTop + (bandH - selfH) / 2;

        if (forceReset || (!positions.has(id) && !manualPositions.has(id))) {
          positions.set(id, { x: colLeftX, y: topY });
        }

        const kids = (childrenMap.get(id) || []).filter(cid => visible.has(cid));
        if (kids.length === 0) return;

        let kidsTotal = 0;
        for (let i = 0; i < kids.length; i++) {
          if (i > 0) kidsTotal += pairVerticalGap(kids[i - 1], kids[i]);
          kidsTotal += subtreeHeights.get(kids[i]) || getNodeHeight(kids[i]);
        }
        let childCursor = bandTop + (bandH - kidsTotal) / 2;
        const nextColX = colLeftX + selfW + COL_GAP;
        for (let i = 0; i < kids.length; i++) {
          const cid = kids[i];
          const ch = subtreeHeights.get(cid) || getNodeHeight(cid);
          placeSubtree(cid, nextColX, childCursor);
          childCursor += ch + (i + 1 < kids.length ? pairVerticalGap(cid, kids[i + 1]) : 0);
        }
      }

      const roots = graph.nodes.filter(n => !n.parentId);
      let rootCursor = 0;
      for (const r of roots) {
        const h = measureSubtree(r.id);
        placeSubtree(r.id, 0, rootCursor);
        rootCursor += h + Y_GAP_CARD * 2;
      }
    }

    function centerOnNode(id) {
      const p = positions.get(id);
      if (!p) return;
      const rect = viewport.getBoundingClientRect();
      const w = getNodeWidth(id);
      const h = getNodeHeight(id);
      cam.x = rect.width / 2 - (p.x + w / 2) * cam.scale;
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
        maxX = Math.max(maxX, p.x + getNodeWidth(id));
        maxY = Math.max(maxY, p.y + getNodeHeight(id));
      }
      const rect = viewport.getBoundingClientRect();
      const pad = 48;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scale = Math.min(1.04, Math.max(0.16, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h)));
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
        const hay = (n.title + ' ' + (n.subtitle || '') + ' ' + (n.body || '') + ' ' + (n.roleSummary || '') + ' ' + (n.path || '') + ' ' + (n.layer || '')).toLowerCase();
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
      if (n.kind === 'external-dep') return false;
      if (focusedSet && !focusedSet.has(n.id)) return true;
      if (chipSet && !chipSet.has(n.id)) return true;
      if (deltaOverlay && !n.changed && n.kind !== 'root' && n.kind !== 'directive') return true;
      if (matchedIds && !matchedIds.has(n.id)) return true;
      return false;
    }

    function isEdgeDimmed(e, focusedSet, chipSet, matchedIds) {
      if (e.kind === 'dep' || e.kind === 'external') return false;
      const targetNode = nodeById.get(e.to);
      if (focusedSet && (!focusedSet.has(e.from) || !focusedSet.has(e.to))) return true;
      if (chipSet && (!chipSet.has(e.from) || !chipSet.has(e.to))) return true;
      if (targetNode && deltaOverlay && !targetNode.changed && targetNode.kind !== 'root' && targetNode.kind !== 'directive') return true;
      if (matchedIds && !matchedIds.has(e.to) && !matchedIds.has(e.from)) return true;
      return false;
    }

    function renderEdges() {
      const visible = getVisibleNodeIds();
      const focusedSet = getFocusedSet();
      const chipSet = computeFilterSet();
      const matchedIds = searchQuery.trim() ? new Set(searchMatches) : null;

      let svgHtml =
        '<defs>' +
          '<marker id="arr-flow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#4da6ff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
          '<marker id="arr-blocking" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#f0883e" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
          '<marker id="arr-impact" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#39c5cf" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
          '<marker id="arr-dep" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#58a6ff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
          '<marker id="arr-directive" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#a371f7" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
          '<marker id="arr-external" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1.2 7 4 1 6.8" fill="none" stroke="#56b6c2" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>' +
        '</defs>';

      const hierarchyByParent = new Map();
      const curvedEdges = [];

      for (const e of graph.edges) {
        if (!visible.has(e.from) || !visible.has(e.to)) continue;
        if (e.kind === 'dep' && selectedNodeId !== e.from && selectedNodeId !== e.to) continue;
        if (e.kind === 'hierarchy') {
          if (!hierarchyByParent.has(e.from)) hierarchyByParent.set(e.from, []);
          hierarchyByParent.get(e.from).push(e);
        } else {
          curvedEdges.push(e);
        }
      }

      for (const [parentId, list] of hierarchyByParent.entries()) {
        const p1 = positions.get(parentId);
        if (!p1) continue;
        const x1 = p1.x + getNodeWidth(parentId);
        const y1 = p1.y + getNodeHeight(parentId) / 2;

        const forward = [];
        for (const e of list) {
          const p2 = positions.get(e.to);
          if (!p2) continue;
          const x2 = p2.x;
          const y2 = p2.y + getNodeHeight(e.to) / 2;
          const dimmed = isEdgeDimmed(e, focusedSet, chipSet, matchedIds);
          const focused = Boolean(
            (focusedSet && focusedSet.has(e.from) && focusedSet.has(e.to)) ||
            (selectedNodeId && (selectedNodeId === e.to))
          );
          if (x2 >= x1 + 16) {
            forward.push({ e, x2, y2, dimmed, focused });
          } else {
            curvedEdges.push(e);
          }
        }

        if (forward.length === 1 && Math.abs(forward[0].y2 - y1) < 2) {
          const item = forward[0];
          const cls = 'edge-bus' + (item.dimmed ? ' dimmed' : '') + (item.focused ? ' focused' : '');
          svgHtml += '<path class="' + cls + '" d="M ' + x1 + ' ' + y1 + ' L ' + item.x2 + ' ' + item.y2 + '" />';
          continue;
        }

        if (forward.length > 0) {
          let minX2 = Infinity;
          let minY = y1;
          let maxY = y1;
          let allDimmed = true;
          for (const item of forward) {
            if (item.x2 < minX2) minX2 = item.x2;
            if (item.y2 < minY) minY = item.y2;
            if (item.y2 > maxY) maxY = item.y2;
            if (!item.dimmed) allDimmed = false;
          }
          const busX = Math.round(x1 + Math.max(14, Math.min(26, (minX2 - x1) * 0.46)));
          const baseCls = 'edge-bus' + (allDimmed ? ' dimmed' : '');

          svgHtml += '<path class="' + baseCls + '" d="M ' + x1 + ' ' + y1 + ' L ' + busX + ' ' + y1 + '" />';
          if (maxY - minY > 0.5) {
            svgHtml += '<path class="' + baseCls + '" d="M ' + busX + ' ' + minY + ' L ' + busX + ' ' + maxY + '" />';
          }

          for (const item of forward) {
            if (item.focused && !item.dimmed) continue;
            const tickCls = 'edge-bus' + (item.dimmed ? ' dimmed' : '');
            svgHtml += '<path class="' + tickCls + '" d="M ' + busX + ' ' + item.y2 + ' L ' + item.x2 + ' ' + item.y2 + '" />';
          }

          for (const item of forward) {
            if (item.focused && !item.dimmed) {
              const r = Math.min(6, Math.abs(item.y2 - y1) / 2, Math.abs(busX - x1) / 2, Math.abs(item.x2 - busX) / 2);
              if (r < 1.5) {
                svgHtml += '<path class="edge-bus focused" d="M ' + x1 + ' ' + y1 + ' L ' + busX + ' ' + y1 + ' L ' + busX + ' ' + item.y2 + ' L ' + item.x2 + ' ' + item.y2 + '" />';
              } else {
                const dir = item.y2 > y1 ? 1 : -1;
                const d =
                  'M ' + x1 + ' ' + y1 +
                  ' L ' + (busX - r) + ' ' + y1 +
                  ' Q ' + busX + ' ' + y1 + ' ' + busX + ' ' + (y1 + dir * r) +
                  ' L ' + busX + ' ' + (item.y2 - dir * r) +
                  ' Q ' + busX + ' ' + item.y2 + ' ' + (busX + r) + ' ' + item.y2 +
                  ' L ' + item.x2 + ' ' + item.y2;
                svgHtml += '<path class="edge-bus focused" d="' + d + '" />';
              }
            }
          }
        }
      }

      for (const e of curvedEdges) {
        const p1 = positions.get(e.from);
        const p2 = positions.get(e.to);
        if (!p1 || !p2) continue;

        const w1 = getNodeWidth(e.from);
        let d = '';
        let mx = 0;
        let my = 0;
        if (e.kind === 'dep' && Math.abs(p1.x - p2.x) < w1) {
          const x1 = p1.x;
          const y1 = p1.y + getNodeHeight(e.from) / 2;
          const x2 = p2.x;
          const y2 = p2.y + getNodeHeight(e.to) / 2;
          const arcOffset = Math.min(104, Math.max(44, Math.abs(y2 - y1) * 0.22));
          d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 - arcOffset) + ' ' + y1 + ', ' + (x2 - arcOffset) + ' ' + y2 + ', ' + x2 + ' ' + y2;
          mx = x1 - arcOffset * 0.78;
          my = (y1 + y2) / 2;
        } else {
          const x1 = p1.x + w1;
          const y1 = p1.y + getNodeHeight(e.from) / 2;
          const x2 = p2.x;
          const y2 = p2.y + getNodeHeight(e.to) / 2;
          const dx = Math.max(40, Math.abs(x2 - x1) * 0.46);
          d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
          mx = (x1 + x2) / 2;
          my = (y1 + y2) / 2;
        }

        const dimmed = isEdgeDimmed(e, focusedSet, chipSet, matchedIds);
        const isFocused = e.kind === 'dep' || e.kind === 'external' || (focusedSet && focusedSet.has(e.from) && focusedSet.has(e.to));
        const markerAttr =
          e.kind === 'flow' || e.kind === 'blocking' || e.kind === 'impact' || e.kind === 'dep' || e.kind === 'directive' || e.kind === 'external'
            ? ' marker-end="url(#arr-' + esc(e.kind) + ')"'
            : '';

        svgHtml += '<path class="edge-path ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + (isFocused ? ' focused' : '') + '" d="' + d + '"' + markerAttr + ' />';
        if (e.label) {
          const pw = e.label.length * 7.5 + 14;
          svgHtml += '<rect class="edge-pill ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + '" x="' + (mx - pw / 2) + '" y="' + (my - 8) + '" width="' + pw + '" height="15" rx="7.5" />';
          svgHtml += '<text class="edge-label ' + esc(e.kind) + (dimmed ? ' dimmed' : '') + '" x="' + mx + '" y="' + (my + 2.8) + '" text-anchor="middle">' + esc(e.label) + '</text>';
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
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">' +
          '<code>' + esc(bs.branch) + '</code> vs <code>' + esc(bs.baseRef) + '</code>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">' + esc(t('summaryPruneHint')) + '</div>';

      html += '<div class="summary-sec">' + esc(t('summaryImpacted')) + ' (' + bs.impactedDomains.length + ')</div>';
      if (bs.impactedDomains.length === 0) {
        html += '<div style="font-size:11.5px;color:var(--muted);">' + esc(t('summaryNoDiff')) + '</div>';
      } else {
        for (const d of bs.impactedDomains) {
          html +=
            '<div class="summary-item" data-jump-node="' + esc(d.nodeId) + '" data-expand-dom="' + esc(d.domainId) + '">' +
              '<div class="summary-item-top">' +
                '<span style="display:inline-flex;align-items:center;gap:6px;min-width:0;">' +
                  getNodeIconSvg({ kind: 'domain', title: d.name }, false) +
                  '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(d.name) + '</span>' +
                '</span>' +
                '<span style="flex-shrink:0;"><span class="diff-add">+' + d.additions + '</span> <span class="diff-del">-' + d.deletions + '</span></span>' +
              '</div>' +
              '<div class="summary-item-sub">' +
                (d.layer ? esc(d.layer) + ' · ' : '') + d.changedFiles + (lang === 'zh' ? ' 个变更文件' : ' changed files') +
              '</div>' +
            '</div>';
        }
      }

      if (bs.claimItems && bs.claimItems.length > 0) {
        html += '<div class="summary-sec">' + esc(t('summaryClaims')) + ' (' + bs.claimItems.length + ')</div>';
        for (const c of bs.claimItems) {
          html +=
            '<div class="summary-item" data-jump-node="' + esc(c.nodeId) + '">' +
              '<div class="summary-item-top">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.id + ' · ' + c.title) + '</span>' +
                '<span class="badge badge-' + esc(c.badge) + '">' + esc((t('badge')[c.badge] || c.badge)) + '</span>' +
              '</div>' +
            '</div>';
        }
      }

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
            postStateAction({ type: 'expandDomainFiles', domainId: domId }, t('busyExpandFiles'));
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
      let bcHtml = '';

      const ancestors = graph.scopeAncestors || [];
      if (scopeRoot && ancestors.length > 0) {
        bcHtml += ancestors.map((anc, idx) => {
          const isLast = idx === ancestors.length - 1;
          const icon = idx === 0 ? '🏠 ' : (isLast ? '🎯 ' : '');
          return (idx > 0 ? '<span style="opacity:0.4;">/</span>' : '') +
            '<span class="crumb' + (isLast ? ' scope-active' : '') + '" data-scope-crumb="' + esc(anc.scopePath) + '">' +
              icon + esc(anc.label) +
            '</span>';
        }).join('');
        bcHtml += '<button class="scope-exit-btn" id="btnScopeResetCrumb" title="' + esc(t('exitScopeRoot')) + '">✕</button>';
      }

      if (selectedNodeId && nodeById.has(selectedNodeId) && selectedNodeId !== 'root') {
        const chain = [];
        let cur = nodeById.get(selectedNodeId);
        while (cur && cur.id !== 'root') {
          chain.unshift(cur);
          cur = cur.parentId ? nodeById.get(cur.parentId) : null;
        }
        if (chain.length > 0) {
          if (bcHtml) bcHtml += '<span style="opacity:0.4;margin:0 4px;">·</span>';
          bcHtml += chain.map((n, idx) =>
            (idx > 0 ? '<span style="opacity:0.4;">›</span>' : '') +
            '<span class="crumb" data-crumb="' + esc(n.id) + '">' + esc(n.title) + '</span>'
          ).join('');
        }
      } else if (!scopeRoot) {
        bcHtml = '<span>' + esc(t('defaultCrumb')) + '</span>';
      }

      bcEl.innerHTML = bcHtml;
      bcEl.querySelectorAll('[data-scope-crumb]').forEach(el => {
        el.addEventListener('click', () => setScopeRootAction(el.dataset.scopeCrumb));
      });
      const resetCrumb = document.getElementById('btnScopeResetCrumb');
      if (resetCrumb) {
        resetCrumb.addEventListener('click', () => setScopeRootAction(''));
      }
      bcEl.querySelectorAll('[data-crumb]').forEach(el => {
        el.addEventListener('click', () => {
          selectNode(el.dataset.crumb);
          centerOnNode(el.dataset.crumb);
        });
      });

      const s = graph.summary || {};
      const chips = [];
      if (s.verified > 0) chips.push('<span class="chip ok" data-chip="trust">' + (lang === 'zh' ? '✓ 已核验 ' : '✓ Verified ') + s.verified + '</span>');
      if (s.mismatch > 0) chips.push('<span class="chip err' + (activeChipFilter === 'mismatch' ? ' active' : '') + '" data-chip="mismatch">' + (lang === 'zh' ? '✕ 失配 ' : '✕ Mismatch ') + s.mismatch + '</span>');
      if (s.stale > 0) chips.push('<span class="chip warn" data-chip="trust">' + (lang === 'zh' ? '⟳ 陈旧 ' : '⟳ Stale ') + s.stale + '</span>');
      if (s.blockingCount > 0) chips.push('<span class="chip warn' + (activeChipFilter === 'blocking' ? ' active' : '') + '" data-chip="blocking">' + (lang === 'zh' ? '守卫 ' : 'Guards ') + s.blockingCount + '</span>');
      if (s.impactCount > 0) chips.push('<span class="chip' + (activeChipFilter === 'impact' ? ' active' : '') + '" style="color:var(--cyan);background:rgba(57,197,207,0.14);" data-chip="impact">' + (lang === 'zh' ? '跨模块影响 ' : 'Impact ') + s.impactCount + '</span>');
      if (scopeRoot && s.externalBoundaryCount > 0) {
        chips.push('<span class="chip" data-chip="showRootExt" style="color:#56b6c2;background:rgba(86,182,194,0.14);">' + (lang === 'zh' ? '⇄ 外部引用 ' : '⇄ Ext Refs ') + s.externalBoundaryCount + '</span>');
      }
      if (s.manifestIssues && s.manifestIssues.length > 0) chips.push('<span class="chip err" data-chip="trust">' + (lang === 'zh' ? '清单漂移 ' : 'Manifest Drift ') + s.manifestIssues.length + '</span>');
      if (s.blindSpots && s.blindSpots.length > 0) chips.push('<span class="chip warn" data-chip="trust">' + (lang === 'zh' ? '盲区 ' : 'Blind Spots ') + s.blindSpots.length + '</span>');
      if (s.directiveCount > 0) chips.push('<span class="chip dir' + (activeChipFilter === 'directive' ? ' active' : '') + '" data-chip="directive">' + (lang === 'zh' ? '批注 ' : 'Directives ') + s.directiveCount + '</span>');
      if (s.prunedCount > 0) chips.push('<span class="chip">' + (lang === 'zh' ? '已过滤 ' : 'Filtered ') + s.prunedCount + '</span>');
      if (s.hiddenSupportFiles > 0 || showSupportAssets) {
        const supLabel = showSupportAssets
          ? (lang === 'zh' ? '静态/支持文件: 显示' : 'Support Files: Shown')
          : (lang === 'zh' ? '已折叠资源 ' + s.hiddenSupportFiles : 'Folded Assets ' + s.hiddenSupportFiles);
        chips.push('<span class="chip' + (showSupportAssets ? ' active' : '') + '" data-chip="toggleSupport" title="' + (lang === 'zh' ? '切换显示或隐藏文档、静态资源与构建配置模块' : 'Toggle docs, static assets, and config modules') + '">' + supLabel + '</span>');
      }

      const tc = document.getElementById('trustChips');
      tc.innerHTML = chips.join('');
      tc.querySelectorAll('[data-chip]').forEach(el => {
        el.addEventListener('click', () => {
          const kind = el.dataset.chip;
          if (kind === 'toggleSupport') {
            postStateAction({ type: 'toggleSupportAssets' }, t('busySync'));
            return;
          }
          if (kind === 'showRootExt') {
            selectNode('root');
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
        const nonExtKids = (childrenMap.get(n.id) || []).filter(cid => {
          const cn = nodeById.get(cid);
          return cn && cn.kind !== 'external-dep';
        });
        const isCollapsed = collapsedIds.has(n.id);
        const compact = isCompactNode(n);
        const extCount = (n.externalOutCount || 0) + (n.externalInCount || 0);

        const el = document.createElement('div');
        el.className =
          'node kind-' + n.kind +
          (compact ? ' node-compact' : '') +
          (n.isSummary ? ' is-summary' : '') +
          (n.isSupport ? ' is-support' : '') +
          (n.directiveStatus === 'resolved' ? ' is-resolved' : '') +
          (n.badge === 'mismatch' ? ' has-mismatch' : '');
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        if (n.path || n.subtitle) {
          el.title = n.path || n.subtitle || n.title;
        }
        el.dataset.id = n.id;

        const iconHtml = getNodeIconSvg(n, !isCollapsed);

        if (compact) {
          const subText = formatCompactSubtitle(n);
          let tagHtml = '';
          if (n.isRecommendedEntry) {
            tagHtml += '<span class="micro-tag star-tag">' + esc(t('recStarTag')) + '</span>';
          }
          if (n.kind === 'entrypoint') {
            tagHtml += '<span class="micro-tag">' + esc(t('entryTag')) + '</span>';
          } else if (n.badge === 'verified') {
            tagHtml += '<span class="status-dot" style="background:var(--green);" title="Verified"></span>';
          } else if (n.badge === 'mismatch') {
            tagHtml += '<span class="status-dot" style="background:var(--red);" title="Mismatch"></span>';
          }
          if (extCount > 0) {
            tagHtml += '<span class="ext-badge" title="点击查看视图外依赖边界">' + esc(t('extBadgeFmt')(extCount)) + '</span>';
          }

          let rightHtml = '';
          if (n.kind === 'folder' && n.canExpandFiles && n.folderId) {
            const folderLbl = n.filesExpanded ? t('collapseDomainFiles') : String(n.fileCount || 0) + ' ▸';
            rightHtml =
              (n.changed ? '<span class="status-dot" style="background:var(--yellow);" title="Changed"></span>' : '') +
              '<button class="quick-btn" data-toggle-folder="' + esc(n.folderId) + '">' + esc(folderLbl) + '</button>';
          } else if (n.kind === 'external-dep' && n.scopePath) {
            rightHtml = '<button class="quick-btn" data-jump-scope="' + esc(n.scopePath) + '" title="' + esc(t('switchScopeToExt')) + '">🎯</button>';
          } else {
            const diffPart =
              n.changed && (n.additions !== undefined || n.deletions !== undefined)
                ? '<span class="leaf-diff"><span class="diff-add">+' + (n.additions || 0) + '</span><span class="diff-del">-' + (n.deletions || 0) + '</span></span>'
                : (n.changed ? '<span class="status-dot" style="background:var(--yellow);"></span>' : '');
            const openBtnPart = n.path
              ? '<button class="leaf-open" title="' + esc(t('openBtn')) + '" data-jump-path="' + esc(n.path) + '" data-jump-line="' + esc(n.startLine || 1) + '">↗</button>'
              : '';
            rightHtml = diffPart + openBtnPart;
          }

          el.innerHTML =
            '<div class="leaf-row">' +
              iconHtml +
              '<div class="leaf-main">' +
                '<div class="leaf-title-row">' +
                  '<span class="leaf-title">' + esc(n.title) + '</span>' +
                  tagHtml +
                '</div>' +
                (subText ? '<div class="leaf-sub">' + esc(subText) + '</div>' : '') +
                (n.roleSummary ? '<div class="leaf-role">' + esc(n.roleSummary) + '</div>' : '') +
              '</div>' +
              (rightHtml ? '<div class="leaf-right">' + rightHtml + '</div>' : '') +
            '</div>';
        } else {
          let topRight = '';
          if (extCount > 0) {
            topRight += '<span class="ext-badge" title="点击查看视图外依赖边界">' + esc(t('extBadgeFmt')(extCount)) + '</span>';
          }
          if (n.badge) {
            topRight += '<span class="badge badge-' + esc(n.badge) + '">' + esc(badgeLabels[n.badge] || n.badge) + '</span>';
          } else if (n.layer) {
            topRight += '<span class="layer-tag" title="' + esc(n.layer) + '">' + esc(n.layer) + '</span>';
          } else if (n.kind === 'blocking' || n.kind === 'impact' || n.kind === 'directive') {
            topRight += '<span class="layer-tag">' + esc(kindLabels[n.kind] || n.kind) + '</span>';
          }

          const showSub =
            n.subtitle &&
            n.subtitle !== n.title &&
            n.kind !== 'claim';

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
          if (n.resolutionSummary) {
            middleHtml += '<div class="resolution-box">✓ ' + esc(n.resolutionSummary) + '</div>';
          }

          let footerLeft = '';
          if (n.changed && (n.additions !== undefined || n.deletions !== undefined)) {
            footerLeft = '<span class="node-footer-meta"><span class="diff-add">+' + (n.additions || 0) + '</span> <span class="diff-del">-' + (n.deletions || 0) + '</span></span>';
          } else if (n.changed) {
            footerLeft = '<span class="node-footer-meta" style="color:var(--yellow);"><span class="status-dot" style="background:var(--yellow);"></span>' + (lang === 'zh' ? '有变更' : 'modified') + '</span>';
          } else if (n.kind === 'domain' && n.fileCount) {
            footerLeft = '<span class="node-footer-meta">' + n.fileCount + (lang === 'zh' ? ' 文件' : ' files') + '</span>';
          }

          const nextD = nextRecommendedDepth(n);
          const cardAnalyzeSplit =
            n.kind === 'domain' && !n.isSummary
              ? '<span class="card-split-analyze analyze-action">' +
                  '<button data-analyze-node="' + esc(n.id) + '"' + (analyzeState.running ? ' disabled' : '') + '>' + esc(depthButtonLabel(nextD)) + '</button>' +
                  '<button data-analyze-menu="' + esc(n.id) + '"' + (analyzeState.running ? ' disabled' : '') + '>▾</button>' +
                '</span>'
              : '';

          let footerRight = '';
          if (n.kind === 'domain' && n.canExpandFiles && n.domainId) {
            const lbl = n.filesExpanded
              ? (t('collapseDomainFiles') + ' ▴')
              : (t('expandDomainFiles') + ' ▸');
            footerRight =
              '<span class="node-footer-actions">' +
                cardAnalyzeSplit +
                '<button class="quick-btn" data-toggle-dom="' + esc(n.domainId) + '">' + esc(lbl) + '</button>' +
              '</span>';
          } else if (cardAnalyzeSplit) {
            footerRight = '<span class="node-footer-actions">' + cardAnalyzeSplit + '</span>';
          } else if (n.path) {
            footerRight = '<button class="quick-btn" data-jump-path="' + esc(n.path) + '" data-jump-line="' + esc(n.startLine || 1) + '">' + esc(t('openBtn')) + '</button>';
          }

          const footerHtml = (footerLeft || footerRight)
            ? '<div class="node-footer">' + (footerLeft || '<span></span>') + footerRight + '</div>'
            : '';

          el.innerHTML =
            '<div class="card-head">' +
              '<div class="card-head-left">' +
                iconHtml +
                '<span class="node-title">' + esc(n.title) + '</span>' +
              '</div>' +
              '<div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">' + topRight + '</div>' +
            '</div>' +
            (showSub ? '<div class="node-sub" title="' + esc(n.subtitle) + '">' + esc(n.subtitle) + '</div>' : '') +
            middleHtml +
            footerHtml;
        }

        const qj = el.querySelector('[data-jump-path]');
        if (qj) {
          qj.addEventListener('mousedown', (ev) => ev.stopPropagation());
          qj.addEventListener('click', (ev) => {
            ev.stopPropagation();
            hostApi.postMessage({ type: 'openFile', path: qj.dataset.jumpPath, line: parseInt(qj.dataset.jumpLine || '1', 10) });
          });
        }

        const jScope = el.querySelector('[data-jump-scope]');
        if (jScope) {
          jScope.addEventListener('mousedown', (ev) => ev.stopPropagation());
          jScope.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setScopeRootAction(jScope.dataset.jumpScope);
          });
        }

        const anBtn = el.querySelector('[data-analyze-node]');
        if (anBtn) {
          anBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
          anBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            triggerNodeAnalyze(n);
          });
        }

        const anMenuBtn = el.querySelector('[data-analyze-menu]');
        if (anMenuBtn) {
          anMenuBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
          anMenuBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openDepthPopover(anMenuBtn, n);
          });
        }

        const domToggle = el.querySelector('[data-toggle-dom]');
        if (domToggle) {
          domToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
          domToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            pendingCenterNodeId = n.id;
            collapsedIds.delete(n.id);
            postStateAction({ type: 'toggleDomainFiles', domainId: domToggle.dataset.toggleDom }, t('busyExpandFiles'));
          });
        }

        const folderToggle = el.querySelector('[data-toggle-folder]');
        if (folderToggle) {
          folderToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
          folderToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            pendingCenterNodeId = n.id;
            collapsedIds.delete(n.id);
            postStateAction({ type: 'toggleFolderFiles', folderId: folderToggle.dataset.toggleFolder }, t('busyExpandFiles'));
          });
        }

        if (nonExtKids.length > 0) {
          const btn = document.createElement('button');
          btn.className = 'collapse-btn' + (isCollapsed ? ' is-collapsed' : '');
          btn.textContent = isCollapsed ? ('+' + nonExtKids.length) : '−';
          btn.title = isCollapsed ? (lang === 'zh' ? '展开子节点' : 'Expand children') : (lang === 'zh' ? '折叠子节点' : 'Collapse children');
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

        el.addEventListener('contextmenu', (ev) => openNodeContextMenu(ev, n));

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
          closePopovers();
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
          const w = el.offsetWidth;
          if (h > 0 && Math.abs((measuredHeights.get(el.dataset.id) || 0) - h) > 2) {
            measuredHeights.set(el.dataset.id, h);
            changed = true;
          }
          if (w > 0 && Math.abs((measuredWidths.get(el.dataset.id) || 0) - w) > 2) {
            measuredWidths.set(el.dataset.id, w);
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
      btn.classList.toggle('active', focusMode);
      const ibtn = document.getElementById('btnInspFocus');
      if (ibtn) ibtn.classList.toggle('active', focusMode);
    }

    function selectNode(nodeId) {
      const prevVisKey = [...getVisibleNodeIds()].join('|');
      selectedNodeId = nodeId;
      const nextVisKey = [...getVisibleNodeIds()].join('|');
      if (prevVisKey !== nextVisKey) {
        // Re-layout cleanly when selecting a node reveals/hides external boundary ghost nodes!
        computeTidyLayout(true);
        buildNodeDom(true);
      }

      const node = nodeById.get(nodeId);
      const inspAnalyzeWrap = document.getElementById('inspAnalyzeWrap');
      const quickInspBtn = document.getElementById('btnInspAnalyzeQuick');
      const scopeRootBtn = document.getElementById('btnInspScopeRoot');

      if (!node) {
        if (inspAnalyzeWrap) inspAnalyzeWrap.style.display = 'none';
        if (scopeRootBtn) scopeRootBtn.style.display = 'none';
        inspector.classList.add('hidden');
        syncVisualClasses();
        return;
      }

      if (inspAnalyzeWrap && quickInspBtn) {
        const showAn = isAnalyzableNode(node) && !document.body.classList.contains('no-analyze-cap');
        inspAnalyzeWrap.style.display = showAn ? 'inline-flex' : 'none';
        quickInspBtn.textContent = depthButtonLabel(nextRecommendedDepth(node));
        quickInspBtn.disabled = analyzeState.running;
      }

      if (scopeRootBtn) {
        if (node.kind === 'root' && scopeRoot) {
          scopeRootBtn.style.display = 'inline-flex';
          scopeRootBtn.textContent = t('exitScopeRoot');
          scopeRootBtn.onclick = () => setScopeRootAction('');
        } else if (node.scopePath && node.scopePath !== scopeRoot && (node.kind === 'domain' || node.kind === 'folder' || node.kind === 'external-dep')) {
          scopeRootBtn.style.display = 'inline-flex';
          scopeRootBtn.textContent = node.kind === 'external-dep' ? t('switchScopeToExt') : t('setScopeRoot');
          scopeRootBtn.onclick = () => setScopeRootAction(node.scopePath);
        } else {
          scopeRootBtn.style.display = 'none';
        }
      }

      inspector.classList.remove('hidden');
      document.getElementById('inspIcon').innerHTML = getNodeIconSvg(node, Boolean(node.filesExpanded));
      document.getElementById('inspTitle').textContent = node.title;
      syncVisualClasses();
      renderInspector(node);
      if (node.path) {
        if (!snippetCache.has(node.id)) {
          hostApi.postMessage({
            type: 'requestSnippet',
            nodeId: node.id,
            path: node.path,
            startLine: node.startLine || 1,
            endLine: node.endLine || (node.startLine || 1),
            fromBriefing: Boolean(node.fromBriefing)
          });
        }
        if (!diffCache.has(node.id)) {
          hostApi.postMessage({
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
          html += '<ul style="margin:0 0 12px;padding-left:18px;font-size:12px;line-height:1.5;">' + s.blindSpots.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>';
        }

        html += '<div style="font-weight:600;margin:12px 0 6px;">' + esc(t('guardrailsTitle')) + '</div>';
        if (!s.guardrails || s.guardrails.length === 0) {
          html += '<div style="color:var(--muted);font-size:12px;">' + esc(t('noGuardrails')) + '</div>';
        } else {
          html += '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">' + s.guardrails.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>';
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
        const defaultPath = node.defaultDirectivePath || node.path || node.scopePath || scopeRoot || '(root)';
        const defaultLine = prefilledDirLine || node.startLine || 1;
        prefilledDirLine = null;
        const dirKindLabelMap = {
          question: t('dirKindQuestion'),
          rework: t('dirKindRework'),
          constraint: t('dirKindConstraint')
        };

        el.innerHTML =
          '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">' + esc(t('dirHelp')) + ' <strong>' + esc(node.title) + '</strong></div>' +
          '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">' +
            '<button class="select-trigger" id="btnInspDirKind" style="max-width:168px;flex-shrink:0;">' +
              '<span class="select-trigger-label" id="lblInspDirKindVal">' + esc(dirKindLabelMap[currentDirKind] || dirKindLabelMap.question) + '</span>' +
              '<span class="select-caret">▾</span>' +
            '</button>' +
            '<input id="inspDirPath" value="' + esc(defaultPath) + '" placeholder="relative/path" style="flex:1;min-width:90px;" />' +
            '<input id="inspDirLine" type="number" min="1" value="' + esc(defaultLine) + '" style="width:64px;" title="Line" />' +
          '</div>' +
          '<textarea id="inspDirNote" rows="4" style="width:100%;" placeholder="' + esc(t('dirPlaceholder')) + '"></textarea>' +
          '<div id="dirValidation" style="font-size:11px;color:var(--red);margin-top:4px;min-height:15px;"></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' +
            '<button class="btn-analyze analyze-action" id="btnAskAgentNow" disabled>' + esc(t('askNowBtn')) + '</button>' +
            '<button class="secondary" id="btnAddCanvasDir" disabled>' + esc(t('dirWireBtn')) + '</button>' +
            '<button class="secondary vscode-only" id="btnInspCopyDirs">' + esc(t('dirCopyBtn')) + '</button>' +
          '</div>';

        const dirKindBtn = document.getElementById('btnInspDirKind');
        if (dirKindBtn) {
          dirKindBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openCustomSelect({
              anchorEl: dirKindBtn,
              width: 224,
              activeValue: currentDirKind,
              items: [
                { value: 'question', label: t('dirKindQuestion') },
                { value: 'rework', label: t('dirKindRework') },
                { value: 'constraint', label: t('dirKindConstraint') }
              ],
              onSelect: (val) => {
                currentDirKind = val;
                const lbl = document.getElementById('lblInspDirKindVal');
                if (lbl) lbl.textContent = dirKindLabelMap[val] || val;
              }
            });
          });
        }

        const pathInput = document.getElementById('inspDirPath');
        const noteInput = document.getElementById('inspDirNote');
        const askNowBtn = document.getElementById('btnAskAgentNow');
        const addBtn = document.getElementById('btnAddCanvasDir');
        const valEl = document.getElementById('dirValidation');

        function validateForm() {
          const p = pathInput.value.trim();
          const n = noteInput.value.trim();
          if (!p) {
            valEl.textContent = t('dirPathReq');
            addBtn.disabled = true;
            if (askNowBtn) askNowBtn.disabled = true;
          } else if (!n) {
            valEl.textContent = '';
            addBtn.disabled = true;
            if (askNowBtn) askNowBtn.disabled = true;
          } else {
            valEl.textContent = '';
            addBtn.disabled = false;
            if (askNowBtn) askNowBtn.disabled = analyzeState.running;
          }
        }
        pathInput.addEventListener('input', validateForm);
        noteInput.addEventListener('input', validateForm);
        validateForm();

        if (askNowBtn) {
          askNowBtn.addEventListener('click', () => {
            const note = noteInput.value.trim();
            const p = pathInput.value.trim();
            const line = parseInt(document.getElementById('inspDirLine').value, 10);
            if (!note || !p) return;
            hostApi.postMessage({
              type: 'askAgentNow',
              directiveKind: currentDirKind,
              agentTarget,
              path: p,
              startLine: Number.isFinite(line) ? line : 1,
              targetNodeId: node.id,
              title: node.title,
              contextBody: node.body || node.roleSummary || '',
              note
            });
            inspectorTab = 'overview';
          });
        }

        addBtn.addEventListener('click', () => {
          const note = noteInput.value.trim();
          const p = pathInput.value.trim();
          const line = parseInt(document.getElementById('inspDirLine').value, 10);
          if (!note || !p) return;
          postStateAction({
            type: 'addDirective',
            kind: currentDirKind,
            path: p,
            startLine: Number.isFinite(line) ? line : 1,
            targetNodeId: node.id,
            note
          }, t('busySync'));
          inspectorTab = 'overview';
        });
        document.getElementById('btnInspCopyDirs').addEventListener('click', () => {
          hostApi.postMessage({ type: 'copyDirectives' });
        });
        return;
      }

      // Overview & Code tab
      const snippet = snippetCache.get(node.id);
      let html =
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' +
          '<span class="layer-tag">' + esc(kindLabels[node.kind] || node.kind) + '</span>' +
          (node.badge ? '<span class="badge badge-' + esc(node.badge) + '">' + esc(badgeLabels[node.badge] || node.badge) + '</span>' : '') +
          (node.layer ? '<span class="layer-tag">' + esc(node.layer) + '</span>' : '') +
        '</div>';

      if (node.subtitle && node.subtitle !== node.path && node.subtitle !== node.title) {
        html += '<div style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-bottom:8px;">' + esc(node.subtitle) + '</div>';
      }
      if (node.kind === 'blocking' && node.condition) {
        html +=
          '<div class="blocking-box" style="margin-bottom:10px;">' +
            '<div class="blocking-if">IF: ' + esc(node.condition) + '</div>' +
            '<div class="blocking-then">→ ' + esc(node.outcome || '') + '</div>' +
          '</div>';
      } else if (node.body || node.roleSummary) {
        html += '<p style="margin:0 0 10px;line-height:1.5;color:var(--fg);">' + esc(node.body || node.roleSummary) + '</p>';
      }

      if (node.resolutionSummary) {
        html +=
          '<div class="resolution-box" style="margin-bottom:10px;">' +
            '<strong>✓ Agent 解答 / 结项摘要：</strong><div style="margin-top:3px;">' + esc(node.resolutionSummary) + '</div>' +
          '</div>';
      }

      if (node.notes && node.notes.length > 0) {
        for (const nt of node.notes) {
          html += '<div style="font-size:11.5px;color:var(--red);margin-bottom:4px;">! ' + esc(nt) + '</div>';
        }
      }

      if (node.directiveId) {
        html += '<div style="margin:8px 0;"><button class="danger" id="btnRemoveDir">' + esc(t('delDirBtn')) + '</button></div>';
      }

      const showAnalyzeBtn = isAnalyzableNode(node);
      html +=
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">' +
          (showAnalyzeBtn
            ? '<button class="btn-analyze analyze-action" id="btnAnalyzeNode"' +
              (analyzeState.running ? ' disabled' : '') +
              '>' +
              esc(depthButtonLabel(nextRecommendedDepth(node))) +
              '</button>'
            : '') +
          '<button class="secondary" id="btnQuickAskTab">' + esc(t('ctxAskAgent')) + '</button>' +
          (node.kind === 'external-dep' && node.scopePath
            ? '<button class="secondary" id="btnSwitchExtScope">' + esc(t('switchScopeToExt')) + '</button>'
            : '') +
        '</div>';

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
        const locSuffix = node.startLine
          ? ':' + node.startLine + (node.endLine && node.endLine !== node.startLine ? '-' + node.endLine : '')
          : '';
        html +=
          '<div class="insp-file-bar">' +
            '<span class="insp-file-path" title="' + esc(node.path + locSuffix) + '">' +
              getFileIconSvg(node.path) +
              '<span>' + esc(node.path + locSuffix) + '</span>' +
            '</span>' +
            '<button class="secondary" id="btnJumpCode" style="height:22px;padding:0 7px;font-size:11px;">' + esc(t('jumpEditor')) + '</button>' +
          '</div>';
        if (snippet && snippet.error) {
          html += '<div style="padding:8px;border-radius:5px;background:rgba(248,81,73,0.14);color:var(--red);font-size:11.5px;">' + esc(snippet.error) + '</div>';
        } else if (snippet && snippet.lines && snippet.lines.length > 0) {
          html += '<div class="code-box">';
          for (const ln of snippet.lines) {
            html +=
              '<div class="code-line' + (ln.highlight ? ' hl' : '') + '">' +
                '<span class="line-no" data-ask-line="' + ln.num + '" title="点击锚定第 ' + ln.num + ' 行提问">' + ln.num + '</span>' +
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
          hostApi.postMessage({ type: 'openFile', path: node.path, line: node.startLine || 1 });
        });
      }
      const analyzeNodeBtn = document.getElementById('btnAnalyzeNode');
      if (analyzeNodeBtn) {
        analyzeNodeBtn.addEventListener('click', () => triggerNodeAnalyze(node));
      }
      const askTabBtn = document.getElementById('btnQuickAskTab');
      if (askTabBtn) {
        askTabBtn.addEventListener('click', () => {
          inspectorTab = 'directive';
          renderInspector(node);
          setTimeout(() => document.getElementById('inspDirNote')?.focus(), 20);
        });
      }
      const swExtBtn = document.getElementById('btnSwitchExtScope');
      if (swExtBtn && node.scopePath) {
        swExtBtn.addEventListener('click', () => setScopeRootAction(node.scopePath));
      }
      const delBtn = document.getElementById('btnRemoveDir');
      if (delBtn && node.directiveId) {
        delBtn.addEventListener('click', () => {
          postStateAction({ type: 'removeDirective', id: node.directiveId }, t('busySync'));
          selectedNodeId = null;
          inspector.classList.add('hidden');
        });
      }
      el.querySelectorAll('[data-ask-line]').forEach(lnEl => {
        lnEl.addEventListener('click', () => {
          prefilledDirLine = parseInt(lnEl.dataset.askLine || '1', 10);
          inspectorTab = 'directive';
          renderInspector(node);
          setTimeout(() => document.getElementById('inspDirNote')?.focus(), 20);
        });
      });
      el.querySelectorAll('[data-dep-jump]').forEach(chip => {
        chip.addEventListener('click', () => {
          selectNode(chip.dataset.depJump);
          centerOnNode(chip.dataset.depJump);
        });
      });
    }

    // Popovers & Menus
    const repoToggleBtn = document.getElementById('btnRepoToggle');
    const repoPopover = document.getElementById('repoPopover');
    const wtInputEl = document.getElementById('worktreeInput');
    const wtBtnEl = document.getElementById('btnSetWorktree');
    const pickRepoDialogBtn = document.getElementById('btnPickRepoDialog');
    const emptyPickRepoBtn = document.getElementById('btnEmptyPickRepo');
    const toggleInlineBrowserBtn = document.getElementById('btnToggleInlineBrowser');
    const inlineDirBrowserEl = document.getElementById('inlineDirBrowser');
    const moreMenu = document.getElementById('moreMenu');

    function closePopovers() {
      if (moreMenu) moreMenu.classList.add('hidden');
      if (customSelectPopover) {
        customSelectPopover.classList.add('hidden');
        customSelectPopover.dataset.anchorId = '';
      }
      if (depthPopover) depthPopover.classList.add('hidden');
      if (nodeCtxMenu) nodeCtxMenu.classList.add('hidden');
      if (repoPopover && gitCtx) repoPopover.classList.add('hidden');
      document.querySelectorAll('.select-trigger.is-open').forEach(el => el.classList.remove('is-open'));
    }

    function switchToRepoPath(nextPath) {
      const val = String(nextPath || '').trim();
      if (!val) return;
      if (wtInputEl) wtInputEl.value = val;
      if (repoPopover) repoPopover.classList.add('hidden');
      positions.clear();
      manualPositions.clear();
      collapsedIds.clear();
      selectedNodeId = null;
      inspector.classList.add('hidden');
      postStateAction({ type: 'setWorktreePath', worktreePath: val }, t('busyLoadRepo'));
    }

    function requestBrowseDir(dirPath) {
      dirBrowserOpen = true;
      dirBrowserLoading = true;
      if (inlineDirBrowserEl) inlineDirBrowserEl.classList.remove('hidden');
      applyStaticTranslations();
      renderInlineDirBrowser();
      hostApi.postMessage({ type: 'browseDirectory', dirPath: dirPath || '' });
    }

    function renderDiscoveredRepos() {
      const sec = document.getElementById('discoveredReposSec');
      const listEl = document.getElementById('discoveredReposList');
      if (!sec || !listEl) return;
      if (!Array.isArray(discoveredRepos) || discoveredRepos.length === 0) {
        sec.style.display = 'none';
        return;
      }
      sec.style.display = 'block';
      listEl.innerHTML = discoveredRepos.map(r => {
        const curCls = r.isCurrent ? ' is-current' : '';
        return '<div class="repo-disc-row' + curCls + '" data-pick-repo="' + esc(r.path) + '">' +
          '<div class="repo-disc-main">' +
            '<div class="repo-disc-top">' +
              '<span class="repo-disc-name">📦 ' + esc(r.name) + '</span>' +
              (r.branch ? '<span class="repo-branch-tag">' + esc(r.branch) + '</span>' : '') +
              (r.isCurrent ? '<span class="repo-git-tag">' + esc(t('currentRepoTag')) + '</span>' : '') +
            '</div>' +
            '<div class="repo-disc-path">' + esc(r.path) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      listEl.querySelectorAll('[data-pick-repo]').forEach(row => {
        row.addEventListener('click', (ev) => {
          ev.stopPropagation();
          switchToRepoPath(row.dataset.pickRepo);
        });
      });
    }

    function renderInlineDirBrowser() {
      if (!inlineDirBrowserEl) return;
      inlineDirBrowserEl.classList.toggle('hidden', !dirBrowserOpen);
      if (!dirBrowserOpen) return;

      if (dirBrowserLoading && !dirListingState) {
        inlineDirBrowserEl.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px;">' + esc(t('dirLoading')) + '</div>';
        return;
      }
      const st = dirListingState || { currentPath: '', parentPath: null, entries: [], drives: [], currentIsGitRepo: false };
      let html = '';

      if (st.nonRepoNotice) {
        html += '<div class="repo-notice">' + esc(t('nonRepoPickedFmt')(st.nonRepoNotice)) + '</div>';
      }

      html += '<div class="repo-dir-nav">';
      if (st.parentPath) {
        html += '<button class="secondary" style="height:22px;padding:0 7px;font-size:10.5px;" data-browse-dir="' + esc(st.parentPath) + '">' + esc(t('upDirBtn')) + '</button>';
      } else {
        html += '<span></span>';
      }
      if (Array.isArray(st.drives) && st.drives.length > 0) {
        html += '<div class="repo-drives-bar">' + st.drives.map(d => {
          const isAct = st.currentPath && st.currentPath.toUpperCase().indexOf(d.toUpperCase()) === 0;
          return '<button class="drive-chip' + (isAct ? ' active' : '') + '" data-browse-dir="' + esc(d) + '">' + esc(d.replace('\\\\', '')) + '</button>';
        }).join('') + '</div>';
      }
      html += '</div>';

      if (st.currentPath) {
        html += '<div class="repo-cur-dir">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;">' + esc(st.currentPath) + '</span>' +
          (st.currentIsGitRepo ? '<button style="height:20px;padding:0 7px;font-size:10.5px;" data-select-repo="' + esc(st.currentPath) + '">' + esc(t('openThisRepoBtn')) + '</button>' : '') +
        '</div>';
      }

      if (st.error) {
        html += '<div style="color:var(--red);font-size:11px;padding:4px;">' + esc(st.error) + '</div>';
      }

      const entries = Array.isArray(st.entries) ? st.entries : [];
      if (entries.length === 0 && !st.error) {
        html += '<div style="font-size:11px;color:var(--muted);padding:6px;">' + esc(t('dirEmpty')) + '</div>';
      } else if (entries.length > 0) {
        html += '<div class="repo-dir-list">' + entries.map(ent => {
          if (ent.isGitRepo) {
            return '<div class="repo-dir-row" data-select-repo="' + esc(ent.path) + '">' +
              '<span style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">📦 ' + esc(ent.name) + '</span>' +
              '<span style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
                '<span class="repo-git-tag">Git</span>' +
                '<button class="secondary" style="height:20px;padding:0 5px;font-size:10px;" title="进入子目录" data-drill-sub="' + esc(ent.path) + '">▸</button>' +
              '</span>' +
            '</div>';
          }
          return '<div class="repo-dir-row" data-browse-dir="' + esc(ent.path) + '">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);">📁 ' + esc(ent.name) + '</span>' +
            '<span style="color:var(--muted);font-size:10px;">▸</span>' +
          '</div>';
        }).join('') + '</div>';
      }

      inlineDirBrowserEl.innerHTML = html;

      inlineDirBrowserEl.querySelectorAll('[data-browse-dir]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          requestBrowseDir(el.dataset.browseDir);
        });
      });
      inlineDirBrowserEl.querySelectorAll('[data-drill-sub]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          requestBrowseDir(el.dataset.drillSub);
        });
      });
      inlineDirBrowserEl.querySelectorAll('[data-select-repo]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          switchToRepoPath(el.dataset.selectRepo);
        });
      });
    }

    function triggerNativeRepoDialog(ev) {
      if (ev) ev.stopPropagation();
      if (pickingDialog) return;
      pickingDialog = true;
      applyStaticTranslations();
      hostApi.postMessage({ type: 'pickWorktreeDialog' });
    }

    if (pickRepoDialogBtn) pickRepoDialogBtn.addEventListener('click', triggerNativeRepoDialog);
    if (emptyPickRepoBtn) emptyPickRepoBtn.addEventListener('click', triggerNativeRepoDialog);
    if (toggleInlineBrowserBtn) {
      toggleInlineBrowserBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (dirBrowserOpen) {
          dirBrowserOpen = false;
          applyStaticTranslations();
          renderInlineDirBrowser();
        } else {
          requestBrowseDir(dirListingState ? dirListingState.currentPath : '');
        }
      });
    }

    if (repoToggleBtn && repoPopover) {
      repoToggleBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const wasOpen = !repoPopover.classList.contains('hidden');
        closePopovers();
        if (!wasOpen) {
          repoPopover.classList.remove('hidden');
          renderDiscoveredRepos();
          renderInlineDirBrowser();
          positionPopover(repoPopover, repoToggleBtn, false);
        } else if (!gitCtx) {
          repoPopover.classList.add('hidden');
        }
      });
      repoPopover.addEventListener('click', (ev) => ev.stopPropagation());
    }

    function submitWorktreeSwitch() {
      if (!wtInputEl) return;
      switchToRepoPath(wtInputEl.value);
    }
    if (wtBtnEl) wtBtnEl.addEventListener('click', submitWorktreeSwitch);
    if (wtInputEl) {
      wtInputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submitWorktreeSwitch();
        }
      });
    }

    const moreMenuBtn = document.getElementById('btnMoreMenu');
    moreMenuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const wasOpen = !moreMenu.classList.contains('hidden');
      closePopovers();
      if (!wasOpen) {
        moreMenu.classList.remove('hidden');
        positionPopover(moreMenu, moreMenuBtn, true);
      }
    });
    moreMenu.addEventListener('click', (ev) => ev.stopPropagation());
    customSelectPopover.addEventListener('click', (ev) => ev.stopPropagation());
    depthPopover.addEventListener('click', (ev) => ev.stopPropagation());
    document.addEventListener('click', closePopovers);

    document.querySelectorAll('[data-agent-target]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        agentTarget = btn.dataset.agentTarget === 'current' ? 'current' : 'new';
        syncStorageMenu();
        moreMenu.classList.add('hidden');
      });
    });

    document.querySelectorAll('[data-storage-mode]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const m = btn.dataset.storageMode;
        storageMode = m;
        syncStorageMenu();
        moreMenu.classList.add('hidden');
        postStateAction({ type: 'setStorageMode', storageMode: m }, t('busySync'));
      });
    });

    document.getElementById('btnDispatchBatch').addEventListener('click', () => {
      hostApi.postMessage({ type: 'dispatchDirectives', agentTarget });
    });

    document.getElementById('btnAnalyzeBranch').addEventListener('click', () => {
      triggerTopAnalyze();
    });
    document.getElementById('btnAnalyzeBranchMenu').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openDepthPopover(ev.currentTarget, scopeRoot ? nodeById.get('root') : null);
    });

    document.getElementById('btnInspAnalyzeQuick').addEventListener('click', () => {
      if (!selectedNodeId || !nodeById.has(selectedNodeId)) return;
      triggerNodeAnalyze(nodeById.get(selectedNodeId));
    });
    document.getElementById('btnInspAnalyzeMenu').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!selectedNodeId || !nodeById.has(selectedNodeId)) return;
      openDepthPopover(ev.currentTarget, nodeById.get(selectedNodeId));
    });

    document.getElementById('btnDismissAnalyze').addEventListener('click', () => {
      analyzeState = { running: false, label: '', error: '' };
      syncAnalyzeUi();
    });

    document.querySelectorAll('.insp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        inspectorTab = btn.dataset.itab;
        const cur = selectedNodeId ? nodeById.get(selectedNodeId) : nodeById.get('root');
        if (cur) renderInspector(cur);
      });
    });

    document.querySelectorAll('#modeControl button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === viewMode) return;
        viewMode = btn.dataset.mode;
        document.querySelectorAll('#modeControl button').forEach(b => b.classList.toggle('active', b === btn));
        positions.clear();
        manualPositions.clear();
        collapsedIds.clear();
        postStateAction({ type: 'setMode', mode: viewMode }, t('busySwitchView'));
      });
    });

    const baseRefBtn = document.getElementById('btnBaseRefSelect');
    baseRefBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const refs = (gitCtx && Array.isArray(gitCtx.recentRefs) && gitCtx.recentRefs.length > 0) ? gitCtx.recentRefs : ['HEAD'];
      openCustomSelect({
        anchorEl: baseRefBtn,
        width: 210,
        title: lang === 'zh' ? 'Git Diff 对比基准 (Base Ref)' : 'Git Diff Base Ref',
        activeValue: baseRef,
        items: refs.map(r => ({ value: r, label: r, mono: true })),
        onSelect: (val) => {
          if (!val || val === baseRef) return;
          baseRef = val;
          postStateAction({ type: 'setBaseRef', baseRef }, t('busySwitchBase'));
        }
      });
    });

    const briefingBtn = document.getElementById('btnBriefingSelect');
    briefingBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const items = [
        { value: '', label: t('selectBriefing') },
        ...availableBriefings.map(b => ({
          value: b.path,
          label: b.label,
          tag: b.isExample ? 'example' : undefined
        }))
      ];
      openCustomSelect({
        anchorEl: briefingBtn,
        width: 288,
        title: lang === 'zh' ? '切换变更核验简报' : 'Verification Reports',
        activeValue: activeBriefingPath || '',
        items,
        onSelect: (val) => {
          if (val === activeBriefingPath) return;
          postStateAction({ type: 'selectBriefing', path: val }, t('busySync'));
        }
      });
    });

    document.getElementById('btnLangToggle').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      lang = lang === 'zh' ? 'en' : 'zh';
      applyStaticTranslations();
      buildNodeDom(false);
      renderBranchSummaryDrawer();
      if (selectedNodeId && nodeById.has(selectedNodeId)) {
        renderInspector(nodeById.get(selectedNodeId));
      }
      postStateAction({ type: 'setLang', lang }, t('busySync'));
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
      postStateAction({ type: 'setPruneUnchanged', value: pruneUnchanged }, t('busyFilterDiff'));
    });
    document.getElementById('btnRunImpact').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      postStateAction({ type: 'runImpactAnalysis' }, t('busySync'));
    });

    document.getElementById('btnIndexFiles').addEventListener('click', () => {
      const domainNodes = graph.nodes.filter(n => n.kind === 'domain' && n.domainId);
      const anyExpanded = domainNodes.some(n => n.filesExpanded);
      positions.clear();
      manualPositions.clear();
      if (anyExpanded) {
        postStateAction({ type: 'collapseAllFiles' }, t('busyExpandFiles'));
      } else {
        postStateAction({ type: 'expandAllFiles', domainIds: domainNodes.map(n => n.domainId) }, t('busyExpandFiles'));
      }
    });

    // Pan & Zoom
    viewport.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      closePopovers();
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
      closePopovers();
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
      ev.currentTarget.classList.toggle('active', deltaOverlay);
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
    document.getElementById('btnRefresh').addEventListener('click', () => postStateAction({ type: 'refresh', baseRef }, t('busySync')));
    document.getElementById('btnInitManifest').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      postStateAction({ type: 'initManifestDraft' }, t('busySync'));
    });
    document.getElementById('btnCopyMcpCfg').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      hostApi.postMessage({ type: 'copyMcpConfig' });
    });
    document.getElementById('btnCopyBranchPrompt').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      hostApi.postMessage({ type: 'copyBranchPrompt' });
    });
    document.getElementById('btnCopyManifestPrompt').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      hostApi.postMessage({ type: 'copyManifestPrompt' });
    });
    document.getElementById('btnReverifyStale').addEventListener('click', () => postStateAction({ type: 'refresh', baseRef }, t('busySync')));
    document.getElementById('btnVerifyBriefing').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      hostApi.postMessage({ type: 'pickBriefing' });
    });
    document.getElementById('btnEmptyVerify').addEventListener('click', () => hostApi.postMessage({ type: 'pickBriefing' }));
    document.getElementById('btnCopyDirs').addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      hostApi.postMessage({ type: 'copyDirectives' });
    });
    document.getElementById('btnLegendToggle').addEventListener('click', () => {
      document.getElementById('legendPopover').classList.toggle('hidden');
    });
    document.getElementById('btnCloseInsp').addEventListener('click', () => {
      selectedNodeId = null;
      focusMode = false;
      syncFocusButtons();
      inspector.classList.add('hidden');
      computeTidyLayout(true);
      buildNodeDom(true);
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
        closePopovers();
        if (searchQuery || activeChipFilter) {
          searchQuery = ''; searchInput.value = ''; activeChipFilter = ''; syncVisualClasses();
        } else if (focusMode) {
          focusMode = false; syncFocusButtons(); syncVisualClasses();
        } else if (selectedNodeId) {
          selectedNodeId = null;
          inspector.classList.add('hidden');
          computeTidyLayout(true);
          buildNodeDom(true);
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
        if (cur && cur.path) hostApi.postMessage({ type: 'openFile', path: cur.path, line: cur.startLine || 1 });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'canvasState') {
        setCanvasBusy(false);
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
        scopeRoot = msg.payload.scopeRoot ?? graph.scopeRoot ?? '';
        storageMode = msg.payload.storageMode ?? graph.storageMode ?? 'git-hidden';
        const scopeChanged = scopeRoot !== lastScopeKey;
        lastScopeKey = scopeRoot;

        viewMode = graph.mode || 'hybrid';
        document.querySelectorAll('#modeControl button').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === viewMode);
        });
        nodeById = new Map(graph.nodes.map(n => [n.id, n]));
        availableBriefings = msg.payload.availableBriefings || [];
        activeBriefingPath = incomingBriefing;
        discoveredRepos = Array.isArray(msg.payload.discoveredRepos) ? msg.payload.discoveredRepos : [];
        pickingDialog = false;

        if (wtInputEl) {
          const incomingWt = msg.payload.worktreePath || (gitCtx && gitCtx.repoRoot) || '';
          if (incomingWt && document.activeElement !== wtInputEl) {
            wtInputEl.value = incomingWt;
          }
        }
        if (repoPopover) {
          if (!gitCtx && isMcpAppHost) {
            repoPopover.classList.remove('hidden');
            if (repoToggleBtn) positionPopover(repoPopover, repoToggleBtn, false);
          } else {
            repoPopover.classList.add('hidden');
          }
        }

        applyStaticTranslations();
        renderDiscoveredRepos();

        const needsManifest = Boolean(gitCtx && graph.architecture && !graph.architecture.hasManifest);
        const initBtn = document.getElementById('btnInitManifest');
        initBtn.style.display = needsManifest ? 'flex' : 'none';
        const moreDot = document.getElementById('moreMenuDot');
        if (moreDot) moreDot.classList.toggle('hidden', !needsManifest);

        const archPill = document.getElementById('archPill');
        const indexBtn = document.getElementById('btnIndexFiles');
        if (graph.architecture) {
          const a = graph.architecture;
          archPill.style.display = 'inline-block';
          archPill.textContent = (lang === 'zh' ? a.patternLabelZh : a.patternLabelEn) + ' · ' + a.totalFiles + (lang === 'zh' ? ' 文件' : ' files');
          if (a.scale === 'small' && viewMode !== 'briefing') {
            const anyExp = graph.nodes.some(n => n.kind === 'domain' && n.filesExpanded);
            indexBtn.style.display = 'inline-flex';
            indexBtn.textContent = anyExp ? t('collapseFiles') : t('indexFiles');
          } else {
            indexBtn.style.display = 'none';
          }
        } else {
          archPill.style.display = 'none';
          indexBtn.style.display = 'none';
        }

        const bBtn = document.getElementById('btnBriefingSelect');
        const bVal = document.getElementById('lblBriefingVal');
        if (availableBriefings.length === 0) {
          bBtn.style.display = 'none';
        } else {
          bBtn.style.display = 'inline-flex';
          const curBr = availableBriefings.find(b => b.path === activeBriefingPath);
          bVal.textContent = curBr ? (t('briefingPrefix') + curBr.label) : t('selectBriefing');
        }

        const rVal = document.getElementById('lblBaseRefVal');
        if (rVal) {
          rVal.textContent = t('baseRefPrefix') + baseRef;
        }

        const staleEl = document.getElementById('staleBanner');
        if (graph.summary && graph.summary.isStale) {
          staleEl.classList.remove('hidden');
          document.getElementById('staleBannerText').textContent = t('staleText')(graph.summary.targetRefClaimed || '?', gitCtx?.shortSha || '?');
        } else {
          staleEl.classList.add('hidden');
        }

        const emptyEl = document.getElementById('emptyOverlay');
        const emptyPickEl = document.getElementById('btnEmptyPickRepo');
        if (msg.payload.error) {
          emptyEl.classList.remove('hidden');
          document.getElementById('emptyTitle').textContent = t('noGit');
          document.getElementById('emptyDesc').textContent = msg.payload.error;
          document.getElementById('btnEmptyVerify').style.display = 'none';
          if (emptyPickEl) emptyPickEl.style.display = 'inline-flex';
        } else if (!gitCtx && isMcpAppHost) {
          emptyEl.classList.remove('hidden');
          document.getElementById('emptyTitle').textContent = t('noGit');
          document.getElementById('emptyDesc').textContent = t('mcpNoRepoDesc');
          document.getElementById('btnEmptyVerify').style.display = 'none';
          if (emptyPickEl) emptyPickEl.style.display = 'inline-flex';
        } else if (graph.mode === 'briefing' && !(graph.summary && graph.summary.hasBriefing)) {
          emptyEl.classList.remove('hidden');
          document.getElementById('emptyTitle').textContent = t('emptyBriefingTitle');
          document.getElementById('emptyDesc').textContent = t('emptyBriefingDesc');
          document.getElementById('btnEmptyVerify').textContent = t('verifyJson');
          document.getElementById('btnEmptyVerify').style.display = isMcpAppHost ? 'none' : 'inline-flex';
          if (emptyPickEl) emptyPickEl.style.display = 'none';
        } else {
          emptyEl.classList.add('hidden');
          if (emptyPickEl) emptyPickEl.style.display = 'none';
        }

        const repoShort = gitCtx && gitCtx.repoRoot
          ? (gitCtx.repoRoot.split(/[\\\\/]/).filter(Boolean).pop() + ' · ')
          : '';
        document.getElementById('gitPill').textContent = gitCtx
          ? (repoShort + gitCtx.branch + '@' + gitCtx.shortSha)
          : t('noGit');

        const topologyKey = graph.nodes.map(n => n.id + '@' + (n.parentId || '') + ':' + (n.roleSummary || '')).join('|');
        const topologyChanged = topologyKey !== lastTopologyKey;
        lastTopologyKey = topologyKey;

        const shouldReset = prevCount === 0 || briefingChanged || scopeChanged || positions.size === 0;
        if (briefingChanged || scopeChanged) {
          positions.clear();
          manualPositions.clear();
          collapsedIds.clear();
        }
        if (topologyChanged) {
          manualPositions.clear();
          for (const id of [...positions.keys()]) {
            if (!nodeById.has(id)) {
              positions.delete(id);
              measuredHeights.delete(id);
              measuredWidths.delete(id);
            }
          }
        }
        if (shouldReset && !scopeRoot && graph.nodes.length > 36) {
          for (const n of graph.nodes) {
            if (n.kind === 'domain' && !n.filesExpanded) collapsedIds.add(n.id);
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
      } else if (msg.type === 'analyzeStatus') {
        const p = msg.payload || {};
        analyzeState = {
          running: Boolean(p.running),
          label: p.label || '',
          error: p.error || ''
        };
        syncAnalyzeUi();
      } else if (msg.type === 'hostCapabilities') {
        const canAnalyze = msg.payload ? Boolean(msg.payload.canAnalyze) : true;
        const canUpdateCtx = msg.payload && msg.payload.canUpdateContext !== undefined ? Boolean(msg.payload.canUpdateContext) : false;
        document.body.classList.toggle('no-analyze-cap', !canAnalyze);
        document.body.classList.toggle('no-ctx-cap', !canUpdateCtx);
      } else if (msg.type === 'contextAttachedNotice') {
        const title = (msg.payload && msg.payload.title) || '';
        analyzeState = { running: false, label: '', error: '' };
        const banner = document.getElementById('analyzeBanner');
        const spinner = document.getElementById('analyzeSpinner');
        const textEl = document.getElementById('analyzeBannerText');
        const dismissBtn = document.getElementById('btnDismissAnalyze');
        banner.classList.remove('hidden', 'is-error');
        spinner.classList.add('hidden');
        textEl.textContent = t('ctxAttachedFmt')(title);
        dismissBtn.style.display = 'inline-flex';
        setTimeout(() => {
          if (!analyzeState.running && !analyzeState.error) banner.classList.add('hidden');
        }, 3200);
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
      } else if (msg.type === 'dirListing') {
        setCanvasBusy(false);
        pickingDialog = false;
        dirBrowserLoading = false;
        dirBrowserOpen = true;
        dirListingState = msg.payload || null;
        if (repoPopover) {
          repoPopover.classList.remove('hidden');
          if (repoToggleBtn) positionPopover(repoPopover, repoToggleBtn, false);
        }
        applyStaticTranslations();
        renderInlineDirBrowser();
      } else if (msg.type === 'pickWorktreeDone') {
        setCanvasBusy(false);
        pickingDialog = false;
        applyStaticTranslations();
      }
    });

    applyStaticTranslations();
    hostApi.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
