import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type StandardSchemaV1,
} from '@modelcontextprotocol/ext-apps';

export interface CanvasOutboundMessage {
  type: string;
  worktreePath?: string;
  scope?: 'branch' | 'node';
  depth?: 'overview' | 'flow' | 'deep';
  agentTarget?: 'auto' | 'current' | 'new';
  scopeRoot?: string;
  storageMode?: 'git-hidden' | 'worktree-excluded' | 'worktree-tracked';
  baseRef?: string;
  nodeId?: string;
  title?: string;
  kind?: string;
  path?: string;
  line?: number;
  startLine?: number;
  endLine?: number;
  note?: string;
  directiveKind?: 'constraint' | 'question' | 'rework';
  contextBody?: string;
  [key: string]: unknown;
}

export interface CodeAtlasHostBridge {
  postMessage: (msg: CanvasOutboundMessage) => void;
}

interface BrowserGlobal {
  __CODEATLAS_HOST__?: CodeAtlasHostBridge;
  postMessage?: (message: unknown, targetOrigin: string) => void;
  document?: {
    getElementById?: (id: string) => { value?: string } | null;
  };
}

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}

const STATE_ACTIONS = new Set([
  'ready',
  'refresh',
  'setWorktreePath',
  'setScopeRoot',
  'setStorageMode',
  'setMode',
  'setBaseRef',
  'setLang',
  'toggleDomainFiles',
  'expandDomainFiles',
  'expandAllFiles',
  'collapseAllFiles',
  'toggleFolderFiles',
  'toggleFileSymbols',
  'toggleSupportAssets',
  'setPruneUnchanged',
  'selectBriefing',
  'addDirective',
  'removeDirective',
  'clearDirectives',
  'initManifestDraft',
]);

const passthroughResultSchema: StandardSchemaV1<
  unknown,
  { isError?: boolean; [key: string]: unknown }
> = {
  '~standard': {
    version: 1,
    vendor: 'codeatlas',
    validate(value: unknown) {
      if (value && typeof value === 'object') {
        return { value: value as { isError?: boolean; [key: string]: unknown } };
      }
      return { value: {} };
    },
  },
};

const win = globalThis as unknown as BrowserGlobal;

let currentWorktreePath = '';
let receivedInitialResult = false;
let analyzeResetTimer: ReturnType<typeof setTimeout> | undefined;
let bgPollTimer: ReturnType<typeof setInterval> | undefined;
let lastKnownStateStamp = '';

function computeStateStamp(statePayload: Record<string, unknown>): string {
  const activeBriefing = String(statePayload.activeBriefingPath ?? '');
  const graph = statePayload.graph as
    | {
        nodes?: Array<{ id?: string; body?: string; roleSummary?: string; directiveStatus?: string; resolutionSummary?: string }>;
        summary?: { openDirectiveCount?: number; verified?: number; mismatch?: number };
      }
    | undefined;
  const nodesSig = (graph?.nodes ?? [])
    .map((n) => `${n.id}:${n.body ?? ''}:${n.roleSummary ?? ''}:${n.directiveStatus ?? ''}:${n.resolutionSummary ?? ''}`)
    .join('|');
  return `${activeBriefing}#${graph?.summary?.openDirectiveCount ?? 0}#${nodesSig.length}:${nodesSig.slice(0, 600)}`;
}

function stopBackgroundPoll(): void {
  if (bgPollTimer) {
    clearInterval(bgPollTimer);
    bgPollTimer = undefined;
  }
}

function startBackgroundRefreshWatch(baselineStamp: string): void {
  stopBackgroundPoll();
  let ticks = 0;
  bgPollTimer = setInterval(() => {
    ticks += 1;
    if (ticks > 30 || !currentWorktreePath) {
      stopBackgroundPoll();
      dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
      return;
    }
    if (inFlightTools > 0) return;
    void (async () => {
      try {
        const res = await withToolSlot(() =>
          app.callServerTool({
            name: 'atlas_app_action',
            arguments: {
              worktreePath: currentWorktreePath,
              action: 'refresh',
              payload: { type: 'refresh' },
            },
          })
        );
        const data = extractStructured(res as ToolResultLike);
        if (!data) return;
        const statePayload = unwrapCanvasState(data);
        const nextStamp = computeStateStamp(statePayload);
        if (nextStamp && nextStamp !== baselineStamp) {
          lastKnownStateStamp = nextStamp;
          stopBackgroundPoll();
          dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
          dispatchToCanvas({ type: 'canvasState', payload: statePayload });
        }
      } catch {
        // ignore transient poll errors
      }
    })();
  }, 4000);
}

