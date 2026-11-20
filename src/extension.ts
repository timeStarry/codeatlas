import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import {
  getDiffStats,
  getFileDiff,
  getGitContext,
  listTrackedFiles,
  readFileAtRef,
} from './core/git.js';
import { loadAtlasManifest } from './core/manifest.js';
import { verifyBriefing } from './core/verifier.js';
import { formatDirectivesForAgent } from './core/directives.js';
import { buildAtlasGraph, CanvasViewMode } from './core/graph.js';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
} from './core/types.js';
import { getCockpitHtml } from './webview/html.js';
import { getCanvasHtml } from './webview/canvasHtml.js';

const DIRECTIVES_STORAGE_KEY = 'codeatlas.directives.v1';

interface DiscoveredBriefing {
  label: string;
  path: string;
}

class CodeAtlasCockpitProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeatlas.cockpit';

  private view?: vscode.WebviewView;
  private canvasPanel?: vscode.WebviewPanel;
  private lastVerification?: BriefingVerificationResult;
  private activeBriefingPath = '';
  private baseRef = '';
  private viewMode: CanvasViewMode = 'hybrid';
  private didAutoDiscover = false;

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
            await this.pushState();
          }
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
          await this.context.workspaceState.update(DIRECTIVES_STORAGE_KEY, []);
          await this.pushState();
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

  private getDirectives(): AnnotationDirective[] {
    return this.context.workspaceState.get<AnnotationDirective[]>(
      DIRECTIVES_STORAGE_KEY,
      []
    );
  }

  private async isValidBriefingFile(filePath: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BriefingReport>;
      return parsed?.schemaVersion === '0.1' && Array.isArray(parsed?.claims);
    } catch {
      return false;
    }
  }

  private async discoverBriefings(repoRoot: string): Promise<DiscoveredBriefing[]> {
    const candidates: DiscoveredBriefing[] = [];
    const dirs = [
      path.join(repoRoot, '.codeatlas', 'briefings'),
      path.join(repoRoot, 'examples'),
    ];
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
        // directory may not exist
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
      const briefing = JSON.parse(raw) as BriefingReport;
      if (!briefing || !Array.isArray(briefing.claims)) {
        throw new Error('JSON does not match CodeAtlas Briefing v0.1 schema (missing claims array).');
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
    let ref = 'WORKTREE';
    if (workspaceRoot) {
      try {
        const gitCtx = await getGitContext(workspaceRoot);
        ref = gitCtx.shortSha || 'WORKTREE';
      } catch {
        ref = 'WORKTREE';
      }
    }

    const directives = this.getDirectives();
    directives.push({
      id: crypto.randomBytes(6).toString('hex'),
      createdAt: new Date().toISOString(),
      ref,
      path: msg.path,
      startLine: msg.startLine,
      targetNodeId: msg.targetNodeId,
      kind: msg.kind,
      note: msg.note,
    });
    await this.context.workspaceState.update(DIRECTIVES_STORAGE_KEY, directives);
    await this.pushState();
  }

  private async removeDirective(id: string): Promise<void> {
    const directives = this.getDirectives().filter((d) => d.id !== id);
    await this.context.workspaceState.update(DIRECTIVES_STORAGE_KEY, directives);
    await this.pushState();
  }

  private async copyDirectivesToClipboard(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot() ?? '';
    let targetRef = 'WORKTREE';
    let repoRoot = workspaceRoot;
    if (workspaceRoot) {
      try {
        const gitCtx = await getGitContext(workspaceRoot);
        repoRoot = gitCtx.repoRoot;
        targetRef = gitCtx.headSha || 'WORKTREE';
      } catch {
        // fallback
      }
    }
    const md = formatDirectivesForAgent(repoRoot, targetRef, this.getDirectives());
    await vscode.env.clipboard.writeText(md);
    vscode.window.showInformationMessage('CodeAtlas directives copied to clipboard as Markdown.');
  }

  private postEmptyOrErrorState(errorMsg?: string): void {
    const directives = this.getDirectives();
    this.view?.webview.postMessage({
      type: 'state',
      payload: {
        git: null,
        baseRef: this.baseRef || 'HEAD',
        diffStats: [],
        manifest: null,
        verification: this.lastVerification ?? null,
        directives,
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
      if (!this.baseRef || !git.recentRefs.includes(this.baseRef)) {
        this.baseRef = git.recentRefs[0] || 'HEAD';
      }

      const availableBriefings = await this.discoverBriefings(git.repoRoot);
      if (!this.didAutoDiscover && !this.lastVerification && availableBriefings.length > 0) {
        this.didAutoDiscover = true;
        await this.verifyBriefingFile(availableBriefings[0].path, true);
        return;
      }

      const [diffStats, manifest, trackedFiles] = await Promise.all([
        getDiffStats(git.repoRoot, this.baseRef),
        loadAtlasManifest(git.repoRoot),
        listTrackedFiles(git.repoRoot),
      ]);

      const directives = this.getDirectives();

      this.view?.webview.postMessage({
        type: 'state',
        payload: {
          git,
          baseRef: this.baseRef,
          diffStats,
          manifest: manifest ?? null,
          verification: this.lastVerification ?? null,
          directives,
        },
      });

      if (this.canvasPanel) {
        const graph = buildAtlasGraph({
          git,
          manifest,
          diffStats,
          trackedFiles,
          verification: this.lastVerification,
          directives,
          mode: this.viewMode,
          baseRef: this.baseRef,
        });
        this.canvasPanel.webview.postMessage({
          type: 'canvasState',
          payload: {
            git,
            baseRef: this.baseRef,
            graph,
            availableBriefings,
            activeBriefingPath: this.activeBriefingPath,
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
    })
  );
}

export function deactivate(): void {}
