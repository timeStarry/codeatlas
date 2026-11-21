export function getCockpitHtml(nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeAtlas Cockpit</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, rgba(128,128,128,0.25));
      --card: var(--vscode-sideBar-background, rgba(128,128,128,0.06));
      --accent: var(--vscode-textLink-foreground, #4da6ff);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, rgba(128,128,128,0.35));
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--fg);
      background: var(--bg);
      line-height: 1.45;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 10px;
    }
    .title-group h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .meta {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    button {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--btn-hover); }
    button.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
    }
    button.secondary:hover { background: rgba(128,128,128,0.12); }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .tab {
      background: transparent;
      color: var(--muted);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      padding: 6px 10px;
      cursor: pointer;
    }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .badge-verified { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
    .badge-mismatch { background: rgba(248, 81, 73, 0.2); color: #f85149; }
    .badge-stale { background: rgba(210, 153, 34, 0.22); color: #d29922; }
    .badge-unverified { background: rgba(139, 148, 158, 0.22); color: var(--muted); }
    .badge-unknown { background: rgba(139, 148, 158, 0.18); color: var(--muted); }
    .anchor-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      cursor: pointer;
      text-decoration: none;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      margin-top: 4px;
    }
    .anchor-link:hover { text-decoration: underline; }
    .note {
      font-size: 11px;
      color: var(--muted);
      margin-top: 3px;
    }
    .note.warn { color: #f85149; }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
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
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
      font-family: inherit;
    }
    textarea { width: 100%; min-height: 60px; resize: vertical; }
    .empty {
      color: var(--muted);
      font-style: italic;
      padding: 12px 0;
    }
    .diff-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .diff-add { color: #3fb950; }
    .diff-del { color: #f85149; }
    .analyze-pill {
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(56, 139, 253, 0.16);
      border: 1px solid rgba(88, 166, 255, 0.45);
      color: var(--accent);
    }
    .analyze-pill.err {
      background: rgba(248, 81, 73, 0.16);
      border-color: rgba(248, 81, 73, 0.45);
      color: #f85149;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h2>CodeAtlas 驾驶舱</h2>
      <div class="meta" id="gitMeta">正在读取 Git 上下文...</div>
    </div>
    <div class="actions">
      <button id="btnOpenCanvas">打开画布</button>
      <button id="btnAnalyzeBranch">⚡ 分析分支</button>
      <button class="secondary" id="btnLoadBriefing">核验简报</button>
      <button class="secondary" id="btnRefresh">刷新</button>
    </div>
  </div>

  <div id="cockpitAnalyzeStatus" class="analyze-pill hidden"></div>

  <div class="tabs">
    <button class="tab active" data-tab="briefing">因果简报</button>
    <button class="tab" data-tab="delta">变更与骨架</button>
    <button class="tab" data-tab="directives">纠偏指令</button>
  </div>

  <div id="tab-briefing"></div>
  <div id="tab-delta" class="hidden"></div>
  <div id="tab-directives" class="hidden"></div>

  <script nonce="${nonce}">
    const hostApi = window.__CODEATLAS_HOST__ || acquireVsCodeApi();
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
      return '<span class="badge badge-' + esc(b) + '">' + esc(b) + '</span>';
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
          (state.git.dirtyCount > 0 ? ' · ' + state.git.dirtyCount + ' dirty' : ' · clean') +
          ' · ' + state.git.worktrees.length + ' worktree(s)';
      } else {
        metaEl.textContent = 'No Git repository detected in workspace.';
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
            '<div class="card-header"><strong>No Briefing Loaded</strong>' + badgeHtml('unknown') + '</div>' +
            '<p class="note">Click <strong>Verify Briefing JSON</strong> to load an Agent-submitted briefing (schema v0.1) and deterministically verify its code anchors, symbols, diff membership, and staleness against Git.</p>' +
          '</div>';
        return;
      }

      let html =
        '<div class="card">' +
          '<div class="card-header"><strong>' + esc(v.briefingTitle) + '</strong>' + badgeHtml(v.overallBadge) + '</div>' +
          '<div class="note">Target Ref: <code>' + esc(v.targetRefClaimed) + '</code> · Current HEAD: <code>' + esc((v.currentHeadSha || 'UNBORN').slice(0, 8)) + '</code>' +
          (v.isStale ? ' <strong style="color:#d29922;">[STALE]</strong>' : '') + '</div>' +
          '<div class="note">Verified: ' + v.summaryCounts.verified +
            ' · Mismatch: ' + v.summaryCounts.mismatch +
            ' · Stale: ' + v.summaryCounts.stale +
            ' · Unverified: ' + v.summaryCounts.unverified +
            ' · Unknown: ' + v.summaryCounts.unknown + '</div>' +
        '</div>';

      if (v.blockingConditions && v.blockingConditions.length > 0) {
        html += '<div class="section-title">Explicit Blocking Conditions</div>';
        for (const b of v.blockingConditions) {
          const anc = b.item.anchor;
          html +=
            '<div class="card">' +
              '<div class="card-header"><strong>' + esc(b.item.id) + ': ' + esc(b.item.condition) + '</strong>' + badgeHtml(b.badge) + '</div>' +
              '<div>Outcome: ' + esc(b.item.outcome) + '</div>' +
              (anc ? '<div><a class="anchor-link" data-path="' + esc(anc.path) + '" data-line="' + esc(anc.startLine || 1) + '">' +
                esc(anc.path) + (anc.startLine ? ':' + anc.startLine : '') + (anc.symbol ? ' (' + esc(anc.symbol) + ')' : '') + '</a></div>' : '') +
            '</div>';
        }
      }

      html += '<div class="section-title">Claims &amp; Deterministic Evidence</div>';
      for (const c of v.claims) {
        html +=
          '<div class="card">' +
            '<div class="card-header"><strong>' + esc(c.claim.id) + ' · ' + esc(c.claim.title) + '</strong>' + badgeHtml(c.badge) + '</div>' +
            '<div>' + esc(c.claim.statement) + '</div>' +
            '<div class="note">Type: ' + esc(c.claim.claimType) + '</div>';
        for (const n of c.notes) {
          html += '<div class="note">' + esc(n) + '</div>';
        }
        for (const a of c.anchors) {
          const loc = a.anchor.path + (a.anchor.startLine ? ':' + a.anchor.startLine : '');
          html +=
            '<div style="margin-top:6px;">' +
              badgeHtml(a.badge) + ' ' +
              '<a class="anchor-link" data-path="' + esc(a.anchor.path) + '" data-line="' + esc(a.anchor.startLine || 1) + '">' +
                esc(loc) + (a.anchor.symbol ? ' · ' + esc(a.anchor.symbol) : '') +
              '</a>' +
              '<button class="secondary" style="margin-left:8px;padding:1px 6px;font-size:11px;" data-annotate-path="' + esc(a.anchor.path) + '" data-annotate-line="' + esc(a.anchor.startLine || 1) + '">+ Note</button>';
          for (const an of a.notes) {
            html += '<div class="note warn">! ' + esc(an) + '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      html += '<div class="section-title">Verification Signals</div>';
      if (!v.signals || v.signals.length === 0) {
        html += '<div class="card"><div class="note">No verification signals attached (status: UNKNOWN).</div></div>';
      } else {
        for (const s of v.signals) {
          const sb = s.status === 'passed' ? 'verified' : (s.status === 'failed' ? 'mismatch' : 'unknown');
          html +=
            '<div class="card">' +
              '<div class="card-header"><strong>' + esc(s.kind) + '</strong>' + badgeHtml(sb) + '</div>' +
              '<div>' + esc(s.description) + '</div>' +
              (s.command ? '<div class="note"><code>' + esc(s.command) + '</code></div>' : '') +
            '</div>';
        }
      }

      if (v.blindSpots && v.blindSpots.length > 0) {
        html += '<div class="section-title">Declared Blind Spots</div><div class="card"><ul style="margin:0;padding-left:18px;">';
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
        '<option value="' + esc(r) + '"' + (r === state.baseRef ? ' selected' : '') + '>' + esc(r) + '</option>'
      ).join('');

      let html =
        '<div class="row">' +
          '<label for="baseRefSelect">Base Ref:</label>' +
          '<select id="baseRefSelect">' + options + '</select>' +
        '</div>';

      if (state.manifest && state.manifest.domains) {
        html += '<div class="section-title">.atlas/manifest.json Semantic Skeleton</div>';
        for (const d of state.manifest.domains) {
          html +=
            '<div class="card">' +
              '<strong>' + esc(d.name) + '</strong>' +
              '<div class="note">' + esc(d.description) + '</div>' +
              '<div class="note">Paths: <code>' + esc(d.paths.join(', ')) + '</code></div>' +
            '</div>';
        }
      }

      html += '<div class="section-title">Git Diff vs ' + esc(state.baseRef) + ' (' + state.diffStats.length + ' files)</div>';
      if (state.diffStats.length === 0) {
        html += '<div class="empty">No diff detected against ' + esc(state.baseRef) + '.</div>';
      } else {
        html += '<div class="card">';
        for (const f of state.diffStats) {
          html +=
            '<div class="diff-item">' +
              '<a class="anchor-link" data-path="' + esc(f.path) + '" data-line="1">[' + esc(f.status) + '] ' + esc(f.path) + '</a>' +
              '<span><span class="diff-add">+' + f.additions + '</span> <span class="diff-del">-' + f.deletions + '</span></span>' +
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
              '<option value="rework">Rework</option>' +
              '<option value="constraint">Constraint</option>' +
              '<option value="question">Question</option>' +
            '</select>' +
            '<input id="dirPath" placeholder="relative/path.ts" style="flex:1;" />' +
            '<input id="dirLine" type="number" min="1" placeholder="Line" style="width:70px;" />' +
          '</div>' +
          '<textarea id="dirNote" placeholder="Describe constraint, question, or rework instruction bound to this code anchor..."></textarea>' +
          '<div class="row" style="margin-top:6px;margin-bottom:0;">' +
            '<button id="btnAddDir">Add Directive</button>' +
            '<button class="secondary" id="btnCopyDirs">Copy Markdown for Agent</button>' +
            '<button class="secondary" id="btnClearDirs">Clear All</button>' +
          '</div>' +
        '</div>';

      html += '<div class="section-title">Recorded Directives (' + state.directives.length + ')</div>';
      if (state.directives.length === 0) {
        html += '<div class="empty">No directives yet. Click "+ Note" on any verified evidence anchor or add one above.</div>';
      } else {
        for (const d of state.directives) {
          const loc = d.path + (d.startLine ? ':' + d.startLine : '');
          html +=
            '<div class="card">' +
              '<div class="card-header">' +
                '<a class="anchor-link" data-path="' + esc(d.path) + '" data-line="' + esc(d.startLine || 1) + '">[' + esc(d.kind.toUpperCase()) + '] ' + esc(loc) + '</a>' +
                '<button class="secondary" style="padding:1px 6px;font-size:11px;" data-del-dir="' + esc(d.id) + '">Remove</button>' +
              '</div>' +
              '<div>' + esc(d.note) + '</div>' +
              '<div class="note">Ref: <code>' + esc(d.ref) + '</code></div>' +
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
