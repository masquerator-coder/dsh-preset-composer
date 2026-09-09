/**
 * Pure command parsing/rendering helpers for the `/preset-composer` slash
 * command. No context and no I/O — every function here is a pure function over
 * the raw input or a `PresetConfig`, so it can be unit-tested in isolation,
 * mirroring the `presets.ts` file-logic module.
 */

import type { PresetConfig } from './types.ts'

/** Split a raw command tail into shell-like tokens, preserving quoted groups. */
export function tokenize(raw: string): string[] {
  const tokens: string[] = []
  const current: string[] = []
  let quote: '"' | "'" | undefined
  let started = false
  for (const char of raw) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current.push(char)
      started = true
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/\s/.test(char)) {
      if (started) { tokens.push(current.join('')); current.length = 0; started = false }
      continue
    }
    current.push(char)
    started = true
  }
  if (quote !== undefined) tokens.push(current.join(''))
  else if (started) tokens.push(current.join(''))
  return tokens
}

/**
 * A parsed `/preset-composer` command: the target preset id, the optional
 * verb, and the verb's remaining arguments.
 */
export interface ParsedPresetCommand {
  readonly id: string
  readonly verb: string | undefined
  readonly args: readonly string[]
}

/** Parse a raw `/preset-composer` tail into id + verb + rest. */
export function parsePresetCommand(rawInput: string): ParsedPresetCommand {
  const [id, verb, ...rest] = tokenize(rawInput)
  return {
    id: id ?? '',
    verb: verb,
    args: rest as readonly string[],
  }
}

/** Render one preset's config as a readable command reply. */
export function renderConfig(id: string, config: PresetConfig): string {
  const skills = config.skills.length === 0
    ? '(none)'
    : config.skills.map(skill => `${skill.enabled ? '' : 'off '}${skill.name}`).join(', ')
  const plugins = config.plugins.length === 0
    ? '(none)'
    : config.plugins.map(plugin => `${plugin.enabled ? '' : 'off '}${plugin.name}`).join(', ')
  return [
    `id: ${id}`,
    `name: ${config.name}`,
    `description: ${config.description}`,
    `prompt: ${config.prompt}`,
    `skills: ${skills}`,
    `plugins: ${plugins}`,
  ].join('\n')
}
