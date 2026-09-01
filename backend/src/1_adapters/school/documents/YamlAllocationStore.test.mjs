/**
 * YamlAllocationStore — per-card YAML persistence for OMR allocation records
 * (spec §5.4). Mirrors `YamlRemediationSessionRepository`'s write-chain +
 * injected-io conventions; exercises the domain's `checkCollision`/
 * `supersedes` rules at the storage boundary.
 */
import { describe, it, expect } from 'vitest';
import { YamlAllocationStore } from './YamlAllocationStore.mjs';

/** In-memory `io` fake keyed by full file path — no filesystem needed. */
function fakeIo() {
  const store = new Map();
  return {
    store,
    io: {
      load: (filePath) => (store.has(filePath) ? structuredClone(store.get(filePath)) : null),
      save: (filePath, content) => { store.set(filePath, structuredClone(content)); },
      list: () => [...store.keys()].map((filePath) => filePath.match(/([^/]+)\.yml$/)?.[1]).filter(Boolean),
    },
  };
}

/**
 * Builds a deterministic rng for `generateCardId` (spec §5.2: 7 digits,
 * `Math.floor(rng() * 10)` per digit). `attempts` is an array of 7-digit
 * arrays, one per `generateCardId` call; each digit `d` is encoded as a
 * single rng() draw landing in `[d/10, (d+1)/10)`.
 */
function scriptedRng(attempts) {
  let attempt = 0;
  let pos = 0;
  return () => {
    const digits = attempts[attempt];
    if (!digits) throw new Error(`scriptedRng exhausted after ${attempt} attempts`);
    const value = digits[pos] / 10 + 0.05;
    pos += 1;
    if (pos === digits.length) { pos = 0; attempt += 1; }
    return value;
  };
}

const request = (overrides = {}) => ({
  documentId: 'us-states-quiz-3',
  rev: 'abc123',
  seed: 91242,
  variant: 0,
  rowRange: { start: 1, end: 10 },
  ...overrides,
});

describe('constructor', () => {
  it('requires a non-empty directory', () => {
    expect(() => new YamlAllocationStore({})).toThrow(/directory/);
    expect(() => new YamlAllocationStore({ directory: '' })).toThrow(/directory/);
  });
});

describe('allocate — explicit cardId', () => {
  it('persists a record with a deterministic recordId and returns it', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z' });
    const record = await store.allocate({ cardId: '1234567', request: request({ learnerId: 'kid-1' }) });

    expect(record).toEqual({
      recordId: 'us-states-quiz-3@abc123:v0:1-10',
      cardId: '1234567',
      rowRange: { start: 1, end: 10 },
      documentId: 'us-states-quiz-3',
      rev: 'abc123',
      seed: 91242,
      variant: 0,
      learnerId: 'kid-1',
      renderedAt: '2026-08-04T00:00:00.000Z',
      generation: 1,
      predecessorCardId: null,
      identiconVersion: 'v1',
      deliveryState: 'pending',
      deliveredAt: null,
      cardCapacity: 50,
      status: 'live',
    });
    expect(await store.findByCard('1234567')).toEqual([record]);
  });

  it('omits learnerId entirely for an anonymous render', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const record = await store.allocate({ cardId: '1234567', request: request() });
    expect(record.learnerId).toBeUndefined();
    expect('learnerId' in record).toBe(false);
  });

  it('validates the request shape', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io });
    await expect(store.allocate({ cardId: '1234567', request: {} })).rejects.toThrow(/documentId/);
    await expect(store.allocate({ cardId: '1234567', request: request({ seed: 'nope' }) })).rejects.toThrow(/seed/);
    await expect(store.allocate({
      cardId: '1234567', request: request({ rowRange: { start: 10, end: 1 } }),
    })).rejects.toThrow(/rowRange/);
  });
});

