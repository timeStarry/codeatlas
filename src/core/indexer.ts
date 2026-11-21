import { AtlasManifest, EvidenceAnchor } from './types.js';

export type ProjectScale = 'small' | 'medium' | 'large';

export type ArchPatternId =
  | 'ddd-layered'
  | 'monorepo'
  | 'fullstack-split'
  | 'core-host'
  | 'modular';

export type ArtifactKind = 'code' | 'test' | 'config' | 'ci' | 'docs' | 'asset';

export interface IndexedDomain {
  id: string;
  name: string;
  layer?: string;
  layerRank: number;
  description: string;
  paths: string[];
  files: string[];
  fileCount: number;
  entrypoints: EvidenceAnchor[];
  fromManifest: boolean;
  isSupport: boolean;
  artifactCounts: Record<ArtifactKind, number>;
  packageName?: string;
  workspaceDeps?: string[];
}

export interface RepoArchitecture {
  scale: ProjectScale;
  totalFiles: number;
  patternId: ArchPatternId;
  patternLabelZh: string;
  patternLabelEn: string;
  domains: IndexedDomain[];
}

const ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.avif', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.wasm', '.bin', '.exe', '.dll', '.so', '.dylib', '.icns', '.psd', '.ai', '.sketch', '.fig',
]);

const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.org']);

const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.lock', '.xml', '.properties']);

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'cargo.lock',
  'poetry.lock',
  'uv.lock',
  'go.sum',
  'gemfile.lock',
  'composer.lock',
  'flake.lock',
]);

export function classifyFileArtifact(relPath: string): ArtifactKind {
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const lower = norm.toLowerCase();
  const base = lower.split('/').pop() || lower;
  const dotIdx = base.lastIndexOf('.');
  const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';

  // 1. CI / Workflows
  if (
    lower.startsWith('.github/') ||
    lower.startsWith('.gitlab-ci') ||
    lower.startsWith('.circleci/') ||
    base === 'jenkinsfile'
  ) {
    return 'ci';
  }

  // 2. Binary / Media / Static Assets
  if (ASSET_EXTS.has(ext)) {
    return 'asset';
  }
  if (
    (lower.startsWith('assets/') || lower.includes('/assets/') || lower.startsWith('public/images/')) &&
    (ext === '.html' || ext === '.css' || ASSET_EXTS.has(ext))
  ) {
    return 'asset';
  }

  // 3. Docs
  if (DOC_EXTS.has(ext) || lower.startsWith('docs/') || base === 'license' || base === 'changelog') {
    return 'docs';
  }

  // 4. Tests
  if (
    lower.startsWith('test/') ||
    lower.startsWith('tests/') ||
    lower.startsWith('e2e/') ||
    lower.includes('/__tests__/') ||
    lower.includes('/tests/') ||
    /\.(test|spec)\.[^.]+$/.test(base) ||
    /_test\.[^.]+$/.test(base)
  ) {
    return 'test';
  }

  // 5. Config / Lockfiles / Dotfiles
  if (
    LOCKFILES.has(base) ||
    base.startsWith('.') ||
    base.startsWith('dockerfile') ||
    base.startsWith('docker-compose') ||
    CONFIG_EXTS.has(ext)
  ) {
    return 'config';
  }

  // Default: polyglot-safe 'code' (protects .wit, .proto, .sql, .graphql, .rs, .ts, .py, .go, etc.)
  return 'code';
}

function countArtifacts(files: string[]): Record<ArtifactKind, number> {
  const counts: Record<ArtifactKind, number> = {
    code: 0,
    test: 0,
    config: 0,
    ci: 0,
    docs: 0,
    asset: 0,
  };
  for (const f of files) {
    counts[classifyFileArtifact(f)] += 1;
  }
  return counts;
}

interface LayerHeuristic {
  keywords: string[];
  layerZh: string;
  layerEn: string;
  descZh: string;
  descEn: string;
  rank: number;
}

