/**
 * dsh-preset-composer — Host half.
 *
 * Pure-host preset configuration surface. DSH does not (yet) expose a build
 * channel for a third-party plugin's client half, so this plugin is a Host-only
 * package: it registers the `/preset-composer` slash command (via the
 * pure-node `ctx.commands` registry — no client bundle required) to read and
 * edit each user-authored agent preset's name/description (preset.yml), persona
 * prefix (预设提示词), skills (`skills/`), and non-structural plugin rows
 * (`agent.cordis.yml`).
 *
 * The Host remains the only writer of preset files. It also mirrors every
 * editable preset into the `preset-composer` settings namespace at startup and
 * keeps that mirror in sync on every command edit, so a future client half
 * (which will need a DSH-provided browser-bundle build channel, tracked for
 * upstream) can read the same shape through the built-in `remote.settings`
 * surface without a new Remote API.
 *
 * Startup safety: the whole body runs inside a conditional `ctx.inject` over
 * `commands`, `agentPresets`, and `settings`, so a deployment that composes
 * none of them simply never activates this plugin; every filesystem operation
 * is contained and logged, and no handler throws.
 */

import { dirname, join } from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import * as yaml from 'js-yaml'
import {
  METADATA_FILE,
  SKILLS_DIR,
  SKILL_MD,
  compositionPlugins,
  dumpComposition,
  parseComposition,
  parseSkill,
  personaPrefix,
  reconcile,
  setSkillDisabled,
} from './presets.ts'
import {
  PRESET_COMPOSER_NS,
  type PluginRow,
  type PresetComposerSettings,
  type PresetConfig,
  type SkillRow,
} from './types.ts'
import { parsePresetCommand, renderConfig, tokenize } from './command.ts'
import { installComposerSkillsRuntime, type SkillsRuntimeOptions } from './skills-runtime.ts'

export const name = 'preset-composer'

/** Services the plugin body needs on the host. */
export const inject = ['commands', 'agentPresets', 'settings']

/** Combined plugin config: the `/preset-composer` editor + preset-skills runtime. */
export const Config = z.object({
  // Schemastery object fields are OPTIONAL by default — no `.optional()` method
  // exists (zod-style chaining throws at module load). Use `.default(...)` to
  // auto-fill when absent; `apply` reads absent keys as undefined.
  /** DSH_HOME override for the skills runtime (marker log / roster). Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome: z.string(),
  /** Skills marker log path override; defaults to `<DSH_HOME>/dsh-preset-composer.log`. */
  logFile: z.string(),
  /** Append candidate-event probes to the marker log (diagnostic noise). */
  debug: z.boolean().default(false),
})

/** Editor + skills-runtime config accepted by `apply`. */
export interface ComposerConfig {
  dshHome?: string
  logFile?: string
  debug?: boolean
}

const runtimeOptions = (config: ComposerConfig = {}): SkillsRuntimeOptions => ({
  dshHome: config.dshHome,
  logFile: config.logFile,
  debug: config.debug ?? false,
})

/** Command name without the leading slash. */
const COMMAND = 'preset-composer'
const USAGE =
  'Usage: /preset-composer <id> | /preset-composer <id> name <name> | '
  + '/preset-composer <id> prompt <prompt> | /preset-composer <id> skill <name> on|off '
  + '| /preset-composer <id> plugin <name> on|off|add:<spec>'

/* ------------------------------------------------------------------ */
/* Settings schema                                                     */
/* ------------------------------------------------------------------ */

const PluginRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
})

const SkillRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
})

const PresetConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  skills: z.array(SkillRowSchema),
  plugins: z.array(PluginRowSchema),
})

const SettingsSchema = z.object({
  presets: z.dict(PresetConfigSchema),
})

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

/** Plugin entry point. */
export function apply(ctx: Context, config: ComposerConfig = {}): void {
  // Preset-skills runtime: register each agent preset's own skills/ into its
  // agent scope (agent/created + agent-preset/selected convergence). Runs
  // independently of the editor's inject gate — it needs only lazy service
  // reads, so skills stay available even if commands/settings aren't present.
  installComposerSkillsRuntime(ctx, runtimeOptions(config))

  ctx.inject(inject, (scoped) => {
    const service = new PresetComposerService(scoped)
    void service.start()
    const dispose = scoped.commands.register({
      name: COMMAND,
      description: 'Configure a user agent preset (name, prompt, skills, plugins)',
      handler: (invocation) => service.handle(invocation),
    })
    scoped.on('dispose', dispose)
  })
}