describe('findReusableCard', () => {
  it('continues a settled learner card at its next untouched row', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z' });
    const first = await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', rowRange: { start: 1, end: 6 } }),
    });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 6 })).toBeNull();
    await store.updateStatus({ cardId: first.cardId, recordId: first.recordId, status: 'satisfied' });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 6 })).toEqual({
      cardId: '1234567', startRow: 7,
    });
  });

  it('mints instead when the next worksheet would cross row 50', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io });
    const record = await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', rowRange: { start: 45, end: 50 } }),
    });
    await store.updateStatus({ cardId: record.cardId, recordId: record.recordId, status: 'satisfied' });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 1 })).toBeNull();
  });

  it('until_full appends another live worksheet for the same learner', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-04T10:00:00.000Z' });
    await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', rowRange: { start: 1, end: 6 } }),
    });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 8, reuse: 'until_full' }))
      .toEqual({ cardId: '1234567', startRow: 7 });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 8, reuse: 'after_scan' }))
      .toBeNull();
  });

  it('school_day does not carry a card into another local date', async () => {
    const { io } = fakeIo();
    let now = '2026-08-04T23:59:00.000Z';
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => now });
    await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', rowRange: { start: 1, end: 6 } }),
    });
    now = '2026-08-05T00:01:00.000Z';
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 6, reuse: 'school_day' })).toBeNull();
  });

  it('never always requests a fresh card', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io });
    await store.allocate({ cardId: '1234567', request: request({ learnerId: 'learner3' }) });
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 1, reuse: 'never' })).toBeNull();
  });
});

describe('allocate — fresh cardId generation (spec §5.2)', () => {
  it('generates a random 7-digit cardId via the injected rng', async () => {
    const { io } = fakeIo();
    const rng = scriptedRng([[4, 8, 2, 9, 3, 0, 6]]);
    const store = new YamlAllocationStore({ directory: '/docs', io, rng, now: () => 'ts' });
    const record = await store.allocate({ request: request() });
    expect(record.cardId).toBe('4829306');
  });

  it('retries on a store collision (id already has records on disk), bounded', async () => {
    const { io } = fakeIo();
    const rng = scriptedRng([[1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1]]);
    const store = new YamlAllocationStore({ directory: '/docs', io, rng, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request() }); // occupies the first candidate id

    const record = await store.allocate({ request: request({ documentId: 'other-doc' }) });
    expect(record.cardId).toBe('7654321');
  });

  it('throws after a bounded number of attempts all colliding', async () => {
    const { io } = fakeIo();
    const alwaysSame = () => [1, 1, 1, 1, 1, 1, 1];
    const rng = scriptedRng(Array.from({ length: 25 }, alwaysSame));
    const store = new YamlAllocationStore({ directory: '/docs', io, rng, now: () => 'ts' });
    await store.allocate({ cardId: '1111111', request: request() }); // occupies the only id the rng ever draws

    await expect(store.allocate({ request: request({ documentId: 'other-doc' }) }))
      .rejects.toMatchObject({ code: 'ALLOCATION_CARD_ID_EXHAUSTED' });
  });
});

