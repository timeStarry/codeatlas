import { getFileIconsClientJs } from './fileIcons.js';

export function getCockpitHtml(nonce: string): string {
  const fileIconsJs = getFileIconsClientJs();

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeAtlas Cockpit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #181a1f));
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #dcdfe4));
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --border: var(--vscode-panel-border, rgba(140,150,168,0.2));
      --border-strong: rgba(140,150,168,0.34);
      --card: var(--vscode-editor-background, rgba(135,145,160,0.06));
      --surface-subtle: rgba(135,145,160,0.1);
      --accent: var(--vscode-textLink-foreground, #4da6ff);
      --btn-bg: var(--vscode-button-background, #1f6feb);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #388bfd);
      --input-bg: var(--vscode-input-background, #252932);
      --input-fg: var(--vscode-input-foreground, #dcdfe4);
      --input-border: var(--vscode-input-border, rgba(140,150,168,0.3));
      --mono: var(--vscode-editor-font-family, Consolas, monospace);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px 12px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif);
      font-size: 12.5px;
      color: var(--fg);
      background: var(--bg);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .atlas-ico {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
      display: inline-block;
      vertical-align: middle;
    }
    .header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .title-group h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .meta {
      font-size: 11px;
      color: var(--muted);
      font-family: var(--mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: 1px solid transparent;
      height: 25px;
      padding: 0 9px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 11.5px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
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
    .tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .tab {
      background: transparent;
      color: var(--muted);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      height: 28px;
      padding: 0 9px;
      font-size: 11.5px;
      cursor: pointer;
    }
    .tab:hover { color: var(--fg); background: transparent; }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 9px 10px;
      margin-bottom: 8px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 5px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 9.5px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      flex-shrink: 0;
    }
    .badge-verified { background: rgba(63, 185, 80, 0.16); color: #3fb950; }
    .badge-mismatch { background: rgba(248, 81, 73, 0.18); color: #f85149; }
    .badge-stale { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .badge-unverified { background: var(--surface-subtle); color: var(--muted); }
    .badge-unknown { background: var(--surface-subtle); color: var(--muted); }
    .anchor-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-top: 5px;
      padding: 3px 5px;
      border-radius: 5px;
      background: var(--surface-subtle);
    }
    .anchor-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--fg);
      cursor: pointer;
      text-decoration: none;
      font-family: var(--mono);
      font-size: 11px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .anchor-link:hover { color: var(--accent); }
    .note {
      font-size: 11px;
      color: var(--muted);
      margin-top: 3px;
    }
    .note.warn { color: #f85149; }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: var(--muted);
      margin: 12px 0 6px;
    }
    .row {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    input, select, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 5px;
      padding: 4px 7px;
      font-size: 11.5px;
      font-family: inherit;
    }
    textarea { width: 100%; min-height: 58px; resize: vertical; }
    .empty {
      color: var(--muted);
      font-size: 11.5px;
      padding: 10px 0;
    }
    .diff-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      padding: 5px 0;
      border-bottom: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 11px;
    }
    .diff-item:last-child { border-bottom: none; }
    .diff-add { color: #3fb950; }
    .diff-del { color: #f85149; }
    .analyze-pill {
      padding: 6px 9px;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 11.5px;
      font-weight: 600;
      background: rgba(56, 139, 253, 0.14);
      border: 1px solid rgba(88, 166, 255, 0.38);
      color: var(--accent);
    }
    .analyze-pill.err {
      background: rgba(248, 81, 73, 0.14);
      border-color: rgba(248, 81, 73, 0.4);
      color: #f85149;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-row">
      <div class="title-group">
        <h2>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="color:var(--accent);" aria-hidden="true">
            <path d="M8 1.6 13.8 4.9v6.2L8 14.4 2.2 11.1V4.9L8 1.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
          </svg>
          CodeAtlas 概览
        </h2>
      </div>
      <button class="secondary" id="btnRefresh" style="height:22px;padding:0 7px;font-size:11px;">↻ 刷新</button>
    </div>
    <div class="meta" id="gitMeta">正在读取 Git 工作树...</div>
    <div class="actions">
      <button id="btnOpenCanvas">打开画布</button>
      <button class="secondary" id="btnAnalyzeBranch" style="color:var(--accent);border-color:rgba(77,166,255,0.4);">⚡ 分析变更</button>
      <button class="secondary" id="btnLoadBriefing">加载简报</button>
    </div>
  </div>

  <div id="cockpitAnalyzeStatus" class="analyze-pill hidden"></div>

  <div class="tabs">
    <button class="tab active" data-tab="briefing">变更核验</button>
    <button class="tab" data-tab="delta">Git Diff</button>
    <button class="tab" data-tab="directives">评审批注</button>
  </div>

  <div id="tab-briefing"></div>
  <div id="tab-delta" class="hidden"></div>
  <div id="tab-directives" class="hidden"></div>

  <script nonce="${nonce}">
    const hostApi = window.__CODEATLAS_HOST__ || acquireVsCodeApi();
    ${fileIconsJs}

    const BADGE_ZH = {
      verified: '✓ 已核验',
      mismatch: '✕ 失配',
      stale: '⟳ 过期',
      unverified: '未核验',
      unknown: '未知'
    };

    let state = {
      git: null,
      baseRef: 'HEAD~1',
      diffStats: [],
      manifest: null,
      verification: null,
      directives: [],
      activeTab: 'briefing'
    };

    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function badgeHtml(b) {
      return '<span class="badge badge-' + esc(b) + '">' + esc(BADGE_ZH[b] || b) + '</span>';
    }

    function openAnchor(path, line) {
      hostApi.postMessage({ type: 'openFile', path, line: line || 1 });
    }

    function switchTab(tab) {
      state.activeTab = tab;
      document.querySelectorAll('.tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
      });
      ['briefing', 'delta', 'directives'].forEach(t => {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
      });
    }

    document.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('click', () => switchTab(el.dataset.tab));
    });

    document.getElementById('btnOpenCanvas').addEventListener('click', () => {
      hostApi.postMessage({ type: 'openCanvas' });
    });

    document.getElementById('btnAnalyzeBranch').addEventListener('click', () => {
      hostApi.postMessage({ type: 'analyzeTarget', scope: 'branch', baseRef: state.baseRef });
    });

    document.getElementById('btnRefresh').addEventListener('click', () => {
      hostApi.postMessage({ type: 'refresh', baseRef: state.baseRef });
    });

    document.getElementById('btnLoadBriefing').addEventListener('click', () => {
      hostApi.postMessage({ type: 'pickBriefing' });
    });

    function render() {
      const metaEl = document.getElementById('gitMeta');
      if (state.git) {
        metaEl.textContent =
          state.git.branch + ' @ ' + state.git.shortSha +
          (state.git.dirtyCount > 0 ? ' · ' + state.git.dirtyCount + ' 处未提交' : ' · 工作区干净') +
          ' · ' + state.git.worktrees.length + ' 个工作树';
      } else {
        metaEl.textContent = '当前工作区未检测到 Git 仓库';
      }

      renderBriefing();
      renderDelta();
      renderDirectives();
    }

    function renderBriefing() {
      const el = document.getElementById('tab-briefing');
      const v = state.verification;
      if (!v) {
        el.innerHTML =
          '<div class="card">' +
            '<div class="card-header"><strong>尚未加载简报</strong>' + badgeHtml('unknown') + '</div>' +
            '<p class="note" style="margin:4px 0 0;">点击上方 <strong>⚡ 分析分支</strong> 自动生成确定性核验简报（Schema v0.2），或点击 <strong>打开画布</strong> 直接浏览项目架构底图。</p>' +
          '</div>';
        return;
      }

      let html =
        '<div class="card">' +
          '<div class="card-header"><strong>' + esc(v.briefingTitle) + '</strong>' + badgeHtml(v.overallBadge) + '</div>' +
          '<div class="note">目标快照: <code>' + esc(v.targetRefClaimed) + '</code> · 当前 HEAD: <code>' + esc((v.currentHeadSha || 'UNBORN').slice(0, 8)) + '</code>' +
          (v.isStale ? ' <strong style="color:#d29922;">[已过期]</strong>' : '') + '</div>' +
          '<div class="note">已核验 ' + v.summaryCounts.verified +
            ' · 失配 ' + v.summaryCounts.mismatch +
            ' · 过期 ' + v.summaryCounts.stale +
            ' · 未核验 ' + v.summaryCounts.unverified + '</div>' +
        '</div>';

      if (v.blockingConditions && v.blockingConditions.length > 0) {
        html += '<div class="section-title">显式阻断守卫 (' + v.blockingConditions.length + ')</div>';
        for (const b of v.blockingConditions) {
          const anc = b.item.anchor;
          html +=
            '<div class="card">' +
              '<div class="card-header"><strong>' + esc(b.item.id) + ' · ' + esc(b.item.condition) + '</strong>' + badgeHtml(b.badge) + '</div>' +
              '<div style="font-size:12px;">→ ' + esc(b.item.outcome) + '</div>' +
              (anc ? '<div class="anchor-row"><a class="anchor-link" data-path="' + esc(anc.path) + '" data-line="' + esc(anc.startLine || 1) + '">' +
                getFileIconSvg(anc.path) +
                '<span>' + esc(anc.path) + (anc.startLine ? ':' + anc.startLine : '') + (anc.symbol ? ' · ' + esc(anc.symbol) : '') + '</span></a></div>' : '') +
            '</div>';
        }
      }

      html += '<div class="section-title">核心声明与代码锚点 (' + v.claims.length + ')</div>';
      for (const c of v.claims) {
        html +=
          '<div class="card">' +
            '<div class="card-header"><strong>' + esc(c.claim.id) + ' · ' + esc(c.claim.title) + '</strong>' + badgeHtml(c.badge) + '</div>' +
            '<div style="font-size:12px;">' + esc(c.claim.statement) + '</div>';
        for (const n of c.notes) {
          html += '<div class="note">' + esc(n) + '</div>';
        }
        for (const a of c.anchors) {
          const loc = a.anchor.path + (a.anchor.startLine ? ':' + a.anchor.startLine : '');
          html +=
            '<div class="anchor-row">' +
              '<a class="anchor-link" data-path="' + esc(a.anchor.path) + '" data-line="' + esc(a.anchor.startLine || 1) + '">' +
                getFileIconSvg(a.anchor.path) +
                '<span>' + esc(loc) + (a.anchor.symbol ? ' · ' + esc(a.anchor.symbol) : '') + '</span>' +
              '</a>' +
              '<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">' +
                badgeHtml(a.badge) +
                '<button class="secondary" style="height:20px;padding:0 6px;font-size:10.5px;" data-annotate-path="' + esc(a.anchor.path) + '" data-annotate-line="' + esc(a.anchor.startLine || 1) + '">+ 批注</button>' +
              '</span>' +
            '</div>';
          for (const an of a.notes) {
            html += '<div class="note warn">! ' + esc(an) + '</div>';
          }
        }
        html += '</div>';
      }

      html += '<div class="section-title">验证信号</div>';
      if (!v.signals || v.signals.length === 0) {
        html += '<div class="card"><div class="note">未附带测试或构建验证信号。</div></div>';
      } else {
        for (const s of v.signals) {
          const sb = s.status === 'passed' ? 'verified' : (s.status === 'failed' ? 'mismatch' : 'unknown');
          html +=
            '<div class="card">' +
              '<div class="card-header"><strong>' + esc(s.kind) + '</strong>' + badgeHtml(sb) + '</div>' +
              '<div style="font-size:12px;">' + esc(s.description) + '</div>' +
              (s.command ? '<div class="note"><code>' + esc(s.command) + '</code></div>' : '') +
            '</div>';
        }
      }

      if (v.blindSpots && v.blindSpots.length > 0) {
        html += '<div class="section-title">已声明盲区</div><div class="card"><ul style="margin:0;padding-left:18px;font-size:12px;">';
        for (const bs of v.blindSpots) {
          html += '<li>' + esc(bs) + '</li>';
        }
        html += '</ul></div>';
      }

      el.innerHTML = html;
      bindDynamicEvents(el);
    }

    function renderDelta() {
      const el = document.getElementById('tab-delta');
      const refs = state.git ? state.git.recentRefs : ['HEAD~1'];
      let options = refs.map(r =>
        '<option value="' + esc(r) + '"' + (r === state.baseRef ? ' selected' : '') + '>vs ' + esc(r) + '</option>'
      ).join('');

      let html =
        '<div class="row">' +
          '<label for="baseRefSelect" style="font-size:11.5px;color:var(--muted);">对比基准:</label>' +
          '<select id="baseRefSelect">' + options + '</select>' +
        '</div>';

      if (state.manifest && state.manifest.domains) {
        html += '<div class="section-title">架构骨架 (.atlas/manifest.json)</div>';
        for (const d of state.manifest.domains) {
          html +=
            '<div class="card">' +
              '<div style="display:flex;align-items:center;gap:6px;">' +
                getNodeIconSvg({ kind: 'domain', title: d.name }, false) +
                '<strong>' + esc(d.name) + '</strong>' +
              '</div>' +
              '<div class="note">' + esc(d.description) + '</div>' +
              '<div class="note">路径: <code>' + esc(d.paths.join(', ')) + '</code></div>' +
            '</div>';
        }
      }

      html += '<div class="section-title">变更文件 (' + state.diffStats.length + ')</div>';
      if (state.diffStats.length === 0) {
        html += '<div class="empty">当前相对 ' + esc(state.baseRef) + ' 无文件变更。</div>';
      } else {
        html += '<div class="card">';
        for (const f of state.diffStats) {
          html +=
            '<div class="diff-item">' +
              '<a class="anchor-link" data-path="' + esc(f.path) + '" data-line="1">' +
                getFileIconSvg(f.path) +
                '<span>' + esc(f.path) + '</span>' +
              '</a>' +
              '<span style="flex-shrink:0;"><span class="diff-add">+' + f.additions + '</span> <span class="diff-del">-' + f.deletions + '</span></span>' +
            '</div>';
        }
        html += '</div>';
      }

      el.innerHTML = html;
      const sel = document.getElementById('baseRefSelect');
      if (sel) {
        sel.addEventListener('change', () => {
          state.baseRef = sel.value;
          hostApi.postMessage({ type: 'refresh', baseRef: state.baseRef });
        });
      }
      bindDynamicEvents(el);
    }

    function renderDirectives() {
      const el = document.getElementById('tab-directives');
      let html =
        '<div class="card">' +
          '<div class="row">' +
            '<select id="dirKind">' +
              '<option value="rework">返工</option>' +
              '<option value="constraint">约束红线</option>' +
              '<option value="question">疑问</option>' +
            '</select>' +
            '<input id="dirPath" placeholder="relative/path.ts" style="flex:1;min-width:100px;" />' +
            '<input id="dirLine" type="number" min="1" placeholder="行号" style="width:62px;" />' +
          '</div>' +
          '<textarea id="dirNote" placeholder="描述绑定到该代码锚点的修改要求、架构红线或疑问..."></textarea>' +
          '<div class="row" style="margin-top:6px;margin-bottom:0;">' +
            '<button id="btnAddDir">+ 添加批注</button>' +
            '<button class="secondary" id="btnCopyDirs">复制 Markdown</button>' +
            '<button class="secondary" id="btnClearDirs">清空</button>' +
          '</div>' +
        '</div>';

      html += '<div class="section-title">待处理批注 (' + state.directives.length + ')</div>';
      if (state.directives.length === 0) {
        html += '<div class="empty">暂无批注。可在简报锚点旁点击“+ 批注”或在画布节点中直接挂接。</div>';
      } else {
        for (const d of state.directives) {
          const loc = d.path + (d.startLine ? ':' + d.startLine : '');
          html +=
            '<div class="card">' +
              '<div class="card-header">' +
                '<a class="anchor-link" data-path="' + esc(d.path) + '" data-line="' + esc(d.startLine || 1) + '">' +
                  getFileIconSvg(d.path) +
                  '<span>[' + esc(d.kind.toUpperCase()) + '] ' + esc(loc) + '</span>' +
                '</a>' +
                '<button class="secondary" style="height:20px;padding:0 6px;font-size:10.5px;" data-del-dir="' + esc(d.id) + '">移除</button>' +
              '</div>' +
              '<div style="font-size:12px;">' + esc(d.note) + '</div>' +
              '<div class="note">快照: <code>' + esc(d.ref) + '</code></div>' +
            '</div>';
        }
      }

      el.innerHTML = html;
      bindDynamicEvents(el);

      document.getElementById('btnAddDir').addEventListener('click', () => {
        const kind = document.getElementById('dirKind').value;
        const pathVal = document.getElementById('dirPath').value.trim();
        const lineVal = parseInt(document.getElementById('dirLine').value, 10);
        const noteVal = document.getElementById('dirNote').value.trim();
        if (!pathVal || !noteVal) return;
        hostApi.postMessage({
          type: 'addDirective',
          kind,
          path: pathVal,
          startLine: Number.isFinite(lineVal) ? lineVal : undefined,
          note: noteVal
        });
      });

      document.getElementById('btnCopyDirs').addEventListener('click', () => {
        hostApi.postMessage({ type: 'copyDirectives' });
      });

      document.getElementById('btnClearDirs').addEventListener('click', () => {
        hostApi.postMessage({ type: 'clearDirectives' });
      });

      el.querySelectorAll('[data-del-dir]').forEach(btn => {
        btn.addEventListener('click', () => {
          hostApi.postMessage({ type: 'removeDirective', id: btn.dataset.delDir });
        });
      });
    }

    function bindDynamicEvents(root) {
      root.querySelectorAll('.anchor-link').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openAnchor(a.dataset.path, parseInt(a.dataset.line || '1', 10));
        });
      });
      root.querySelectorAll('[data-annotate-path]').forEach(btn => {
        btn.addEventListener('click', () => {
          switchTab('directives');
          const p = document.getElementById('dirPath');
          const l = document.getElementById('dirLine');
          const n = document.getElementById('dirNote');
          if (p) p.value = btn.dataset.annotatePath || '';
          if (l) l.value = btn.dataset.annotateLine || '';
          if (n) n.focus();
        });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'state') {
        state = { ...state, ...msg.payload };
        render();
      } else if (msg.type === 'analyzeStatus') {
        const p = msg.payload || {};
        const el = document.getElementById('cockpitAnalyzeStatus');
        const btn = document.getElementById('btnAnalyzeBranch');
        if (btn) btn.disabled = Boolean(p.running);
        if (el) {
          if (p.running) {
            el.classList.remove('hidden', 'err');
            el.textContent = '⚡ 正在分析: ' + (p.label || '生成并核验简报...');
          } else if (p.error) {
            el.classList.remove('hidden');
            el.classList.add('err');
            el.textContent = '⚠ 分析失败: ' + p.error;
          } else {
            el.classList.add('hidden');
            el.classList.remove('err');
          }
        }
      }
    });

    hostApi.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
