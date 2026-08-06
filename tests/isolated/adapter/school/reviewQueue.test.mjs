import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlReviewQueue } from '#adapters/persistence/yaml/YamlReviewQueue.mjs';
import { IReviewQueue } from '#apps/school/ports/IReviewQueue.mjs';

let tmp, store;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-review-'));
  store = new YamlReviewQueue({ configService: { getHouseholdPath: (rel) => path.join(tmp, rel) } });
});

const item = (over = {}) => ({
  sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1', unitId: 'math-fractions.02',
  reason: 'free_response', given: 'x', prompt: null, questionNumber: 1, rubric: null,
  enqueuedAt: '2026-07-27T09:00:00.000Z', ...over,
});

describe('construction', () => {
  it('extends its port', () => {
    expect(store).toBeInstanceOf(IReviewQueue);
  });

  it('requires a configService', () => {
    expect(() => new YamlReviewQueue({})).toThrow(/configService/);
  });
});

describe('listForLearner', () => {
  it('is empty for an unknown/empty learner id', async () => {
    expect(await store.listForLearner('')).toEqual([]);
    expect(await store.listForLearner(null)).toEqual([]);
    expect(await store.listForLearner('nobody')).toEqual([]);
  });

  it('returns only RESOLVED items for the given learner, never a pending one', async () => {
    await store.enqueue([item({ sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1' })]);
    await store.enqueue([item({ sessionId: 'ses_1', itemId: 'q2', learnerId: 'kid1' })]);
    await store.enqueue([item({ sessionId: 'ses_2', itemId: 'q1', learnerId: 'sibling' })]);
    await store.resolve({
      sessionId: 'ses_1', itemId: 'q1', verdict: 'correct', gradedBy: 'parent', at: '2026-07-27T09:05:00.000Z',
    });
    // q2 stays pending; ses_2 belongs to a different learner entirely.
    const rows = await store.listForLearner('kid1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'q1', verdict: 'correct' });
  });

  it('reads BOTH the live and the settled filename for the same learner', async () => {
    // A fully-resolved session's items live under `.settled.yml` (Task 4).
    await store.enqueue([item({ sessionId: 'ses_settled', itemId: 'q1', learnerId: 'kid1' })]);
    await store.resolve({
      sessionId: 'ses_settled', itemId: 'q1', verdict: 'correct', gradedBy: 'parent', at: '2026-07-27T09:05:00.000Z',
    });
    expect(fs.existsSync(path.join(tmp, 'apps/school/review', 'ses_settled.settled.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'apps/school/review', 'ses_settled.yml'))).toBe(false);

    // A still-open session lives under the plain name; one resolved item
    // inside it must still surface even though the FILE is not settled.
    await store.enqueue([
      item({ sessionId: 'ses_live', itemId: 'q1', learnerId: 'kid1' }),
      item({ sessionId: 'ses_live', itemId: 'q2', learnerId: 'kid1' }),
    ]);
    await store.resolve({
      sessionId: 'ses_live', itemId: 'q1', verdict: 'incorrect', gradedBy: 'parent', at: '2026-07-27T09:06:00.000Z',
    });

    const rows = await store.listForLearner('kid1');
    expect(rows.map((r) => r.sessionId).sort()).toEqual(['ses_live', 'ses_settled']);
  });

  it('orders newest-first by gradedAt', async () => {
    await store.enqueue([item({ sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1' })]);
    await store.enqueue([item({ sessionId: 'ses_2', itemId: 'q1', learnerId: 'kid1' })]);
    await store.enqueue([item({ sessionId: 'ses_3', itemId: 'q1', learnerId: 'kid1' })]);
    await store.resolve({ sessionId: 'ses_1', itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: '2026-07-25T09:00:00.000Z' });
    await store.resolve({ sessionId: 'ses_2', itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: '2026-07-27T09:00:00.000Z' });
    await store.resolve({ sessionId: 'ses_3', itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: '2026-07-26T09:00:00.000Z' });
    const rows = await store.listForLearner('kid1');
    expect(rows.map((r) => r.sessionId)).toEqual(['ses_2', 'ses_3', 'ses_1']);
  });

  it('honours limit', async () => {
    for (const n of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await store.enqueue([item({ sessionId: `ses_${n}`, itemId: 'q1', learnerId: 'kid1' })]);
      // eslint-disable-next-line no-await-in-loop
      await store.resolve({ sessionId: `ses_${n}`, itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: `2026-07-2${n}T09:00:00.000Z` });
    }
    expect(await store.listForLearner('kid1', { limit: 2 })).toHaveLength(2);
  });

  it('skips a file untouched within maxAgeDays without needing to parse it', async () => {
    await store.enqueue([item({ sessionId: 'ses_old', itemId: 'q1', learnerId: 'kid1' })]);
    await store.resolve({ sessionId: 'ses_old', itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: '2020-01-01T00:00:00.000Z' });
    // Backdate the file's own mtime so the window-skip has something to bite on.
    const file = path.join(tmp, 'apps/school/review', 'ses_old.settled.yml');
    const old = new Date('2020-01-01T00:00:00.000Z');
    fs.utimesSync(file, old, old);

    await store.enqueue([item({ sessionId: 'ses_new', itemId: 'q1', learnerId: 'kid1' })]);
    await store.resolve({ sessionId: 'ses_new', itemId: 'q1', verdict: 'correct', gradedBy: 'p', at: '2026-07-27T09:00:00.000Z' });

    const rows = await store.listForLearner('kid1', { maxAgeDays: 60 });
    expect(rows.map((r) => r.sessionId)).toEqual(['ses_new']);
  });
});
