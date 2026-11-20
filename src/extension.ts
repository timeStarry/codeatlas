import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { getDiffStats, getGitContext } from './core/git.js';
import { loadAtlasManifest } from './core/manifest.js';
import { verifyBriefing } from './core/verifier.js';
import { formatDirectivesForAgent } from './core/directives.js';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
} from './core/types.js';
import { getCockpitHtml } from './webview/html.js';

const DIRECTIVES_STORAGE_KEY = 'codeatlas.directives.v1';

class CodeAtlasCockpitProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeatlas.cockpit';

  private view?: vscode.WebviewView;
  private lastVerification?: BriefingVerificationResult;
  private baseRef = 'HEAD~1';

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    const nonce = crypto.randomBytes(16).toString('hex');
    webviewView.webview.html = getCockpitHtml(nonce);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          await this.pushState();
          break;
        case 'refresh':
          if (typeof msg.baseRef === 'string') {
            this.baseRef = msg.baseRef;
          }
          await this.pushState();
          break;
        case 'pickBriefing':
          await this.pickAndVerifyBriefing();
          break;
        case 'openFile':
          await this.openWorkspaceFile(msg.path, msg.line);
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

    const filePath = picked[0].fsPath;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const briefing = JSON.parse(raw) as BriefingReport;
      const gitCtx = await getGitContext(workspaceRoot);
      this.lastVerification = await verifyBriefing(gitCtx.repoRoot, briefing, filePath);
      await this.pushState();
      vscode.window.showInformationMessage(
        `CodeAtlas verified "${briefing.title}": ${this.lastVerification.overallBadge.toUpperCase()}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `CodeAtlas failed to verify briefing: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async openWorkspaceFile(relPath: string, line = 1): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || !relPath) return;

    try {
      const gitCtx = await getGitContext(workspaceRoot);
      const fullPath = path.join(gitCtx.repoRoot, relPath);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
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
        // fallback to workspaceRoot
      }
    }
    const md = formatDirectivesForAgent(repoRoot, targetRef, this.getDirectives());
    await vscode.env.clipboard.writeText(md);
    vscode.window.showInformationMessage('CodeAtlas directives copied to clipboard as Markdown.');
  }

  public async pushState(): Promise<void> {
    if (!this.view) return;
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.view.webview.postMessage({
        type: 'state',
        payload: {
          git: null,
          baseRef: this.baseRef,
          diffStats: [],
          manifest: null,
          verification: this.lastVerification ?? null,
          directives: this.getDirectives(),
        },
      });
      return;
    }

    try {
      const git = await getGitContext(workspaceRoot);
      const [diffStats, manifest] = await Promise.all([
        getDiffStats(git.repoRoot, this.baseRef),
        loadAtlasManifest(git.repoRoot),
      ]);
      this.view.webview.postMessage({
        type: 'state',
        payload: {
          git,
          baseRef: this.baseRef,
          diffStats,
          manifest: manifest ?? null,
          verification: this.lastVerification ?? null,
          directives: this.getDirectives(),
        },
      });
    } catch {
      this.view.webview.postMessage({
        type: 'state',
        payload: {
          git: null,
          baseRef: this.baseRef,
          diffStats: [],
          manifest: null,
          verification: this.lastVerification ?? null,
          directives: this.getDirectives(),
        },
      });
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
    vscode.commands.registerCommand('codeatlas.verifyBriefing', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeatlas');
      await provider.pickAndVerifyBriefing();
    })
  );
}

export function deactivate(): void {}
