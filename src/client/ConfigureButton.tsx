/**
 * Preset composer per-card action button. Registered into the Agent-presets
 * section's `settings.section.agentPreset.cardAction` child slot, so it
 * renders left of the built-in "open directory" action on each custom
 * preset card, and opens the configuration dialog.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresetConfig } from '../types.ts'
import { ConfigDialog } from './ConfigDialog.tsx'
import type { ConfigRead } from './controller.ts'
import css from './config.module.css'

/** Registration-side business face for the per-card button. */
export interface ConfigureButtonInjected {
  /** Read one preset's config from the seeded namespace. */
  read: (id: string) => Promise<ConfigRead>
  /** Persist one preset's config. */
  save: (id: string, config: PresetConfig, revision?: number) => Promise<string | undefined>
}

/** Full component props (owner `{ presetId, trust }` arrives via PropsRuntime). */
export type ConfigureButtonProps =
  PropsRuntime<'settings.section.agentPreset.cardAction'>
  & PropsLocale<'settings.presetComposer'>
  & InjectFace<ConfigureButtonInjected>

/** Render the configure button (custom presets only) and its dialog. */
export function ConfigureButton(props: ConfigureButtonProps): ReactNode {
  const { presetId, trust, t, read, save } = props
  const [open, setOpen] = useState(false)
  // Shipped presets are read-only; their cards offer no configuration.
  if (trust !== 'user') return null
  return (
    <>
      <button
        type="button"
        className={css.iconButton}
        data-tip={t('configure')}
        aria-label={`${t('configure')}`}
        onClick={() => { setOpen(true) }}
      >
        <IconSettingsOutline16 />
      </button>
      <ConfigDialog
        presetId={presetId}
        open={open}
        onClose={() => { setOpen(false) }}
        t={t}
        read={read}
        save={save}
      />
    </>
  )
}