describe('allocateNext — atomic monotonic whole-worksheet allocation', () => {
  it('serializes racing selections into non-overlapping ranges on one card', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({
      directory: '/docs', io, rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5]]), now: () => '2026-08-31T10:00:00.000Z',
    });
    const [first, second] = await Promise.all([
      store.allocateNext({ request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }) }),
      store.allocateNext({ request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }) }),
    ]);
    expect(first.record.cardId).toBe('8684155');
    expect(second.record.cardId).toBe('8684155');
    expect(first.record.rowRange).toEqual({ start: 1, end: 6 });
    expect(second.record.rowRange).toEqual({ start: 7, end: 9 });
  });

  it('preserves explicit after_scan behavior inside the atomic allocator', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({
      directory: '/docs', io,
      rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8]]),
      now: () => '2026-08-31T10:00:00.000Z',
    });
    const first = await store.allocateNext({
      request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }),
      policy: { reuse: 'after_scan' },
    });
    // Still-live work blocks reuse under the conservative legacy policy.
    const concurrent = await store.allocateNext({
      request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }),
      policy: { reuse: 'after_scan' },
    });
    expect(concurrent.record.cardId).toBe('9427608');

    await store.updateStatus({
      cardId: concurrent.record.cardId, recordId: concurrent.record.recordId, status: 'satisfied',
    });
    const settledReuse = await store.allocateNext({
      request: request({ documentId: 'science', learnerId: 'user_4', rowRange: { start: 1, end: 2 } }),
      policy: { reuse: 'after_scan' },
    });
    expect(settledReuse.record.cardId).toBe(concurrent.record.cardId);
    expect(settledReuse.record.rowRange).toEqual({ start: 4, end: 5 });
    expect(first.record.cardId).toBe('8684155');
  });

  it('preserves explicit school_day reuse but rolls forward on a new local date', async () => {
    const { io } = fakeIo();
    let now = '2026-08-31T10:00:00.000Z';
    const store = new YamlAllocationStore({
      directory: '/docs', io,
      rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8]]),
      now: () => now,
    });
    const first = await store.allocateNext({
      request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }),
      policy: { reuse: 'school_day' },
    });
    const sameDay = await store.allocateNext({
      request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }),
      policy: { reuse: 'school_day' },
    });
    expect(sameDay.record.cardId).toBe(first.record.cardId);
    expect(sameDay.record.rowRange).toEqual({ start: 7, end: 9 });

    now = '2026-09-01T10:00:00.000Z';
    const nextDay = await store.allocateNext({
      request: request({ documentId: 'science', learnerId: 'user_4', rowRange: { start: 1, end: 2 } }),
      policy: { reuse: 'school_day' },
    });
    expect(nextDay.record.cardId).toBe('9427608');
    expect(nextDay.record.rowRange).toEqual({ start: 1, end: 2 });
  });

  it('rolls the whole worksheet to a distinct successor, seals the tail on delivery, and never returns', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({
      directory: '/docs',
      io,
      rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8]]),
      now: () => '2026-08-31T10:00:00.000Z',
    });
    const first = await store.allocateNext({
      request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 45 } }),
    });
    await store.markDelivered({ cardId: first.record.cardId, recordId: first.record.recordId });
    const successor = await store.allocateNext({
      request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }),
    });
    expect(successor.record).toMatchObject({
      cardId: '9427608', rowRange: { start: 1, end: 6 }, generation: 2,
      predecessorCardId: '8684155', identiconVersion: 'v1', deliveryState: 'pending',
    });
    await store.markDelivered({ cardId: successor.record.cardId, recordId: successor.record.recordId });
    expect((await store.findByCard('8684155'))[0]).toMatchObject({
      successorCardId: '9427608', tailSkipped: { start: 46, end: 50 },
    });
    const next = await store.allocateNext({
      request: request({ documentId: 'science', learnerId: 'user_4', rowRange: { start: 1, end: 5 } }),
    });
    expect(next.record.cardId).toBe('9427608');
    expect(next.record.rowRange).toEqual({ start: 7, end: 11 });
  });

  it('cancels an unconfirmed successor without permanently sealing its predecessor', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({
      directory: '/docs', io,
      rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8], [3, 1, 7, 9, 0, 2, 4]]),
      now: () => '2026-08-31T10:00:00.000Z',
    });
    const first = await store.allocateNext({ request: request({ documentId: 'a', learnerId: 'user_4', rowRange: { start: 1, end: 48 } }) });
    await store.markDelivered({ cardId: first.record.cardId, recordId: first.record.recordId });
    const failed = await store.allocateNext({ request: request({ documentId: 'b', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }) });
    await store.release({ cardId: failed.record.cardId, rows: failed.record.rowRange });
    expect((await store.findByCard(first.record.cardId))[0].successorCardId).toBeUndefined();
    const retry = await store.allocateNext({ request: request({ documentId: 'b-retry', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }) });
    expect(retry.record.predecessorCardId).toBe(first.record.cardId);
    expect(retry.record.generation).toBe(2);
  });

  it('does not rewrite predecessor lineage when a delivery is a plain reuse', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({
      directory: '/docs',
      io,
      rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8]]),
      now: () => '2026-08-31T10:00:00.000Z',
    });

    // Card A, first use of a fresh chain.
    const a = await store.allocateNext({
      request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }),
      policy: { reuse: 'after_scan' },
    });
    expect(a.firstUse).toBe(true);
    expect(a.record.cardOrigin).toBe('first');
    await store.markDelivered({ cardId: a.record.cardId, recordId: a.record.recordId });

    // A still holds live work, so `after_scan` correctly mints card B.
    const b = await store.allocateNext({
      request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }),
      policy: { reuse: 'after_scan' },
    });
    expect(b.firstUse).toBe(true);
    expect(b.record.cardOrigin).toBe('rollover');
    await store.markDelivered({ cardId: b.record.cardId, recordId: b.record.recordId });

    // The genuine rollover DOES retire A's tail. This part is correct today.
    const afterRollover = await store.findByCard(a.record.cardId);
    expect(afterRollover[0].successorCardId).toBe(b.record.cardId);
    const tailAfterRollover = afterRollover[0].tailSkipped;

    // Now an ordinary reuse of B under `until_full`.
    const c = await store.allocateNext({
      request: request({ documentId: 'science', learnerId: 'user_4', rowRange: { start: 1, end: 2 } }),
      policy: { reuse: 'until_full' },
    });
    expect(c.firstUse).toBe(false);
    expect(c.record.cardId).toBe(b.record.cardId);
    expect(c.record.cardOrigin).toBe('reuse');
    // It inherits the predecessor pointer -- which is exactly why the old
    // condition misfired.
    expect(c.record.predecessorCardId).toBe(a.record.cardId);
    await store.markDelivered({ cardId: c.record.cardId, recordId: c.record.recordId });

    // THE ASSERTION: card A is untouched by a delivery that was not its rollover.
    const afterReuse = await store.findByCard(a.record.cardId);
    expect(afterReuse[0].tailSkipped).toEqual(tailAfterRollover);
    expect(afterReuse.map((r) => r.successorCardId))
      .toEqual(afterRollover.map((r) => r.successorCardId));
  });
});

