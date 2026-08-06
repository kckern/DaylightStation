import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlFormMapStore } from '#adapters/persistence/yaml/YamlFormMapStore.mjs';
import { YamlReviewQueue } from '#adapters/persistence/yaml/YamlReviewQueue.mjs';
import { IAssignmentStore } from '#apps/school/ports/IAssignmentStore.mjs';
import { IFormMapStore } from '#apps/school/ports/IFormMapStore.mjs';
import { IReviewQueue } from '#apps/school/ports/IReviewQueue.mjs';

const AT = '2026-07-27T10:00:00.000Z';

let tmp;
let assignments;
let forms;
let review;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-lifecycle-'));
  const configService = { getDataDir: () => tmp, getHouseholdPath: (rel) => `${tmp}/${rel}` };
  assignments = new YamlAssignmentStore({ configService });
  forms = new YamlFormMapStore({ configService });
  review = new YamlReviewQueue({ configService });
});

const under = (...segments) => path.join(tmp, 'apps', 'school', ...segments);
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
};

describe('YamlAssignmentStore', () => {
  it('extends its port (decision D7)', () => {
    expect(assignments).toBeInstanceOf(IAssignmentStore);
  });

  it('requires a configService', () => {
    expect(() => new YamlAssignmentStore({})).toThrow(/configService/);
  });

  it('round-trips a record through parent-readable YAML', async () => {
    await assignments.put({ learnerId: 'kid1', courses: ['math-fractions'], units: [{ unitId: 'art.01', elective: true }], updatedAt: AT });
    expect(await assignments.get('kid1')).toEqual({
      learnerId: 'kid1', courses: ['math-fractions'], units: [{ unitId: 'art.01', elective: true }], updatedAt: AT,
    });
    expect(yaml.load(fs.readFileSync(under('assignments', 'kid1.yml'), 'utf8')).courses).toEqual(['math-fractions']);
  });

  it('returns null rather than throwing for an unassigned learner', async () => {
    expect(await assignments.get('nobody')).toBeNull();
  });

  it('isolates a mid-edit broken file to that learner', async () => {
    await assignments.put({ learnerId: 'kid1', courses: ['math-fractions'] });
    write(under('assignments', 'kid2.yml'), 'courses: [: :\n  broken');
    expect(await assignments.get('kid2')).toBeNull();
    expect(await assignments.get('kid1')).toMatchObject({ learnerId: 'kid1' });
    expect((await assignments.list()).map((r) => r.learnerId)).toEqual(['kid1']);
  });

  it('refuses a traversing learner id', async () => {
    await expect(assignments.put({ learnerId: '../../etc/passwd' })).rejects.toThrow(/unsafe learnerId/);
    expect(await assignments.get('../secrets')).toBeNull();
  });

  it('lists nothing before anything is assigned', async () => {
    expect(await assignments.list()).toEqual([]);
  });

  it('serialises concurrent writes for different learners', async () => {
    await Promise.all(['kid1', 'kid2', 'kid3'].map((learnerId) => assignments.put({ learnerId, courses: [learnerId] })));
    expect((await assignments.list()).map((r) => r.learnerId)).toEqual(['kid1', 'kid2', 'kid3']);
  });

  it('appends every put to the learner history, oldest first, with assignedBy preserved and get() still latest-only', async () => {
    await assignments.put({ learnerId: 'kid1', courses: ['math-fractions'], assignedBy: 'mom', updatedAt: AT });
    const later = '2026-07-28T10:00:00.000Z';
    await assignments.put({ learnerId: 'kid1', courses: ['math-fractions', 'reading-basics'], assignedBy: 'dad', updatedAt: later });

    const history = await assignments.history('kid1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ courses: ['math-fractions'], assignedBy: 'mom', recordedAt: AT });
    expect(history[1]).toMatchObject({ courses: ['math-fractions', 'reading-basics'], assignedBy: 'dad', recordedAt: later });

    expect(await assignments.get('kid1')).toMatchObject({ courses: ['math-fractions', 'reading-basics'], updatedAt: later });
  });

  it('returns an empty history for a learner with no assignments', async () => {
    expect(await assignments.history('nobody')).toEqual([]);
  });

  it('treats a malformed history file as empty rather than throwing', async () => {
    write(under('history', 'kid9.yml'), '- [unclosed');
    expect(await assignments.history('kid9')).toEqual([]);
  });
});

describe('YamlFormMapStore', () => {
  const formMap = { formVersion: 'v1', documentId: 'omr-01', seed: 3, variant: 0, marks: [{ itemId: 'q1', choice: 'A', xPt: 100, yPt: 200, rPt: 5, page: 1 }] };

  it('extends its port (decision D7)', () => {
    expect(forms).toBeInstanceOf(IFormMapStore);
  });

  it('round-trips the renderer artifact verbatim', async () => {
    await forms.put('art_0001', formMap);
    expect(await forms.get('art_0001')).toEqual(formMap);
  });

  it('keeps the FIRST map for an artifact — the paper is already printed', async () => {
    await forms.put('art_0001', formMap);
    await forms.put('art_0001', { ...formMap, marks: [] });
    expect((await forms.get('art_0001')).marks).toHaveLength(1);
  });

  it('gives different variants different maps', async () => {
    await forms.put('art_0001', formMap);
    await forms.put('art_0002', { ...formMap, variant: 1, marks: [] });
    expect((await forms.get('art_0001')).variant).toBe(0);
    expect((await forms.get('art_0002')).variant).toBe(1);
  });

  it('returns null for an unknown form instead of throwing', async () => {
    expect(await forms.get('art_9999')).toBeNull();
  });

  it('refuses a traversing form id', async () => {
    await expect(forms.put('../../evil', formMap)).rejects.toThrow(/unsafe formId/);
  });

  it('treats an unreadable file as absent', async () => {
    write(under('forms', 'art_bad.yml'), '{ this: is: not: yaml');
    expect(await forms.get('art_bad')).toBeNull();
  });
});

describe('YamlReviewQueue', () => {
  const item = (over = {}) => ({
    sessionId: 'ses_a', itemId: 'q3', learnerId: 'kid1', unitId: 'math-fractions.03',
    reason: 'ambiguous', given: null, prompt: null, enqueuedAt: AT, ...over,
  });

  it('extends its port (decision D7)', () => {
    expect(review).toBeInstanceOf(IReviewQueue);
  });

  it('queues items and lists them per session', async () => {
    await review.enqueue([item(), item({ itemId: 'q4', reason: 'blank' })]);
    expect((await review.listForSession('ses_a')).map((i) => i.itemId)).toEqual(['q3', 'q4']);
  });

  it('starts every item unmarked', async () => {
    await review.enqueue([item()]);
    expect((await review.listForSession('ses_a'))[0]).toMatchObject({ verdict: null, gradedBy: null, gradedAt: null });
  });

  it('re-enqueueing is a retry, not a second thing to mark', async () => {
    await review.enqueue([item()]);
    await review.enqueue([item()]);
    expect(await review.listForSession('ses_a')).toHaveLength(1);
  });

  it('a re-submission never un-marks what a grown-up already marked', async () => {
    await review.enqueue([item()]);
    await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'parent', at: AT });
    await review.enqueue([item({ reason: 'blank' })]);
    expect((await review.listForSession('ses_a'))[0]).toMatchObject({ verdict: 'correct', reason: 'ambiguous' });
  });

  it('records who marked it and when', async () => {
    await review.enqueue([item()]);
    const resolved = await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'incorrect', gradedBy: 'parent', at: AT });
    expect(resolved).toMatchObject({ verdict: 'incorrect', gradedBy: 'parent', gradedAt: AT });
  });

  it('keeps the parent\'s NOTE with the verdict — the reason is the valuable part', async () => {
    await review.enqueue([item()]);
    const resolved = await review.resolve({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'incorrect', gradedBy: 'parent',
      note: 'Right method, but you forgot to simplify.', at: AT,
    });
    expect(resolved.note).toBe('Right method, but you forgot to simplify.');
    // ...and it survives the round trip to disk, which is the whole point.
    expect((await review.listForSession('ses_a'))[0].note).toBe('Right method, but you forgot to simplify.');
  });

  it('stores no note as null rather than dropping the field', async () => {
    await review.enqueue([item()]);
    const resolved = await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'parent', at: AT });
    expect(resolved.note).toBeNull();
  });

  it('does not erase an earlier note when a verdict is changed without one', async () => {
    await review.enqueue([item()]);
    await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'incorrect', gradedBy: 'parent', note: 'Check the denominator.', at: AT });
    const again = await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'parent', at: AT });
    expect(again.note).toBe('Check the denominator.');
  });

  it('returns null for an item that was never queued', async () => {
    expect(await review.resolve({ sessionId: 'ses_a', itemId: 'nope', verdict: 'correct', gradedBy: 'p', at: AT })).toBeNull();
  });

  it('rejects a verdict outside the closed set and a missing timestamp', async () => {
    await review.enqueue([item()]);
    await expect(review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'maybe', at: AT })).rejects.toThrow(/correct\|incorrect/);
    await expect(review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct' })).rejects.toThrow(/ISO-8601/);
  });

  it('lists only unmarked items across every session', async () => {
    await review.enqueue([item(), item({ itemId: 'q4' })]);
    await review.enqueue([item({ sessionId: 'ses_b', itemId: 'q1' })]);
    await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'p', at: AT });
    expect((await review.listPending()).map((i) => `${i.sessionId}/${i.itemId}`)).toEqual(['ses_a/q4', 'ses_b/q1']);
  });

  it('refuses a mixed-session enqueue rather than writing one file with both', async () => {
    await expect(review.enqueue([item(), item({ sessionId: 'ses_b' })])).rejects.toThrow(/one session at a time/);
  });

  it('ignores items with no session or item id', async () => {
    expect(await review.enqueue([{ itemId: 'q1' }, null])).toEqual([]);
    expect(await review.listPending()).toEqual([]);
  });

  it('treats a corrupt session file as an empty queue', async () => {
    write(under('review', 'ses_bad.yml'), '- [unclosed');
    expect(await review.listForSession('ses_bad')).toEqual([]);
  });

  describe('settled files leave the pending scan', () => {
    it('resolving the last unmarked item renames the live file to .settled.yml', async () => {
      await review.enqueue([item()]);
      await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'p', at: AT });
      expect(fs.existsSync(under('review', 'ses_a.yml'))).toBe(false);
      expect(fs.existsSync(under('review', 'ses_a.settled.yml'))).toBe(true);
    });

    it('a fully-resolved session is skipped by listPending but still served by listForSession', async () => {
      await review.enqueue([item()]);
      await review.enqueue([item({ sessionId: 'ses_b', itemId: 'q1' })]);
      await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'p', at: AT });

      expect((await review.listPending()).map((i) => `${i.sessionId}/${i.itemId}`)).toEqual(['ses_b/q1']);
      const served = await review.listForSession('ses_a');
      expect(served).toHaveLength(1);
      expect(served[0]).toMatchObject({ itemId: 'q3', verdict: 'correct' });
    });

    it('resolving a second time on an already-settled session finds the item under the settled name', async () => {
      await review.enqueue([item()]);
      await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'incorrect', gradedBy: 'p', at: AT });
      expect(fs.existsSync(under('review', 'ses_a.settled.yml'))).toBe(true);

      const again = await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'p', at: AT });
      expect(again).toMatchObject({ verdict: 'correct' });
      expect(fs.existsSync(under('review', 'ses_a.settled.yml'))).toBe(true);
      expect(fs.existsSync(under('review', 'ses_a.yml'))).toBe(false);
    });

    it('enqueueing a fresh unresolved item on a settled session reopens it (renames settled back to live)', async () => {
      await review.enqueue([item()]);
      await review.resolve({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'p', at: AT });
      expect(fs.existsSync(under('review', 'ses_a.settled.yml'))).toBe(true);

      await review.enqueue([item({ itemId: 'q9', reason: 'ambiguous' })]);
      expect(fs.existsSync(under('review', 'ses_a.settled.yml'))).toBe(false);
      expect(fs.existsSync(under('review', 'ses_a.yml'))).toBe(true);
      expect((await review.listPending()).map((i) => `${i.sessionId}/${i.itemId}`)).toEqual(['ses_a/q9']);
      const served = await review.listForSession('ses_a');
      expect(served.map((i) => i.itemId).sort()).toEqual(['q3', 'q9']);
    });
  });
});