const LAYER_HEURISTICS: LayerHeuristic[] = [
  {
    keywords: ['interfaces', 'presentation', 'ui', 'web', 'frontend', 'client', 'webview', 'views', 'pages', 'app', 'apps', 'editor', 'renderer'],
    layerZh: '接口 / 表现层',
    layerEn: 'Interface / UI',
    descZh: '对外交互界面、编辑器与视图呈现模块',
    descEn: 'User-facing views, editor, and host presentation',
    rank: 10,
  },
  {
    keywords: ['application', 'usecases', 'use-cases', 'services', 'workflows', 'orchestrator', 'cli', 'cmd', 'commands', 'rpc', 'ipc'],
    layerZh: '应用 / 编排层',
    layerEn: 'Application',
    descZh: '用例编排、RPC/IPC 通信与命令调度模块',
    descEn: 'Use-case orchestration, RPC/IPC, and command dispatch',
    rank: 20,
  },
  {
    keywords: ['domain', 'core', 'model', 'models', 'entities', 'kernel', 'engine'],
    layerZh: '领域 / 核心层',
    layerEn: 'Domain / Core',
    descZh: '核心领域模型、业务规则与宿主无关逻辑底座',
    descEn: 'Core domain logic, rules, and host-independent engine',
    rank: 30,
  },
  {
    keywords: ['infrastructure', 'infra', 'adapters', 'storage', 'db', 'database', 'persistence', 'repos', 'repositories', 'gateway', 'plugins', 'plugins-wasm'],
    layerZh: '扩展 / 基础设施层',
    layerEn: 'Plugins / Infra',
    descZh: '插件扩展、存储适配与外部系统集成模块',
    descEn: 'Plugins, storage adapters, and external integrations',
    rank: 40,
  },
  {
    keywords: ['schemas', 'types', 'contracts', 'proto', 'wit', 'api', 'plugin-api', 'shared', 'common', 'pkg', 'packages', 'crates', 'libs'],
    layerZh: '契约 / 共享包',
    layerEn: 'Contracts / Shared',
    descZh: '跨模块共享协议、接口契约与公共包',
    descEn: 'Shared schemas, contracts, and reusable packages',
    rank: 50,
  },
  {
    keywords: ['test', 'tests', '__tests__', 'spec', 'e2e'],
    layerZh: '自动化测试',
    layerEn: 'Tests',
    descZh: '自动化测试用例与集成验证套件',
    descEn: 'Automated test suites and fixtures',
    rank: 65,
  },
  {
    keywords: ['assets', 'public', 'static', 'media', 'docs', '.github', 'docker', 'scripts', 'tools', 'examples'],
    layerZh: '资源 / 工程支撑',
    layerEn: 'Assets & Support',
    descZh: '静态资源、CI 流程、脚本与项目文档',
    descEn: 'Static assets, CI workflows, scripts, and docs',
    rank: 85,
  },
];

function classifySegment(segment: string, lang: 'zh' | 'en'): {
  layer?: string;
  desc: string;
  rank: number;
} {
  const lower = segment.toLowerCase();
  for (const h of LAYER_HEURISTICS) {
    if (h.keywords.some((k) => lower === k || lower.includes(k))) {
      return {
        layer: lang === 'zh' ? h.layerZh : h.layerEn,
        desc: lang === 'zh' ? h.descZh : h.descEn,
        rank: h.rank,
      };
    }
  }
  return {
    layer: undefined,
    desc: lang === 'zh' ? `代码模块（${segment}）` : `Code module (${segment})`,
    rank: 55,
  };
}