describe('allocate — collision refusal (spec §5.4)', () => {
  it('refuses an overlapping range against a live record on the same card, regardless of learner', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }) });

    await expect(store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-b', learnerId: 'kid-2', rowRange: { start: 5, end: 15 } }),
    })).rejects.toMatchObject({ code: 'ALLOCATION_COLLISION' });

    // never a partial write — the card still shows only the original record
    const records = await store.findByCard('1234567');
    expect(records).toHaveLength(1);
    expect(records[0].documentId).toBe('doc-a');
  });

  it('allows non-overlapping ranges on the same card', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', rowRange: { start: 1, end: 10 } }) });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-b', rowRange: { start: 11, end: 20 } }) });

    const records = await store.findByCard('1234567');
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.status === 'live')).toBe(true);
  });
});

describe('allocate — satisfied-record reprint (post-scan reprint / teacher key)', () => {
  it('an identical render context against a SATISFIED record returns it unchanged (idempotent reprint)', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const req = request({ learnerId: 'learner4', rowItems: [{ row: 1, itemId: 'q1', itemType: 'multiple_choice' }] });
    const original = await store.allocate({ cardId: '1234567', request: req });
    await store.updateStatus({ cardId: '1234567', recordId: original.recordId, status: 'satisfied' });

    // The teacher pulls the sheet (or its key) back up AFTER the scan — the
    // exact moment grading happens. This must reproduce, never conflict.
    const reprint = await store.allocate({ cardId: '1234567', request: req });
    expect(reprint).toMatchObject({ recordId: original.recordId, status: 'satisfied' });
    expect(await store.findByCard('1234567')).toHaveLength(1);
  });

  it('still refuses when the same recordId carries a DIFFERENT context (seed/learner/mapping)', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const original = await store.allocate({ cardId: '1234567', request: request({ learnerId: 'learner4' }) });
    await store.updateStatus({ cardId: '1234567', recordId: original.recordId, status: 'satisfied' });

    for (const overrides of [{ learnerId: 'learner1' }, { learnerId: 'learner4', seed: 999 }]) {
      await expect(store.allocate({ cardId: '1234567', request: request(overrides) }))
        .rejects.toMatchObject({ code: 'ALLOCATION_RECORD_ID_CONFLICT' });
    }

    // The refusal message names WHICH check failed, so a teacher's bug
    // report (or the dev reading it) doesn't have to guess.
    await expect(store.allocate({ cardId: '1234567', request: request({ learnerId: 'learner1' }) }))
      .rejects.toThrow(/learner differs/);
  });

  it('a released record never reprints — its rows are recycled, not reproducible', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const req = request({ learnerId: 'learner4' });
    await store.allocate({ cardId: '1234567', request: req });
    await store.release({ cardId: '1234567' });
    await expect(store.allocate({ cardId: '1234567', request: req }))
      .rejects.toMatchObject({ code: 'ALLOCATION_RECORD_ID_CONFLICT' });
  });
});

