/**
 * Pure preset-file logic: parse and reconcile the composition and skill
 * frontmatter, mapping between the `preset-composer` namespace docs and the
 * YAML that lives on disk. No context, no I/O — everything here is a pure
 * function over the document shapes, so it is directly unit-tested.
 */

import * as yaml from 'js-yaml'
import type { PluginRow, PresetConfig, SkillRow } from './types.ts'

/** Preset files/rows this plugin owns. */
export const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona'
export const SKILL_FS_PLUGIN = '@deepseek-ai/dsh-skill-filesystem'
export const TOOL_SKILL_PLUGIN = '@deepseek-ai/dsh-tool-skill'
export const STRUCTURAL = new Set([PERSONA_PLUGIN, SKILL_FS_PLUGIN, TOOL_SKILL_PLUGIN])
export const METADATA_FILE = 'preset.yml'
export const COMPOSITION_FILE = 'agent.cordis.yml'
export const SKILLS_DIR = 'skills'
export const SKILL_MD = 'SKILL.md'

/* ------------------------------------------------------------------ */
/* YAML dialect: `!!js` round-trips as a `{ __jsExpr }` node, matching */
/* the Loader's own entry-list dialect. Self-contained (only js-yaml). */
/* ------------------------------------------------------------------ */

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => typeof data === 'object' && data !== null
    && typeof (data as { __jsExpr?: unknown }).__jsExpr === 'string',
  represent: (data) => (data as { __jsExpr: string }).__jsExpr,
})

/** Schema that parses and writes the Loader's entry-list dialect. */
export const COMPOSITION_SCHEMA = yaml.JSON_SCHEMA.extend(JsExpr)

const DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: -1 }
const COMPOSITION_DUMP_OPTIONS: yaml.DumpOptions = { schema: COMPOSITION_SCHEMA, ...DUMP_OPTIONS }

/** One parsed composition row (the subset this plugin reads/writes). */
export interface CompositionRow {
  id?: string
  name?: string
  group?: unknown
  isolate?: unknown
  config?: Record<string, unknown>
  disabled?: unknown
  [key: string]: unknown
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export function parseComposition(raw: string): CompositionRow[] {
  const parsed = yaml.load(raw, { schema: COMPOSITION_SCHEMA }) as unknown
  return Array.isArray(parsed) ? parsed as CompositionRow[] : []
}

export function dumpComposition(rows: readonly CompositionRow[]): string {
  return yaml.dump(rows, COMPOSITION_DUMP_OPTIONS)
}

/** The persona row's `config.prefix` (预设提示词), or '' when absent. */
export function personaPrefix(rows: readonly CompositionRow[]): string {
  const persona = rows.find(row => row?.name === PERSONA_PLUGIN)
  const prefix = persona?.config?.prefix
  return typeof prefix === 'string' ? prefix : ''
}

function parsePluginRow(row: CompositionRow): PluginRow | undefined {
  const name = row?.name
  if (typeof name !== 'string' || STRUCTURAL.has(name)) return undefined
  return {
    id: typeof row.id === 'string' && row.id !== '' ? row.id : name,
    name,
    enabled: row.disabled !== true,
  }
}

/** Non-structural plugin rows, in file order. */
export function compositionPlugins(rows: readonly CompositionRow[]): PluginRow[] {
  const plugins: PluginRow[] = []
  for (const row of rows) {
    const plugin = parsePluginRow(row)
    if (plugin !== undefined) plugins.push(plugin)
  }
  return plugins
}

/** Split `---\n<yaml>\n---\n<body>`; returns undefined without a frontmatter. */
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) return undefined
  const parsed = yaml.load(match[1]!) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(match[0].length) }
}

/** The skill's name + description + invocation flag, or undefined for a bad entry. */
export function parseSkill(raw: string): SkillRow | undefined {
  const split = splitFrontmatter(raw)
  if (split === undefined) return undefined
  const { data } = split
  const name = typeof data.name === 'string' ? data.name : undefined
  if (name === undefined) return undefined
  const description = typeof data.description === 'string' ? data.description : ''
  return { name, description, enabled: data['disable-model-invocation'] !== true }
}

/** Rewrite `disable-model-invocation` in a skill's frontmatter, preserving the body. */
export function setSkillDisabled(raw: string, enabled: boolean): string {
  const split = splitFrontmatter(raw)
  if (split === undefined) return raw
  if (enabled) delete split.data['disable-model-invocation']
  else split.data['disable-model-invocation'] = true
  const header = yaml.dump(split.data, DUMP_OPTIONS).trimEnd()
  return `---\n${header}\n---\n${split.body}`
}

/* ------------------------------------------------------------------ */
/* Reconcile                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fold a namespace `PresetConfig` into an existing composition.
 *
 * Semantics:
 * - the persona row gets `config.prefix` set to the prompt;
 * - the skill-filesystem row gets `customSkillDirs` pointing at the preset's
 *   `skills` dir; the tool-skill row is kept;
 * - structural rows that went missing are re-created;
 * - plugin rows the namespace lists are kept (their `disabled` toggled when it
 *   changed — using `delete row.disabled` to enable, `disabled: true` to
 *   disable, so a `!!js` gate is only rewritten when explicitly toggled);
 * - plugin rows absent from the namespace are dropped; new ones are appended;
 * - every unrecognized entry is preserved verbatim (never dropped).
 */
export function reconcile(
  rows: readonly CompositionRow[],
  config: PresetConfig,
  skillsDir: string,
): CompositionRow[] {
  const desired = new Map<string, PluginRow>()
  for (const plugin of config.plugins) desired.set(plugin.id || plugin.name, plugin)

  const out: CompositionRow[] = []
  const seenPlugins = new Set<string>()
  let hasPersona = false
  let hasSkillFs = false
  let hasToolSkill = false

  for (const row of rows) {
    if (row === null || typeof row !== 'object' || typeof row.name !== 'string') {
      out.push(row)
      continue
    }
    if (row.name === PERSONA_PLUGIN) {
      hasPersona = true
      out.push({ ...row, config: { ...(row.config ?? {}), prefix: config.prompt } })
      continue
    }
    if (row.name === SKILL_FS_PLUGIN) {
      hasSkillFs = true
      out.push({ ...row, config: { ...(row.config ?? {}), customSkillDirs: [skillsDir] } })
      continue
    }
    if (row.name === TOOL_SKILL_PLUGIN) {
      hasToolSkill = true
      out.push(row)
      continue
    }
    const key = typeof row.id === 'string' && row.id !== '' ? row.id : row.name
    const plugin = desired.get(key)
    if (plugin === undefined) continue
    seenPlugins.add(key)
    const enabled = row.disabled !== true
    if (plugin.enabled !== enabled) {
      if (plugin.enabled) {
        const { disabled: _dropped, ...rest } = row
        out.push(rest)
      } else {
        out.push({ ...row, disabled: true })
      }
    } else {
      out.push(row)
    }
  }

  if (!hasPersona) out.unshift({ id: 'persona', name: PERSONA_PLUGIN, config: { prefix: config.prompt } })
  if (!hasSkillFs) out.push({ id: 'skill-filesystem', name: SKILL_FS_PLUGIN, config: { customSkillDirs: [skillsDir] } })
  if (!hasToolSkill) out.push({ id: 'tool-skill', name: TOOL_SKILL_PLUGIN })

  for (const [key, plugin] of desired) {
    if (seenPlugins.has(key)) continue
    out.push({ id: plugin.id, name: plugin.name, ...(plugin.enabled ? {} : { disabled: true }) })
  }

  return out
}
