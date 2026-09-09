/**
 * dsh-preset-composer — Host half.
 *
 * Gives each user-authored agent preset a graphical config surface over the
 * `preset-composer` settings namespace: display name/description (preset.yml),
 * the persona prefix (预设提示词), the skills under `<preset>/skills`, and the
 * non-structural plugin rows of `agent.cordis.yml`. The Host is the only
 * writer of preset files; the browser edits the settings namespace and this
 * plugin applies each committed change back to disk.
 *
 * Startup safety: the whole body runs inside a conditional `ctx.inject` over
 * `agentPresets` and `settings`, so a deployment that composes neither simply
 * never activates this plugin; every filesystem operation is contained and
 * logged, and `apply` never throws.
 */

import { dirname, join } from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
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

export const name = 'preset-composer'

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
export function apply(ctx: Context): void {
  ctx.inject(['agentPresets', 'settings'], (scoped) => {
    const service = new PresetComposerService(scoped)
    void service.start()
  })
}

/** Owns the settings namespace mirror and applies browser edits to files. */
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

  private async seed(): Promise<void> {
    const presets = (await this.ctx.agentPresets.list())
      .filter(preset => preset.trust === 'user' && preset.broken === undefined)
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
}
export type { PresetComposerSettings, PresetConfig, PluginRow, SkillRow }
