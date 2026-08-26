/**
 * Write-time enforcement of the session transition table.
 *
 * `TRANSITIONS` in `#domains/school/sessions/sessionEvents.mjs` was authoritative
 * only inside `reduceSession`, at READ time, where an illegal event is recorded
 * in `errors[]` and skipped. Read-total is right for reads — a corrupt log must
 * not crash the one record of a child's work — but it was silently extended to
 * writes, where it means the log can accept a fact that never happened. A session
 * recorded an `issued` event whose artifact never existed, and became permanently
 * unprintable.
 *
 * Every writer converges on `appendEvent`, so that is where legality is decided.
 */
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { YamlWorkSessionDatastore } from './YamlWorkSessionDatastore.mjs';
import { createEvent, statesAccepting, TRANSITIONS } from '#domains/school/sessions/sessionEvents.mjs';

const withStore = async (fn) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'school-session-transitions-'));
  try {
    await fn(new YamlWorkSessionDatastore({
      configService: { getHouseholdPath: (suffix) => path.join(root, suffix) },
      logger: { info() {}, warn() {}, error() {} },
    }), root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

const built = (raw) => {
  const { errors, event } = createEvent(raw);
  expect(errors).toEqual([]);
  return event;
};

describe('YamlWorkSessionDatastore transition enforcement', () => {
  it('refuses an event the transition table does not allow from the current state', async () => {
    await withStore(async (store) => {
      await store.appendEvent('ses_x', built({
        type: 'created', at: '2026-08-25T17:00:00.000Z', sessionId: 'ses_x',
        learnerId: 'learner4', unitId: 'math.01',
      }));
      // Confirmed against the table: TRANSITIONS.created is
      // issued|media_dispatched|launch_dispatched|program_dispatched|abandoned.
      // 'graded' is unreachable from 'created' without an intervening submission.
      expect(TRANSITIONS.created).not.toContain('graded');
      await expect(store.appendEvent('ses_x', built({
        type: 'graded', at: '2026-08-25T17:05:00.000Z', sessionId: 'ses_x',
        attemptIds: ['att_1'], percent: 90,
      }))).rejects.toThrow(/ILLEGAL_TRANSITION|illegal transition/i);
    });
  });

  it('carries code ILLEGAL_TRANSITION and does not write the refused event', async () => {
    await withStore(async (store) => {
      await store.appendEvent('ses_y', built({
        type: 'created', at: '2026-08-25T17:00:00.000Z', sessionId: 'ses_y',
        learnerId: 'learner4', unitId: 'math.01',
      }));
      const err = await store.appendEvent('ses_y', built({
        type: 'graded', at: '2026-08-25T17:05:00.000Z', sessionId: 'ses_y',
        attemptIds: ['att_1'], percent: 90,
      })).catch((e) => e);
      expect(err.name).toBe('DomainInvariantError');
      expect(err.code).toBe('ILLEGAL_TRANSITION');
      // The log is evidence: a refused event must leave no trace of having happened.
      const events = await store.readEvents('ses_y');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('created');
    });
  });

  it('still accepts a legal transition', async () => {
    await withStore(async (store) => {
      await store.appendEvent('ses_z', built({
        type: 'created', at: '2026-08-25T17:00:00.000Z', sessionId: 'ses_z',
        learnerId: 'learner4', unitId: 'math.01',
      }));
      const stored = await store.appendEvent('ses_z', built({
        type: 'issued', at: '2026-08-25T17:01:00.000Z', sessionId: 'ses_z', artifactId: 'art_1',
      }));
      expect(stored).toMatchObject({ type: 'issued', seq: 2 });
      expect(await store.readEvents('ses_z')).toHaveLength(2);
    });
  });

  it('keeps the queue alive after a refusal', async () => {
    await withStore(async (store) => {
      await store.appendEvent('ses_q', built({
        type: 'created', at: '2026-08-25T17:00:00.000Z', sessionId: 'ses_q',
        learnerId: 'learner4', unitId: 'math.01',
      }));
      await expect(store.appendEvent('ses_q', built({
        type: 'graded', at: '2026-08-25T17:02:00.000Z', sessionId: 'ses_q',
        attemptIds: ['att_1'], percent: 90,
      }))).rejects.toThrow();
      const stored = await store.appendEvent('ses_q', built({
        type: 'issued', at: '2026-08-25T17:03:00.000Z', sessionId: 'ses_q', artifactId: 'art_1',
      }));
      // seq 2, not 3: the refused event consumed no sequence number.
      expect(stored.seq).toBe(2);
    });
  });

  it('derives statesAccepting from TRANSITIONS rather than a second table', () => {
    expect([...statesAccepting('issued')].sort()).toEqual(['created', 'media_completed']);
    // Every declared edge must be reflected back by the inverse index.
    Object.entries(TRANSITIONS).forEach(([state, types]) => {
      types.forEach((type) => expect(statesAccepting(type).has(state)).toBe(true));
    });
    expect(statesAccepting('no_such_event').size).toBe(0);
  });
});
