/**
 * Host-half build: emit `lib/index.js` as a plain ESM entry.
 *
 * Every `@deepseek-ai/*` import resolves from the dsh installation the plugin
 * runs inside. The only runtime one is `@deepseek-ai/schemastery`; the rest are
 * `import type` and are elided. `js-yaml` is the one runtime non-framework
 * dependency and is bundled in, so `lib/index.js` needs no extra runtime
 * resolution. The emitted file is `index.js` (not `.mjs`) because the package
 * is `"type": "module"`.
 *
 * The BROWSER half (`lib/client.js`) is deliberately NOT produced here. DSH
 * client bundles are a closure-factory artifact (`window.__ModuleLoader__.load`
 * over the module table) built by the monorepo's `clientBundle` preset from
 * `packages/client/tsdown.client.ts` — a format a standalone package cannot
 * reproduce without that tooling. Building it correctly is documented in
 * `README.md` (Produce the client bundle), which drives DSH's own `clientBundle`
 * from a copy of the plugin placed inside the DSH checkout.
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
    entryFileNames: 'index.js',
  },
})