describe('allocate — supersede (spec §5.4 reprint case)', () => {
  it('an IDENTICAL reprint (same documentId/rev/variant/rowRange) is idempotent, not a duplicate append', async () => {
    // recordId is deterministic on (documentId, rev, variant, rowRange) alone, so an
    // identical re-request names the SAME recordId as the record it would "supersede" —
    // mirrors IFormMapStore's reprint-reuses-the-artifact-id idempotency instead of
    // writing a second entry that would collide on recordId.
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const first = await store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }),
    });
    const second = await store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }),
    });

    expect(second).toEqual(first);
    const records = await store.findByCard('1234567');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('live');
  });

  it('a reprint at a DIFFERENT range still supersedes rather than colliding', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }),
    });
    const second = await store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 11, end: 20 } }),
    });
    expect(second.status).toBe('live');
    const records = await store.findByCard('1234567');
    expect(records.map((r) => r.status).sort()).toEqual(['live', 'superseded']);
  });

  it('anonymous renders of the same document supersede each other (at a different range)', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', rowRange: { start: 1, end: 10 } }) });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', rowRange: { start: 11, end: 20 } }) });
    const records = await store.findByCard('1234567');
    expect(records.map((r) => r.status).sort()).toEqual(['live', 'superseded']);
  });

  it('refuses a recordId clash that is NOT the supersede target (different learner, same document/rev/variant/range)', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }),
    });
    await store.updateStatus({
      cardId: '1234567',
      recordId: 'doc-a@abc123:v0:1-10',
      status: 'released',
    });
    await expect(store.allocate({
      cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-2', rowRange: { start: 1, end: 10 } }),
    })).rejects.toMatchObject({ code: 'ALLOCATION_RECORD_ID_CONFLICT' });
  });

  it('does NOT supersede across cards (per-card supersede only — Task 1 report note)', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }) });
    const reprint = await store.allocate({ cardId: '7654321', request: request({ documentId: 'doc-a', learnerId: 'kid-1', rowRange: { start: 1, end: 10 } }) });

    expect(reprint.status).toBe('live');
    const originalCard = await store.findByCard('1234567');
    expect(originalCard[0].status).toBe('live'); // stranded, not superseded — by design
  });
});

describe('findByCard', () => {
  it('returns an empty array for a card with no records', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io });
    expect(await store.findByCard('1234567')).toEqual([]);
  });
});

describe('updateStatus', () => {
  it('allows live -> satisfied / released / superseded', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    for (const [cardId, status] of [['1111111', 'satisfied'], ['2222222', 'released'], ['3333333', 'superseded']]) {
      const record = await store.allocate({ cardId, request: request() });
      const updated = await store.updateStatus({ cardId, recordId: record.recordId, status });
      expect(updated.status).toBe(status);
      expect((await store.findByCard(cardId))[0].status).toBe(status);
    }
  });

  it('rejects a transition out of a non-live status', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const record = await store.allocate({ cardId: '1234567', request: request() });
    await store.updateStatus({ cardId: '1234567', recordId: record.recordId, status: 'satisfied' });

    await expect(store.updateStatus({ cardId: '1234567', recordId: record.recordId, status: 'released' }))
      .rejects.toMatchObject({ code: 'ALLOCATION_ILLEGAL_TRANSITION' });
  });

  it('rejects an unknown status value', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const record = await store.allocate({ cardId: '1234567', request: request() });
    await expect(store.updateStatus({ cardId: '1234567', recordId: record.recordId, status: 'bogus' }))
      .rejects.toThrow(/status/);
  });

  it('throws EntityNotFoundError for an unknown recordId', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    await store.allocate({ cardId: '1234567', request: request() });
    await expect(store.updateStatus({ cardId: '1234567', recordId: 'nope', status: 'satisfied' }))
      .rejects.toThrow(/not found/i);
  });
});

