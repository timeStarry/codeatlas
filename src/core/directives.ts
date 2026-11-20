import { AnnotationDirective } from './types.js';

export function formatDirectivesForAgent(
  repoRoot: string,
  targetRef: string,
  directives: AnnotationDirective[]
): string {
  const header = [
    '# CodeAtlas Structured Directives',
    '',
    `- Repository: \`${repoRoot}\``,
    `- Bound Target Ref: \`${targetRef}\``,
    `- Directives Count: ${directives.length}`,
    '',
    '> Before applying changes, verify that the target branch/worktree still matches the bound ref above.',
    '',
  ];

  if (directives.length === 0) {
    return [...header, '_No directives recorded._'].join('\n');
  }

  const body = directives.map((d, idx) => {
    const loc = d.startLine
      ? `${d.path}:${d.startLine}${d.endLine && d.endLine !== d.startLine ? `-${d.endLine}` : ''}`
      : d.path;
    return [
      `## ${idx + 1}. [${d.kind.toUpperCase()}] \`${loc}\``,
      `- Ref: \`${d.ref}\``,
      `- Recorded: ${d.createdAt}`,
      `- Instruction: ${d.note}`,
      '',
    ].join('\n');
  });

  return [...header, ...body].join('\n');
}
