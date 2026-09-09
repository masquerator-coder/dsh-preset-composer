/**
 * Shared wire types for the preset-composer settings namespace.
 *
 * These are the shapes the Host half seeds into (and applies from) the
 * `preset-composer` settings namespace, and the Client half reads/writes. The
 * Client imports them type-only (the bundle-purity gate forbids value imports
 * across the host/client boundary), so this module carries types only.
 */

/** Settings namespace owned by this plugin. */
export const PRESET_COMPOSER_NS = 'preset-composer'

/** One plugin row in a preset's composition, as the config UI edits it. */
export interface PluginRow {
  /** Stable row id; falls back to the module name when the file omits one. */
  id: string
  /** Module specifier the Loader resolves. */
  name: string
  /** Whether the row is enabled (its `disabled` flag is absent/false). */
  enabled: boolean
}

/** One skill under a preset's `skills/` directory, as the config UI edits it. */
export interface SkillRow {
  /** Kebab-case skill name. */
  name: string
  /** Short routing description. */
  description: string
  /** Whether the skill is invocable (`disable-model-invocation` is absent/false). */
  enabled: boolean
}

/** One preset's editable config surface. */
export interface PresetConfig {
  /** Display name. */
  name: string
  /** One-sentence description. */
  description: string
  /** The preset's persona prefix (预设提示词). */
  prompt: string
  /** Skills discovered under the preset's `skills/` directory. */
  skills: SkillRow[]
  /** Non-structural plugin rows in the preset's composition. */
  plugins: PluginRow[]
}

/** The preset-composer settings namespace document. */
export interface PresetComposerSettings {
  presets: Record<string, PresetConfig>
}
