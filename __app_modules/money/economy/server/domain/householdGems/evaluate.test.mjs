// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { evaluateHouseholdGems, normalizeGemRules, DEFAULT_GEM_RULES } from './evaluate.mjs';

const rules = normalizeGemRules(DEFAULT_GEM_RULES);
const kid = (id, over = {}) => ({ learnerId: id, away: false, school: 'met', rings: 300, read: true, ...over });
const byId = (out) => Object.fromEntries(out.gems.map((g) => [g.id, g]));

describe('evaluateHouseholdGems', () => {
  it('lights every rule gem when every kid meets it; ruby needs an award', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a'), kid('b')], { awarded: new Set() }));
    expect([out.emerald.state, out.amethyst.state, out.sapphire.state, out.ruby.state])
      .toEqual(['lit', 'lit', 'lit', 'dim']);
  });
  it('one kid short leaves the gem dim, naming who', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a'), kid('b', { read: false })], { awarded: new Set() }));
    expect(out.sapphire).toMatchObject({ state: 'dim', waitingOn: ['b'] });
  });
  it('no-work-today excuses a kid from emerald only', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a'), kid('b', { school: 'excused', rings: 0 })], { awarded: new Set() }));
    expect(out.emerald.state).toBe('lit');
    expect(out.amethyst.state).toBe('dim');
  });
  it('an away kid is excused from everything', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a'), kid('b', { away: true, school: 'missed', rings: 0, read: false })], { awarded: new Set() }));
    expect([out.emerald.state, out.amethyst.state, out.sapphire.state]).toEqual(['lit', 'lit', 'lit']);
  });
  it('everyone excused stays dim rather than lighting for free', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a', { away: true }), kid('b', { away: true })], { awarded: new Set() }));
    expect(out.emerald.state).toBe('dim');
  });
  it('an unreadable source is unknown, never lit or missed', () => {
    const out = byId(evaluateHouseholdGems(rules, [kid('a'), kid('b', { rings: null })], { awarded: new Set() }));
    expect(out.amethyst.state).toBe('unknown');
  });
  it('the ring target is inclusive', () => {
    const at = (rings) => byId(evaluateHouseholdGems(rules, [kid('a', { rings })], { awarded: new Set() })).amethyst.state;
    expect([at(249), at(250)]).toEqual(['dim', 'lit']);
  });
  it('ruby is lit once awarded for the day', () => {
    expect(byId(evaluateHouseholdGems(rules, [kid('a')], { awarded: new Set(['ruby']) })).ruby.state).toBe('lit');
  });
  it('no roster: every gem dim', () => {
    expect(evaluateHouseholdGems(rules, [], { awarded: new Set() }).gems.every((g) => g.state === 'dim')).toBe(true);
  });
});

describe('normalizeGemRules', () => {
  it('fills defaults, keeps order and drops unknown kinds', () => {
    const r = normalizeGemRules({ gems: [{ id: 'amethyst', kind: 'all-rings' }, { id: 'x', kind: 'nope' }] });
    expect(r.map((g) => [g.id, g.at ?? null])).toEqual([['amethyst', 250]]);
  });
});
