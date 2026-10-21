import { describe, it, expect, vi } from 'vitest';
import { SweepAnswerSheets } from './SweepAnswerSheets.mjs';
import { YamlAllocationStore } from '../../adapters/documents/YamlAllocationStore.mjs';

const NOW = '2026-10-21T09:00:00.000Z';
const OLD = '2026-10-21T06:00:00.000Z';   // 3 hours before NOW
const FRESH = '2026-10-21T08:00:00.000Z'; // one hour before NOW: still inside the 2-hour default

function memoryStore() {
  const files = new Map();
  const io = {
    load: (filePath) => (files.has(filePath) ? structuredClone(files.get(filePath)) : null),
    save: (filePath, content) => { files.set(filePath, structuredClone(content)); },
    list: () => [...files.keys()].map((filePath) => filePath.match(/([^/]+)\.yml$/)?.[1]).filter(Boolean),
  };
  const store = new YamlAllocationStore({ directory: '/docs', io, now: () => NOW });
  return { store, seed: (cardId, records) => io.save(`/docs/cards/${cardId}.yml`, records) };
}

const rec = (cardId, start, end, {
  sessionId = null, unitId, status = 'live', deliveryState = 'delivered', renderedAt = OLD, generation = 1, rev = 'r1',
  learnerId = 'learner_a', documentId = `doc-${start}`, extra = {},
} = {}) => ({
  recordId: `${documentId}@${rev}:v0:${start}-${end}`, cardId, rowRange: { start, end }, documentId, rev, seed: 1,
  variant: 0, learnerId, ...(sessionId ? { sessionId } : {}), ...(unitId ? { unitId } : {}),
  renderedAt, generation, predecessorCardId: null, cardOrigin: 'reuse', identiconVersion: 'v1', cardCapacity: 50,
  deliveryState, deliveredAt: deliveryState === 'delivered' ? renderedAt : null, status, ...extra,
});

function fakeSessions({ events = {}, rows = {} } = {}) {
  return {
    readEvents: async (sessionId) => events[sessionId] ?? [],
    listForLearner: async (learnerId) => rows[learnerId] ?? [],
  };
}

const build = ({ sessions = fakeSessions(), issuedArtifacts = null } = {}) => {
  const { store, seed } = memoryStore();
  const logger = { info: vi.fn(), warn: vi.fn() };
  const sweep = new SweepAnswerSheets({
    allocationStore: store, sessions, issuedArtifacts, clock: () => new Date(NOW), logger,
  });
  return { store, seed, sweep, logger };
};

describe('SweepAnswerSheets — leaks', () => {
  it("vacates the windows a stuck session left on a learner's card, and only those", async () => {
    const sessions = fakeSessions({
      events: { ses_stuck: [{ type: 'created' }, { type: 'failed', stage: 'print' }] },
      rows: { learner_a: [{ sessionId: 'ses_stuck', unitId: 'scripture-unit-1' }] },
    });
    const { store, seed, sweep, logger } = build({ sessions });
    seed('7000001', [
      rec('7000001', 1, 3, { sessionId: 'ses_stuck', deliveryState: 'pending' }),            // leaked
      rec('7000001', 4, 9, { sessionId: 'ses_atlas' }),                                       // delivered
      rec('7000001', 10, 12, { documentId: 'cli-quiz', deliveryState: 'pending' }),           // CLI render
      rec('7000001', 13, 15, { sessionId: 'ses_stuck', deliveryState: 'pending', renderedAt: FRESH, rev: 'r2' }),
    ]);

    const result = await sweep.execute();

    expect(result.leaksRecovered.map((entry) => entry.rows)).toEqual([{ start: 1, end: 3 }]);
    const records = await store.findByCard('7000001');
    expect(records[0]).toMatchObject({ status: 'vacated', unitId: 'scripture-unit-1', vacatedReason: 'leak' });
    expect(records[2]).toMatchObject({ status: 'live', deliveryState: 'pending' });  // never touched
    expect(records[3]).toMatchObject({ status: 'live', deliveryState: 'pending' });  // too recent
    expect(logger.warn).toHaveBeenCalledWith('school.allocation.leak-recovered', expect.objectContaining({
      cardId: '7000001', sessionId: 'ses_stuck', unitId: 'scripture-unit-1',
    }));
  });

  it('leaves a pending window that an issued sheet was printed on', async () => {
    const sessions = fakeSessions({
      events: { ses_quiz: [{ type: 'created' }, { type: 'issued', artifactId: 'art_1' }] },
    });
    const issuedArtifacts = { get: async () => ({ manifest: { allocation: { recordId: 'doc-1@r1:v0:1-3' } } }) };
    const { store, seed, sweep } = build({ sessions, issuedArtifacts });
    seed('5550001', [
      rec('5550001', 1, 3, { sessionId: 'ses_quiz', deliveryState: 'pending' }),
      rec('5550001', 4, 6, { sessionId: 'ses_quiz', deliveryState: 'pending', rev: 'r0', documentId: 'old' }),
    ]);

    const result = await sweep.execute();

    expect(result.leaksRecovered.map((entry) => entry.recordId)).toEqual(['old@r0:v0:4-6']);
    expect((await store.findByCard('5550001'))[0].status).toBe('live');
  });

  it('never calls an issued session a leak when its artifacts cannot be read', async () => {
    const sessions = fakeSessions({ events: { ses_quiz: [{ type: 'issued', artifactId: 'art_1' }] } });
    const { seed, sweep } = build({ sessions, issuedArtifacts: null });
    seed('5550002', [rec('5550002', 1, 3, { sessionId: 'ses_quiz', deliveryState: 'pending' })]);
    expect((await sweep.execute()).leaksRecovered).toEqual([]);
  });

  it('a dry run reports without writing', async () => {
    const { store, seed, sweep } = build();
    seed('7000001', [
      rec('7000001', 1, 3, { sessionId: 'ses_stuck', deliveryState: 'pending' }),
      rec('7000001', 4, 9, { sessionId: 'ses_atlas' }),
    ]);
    const result = await sweep.execute({ dryRun: true });
    expect(result.leaksRecovered).toHaveLength(1);
    expect((await store.findByCard('7000001'))[0].status).toBe('live');
  });
});

