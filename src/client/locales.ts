/** Locale bundles for the preset composer's configure button and dialog. */

/** Locale keys these surfaces render. */
export type PresetComposerKey =
  | 'configure' | 'configTitle' | 'name' | 'description' | 'prompt'
  | 'skills' | 'plugins' | 'enabled' | 'addPlugin' | 'addPluginPlaceholder'
  | 'remove' | 'save' | 'cancel' | 'close' | 'saving'
  | 'noSkills' | 'noPlugins' | 'notConfigured' | 'loadError' | 'saveError'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Preset-composer configure button and dialog copy. */
    'settings.presetComposer': PresetComposerKey
  }
}

/** English copy. */
export const en: Record<PresetComposerKey, string> = {
  configure: 'Configure',
  configTitle: 'Configure preset',
  name: 'Name',
  description: 'Description',
  prompt: 'Preset prompt',
  skills: 'Skills',
  plugins: 'Plugins',
  enabled: 'Enabled',
  addPlugin: 'Add plugin',
  addPluginPlaceholder: 'Package name',
  remove: 'Remove',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  saving: 'Saving…',
  noSkills: 'No skills in this preset.',
  noPlugins: 'No plugins.',
  notConfigured: 'This preset was authored after startup; restart the host to configure it.',
  loadError: 'Could not load the preset configuration.',
  saveError: 'Could not save the preset configuration.',
}

/** Chinese copy. */
export const zh: Record<PresetComposerKey, string> = {
  configure: '配置',
  configTitle: '预设配置',
  name: '名称',
  description: '描述',
  prompt: '预设提示词',
  skills: 'Skills',
  plugins: '插件',
  enabled: '启用',
  addPlugin: '添加插件',
  addPluginPlaceholder: '插件包名',
  remove: '删除',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  saving: '保存中…',
  noSkills: '该预设没有 skill。',
  noPlugins: '暂无插件。',
  notConfigured: '该预设是启动后新建的，请重启 dsh 后再配置。',
  loadError: '读取预设配置失败。',
  saveError: '保存预设配置失败。',
}
