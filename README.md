# dsh-preset-composer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
edits each **custom agent preset** — its name, description, preset prompt
(预设提示词), skills, and plugins — through the `/preset-composer` slash command.

This is a **Host-only** plugin: the command runs on the Host through DSH's
pure-node `commands` service, so it needs no browser (`client`) bundle and can
be installed and distributed as an independent npm/git package that works
immediately.

> **Client UI status.** The original design rendered a “⚙ 配置” configure button
> into the Agent-presets cards via the `settings.section.agentPreset.cardAction`
> child slot, backed by a browser half. That browser half (`src/client/`) is
> **reserved** but not part of this build: DSH does not (yet) expose a
> client-bundle build channel for an out-of-tree plugin, and a declared
> `dsh.client` without a built `./client` bundle is refused at load. The Host
> still mirrors every editable preset into the `preset-composer` settings
> namespace, so a future client half can reuse the same shape once DSH grows
> that channel. Sources under `src/client/` are kept as the authoritative
> reference for the future UI but are excluded from the current type/build
> surface.

## Quick install

```bash
# from the profile you run (a normal npm/git package, build on install)
dsh plugin --profile web add ./path/to/dsh-preset-composer
# or from a git URL, once the package builds on install (prepare → tsdown)
dsh plugin --profile web add "https://github.com/<you>/dsh-preset-composer.git"
# restart the profile (bundle membership changes apply only on restart)
```

Then, in the web UI or a session, type:

```
/preset-composer                                   list editable presets
/preset-composer <id>                              show one preset's config
/preset-composer <id> name <new name>              rename
/preset-composer <id> prompt <new prompt>          set the 预设提示词
/preset-composer <id> skill <name> on|off          enable/disable a skill
/preset-composer <id> plugin <name> on|off         enable/disable a plugin
/preset-composer <id> plugin add:<module-spec>     add a plugin row
```

## What it edits

Every custom preset is a directory under `$DSH_HOME/.agent-presets/<id>/` with
two files plus an optional `skills/` folder. This plugin edits all three:

| Command surface | File it maps to |
|---|---|
| `<id>` (list/show) / `name` / `prompt` | `preset.yml` (preserves `order`) + `agent.cordis.yml` persona row's `config.prefix` |
| `skill <name> on\|off` | `skills/<name>/SKILL.md` frontmatter `disable-model-invocation` |
| `plugin <name> on\|off\|add:<spec>` | `agent.cordis.yml` non-structural rows; `disabled` toggled / rows added |

Structural rows (`dsh-persona`, `dsh-skill-filesystem`, `dsh-tool-skill`) are
managed by the plugin, not listed as user plugins. On every save it ensures
`dsh-skill-filesystem` (with `customSkillDirs` pointing at `<preset>/skills`) and
`dsh-tool-skill` are present, mirrors the prompt into `dsh-persona.config.prefix`,
drops removed plugins, adds new ones, and preserves every other row (including
`group`/`isolate` structure) byte-for-byte except for the `disabled` key.

## Design

- **Files are the single source of truth.** The plugin edits preset files
  directly. It also mirrors every editable preset into the `preset-composer`
  settings namespace at startup and refreshes the mirror after each command
  edit, so a future client half can read the same shape through the built-in
  `ctx.remote.settings` surface (no new Remote API).
- **Only `trust === 'user'` presets are editable.** Shipped presets are never
  touched.
- **`!!js` expressions survive round-trips.** Composition YAML is parsed and
  written back with a self-contained `tag:yaml.org,2002:js` type (js-yaml only),
  matching the Loader's own `entryListSchema` dialect. A row whose `disabled` is
  a `!!js` expression is treated as enabled and is only rewritten when you
  explicitly toggle it (via `delete row.disabled` / `row.disabled = true`).
- **Startup safety.** Everything runs inside `ctx.inject(['commands','agentPresets','settings'], …)`;
  a deployment without those services never activates the plugin. File I/O is
  contained and logged (`logger.warn`), and no command handler throws.

## Layout

```
package.json            # bundle declaration; no dsh.client (Host-only)
cordis.patch.yml        # inserts the single `preset-composer` row
tsconfig.json           # Host type surface; src/client excluded (reserved)
tsdown.config.ts        # builds lib/index.mjs (Host)
src/types.ts            # shared wire types
src/presets.ts          # pure file-logic (parses/reconciles composition + skills)
src/command.ts          # pure /preset-composer command parsing + rendering
src/index.ts            # HOST: namespace mirror + command + file management
src/client/             # RESERVED future browser half (not built, kept as reference)
tests/presets.spec.ts   # pure file-logic tests
tests/command.spec.ts   # pure command parsing/rendering tests
```

A single cordis row (`cordis.patch.yml`) mounts the Host half
(`lib/index.mjs`). There is deliberately no browser half: DSH does not yet
expose a client-bundle build channel for an out-of-tree plugin, so this package
ships Host-only until that channel exists.

## Build

```bash
pnpm install        # js-yaml + vitest + tsdown + typescript + @types/node
pnpm bundle         # tsdown → lib/index.mjs (+ lib/index.d.mts)
pnpm test           # tests/presets.spec.ts + tests/command.spec.ts (pure logic)
```

The host bundle is verified: `lib/index.mjs` imports only Node builtins and
`@deepseek-ai/schemastery` (the one runtime framework import; it resolves from
the dsh installation), with `js-yaml` bundled inline. All other
`@deepseek-ai/*` imports are `import type` and are elided.

### (Future) Client half

When DSH supports out-of-tree client bundles, restore the browser half:
redeclare `dsh.client` in `package.json`, rebuild `src/client/` with DSH's own
`clientBundle` tooling (produce `lib/client.js`), and add the `./client` export.
The reserved sources under `src/client/` and the mirrored `preset-composer`
settings namespace are the starting point.

## Editable / un-editable

- Editable: presets with `trust === 'user'` (created via duplicate / new).
- A preset **created after** the running host booted is not in the namespace
  mirror yet — `show` re-reads files, but the mirror itself is refreshed on the
  next seed; restart to pick up newly created presets for the mirror.

## Limitations

- Slash-command interaction only (no graphical form) until a client half
  becomes buildable.
- A `!!js`-gated platform row (e.g. `tool-bash`/`tool-pwsh`) is shown as enabled
  until you toggle it, because the expression is treated as “enabled”.
- Plugins manage enable/disable/add of top-level rows; nested `group` children
  are preserved but not individually listed.
- Every write is atomic per namespace revision; a path edit fails closed rather
  than partially applying.

## License

MIT
