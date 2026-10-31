// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { recoveryChoices } from './recoveryChoices.js';

const at = minute => `2026-10-31T20:${String(minute).padStart(2, '0')}:00.000Z`;
const point = (revision, kind, minute, battery) => ({ revision, kind, createdAt: at(minute), usable: true,
  artifacts: { snapshot: kind === 'reset' ? null : { hash: `s-${revision}`, bytes: 1 }, battery: battery ? { hash: battery, bytes: 1 } : null } });

describe('recoveryChoices', () => {
  it('lists one entry per distinct battery copy, dated by the copy it restores, newest first', () => {
    // Shaped like the 2026-10-31 incident: baseline/save/recover share save A,
    // a reset, then a run of autosaves that all carry save B.
    const checkpoints = [
      point('base', 'baseline', 50, 'A'), point('exit', 'save', 51, 'A'), point('rec', 'recover', 52, 'A'),
      point('reset', 'reset', 53, null),
      ...Array.from({ length: 14 }, (_, i) => point(`auto${i}`, 'save', 54 + i, 'B')),
      { revision: 'broken', usable: false, error: 'damaged' },
    ];
    expect(recoveryChoices('battery', checkpoints)).toEqual([
      { revision: 'auto13', label: 'In-game save', at: at(67) },
      { revision: 'reset', label: 'New game started', at: at(53) },
      { revision: 'rec', label: 'In-game save', at: at(52) },
    ]);
  });
  it('labels a battery-mode copy without an in-game save as a saved copy, since restoring it loads a snapshot', () => {
    expect(recoveryChoices('battery', [point('legacy', 'baseline', 50, null)])).toEqual([
      { revision: 'legacy', label: 'Restore saved copy', at: at(50) },
    ]);
  });
  it('keeps a state game one entry per copy with the existing labels', () => {
    const checkpoints = [point('one', 'save', 50, null), point('two', 'reset', 51, null)];
    expect(recoveryChoices('state', checkpoints)).toEqual([
      { revision: 'one', label: 'Restore saved copy', at: at(50) },
      { revision: 'two', label: 'Fresh start recorded', at: at(51) },
    ]);
  });
});