function detectArchitecturePattern(trackedFiles: string[]): {
  patternId: ArchPatternId;
  patternLabelZh: string;
  patternLabelEn: string;
} {
  const segSet = new Set<string>();
  const topSet = new Set<string>();
  for (const f of trackedFiles) {
    const parts = f.split('/');
    if (parts.length > 1) topSet.add(parts[0].toLowerCase());
    for (const p of parts.slice(0, 3)) {
      segSet.add(p.toLowerCase());
    }
  }

  const dddHits = ['domain', 'application', 'infrastructure', 'interfaces', 'presentation'].filter(
    (k) => segSet.has(k)
  ).length;
  if (dddHits >= 2) {
    return {
      patternId: 'ddd-layered',
      patternLabelZh: 'DDD / 分层架构',
      patternLabelEn: 'DDD / Layered Architecture',
    };
  }

  const monoHits = ['packages', 'apps', 'crates', 'services', 'workspaces'].filter((k) =>
    topSet.has(k)
  ).length;
  if (monoHits >= 1 && trackedFiles.some((f) => /^(packages|apps|crates|services)\/[^/]+\//.test(f))) {
    return {
      patternId: 'monorepo',
      patternLabelZh: 'Monorepo / 多包工作区',
      patternLabelEn: 'Monorepo / Multi-Package',
    };
  }

  const hasFront = ['frontend', 'client', 'web', 'ui'].some((k) => topSet.has(k));
  const hasBack = ['backend', 'server', 'api'].some((k) => topSet.has(k));
  if (hasFront && hasBack) {
    return {
      patternId: 'fullstack-split',
      patternLabelZh: '前后端分层架构',
      patternLabelEn: 'Full-Stack Split',
    };
  }

  const hasCore = segSet.has('core');
  const hasHost = segSet.has('webview') || segSet.has('cli') || trackedFiles.some((f) => f.endsWith('extension.ts'));
  if (hasCore && hasHost) {
    return {
      patternId: 'core-host',
      patternLabelZh: '核心引擎 + 宿主分层',
      patternLabelEn: 'Core Engine + Host Layered',
    };
  }

  return {
    patternId: 'modular',
    patternLabelZh: '模块化目录结构',
    patternLabelEn: 'Modular Directory Layout',
  };
}

function getScale(totalFiles: number): ProjectScale {
  if (totalFiles <= 60) return 'small';
  if (totalFiles <= 300) return 'medium';
  return 'large';
}

export function analyzeRepositoryArchitecture(
  trackedFiles: string[],
  manifest?: AtlasManifest,
  lang: 'zh' | 'en' = 'zh'
): RepoArchitecture {
  const normalizedFiles = trackedFiles.map((f) => f.replace(/\\/g, '/'));
  const totalFiles = normalizedFiles.length;
  const scale = getScale(totalFiles);
  const pattern = detectArchitecturePattern(normalizedFiles);

  if (manifest && manifest.domains.length > 0) {
    const assigned = new Set<string>();
    const domains: IndexedDomain[] = manifest.domains.map((d) => {
      const matchedFiles = normalizedFiles.filter((f) =>
        d.paths.some((p) => {
          const clean = p.replace(/\\/g, '/').replace(/\/+$/, '');
          return f === clean || f.startsWith(`${clean}/`);
        })
      );
      matchedFiles.forEach((f) => assigned.add(f));
      const hint = classifySegment(`${d.id} ${d.name} ${d.paths.join(' ')}`, lang);
      const artifactCounts = countArtifacts(matchedFiles);
      return {
        id: d.id,
        name: d.name,
        layer: hint.layer,
        layerRank: hint.rank,
        description: d.description,
        paths: d.paths,
        files: matchedFiles,
        fileCount: matchedFiles.length,
        entrypoints: d.entrypoints ?? [],
        fromManifest: true,
        isSupport: false, // explicit manifest domains are never auto-hidden
        artifactCounts,
      };
    });

    const unassigned = normalizedFiles.filter((f) => !assigned.has(f));
    if (unassigned.length > 0) {
      const artifactCounts = countArtifacts(unassigned);
      domains.push({
        id: 'other-files',
        name: lang === 'zh' ? '其他配置与支撑文件' : 'Other Config & Support',
        layer: lang === 'zh' ? '资源 / 工程支撑' : 'Assets & Support',
        layerRank: 90,
        description:
          lang === 'zh'
            ? '未归入 .atlas/manifest.json 显式职责域的仓库文件'
            : 'Repository files outside explicit .atlas/manifest.json domains',
        paths: [],
        files: unassigned,
        fileCount: unassigned.length,
        entrypoints: [],
        fromManifest: false,
        isSupport: artifactCounts.code === 0 && artifactCounts.test === 0,
        artifactCounts,
      });
    }

    domains.sort((a, b) => a.layerRank - b.layerRank);
    return { scale, totalFiles, ...pattern, domains };
  }

  // Heuristic domain grouping when no .atlas/manifest.json exists
  const groups = new Map<string, string[]>();
  const deepRoots = new Set(['src', 'packages', 'apps', 'crates', 'services', 'lib', 'internal']);

  for (const f of normalizedFiles) {
    const parts = f.split('/');
    let key = '(root)';
    if (parts.length >= 3 && deepRoots.has(parts[0].toLowerCase())) {
      key = `${parts[0]}/${parts[1]}`;
    } else if (parts.length >= 2) {
      key = parts[0];
    }
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }

  const domains: IndexedDomain[] = [];
  for (const [key, files] of groups.entries()) {
    const leafName = key.includes('/') ? key.split('/')[1] : key;
    const hint = classifySegment(leafName, lang);
    const artifactCounts = countArtifacts(files);
    const isTestDomain = ['test', 'tests', 'e2e', '__tests__'].includes(key.toLowerCase());
    const isSupport =
      key === '(root)' ||
      (!isTestDomain && artifactCounts.code === 0);

    domains.push({
      id: `auto:${key}`,
      name: key === '(root)' ? (lang === 'zh' ? '根目录配置' : 'Root Config') : key,
      layer: hint.layer,
      layerRank: key === '(root)' ? 95 : isSupport ? Math.max(85, hint.rank) : hint.rank,
      description: `${hint.desc} · ${files.length} ${lang === 'zh' ? '个文件' : 'files'}`,
      paths: key === '(root)' ? [] : [key],
      files,
      fileCount: files.length,
      entrypoints: [],
      fromManifest: false,
      isSupport,
      artifactCounts,
    });
  }

  domains.sort((a, b) => a.layerRank - b.layerRank || b.fileCount - a.fileCount);
  return { scale, totalFiles, ...pattern, domains };
}
