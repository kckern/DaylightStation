import { describe, it, expect } from 'vitest';
import {
  validateCheckpoints, dueCheckpoint, seekCeilingFor, clearedSetFrom, MAX_CHECKPOINTS,
} from '#domains/school/mediaCheckpoints.mjs';

const two = [{ at: 312, items: ['ast3-q4', 'ast3-q7'] }, { at: 741, items: ['ast3-q9'] }];
const bankItemIds = new Set(['ast3-q4', 'ast3-q7', 'ast3-q9']);

describe('validateCheckpoints: shape', () => {
  it('normalizes a well-formed block and stamps deterministic ids', () => {
    const r = validateCheckpoints(two);
    expect(r.errors).toEqual([]);
    expect(r.checkpoints).toEqual([
      { id: 'cp-312', at: 312, items: ['ast3-q4', 'ast3-q7'] },
      { id: 'cp-741', at: 741, items: ['ast3-q9'] },
    ]);
  });

  it('is deterministic — the same input twice yields identical ids, with no clock or counter', () => {
    expect(validateCheckpoints(two).checkpoints.map((c) => c.id))
      .toEqual(validateCheckpoints(two).checkpoints.map((c) => c.id));
    expect(validateCheckpoints([{ at: 5, items: ['a'] }]).checkpoints[0].id).toBe('cp-5');
  });

  it('copies the items array rather than aliasing the authoring input', () => {
    const raw = [{ at: 10, items: ['a'] }];
    const { checkpoints } = validateCheckpoints(raw);
    expect(checkpoints[0].items).not.toBe(raw[0].items);
    checkpoints[0].items.push('b');
    expect(raw[0].items).toEqual(['a']);
  });

  it('refuses a non-array', () => {
    for (const bad of [undefined, null, 'x', 42, { at: 1 }]) {
      expect(validateCheckpoints(bad).errors[0]).toMatch(/checkpoints must be a non-empty array/);
      expect(validateCheckpoints(bad).checkpoints).toBeUndefined();
    }
  });

  it('refuses an empty array — an empty gate is an authoring mistake, not "no gate"', () => {
    expect(validateCheckpoints([]).errors[0]).toMatch(/non-empty array/);
  });

  it('refuses an entry that is not a mapping', () => {
    expect(validateCheckpoints(['nope']).errors[0]).toMatch(/checkpoints\[0\] must be a mapping/);
  });
});

describe('validateCheckpoints: at', () => {
  it('refuses a missing, zero, or negative at', () => {
    expect(validateCheckpoints([{ items: ['a'] }]).errors[0]).toMatch(/checkpoints\[0\]\.at must be an integer >= 1/);
    expect(validateCheckpoints([{ at: 0, items: ['a'] }]).errors[0]).toMatch(/at must be an integer >= 1/);
    expect(validateCheckpoints([{ at: -3, items: ['a'] }]).errors[0]).toMatch(/at must be an integer >= 1/);
  });

  it('refuses a fractional at — the id is derived from it, so cp-312.5 and cp-312.50 would split a learner\'s cleared row', () => {
    const r = validateCheckpoints([{ at: 312.5, items: ['a'] }]);
    expect(r.errors[0]).toMatch(/at must be an integer >= 1/);
    expect(r.checkpoints).toBeUndefined();
  });

  it('refuses a numeric string at — YAML quoting is not a licence to skip the type', () => {
    expect(validateCheckpoints([{ at: '312', items: ['a'] }]).errors[0]).toMatch(/at must be an integer >= 1/);
  });

  it('demands strictly ascending at, naming both offending indexes', () => {
    const desc = validateCheckpoints([{ at: 741, items: ['a'] }, { at: 312, items: ['b'] }]);
    expect(desc.errors[0]).toMatch(/checkpoints\[1\]\.at .*must be greater than checkpoints\[0\]\.at/);
    const equal = validateCheckpoints([{ at: 312, items: ['a'] }, { at: 312, items: ['b'] }]);
    expect(equal.errors[0]).toMatch(/checkpoints\[1\]\.at .*checkpoints\[0\]\.at/);
  });
});

