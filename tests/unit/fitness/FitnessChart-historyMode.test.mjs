import { describe, it, expect, beforeAll } from '@jest/globals';

let computeHistorySnapshotAction;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/widgets/FitnessChart/historyMode.js');
  computeHistorySnapshotAction = mod.computeHistorySnapshotAction;
});

describe('computeHistorySnapshotAction', () => {
  it('returns keep when sessionId is unchanged', () => {
    expect(computeHistorySnapshotAction('abc', 'abc', false)).toEqual({ action: 'keep' });
  });

  it('returns keep on first mount (null -> session)', () => {
    expect(computeHistorySnapshotAction(null, 'abc', false)).toEqual({ action: 'keep' });
  });

  it('returns clear on live-session swap (abc -> xyz)', () => {
    expect(computeHistorySnapshotAction('abc', 'xyz', false)).toEqual({ action: 'clear' });
  });

  it('returns enter-history on session end (abc -> null)', () => {
    expect(computeHistorySnapshotAction('abc', null, false)).toEqual({ action: 'enter-history' });
  });

  it('returns enter-history on session end (abc -> undefined)', () => {
    expect(computeHistorySnapshotAction('abc', undefined, false)).toEqual({ action: 'enter-history' });
  });

  it('treats isHistorical=true as keep regardless of sessionId value', () => {
    expect(computeHistorySnapshotAction('abc', 'xyz', true)).toEqual({ action: 'keep' });
    expect(computeHistorySnapshotAction('abc', null, true)).toEqual({ action: 'keep' });
  });

  it('returns keep when both sides are nullish', () => {
    expect(computeHistorySnapshotAction(null, null, false)).toEqual({ action: 'keep' });
    expect(computeHistorySnapshotAction(undefined, null, false)).toEqual({ action: 'keep' });
  });
});
