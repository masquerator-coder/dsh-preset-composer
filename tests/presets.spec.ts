/**
 * Unit tests for the pure preset-file logic in `src/presets.ts`.
 *
 * These cover the YAML dialect round-trip and the reconcile/frontmatter
 * semantics that the Host applies — the parts most likely to corrupt a user's
 * preset if wrong, and the parts that are pure enough to test in isolation.
 */

import { describe, expect, it } from 'vitest'
import {
  COMPOSITION_SCHEMA,
  PERSONA_PLUGIN,
  SKILL_FS_PLUGIN,
  TOOL_SKILL_PLUGIN,
  compositionPlugins,
  dumpComposition,
  parseComposition,
  parseSkill,
  personaPrefix,
  reconcile,
  setSkillDisabled,
  splitFrontmatter,
} from '../src/presets.ts'
import type { PresetConfig } from '../src/types.ts'

const SKILLS = 'C:\\Users\\me\\.dsh\\.agent-presets\\dev\\skills'

function config(overrides: Partial<PresetConfig> = {}): PresetConfig {
  return {
    name: 'dev',
    description: 'Development',
    prompt: 'You are a developer.',
    skills: [{ name: 'git', description: 'git workflows', enabled: true }],
    plugins: [
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', enabled: false },
    ],
    ...overrides,
  }
}

/** A realistic starting composition, mirroring the shipped cordis preset. */
function baseRows(): Record<string, unknown>[] {
  return [
    { id: 'persona', name: PERSONA_PLUGIN, config: { prefix: 'You are a developer.' } },
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: true },
    { id: 'skill-filesystem', name: SKILL_FS_PLUGIN },
    { id: 'tool-skill', name: TOOL_SKILL_PLUGIN },
  ]
}

describe('YAML dialect', () => {
  it('parses a `!!js` expression as a `{ __jsExpr }` node', () => {
    const rows = parseComposition('- name: a\n  disabled: !!js "process.platform === \'win32\'"\n')
    expect(rows[0]).toEqual({ name: 'a', disabled: { __jsExpr: 'process.platform === \'win32\'' } })
  })

  it('round-trips a `!!js` expression through dump', () => {
    const rows = [{ name: 'a', disabled: { __jsExpr: 'process.platform === \'win32\'' } }]
    const dumped = dumpComposition(rows)
    expect(dumped).toContain('!!js')
    expect(dumped).toContain('process.platform')
    // Parsing the dump recovers the exact node.
    const again = parseComposition(dumped)
    expect(again[0]?.disabled).toEqual(rows[0]!.disabled)
  })

  it('round-trips persona block scalar prefix', () => {
    const rows = [{ id: 'persona', name: PERSONA_PLUGIN, config: { prefix: 'line1\nline2\n' } }]
    const again = parseComposition(dumpComposition(rows))
    expect(again[0]?.config?.prefix).toBe('line1\nline2\n')
  })

  it('keeps the schema usable as the Loader dialect', () => {
    expect(COMPOSITION_SCHEMA).toBeDefined()
  })
})

describe('compositionPlugins / personaPrefix', () => {
  it('excludes structural rows and maps disabled to enabled flag', () => {
    const plugins = compositionPlugins(baseRows())
    expect(plugins).toEqual([
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', enabled: false },
    ])
  })

  it('reads the persona prefix', () => {
    expect(personaPrefix(baseRows())).toBe('You are a developer.')
    expect(personaPrefix([])).toBe('')
  })

  it('treats a `!!js` disabled node as enabled', () => {
    const plugins = compositionPlugins([
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: 'process.platform === \'win32\'' } },
    ])
    expect(plugins[0]?.enabled).toBe(true)
  })
})