describe('validateCheckpoints: items', () => {
  it('refuses missing, empty, or non-string items', () => {
    expect(validateCheckpoints([{ at: 1 }]).errors[0]).toMatch(/checkpoints\[0\]\.items must be a non-empty array of item ids/);
    expect(validateCheckpoints([{ at: 1, items: [] }]).errors[0]).toMatch(/items must be a non-empty array/);
    expect(validateCheckpoints([{ at: 1, items: ['  '] }]).errors[0]).toMatch(/items must be a non-empty array/);
    expect(validateCheckpoints([{ at: 1, items: [7] }]).errors[0]).toMatch(/items must be a non-empty array/);
  });

  it('resolves item ids against the injected bank set', () => {
    expect(validateCheckpoints(two, { bankItemIds }).errors).toEqual([]);
    const r = validateCheckpoints([{ at: 312, items: ['ast3-q4', 'ghost'] }], { bankItemIds });
    expect(r.errors).toEqual(["checkpoints[0].items: 'ghost' not found in bank"]);
    expect(r.checkpoints).toBeUndefined();
  });

  it('checks shape only when no set is injected — a pure domain function has no repository', () => {
    expect(validateCheckpoints([{ at: 312, items: ['ghost'] }]).errors).toEqual([]);
    expect(validateCheckpoints([{ at: 312, items: ['ghost'] }], {}).errors).toEqual([]);
    // A non-Set is not a set to resolve against, and must not be read as "resolve nothing".
    expect(validateCheckpoints([{ at: 312, items: ['ghost'] }], { bankItemIds: ['ghost'] }).errors).toEqual([]);
  });
});

describe('validateCheckpoints: count ceiling', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ at: i + 1, items: ['a'] }));

  it('pins the ceiling exactly — MAX_CHECKPOINTS is fine, one more is a typo', () => {
    expect(validateCheckpoints(many(MAX_CHECKPOINTS)).errors).toEqual([]);
    expect(validateCheckpoints(many(MAX_CHECKPOINTS + 1)).errors[0])
      .toMatch(/checkpoints must hold at most 20 entries/);
    expect(MAX_CHECKPOINTS).toBe(20);
  });

  it('refuses an absurd count rather than publishing an unwatchable lesson', () => {
    expect(validateCheckpoints(many(400)).errors[0]).toMatch(/at most/);
  });
});

describe('dueCheckpoint — THE gate predicate', () => {
  const { checkpoints } = validateCheckpoints(two);

  it('returns null before the first checkpoint', () => {
    expect(dueCheckpoint(0, checkpoints, new Set())).toBeNull();
    expect(dueCheckpoint(311.9, checkpoints, new Set())).toBeNull();
  });

  it('fires at exactly the boundary — 312 fires at 312.0, inclusive', () => {
    expect(dueCheckpoint(312, checkpoints, new Set())).toBe(checkpoints[0]);
    expect(dueCheckpoint(312.0, checkpoints, new Set()).id).toBe('cp-312');
  });

  it('returns the FIRST uncleared one, not the nearest — a seek past two gates still owes both', () => {
    expect(dueCheckpoint(900, checkpoints, new Set()).id).toBe('cp-312');
    expect(dueCheckpoint(900, checkpoints, new Set(['cp-312'])).id).toBe('cp-741');
  });

  it('returns null when every passed checkpoint is cleared', () => {
    expect(dueCheckpoint(500, checkpoints, new Set(['cp-312']))).toBeNull();
    expect(dueCheckpoint(900, checkpoints, new Set(['cp-312', 'cp-741']))).toBeNull();
  });

  it('is null-safe on missing checkpoints or a missing cleared set', () => {
    expect(dueCheckpoint(900, null, new Set())).toBeNull();
    expect(dueCheckpoint(900, [], new Set())).toBeNull();
    expect(dueCheckpoint(900, checkpoints).id).toBe('cp-312');
    expect(dueCheckpoint(null, checkpoints, new Set())).toBeNull();
  });
});

describe('seekCeilingFor', () => {
  const { checkpoints } = validateCheckpoints(two);

  it('is the at of the first uncleared checkpoint', () => {
    expect(seekCeilingFor(checkpoints, new Set())).toBe(312);
    expect(seekCeilingFor(checkpoints, new Set(['cp-312']))).toBe(741);
  });

  it('is null once all are cleared — null means unclamped, never 0', () => {
    expect(seekCeilingFor(checkpoints, new Set(['cp-312', 'cp-741']))).toBeNull();
  });

  it('ignores play position entirely — the ceiling is where the learner MAY reach', () => {
    expect(seekCeilingFor(checkpoints, new Set(['cp-741']))).toBe(312);
  });

  it('is null with no checkpoints at all', () => {
    expect(seekCeilingFor(null, new Set())).toBeNull();
    expect(seekCeilingFor([], new Set())).toBeNull();
  });
});

describe('clearedSetFrom', () => {
  it('collects checkpointIds off the reduced session rows', () => {
    const set = clearedSetFrom([{ checkpointId: 'cp-312', at: 312, attempts: 2 }]);
    expect(set).toBeInstanceOf(Set);
    expect(set.has('cp-312')).toBe(true);
    expect(set.has('cp-741')).toBe(false);
  });

  it('is an empty set for missing or malformed rows, never a throw', () => {
    expect(clearedSetFrom(undefined).size).toBe(0);
    expect(clearedSetFrom(null).size).toBe(0);
    expect(clearedSetFrom([{ at: 1 }, null, 'x']).size).toBe(0);
  });
});