/** Owns the settings namespace mirror, applies edits to files, and serves `/preset-composer`. */
class PresetComposerService {
  /** True while `seed()` writes the namespace, so its own event is ignored. */
  private seeding = false

  /** Owner-facing handle on the `preset-composer` namespace. */
  private readonly scope: SettingsScope<PresetComposerSettings>

  constructor(private readonly ctx: Context) {
    this.scope = ctx.settings.register(
      PRESET_COMPOSER_NS,
      SettingsSchema,
      { base: { presets: {} } },
    )

    ctx.on('settings/updated', (ns, next, prev, source) => {
      if (String(ns) !== PRESET_COMPOSER_NS || source !== 'update' || this.seeding) return
      void this.applyChanges(next as PresetComposerSettings, prev as PresetComposerSettings)
    })
  }

  /** Read every user preset's files into the namespace once at startup. */
  async start(): Promise<void> {
    try {
      await this.seed()
    } catch (error) {
      this.ctx.logger.warn(`preset-composer: seed failed: ${describeError(error)}`)
    }
  }

  /**
   * Dispatch one `/preset-composer` invocation.
   * @returns a human-facing command result; never throws.
   */
  async handle(invocation: CommandInvocation): Promise<CommandResult> {
    try {
      const { id, verb, args } = parsePresetCommand(invocation.rawInput)
      if (verb === undefined) {
        return id === '' ? await this.listAll() : await this.show(id)
      }
      switch (verb) {
        case 'name':
          return await this.setName(id, args.join(' '))
        case 'prompt':
          return await this.setPrompt(id, args.join(' '))
        case 'skill':
          return await this.setSkill(id, args)
        case 'plugin':
          return await this.setPlugin(id, args)
        default:
          return { kind: 'error', text: `Unknown verb "/${COMMAND} ${verb}". ${USAGE}` }
      }
    } catch (error) {
      return { kind: 'error', text: describeError(error) }
    }
  }

  /** List every editable preset id and its display name. */
  private async listAll(): Promise<CommandResult> {
    const presets = await this.editablePresets()
    if (presets.length === 0) {
      return { kind: 'success', text: 'No user-editable agent presets found.' }
    }
    const lines = presets.map(preset => `${preset.id}  —  ${preset.name ?? preset.id}`)
    return { kind: 'success', text: `Editable agent presets:\n${lines.join('\n')}` }
  }

  /** Show one preset's current config. */
  private async show(id: string): Promise<CommandResult> {
    const preset = await this.resolveEditable(id)
    if (preset === undefined) return { kind: 'error', text: `No user-editable preset "${id}".` }
    const config = await readPresetConfig(preset)
    return { kind: 'success', text: renderConfig(id, config) }
  }

  /** Set a preset's display name. */
  private async setName(id: string, value: string): Promise<CommandResult> {
    const value2 = value.trim()
    if (value2 === '') return { kind: 'error', text: `Usage: /${COMMAND} ${id} name <name>` }
    return this.mutate(id, async (config) => ({ ...config, name: value2 }))
  }

  /** Set a preset's persona prefix (预设提示词). */
  private async setPrompt(id: string, value: string): Promise<CommandResult> {
    return this.mutate(id, async (config) => ({ ...config, prompt: value }))
  }

  /** Enable/disable one skill under a preset. */
  private async setSkill(id: string, args: readonly string[]): Promise<CommandResult> {
    const name = args[0]
    const flag = args[1]?.toLowerCase()
    if (name === undefined || (flag !== 'on' && flag !== 'off')) {
      return { kind: 'error', text: `Usage: /${COMMAND} ${id} skill <name> on|off` }
    }
    return this.mutate(id, async (config) => ({
      ...config,
      skills: config.skills.map(skill =>
        skill.name === name ? { ...skill, enabled: flag === 'on' } : skill),
    }), (config) => config.skills.some(skill => skill.name === name))
  }