describe('SweepAnswerSheets — write-offs and accepted gaps', () => {
  it('writes off a window whose unit was passed, so a same-size sheet may fill it', async () => {
    const sessions = fakeSessions({ rows: { learner_a: [{ sessionId: 'ses_new', unitId: 'scripture-unit-1', outcome: { result: 'passed' } }] } });
    const { store, seed, sweep } = build({ sessions });
    seed('7000001', [
      rec('7000001', 1, 3, { sessionId: 'ses_old', unitId: 'scripture-unit-1', status: 'vacated', deliveryState: 'cancelled' }),
      rec('7000001', 4, 9, { sessionId: 'ses_atlas' }),
    ]);

    const result = await sweep.execute();

    expect(result.writtenOff).toEqual([expect.objectContaining({ rows: { start: 1, end: 3 }, reason: 'unit-passed' })]);
    expect(result.gapsAccepted).toEqual([]);
    expect((await store.findByCard('7000001'))[0]).toMatchObject({ writtenOffReason: 'unit-passed' });
  });

  it('holds a vacated window on the current card while its unit is still to do', async () => {
    const { seed, sweep } = build();
    seed('7000001', [
      rec('7000001', 1, 3, { sessionId: 'ses_old', unitId: 'scripture-unit-1', status: 'vacated', deliveryState: 'cancelled' }),
      rec('7000001', 4, 9, { sessionId: 'ses_atlas' }),
    ]);
    expect((await sweep.execute()).writtenOff).toEqual([]);
  });

  it('accepts a gap, once, for a window stranded below later sheets on a card the child moved off', async () => {
    const { seed, sweep, logger } = build();
    seed('7000002', [
      rec('7000002', 1, 6, { sessionId: 'ses_a' }),
      rec('7000002', 7, 9, { sessionId: 'ses_old', status: 'vacated', deliveryState: 'cancelled' }),
      rec('7000002', 10, 15, { sessionId: 'ses_b' }),
      rec('7000002', 16, 18, { sessionId: 'ses_old', status: 'vacated', deliveryState: 'cancelled', rev: 'r2' }),
    ]);
    seed('7000001', [rec('7000001', 1, 6, { sessionId: 'ses_c', generation: 2 })]);

    const first = await sweep.execute();
    expect(first.writtenOff.map((entry) => entry.rows.start)).toEqual([7, 16]);
    expect(first.gapsAccepted.map((entry) => entry.rows)).toEqual([{ start: 7, end: 9 }]);
    expect(logger.warn).toHaveBeenCalledWith('school.allocation.gap-accepted', expect.objectContaining({ cardId: '7000002' }));

    const second = await sweep.execute();
    expect(second.writtenOff).toEqual([]);
    expect(second.gapsAccepted).toEqual([]);
  });
});

describe('SweepAnswerSheets.vacateSession', () => {
  it("vacates an abandoned session's off-paper windows straight away, back-filling its unit", async () => {
    const { store, seed, sweep } = build();
    seed('7000001', [
      rec('7000001', 1, 3, { sessionId: 'ses_stuck', deliveryState: 'pending', renderedAt: FRESH }),
      rec('7000001', 4, 9, { sessionId: 'ses_atlas', deliveryState: 'pending', renderedAt: FRESH }),
    ]);

    const vacated = await sweep.vacateSession({ sessionId: 'ses_stuck', unitId: 'scripture-unit-1' });

    expect(vacated.map((entry) => entry.rows)).toEqual([{ start: 1, end: 3 }]);
    const records = await store.findByCard('7000001');
    expect(records[0]).toMatchObject({ status: 'vacated', unitId: 'scripture-unit-1', vacatedReason: 'abandoned' });
    expect(records[1].status).toBe('live');
  });

  it('never throws into the abandon that called it', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const broken = {
      vacate: async () => null, writeOff: async () => null,
      listCardIds: async () => { throw new Error('cards unreadable'); },
    };
    const sweep = new SweepAnswerSheets({ allocationStore: broken, sessions: fakeSessions(), logger });
    await expect(sweep.vacateSession({ sessionId: 'ses_x' })).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('school.allocation.session-vacate-failed', {
      sessionId: 'ses_x', error: 'cards unreadable',
    });
  });
});
