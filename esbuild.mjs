import * as esbuild from 'esbuild';
import * as fs from 'node:fs';

const watch = process.argv.includes('--watch');
const buildTest = process.argv.includes('--test');

const sharedNodeOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

const mcpAppClientOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
  entryPoints: ['src/webview/mcpAppClient.ts'],
  outfile: 'dist/mcp-app-client.js',
};

if (buildTest) {
  if (fs.existsSync('src/webview/mcpAppClient.ts')) {
    await esbuild.build(mcpAppClientOptions);
  }
  await esbuild.build({
    ...sharedNodeOptions,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'dist/mcp-server.js',
    format: 'cjs',
  });
  const testEntries = fs
    .readdirSync('test')
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => `test/${f}`);
  await esbuild.build({
    ...sharedNodeOptions,
    entryPoints: testEntries,
    outdir: 'dist-test',
    format: 'cjs',
  });
  process.exit(0);
}

const contexts = [];

if (fs.existsSync('src/webview/mcpAppClient.ts')) {
  contexts.push(await esbuild.context(mcpAppClientOptions));
}

contexts.push(
  await esbuild.context({
    ...sharedNodeOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    format: 'cjs',
    external: ['vscode'],
  }),
  await esbuild.context({
    ...sharedNodeOptions,
    entryPoints: ['src/cli/verify-briefing.ts'],
    outfile: 'dist/verify-briefing.js',
    format: 'cjs',
  }),
  await esbuild.context({
    ...sharedNodeOptions,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'dist/mcp-server.js',
    format: 'cjs',
  })
);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching for changes...');
} else {
  // Build browser client first so dist/mcp-app-client.js is always ready before mcp-server runs
  for (const ctx of contexts) {
    await ctx.rebuild();
  }
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