  /** Enable/disable a plugin row, or add a new one (`add:<spec>`). */
  private async setPlugin(id: string, args: readonly string[]): Promise<CommandResult> {
    const raw = args[0]
    const flag = args[1]?.toLowerCase()
    if (raw === undefined) {
      return { kind: 'error', text: `Usage: /${COMMAND} ${id} plugin <name> on|off|add:<spec>` }
    }
    if (flag !== undefined && (flag === 'on' || flag === 'off')) {
      return this.mutate(id, async (config) => ({
        ...config,
        plugins: config.plugins.map(plugin =>
          plugin.name === raw ? { ...plugin, enabled: flag === 'on' } : plugin),
      }), (config) => config.plugins.some(plugin => plugin.name === raw))
    }
    const addMatch = /^(?:add):(\S+)$/.exec(raw)
    if (addMatch !== null) {
      const spec = addMatch[1]!
      return this.mutate(id, async (config) => ({
        ...config,
        plugins: config.plugins.some(plugin => plugin.name === spec)
          ? config.plugins
          : [...config.plugins, { id: spec, name: spec, enabled: true }],
      }))
    }
    return { kind: 'error', text: `Usage: /${COMMAND} ${id} plugin <name> on|off|add:<spec>` }
  }

  /**
   * Apply a classifier edit to one preset's in-memory config, write it to disk,
   * and refresh the namespace mirror. `guard` (when supplied) skips the write
   * when the edit is a no-op for the current config.
   */
  private async mutate(
    id: string,
    edit: (config: PresetConfig) => Promise<PresetConfig>,
    guard?: (config: PresetConfig) => boolean,
  ): Promise<CommandResult> {
    const preset = await this.resolveEditable(id)
    if (preset === undefined) return { kind: 'error', text: `No user-editable preset "${id}".` }
    const current = await readPresetConfig(preset)
    if (guard !== undefined && guard(current)) {
      return { kind: 'success', text: `No-op: ${id} already matches that setting.` }
    }
    const next = await edit(current)
    await applyPresetConfig(this.ctx, id, next)
    await this.refreshOne(id)
    return { kind: 'success', text: `Updated preset "${id}".\n${renderConfig(id, next)}` }
  }

  /** List only `trust === 'user'` (non-broken) presets. */
  private async editablePresets(): Promise<AgentPreset[]> {
    return (await this.ctx.agentPresets.list())
      .filter(preset => preset.trust === 'user' && preset.broken === undefined)
  }

  /** Resolve one preset by id, accepting only editable ones. */
  private async resolveEditable(id: string): Promise<AgentPreset | undefined> {
    const preset = await this.ctx.agentPresets.resolve(id)
    if (preset.trust !== 'user' || preset.broken !== undefined) return undefined
    return preset
  }

  /** Read every user preset's files into the namespace once at startup. */
  private async seed(): Promise<void> {
    const presets = await this.editablePresets()
    const presetsById: Record<string, PresetConfig> = {}
    for (const preset of presets) {
      try {
        presetsById[preset.id] = await readPresetConfig(preset)
      } catch (error) {
        this.ctx.logger.warn(`preset-composer: cannot read preset "${preset.id}": ${describeError(error)}`)
      }
    }
    this.seeding = true
    try {
      await this.scope.replace({ presets: presetsById })
    } finally {
      this.seeding = false
    }
  }

  /** Re-read one preset into the mirror after a command-driven edit. */
  private async refreshOne(id: string): Promise<void> {
    const preset = await this.resolveEditable(id)
    if (preset === undefined) return
    let config: PresetConfig | undefined
    try {
      config = await readPresetConfig(preset)
    } catch (error) {
      this.ctx.logger.warn(`preset-composer: refresh preset "${id}" failed: ${describeError(error)}`)
      return
    }
    this.seeding = true
    try {
      // `update` is a deep merge, so this patches only `presets.<id>` and keeps
      // every other preset row in the mirror intact.
      await this.scope.update({ presets: { [id]: config } })
    } finally {
      this.seeding = false
    }
  }

