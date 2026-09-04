import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateCurationJob } from './TemplateCurationJob.mjs';
import { TemplateService } from './TemplateService.mjs';
import { coreKey } from '#domains/nutrition/services/TemplateMiner.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
// 2026-09-04T09:00 local (America/Los_Angeles). The UTC instant is the same day.
const NOW = new Date('2026-09-04T09:00:00-07:00').getTime();
const TODAY = '2026-09-04';

const daysAgo = (n) => {
  const at = new Date(`${TODAY}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - n);
  return at.toISOString().slice(0, 10);
};

const stack = (count, names, mealTime = 'morning') =>
  Array.from({ length: count }, (_, day) => names.map((name, i) => ({
    uuid: `${day}-${i}`, name, date: daysAgo(day + 1), mealTime,
    calories: 100 + i, protein: 1, carbs: 2, fat: 3, kind: 'item',
  }))).flat(2);

let templates, dismissed, store, svc, job, rows, findByDateRange;

const snapshot = () => JSON.stringify([...templates.values()]);

beforeEach(() => {
  templates = new Map();
  dismissed = [];
  let n = 0;
  store = {
    list: async () => [...templates.values()],
    getById: async (id) => templates.get(id) || null,
    save: async (t) => { templates.set(t.id, t); },
    remove: async (id) => { templates.delete(id); },
    listDismissedKeys: async () => [...dismissed],
    addDismissedKey: async (k) => { if (!dismissed.includes(k)) dismissed.push(k); },
  };
  svc = new TemplateService({
    templateStore: store,
    nutriListStore: { saveMany: async () => {} },
    clock: { now: () => NOW },
    createId: () => `t-${++n}`,
    logger: silent,
  });
  rows = stack(8, ['Chia', 'Whey']);
  findByDateRange = vi.fn(async () => rows);
  job = new TemplateCurationJob({
    templateService: svc,
    nutriListStore: { findByDateRange },
    clock: { now: () => NOW },
    logger: silent,
  });
});

describe('TemplateCurationJob', () => {
  it('mines the last 90 days and writes proposals, not templates', async () => {
    const result = await job.run('u');
    expect(findByDateRange).toHaveBeenCalledWith('u', daysAgo(90), TODAY);
    expect(result).toMatchObject({ created: 1, proposals: 1, from: daysAgo(90), to: TODAY });

    // Nothing appears in the picker's default view — approval is required.
    expect(await svc.list('u')).toEqual([]);
    const [proposal] = await svc.list('u', { includeProposed: true });
    expect(proposal.status).toBe('proposed');
    expect(proposal.source).toBe('curated');
    expect(proposal.proposalKey).toBe(coreKey(['Chia', 'Whey']));
    expect(proposal.components.map((c) => c.name)).toEqual(['Whey', 'Chia']);
  });

  it('IS IDEMPOTENT: a second run creates nothing and leaves the store byte-identical', async () => {
    const first = await job.run('u');
    const afterFirst = snapshot();
    const second = await job.run('u');
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    // Nothing even reaches the writer: the miner is handed last run's key and
    // proposes nothing. `saveProposals` refusing it is the SECOND line of
    // defence, pinned in TemplateService.test.mjs.
    expect(second.proposals).toBe(0);
    expect(snapshot()).toBe(afterFirst);

    // A third run, too — and no counter anywhere moved.
    await job.run('u');
    expect(snapshot()).toBe(afterFirst);
    expect([...templates.values()].map((t) => t.useCount)).toEqual([0]);
  });

  it('does not re-propose a combo the person APPROVED', async () => {
    await job.run('u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    await svc.approve(proposal.id, 'u', { name: 'Morning smoothie' });
    const again = await job.run('u');
    expect(again.created).toBe(0);
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(1);
  });

  it('does not re-propose a combo the person DISMISSED, on this run or any later one', async () => {
    await job.run('u');
    const [proposal] = await svc.list('u', { includeProposed: true });
    await svc.dismiss(proposal.id, 'u');
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(0);
    for (let i = 0; i < 3; i += 1) expect((await job.run('u')).created).toBe(0);
    expect(await svc.list('u', { includeProposed: true })).toHaveLength(0);
  });

  it('finds a NEW combo on a later run without disturbing the first', async () => {
    await job.run('u');
    rows = [...rows, ...stack(8, ['Rice', 'Beans'], 'evening')];
    const second = await job.run('u');
    expect(second.created).toBe(1);
    const all = await svc.list('u', { includeProposed: true });
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.proposalKey).sort())
      .toEqual([coreKey(['Chia', 'Whey']), coreKey(['Rice', 'Beans'])].sort());
  });

  it('writes nothing when there is nothing repeated', async () => {
    rows = stack(3, ['Chia', 'Whey']);
    const result = await job.run('u');
    expect(result).toMatchObject({ created: 0, proposals: 0 });
    expect(templates.size).toBe(0);
  });

  it('refuses to be constructed without its dependencies', () => {
    expect(() => new TemplateCurationJob({ templateService: svc, clock: { now: () => NOW } }))
      .toThrow(/requires/);
  });
});