// Antigravity enforces at most 4 concurrent server tool calls per MCP App view.
const MAX_IN_FLIGHT_TOOLS = 3;
let inFlightTools = 0;
const toolWaitQueue: Array<() => void> = [];

async function withToolSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlightTools >= MAX_IN_FLIGHT_TOOLS) {
    await new Promise<void>((resolve) => toolWaitQueue.push(resolve));
  }
  inFlightTools++;
  try {
    return await fn();
  } finally {
    inFlightTools--;
    const next = toolWaitQueue.shift();
    if (next) next();
  }
}

function dispatchToCanvas(message: Record<string, unknown>): void {
  win.postMessage?.(message, '*');
}

function readDomWorktreeFallback(): string {
  const raw = win.document?.getElementById?.('worktreeInput')?.value;
  return typeof raw === 'string' ? raw.trim() : '';
}

function updateWorktreeFromData(data: Record<string, unknown>): void {
  if (typeof data.worktreePath === 'string' && data.worktreePath.trim()) {
    currentWorktreePath = data.worktreePath.trim();
    return;
  }
  const git = data.git as { repoRoot?: unknown } | undefined;
  if (git && typeof git.repoRoot === 'string' && git.repoRoot.trim()) {
    currentWorktreePath = git.repoRoot.trim();
  }
}

function extractStructured(result: ToolResultLike): Record<string, unknown> | undefined {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const textItem = result.content?.find((c) => c.type === 'text' && typeof c.text === 'string');
  if (textItem?.text) {
    try {
      const parsed: unknown = JSON.parse(textItem.text);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // plain text content
    }
  }
  return undefined;
}

function extractErrorText(result: ToolResultLike): string {
  const textItem = result.content?.find((c) => c.type === 'text' && typeof c.text === 'string');
  return textItem?.text?.trim() || 'MCP tool call failed.';
}

function unwrapCanvasState(data: Record<string, unknown>): Record<string, unknown> {
  if (data.type === 'canvasState' && data.payload && typeof data.payload === 'object') {
    return data.payload as Record<string, unknown>;
  }
  if (data.canvasState && typeof data.canvasState === 'object') {
    return data.canvasState as Record<string, unknown>;
  }
  return data;
}

function buildErrorCanvasState(error: string): Record<string, unknown> {
  return {
    git: null,
    baseRef: 'HEAD',
    graph: { mode: 'hybrid', nodes: [], edges: [], summary: {} },
    availableBriefings: [],
    activeBriefingPath: '',
    worktreePath: currentWorktreePath,
    error,
  };
}

