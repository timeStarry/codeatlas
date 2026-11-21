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
  verifyManifest,
} from './core/manifest.js';
import { analyzeRepositoryArchitecture } from './core/indexer.js';
import { enrichArchitectureWithWorkspace } from './core/workspace.js';
import { verifyBriefing } from './core/verifier.js';
import { formatDirectivesForAgent } from './core/directives.js';
import { buildAtlasGraph, CanvasViewMode } from './core/graph.js';
import {
  clearAllDirectives,
  createDirective,
  deleteDirective,
  listDirectives,
  listStoredBriefings,
  StoredBriefingRecord,
} from './core/store.js';
import { analyzeWorkspaceIndirectImpact } from './lsp/impactProvider.js';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
  IndirectImpactReport,
  ManifestDriftIssue,
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
  private lastIndirectImpact?: IndirectImpactReport;
  private activeBriefingPath = '';
  private baseRef = '';
  private viewMode: CanvasViewMode = 'hybrid';
  private didAutoDiscover = false;
  private didMigrate = false;
  private expandedDomainIds = new Set<string>();
  private expandedFolderIds = new Set<string>();
  private pruneUnchanged = false;
  private showSupportAssets = false;
  private lang: 'zh' | 'en' = 'zh';
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

      let overwrite = false;
      const target = path.join(git.repoRoot, '.atlas', 'manifest.json');
      try {
        await fs.access(target);
        const choice = await vscode.window.showWarningMessage(
          '.atlas/manifest.json 已存在，是否覆盖为自动生成的草稿？',
          '覆盖',
          '取消'
        );
        if (choice !== '覆盖') return;
        overwrite = true;
      } catch {
        // does not exist
      }

      const written = await exportManifestDraft(git.repoRoot, arch, overwrite);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(written));
      await vscode.window.showTextDocument(doc);
      await this.pushState();
      vscode.window.showInformationMessage('CodeAtlas: 已生成 .atlas/manifest.json 草稿。');
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

      const [diffStats, manifestRes, trackedFiles, commits, directives] = await Promise.all([
        getDiffStats(git.repoRoot, this.baseRef),
        loadAtlasManifestResult(git.repoRoot),
        listTrackedFiles(git.repoRoot),
        getBranchCommits(git.repoRoot, this.baseRef),
        listDirectives(git.repoRoot, true),
      ]);

      const manifest = manifestRes.status === 'ok' ? manifestRes.manifest : undefined;
      let manifestIssues: ManifestDriftIssue[] = [];
      if (manifestRes.status === 'invalid') {
        manifestIssues = manifestRes.errors.map((e) => ({
          severity: 'error',
          domainId: '(manifest)',
          field: 'path',
          target: '.atlas/manifest.json',
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
        const graph = buildAtlasGraph({
          git,
          manifest,
          manifestIssues,
          archOverride: arch,
          hasManifest: manifestRes.status === 'ok',
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