describe('lost answer-sheet lineage', () => {
  it('supersedes only the named live record and links its replacement', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-04T10:00:00.000Z' });
    const live = await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', documentId: 'doc-a', rowRange: { start: 1, end: 6 } }),
    });
    const settled = await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', documentId: 'doc-b', rowRange: { start: 7, end: 12 } }),
    });
    await store.updateStatus({ cardId: '1234567', recordId: settled.recordId, status: 'satisfied' });
    const result = await store.markRecordLost({
      cardId: '1234567', recordId: live.recordId,
      replacementCardId: '7654321', replacementRecordId: 'replacement-record', reportedBy: 'kckern',
    });
    expect(result).toMatchObject({
      status: 'superseded', supersededReason: 'answer-sheet-lost',
      replacementCardId: '7654321', replacementRecordId: 'replacement-record', supersededBy: 'kckern',
    });
    expect((await store.findByCard('1234567')).find((record) => record.recordId === settled.recordId).status)
      .toBe('satisfied');
  });
});

describe('release', () => {
  it('releases all live records when rows is absent, leaving non-live records untouched', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const a = await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', rowRange: { start: 1, end: 10 } }) });
    const b = await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-b', rowRange: { start: 11, end: 20 } }) });
    await store.updateStatus({ cardId: '1234567', recordId: a.recordId, status: 'satisfied' });

    const released = await store.release({ cardId: '1234567' });
    expect(released.map((r) => r.recordId)).toEqual([b.recordId]);

    const records = await store.findByCard('1234567');
    expect(records.find((r) => r.recordId === a.recordId).status).toBe('satisfied'); // untouched
    expect(records.find((r) => r.recordId === b.recordId).status).toBe('released');
  });

  it('releases only live records overlapping the given rows', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const a = await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-a', rowRange: { start: 1, end: 10 } }) });
    const b = await store.allocate({ cardId: '1234567', request: request({ documentId: 'doc-b', rowRange: { start: 11, end: 20 } }) });

    const released = await store.release({ cardId: '1234567', rows: { start: 1, end: 9 } });
    expect(released.map((r) => r.recordId)).toEqual([a.recordId]);

    const records = await store.findByCard('1234567');
    expect(records.find((r) => r.recordId === a.recordId).status).toBe('released');
    expect(records.find((r) => r.recordId === b.recordId).status).toBe('live'); // untouched, out of range
  });

  it('returns an empty array when the card has no live records', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    expect(await store.release({ cardId: '1234567' })).toEqual([]);
  });
});

describe('retireCard', () => {
  it('refuses retirement while any allocation is still live', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-31T18:00:00.000Z' });
    await store.allocate({
      cardId: '1234567',
      request: request({ learnerId: 'learner3', rowRange: { start: 1, end: 6 } }),
    });

    await expect(store.retireCard({
      cardId: '1234567', reason: 'physical card destroyed', retiredBy: 'parent',
    })).rejects.toMatchObject({ code: 'ALLOCATION_CARD_STILL_LIVE' });
  });

  it('stamps every settled record once and permanently excludes the card from reuse', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-31T18:00:00.000Z' });
    const first = await store.allocate({
      cardId: '1234567',
      request: request({ learnerId: 'learner3', documentId: 'doc-a', rowRange: { start: 1, end: 6 } }),
    });
    const second = await store.allocate({
      cardId: '1234567',
      request: request({ learnerId: 'learner3', documentId: 'doc-b', rowRange: { start: 7, end: 12 } }),
    });
    await store.updateStatus({ cardId: '1234567', recordId: first.recordId, status: 'satisfied' });
    await store.release({ cardId: '1234567', rows: second.rowRange });

    const retired = await store.retireCard({
      cardId: '1234567', reason: 'wrong worksheet used on this physical card', retiredBy: 'parent',
    });
    expect(retired).toHaveLength(2);
    expect(retired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordId: first.recordId,
        cardRetiredAt: '2026-08-31T18:00:00.000Z',
        cardRetiredReason: 'wrong worksheet used on this physical card',
        cardRetiredBy: 'parent',
      }),
      expect.objectContaining({ recordId: second.recordId, status: 'released' }),
    ]));
    expect(await store.findReusableCard({ learnerId: 'learner3', rowsNeeded: 6 })).toBeNull();

    const repeated = await store.retireCard({
      cardId: '1234567', reason: 'a later explanation must not rewrite the audit', retiredBy: 'someone-else',
      at: '2026-09-01T00:00:00.000Z',
    });
    expect(repeated).toEqual(retired);
  });
});

