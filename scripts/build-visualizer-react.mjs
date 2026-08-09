#!/usr/bin/env bun
const result = await Bun.build({
  entrypoints: ['visualizer/client/main.tsx'],
  outdir: 'dist',
  naming: 'visualizer-react.js',
  target: 'browser',
  format: 'esm',
  external: ['react', 'react/jsx-runtime'],
});
if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
