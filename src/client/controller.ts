/**
 * Browser-side read/write over the `preset-composer` settings namespace.
 *
 * The Host is the only writer of preset files; the browser edits the
 * namespace through the built-in `ctx.remote.settings` surface (no new Remote
 * API), and the Host applies each committed change back to disk.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote.settings namespace into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { PRESET_COMPOSER_NS, type PresetConfig } from '../types.ts'

/** One config read: the resolved value plus the revision a write must fence on. */
export type ConfigRead =
  | { ok: true; config: PresetConfig; revision: number }
  | { ok: false; error: string }

/**
 * Read one preset's config from the seeded namespace.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param id - the preset id.
 * @returns the config plus revision, or a reason it cannot be shown.
 */
export async function readConfig(ctx: ClientContext, id: string): Promise<ConfigRead> {
  const result = await ctx.remote.settings.describe()
  if (!result.ok) return { ok: false, error: result.error.message }
  const view = result.value.namespaces.find(entry => entry.ns === PRESET_COMPOSER_NS)
  const value = view?.value as { presets?: Record<string, PresetConfig> } | undefined
  const config = value?.presets?.[id]
  if (config === undefined) {
    return { ok: false, error: 'notConfigured' }
  }
  return { ok: true, config, revision: view!.revision }
}

/**
 * Persist one preset's config as a path-addressed namespace write.
 * @param ctx - the browser plugin context.
 * @param id - the preset id.
 * @param config - the complete next config.
 * @param revision - the revision the caller read; undefined writes unconditionally.
 * @returns the failure message, or undefined once the write landed.
 */
export async function saveConfig(
  ctx: ClientContext,
  id: string,
  config: PresetConfig,
  revision?: number,
): Promise<string | undefined> {
  const result = await ctx.remote.settings.mutate(
    PRESET_COMPOSER_NS,
    [{ op: 'set', path: ['presets', id], value: config }],
    revision,
  )
  return result.ok ? undefined : result.error.message
}
