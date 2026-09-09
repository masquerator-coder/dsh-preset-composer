/**
 * Preset composer configuration dialog: name, description, prompt, skills
 * (enable/disable), and plugins (enable/disable/add/remove). Rendered by the
 * per-card configure button and owned entirely by this plugin — it draws its
 * own chrome and stages its own draft, writing through the settings namespace.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresetConfig, PluginRow, SkillRow } from '../types.ts'
import type { ConfigRead } from './controller.ts'
import type { PresetComposerKey } from './locales.ts'
import css from './config.module.css'

/** Dialogs receive the injected read/save face plus the framework `t` seat. */
export interface ConfigDialogProps {
  presetId: string
  open: boolean
  onClose: () => void
  t: (key: PresetComposerKey) => string
  read: (id: string) => Promise<ConfigRead>
  save: (id: string, config: PresetConfig, revision?: number) => Promise<string | undefined>
}

/** A short id for a plugin the user typed as a bare package name. */
function derivePluginId(name: string): string {
  return name.replace(/^@[^/]+\//, '').replace(/^dsh-/, '')
}

export function ConfigDialog(props: ConfigDialogProps): ReactNode {
  const { presetId, open, onClose, t, read, save } = props
  const [draft, setDraft] = useState<PresetConfig | null>(null)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newPlugin, setNewPlugin] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDraft(null)
    setError(null)
    setSaving(false)
    setNewPlugin('')
    void read(presetId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDraft(result.config)
        setRevision(result.revision)
      } else {
        setError(result.error === 'notConfigured' ? t('notConfigured') : `${t('loadError')} ${result.error}`)
      }
    })
    return () => { cancelled = true }
  }, [open, presetId, read, t])

  const patch = (next: Partial<PresetConfig>): void => {
    setDraft(current => current === null ? current : { ...current, ...next })
  }

  const patchSkill = (index: number, enabled: boolean): void => {
    setDraft(current => {
      if (current === null) return current
      const skills: SkillRow[] = current.skills.map((skill, i) => i === index ? { ...skill, enabled } : skill)
      return { ...current, skills }
    })
  }

  const patchPlugin = (index: number, enabled: boolean): void => {
    setDraft(current => {
      if (current === null) return current
      const plugins: PluginRow[] = current.plugins.map((plugin, i) => i === index ? { ...plugin, enabled } : plugin)
      return { ...current, plugins }
    })
  }

  const removePlugin = (index: number): void => {
    setDraft(current => {
      if (current === null) return current
      return { ...current, plugins: current.plugins.filter((_plugin, i) => i !== index) }
    })
  }

  const addPlugin = (): void => {
    const name = newPlugin.trim()
    if (name === '') return
    setDraft(current => {
      if (current === null) return current
      if (current.plugins.some(plugin => plugin.name === name)) return current
      return { ...current, plugins: [...current.plugins, { id: derivePluginId(name), name, enabled: true }] }
    })
    setNewPlugin('')
  }

  const submit = async (): Promise<void> => {
    if (draft === null || saving) return
    setSaving(true)
    setError(null)
    const failure = await save(presetId, draft, revision)
    setSaving(false)
    if (failure !== undefined) {
      setError(`${t('saveError')} ${failure}`)
      return
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('configTitle')}
      closeLabel={t('close')}
      className={css.dialog as string}
      footer={(
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={draft === null || saving} onClick={() => { void submit() }}>
            {saving ? t('saving') : t('save')}
          </Button>
        </>
      )}
    >
      {error !== null
        ? <p className={css.error} role="alert">{error}</p>
        : draft === null
          ? null
          : (
            <div className={css.fields}>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('name')}</span>
                <input className={css.input} value={draft.name} spellCheck={false}
                  onChange={event => { patch({ name: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('description')}</span>
                <textarea className={css.textarea} value={draft.description}
                  onChange={event => { patch({ description: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('prompt')}</span>
                <textarea className={css.textarea} rows={6} value={draft.prompt} spellCheck={false}
                  onChange={event => { patch({ prompt: event.target.value }) }} />
              </label>

              <fieldset className={css.group}>
                <legend className={css.groupHead}>{t('skills')}</legend>
                {draft.skills.length === 0
                  ? <p className={css.empty}>{t('noSkills')}</p>
                  : (
                    <ul className={css.rows}>
                      {draft.skills.map((skill, index) => (
                        <li key={skill.name} className={css.row}>
                          <label className={css.rowMain}>
                            <input type="checkbox" checked={skill.enabled}
                              onChange={event => { patchSkill(index, event.target.checked) }} />
                            <span className={css.rowName}>{skill.name}</span>
                            <span className={css.rowDesc}>{skill.description}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
              </fieldset>

              <fieldset className={css.group}>
                <legend className={css.groupHead}>{t('plugins')}</legend>
                {draft.plugins.length === 0
                  ? <p className={css.empty}>{t('noPlugins')}</p>
                  : (
                    <ul className={css.rows}>
                      {draft.plugins.map((plugin, index) => (
                        <li key={plugin.id} className={css.row}>
                          <label className={css.rowMain}>
                            <input type="checkbox" checked={plugin.enabled}
                              onChange={event => { patchPlugin(index, event.target.checked) }} />
                            <span className={css.rowName}>{plugin.name}</span>
                          </label>
                          <button type="button" className={css.removeButton}
                            aria-label={`${t('remove')}: ${plugin.name}`}
                            onClick={() => { removePlugin(index) }}>
                            {t('remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                <div className={css.addRow}>
                  <input className={css.input} value={newPlugin} spellCheck={false}
                    placeholder={t('addPluginPlaceholder')}
                    onChange={event => { setNewPlugin(event.target.value) }} />
                  <Button variant="outline" onClick={addPlugin}>{t('addPlugin')}</Button>
                </div>
              </fieldset>
            </div>
          )}
    </Modal>
  )
}
