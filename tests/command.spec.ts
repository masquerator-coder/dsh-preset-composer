/**
 * Unit tests for the pure `/preset-composer` command parsing/rendering helpers
 * in `src/command.ts`. These are context-free (no I/O, no DSH services), so
 * they run independently of the DSH installation that the Host half needs for
 * its `@deepseek-ai/*` runtime imports.
 */

import { describe, expect, it } from 'vitest'
import { parsePresetCommand, renderConfig, tokenize } from '../src/command.ts'
import type { PresetConfig } from '../src/types.ts'

describe('tokenize', () => {
  it('returns an empty list for an empty or blank tail', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })

  it('splits unquoted whitespace tokens', () => {
    expect(tokenize('dev name foo bar')).toEqual(['dev', 'name', 'foo', 'bar'])
    expect(tokenize('  dev   name  ')).toEqual(['dev', 'name'])
  })

  it('keeps double-quoted groups as one token', () => {
    expect(tokenize('dev prompt "You are a dev."')).toEqual(['dev', 'prompt', 'You are a dev.'])
  })

  it('keeps single-quoted groups as one token', () => {
    expect(tokenize("dev prompt 'single token'")).toEqual(['dev', 'prompt', 'single token'])
  })

  it('handles add:<spec> as one token', () => {
    expect(tokenize('dev plugin add:@deepseek-ai/dsh-tool-web'))
      .toEqual(['dev', 'plugin', 'add:@deepseek-ai/dsh-tool-web'])
  })

  it('keeps an unterminated quote as a final token', () => {
    expect(tokenize('dev prompt "dangling')).toEqual(['dev', 'prompt', 'dangling'])
  })
})

describe('parsePresetCommand', () => {
  it('parses a bare id (show)', () => {
    expect(parsePresetCommand('dev')).toEqual({ id: 'dev', verb: undefined, args: [] })
  })

  it('parses id + verb', () => {
    expect(parsePresetCommand('  dev  name  My Preset  '))
      .toEqual({ id: 'dev', verb: 'name', args: ['My', 'Preset'] })
  })

  it('parses empty input as empty id', () => {
    expect(parsePresetCommand('')).toEqual({ id: '', verb: undefined, args: [] })
  })

  it('parses a skill verb with its flag', () => {
    expect(parsePresetCommand('dev skill git on'))
      .toEqual({ id: 'dev', verb: 'skill', args: ['git', 'on'] })
  })

  it('parses prompt with a quoted value', () => {
    expect(parsePresetCommand('dev prompt "You are a dev."'))
      .toEqual({ id: 'dev', verb: 'prompt', args: ['You are a dev.'] })
  })

  it('parses a plugin add spec', () => {
    expect(parsePresetCommand('dev plugin add:@deepseek-ai/dsh-tool-web'))
      .toEqual({ id: 'dev', verb: 'plugin', args: ['add:@deepseek-ai/dsh-tool-web'] })
  })
})

describe('renderConfig', () => {
  const cfg: PresetConfig = {
    name: 'dev',
    description: 'Development',
    prompt: 'You are a developer.',
    skills: [
      { name: 'git', description: 'git workflows', enabled: true },
      { name: 'docs', description: 'docs', enabled: false },
    ],
    plugins: [
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', enabled: false },
    ],
  }

  it('renders every field with disabled markers', () => {
    const text = renderConfig('dev', cfg)
    expect(text).toContain('id: dev')
    expect(text).toContain('name: dev')
    expect(text).toContain('description: Development')
    expect(text).toContain('prompt: You are a developer.')
    // Disabled skills/plugins carry an `off ` prefix.
    expect(text).toContain('off docs')
    expect(text).toContain('off @deepseek-ai/dsh-tool-pwsh')
    expect(text).toContain('git')
    expect(text).toContain('@deepseek-ai/dsh-tool-bash')
  })

  it('renders empty collections as (none)', () => {
    const text = renderConfig('dev', { ...cfg, skills: [], plugins: [] })
    expect(text).toContain('skills: (none)')
    expect(text).toContain('plugins: (none)')
  })
})
