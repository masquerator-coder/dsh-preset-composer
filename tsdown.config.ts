/**
 * Host-half build: emit `lib/index.mjs` as a plain ESM entry.
 *
 * Every `@deepseek-ai/*` import resolves from the dsh installation the plugin
 * runs inside. The only runtime ones are `@deepseek-ai/schemastery`, the
 * `@deepseek-ai/dsh-*` service type imports (all `import type`, elided), and
 * `@deepseek-ai/cordis` types (elided). `js-yaml` is the one runtime
 * non-framework dependency and is bundled in, so `lib/index.mjs` needs no extra
 * runtime resolution.
 *
 * There is deliberately NO browser half in this build. DSH does not (yet)
 * expose a client-bundle build channel for a standalone third-party plugin, so
 * this package is Host-only: the `/preset-composer` command runs through the
 * pure-node `ctx.commands` registry. A future client half would be produced by
 * DSH's own `clientBundle` tooling from inside the DSH checkout, when DSH
 * grows a supported channel for out-of-tree client plugins.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-preset-composer',
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  dts: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
  output: {
    entryFileNames: 'index.mjs',
  },
})
