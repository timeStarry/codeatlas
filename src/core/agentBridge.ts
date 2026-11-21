export function buildMcpConfigJson(mcpServerPath: string, repoRoot: string): string {
  const config = {
    mcpServers: {
      codeatlas: {
        command: 'node',
        args: [mcpServerPath, '--repo', repoRoot],
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

export function buildAnalyzeModulePrompt(params: {
  repoRoot: string;
  branch: string;
  baseRef: string;
  nodeTitle: string;
  nodeKind: string;
  nodePath?: string;
  lang?: 'zh' | 'en';
}): string {
  const { repoRoot, branch, nodeTitle, nodeKind, nodePath, lang = 'zh' } = params;
  const targetLabel = nodePath ? `${nodeTitle} (${nodePath})` : nodeTitle;

  if (lang === 'en') {
    return [
      `Use the \`codeatlas\` MCP tools to analyze the ${nodeKind} \`${targetLabel}\` in repository \`${repoRoot}\` (branch \`${branch}\`):`,
      `1. Call \`atlas_get_context\` with \`worktreePath: "${repoRoot}"\` to inspect current Git state, guardrails, and open directives.`,
      `2. Read the real source code for \`${targetLabel}\` and map out:`,
      `   - Core responsibility claims (\`claims[]\`, each with exact \`path\`, \`startLine\`, \`endLine\`, and \`symbol\`)`,
      `   - Explicit blocking / early-exit / conflict conditions (\`blockingConditions[]\`)`,
      `   - Cross-boundary / IPC / event / runtime indirect impacts (\`impacts[]\`)`,
      `   - Declared blind spots (\`blindSpots[]\`) and any real verification signals (\`verificationSignals[]\`).`,
      `3. Call \`atlas_submit_briefing\` with \`schemaVersion: "0.2"\` and \`targetRef: "WORKTREE"\` (or current HEAD SHA).`,
      `4. If \`atlas_submit_briefing\` reports any MISMATCH or shifted line numbers, verify against the source files and re-submit until verification passes.`,
    ].join('\n');
  }

  return [
    `请使用 \`codeatlas\` MCP 工具深度分析仓库 \`${repoRoot}\`（当前分支 \`${branch}\`）中的「${targetLabel}」：`,
    `1. 先调用 \`atlas_get_context\`（参数 \`worktreePath: "${repoRoot}"\`）读取当前 Git 快照、架构红线与待处理指令。`,
    `2. 阅读「${targetLabel}」相关真实源码，梳理以下内容：`,
    `   - 核心职责与行为链声明（\`claims[]\`，每条必须附带精确的 \`path\`、\`startLine\`、\`endLine\` 与 \`symbol\`）`,
    `   - 显式阻断 / 早退 / 冲突保护条件（\`blockingConditions[]\`）`,
    `   - 跨模块 / 跨语言 / IPC / 事件总线间接影响（\`impacts[]\`）`,
    `   - 未验证盲区（\`blindSpots[]\`）与真实执行过的验证信号（\`verificationSignals[]\`，未运行的测试必须标为 \`not-run\` 或 \`unknown\`）。`,
    `3. 调用 \`atlas_submit_briefing\` 提交 \`schemaVersion: "0.2"\` 简报（\`targetRef\` 填当前 HEAD SHA 或 \`"WORKTREE"\`）。`,
    `4. 若 \`atlas_submit_briefing\` 返回任何 \`MISMATCH\` 或行号偏移，请核对真实源码修正后重新提交，直到确定性核验通过。`,
  ].join('\n');
}

export function buildAnalyzeBranchPrompt(params: {
  repoRoot: string;
  branch: string;
  baseRef: string;
  lang?: 'zh' | 'en';
}): string {
  const { repoRoot, branch, baseRef, lang = 'zh' } = params;

  if (lang === 'en') {
    return [
      `Use the \`codeatlas\` MCP tools to produce a causal change briefing for branch \`${branch}\` vs \`${baseRef}\` in \`${repoRoot}\`:`,
      `1. Call \`atlas_get_context\` with \`worktreePath: "${repoRoot}"\` and check any open directives.`,
      `2. Inspect \`git diff ${baseRef}\` and summarize:`,
      `   - Key behavioral changes (\`claims[]\` with \`expectChanged: true\` and exact \`path/startLine/endLine/symbol\`)`,
      `   - Explicit blocking / guardrail conditions (\`blockingConditions[]\`)`,
      `   - Indirect cross-boundary impacts (\`impacts[]\`), blind spots (\`blindSpots[]\`), and actual test results (\`verificationSignals[]\`).`,
      `3. Call \`atlas_submit_briefing\` (\`schemaVersion: "0.2"\`, \`baseRef: "${baseRef}"\`, \`targetRef: "WORKTREE"\`) and fix any reported MISMATCH until clean.`,
    ].join('\n');
  }

  return [
    `请使用 \`codeatlas\` MCP 工具为仓库 \`${repoRoot}\` 当前分支 \`${branch}\`（相对基准 \`${baseRef}\`）生成因果变更简报：`,
    `1. 先调用 \`atlas_get_context\`（参数 \`worktreePath: "${repoRoot}"\`），查看架构红线与未完成的 directives。`,
    `2. 结合 \`git diff ${baseRef}\` 梳理：`,
    `   - 关键行为变化（\`claims[]\`，改动文件标 \`expectChanged: true\`，并附精确 \`path / startLine / endLine / symbol\`）`,
    `   - 显式阻断 / 冲突 / 边界条件（\`blockingConditions[]\`）`,
    `   - 跨模块/跨语言间接影响（\`impacts[]\`）、未验证盲区（\`blindSpots[]\`）与真实测试信号（\`verificationSignals[]\`）。`,
    `3. 调用 \`atlas_submit_briefing\`（\`schemaVersion: "0.2"\`、\`baseRef: "${baseRef}"\`、\`targetRef: "WORKTREE"\`）上报；若返回任何 \`MISMATCH\` 请自纠并重提，直到核验通过。`,
  ].join('\n');
}

export function buildInitManifestPrompt(params: {
  repoRoot: string;
  lang?: 'zh' | 'en';
}): string {
  const { repoRoot, lang = 'zh' } = params;

  if (lang === 'en') {
    return [
      `Please inspect repository \`${repoRoot}\` and create/refine \`.atlas/manifest.json\` (schemaVersion "0.1"):`,
      `- Declare stable architectural code domains (\`domains[]\` with \`id\`, \`name\`, \`description\`, exact directory \`paths[]\` without globs, and verified \`entrypoints[]\` with \`path\`, \`startLine\`, \`symbol\`).`,
      `- Exclude pure static asset folders and lockfiles from primary code domains.`,
      `- Add concise architectural \`guardrails[]\` that coding agents must respect.`,
      `- After writing, call \`atlas_get_context\` to confirm \`manifestVerification.valid === true\`.`,
    ].join('\n');
  }

  return [
    `请阅读仓库 \`${repoRoot}\` 的核心目录结构，编写或完善 \`.atlas/manifest.json\`（\`schemaVersion: "0.1"\`）：`,
    `- 划分稳定的核心代码职责域（\`domains[]\`，含 \`id\`、\`name\`、清晰的中文职责 \`description\`、精确目录前缀 \`paths[]\`（禁止使用 glob 通配符），以及经过核对的关键入口 \`entrypoints[]\` 含 \`path / startLine / symbol\`）。`,
    `- 不要将纯图片/静态资源目录或锁文件写进核心代码域。`,
    `- 补充 3–5 条关键架构红线（\`guardrails[]\`），供后续 Coding Agent 动工前遵循。`,
    `- 写入后调用 \`atlas_get_context\` 确认 \`manifestVerification.valid === true\`（零漂移告警）。`,
  ].join('\n');
}