export function toWorkspaceFileUri(baseDir: string, targetPath: string): string | null {
  const cleanTarget = targetPath.replace(/\\/g, '/').trim();
  if (!cleanTarget) return null;
  const cleanBase = baseDir.replace(/\\/g, '/').replace(/\/+$/, '').trim();
  const full = /^([a-zA-Z]:\/|\/)/.test(cleanTarget)
    ? cleanTarget
    : cleanBase
      ? `${cleanBase}/${cleanTarget.replace(/^\/+/, '')}`
      : '';
  if (!full) return null;

  const encoded = full
    .split('/')
    .map((seg, idx) => {
      if (idx === 0 && /^[a-zA-Z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    })
    .join('/');

  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

function buildAnalyzeChatPrompt(msg: CanvasOutboundMessage, repoPath: string): string {
  const depth =
    msg.depth === 'overview' || msg.depth === 'flow' || msg.depth === 'deep'
      ? msg.depth
      : msg.scope === 'branch'
        ? 'deep'
        : 'overview';
  const scopeRoot = typeof msg.scopeRoot === 'string' ? msg.scopeRoot.trim() : '';

  if (msg.scope === 'branch' && depth !== 'overview') {
    const baseRef = typeof msg.baseRef === 'string' && msg.baseRef ? msg.baseRef : 'HEAD';
    const scopeClause = scopeRoot ? `（限定子目录范围：\`${scopeRoot}\`）` : '';
    const ctxParams = `worktreePath: "${repoPath}", baseRef: "${baseRef}"${scopeRoot ? `, scopePath: "${scopeRoot}"` : ''}`;
    if (depth === 'flow') {
      return [
        `请按 **L2 调用与数据流级** 分析本地仓库 \`${repoPath}\`${scopeClause} 当前分支相对 \`${baseRef}\` 的主要变更链路：`,
        `1. 调用 \`atlas_get_context\`（\`${ctxParams}\`）读取当前 Git 状态、架构红线及预解析的 Tree-sitter AST 符号行号表（\`astOutline\`）。`,
        `2. 结合 \`git diff ${baseRef}\` 与改动文件，仅提炼 3–5 条核心调用链变更断言（\`claims[]\`，直接参考 \`astOutline\` 附精确 1-based \`path / startLine / endLine / symbol\`），无需穷举行级边角分支。`,
        `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing: { schemaVersion: "0.2", depth: "flow", scopePath: "${scopeRoot}", baseRef: "${baseRef}", targetRef: "WORKTREE", ... }\`）提交并修正任何锚点不一致（\`MISMATCH\`）。`,
        `4. 调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`）刷新画布。`,
      ].join('\n');
    }
    return [
      `请按 **L3 守卫与影响核验级** 分析本地仓库 \`${repoPath}\`${scopeClause} 当前分支相对 \`${baseRef}\` 的代码变更并生成确定性核验简报：`,
      `1. 调用 \`atlas_get_context\`（\`${ctxParams}\`）读取 Git 状态、架构红线、待办批注及 Tree-sitter AST 符号与守卫条件表（\`astOutline\`）。`,
      `2. 检查 \`git diff ${baseRef}\` 与相关真实源码，梳理核心变更断言（\`claims[]\`，附精确 1-based \`path / startLine / endLine / symbol\`）、前置守卫条件（\`blockingConditions[]\`）、跨模块影响（\`impacts[]\`）、盲区（\`blindSpots[]\`）与验证信号（\`verificationSignals[]\`）。`,
      `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`schemaVersion: "0.2"\`，\`depth: "deep"\`，\`baseRef: "${baseRef}"\`，\`targetRef: "WORKTREE"\`）提交简报；若返回任何不一致（\`MISMATCH\`），请核对真实源码修正后重提直至通过。`,
      `4. 核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`，\`mode: "hybrid"\`）刷新当前 CodeAtlas 画布面板。`,
    ].join('\n');
  }

  const title = typeof msg.title === 'string' && msg.title ? msg.title : (scopeRoot || '目标模块');
  const kind = typeof msg.kind === 'string' && msg.kind ? msg.kind : 'module';
  const relPath =
    typeof msg.path === 'string' && msg.path ? msg.path : scopeRoot;
  const lineSpan =
    kind === 'symbol' && typeof msg.startLine === 'number'
      ? `:${msg.startLine}${typeof msg.endLine === 'number' && msg.endLine !== msg.startLine ? `-${msg.endLine}` : ''}`
      : '';
  const targetDesc =
    relPath && relPath !== title ? `${title} (${relPath}${lineSpan})` : `${title}${lineSpan}`;

  if (depth === 'overview') {
    return [
      `请按 **L1 模块职责概览级（快速轻量）** 梳理本地仓库 \`${repoPath}\` 中的「${targetDesc}」，原地回填模块与各子文件的职责说明：`,
      `1. **控制阅读深度**：可调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}", scopePath: "${relPath}"\`）直接获取预提取的 AST 符号表，或仅查看「${relPath || '根目录'}」下的目录结构与导出定义，**不要逐行深抠边角逻辑**。`,
      `2. 调用 \`atlas_submit_outline\`（\`worktreePath: "${repoPath}"\`），提交 \`outline\`（\`schemaVersion: "0.2"\`，\`scopePath: "${relPath}"\`，\`targetRef: "WORKTREE"\`，\`title\`，1–2 句整体职责 \`summary\`，建议优先阅读的入口文件 \`recommendedEntry\`，以及 \`children: [{ path, summary, role }]\` 为该目录下的每个主要文件/子目录写一句 35 字以内的精炼职责说明；所有 \`path\` 必须为仓库真实相对路径）。`,
      `3. 若返回路径不一致请立即修正重提；核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`）将职责概览直接刷新回画布节点上。`,
    ].join('\n');
  }

  if (depth === 'flow') {
    return [
      `请按 **L2 调用与数据流级** 分析本地仓库 \`${repoPath}\` 中的 ${kind}「${targetDesc}」：`,
      `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}", scopePath: "${relPath}"\`）读取上下文与预提取的 Tree-sitter AST 符号行号表（\`astOutline\`）。`,
      `2. 阅读「${targetDesc}」内的核心源码文件，聚焦梳理 **3–5 条主干调用链 / 数据流**（\`claims[]\`，参考 \`astOutline\` 附精确 1-based \`path / startLine / endLine / symbol\`），无需罗列琐碎边角分支。`,
      `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing\` 中设 \`schemaVersion: "0.2"\`、\`depth: "flow"\`、\`scopePath: "${relPath}"\`、\`targetRef: "WORKTREE"\`）；若有不一致（\`MISMATCH\`）核对修正后重提。`,
      `4. 核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`，\`mode: "hybrid"\`）刷新画布。`,
    ].join('\n');
  }

  return [
    `请按 **L3 守卫与影响核验级** 分析本地仓库 \`${repoPath}\` 中的 ${kind}「${targetDesc}」并生成完整核验简报：`,
    `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}", scopePath: "${relPath}"\`）读取 Git 状态、架构红线及预提取的 Tree-sitter AST 符号与守卫条件表（\`astOutline\`）。`,
    `2. 深入阅读「${targetDesc}」的真实源码文件，梳理核心调用链断言（\`claims[]\`，附精确 1-based \`path / startLine / endLine / symbol\`）、前置守卫条件（\`blockingConditions[]\`）、跨模块耦合影响（\`impacts[]\`）、架构盲区（\`blindSpots[]\`）与验证信号（\`verificationSignals[]\`）。`,
    `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing\` 设 \`schemaVersion: "0.2"\`、\`depth: "deep"\`、\`scopePath: "${relPath}"\`、\`targetRef: "WORKTREE"\`）；若返回任何不一致（\`MISMATCH\`），核对真实源码修正后重提直至通过。`,
    `4. 核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`，\`mode: "hybrid"\`）刷新当前 CodeAtlas 画布面板。`,
  ].join('\n');
}

// Synchronous host bridge registration BEFORE Canvas main script executes
win.__CODEATLAS_HOST__ = {
  postMessage(msg: CanvasOutboundMessage): void {
    void handleCanvasMessage(msg);
  },
};

const app = new App({ name: 'CodeAtlas', version: '0.2.0' }, {});

// Register all notification handlers BEFORE app.connect() so zero notifications are missed
app.ontoolinput = ({ arguments: args }) => {
  if (args && typeof args.worktreePath === 'string' && args.worktreePath.trim()) {
    currentWorktreePath = args.worktreePath.trim();
  }
};

app.ontoolresult = (result) => {
  stopBackgroundPoll();
  if (analyzeResetTimer) {
    clearTimeout(analyzeResetTimer);
    analyzeResetTimer = undefined;
    dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
  }
  const data = extractStructured(result as ToolResultLike);
  if (data) {
    receivedInitialResult = true;
    updateWorktreeFromData(data);
    const statePayload = unwrapCanvasState(data);
    updateWorktreeFromData(statePayload);
    lastKnownStateStamp = computeStateStamp(statePayload);
    dispatchToCanvas({ type: 'canvasState', payload: statePayload });
  } else if (result.isError) {
    dispatchToCanvas({
      type: 'canvasState',
      payload: buildErrorCanvasState(extractErrorText(result as ToolResultLike)),
    });
  }
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

const connectPromise: Promise<boolean> = (async () => {
  try {
    await app.connect();
    const ctx = app.getHostContext();
    if (ctx?.theme) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    const caps = app.getHostCapabilities();
    dispatchToCanvas({
      type: 'hostCapabilities',
      payload: {
        canAnalyze: Boolean(caps?.message),
        canUpdateContext: Boolean(caps?.updateModelContext),
      },
    });
    return true;
  } catch {
    return false;
  }
})();

async function handleCanvasMessage(msg: CanvasOutboundMessage): Promise<void> {
  if (!msg || typeof msg.type !== 'string') return;

  const connected = await connectPromise;
  if (!connected) return;

  if (!currentWorktreePath) {
    currentWorktreePath = readDomWorktreeFallback();
  }

  if (msg.type === 'ready') {
    // Allow queued initial ontoolinput/ontoolresult notifications right after connect() to settle first
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    if (receivedInitialResult) return;
  }

  if (msg.type === 'setWorktreePath' && typeof msg.worktreePath === 'string') {
    currentWorktreePath = msg.worktreePath.trim();
  }

  if (msg.type === 'browseDirectory') {
    try {
      const result = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath || undefined,
            action: 'browseDirectory',
            payload: msg,
          },
        })
      );
      const data = extractStructured(result as ToolResultLike);
      const listing =
        data?.listing && typeof data.listing === 'object'
          ? (data.listing as Record<string, unknown>)
          : data?.payload && typeof data.payload === 'object'
            ? (data.payload as Record<string, unknown>)
            : data ?? { entries: [], error: 'Empty directory response.' };
      dispatchToCanvas({ type: 'dirListing', payload: listing });
    } catch (err) {
      dispatchToCanvas({
        type: 'dirListing',
        payload: {
          currentPath: '',
          parentPath: null,
          entries: [],
          currentIsGitRepo: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    return;
  }

  if (msg.type === 'pickWorktreeDialog') {
    try {
      const result = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath || undefined,
            action: 'pickWorktreeDialog',
            payload: msg,
          },
        })
      );
      const data = extractStructured(result as ToolResultLike);
      if (!data || data.type === 'pickCancelled' || data.cancelled) {
        dispatchToCanvas({ type: 'pickWorktreeDone' });
        return;
      }
      if (data.type === 'dirListing') {
        const listing =
          data.payload && typeof data.payload === 'object'
            ? (data.payload as Record<string, unknown>)
            : data.listing && typeof data.listing === 'object'
              ? { ...(data.listing as Record<string, unknown>), nonRepoNotice: data.nonRepoNotice }
              : data;
        dispatchToCanvas({ type: 'dirListing', payload: listing });
        return;
      }
      const statePayload = unwrapCanvasState(data);
      updateWorktreeFromData(data);
      updateWorktreeFromData(statePayload);
      dispatchToCanvas({ type: 'canvasState', payload: statePayload });
    } catch (err) {
      dispatchToCanvas({
        type: 'canvasState',
        payload: buildErrorCanvasState(err instanceof Error ? err.message : String(err)),
      });
    }
    return;
  }

  if (STATE_ACTIONS.has(msg.type)) {
    try {
      const result = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath || undefined,
            action: msg.type,
            payload: msg,
          },
        })
      );
      const data = extractStructured(result as ToolResultLike);
      if (data) {
        const statePayload = unwrapCanvasState(data);
        updateWorktreeFromData(data);
        updateWorktreeFromData(statePayload);
        lastKnownStateStamp = computeStateStamp(statePayload);
        dispatchToCanvas({ type: 'canvasState', payload: statePayload });
      } else if (result.isError) {
        dispatchToCanvas({
          type: 'canvasState',
          payload: buildErrorCanvasState(extractErrorText(result as ToolResultLike)),
        });
      }
    } catch (err) {
      dispatchToCanvas({
        type: 'canvasState',
        payload: buildErrorCanvasState(err instanceof Error ? err.message : String(err)),
      });
    }
    return;
  }

  if (msg.type === 'requestSnippet') {
    try {
      const result = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath || undefined,
            action: 'requestSnippet',
            payload: msg,
          },
        })
      );
      const data = extractStructured(result as ToolResultLike);
      const snippetPayload =
        data?.type === 'snippet' && data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : data?.snippet && typeof data.snippet === 'object'
            ? (data.snippet as Record<string, unknown>)
            : data ?? {
                nodeId: msg.nodeId,
                lines: [],
                error: result.isError
                  ? extractErrorText(result as ToolResultLike)
                  : 'Empty snippet response.',
              };
      dispatchToCanvas({ type: 'snippet', payload: snippetPayload });
    } catch (err) {
      dispatchToCanvas({
        type: 'snippet',
        payload: {
          nodeId: msg.nodeId,
          lines: [],
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    return;
  }

  if (msg.type === 'requestDiff') {
    try {
      const result = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath || undefined,
            action: 'requestDiff',
            payload: msg,
          },
        })
      );
      const data = extractStructured(result as ToolResultLike);
      const diffPayload =
        data?.type === 'fileDiff' && data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : data?.fileDiff && typeof data.fileDiff === 'object'
            ? (data.fileDiff as Record<string, unknown>)
            : {
                nodeId: msg.nodeId,
                diff: typeof data?.diff === 'string' ? data.diff : '',
              };
      dispatchToCanvas({ type: 'fileDiff', payload: diffPayload });
    } catch {
      dispatchToCanvas({
        type: 'fileDiff',
        payload: { nodeId: msg.nodeId, diff: '' },
      });
    }
    return;
  }

  if (msg.type === 'openFile') {
    const relPath = typeof msg.path === 'string' ? msg.path : '';
    const uri = toWorkspaceFileUri(currentWorktreePath, relPath);
    if (!uri) return;
    try {
      await app.request(
        {
          method: 'com.google.antigravity/toggle-aux-pane',
          params: { tabType: 'fileView', uri },
        },
        passthroughResultSchema
      );
    } catch {
      // Host may not support toggle-aux-pane (-32601) or surface has no side pane
    }
    return;
  }

  if (msg.type === 'attachNodeContext') {
    if (!app.getHostCapabilities()?.updateModelContext) return;
    const loc = `${msg.path || msg.scopeRoot || '(root)'}${msg.startLine ? `:${msg.startLine}${msg.endLine && msg.endLine !== msg.startLine ? `-${msg.endLine}` : ''}` : ''}`;
    const text = [
      `[CodeAtlas Context]`,
      `- Repository: ${currentWorktreePath || '(unknown)'}`,
      `- Node: ${msg.title || loc} (${msg.kind || 'node'})`,
      `- Location: ${loc}`,
      ...(msg.contextBody ? [`- Summary: ${msg.contextBody}`] : []),
    ].join('\n');
    try {
      await app.updateModelContext({
        content: [{ type: 'text', text }],
      });
      dispatchToCanvas({
        type: 'contextAttachedNotice',
        payload: { title: msg.title || loc },
      });
    } catch {
      // ignore if surface rejects context attachment
    }
    return;
  }

  if (msg.type === 'analyzeTarget') {
    if (!currentWorktreePath) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: {
          running: false,
          error: '请先选择或输入本地 Git 仓库路径 / Select a local Git repository first.',
        },
      });
      return;
    }

    const canMessage = Boolean(app.getHostCapabilities()?.message);
    if (!canMessage) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: {
          running: false,
          error:
            '当前全局视图无关联对话上下文，请在对话侧边栏打开 CodeAtlas / Open CodeAtlas in conversation side pane.',
        },
      });
      return;
    }

    // In 'auto' (default) or 'new', read-only L1-L3 analysis runs in an isolated background session so current chat stays clean!
    const useNewSession = msg.agentTarget !== 'current';
    const label =
      msg.scope === 'branch'
        ? `Diff vs ${typeof msg.baseRef === 'string' && msg.baseRef ? msg.baseRef : 'HEAD'}`
        : `${typeof msg.title === 'string' && msg.title ? msg.title : 'Module'}${typeof msg.path === 'string' && msg.path ? ` (${msg.path})` : ''}`;

    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: { running: true, label },
    });

    const prompt = buildAnalyzeChatPrompt(msg, currentWorktreePath);
    const baselineStamp = lastKnownStateStamp;
    try {
      const reqParams = {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
        ...(useNewSession
          ? { _meta: { 'com.google.antigravity/message': { target: 'new' } } }
          : {}),
      };
      const res = await app.sendMessage(reqParams as Parameters<typeof app.sendMessage>[0]);
      if (res.isError) {
        dispatchToCanvas({
          type: 'analyzeStatus',
          payload: {
            running: false,
            error: '宿主拒绝了发送消息请求 / Host rejected sendMessage.',
          },
        });
        return;
      }

      if (useNewSession) {
        dispatchToCanvas({
          type: 'analyzeStatus',
          payload: {
            running: true,
            label: `${label} (已在独立后台会话运行，完成后自动刷新画布 / Running in background session...)`,
          },
        });
        startBackgroundRefreshWatch(baselineStamp);
      } else {
        dispatchToCanvas({
          type: 'analyzeStatus',
          payload: { running: true, label: `${label} (已发送至当前会话 / Sent to current chat)` },
        });
        if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
        analyzeResetTimer = setTimeout(() => {
          analyzeResetTimer = undefined;
          dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
        }, 3000);
      }
    } catch (err) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: {
          running: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    return;
  }

  if (msg.type === 'askAgentNow') {
    if (!currentWorktreePath) return;
    // 1. Persist anchored directive on the Canvas first
    let createdId = '';
    let createdRev = 1;
    try {
      const addRes = await withToolSlot(() =>
        app.callServerTool({
          name: 'atlas_app_action',
          arguments: {
            worktreePath: currentWorktreePath,
            action: 'addDirective',
            payload: {
              type: 'addDirective',
              kind: msg.directiveKind || 'question',
              path: msg.path || '',
              startLine: msg.startLine || 1,
              targetNodeId: msg.targetNodeId,
              note: msg.note || '',
            },
          },
        })
      );
      const data = extractStructured(addRes as ToolResultLike);
      if (data) {
        const created = data.createdDirective as { id?: string; revision?: number } | undefined;
        if (created?.id) {
          createdId = created.id;
          createdRev = created.revision ?? 1;
        }
        const unwrapped = unwrapCanvasState(data);
        lastKnownStateStamp = computeStateStamp(unwrapped);
        dispatchToCanvas({ type: 'canvasState', payload: unwrapped });
      }
    } catch {
      // continue to sendMessage even if directive persistence failed
    }

    if (!app.getHostCapabilities()?.message) return;

    // In 'auto' (default) or 'current', code rework & interactive Q&A run in the current session (with context separation via updateModelContext)!
    const useNewSession = msg.agentTarget === 'new';
    const kindLabel =
      msg.directiveKind === 'rework'
        ? '代码修改要求'
        : msg.directiveKind === 'constraint'
          ? '架构约束确认'
          : '代码锚点提问';
    const loc = `${msg.path || '(模块级)'}${msg.startLine ? `:${msg.startLine}` : ''}`;
    const ctxLine = msg.contextBody ? `\n- 当前节点摘要：${msg.contextBody}` : '';
    const ackLine = createdId
      ? msg.directiveKind === 'rework'
        ? `3. 完成真实代码修改后，调用 \`atlas_ack_directive\`（\`worktreePath: "${currentWorktreePath}"\`，\`id: "${createdId}"\`，\`expectedRevision: ${createdRev}\`，\`agentId: "antigravity"\`，\`summary\` 填写修复说明）并调用 \`open_atlas\` 刷新画布。`
        : `3. 在对话中给出解答后，同步调用 \`atlas_ack_directive\`（\`worktreePath: "${currentWorktreePath}"\`，\`id: "${createdId}"\`，\`expectedRevision: ${createdRev}\`，\`agentId: "antigravity"\`，\`summary\` 填入精炼结论）将解答写回该画布批注节点，并调用 \`open_atlas\` 刷新画布。`
      : `3. 处理完成后调用 \`open_atlas\`（\`worktreePath: "${currentWorktreePath}"\`）刷新画布。`;

    const fullPrompt = [
      `【CodeAtlas ${kindLabel}】针对本地仓库 \`${currentWorktreePath}\` 的节点「${msg.title || loc}」：`,
      `- 代码锚点：\`${loc}\`${ctxLine}`,
      `- 详情描述：${msg.note || ''}`,
      ``,
      `请按以下步骤处理：`,
      `1. 阅读 \`${loc}\` 处的真实源码核实情况。`,
      `2. 若涉及简报结论纠偏，请核实后重提修正版简报；若是修改要求，请直接完成代码修改。`,
      ackLine,
    ].join('\n');

    let outboundPrompt = fullPrompt;
    if (!useNewSession && Boolean(app.getHostCapabilities()?.updateModelContext)) {
      try {
        const hiddenMeta = [
          `[CodeAtlas Directive Execution Context]`,
          `- worktreePath: "${currentWorktreePath}"`,
          `- targetNode: ${msg.title || loc}`,
          `- anchor: ${loc}`,
          ...(msg.contextBody ? [`- nodeSummary: ${msg.contextBody}`] : []),
          ...(createdId
            ? [`- directiveId: "${createdId}", expectedRevision: ${createdRev}, agentId: "antigravity"`]
            : []),
          `- Workflow: 1) Read real source at ${loc}; 2) Apply code changes (if rework) or verify/answer (if question/constraint); ${ackLine.replace(/^3\.\s*/, '3) ')}`,
        ].join('\n');
        await app.updateModelContext({
          content: [{ type: 'text', text: hiddenMeta }],
        });
        outboundPrompt = `【CodeAtlas ${kindLabel} · \`${loc}\`】${msg.note || ''}`;
      } catch {
        outboundPrompt = fullPrompt;
      }
    }

    const baselineStamp = lastKnownStateStamp;
    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: {
        running: true,
        label: useNewSession
          ? `已在独立后台会话发送${kindLabel}，解答后自动回写画布...`
          : `已发送${kindLabel}至当前对话窗口...`,
      },
    });
    try {
      const reqParams = {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: outboundPrompt }],
        ...(useNewSession
          ? { _meta: { 'com.google.antigravity/message': { target: 'new' } } }
          : {}),
      };
      await app.sendMessage(reqParams as Parameters<typeof app.sendMessage>[0]);
      if (useNewSession) {
        startBackgroundRefreshWatch(baselineStamp);
      } else {
        if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
        analyzeResetTimer = setTimeout(() => {
          analyzeResetTimer = undefined;
          dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
        }, 2500);
      }
    } catch (err) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: { running: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
    return;
  }

  if (msg.type === 'dispatchDirectives') {
    if (!currentWorktreePath || !app.getHostCapabilities()?.message) return;
    const useNewSession = msg.agentTarget === 'new';
    const fullPrompt = [
      `请处理我在仓库 \`${currentWorktreePath}\` 的 CodeAtlas 画布上提交的全部待办评审批注（代码疑问 / 修改要求 / 架构约束）：`,
      `1. 调用 \`atlas_fetch_directives\`（\`worktreePath: "${currentWorktreePath}"\`，\`claim: true\`，\`agentId: "antigravity"\`）获取所有待处理批注。`,
      `2. 逐条阅读对应文件与行号的真实源码：`,
      `   - 对 \`question\`（代码疑问）：在对话中给出清晰解答，并调用 \`atlas_ack_directive\` 将精炼解答写入 \`summary\`；`,
      `   - 对 \`rework\`（修改要求）：先完成真实代码修改，再调用 \`atlas_ack_directive\` 结项；`,
      `   - 对 \`constraint\`（架构约束）：确认代码符合约束后调用 \`atlas_ack_directive\` 记录确认结论（或同步写入 manifest \`guardrails\`）。`,
      `3. 全部处理完毕后调用 \`open_atlas\`（\`worktreePath: "${currentWorktreePath}"\`）刷新画布状态。`,
    ].join('\n');

    let outboundPrompt = fullPrompt;
    if (!useNewSession && Boolean(app.getHostCapabilities()?.updateModelContext)) {
      try {
        await app.updateModelContext({
          content: [
            {
              type: 'text',
              text: `[CodeAtlas Batch Directives Context]\nworktreePath: "${currentWorktreePath}"\nInstructions:\n${fullPrompt}`,
            },
          ],
        });
        outboundPrompt = `请处理我在仓库 \`${currentWorktreePath}\` 的 CodeAtlas 画布上挂接的全部待办批注，并在完成后刷新画布。`;
      } catch {
        outboundPrompt = fullPrompt;
      }
    }

    const baselineStamp = lastKnownStateStamp;
    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: {
        running: true,
        label: useNewSession
          ? '已在独立后台会话批量处理批注，完成后自动刷新画布...'
          : '已将画布待办批注批量发送至当前会话...',
      },
    });
    try {
      const reqParams = {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: outboundPrompt }],
        ...(useNewSession
          ? { _meta: { 'com.google.antigravity/message': { target: 'new' } } }
          : {}),
      };
      await app.sendMessage(reqParams as Parameters<typeof app.sendMessage>[0]);
      if (useNewSession) {
        startBackgroundRefreshWatch(baselineStamp);
      } else {
        if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
        analyzeResetTimer = setTimeout(() => {
          analyzeResetTimer = undefined;
          dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
        }, 2500);
      }
    } catch (err) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: { running: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
