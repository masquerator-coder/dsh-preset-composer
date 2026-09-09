/**
 * dsh-preset-composer — browser half.
 *
 * Registers one per-card action button into the Agent-presets section's
 * `settings.section.agentPreset.cardAction` child slot (declared by the DSH
 * core change this plugin pairs with). The button opens this plugin's own
 * configuration dialog; nothing else is added to the settings surface.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge (ctx.remote.settings / agentPresets).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the child-slot SlotMap merge and owner type.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ConfigureButton } from './ConfigureButton.tsx'
import type { ConfigureButtonInjected } from './ConfigureButton.tsx'
import { readConfig, saveConfig } from './controller.ts'
import { en, zh } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.agentPresets']

/** Mount the per-card configure button into the Agent presets section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.presetComposer', { zh, en }), 'preset-composer: locale')

  const buttonInjected = (): ConfigureButtonInjected => ({
    read: (id: string) => readConfig(ctx, id),
    save: (id: string, config, revision) => saveConfig(ctx, id, config, revision),
  })

  // The child slot is declared by the Agent-presets section when the paired
  // core change is present; `slots.inject` simply never fires without it, so
  // the button appears only on a DSH build that declares the slot.
  ctx.slots.inject('settings.section.agentPreset.cardAction', () => ctx.slots.register({
    name: 'settings.section.agentPreset.cardAction',
    id: 'preset-composer',
    // Before the built-in "open directory" action, i.e. left of it.
    order: -10,
    locale: 'settings.presetComposer',
    inject: buttonInjected,
  }, ConfigureButton))
}
