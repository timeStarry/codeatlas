import * as readline from 'node:readline';
import { getGitContext, getRepoRoot } from '../core/git.js';
import { loadAtlasManifestResult, verifyManifest } from '../core/manifest.js';
import { verifyBriefing } from '../core/verifier.js';
import {
  ackDirective,
  claimDirective,
  listDirectives,
  loadLatestBriefingRecord,
  saveBriefingRecord,
} from '../core/store.js';
import { BriefingReport, EvidenceAnchor } from '../core/types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const cliRepoArgIdx = process.argv.indexOf('--repo');
const defaultCliRepo = cliRepoArgIdx >= 0 ? process.argv[cliRepoArgIdx + 1] : undefined;

function writeResponse(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function sendResult(id: string | number | null, result: unknown): void {
  writeResponse({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null, code: number, message: string): void {
  writeResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

async function resolveTargetRepo(worktreePath?: unknown): Promise<string> {
  const candidate =
    typeof worktreePath === 'string' && worktreePath.trim()
      ? worktreePath.trim()
      : defaultCliRepo;
  if (!candidate) {
    throw new Error(
      'Missing required parameter "worktreePath" (or start MCP server with --repo <path>).'
    );
  }
  return getRepoRoot(candidate);
}

const TOOLS = [
  {
    name: 'atlas_get_context',
    description:
      'Read repository Git state, .atlas/manifest.json architectural domains & guardrails, manifest drift checks, active briefing summary, and open directives.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: {
          type: 'string',
          description: 'Absolute path to the target Git worktree directory.',
        },
      },
    },
  },
  {
    name: 'atlas_submit_briefing',
    description:
      'Submit a structured causal change briefing (schema v0.1 or v0.2). CodeAtlas deterministically verifies every claim, blocking condition, and impact anchor immediately and returns any MISMATCH/STALE issues.',
    inputSchema: {
      type: 'object',
      required: ['briefing'],
      properties: {
        worktreePath: { type: 'string' },
        briefing: { type: 'object' },
      },
    },
  },
  {
    name: 'atlas_fetch_directives',
    description:
      'Fetch open/claimed CodeAtlas directives for a worktree (with dynamic staleness). Optionally atomically claim available directives with a lease TTL.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: { type: 'string' },
        agentId: { type: 'string' },
        claim: { type: 'boolean', default: false },
        leaseMinutes: { type: 'number', default: 15 },
      },
    },
  },
  {
    name: 'atlas_ack_directive',
    description:
      'Acknowledge and resolve a directive using optimistic revision CAS. Rejects rework acks when no code changes exist.',
    inputSchema: {
      type: 'object',
      required: ['id', 'expectedRevision', 'agentId', 'summary'],
      properties: {
        worktreePath: { type: 'string' },
        id: { type: 'string' },
        expectedRevision: { type: 'number' },
        agentId: { type: 'string' },
        summary: { type: 'string' },
        evidenceAnchor: { type: 'object' },
      },
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const repoRoot = await resolveTargetRepo(args.worktreePath);

  if (name === 'atlas_get_context') {
    const [gitContext, manifestResult, latestBriefing, openDirectives] = await Promise.all([
      getGitContext(repoRoot),
      loadAtlasManifestResult(repoRoot),
      loadLatestBriefingRecord(repoRoot),
      listDirectives(repoRoot, false),
    ]);
    const manifestVerification =
      manifestResult.status === 'ok'
        ? await verifyManifest(repoRoot, manifestResult.manifest)
        : undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              gitContext,
              manifestResult,
              manifestVerification,
              latestBriefingSummary: latestBriefing
                ? {
                    id: latestBriefing.id,
                    title: latestBriefing.briefing.title,
                    overallBadge: latestBriefing.verification.overallBadge,
                    isStale: latestBriefing.verification.isStale,
                    storedAt: latestBriefing.storedAt,
                  }
                : null,
              openDirectives,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'atlas_submit_briefing') {
    const briefing = args.briefing as BriefingReport;
    if (!briefing || typeof briefing !== 'object' || !Array.isArray(briefing.claims)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid briefing payload: missing claims array.' }],
      };
    }
    const verification = await verifyBriefing(repoRoot, briefing);
    const stored = await saveBriefingRecord(repoRoot, briefing, verification);
    return {
      isError: verification.overallBadge === 'mismatch',
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              storedId: stored.id,
              storedPath: stored.filePath,
              verification,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'atlas_fetch_directives') {
    const open = await listDirectives(repoRoot, false);
    const shouldClaim = Boolean(args.claim);
    const agentId = typeof args.agentId === 'string' && args.agentId ? args.agentId : 'unknown-agent';
    const leaseMinutes =
      typeof args.leaseMinutes === 'number' && args.leaseMinutes > 0 ? args.leaseMinutes : 15;

    if (!shouldClaim) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ directives: open }, null, 2) }],
      };
    }

    const claimed = [];
    for (const d of open) {
      const c = await claimDirective(repoRoot, d.id, agentId, leaseMinutes);
      if (c) claimed.push({ ...c, isStale: d.isStale });
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ directives: claimed }, null, 2) }],
    };
  }

  if (name === 'atlas_ack_directive') {
    const res = await ackDirective(repoRoot, {
      id: String(args.id ?? ''),
      expectedRevision: Number(args.expectedRevision),
      agentId: String(args.agentId ?? 'unknown-agent'),
      summary: String(args.summary ?? ''),
      evidenceAnchor: args.evidenceAnchor as EvidenceAnchor | undefined,
    });
    return {
      isError: !res.ok,
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
  };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const id = req.id ?? null;
  if (req.method === 'notifications/initialized') {
    return;
  }
  if (req.method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'codeatlas-mcp', version: '0.2.0' },
    });
    return;
  }
  if (req.method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }
  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const name = String(params.name ?? '');
    const toolArgs = (params.arguments as Record<string, unknown>) ?? {};
    try {
      const result = await handleToolCall(name, toolArgs);
      sendResult(id, result);
    } catch (err: unknown) {
      sendError(id, -32602, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (id !== null) {
    sendError(id, -32601, `Method not found: ${req.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed) as JsonRpcRequest;
    void handleRequest(req);
  } catch (err: unknown) {
    process.stderr.write(`[codeatlas-mcp] Invalid JSON: ${String(err)}\n`);
  }
});
