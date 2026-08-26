import { describe, expect, it, vi } from 'vitest';
import { assertNotStale } from './staleSaveGuard.mjs';
import { SetAssignments } from './SetAssignments.mjs';

describe('staleSaveGuard', () => {
  it('is a no-op when baseUpdatedAt is undefined', () => {
    const current = { updatedAt: '2026-09-01T00:00:00.000Z' };
    expect(() => assertNotStale(current, undefined)).not.toThrow();
  });

  it('passes when current updatedAt matches baseUpdatedAt', () => {
    const timestamp = '2026-09-01T00:00:00.000Z';
    const current = { updatedAt: timestamp };
    expect(() => assertNotStale(current, timestamp)).not.toThrow();
  });

  it('throws ValidationError when timestamps disagree', () => {
    const current = { updatedAt: '2026-09-02T00:00:00.000Z' };
    const baseUpdatedAt = '2026-09-01T00:00:00.000Z';
    expect(() => assertNotStale(current, baseUpdatedAt))
      .toThrow('Assignments changed since you loaded them');
  });

  it('sets error code to STALE_SAVE', () => {
    const current = { updatedAt: '2026-09-02T00:00:00.000Z' };
    try {
      assertNotStale(current, '2026-09-01T00:00:00.000Z');
    } catch (err) {
      expect(err.code).toBe('STALE_SAVE');
    }
  });

  it('sets error status to 409', () => {
    const current = { updatedAt: '2026-09-02T00:00:00.000Z' };
    try {
      assertNotStale(current, '2026-09-01T00:00:00.000Z');
    } catch (err) {
      expect(err.status).toBe(409);
    }
  });

  it('treats missing current.updatedAt as null', () => {
    const current = {}; // no updatedAt
    const baseUpdatedAt = null;
    expect(() => assertNotStale(current, baseUpdatedAt)).not.toThrow();
  });

  it('throws when current has no updatedAt but baseUpdatedAt is a timestamp', () => {
    const current = {}; // no updatedAt, treated as null
    const baseUpdatedAt = '2026-09-01T00:00:00.000Z';
    expect(() => assertNotStale(current, baseUpdatedAt))
      .toThrow('Assignments changed since you loaded them');
  });
});

describe('SetAssignments stale-save guard integration', () => {
  it('does not call assignments.get() when baseUpdatedAt is omitted (opts out of guard)', async () => {
    const store = { get: vi.fn(), put: vi.fn(async (r) => r) };
    const uc = new SetAssignments({ assignments: store, grownUps: { assert: () => true } });
    await uc.execute({ learnerId: 'learner3', courses: ['math'], units: [], assignedBy: 'kckern' });
    // No baseUpdatedAt provided — the guard is not active, so get() must not be called
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalled();
  });

  it('calls assignments.get() when baseUpdatedAt is provided', async () => {
    const store = { get: vi.fn(async () => ({ updatedAt: '2026-09-01T00:00:00.000Z' })), put: vi.fn(async (r) => r) };
    const uc = new SetAssignments({ assignments: store, grownUps: { assert: () => true } });
    await uc.execute({ learnerId: 'learner3', courses: ['math'], units: [], assignedBy: 'kckern', baseUpdatedAt: '2026-09-01T00:00:00.000Z' });
    expect(store.get).toHaveBeenCalledWith('learner3');
    expect(store.put).toHaveBeenCalled();
  });
});
