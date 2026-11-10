import { describe, it, expect } from 'vitest';
import { filterDigest } from './filterDigest.mjs';

describe('filterDigest', () => {
  const refined = { cues: [{ id: 'a', in: 1 }], scenes: [] };
  it('is stable across key order and ignores review marks', () => {
    const a = filterDigest({ refined, override: { cueOverrides: { a: { effect: 'off' } }, review: { 'cue:a': { by: 'x' } } } });
    const b = filterDigest({ refined: { scenes: [], cues: [{ in: 1, id: 'a' }] }, override: { cueOverrides: { a: { effect: 'off' } } } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
  it('changes when a ruling changes', () => {
    expect(filterDigest({ refined, override: {} })).not.toBe(filterDigest({ refined, override: { cueOverrides: { a: { startMs: 1 } } } }));
  });
});

describe('filterDigest and certification', () => {
  it('ignores the stored certification (a sign-off must not make the audit stale)', () => {
    const refined = { cues: [{ id: 'a' }], certification: { level: 'machine' } };
    expect(filterDigest({ refined, override: {} })).toBe(filterDigest({ refined: { ...refined, certification: { level: 'parent', parent: { by: 'p' } } }, override: {} }));
  });
});

describe('filterDigest and bleep level', () => {
  it('a bleep level change does not make the audit stale', () => {
    const refined = { cues: [{ id: 'a' }] };
    const o = (lvl) => ({ profilePatch: { languageWords: { x: 'mute' }, ...(lvl == null ? {} : { bleepLevel: lvl }) } });
    expect(filterDigest({ refined, override: o(0.4) })).toBe(filterDigest({ refined, override: o(null) }));
    expect(filterDigest({ refined, override: o(null) })).not.toBe(filterDigest({ refined, override: { profilePatch: { languageWords: { x: 'bleep' } } } }));
  });
});