  /** Apply the presets that changed between two namespace revisions. */
  private async applyChanges(next: PresetComposerSettings, prev: PresetComposerSettings): Promise<void> {
    const prevPresets = prev?.presets ?? {}
    for (const [id, config] of Object.entries(next.presets ?? {})) {
      if (JSON.stringify(config) === JSON.stringify(prevPresets[id])) continue
      try {
        await applyPresetConfig(this.ctx, id, config)
      } catch (error) {
        this.ctx.logger.warn(`preset-composer: apply preset "${id}" failed: ${describeError(error)}`)
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

async function readPresetConfig(preset: AgentPreset): Promise<PresetConfig> {
  const dir = dirname(preset.path)
  const rows = await readComposition(preset.path)
  return {
    name: preset.name ?? preset.id,
    description: preset.description ?? '',
    prompt: personaPrefix(rows),
    skills: await readSkills(dir),
    plugins: compositionPlugins(rows),
  }
}

async function readComposition(path: string): Promise<ReturnType<typeof parseComposition>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  return parseComposition(raw)
}

async function readSkills(dir: string): Promise<SkillRow[]> {
  const skillsDir = join(dir, SKILLS_DIR)
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: SkillRow[] = []
  for (const entry of entries) {
    let path: string
    if (entry.isDirectory()) path = join(skillsDir, entry.name, SKILL_MD)
    else if (entry.isFile() && entry.name.endsWith('.md')) path = join(skillsDir, entry.name)
    else continue
    try {
      const skill = parseSkill(await readFile(path, 'utf8'))
      if (skill !== undefined) skills.push(skill)
    } catch {
      // An unreadable or malformed skill entry is skipped, like the local provider does.
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

async function applyPresetConfig(ctx: Context, id: string, config: PresetConfig): Promise<void> {
  const preset = await ctx.agentPresets.resolve(id)
  if (preset.trust !== 'user') return
  const dir = dirname(preset.path)
  await writeMetadata(dir, config)
  await writeComposition(preset.path, dir, config)
  await writeSkills(dir, config.skills)
}

async function writeMetadata(dir: string, config: PresetConfig): Promise<void> {
  const path = join(dir, METADATA_FILE)
  let meta: Record<string, unknown> = {}
  try {
    const parsed = yamlLoad(await readFile(path, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>
    }
  } catch {
    // A missing or unparsable metadata file is rewritten with the form's values.
  }
  meta.name = config.name
  meta.description = config.description
  await writeFile(path, yamlDump(meta))
}

async function writeComposition(path: string, dir: string, config: PresetConfig): Promise<void> {
  const rows = await readComposition(path)
  const next = reconcile(rows, config, join(dir, SKILLS_DIR))
  await writeFile(path, dumpComposition(next))
}

async function writeSkills(dir: string, skills: readonly SkillRow[]): Promise<void> {
  const skillsDir = join(dir, SKILLS_DIR)
  for (const skill of skills) {
    const path = await locateSkillFile(skillsDir, skill.name)
    if (path === undefined) continue
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const updated = setSkillDisabled(raw, skill.enabled)
    if (updated !== raw) await writeFile(path, updated)
  }
}

async function locateSkillFile(skillsDir: string, name: string): Promise<string | undefined> {
  for (const candidate of [join(skillsDir, name, SKILL_MD), join(skillsDir, `${name}.md`)]) {
    try {
      const content = await readFile(candidate, 'utf8')
      if (content.length > 0) return candidate
    } catch {
      // Try the next shape.
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Small YAML wrappers (default schema for the metadata file only).    */
/* ------------------------------------------------------------------ */

// preset.yml is a plain mappings document (the DEFAULT schema), unlike the
// composition file which uses the entry-list dialect from `presets.ts`.

function yamlLoad(raw: string): unknown {
  return yaml.load(raw)
}

function yamlDump(data: unknown): string {
  return yaml.dump(data, { noRefs: true, lineWidth: -1 })
}

/** Render an error for a log line without leaking anything host-specific. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  PresetConfigSchema,
  PluginRowSchema,
  SettingsSchema,
  SkillRowSchema,
  tokenize,
}
export { parsePresetCommand, renderConfig } from './command.ts'
export type { PresetComposerSettings, PresetConfig, PluginRow, SkillRow }
