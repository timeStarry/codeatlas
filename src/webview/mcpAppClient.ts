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
  scopeRoot?: string;
  storageMode?: 'git-hidden' | 'worktree-excluded' | 'worktree-tracked';
  baseRef?: string;
  nodeId?: string;
  title?: string;
  kind?: string;
  path?: string;
  line?: number;
  startLine?: number;
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
    if (depth === 'flow') {
      return [
        `请按 **L2 核心链路级** 分析本地仓库 \`${repoPath}\`${scopeClause} 当前分支相对 \`${baseRef}\` 的主要变更流程：`,
        `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}"\`）读取当前 Git 状态与架构红线。`,
        `2. 检查 \`git diff ${baseRef}\` 与改动文件，仅提炼 3–5 条核心业务/调用链变更声明（\`claims[]\`，附精确 1-based \`path / startLine / endLine / symbol\`），无需穷举行级边角守卫。`,
        `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing: { schemaVersion: "0.2", depth: "flow", scopePath: "${scopeRoot}", baseRef: "${baseRef}", targetRef: "WORKTREE", ... }\`）提交并修正任何 \`MISMATCH\`。`,
        `4. 调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`）刷新画布。`,
      ].join('\n');
    }
    return [
      `请按 **L3 深度核验级** 分析本地仓库 \`${repoPath}\`${scopeClause} 当前分支相对 \`${baseRef}\` 的代码变更并生成确定性核验简报：`,
      `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}"\`）读取当前 Git 状态、架构红线与待处理批注指令。`,
      `2. 检查 \`git diff ${baseRef}\` 与相关真实源码，梳理核心变更声明（\`claims[]\`，附精确 1-based \`path / startLine / endLine / symbol\`）、显式阻断条件（\`blockingConditions[]\`）、跨边界间接影响（\`impacts[]\`）、盲区（\`blindSpots[]\`）与验证信号（\`verificationSignals[]\`）。`,
      `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`schemaVersion: "0.2"\`，\`depth: "deep"\`，\`baseRef: "${baseRef}"\`，\`targetRef: "WORKTREE"\`）提交简报；若返回任何 \`MISMATCH\`，请核对真实源码修正后重提直至通过。`,
      `4. 核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`，\`mode: "hybrid"\`）刷新当前 CodeAtlas 画布面板。`,
    ].join('\n');
  }

  const title = typeof msg.title === 'string' && msg.title ? msg.title : (scopeRoot || '目标目录');
  const kind = typeof msg.kind === 'string' && msg.kind ? msg.kind : 'module';
  const relPath =
    typeof msg.path === 'string' && msg.path ? msg.path : scopeRoot;
  const targetDesc = relPath && relPath !== title ? `${title} (${relPath})` : title;

  if (depth === 'overview') {
    return [
      `请按 **L1 概览导览级（快速轻量）** 梳理本地仓库 \`${repoPath}\` 中的「${targetDesc}」，原地回填模块与各子文件的职责说明：`,
      `1. **控制阅读深度**：只查看「${relPath || '根目录'}」下的目录结构与各源码文件头部导出/核心定义，**不要逐行深抠边角逻辑**。`,
      `2. 调用 \`atlas_submit_outline\`（\`worktreePath: "${repoPath}"\`），提交 \`outline\`（\`schemaVersion: "0.2"\`，\`scopePath: "${relPath}"\`，\`targetRef: "WORKTREE"\`，\`title\`，1–2 句整体职责 \`summary\`，建议优先阅读的入口文件 \`recommendedEntry\`，以及 \`children: [{ path, summary, role }]\` 为该目录下的每个主要文件/子目录写一句 35 字以内的精炼职责说明；所有 \`path\` 必须为仓库真实相对路径）。`,
      `3. 若返回路径失配请立即修正重提；核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`）将职责导览直接刷新回画布节点上。`,
    ].join('\n');
  }

  if (depth === 'flow') {
    return [
      `请按 **L2 调用链路级** 分析本地仓库 \`${repoPath}\` 中的 ${kind}「${targetDesc}」：`,
      `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}"\`）查看上下文。`,
      `2. 阅读「${targetDesc}」内的核心源码文件，聚焦梳理 **3–5 条主干协作流程 / 数据流 / 调用链**（\`claims[]\`，每条附精确 1-based \`path / startLine / endLine / symbol\`），无需罗列琐碎的边角异常分支。`,
      `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing\` 中设 \`schemaVersion: "0.2"\`、\`depth: "flow"\`、\`scopePath: "${relPath}"\`、\`targetRef: "WORKTREE"\`）；若有 \`MISMATCH\` 核对修正后重提。`,
      `4. 核验通过后调用 \`open_atlas\`（\`worktreePath: "${repoPath}"\`，\`mode: "hybrid"\`）刷新画布。`,
    ].join('\n');
  }

  return [
    `请按 **L3 深度边界核验级** 分析本地仓库 \`${repoPath}\` 中的 ${kind}「${targetDesc}」并生成完整核验简报：`,
    `1. 调用 \`atlas_get_context\`（\`worktreePath: "${repoPath}"\`）读取当前 Git 状态、架构红线与待处理批注指令。`,
    `2. 深入阅读「${targetDesc}」的真实源码文件，梳理核心调用链声明（\`claims[]\`，每条附精确 1-based \`path / startLine / endLine / symbol\`）、显式阻断/边界保护条件（\`blockingConditions[]\`）、跨模块耦合影响（\`impacts[]\`）、架构盲区（\`blindSpots[]\`）与验证信号（\`verificationSignals[]\`）。`,
    `3. 调用 \`atlas_submit_briefing\`（\`worktreePath: "${repoPath}"\`，\`briefing\` 设 \`schemaVersion: "0.2"\`、\`depth: "deep"\`、\`scopePath: "${relPath}"\`、\`targetRef: "WORKTREE"\`）；若返回任何 \`MISMATCH\`，核对真实源码修正后重提直至通过。`,
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
      payload: { canAnalyze: Boolean(caps?.message) },
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

  if (msg.type === 'analyzeTarget') {
    if (!currentWorktreePath) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: {
          running: false,
          error: '请先在左上角输入并切换本地 Git 仓库路径 / Load a local Git repository first.',
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
            '当前视图无关联对话上下文，请在对话侧边栏打开 CodeAtlas 后使用一键分析 / No conversation available on this surface.',
        },
      });
      return;
    }

    const label =
      msg.scope === 'branch'
        ? `branch vs ${typeof msg.baseRef === 'string' && msg.baseRef ? msg.baseRef : 'HEAD'}`
        : `${typeof msg.title === 'string' && msg.title ? msg.title : 'module'}${typeof msg.path === 'string' && msg.path ? ` (${msg.path})` : ''}`;

    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: { running: true, label },
    });

    const prompt = buildAnalyzeChatPrompt(msg, currentWorktreePath);
    try {
      const res = await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      });
      if (res.isError) {
        dispatchToCanvas({
          type: 'analyzeStatus',
          payload: {
            running: false,
            error: '宿主拒绝了发送对话消息请求 / Host rejected sendMessage.',
          },
        });
        return;
      }

      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: { running: true, label: `${label} (已发送至对话 Agent / Sent to Agent)` },
      });
      if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
      analyzeResetTimer = setTimeout(() => {
        analyzeResetTimer = undefined;
        dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
      }, 3000);
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
        dispatchToCanvas({ type: 'canvasState', payload: unwrapCanvasState(data) });
      }
    } catch {
      // continue to sendMessage even if directive persistence failed
    }

    if (!app.getHostCapabilities()?.message) return;

    const kindLabel =
      msg.directiveKind === 'rework'
        ? '代码/简报纠偏返工'
        : msg.directiveKind === 'constraint'
          ? '架构约束红线确认'
          : '画布锚点提问';
    const loc = `${msg.path || '(模块级)'}${msg.startLine ? `:${msg.startLine}` : ''}`;
    const ctxLine = msg.contextBody ? `\n- 当前节点内容摘要：${msg.contextBody}` : '';
    const ackLine = createdId
      ? msg.directiveKind === 'rework'
        ? `3. 完成真实代码修改后，调用 \`atlas_ack_directive\`（\`worktreePath: "${currentWorktreePath}"\`，\`id: "${createdId}"\`，\`expectedRevision: ${createdRev}\`，\`agentId: "antigravity"\`，\`summary\` 填写修复说明）并调用 \`open_atlas\` 刷新画布。`
        : `3. 在对话中详细解答后，同步调用 \`atlas_ack_directive\`（\`worktreePath: "${currentWorktreePath}"\`，\`id: "${createdId}"\`，\`expectedRevision: ${createdRev}\`，\`agentId: "antigravity"\`，\`summary\` 填入精炼结论）将解答写回该画布批注节点，并调用 \`open_atlas\` 刷新画布。`
      : `3. 处理完成后调用 \`open_atlas\`（\`worktreePath: "${currentWorktreePath}"\`）刷新画布。`;

    const prompt = [
      `【CodeAtlas ${kindLabel}】针对本地仓库 \`${currentWorktreePath}\` 的节点「${msg.title || loc}」：`,
      `- 绑定位置：\`${loc}\`${ctxLine}`,
      `- 我的问题 / 要求：${msg.note || ''}`,
      ``,
      `请按以下步骤处理：`,
      `1. 阅读 \`${loc}\` 处的真实源码核实情况。`,
      `2. 若我对现有简报结论提出了纠偏，请核实后重提修正版简报；若是返工要求，请直接完成代码修改。`,
      ackLine,
    ].join('\n');

    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: { running: true, label: `正在向 Agent 发送${kindLabel}...` },
    });
    try {
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      });
      if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
      analyzeResetTimer = setTimeout(() => {
        analyzeResetTimer = undefined;
        dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
      }, 2500);
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
    const prompt = [
      `请处理我在仓库 \`${currentWorktreePath}\` 的 CodeAtlas 画布上挂接的全部待办批注（疑问 / 返工 / 约束红线）：`,
      `1. 调用 \`atlas_fetch_directives\`（\`worktreePath: "${currentWorktreePath}"\`，\`claim: true\`，\`agentId: "antigravity"\`）获取所有待处理批注。`,
      `2. 逐条阅读对应文件与行号的真实源码：`,
      `   - 对 \`question\`（疑问）：在对话中给出清晰解答，并调用 \`atlas_ack_directive\` 将精炼解答写入 \`summary\`；`,
      `   - 对 \`rework\`（返工）：先完成真实代码修改，再调用 \`atlas_ack_directive\` 结项；`,
      `   - 对 \`constraint\`（架构红线）：确认代码符合约束后调用 \`atlas_ack_directive\` 记录确认结论（或同步写入 manifest \`guardrails\`）。`,
      `3. 全部处理完毕后调用 \`open_atlas\`（\`worktreePath: "${currentWorktreePath}"\`）刷新画布状态。`,
    ].join('\n');

    dispatchToCanvas({
      type: 'analyzeStatus',
      payload: { running: true, label: '已将画布待办批注批量派发给 Agent...' },
    });
    try {
      await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      });
      if (analyzeResetTimer) clearTimeout(analyzeResetTimer);
      analyzeResetTimer = setTimeout(() => {
        analyzeResetTimer = undefined;
        dispatchToCanvas({ type: 'analyzeStatus', payload: { running: false } });
      }, 2500);
    } catch (err) {
      dispatchToCanvas({
        type: 'analyzeStatus',
        payload: { running: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