describe('reconcile', () => {
  it('keeps the enabled flag of unchanged plugins in place', () => {
    const out = reconcile(baseRows(), config(), SKILLS)
    const bash = out.find(r => r.id === 'tool-bash')
    const pwsh = out.find(r => r.id === 'tool-pwsh')
    expect(bash?.disabled).toBeUndefined()
    expect(pwsh?.disabled).toBe(true)
  })

  it('enables a plugin by deleting its disabled flag', () => {
    const cfg = config({ plugins: [
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', enabled: true },
    ] })
    const out = reconcile(baseRows(), cfg, SKILLS)
    expect(out.find(r => r.id === 'tool-pwsh')?.disabled).toBeUndefined()
  })

  it('disables a plugin by setting disabled: true', () => {
    const cfg = config({ plugins: [
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: false },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', enabled: false },
    ] })
    const out = reconcile(baseRows(), cfg, SKILLS)
    expect(out.find(r => r.id === 'tool-bash')?.disabled).toBe(true)
    expect(out.find(r => r.id === 'tool-pwsh')?.disabled).toBe(true)
  })

  it('rewrites the persona prefix', () => {
    const out = reconcile(baseRows(), config({ prompt: 'New prefix.' }), SKILLS)
    expect(personaPrefix(out)).toBe('New prefix.')
  })

  it('points the skill-filesystem customSkillDirs at the skills dir', () => {
    const out = reconcile(baseRows(), config(), SKILLS)
    const skillFs = out.find(r => r.id === 'skill-filesystem')
    expect(skillFs?.config?.customSkillDirs).toEqual([SKILLS])
  })

  it('drops a plugin removed from the namespace and appends a new one', () => {
    const cfg = config({ plugins: [
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', enabled: true },
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', enabled: true },
    ] })
    const out = reconcile(baseRows(), cfg, SKILLS)
    expect(out.find(r => r.id === 'tool-pwsh')).toBeUndefined()
    const added = out.find(r => r.id === 'tool-web')
    expect(added).toEqual({ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web' })
  })

  it('re-creates missing structural rows and prefaces the persona', () => {
    const out = reconcile([], config(), SKILLS)
    expect(out[0]?.name).toBe(PERSONA_PLUGIN)
    expect(out.some(r => r.name === SKILL_FS_PLUGIN)).toBe(true)
    expect(out.some(r => r.name === TOOL_SKILL_PLUGIN)).toBe(true)
    expect(out.some(r => r.name === '@deepseek-ai/dsh-tool-bash')).toBe(true)
  })

  it('preserves an unknown non-object entry verbatim', () => {
    const stranger = { group: { query: 'x' }, config: { isolate: true } }
    const out = reconcile([stranger], config(), SKILLS)
    expect(out).toContain(stranger)
  })
})

describe('skill frontmatter', () => {
  const body = '# git\n\nUsage here.\n'

  it('parses name, description, and enabled', () => {
    const skill = parseSkill(`---\nname: git\ndescription: git workflows\n---\n${body}`)
    expect(skill).toEqual({ name: 'git', description: 'git workflows', enabled: true })
  })

  it('reports disabled when disable-model-invocation is true', () => {
    const skill = parseSkill(`---\nname: git\ndescription: x\ndisable-model-invocation: true\n---\n${body}`)
    expect(skill?.enabled).toBe(false)
  })

  it('skips a file without a name', () => {
    expect(parseSkill(`---\ndescription: no name\n---\n${body}`)).toBeUndefined()
    expect(parseSkill(body)).toBeUndefined()
  })

  it('toggles disabled by rewriting only the frontmatter, preserving the body', () => {
    const raw = `---\nname: git\ndescription: git workflows\n---\n${body}`
    const disabled = setSkillDisabled(raw, false)
    expect(disabled).toContain('disable-model-invocation: true')
    expect(disabled).toContain(body)
    // Enabled again drops the key exactly.
    const enabledAgain = setSkillDisabled(disabled, true)
    expect(enabledAgain).not.toContain('disable-model-invocation')
    expect(enabledAgain).toContain(body)
    // The body text survives byte for byte.
    expect(enabledAgain.endsWith(body)).toBe(true)
  })

  it('leaves a frontmatter-less file untouched', () => {
    expect(setSkillDisabled(body, false)).toBe(body)
  })
})

describe('splitFrontmatter', () => {
  it('handles LF and the trailing delimiter', () => {
    const split = splitFrontmatter('---\nname: git\n---\nbody')
    expect(split?.data.name).toBe('git')
    expect(split?.body).toBe('body')
  })

  it('returns undefined without a leading delimiter', () => {
    expect(splitFrontmatter('name: git\n---\nbody')).toBeUndefined()
  })
})
