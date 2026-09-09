# dsh-preset-composer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives each **custom agent preset** a graphical editor for its
name, description, preset prompt (预设提示词), skills, and plugins. It adds a
“配置” action to the Agent-preset cards in **Settings → Agent 预设** — left of the
built-in “打开目录” (open directory) action — via a new child slot in the
Agent-presets section.

```
Agent 预设  →  custom preset cards  →  [⚙ 配置]  [打开目录]
                                       (this plugin)   (core)
```

## What it edits

Every custom preset is a directory under `$DSH_HOME/.agent-presets/<id>/` with
two files plus an optional `skills/` folder. This plugin edits all three:

| Surface in the dialog | File it maps to |
|---|---|
| 名称 / 描述 (name / description) | `preset.yml` (preserves `order`) |
| 预设提示词 (preset prompt) | `agent.cordis.yml` → the `@deepseek-ai/dsh-persona` row's `config.prefix` |
| Skills（启用/停用） | `skills/<name>/SKILL.md` frontmatter `disable-model-invocation` |
| 插件（启用/停用/添加/删除） | `agent.cordis.yml` non-structural rows; `disabled` toggled |

Structural rows (`dsh-persona`, `dsh-skill-filesystem`, `dsh-tool-skill`) are
managed by the plugin, not listed as user plugins. On every save it ensures
`dsh-skill-filesystem` (with `customSkillDirs` pointing at `<preset>/skills`) and
`dsh-tool-skill` are present, mirrors the prompt into `dsh-persona.config.prefix`,
drops removed plugins, adds new ones, and preserves every other row (including
`group`/`isolate` structure) byte-for-byte except for the `disabled` key.

## Design

- **Files are the single source of truth.** The browser never touches preset
  files. The Host seeds a `preset-composer` settings namespace mirror at
  startup, the browser edits that namespace through the built-in
  `ctx.remote.settings` surface (no new Remote API), and the Host applies each
  `'update'`-sourced commit back to disk via `settings/updated`. A `seeding`
  guard plus a deep-diff prevent write-back loops.
- **Only `trust === 'user'` presets are editable.** Shipped presets render no
  button.
- **`!!js` expressions survive round-trips.** Composition YAML is parsed and
  written back with a self-contained `tag:yaml.org,2002:js` type (js-yaml only),
  matching the Loader's own `entryListSchema` dialect. A row whose `disabled` is
  a `!!js` expression is treated as enabled and is only rewritten when you
  explicitly toggle it (via `delete row.disabled` / `row.disabled = true`).
- **Startup safety.** Everything runs inside `ctx.inject(['agentPresets','settings'], …)`;
  a deployment without those services never activates the plugin. File I/O is
  contained and logged (`logger.warn`), and `apply` never throws.

## Layout

```
package.json            # bundle + dsh.client declarations
cordis.patch.yml        # inserts the single `preset-composer` row
tsconfig.json
tsdown.config.ts        # builds lib/index.mjs (host)
src/types.ts            # shared wire types
src/presets.ts          # pure file-logic (parses/reconciles composition + skills)
src/index.ts            # HOST half: namespace mirror + file management
src/client/index.ts     # CLIENT half: apply + slot registration
src/client/ConfigureButton.tsx
src/client/ConfigDialog.tsx
src/client/controller.ts
src/client/locales.ts
src/client/config.module.css
```

A single cordis row (`cordis.patch.yml`) mounts both halves, exactly like the
shipped `@deepseek-ai/dsh-client-*` packages: the node half is the Host
(`lib/index.js`), and because `package.json` declares `dsh.client`, the browser
half (`lib/client.js`) is served to the web shell.

## Prerequisite: the child slot in DSH core

The configure button renders into the `settings.section.agentPreset.cardAction`
child slot, which is **not yet in upstream DSH**. It is supplied by this paired
DSH core change:

- `packages/client/ui-agent-preset/src/client/contract/slots.ts` (new) — declares
  `SlotMap['settings.section.agentPreset.cardAction']` with owner `{ presetId, trust }`.
- `packages/client/ui-agent-preset/src/client/index.ts` — registers the child in
  the section's `children`, exports `AgentPresetCardActionOwnerProps`.
- `packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx` — renders
  `renderSlot('settings.section.agentPreset.cardAction', { presetId, trust })`
  in the card footer, left of the open-directory action.

The plugin compiles against this slot key and silently does nothing on a DSH
build that lacks it (`ctx.slots.inject` never fires when the key is undeclared).
Submit that change as the upstream PR and rebuild the DSH web artifacts first.

## Build

### 1. Host half

```bash
pnpm install        # js-yaml + vitest + tsdown
pnpm bundle         # tsdown → lib/index.mjs (+ lib/index.d.mts)
pnpm test           # runs tests/presets.spec.ts (pure logic)
```

The host bundle is verified: `lib/index.mjs` imports only Node builtins and
`@deepseek-ai/schemastery` (the one runtime framework import; it resolves from
the dsh installation), with `js-yaml` bundled inline. All other `@deepseek-ai/*`
imports are `import type` and are elided.

### 2. Client half

The browser bundle must be the DSH `clientBundle` artifact (closure-factory over
the module table), produced by DSH's own tooling — a standalone tsdown run
`external`s the `@deepseek-ai/*` module-table peers and would emit a plain ESM
file, which the web shell does not load. Produce it from the DSH checkout:

1. Copy or link this package under `packages/client/` (e.g.
   `packages/client/preset-composer/`).
2. Write `packages/client/preset-composer/tsdown.config.ts` mirroring
   `packages/client/ui-agent-preset/tsdown.config.ts`:
   ```ts
   import { clientBundle } from '../tsdown.client.ts'
   export default clientBundle('dsh-preset-composer', ['lib/types/index.js'])
   ```
   and add `tsdown.client.ts` (from the DSH repo) to the workspace.
3. Run the DSH client build for the package (`pnpm --filter @deepseek-ai/dsh-* build` /
   the monorepo web build), which emits `packages/client/preset-composer/lib/client.js`
   plus the `lib/types/client/*.d.ts`.
4. Copy `lib/` back into this checkout before `pnpm pack`/install.

> The `dsh.client.inject` list in `package.json` names the module-table peers the
> browser bundle externalizes. When generating the client bundle through DSH's
> `clientBundle`, keep the package's `dsh.client` block in sync so the plugin is
> served and its peers resolve.

## Install

Build as above, then, from the profile you run:

```bash
dsh plugin --profile web add ./path/to/dsh-preset-composer
# restart the profile (bundle membership changes apply only on restart)
```

Resolve the `@deepseek-ai/*` dev/peer deps against the **patched** DSH checkout
(`file:`/`link:` or a tarball) so the plugin compiles against the local child
slot; the published `@deepseek-ai` versions won't carry the slot until the PR
lands.

## Editable / un-editable

- Editable: presets with `trust === 'user'` (created via duplicate / new).
- Seeded at startup from files. A preset **created after** the running host
  booted is not in the namespace mirror yet — the dialog then shows “restart the
  host to configure it” instead of risking a destructive save. Restart to pick
  up newly created presets (a re-seed trigger is a future v2).

## Limitations

- New presets require a restart before they can be configured (see above).
- A `!!js`-gated platform row (e.g. `tool-bash`/`tool-pwsh`) is shown as enabled
  until you toggle it, because the expression is treated as “enabled”.
- Plugins manage enable/disable/add/remove of top-level rows; nested `group`
  children are preserved but not individually listed.
- Editing occurs on the next `settings/updated` apply; a path write is atomic
  per namespace revision.

## License

MIT
