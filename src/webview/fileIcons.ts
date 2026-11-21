/**
 * Shared client-side vector SVG icon system (IDEA New UI / Antigravity style)
 * for Canvas nodes, Inspector file headers, Branch Summary, and VS Code Cockpit.
 *
 * Uses zero backslashes inside the returned JS snippet so it can be safely embedded
 * inside template-literal HTML `<script>` blocks without escaping hazards.
 */
export function getFileIconsClientJs(): string {
  return `
    function _atlasSvg(inner, color) {
      var strokeAttr = color ? ' style="color:' + color + ';"' : '';
      return '<svg class="atlas-ico" viewBox="0 0 16 16" width="16" height="16" fill="none"' + strokeAttr + ' aria-hidden="true">' + inner + '</svg>';
    }

    function _atlasBadgeSvg(bg, fg, text) {
      var fontSize = text.length > 2 ? '5.4' : '6.5';
      return '<svg class="atlas-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
        '<rect x="1.5" y="2" width="13" height="12" rx="3" fill="' + bg + '" fill-opacity="0.2" stroke="' + bg + '" stroke-width="1.15"/>' +
        '<text x="8" y="10.3" text-anchor="middle" fill="' + fg + '" font-size="' + fontSize + '" font-weight="800" font-family="Consolas, monospace">' + text + '</text>' +
      '</svg>';
    }

    function getFileIconSvg(rawPath, opts) {
      var p = String(rawPath || '').toLowerCase();
      var bs = String.fromCharCode(92);
      while (p.indexOf(bs) !== -1) p = p.replace(bs, '/');
      var parts = p.split('/');
      var base = parts[parts.length - 1] || p;
      var dotIdx = base.lastIndexOf('.');
      var ext = dotIdx >= 0 ? base.slice(dotIdx + 1) : '';

      var isTest =
        base.indexOf('.test.') !== -1 ||
        base.indexOf('.spec.') !== -1 ||
        base.indexOf('_test.') !== -1 ||
        base.indexOf('_integration.') !== -1 ||
        p.indexOf('/test/') !== -1 ||
        p.indexOf('/tests/') !== -1 ||
        p.indexOf('__tests__/') !== -1;

      if (isTest) {
        return _atlasSvg(
          '<path d="M6 2.5h4M6.8 2.5v3.1L3.7 11.4A1.5 1.5 0 0 0 5 13.5h6a1.5 1.5 0 0 0 1.3-2.1L9.2 5.6V2.5" stroke="#3fb950" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M5.1 10h5.8" stroke="#3fb950" stroke-width="1.2" stroke-linecap="round"/>',
          '#3fb950'
        );
      }

      if (base === 'cargo.toml' || base === 'cargo.lock') {
        return _atlasSvg(
          '<path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8L8 1.8Z" fill="#e09f3e" fill-opacity="0.16" stroke="#e09f3e" stroke-width="1.25" stroke-linejoin="round"/>' +
          '<path d="M2.7 4.9 8 7.8l5.3-2.9M8 7.8v6.3" stroke="#e09f3e" stroke-width="1.2"/>',
          '#e09f3e'
        );
      }

      if (base === 'package.json' || base === 'pnpm-workspace.yaml' || base === 'pnpm-lock.yaml') {
        return _atlasSvg(
          '<path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9L8 1.8Z" fill="#73c991" fill-opacity="0.16" stroke="#73c991" stroke-width="1.25" stroke-linejoin="round"/>' +
          '<path d="M6.2 6.5h3.6v3.2H8v-1.8H6.2V6.5Z" fill="#73c991"/>',
          '#73c991'
        );
      }

      if (p.indexOf('.github/workflows/') !== -1 || base === 'dockerfile' || base.indexOf('docker-compose') === 0) {
        return _atlasSvg(
          '<circle cx="4.5" cy="4.5" r="1.8" stroke="#b392f0" stroke-width="1.25"/>' +
          '<circle cx="11.5" cy="11.5" r="1.8" stroke="#b392f0" stroke-width="1.25"/>' +
          '<circle cx="11.5" cy="4.5" r="1.8" stroke="#b392f0" stroke-width="1.25"/>' +
          '<path d="M6.3 4.5h3.4M4.5 6.3v2.2a2 2 0 0 0 2 2h3.2" stroke="#b392f0" stroke-width="1.25" stroke-linecap="round"/>',
          '#b392f0'
        );
      }

      if (ext === 'rs') {
        return _atlasBadgeSvg('#e5734b', '#f28b66', 'RS');
      }
      if (ext === 'tsx' || ext === 'jsx') {
        return _atlasSvg(
          '<circle cx="8" cy="8" r="1.4" fill="#58c4dc"/>' +
          '<ellipse cx="8" cy="8" rx="6" ry="2.4" stroke="#58c4dc" stroke-width="1.1"/>' +
          '<ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(60 8 8)" stroke="#58c4dc" stroke-width="1.1"/>' +
          '<ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(120 8 8)" stroke="#58c4dc" stroke-width="1.1"/>',
          '#58c4dc'
        );
      }
      if (ext === 'ts' || ext === 'mts' || ext === 'cts') {
        var isDts = base.slice(-5) === '.d.ts';
        return _atlasBadgeSvg(isDts ? '#6b9ac4' : '#3178c6', isDts ? '#8ab4d8' : '#6cb6ff', isDts ? 'dTS' : 'TS');
      }
      if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
        return _atlasBadgeSvg('#d4a72c', '#f2cc60', 'JS');
      }
      if (ext === 'py') {
        return _atlasBadgeSvg('#4b8bbe', '#79c0ff', 'PY');
      }
      if (ext === 'go') {
        return _atlasBadgeSvg('#00add8', '#56d4dd', 'GO');
      }
      if (ext === 'java' || ext === 'kt' || ext === 'kts') {
        return _atlasBadgeSvg('#a97bff', '#d2a8ff', ext === 'java' ? 'JV' : 'KT');
      }
      if (ext === 'c' || ext === 'h' || ext === 'cpp' || ext === 'hpp' || ext === 'cc') {
        return _atlasBadgeSvg('#659ad2', '#9ecbff', ext === 'c' || ext === 'h' ? 'C' : 'C+');
      }
      if (ext === 'wasm' || ext === 'wit') {
        return _atlasBadgeSvg('#7c6df0', '#b392f0', ext === 'wit' ? 'WIT' : 'WSM');
      }
      if (ext === 'vue') {
        return _atlasBadgeSvg('#41b883', '#56d364', 'VUE');
      }
      if (ext === 'svelte') {
        return _atlasBadgeSvg('#ff5d2a', '#ff8b66', 'SVL');
      }
      if (ext === 'html' || ext === 'htm') {
        return _atlasSvg(
          '<path d="M5.2 5.2 2.3 8l2.9 2.8M10.8 5.2 13.7 8l-2.9 2.8M8.9 3.8 7.1 12.2" stroke="#e36d4f" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
          '#e36d4f'
        );
      }
      if (ext === 'css' || ext === 'scss' || ext === 'less') {
        return _atlasBadgeSvg('#569cd6', '#79c0ff', ext === 'scss' ? 'SCS' : 'CSS');
      }
      if (ext === 'json' || ext === 'jsonc' || ext === 'jsonl') {
        return _atlasSvg(
          '<path d="M5.6 3C4.2 3 3.8 3.8 3.8 5v1.3c0 .9-.5 1.7-1.4 1.7.9 0 1.4.8 1.4 1.7V11c0 1.2.4 2 1.8 2M10.4 3c1.4 0 1.8.8 1.8 2v1.3c0 .9.5 1.7 1.4 1.7-.9 0-1.4.8-1.4 1.7V11c0 1.2-.4 2-1.8 2" stroke="#d19a66" stroke-width="1.35" stroke-linecap="round"/>',
          '#d19a66'
        );
      }
      if (ext === 'toml' || ext === 'yaml' || ext === 'yml' || ext === 'ini' || base.indexOf('.env') === 0 || base.indexOf('tsconfig') === 0) {
        return _atlasSvg(
          '<path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="#9da5b4" stroke-width="1.25" stroke-linecap="round"/>' +
          '<circle cx="6" cy="4.5" r="1.4" fill="var(--panel, #21242b)" stroke="#d19a66" stroke-width="1.25"/>' +
          '<circle cx="10.5" cy="8" r="1.4" fill="var(--panel, #21242b)" stroke="#61afef" stroke-width="1.25"/>' +
          '<circle cx="7" cy="11.5" r="1.4" fill="var(--panel, #21242b)" stroke="#73c991" stroke-width="1.25"/>',
          '#9da5b4'
        );
      }
      if (ext === 'md' || ext === 'mdx' || ext === 'txt' || base.indexOf('license') === 0 || base.indexOf('readme') === 0) {
        return _atlasSvg(
          '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.2" stroke="#56b6c2" stroke-width="1.2"/>' +
          '<path d="M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h4.2" stroke="#56b6c2" stroke-width="1.25" stroke-linecap="round"/>',
          '#56b6c2'
        );
      }
      if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'ps1' || ext === 'bat' || ext === 'cmd') {
        return _atlasSvg(
          '<rect x="2" y="2.5" width="12" height="11" rx="2.2" stroke="#73c991" stroke-width="1.2"/>' +
          '<path d="M4.6 6.2 7 8l-2.4 1.8M8.2 10h3" stroke="#73c991" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
          '#73c991'
        );
      }
      if (ext === 'sql' || ext === 'prisma' || ext === 'sqlite') {
        return _atlasSvg(
          '<ellipse cx="8" cy="4.2" rx="4.8" ry="1.9" stroke="#e5c07b" stroke-width="1.2"/>' +
          '<path d="M3.2 4.2v7.6c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2V4.2" stroke="#e5c07b" stroke-width="1.2"/>' +
          '<path d="M3.2 8c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2" stroke="#e5c07b" stroke-width="1.1"/>',
          '#e5c07b'
        );
      }
      if (
        ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' ||
        ext === 'webp' || ext === 'svg' || ext === 'ico' || ext === 'woff' ||
        ext === 'woff2' || ext === 'ttf'
      ) {
        return _atlasSvg(
          '<rect x="2.2" y="2.5" width="11.6" height="11" rx="2.2" stroke="#c678dd" stroke-width="1.2"/>' +
          '<circle cx="5.8" cy="6" r="1.1" fill="#c678dd"/>' +
          '<path d="M3 11.8 6.4 8.6l2.4 2.2 1.8-1.6 2.4 2.6" stroke="#c678dd" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
          '#c678dd'
        );
      }

      return _atlasSvg(
        '<path d="M4 2.2h5.2L12.5 5.5v8.3H4V2.2Z" stroke="#8b949e" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<path d="M9 2.2v3.5h3.5" stroke="#8b949e" stroke-width="1.15" stroke-linejoin="round"/>',
        '#8b949e'
      );
    }

    function getNodeIconSvg(node, isOpen) {
      if (!node) return '';
      var k = node.kind;
      if (k === 'root') {
        return _atlasSvg(
          '<circle cx="5" cy="4.5" r="1.7" stroke="#58a6ff" stroke-width="1.35"/>' +
          '<circle cx="5" cy="11.5" r="1.7" stroke="#58a6ff" stroke-width="1.35"/>' +
          '<circle cx="11.5" cy="7.5" r="1.7" stroke="#58a6ff" stroke-width="1.35"/>' +
          '<path d="M5 6.2v3.6M9.8 7.5H7.2a2.2 2.2 0 0 1-2.2-2.2" stroke="#58a6ff" stroke-width="1.35" stroke-linecap="round"/>',
          '#58a6ff'
        );
      }
      if (k === 'domain') {
        var titleLower = String(node.title || '').toLowerCase();
        var domColor = node.isSupport ? '#8b949e' : (titleLower.indexOf('crates/') === 0 ? '#e09f3e' : '#58a6ff');
        return _atlasSvg(
          '<path d="M8 1.9 13.6 4.9v6.2L8 14.1 2.4 11.1V4.9L8 1.9Z" fill="' + domColor + '" fill-opacity="0.14" stroke="' + domColor + '" stroke-width="1.25" stroke-linejoin="round"/>' +
          '<path d="M2.6 5 8 7.9 13.4 5M8 7.9V14" stroke="' + domColor + '" stroke-width="1.2"/>',
          domColor
        );
      }
      if (k === 'folder') {
        if (isOpen || node.filesExpanded) {
          return _atlasSvg(
            '<path d="M2 4.2c0-.8.6-1.4 1.4-1.4h3l1.4 1.5h4.8c.8 0 1.4.6 1.4 1.4v1.1H3.6L2 11.8V4.2Z" fill="#dcb67a" fill-opacity="0.2" stroke="#dcb67a" stroke-width="1.2" stroke-linejoin="round"/>' +
            '<path d="M2 12.2 3.8 7h10.7l-1.7 5.2H2Z" fill="#dcb67a" fill-opacity="0.28" stroke="#dcb67a" stroke-width="1.2" stroke-linejoin="round"/>',
            '#dcb67a'
          );
        }
        return _atlasSvg(
          '<path d="M2.2 4.2c0-.8.6-1.4 1.4-1.4h3.1l1.4 1.6h4.3c.8 0 1.4.6 1.4 1.4v5.8c0 .8-.6 1.4-1.4 1.4H3.6c-.8 0-1.4-.6-1.4-1.4V4.2Z" fill="#dcb67a" fill-opacity="0.18" stroke="#dcb67a" stroke-width="1.2" stroke-linejoin="round"/>',
          '#dcb67a'
        );
      }
      if (node.isSummary) {
        return _atlasSvg(
          '<rect x="2.5" y="4.5" width="9.5" height="8.5" rx="1.6" stroke="#8b949e" stroke-width="1.2"/>' +
          '<path d="M4.8 2.8h8.7v8.2" stroke="#8b949e" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
          '#8b949e'
        );
      }
      if (k === 'claim') {
        return _atlasSvg(
          '<path d="M8 2 9.6 6.4 14 8l-4.4 1.6L8 14 6.4 9.6 2 8l4.4-1.6L8 2Z" fill="#58a6ff" fill-opacity="0.18" stroke="#58a6ff" stroke-width="1.2" stroke-linejoin="round"/>',
          '#58a6ff'
        );
      }
      if (k === 'blocking') {
        return _atlasSvg(
          '<path d="M8 2 13.5 4.4v3.8c0 3.1-2.3 5.3-5.5 6.3-3.2-1-5.5-3.2-5.5-6.3V4.4L8 2Z" fill="#f0883e" fill-opacity="0.18" stroke="#f0883e" stroke-width="1.25" stroke-linejoin="round"/>' +
          '<path d="M8 5.5v3.2M8 11.1h.01" stroke="#f0883e" stroke-width="1.4" stroke-linecap="round"/>',
          '#f0883e'
        );
      }
      if (k === 'impact') {
        return _atlasSvg(
          '<circle cx="8" cy="8" r="2" fill="#39c5cf"/>' +
          '<path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8M2.5 2.6a8 8 0 0 0 0 10.8M13.5 2.6a8 8 0 0 1 0 10.8" stroke="#39c5cf" stroke-width="1.2" stroke-linecap="round"/>',
          '#39c5cf'
        );
      }
      if (k === 'directive') {
        return _atlasSvg(
          '<path d="M3 3h10v7.5H6.5L3.5 13V10.5H3V3Z" fill="#a371f7" fill-opacity="0.18" stroke="#a371f7" stroke-width="1.25" stroke-linejoin="round"/>',
          '#a371f7'
        );
      }
      return getFileIconSvg(node.path || node.title, { kind: k });
    }
  `;
}