describe('confirmHistoricalDelivery', () => {
  it('backfills confirmed delivery on a settled legacy allocation without reopening it', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => '2026-08-31T18:00:00.000Z' });
    const record = await store.allocate({
      cardId: '1234567', request: request({ learnerId: 'learner3', rowRange: { start: 1, end: 6 } }),
    });
    await store.updateStatus({ cardId: '1234567', recordId: record.recordId, status: 'satisfied' });
    // Simulate the deployed pre-delivery-metadata record this backfill exists for.
    const file = '/docs/cards/1234567.yml';
    const [legacy] = io.load(file);
    delete legacy.deliveryState;
    delete legacy.deliveredAt;
    delete legacy.cardCapacity;
    io.save(file, [legacy]);

    const delivered = await store.confirmHistoricalDelivery({
      cardId: '1234567', recordId: record.recordId,
      deliveredAt: '2026-08-31T15:30:09.071Z', confirmedBy: 'parent',
    });
    expect(delivered).toMatchObject({
      status: 'satisfied', deliveryState: 'delivered',
      deliveredAt: '2026-08-31T15:30:09.071Z',
      deliveryBackfilledAt: '2026-08-31T18:00:00.000Z',
      deliveryConfirmedBy: 'parent', cardCapacity: 50,
    });

    const repeated = await store.confirmHistoricalDelivery({
      cardId: '1234567', recordId: record.recordId,
      deliveredAt: '2099-01-01T00:00:00.000Z', confirmedBy: 'someone-else',
    });
    expect(repeated).toEqual(delivered);
  });
});

describe('describeCard', () => {
  it('never reclaims physical rows when reporting contiguous capacity', async () => {
    const { io } = fakeIo();
    const store = new YamlAllocationStore({ directory: '/docs', io, now: () => 'ts' });
    const old = await store.allocate({ cardId: '1234567', request: request({
      learnerId: 'learner3', documentId: 'doc-old', rowRange: { start: 1, end: 20 },
    }) });
    await store.updateStatus({ cardId: '1234567', recordId: old.recordId, status: 'satisfied' });
    const latest = await store.allocate({ cardId: '1234567', request: request({
      learnerId: 'learner3', documentId: 'doc-latest', rowRange: { start: 21, end: 26 },
    }) });
    await store.updateStatus({ cardId: '1234567', recordId: latest.recordId, status: 'released' });

    expect(await store.describeCard('1234567', { expectedLearnerId: 'learner3' })).toMatchObject({
      capacity: 50, usedRows: 26, remainingContiguousSlots: 24, nextRow: 27,
      mappedLearnerId: 'learner3', warnings: [],
    });
  });
});

describe('round-trip (real filesystem)', () => {
  it('persists and reloads records through a real save+load cycle', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-allocation-store-'));
    try {
      const store = new YamlAllocationStore({ directory, now: () => '2026-08-04T00:00:00.000Z' });
      const record = await store.allocate({ cardId: '1234567', request: request({ learnerId: 'kid-1' }) });

      const reloaded = new YamlAllocationStore({ directory, now: () => '2026-08-04T00:00:00.000Z' });
      expect(await reloaded.findByCard('1234567')).toEqual([record]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
