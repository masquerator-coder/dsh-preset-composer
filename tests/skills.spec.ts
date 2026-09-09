/**
 * Preset-skills runtime tests (ported from dsh-preset-skills v4.3 smoke tests)
 * exercising the prepare→apply pipeline against the REAL preset skills
 * directories on this machine, with a mock (in-memory) registration sink.
 *
 * Verifies, without any dsh runtime:
 *   - discoverSkills/parseSkillSource parse the real research/teacher/developer dirs;
 *   - preparePresetSkills + applyPresetDefinitions register definitions and
 *     return disposers;
 *   - every emitted registration is a legal runtime skill definition
 *     (kebab name, description, invocation booleans, provider stamp, source,
 *     resourceBase, content);
 *   - sinks are isolated per preset (one simulated agent scope each);
 *   - resolve/discover failures fold into prepared results instead of throwing;
 *   - v4.2 switch convergence: applying preset B after A disposes A's disposers
 *     and leaves only B registered (one shared layer).
 */
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import {
  discoverSkills,
  loadSkill,
  parseSkillSource,
  isSkillName,
} from '../src/skills/parse.ts'
import {
  preparePresetSkills,
  applyPresetDefinitions,
  toRegistration,
  PROVIDER,
} from '../src/skills/register.ts'

const ROOT = process.env.DSH_HOME || 'C:/Users/fuqia/.dsh'
const PRESETS = [
  { id: 'research', expect: 20 },
  { id: 'teacher', expect: 5 },
  { id: 'developer', expect: 1 },
]

/** One simulated agent-scope skill layer: name → disposer, register/dispose ops. */
function makeLayer() {
  const entries = new Map()
  const ops: Array<['register' | 'dispose', string]> = []
  return {
    entries,
    ops,
    register(registration: any) {
      if (entries.has(registration.name)) throw new Error(`duplicate ${registration.name}`)
      let live = true
      entries.set(registration.name, registration)
      ops.push(['register', registration.name])
      return () => {
        if (!live) return
        live = false
        entries.delete(registration.name)
        ops.push(['dispose', registration.name])
      }
    },
  }
}

function readSeam(log: (l: string) => void = () => {}) {
  return {
    async resolveSkillsDir(id: string) {
      return join(ROOT, '.agent-presets', id, 'skills')
    },
    discover: (dir: string) => discoverSkills(dir),
    load: (skill: any) => loadSkill(skill),
    // preparePresetSkills never calls register; applyPresetDefinitions gets it
    // as a separate argument. Provide a no-op so the seam satisfies RegisterSeam.
    register() { return () => {} },
    log,
  }
}

describe('preset-skills runtime (real dirs)', () => {
  for (const { id, expect: expected } of PRESETS) {
    it(`prepare+apply: preset ${id} yields ${expected} registrations`, async () => {
      const layer = makeLayer()
      const seam = readSeam()
      const prepared = await preparePresetSkills(id, seam)
      expect(prepared.state).toBe('ok')
      expect(prepared.found).toBe(expected)
      expect(prepared.skipped).toEqual([])
      expect(prepared.definitions.length).toBe(expected)
      const applied = await applyPresetDefinitions(prepared, (def) => layer.register(def))
      expect(applied.registered).toBe(expected)
      expect(applied.disposers.length).toBe(expected)
      expect(layer.entries.size).toBe(expected)
      for (const reg of layer.entries.values()) {
        expect(isSkillName(reg.name)).toBe(true)
        expect(typeof reg.description).toBe('string')
        expect(reg.description.length).toBeGreaterThan(0)
        expect(typeof reg.invocation.modelInvocable).toBe('boolean')
        expect(typeof reg.invocation.userInvocable).toBe('boolean')
        expect(reg.provider).toBe(PROVIDER)
        expect(reg.source).toBe('runtime')
        expect(reg.resourceBase.kind).toBe('directory')
        expect(reg.resourceBase.path).toBe(dirname(reg.path))
        expect(typeof reg.content).toBe('string')
        expect(reg.path.startsWith(join(ROOT, '.agent-presets', id))).toBe(true)
      }
    })
  }

  it('v4.2 switch convergence: B replaces A in one shared layer', async () => {
    const layer = makeLayer()
    const seam = readSeam()
    const researchPrepared = await preparePresetSkills('research', seam)
    const researchApplied = await applyPresetDefinitions(researchPrepared, (def) => layer.register(def))
    expect(researchApplied.registered).toBe(20)
    expect([...layer.entries.keys()]).toContain('nature-writing')

    const teacherPrepared = await preparePresetSkills('teacher', seam)
    expect(teacherPrepared.definitions.length).toBe(5)
    // before dispose: still research-only
    expect([...layer.entries.keys()]).toContain('nature-writing')
    expect([...layer.entries.keys()]).not.toContain('chaoxing-suite')
    for (const disposer of researchApplied.disposers) disposer()
    expect(layer.entries.size).toBe(0)
    const teacherApplied = await applyPresetDefinitions(teacherPrepared, (def) => layer.register(def))
    expect(teacherApplied.registered).toBe(5)
    const names = [...layer.entries.keys()]
    expect(names).toContain('chaoxing-suite')
    expect(names).not.toContain('nature-writing')
    expect(layer.entries.size).toBe(5)
    expect(() => teacherApplied.disposers[0]?.()).not.toThrow()
  })

  it('unknown preset id folds into a prepared resolve-failed result', async () => {
    const prepared = await preparePresetSkills('no-such-preset', {
      ...readSeam(),
      async resolveSkillsDir() { return undefined },
    })
    expect(prepared.state).toBe('resolve-failed')
    expect(prepared.definitions.length).toBe(0)
  })

  it('missing preset id yields no-preset result without touching anything', async () => {
    const prepared = await preparePresetSkills(undefined, {
      async resolveSkillsDir() { throw new Error('must not be called') },
      async discover() { throw new Error('must not be called') },
      async load() { return undefined },
      register() { return () => {} },
      log() {},
    })
    expect(prepared.state).toBe('no-preset')
  })

  it('toRegistration maps a parsed skill fully', () => {
    const parsed = parseSkillSource(
      ['---', 'name: demo-skill', 'description: A demo.', 'whenToUse: When X.', 'disable-model-invocation: true', '---', 'Body text'].join('\n'),
      '/p/demo-skill/SKILL.md',
    )
    expect(parsed).toBeTruthy()
    const reg = toRegistration(parsed!)
    expect(reg.name).toBe('demo-skill')
    expect(reg.whenToUse).toBe('When X.')
    expect(reg.invocation.modelInvocable).toBe(false)
    expect(reg.invocation.userInvocable).toBe(true)
    expect(reg.content).toBe('Body text')
    expect(reg.resourceBase.path).toBe('/p/demo-skill')
  })

  it('parseSkillSource rejects missing name / non-kebab name', () => {
    expect(parseSkillSource('---\ndescription: nope\n---\n')).toBeUndefined()
    expect(parseSkillSource('---\nname: Bad Name\n---\n')).toBeUndefined()
  })
})
