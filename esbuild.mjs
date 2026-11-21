import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const buildTest = process.argv.includes('--test');

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

if (buildTest) {
  await esbuild.build({
    ...sharedOptions,
    entryPoints: ['test/verifier.test.ts', 'test/phase2.test.ts'],
    outdir: 'dist-test',
    format: 'cjs',
  });
  process.exit(0);
}

const extensionCtx = await esbuild.context({
  ...sharedOptions,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  format: 'cjs',
  external: ['vscode'],
});

const cliCtx = await esbuild.context({
  ...sharedOptions,
  entryPoints: ['src/cli/verify-briefing.ts'],
  outfile: 'dist/verify-briefing.js',
  format: 'cjs',
});

const mcpCtx = await esbuild.context({
  ...sharedOptions,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp-server.js',
  format: 'cjs',
});

if (watch) {
  await Promise.all([extensionCtx.watch(), cliCtx.watch(), mcpCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([extensionCtx.rebuild(), cliCtx.rebuild(), mcpCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), cliCtx.dispose(), mcpCtx.dispose()]);
}
