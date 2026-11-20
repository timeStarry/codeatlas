# CodeAtlas

**Git-anchored deterministic verification and system understanding cockpit for human-agent software engineering.**

> Status: v0.1 validation build (VS Code extension host + standalone Gate B verification CLI).

## Core Principle

**Every view is a semantic projection of Git state.**

Instead of relying on heavy offline static reverse-engineering or trusting unverified LLM summaries, CodeAtlas splits production and verification:
1. **Agent-Submitted Causal Briefings (`schemas/briefing.schema.json`)**: Coding agents submit structured claims, explicit blocking conditions, code anchors, and test signals.
2. **Deterministic Local Verification (`src/core/verifier.ts`)**: CodeAtlas verifies target ref staleness against `HEAD`, file existence at ref, line bounds, symbol/excerpt presence, and diff membership—explicitly distinguishing `VERIFIED`, `MISMATCH`, `STALE`, `UNVERIFIED`, and `UNKNOWN`.
3. **In-Place Directives (`src/core/directives.ts`)**: Record constraints, questions, or rework instructions anchored to `ref + path:line` and export structured Markdown directives back to your Agent.

## Project Structure

- `src/core/` — Host-independent Git reader, `.atlas/manifest.json` loader, deterministic briefing verifier, and directive formatter.
- `src/extension.ts` & `src/webview/` — VS Code extension validation host (Activity Bar Cockpit, zero external CDN dependencies, click-to-jump source navigation).
- `src/cli/verify-briefing.ts` — Standalone CLI for Gate B verification experiments.
- `schemas/briefing.schema.json` — Agent briefing contract schema (`v0.1`).
- `.atlas/manifest.json` — Lightweight semantic skeleton dogfooded for this repository.
- `examples/sample-briefing.json` — Sample briefing you can verify immediately.

## Development & Verification

```bash
npm install
npm run typecheck
npm run build
npm test
```

### Run the Gate B CLI verifier

```bash
npm run verify-briefing -- examples/sample-briefing.json
```

### Launch the VS Code Extension Validation Build

1. Open `d:\Project\codeatlas` in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. Click the **CodeAtlas** icon in the Activity Bar (or run `CodeAtlas: Open Cockpit`).
4. Click **Verify Briefing JSON** and select `examples/sample-briefing.json`.
