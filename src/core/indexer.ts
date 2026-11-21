import { AtlasManifest, EvidenceAnchor } from './types.js';

export type ProjectScale = 'small' | 'medium' | 'large';

export type ArchPatternId =
  | 'ddd-layered'
  | 'monorepo'
  | 'fullstack-split'
  | 'core-host'
  | 'modular';

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
}

export interface RepoArchitecture {
  scale: ProjectScale;
  totalFiles: number;
  patternId: ArchPatternId;
  patternLabelZh: string;
  patternLabelEn: string;
  domains: IndexedDomain[];
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
    keywords: ['interfaces', 'presentation', 'ui', 'web', 'frontend', 'client', 'webview', 'views', 'pages', 'app', 'apps'],
    layerZh: '接口 / 表现层',
    layerEn: 'Interface / UI',
    descZh: '对外交互界面、入口适配与视图呈现模块',
    descEn: 'User-facing views, host adapters, and entrypoints',
    rank: 10,
  },
  {
    keywords: ['application', 'usecases', 'use-cases', 'services', 'workflows', 'orchestrator', 'cli', 'cmd', 'commands'],
    layerZh: '应用 / 编排层',
    layerEn: 'Application',
    descZh: '用例编排、命令调度与业务流程协调模块',
    descEn: 'Use-case orchestration, CLI commands, and workflow coordination',
    rank: 20,
  },
  {
    keywords: ['domain', 'core', 'model', 'models', 'entities', 'kernel', 'engine'],
    layerZh: '领域 / 核心层',
    layerEn: 'Domain / Core',
    descZh: '核心领域模型、业务规则与宿主无关的纯逻辑底座',
    descEn: 'Core domain logic, rules, and host-independent abstractions',
    rank: 30,
  },
  {
    keywords: ['infrastructure', 'infra', 'adapters', 'storage', 'db', 'database', 'persistence', 'repos', 'repositories', 'gateway'],
    layerZh: '基础设施层',
    layerEn: 'Infrastructure',
    descZh: '存储、外部协议集成、系统 I/O 与底层适配实现',
    descEn: 'Storage, external protocols, I/O, and technical adapters',
    rank: 40,
  },
  {
    keywords: ['schemas', 'types', 'contracts', 'proto', 'api', 'shared', 'common', 'pkg', 'packages', 'crates', 'libs'],
    layerZh: '契约 / 共享包',
    layerEn: 'Contracts / Shared',
    descZh: '跨模块共享协议、数据结构与公共包',
    descEn: 'Shared schemas, contracts, and reusable packages',
    rank: 50,
  },
  {
    keywords: ['test', 'tests', '__tests__', 'spec', 'e2e', 'examples', 'docs'],
    layerZh: '测试 / 示例与文档',
    layerEn: 'Tests & Examples',
    descZh: '自动化测试、示例样本与项目文档',
    descEn: 'Automated tests, sample fixtures, and documentation',
    rank: 60,
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
    desc: lang === 'zh' ? `目录板块（${segment}）` : `Directory module (${segment})`,
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
      };
    });

    const unassigned = normalizedFiles.filter((f) => !assigned.has(f));
    if (unassigned.length > 0) {
      domains.push({
        id: 'other-files',
        name: lang === 'zh' ? '其他配置与测试文件' : 'Other Config & Tests',
        layer: lang === 'zh' ? '辅助 / 配置' : 'Support / Config',
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
      });
    }

    domains.sort((a, b) => a.layerRank - b.layerRank);
    return {
      scale,
      totalFiles,
      ...pattern,
      domains,
    };
  }

  // Heuristic domain grouping when no .atlas/manifest.json exists
  // Group at depth 2 for src/, packages/, apps/, crates/, services/; depth 1 otherwise
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
    domains.push({
      id: `auto:${key}`,
      name: key === '(root)' ? (lang === 'zh' ? '根目录配置' : 'Root Config') : key,
      layer: hint.layer,
      layerRank: key === '(root)' ? 95 : hint.rank,
      description: `${hint.desc} · ${files.length} ${lang === 'zh' ? '个文件' : 'files'}`,
      paths: key === '(root)' ? [] : [key],
      files,
      fileCount: files.length,
      entrypoints: [],
      fromManifest: false,
    });
  }

  domains.sort((a, b) => a.layerRank - b.layerRank || b.fileCount - a.fileCount);

  return {
    scale,
    totalFiles,
    ...pattern,
    domains,
  };
}
