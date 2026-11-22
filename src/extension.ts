import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import {
  getBranchCommits,
  getDiffStats,
  getFileDiff,
  getGitContext,
  getGitStateDir,
  listTrackedFiles,
  readFileAtRef,
} from './core/git.js';
import {
  exportManifestDraft,
  loadAtlasManifestResult,
  switchRepoStorageMode,
  verifyManifest,
} from './core/manifest.js';
import { analyzeRepositoryArchitecture } from './core/indexer.js';
import { enrichArchitectureWithWorkspace, scanScopeExternalEdges } from './core/workspace.js';
import { verifyBriefing } from './core/verifier.js';
import { formatDirectivesForAgent } from './core/directives.js';
import {
  buildAnalyzeBranchPrompt,
  buildAnalyzeModulePrompt,
  buildInitManifestPrompt,
  buildMcpConfigJson,
} from './core/agentBridge.js';
import { buildAtlasGraph, CanvasViewMode } from './core/graph.js';
import {
  clearAllDirectives,
  createDirective,
  deleteDirective,
  listDirectives,
  listStoredBriefings,
  loadAllOutlines,
  loadRepoConfig,
  StoredBriefingRecord,
} from './core/store.js';
import {
  AnalyzerConfig,
  AnalyzerProvider,
  runClickToAnalyze,
  runClickToOutline,
  runDirectiveQuestion,
} from './core/runner.js';
import { analyzeWorkspaceIndirectImpact } from './lsp/impactProvider.js';
import {
  AnalysisDepth,
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
  IndirectImpactReport,
  ManifestDriftIssue,
  StorageMode,
} from './core/types.js';
import { getCockpitHtml } from './webview/html.js';
import { getCanvasHtml } from './webview/canvasHtml.js';

const LEGACY_DIRECTIVES_KEY = 'codeatlas.directives.v1';

interface DiscoveredBriefing {
  label: string;
  path: string;
}

class CodeAtlasCockpitProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeatlas.cockpit';

  private view?: vscode.WebviewView;
  private canvasPanel?: vscode.WebviewPanel;
  private lastVerification?: BriefingVerificationResult;
  private lastBriefingDepth?: 'flow' | 'deep';
  private lastBriefingScopePath?: string;
  private lastIndirectImpact?: IndirectImpactReport;
  private activeBriefingPath = '';
  private baseRef = '';
  private scopeRoot = '';
  private viewMode: CanvasViewMode = 'hybrid';
  private didAutoDiscover = false;
  private didMigrate = false;
  private expandedDomainIds = new Set<string>();
  private expandedFolderIds = new Set<string>();
  private pruneUnchanged = false;
  private showSupportAssets = false;
  private lang: 'zh' | 'en' = 'zh';
  private isAnalyzing = false;
  private stateWatcher?: vscode.FileSystemWatcher;
  private watcherDebounce?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    const nonce = crypto.randomBytes(16).toString('hex');
    webviewView.webview.html = getCockpitHtml(nonce);
    this.bindWebviewMessages(webviewView.webview);
  }

  public openCanvas(): void {
    if (this.canvasPanel) {
      this.canvasPanel.reveal(vscode.ViewColumn.One);
      void this.pushState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codeatlas.canvas',
      'CodeAtlas Canvas',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.html = getCanvasHtml(nonce);
    this.canvasPanel = panel;

    panel.onDidDispose(() => {
      if (this.canvasPanel === panel) {
        this.canvasPanel = undefined;
      }
    });

    this.bindWebviewMessages(panel.webview);
  }

  public async initManifestDraft(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('CodeAtlas: 请先打开一个 Git 仓库工作区。');
      return;
    }
    try {
      const git = await getGitContext(workspaceRoot);
      const tracked = await listTrackedFiles(git.repoRoot);
      const arch = analyzeRepositoryArchitecture(tracked, undefined, this.lang);
      await enrichArchitectureWithWorkspace(git.repoRoot, arch);
      const cfg = await loadRepoConfig(git.repoRoot);

      const written = await exportManifestDraft(git.repoRoot, arch, true, cfg.storageMode);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(written));
      await vscode.window.showTextDocument(doc);
      await this.pushState();
      vscode.window.showInformationMessage(
        cfg.storageMode === 'git-hidden'
          ? 'CodeAtlas: 已保存骨架至 .git/codeatlas/manifest.json（零入侵模式）。'
          : 'CodeAtlas: 已生成 .atlas/manifest.json 草稿。'
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas 生成 manifest 失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public dispose(): void {
    this.stateWatcher?.dispose();
    if (this.watcherDebounce) clearTimeout(this.watcherDebounce);
  }

  private async ensureStateWatcher(repoRoot: string): Promise<void> {
    if (this.stateWatcher) return;
    try {
      const stateDir = await getGitStateDir(repoRoot);
      await fs.mkdir(stateDir, { recursive: true });
      const pattern = new vscode.RelativePattern(vscode.Uri.file(stateDir), '**/*.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const schedule = () => {
        if (this.watcherDebounce) clearTimeout(this.watcherDebounce);
        this.watcherDebounce = setTimeout(() => {
          void this.pushState();
        }, 150);
      };
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      this.stateWatcher = watcher;
      this.context.subscriptions.push(watcher);
    } catch {
      // non-git or watcher unavailable
    }
  }

  private async migrateLegacyDirectivesOnce(repoRoot: string): Promise<void> {
    if (this.didMigrate) return;
    this.didMigrate = true;
    const legacy = this.context.workspaceState.get<AnnotationDirective[]>(
      LEGACY_DIRECTIVES_KEY,
      []
    );
    if (!legacy || legacy.length === 0) return;

    for (const d of legacy) {
      await createDirective(repoRoot, {
        id: d.id,
        ref: d.ref || 'WORKTREE',
        path: d.path,
        startLine: d.startLine,
        endLine: d.endLine,
        targetNodeId: d.targetNodeId,
        kind: d.kind,
        note: d.note,
        createdAt: d.createdAt,
      });
    }
    await this.context.workspaceState.update(LEGACY_DIRECTIVES_KEY, undefined);
  }

  private bindWebviewMessages(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          await this.pushState();
          break;
        case 'openCanvas':
          this.openCanvas();
          break;
        case 'setMode':
          if (msg.mode === 'atlas' || msg.mode === 'briefing' || msg.mode === 'hybrid') {
            this.viewMode = msg.mode;
            await this.pushState();
          }
          break;
        case 'setBaseRef':
          if (typeof msg.baseRef === 'string' && msg.baseRef) {
            this.baseRef = msg.baseRef;
            this.lastIndirectImpact = undefined;
            await this.pushState();
          }
          break;
        case 'setLang':
          if (msg.lang === 'zh' || msg.lang === 'en') {
            this.lang = msg.lang;
            await this.pushState();
          }
          break;
        case 'toggleDomainFiles':
          if (typeof msg.domainId === 'string' && msg.domainId) {
            if (this.expandedDomainIds.has(msg.domainId)) {
              this.expandedDomainIds.delete(msg.domainId);
            } else {
              this.expandedDomainIds.add(msg.domainId);
            }
            await this.pushState();
          }
          break;
        case 'toggleFolderFiles':
          if (typeof msg.folderId === 'string' && msg.folderId) {
            if (this.expandedFolderIds.has(msg.folderId)) {
              this.expandedFolderIds.delete(msg.folderId);
            } else {
              this.expandedFolderIds.add(msg.folderId);
            }
            await this.pushState();
          }
          break;
        case 'toggleSupportAssets':
          this.showSupportAssets = !this.showSupportAssets;
          await this.pushState();
          break;
        case 'initManifestDraft':
          await this.initManifestDraft();
          break;
        case 'expandDomainFiles':
          if (typeof msg.domainId === 'string' && msg.domainId) {
            this.expandedDomainIds.add(msg.domainId);
            await this.pushState();
          }
          break;
        case 'expandAllFiles':
          if (Array.isArray(msg.domainIds)) {
            for (const id of msg.domainIds) {
              if (typeof id === 'string') this.expandedDomainIds.add(id);
            }
            await this.pushState();
          }
          break;
        case 'collapseAllFiles':
          this.expandedDomainIds.clear();
          this.expandedFolderIds.clear();
          await this.pushState();
          break;
        case 'setPruneUnchanged':
          this.pruneUnchanged = Boolean(msg.value);
          await this.pushState();
          break;
        case 'runImpactAnalysis':
          await this.runIndirectImpactAnalysis();
          break;
        case 'selectBriefing':
          if (typeof msg.path === 'string' && msg.path) {
            await this.verifyBriefingFile(msg.path);
          }
          break;
        case 'refresh':
          if (typeof msg.baseRef === 'string' && msg.baseRef) {
            this.baseRef = msg.baseRef;
          }
          if (this.activeBriefingPath) {
            await this.verifyBriefingFile(this.activeBriefingPath, true);
          } else {
            await this.pushState();
          }
          break;
        case 'pickBriefing':
          await this.pickAndVerifyBriefing();
          break;
        case 'openFile':
          await this.openWorkspaceFile(msg.path, msg.line);
          break;
        case 'requestSnippet':
          await this.sendCodeSnippet(webview, msg);
          break;
        case 'requestDiff':
          await this.sendFileDiff(webview, msg);
          break;
        case 'addDirective':
          await this.addDirective(msg);
          break;
        case 'removeDirective':
          await this.removeDirective(msg.id);
          break;
        case 'clearDirectives':
          await this.clearDirectives();
          break;
        case 'copyDirectives':
          await this.copyDirectivesToClipboard();
          break;
        case 'copyMcpConfig':
          await this.copyMcpConfigToClipboard();
          break;
        case 'copyBranchPrompt':
          await this.copyBranchPromptToClipboard();
          break;
        case 'copyManifestPrompt':
          await this.copyManifestPromptToClipboard();
          break;
        case 'copyNodePrompt':
          await this.copyNodePromptToClipboard(msg);
          break;
        case 'setScopeRoot':
          this.scopeRoot =
            typeof msg.scopeRoot === 'string'
              ? msg.scopeRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
              : '';
          if (this.scopeRoot === '(root)' || this.scopeRoot === '.') this.scopeRoot = '';
          this.expandedDomainIds.clear();
          this.expandedFolderIds.clear();
          await this.pushState();
          break;
        case 'setStorageMode':
          if (
            msg.storageMode === 'git-hidden' ||
            msg.storageMode === 'worktree-excluded' ||
            msg.storageMode === 'worktree-tracked'
          ) {
            const ws = this.getWorkspaceRoot();
            if (ws) {
              const gitCtx = await getGitContext(ws);
              await switchRepoStorageMode(gitCtx.repoRoot, msg.storageMode as StorageMode);
              await this.pushState();
            }
          }
          break;
        case 'askAgentNow':
          await this.handleAskAgentNow(msg);
          break;
        case 'dispatchDirectives':
          await this.handleDispatchDirectives();
          break;
        case 'analyzeTarget':
          await this.handleAnalyzeTarget(msg);
          break;
      }
    });
  }

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async runIndirectImpactAnalysis(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const effectiveBase = this.baseRef || gitCtx.recentRefs[0] || 'HEAD';
      const [diffStats, manifestRes] = await Promise.all([
        getDiffStats(gitCtx.repoRoot, effectiveBase),
        loadAtlasManifestResult(gitCtx.repoRoot),
      ]);
      const manifest = manifestRes.status === 'ok' ? manifestRes.manifest : undefined;

      this.lastIndirectImpact = await analyzeWorkspaceIndirectImpact({
        gitCtx,
        baseRef: effectiveBase,
        targetRef: this.lastVerification?.targetRefClaimed ?? 'WORKTREE',
        resolvedTargetSha: this.lastVerification?.resolvedTargetSha,
        diffStats,
        manifest,
      });

      await this.pushState();
      if (this.lastIndirectImpact.status === 'ok') {
        const refCnt = this.lastIndirectImpact.lspReferences.length;
        const errCnt = this.lastIndirectImpact.lspDiagnostics.length;
        vscode.window.showInformationMessage(
          `CodeAtlas 影响面分析完成：${refCnt} 处符号调用影响，${errCnt} 处未改文件报错。`
        );
      } else if (this.lastIndirectImpact.reason) {
        vscode.window.showInformationMessage(
          `CodeAtlas 影响面分析已跳过：${this.lastIndirectImpact.reason}`
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas 影响面分析失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async isValidBriefingFile(filePath: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BriefingReport & StoredBriefingRecord>;
      const target = parsed?.briefing ?? parsed;
      return (
        (target?.schemaVersion === '0.1' || target?.schemaVersion === '0.2') &&
        Array.isArray(target?.claims)
      );
    } catch {
      return false;
    }
  }

  private async discoverBriefings(repoRoot: string): Promise<DiscoveredBriefing[]> {
    const candidates: DiscoveredBriefing[] = [];
    // 1. MCP-submitted briefings inside <git-dir>/codeatlas/briefings/
    const stored = await listStoredBriefings(repoRoot);
    candidates.push(...stored);

    // 2. Workspace examples & root briefing.json
    const dirs = [path.join(repoRoot, 'examples')];
    for (const dir of dirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.json')) {
            const fullPath = path.join(dir, entry.name);
            if (await this.isValidBriefingFile(fullPath)) {
              const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
              candidates.push({ label: rel, path: fullPath });
            }
          }
        }
      } catch {
        // ignore
      }
    }
    const rootBriefing = path.join(repoRoot, 'briefing.json');
    if (await this.isValidBriefingFile(rootBriefing)) {
      candidates.unshift({ label: 'briefing.json', path: rootBriefing });
    }
    return candidates;
  }

  private async verifyBriefingFile(filePath: string, silent = false): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BriefingReport & StoredBriefingRecord>;
      const briefing = (parsed.briefing ?? parsed) as BriefingReport;
      if (!briefing || !Array.isArray(briefing.claims)) {
        throw new Error('JSON does not match CodeAtlas Briefing v0.1/v0.2 schema.');
      }
      const gitCtx = await getGitContext(workspaceRoot);
      this.lastVerification = await verifyBriefing(gitCtx.repoRoot, briefing, filePath);
      this.lastBriefingDepth = briefing.depth;
      this.lastBriefingScopePath = briefing.scopePath;
      this.activeBriefingPath = filePath;
      await this.pushState();
      if (!silent) {
        vscode.window.showInformationMessage(
          `CodeAtlas verified "${briefing.title}": ${this.lastVerification.overallBadge.toUpperCase()}`
        );
      }
    } catch (err) {
      if (!silent) {
        vscode.window.showErrorMessage(
          `CodeAtlas failed to verify briefing: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private async sendCodeSnippet(
    webview: vscode.Webview,
    msg: {
      nodeId: string;
      path: string;
      startLine?: number;
      endLine?: number;
      fromBriefing?: boolean;
    }
  ): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !msg.path) {
      await webview.postMessage({
        type: 'snippet',
        payload: { nodeId: msg.nodeId, lines: [], error: 'No workspace or file path.' },
      });
      return;
    }
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const targetRef =
        msg.fromBriefing && this.lastVerification?.targetRefClaimed
          ? this.lastVerification.targetRefClaimed
          : 'WORKTREE';
      const content = await readFileAtRef(gitCtx.repoRoot, msg.path, targetRef);
      if (content === undefined) {
        await webview.postMessage({
          type: 'snippet',
          payload: {
            nodeId: msg.nodeId,
            lines: [],
            refUsed: targetRef,
            error: `File "${msg.path}" not found at ref "${targetRef}".`,
          },
        });
        return;
      }
      const allLines = content.split(/\r?\n/);
      const start = Math.max(1, (msg.startLine ?? 1) - 4);
      const end = Math.min(allLines.length, (msg.endLine ?? msg.startLine ?? 1) + 8);
      const hlStart = msg.startLine ?? 1;
      const hlEnd = msg.endLine ?? hlStart;

      const lines = [];
      for (let i = start; i <= end; i++) {
        lines.push({
          num: i,
          text: allLines[i - 1] ?? '',
          highlight: i >= hlStart && i <= hlEnd,
        });
      }
      await webview.postMessage({
        type: 'snippet',
        payload: { nodeId: msg.nodeId, lines, refUsed: targetRef },
      });
    } catch (err) {
      await webview.postMessage({
        type: 'snippet',
        payload: {
          nodeId: msg.nodeId,
          lines: [],
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async sendFileDiff(
    webview: vscode.Webview,
    msg: { nodeId: string; path: string }
  ): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !msg.path) {
      await webview.postMessage({
        type: 'fileDiff',
        payload: { nodeId: msg.nodeId, diff: '' },
      });
      return;
    }
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const effectiveBase = this.baseRef || gitCtx.recentRefs[0] || 'HEAD';
      const diff = await getFileDiff(gitCtx.repoRoot, msg.path, effectiveBase);
      await webview.postMessage({
        type: 'fileDiff',
        payload: { nodeId: msg.nodeId, diff },
      });
    } catch {
      await webview.postMessage({
        type: 'fileDiff',
        payload: { nodeId: msg.nodeId, diff: '' },
      });
    }
  }

  public async pickAndVerifyBriefing(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('CodeAtlas: Open a workspace folder first.');
      return;
    }

    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.Uri.file(workspaceRoot),
      filters: { 'CodeAtlas Briefing JSON': ['json'] },
      openLabel: 'Verify Briefing',
    });
    if (!picked || picked.length === 0) return;
    await this.verifyBriefingFile(picked[0].fsPath);
  }

  private async openWorkspaceFile(relPath: string, line = 1): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !relPath) return;

    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const fullPath = path.join(gitCtx.repoRoot, relPath);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: this.canvasPanel ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        preview: false,
      });
      const targetLine = Math.max(0, Math.min(line - 1, doc.lineCount - 1));
      const range = new vscode.Range(targetLine, 0, targetLine, 0);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas cannot open ${relPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async addDirective(msg: {
    kind: 'constraint' | 'question' | 'rework';
    path: string;
    startLine?: number;
    targetNodeId?: string;
    note: string;
  }): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      await createDirective(gitCtx.repoRoot, {
        ref: gitCtx.headSha || 'WORKTREE',
        path: msg.path,
        startLine: msg.startLine,
        targetNodeId: msg.targetNodeId,
        kind: msg.kind,
        note: msg.note,
      });
      await this.pushState();
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas failed to save directive: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async removeDirective(id: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      await deleteDirective(gitCtx.repoRoot, id);
      await this.pushState();
    } catch {
      // ignore
    }
  }

  private async clearDirectives(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      await clearAllDirectives(gitCtx.repoRoot);
      await this.pushState();
    } catch {
      // ignore
    }
  }

  private async copyDirectivesToClipboard(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot() ?? '';
    let targetRef = 'WORKTREE';
    let repoRoot = workspaceRoot;
    let directives: AnnotationDirective[] = [];
    if (workspaceRoot) {
      try {
        const gitCtx = await getGitContext(workspaceRoot);
        repoRoot = gitCtx.repoRoot;
        targetRef = gitCtx.headSha || 'WORKTREE';
        directives = await listDirectives(gitCtx.repoRoot, false);
      } catch {
        // fallback
      }
    }
    const md = formatDirectivesForAgent(repoRoot, targetRef, directives);
    await vscode.env.clipboard.writeText(md);
    vscode.window.showInformationMessage('CodeAtlas directives copied to clipboard as Markdown.');
  }

  private async copyMcpConfigToClipboard(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    let repoRoot = workspaceRoot;
    try {
      repoRoot = (await getGitContext(workspaceRoot)).repoRoot;
    } catch {
      // fallback
    }
    const mcpPath = path.join(this.context.extensionPath, 'dist', 'mcp-server.js');
    const json = buildMcpConfigJson(mcpPath, repoRoot);
    await vscode.env.clipboard.writeText(json);
    vscode.window.showInformationMessage(
      this.lang === 'zh'
        ? '已复制 CodeAtlas MCP 配置 JSON，可直接粘贴到你的 Coding Agent 配置中。'
        : 'Copied CodeAtlas MCP config JSON to clipboard.'
    );
  }

  private async copyBranchPromptToClipboard(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const git = await getGitContext(workspaceRoot);
      const effectiveBase = this.baseRef || git.recentRefs[0] || 'HEAD';
      const prompt = buildAnalyzeBranchPrompt({
        repoRoot: git.repoRoot,
        branch: git.branch,
        baseRef: effectiveBase,
        lang: this.lang,
      });
      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage(
        this.lang === 'zh'
          ? '已复制「分析当前分支 Diff 并提交简报」Agent Prompt。'
          : 'Copied branch-analysis Agent prompt to clipboard.'
      );
    } catch {
      // ignore
    }
  }

  private async copyManifestPromptToClipboard(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    let repoRoot = workspaceRoot;
    try {
      repoRoot = (await getGitContext(workspaceRoot)).repoRoot;
    } catch {
      // fallback
    }
    const prompt = buildInitManifestPrompt({ repoRoot, lang: this.lang });
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage(
      this.lang === 'zh'
        ? '已复制「生成/完善 .atlas/manifest.json 架构骨架」Agent Prompt。'
        : 'Copied .atlas/manifest.json authoring prompt to clipboard.'
    );
  }

  private async copyNodePromptToClipboard(msg: {
    title?: string;
    kind?: string;
    path?: string;
  }): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const git = await getGitContext(workspaceRoot);
      const effectiveBase = this.baseRef || git.recentRefs[0] || 'HEAD';
      const prompt = buildAnalyzeModulePrompt({
        repoRoot: git.repoRoot,
        branch: git.branch,
        baseRef: effectiveBase,
        nodeTitle: msg.title || 'Selected Module',
        nodeKind: msg.kind || 'module',
        nodePath: msg.path,
        lang: this.lang,
      });
      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage(
        this.lang === 'zh'
          ? `已复制分析「${msg.title || '当前节点'}」的 Agent Prompt，粘贴给 Agent 即可自动回传画布。`
          : `Copied Agent analysis prompt for "${msg.title || 'node'}".`
      );
    } catch {
      // ignore
    }
  }

  private broadcastAnalyzeStatus(payload: {
    running: boolean;
    label?: string;
    error?: string;
  }): void {
    const message = { type: 'analyzeStatus', payload };
    void this.view?.webview.postMessage(message);
    void this.canvasPanel?.webview.postMessage(message);
  }

  private readAnalyzerConfig(): AnalyzerConfig {
    const cfg = vscode.workspace.getConfiguration('codeatlas.analyzer');
    const rawProvider = cfg.get<string>('provider', 'cli-codex');
    const validProviders: AnalyzerProvider[] = [
      'cli-codex',
      'cli-claude',
      'cli-gemini',
      'openai-compatible',
    ];
    const provider: AnalyzerProvider = validProviders.includes(rawProvider as AnalyzerProvider)
      ? (rawProvider as AnalyzerProvider)
      : 'cli-codex';

    return {
      provider,
      apiBaseUrl: cfg.get<string>('apiBaseUrl', 'https://api.openai.com/v1'),
      apiKey: cfg.get<string>('apiKey', ''),
      model: cfg.get<string>('model', 'gpt-4.1'),
      cliCommand: cfg.get<string>('cliCommand', ''),
    };
  }

  private async handleAskAgentNow(msg: {
    directiveKind?: 'constraint' | 'question' | 'rework';
    path?: string;
    startLine?: number;
    targetNodeId?: string;
    title?: string;
    contextBody?: string;
    note?: string;
  }): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !msg.note?.trim()) return;

    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const kind = msg.directiveKind || 'question';
      const dirPath = (msg.path || this.scopeRoot || '').trim();
      const created = await createDirective(gitCtx.repoRoot, {
        ref: gitCtx.headSha || 'WORKTREE',
        path: dirPath || '(root)',
        startLine: msg.startLine,
        targetNodeId: msg.targetNodeId,
        kind,
        note: msg.note.trim(),
      });
      await this.pushState();

      if (kind === 'question' && !this.isAnalyzing) {
        this.isAnalyzing = true;
        this.broadcastAnalyzeStatus({
          running: true,
          label: this.lang === 'zh' ? '正在解答锚点提问...' : 'Answering anchored question...',
        });
        try {
          const config = this.readAnalyzerConfig();
          await runDirectiveQuestion({
            repoRoot: gitCtx.repoRoot,
            directive: created,
            config,
            lang: this.lang,
          });
          this.broadcastAnalyzeStatus({ running: false });
          await this.pushState();
          return;
        } catch {
          this.broadcastAnalyzeStatus({ running: false });
          // Fallback to opening IDE Chat / Clipboard if local runner CLI/API is not configured
        } finally {
          this.isAnalyzing = false;
        }
      }

      const md = formatDirectivesForAgent(gitCtx.repoRoot, gitCtx.headSha || 'WORKTREE', [created]);
      await vscode.env.clipboard.writeText(md);
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: md });
      } catch {
        vscode.window.showInformationMessage(
          this.lang === 'zh'
            ? '已保存批注并复制 Agent 指令至剪贴板，可直接粘贴至对话面板。'
            : 'Saved directive and copied prompt to clipboard.'
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas 提问派发失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleDispatchDirectives(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const openDirs = await listDirectives(gitCtx.repoRoot, false);
      if (openDirs.length === 0) return;
      const md = formatDirectivesForAgent(gitCtx.repoRoot, gitCtx.headSha || 'WORKTREE', openDirs);
      await vscode.env.clipboard.writeText(md);
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: md });
      } catch {
        vscode.window.showInformationMessage(
          this.lang === 'zh'
            ? `已复制全部 ${openDirs.length} 条待处理批注至剪贴板，请粘贴至 Agent 对话面板。`
            : `Copied ${openDirs.length} open directives to clipboard.`
        );
      }
    } catch {
      // ignore
    }
  }

  private async handleAnalyzeTarget(msg: {
    scope?: 'branch' | 'node';
    depth?: AnalysisDepth;
    scopeRoot?: string;
    nodeId?: string;
    title?: string;
    kind?: string;
    path?: string;
    baseRef?: string;
  }): Promise<void> {
    if (this.isAnalyzing) return;

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage(
        this.lang === 'zh'
          ? 'CodeAtlas: 请先打开一个 Git 仓库工作区。'
          : 'CodeAtlas: Open a Git repository workspace first.'
      );
      return;
    }

    this.isAnalyzing = true;
    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const scope: 'branch' | 'node' = msg.scope === 'node' ? 'node' : 'branch';
      const depth: AnalysisDepth =
        msg.depth === 'overview' || msg.depth === 'flow' || msg.depth === 'deep'
          ? msg.depth
          : scope === 'node'
            ? 'overview'
            : 'deep';
      const effectiveBase =
        typeof msg.baseRef === 'string' && msg.baseRef
          ? msg.baseRef
          : this.baseRef || gitCtx.recentRefs[0] || 'HEAD';
      const targetPath = msg.path ?? msg.scopeRoot ?? this.scopeRoot;
      const baseLabel =
        scope === 'node'
          ? msg.title || targetPath || 'Node'
          : `branch (${effectiveBase})`;

      this.broadcastAnalyzeStatus({ running: true, label: `${baseLabel} [${depth.toUpperCase()}]` });

      const config = this.readAnalyzerConfig();

      if (depth === 'overview') {
        const outlineRec = await runClickToOutline({
          repoRoot: gitCtx.repoRoot,
          scope: 'node',
          depth: 'overview',
          baseRef: effectiveBase,
          nodeTitle: msg.title,
          nodeKind: msg.kind,
          nodePath: targetPath,
          lang: this.lang,
          config,
        });
        // Auto-expand matching domain
        const tracked = await listTrackedFiles(gitCtx.repoRoot);
        const manifestRes = await loadAtlasManifestResult(gitCtx.repoRoot);
        const arch = analyzeRepositoryArchitecture(
          tracked,
          manifestRes.status === 'ok' ? manifestRes.manifest : undefined,
          this.lang
        );
        const sc = outlineRec.outline.scopePath;
        for (const d of arch.domains) {
          const dp = (d.paths[0] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
          if (sc && (dp === sc || sc.startsWith(`${dp}/`))) {
            this.expandedDomainIds.add(d.id);
          }
        }
        this.broadcastAnalyzeStatus({ running: false });
        await this.pushState();
        vscode.window.showInformationMessage(
          this.lang === 'zh'
            ? `CodeAtlas 已回填「${outlineRec.outline.title}」及 ${outlineRec.outline.children.length} 个文件的职责导览。`
            : `CodeAtlas hydrated role overview for "${outlineRec.outline.title}".`
        );
        return;
      }

      const record = await runClickToAnalyze({
        repoRoot: gitCtx.repoRoot,
        scope,
        depth,
        baseRef: effectiveBase,
        nodeTitle: msg.title,
        nodeKind: msg.kind,
        nodePath: targetPath,
        lang: this.lang,
        config,
        onProgress: (stage) => {
          if (stage === 'retrying') {
            this.broadcastAnalyzeStatus({
              running: true,
              label:
                this.lang === 'zh'
                  ? `${baseLabel}（自纠重验中...）`
                  : `${baseLabel} (self-correcting...)`,
            });
          }
        },
      });

      this.lastVerification = record.verification;
      this.lastBriefingDepth = record.briefing.depth;
      this.lastBriefingScopePath = record.briefing.scopePath;
      this.activeBriefingPath = record.filePath;
      this.broadcastAnalyzeStatus({ running: false });
      await this.pushState();

      const badgeText = record.verification.overallBadge.toUpperCase();
      vscode.window.showInformationMessage(
        this.lang === 'zh'
          ? `CodeAtlas 已生成并核验简报「${record.briefing.title}」: ${badgeText}`
          : `CodeAtlas generated & verified "${record.briefing.title}": ${badgeText}`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.broadcastAnalyzeStatus({ running: false, error: errMsg });

      const needsSettingsHint =
        /apikey|spawn|enoent|not recognized|not found|command/i.test(errMsg);
      const hint = needsSettingsHint
        ? this.lang === 'zh'
          ? '（可在 VS Code 设置中配置 codeatlas.analyzer.*）'
          : ' (Configure codeatlas.analyzer.* in VS Code Settings)'
        : '';
      const openSettingsBtn = this.lang === 'zh' ? '打开设置' : 'Open Settings';
      const picked = await vscode.window.showErrorMessage(
        `CodeAtlas 分析失败: ${errMsg}${hint}`,
        ...(needsSettingsHint ? [openSettingsBtn] : [])
      );
      if (picked === openSettingsBtn) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'codeatlas.analyzer');
      }
    } finally {
      this.isAnalyzing = false;
    }
  }

  private postEmptyOrErrorState(errorMsg?: string): void {
    this.view?.webview.postMessage({
      type: 'state',
      payload: {
        git: null,
        baseRef: this.baseRef || 'HEAD',
        diffStats: [],
        manifest: null,
        verification: this.lastVerification ?? null,
        directives: [],
        error: errorMsg,
      },
    });
    this.canvasPanel?.webview.postMessage({
      type: 'canvasState',
      payload: {
        git: null,
        baseRef: this.baseRef || 'HEAD',
        graph: { mode: this.viewMode, nodes: [], edges: [], summary: {} },
        availableBriefings: [],
        activeBriefingPath: '',
        error: errorMsg,
        lang: this.lang,
      },
    });
  }

  public async pushState(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.postEmptyOrErrorState('Open a folder containing a Git repository.');
      return;
    }

    try {
      const git = await getGitContext(workspaceRoot);
      await this.migrateLegacyDirectivesOnce(git.repoRoot);
      await this.ensureStateWatcher(git.repoRoot);

      if (!this.baseRef || !git.recentRefs.includes(this.baseRef)) {
        this.baseRef = git.recentRefs[0] || 'HEAD';
      }

      const availableBriefings = await this.discoverBriefings(git.repoRoot);
      if (!this.didAutoDiscover && !this.lastVerification && availableBriefings.length > 0) {
        this.didAutoDiscover = true;
        await this.verifyBriefingFile(availableBriefings[0].path, true);
        return;
      }

      const [diffStats, manifestRes, trackedFiles, commits, directives, repoCfg, outlines] =
        await Promise.all([
          getDiffStats(git.repoRoot, this.baseRef),
          loadAtlasManifestResult(git.repoRoot),
          listTrackedFiles(git.repoRoot),
          getBranchCommits(git.repoRoot, this.baseRef),
          listDirectives(git.repoRoot, true),
          loadRepoConfig(git.repoRoot),
          loadAllOutlines(git.repoRoot),
        ]);

      const manifest = manifestRes.status === 'ok' ? manifestRes.manifest : undefined;
      let manifestIssues: ManifestDriftIssue[] = [];
      if (manifestRes.status === 'invalid') {
        manifestIssues = manifestRes.errors.map((e) => ({
          severity: 'error',
          domainId: '(manifest)',
          field: 'path',
          target: 'manifest.json',
          message: e,
        }));
      } else if (manifest) {
        const ver = await verifyManifest(git.repoRoot, manifest);
        manifestIssues = ver.issues;
      }

      this.view?.webview.postMessage({
        type: 'state',
        payload: {
          git,
          baseRef: this.baseRef,
          diffStats,
          manifest: manifest ?? null,
          verification: this.lastVerification ?? null,
          directives,
          lang: this.lang,
        },
      });

      if (this.canvasPanel) {
        const arch = analyzeRepositoryArchitecture(trackedFiles, manifest, this.lang);
        await enrichArchitectureWithWorkspace(git.repoRoot, arch);
        const scopeBoundaries = this.scopeRoot
          ? await scanScopeExternalEdges(git.repoRoot, trackedFiles, this.scopeRoot, arch)
          : [];
        const graph = buildAtlasGraph({
          git,
          manifest,
          manifestIssues,
          archOverride: arch,
          hasManifest: manifestRes.status === 'ok',
          storageMode: repoCfg.storageMode,
          scopeRoot: this.scopeRoot,
          outlines,
          scopeBoundaries,
          briefingDepth: this.lastBriefingDepth,
          briefingScopePath: this.lastBriefingScopePath,
          diffStats,
          trackedFiles,
          commits,
          verification: this.lastVerification,
          indirectImpact: this.lastIndirectImpact,
          directives,
          mode: this.viewMode,
          baseRef: this.baseRef,
          expandedDomainIds: [...this.expandedDomainIds],
          expandedFolderIds: [...this.expandedFolderIds],
          pruneUnchanged: this.pruneUnchanged,
          showSupportAssets: this.showSupportAssets,
          lang: this.lang,
        });
        this.canvasPanel.webview.postMessage({
          type: 'canvasState',
          payload: {
            git,
            baseRef: this.baseRef,
            scopeRoot: this.scopeRoot,
            storageMode: repoCfg.storageMode,
            graph,
            availableBriefings,
            activeBriefingPath: this.activeBriefingPath,
            pruneUnchanged: this.pruneUnchanged,
            showSupportAssets: this.showSupportAssets,
            lang: this.lang,
          },
        });
      }
    } catch (err) {
      this.postEmptyOrErrorState(
        err instanceof Error ? err.message : 'Workspace is not a Git repository.'
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CodeAtlasCockpitProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CodeAtlasCockpitProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand('codeatlas.openCockpit', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeatlas');
      await provider.pushState();
    }),
    vscode.commands.registerCommand('codeatlas.openCanvas', () => {
      provider.openCanvas();
    }),
    vscode.commands.registerCommand('codeatlas.verifyBriefing', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeatlas');
      await provider.pickAndVerifyBriefing();
    }),
    vscode.commands.registerCommand('codeatlas.initManifest', async () => {
      await provider.initManifestDraft();
    }),
    { dispose: () => provider.dispose() }
  );
}

export function deactivate(): void {}
