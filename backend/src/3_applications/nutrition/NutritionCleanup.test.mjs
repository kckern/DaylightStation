// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlFoodLogDatastore } from '#adapters/persistence/yaml/YamlFoodLogDatastore.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlAgentStateStore } from '#adapters/persistence/yaml/YamlAgentStateStore.mjs';
import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';
import { FoodLogReview, nutritionLogVersion } from './FoodLogReview.mjs';
import { NutritionRepairService } from './NutritionRepairService.mjs';
import { NutritionCleanup } from './NutritionCleanup.mjs';
import { NutritionAuditor } from '#apps/agents/nutrition-auditor/NutritionAuditor.mjs';
import { AgentInteractions } from '#apps/agents/framework/AgentInteractions.mjs';
import { cleanupDates } from '#domains/nutrition/services/cleanupPolicy.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture({ pending = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-cleanup-')); roots.push(root);
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const dataService = { user: { resolveDir: (relative, id) => path.join(root, id, relative) } };
  const foodLogs = new YamlFoodLogDatastore({ configService: { getUserDir: id => path.join(root, id) }, logger });
  const items = new YamlNutriListDatastore({ dataService, logger });
  const store = new YamlAgentStateStore({ dataService });
  const clock = { now: () => Date.parse('2026-09-04T19:00:00Z') };
  const timezoneFor = () => 'America/Los_Angeles';
  const review = new FoodLogReview({ foodLogs, items, logger });
  const log = createNutriLog({ userId: 'alice', meal: { date: '2026-09-04', time: 'afternoon' }, timezone: timezoneFor(), timestamp: new Date(clock.now()),
    metadata: { source: 'voice' }, items: [
      { id: 'fish000001', label: 'White Fish', calories: 52, grams: 55, amount: 55, unit: 'g', icon: 'default', color: 'green', settled: false },
      { id: 'tortilla01', label: 'Tortilla', calories: 145, grams: 50, amount: 50, unit: 'g', icon: 'default', color: 'yellow', settled: false },
    ] });
  await foodLogs.save(log);
  if (!pending) await review.execute({ userId: 'alice', logUuid: log.id });
  const repairs = new NutritionRepairService({ items, foodLogs, review, clock, timezoneFor, icons: { has: slug => slug === 'fish' } });
  const auditor = new NutritionAuditor({ items, foodLogs, clock, timezoneFor, runtime: {} });
  const proposal = changes => ({ reason: 'Original capture identifies white fish', evidenceIds: ['source'], logUuid: pending ? log.id : null,
    expectedLogVersion: pending ? nutritionLogVersion(log) : null, updates: [{ id: 'fish000001', expectedVersion: 1, changes }], createGroups: [] });
  const apply = (changes, overrides = {}) => repairs.apply({ userId: 'alice', operationId: 'repair', proposal: proposal(changes), evidence: [{ id: 'source', kind: 'capture', data: 'white fish' }], ...overrides });
  return { root, logger, dataService, foodLogs, items, store, clock, timezoneFor, review, log, repairs, auditor, proposal, apply };
}
describe('nutrition cleanup policy and journal', () => {
  it('computes calendar yesterday across DST and the UTC date boundary', () => {
    expect(cleanupDates(Date.parse('2026-03-09T06:30:00Z'), 'America/Los_Angeles')).toEqual(['2026-03-08', '2026-03-07']);
    expect(cleanupDates(Date.parse('2026-11-02T07:30:00Z'), 'America/Los_Angeles')).toEqual(['2026-11-01', '2026-10-31']);
  });
  it('persists before/after evidence, replays once, and prevents automated oscillation', async () => {
    const f = await fixture();
    await f.apply({ icon: 'fish' }); await f.apply({ icon: 'fish' });
    const row = await f.items.findByUuid('alice', 'fish000001');
    expect(row).toMatchObject({ icon: 'fish', version: 2, calories: 52, cleanupFields: ['icon'] });
    const audit = await f.items.getCleanupAudit('alice', 'repair');
    expect(audit.before[0].icon).toBe('default'); expect(audit.after[0].icon).toBe('fish');
    expect(audit.evidence[0].kind).toBe('capture');
    const proposal = f.proposal({ icon: 'default' }); proposal.updates[0].expectedVersion = 2;
    await expect(f.apply({}, { operationId: 'again', proposal })).rejects.toMatchObject({ code: 'CLEANUP_ALREADY_REPAIRED' });
    expect((await f.items.listCleanupAudit('alice')).total).toBe(1);
  });
  it('does not infer serving nutrition from habit; accepts exact trusted serving facts', async () => {
    const f = await fixture();
    await expect(f.apply({ calories: 60 })).rejects.toMatchObject({ code: 'CLEANUP_REVIEW_REQUIRED' });
    const row = await f.items.findByUuid('alice', 'fish000001');
    await f.apply({ calories: 60 }, { evidence: [{ kind: 'product', facts: [{ entryId: row.uuid, field: 'calories', value: 60 }] }] });
    expect((await f.items.findByUuid('alice', 'fish000001')).calories).toBe(60);
  });
  it('rejects older dates, unknown artwork, stale versions and cancelled work without writes', async () => {
    const f = await fixture();
    await expect(f.apply({ icon: 'unknown' })).rejects.toThrow('Artwork');
    await expect(f.apply({ icon: 'fish' }, { fence: () => false })).rejects.toThrow('active');
    const proposal = f.proposal({ icon: 'fish' }); proposal.updates[0].expectedVersion = 99;
    await expect(f.apply({}, { proposal })).rejects.toMatchObject({ status: 409 });
    f.clock.now = () => Date.parse('2026-09-07T19:00:00Z');
    await expect(f.apply({ icon: 'fish' })).rejects.toMatchObject({ code: 'CLEANUP_DATE_WINDOW' });
    expect((await f.items.listCleanupAudit('alice')).total).toBe(0);
  });
  it('keeps preview read-only but runs the real policy', async () => {
    const f = await fixture(); const revision = f.items.getRevision('alice');
    await f.apply({ icon: 'fish' }, { dryRun: true });
    await expect(f.apply({ grams: 100 }, { dryRun: true })).rejects.toThrow('evidence');
    expect(f.items.getRevision('alice')).toBe(revision);
    expect((await f.items.listCleanupAudit('alice')).total).toBe(0);
  });
  it('rejects overlapping groups and conflicting child versions without partial writes', async () => {
    const f = await fixture();
    const child = { id: 'fish000001', expectedVersion: 1 };
    const proposal = { ...f.proposal({}), updates: [], createGroups: [
      { label: 'Taco', children: [child] }, { label: 'Fish', children: [child] },
    ] };
    await expect(f.apply({}, { proposal })).rejects.toThrow('multiple new groups');
    proposal.createGroups.pop(); proposal.updates = [{ ...child, expectedVersion: 2, changes: { icon: 'fish' } }];
    await expect(f.apply({}, { proposal })).rejects.toThrow('Conflicting child versions');
    expect(await f.items.findByDate('alice', '2026-09-04')).toHaveLength(2);
    expect((await f.items.listCleanupAudit('alice')).total).toBe(0);
  });
  it.each([false, true])('groups existing children without double counting (pending=%s)', async pending => {
    const f = await fixture({ pending });
    const proposal = { ...f.proposal({}), updates: [], createGroups: [{ label: 'Fish Taco', children: [
      { id: 'fish000001', expectedVersion: 1 }, { id: 'tortilla01', expectedVersion: 1 },
    ] }] };
    await f.apply({}, { proposal });
    if (pending) await f.review.execute({ userId: 'alice', logUuid: f.log.id });
    const rows = await f.items.findByDate('alice', '2026-09-04');
    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, row) => sum + row.calories, 0)).toBe(197);
    expect(rows.filter(row => row.parentId)).toHaveLength(2);
    expect(rows.find(row => row.kind === 'group').uuid).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each([false, true])('allows explicit older undo and preserves it against a later cleanup (pending=%s)', async pending => {
    const f = await fixture({ pending });
    await f.apply({ icon: 'fish' });
    f.clock.now = () => Date.parse('2026-09-07T19:00:00Z');
    await f.repairs.undo({ userId: 'alice', repairId: 'repair', operationId: 'undo' });
    await f.repairs.undo({ userId: 'alice', repairId: 'repair', operationId: 'retryundo' });
    const row = pending ? (await f.foodLogs.findById('alice', f.log.id)).items[0] : await f.items.findByUuid('alice', 'fish000001');
    expect(row.icon).toBe('default'); expect(row.manualFields).toContain('icon');
  });
  it('rejects undo after a later edit and preserves manual label aliases', async () => {
    const f = await fixture(); await f.apply({ icon: 'fish' });
    await f.items.update('alice', 'fish000001', { name: 'Cod', manualFields: ['label'] });
    await expect(f.repairs.undo({ userId: 'alice', repairId: 'repair', operationId: 'undo' })).rejects.toMatchObject({ status: 409 });
    const proposal = f.proposal({ name: 'Pollock' }); proposal.updates[0].expectedVersion = 3;
    await expect(f.apply({}, { operationId: 'name', proposal })).rejects.toMatchObject({ code: 'CLEANUP_USER_PROTECTED' });
  });
  it('preserves pending user edits and never confirms during cleanup', async () => {
    const f = await fixture({ pending: true });
    await f.review.execute({ userId: 'alice', logUuid: f.log.id, action: 'save', items: [{ id: 'fish000001', label: 'Cod' }] });
    const log = await f.foodLogs.findById('alice', f.log.id);
    const proposal = f.proposal({ name: 'Pollock' }); proposal.expectedLogVersion = nutritionLogVersion(log);
    await expect(f.apply({}, { proposal })).rejects.toMatchObject({ code: 'CLEANUP_USER_PROTECTED' });
    expect((await f.foodLogs.findById('alice', f.log.id)).status).toBe('pending');
    expect(await f.items.findByDate('alice', '2026-09-04')).toHaveLength(0);
  });
});

describe('durable questions and worker', () => {
  it('resumes after a committed repair without repeating the write or reasoning', async () => {
    const f = await fixture();
    const snapshot = await f.auditor.snapshot('alice');
    const proposal = f.proposal({ icon: 'fish' });
    const evidence = [{ id: 'source', kind: 'capture' }];
    await f.repairs.apply({ userId: 'alice', operationId: 'restart_0', runId: 'restart', proposal, evidence });
    f.store.update('alice', state => {
      state.settings.enabled = true;
      state.runs.restart = { id: 'restart', status: 'running', attempt: 1, snapshot, dryRun: false,
        result: { summary: 'Fish artwork', repairs: [proposal], questions: [], evidence } };
    });
    const runs = { register: vi.fn(), start: vi.fn() };
    const cleanup = new NutritionCleanup({ ...f, runs });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(runs.start).not.toHaveBeenCalled();
    expect(cleanup.status('alice').runs[0].status).toBe('completed');
    expect((await f.items.findByUuid('alice', 'fish000001')).version).toBe(2);
    expect((await f.items.listCleanupAudit('alice')).total).toBe(1);
  });
  it('fences a paused run while reasoning is still in flight', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false }; });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const runs = { register: vi.fn(), cancel: vi.fn(), start: vi.fn(() => gate) };
    const cleanup = new NutritionCleanup({ ...f, runs });
    await cleanup.request('alice');
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, enabled: false });
    release({ status: 'success', result: { summary: 'Fish artwork', repairs: [f.proposal({ icon: 'fish' })], questions: [], evidence: [{ id: 'source', kind: 'capture' }] } });
    await cleanup.settled('alice');
    expect(cleanup.status('alice').runs[0].status).toBe('cancelled');
    expect((await f.items.findByUuid('alice', 'fish000001')).icon).toBe('default');
  });
  it('reconciles at startup and local 03:00, and debounces intermediate revisions', async () => {
    const f = await fixture(); let now = Date.parse('2026-09-04T08:00:00Z');
    f.clock.now = () => now;
    f.store.update('alice', state => { state.settings.enabled = true; });
    const runs = { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } })) };
    const cleanup = new NutritionCleanup({ ...f, runs });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    await cleanup.tick('alice'); expect(runs.start).toHaveBeenCalledTimes(1);
    await f.items.update('alice', 'fish000001', { name: 'Cod' });
    await cleanup.tick('alice');
    now += 59000; await cleanup.tick('alice'); expect(runs.start).toHaveBeenCalledTimes(1);
    now += 1000; await cleanup.tick('alice'); await cleanup.settled('alice'); expect(runs.start).toHaveBeenCalledTimes(2);
    now = Date.parse('2026-09-04T10:00:00Z');
    await cleanup.tick('alice'); await cleanup.settled('alice');
    await cleanup.tick('alice'); expect(runs.start).toHaveBeenCalledTimes(3);
  });
  it('stops retrying failed answers after two recovery attempts', async () => {
    const f = await fixture(); let now = f.clock.now(); f.clock.now = () => now;
    const onAnswer = vi.fn(async () => { throw new Error('service unavailable'); });
    const interactions = new AgentInteractions({ ...f, onAnswer });
    const q = interactions.ask('alice', { issueKey: 'fish', entryVersions: [], choices: [] });
    await expect(interactions.answer({ userId: 'alice', id: q.id, expectedVersion: 1, operationId: 'one', text: 'Cod' })).rejects.toThrow('unavailable');
    await interactions.recover('alice'); expect(onAnswer).toHaveBeenCalledTimes(1);
    now += 30000; await expect(interactions.recover('alice')).rejects.toThrow('unavailable');
    now += 60000; await interactions.recover('alice');
    expect(f.store.load('alice').questions[q.id].status).toBe('stale');
    now += 120000; await interactions.recover('alice'); expect(onAnswer).toHaveBeenCalledTimes(3);
  });
  it('deduplicates cross-surface answers and rejects operation reuse and wrong owners', async () => {
    const f = await fixture(); const onAnswer = vi.fn(async () => ({ status: 'resolved' }));
    const interactions = new AgentInteractions({ ...f, onAnswer });
    const q = interactions.ask('alice', { issueKey: 'fish', entryVersions: [], choices: [{ id: '0' }] });
    const command = { userId: 'alice', id: q.id, expectedVersion: 1, operationId: 'app', choiceId: '0' };
    await Promise.all([interactions.answer(command), interactions.answer(command)]);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    await expect(interactions.answer({ ...command, text: 'different', choiceId: null })).rejects.toMatchObject({ status: 409 });
    await expect(interactions.answer({ ...command, userId: 'bob' })).rejects.toMatchObject({ status: 404 });
    await expect(interactions.answer({ ...command, operationId: 'telegram' })).rejects.toMatchObject({ status: 409 });
  });
  it('recovers an answer intent after a failed processing attempt', async () => {
    const f = await fixture();
    const one = new AgentInteractions({ ...f, onAnswer: async () => { throw new Error('temporary outage'); } });
    const q = one.ask('alice', { issueKey: 'fish', entryVersions: [], choices: [] });
    await expect(one.answer({ userId: 'alice', id: q.id, expectedVersion: 1, operationId: 'one', text: 'cod' })).rejects.toThrow('outage');
    const onAnswer = vi.fn(async () => ({ status: 'resolved' }));
    f.clock.now = () => Date.parse('2026-09-04T19:01:00Z');
    await new AgentInteractions({ ...f, onAnswer }).recover('alice');
    expect(onAnswer).toHaveBeenCalledOnce(); expect(f.store.load('alice').questions[q.id].status).toBe('resolved');
  });
  it('deduplicates simultaneous requests, defaults to preview, and does not swallow a concurrent capture', async () => {
    const f = await fixture();
    const result = { summary: 'Match art', repairs: [f.proposal({ icon: 'fish' })], questions: [], evidence: [{ id: 'source', kind: 'capture' }] };
    const runs = { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) };
    const cleanup = new NutritionCleanup({ ...f, runs });
    await Promise.all([cleanup.request('alice', { manual: true }), cleanup.request('alice', { manual: true })]);
    await cleanup.settled('alice');
    expect(runs.start).toHaveBeenCalledTimes(1);
    expect((await f.items.findByUuid('alice', 'fish000001')).icon).toBe('default');
    expect(cleanup.status('alice').runs[0].outcomes[0].status).toBe('proposed');
    expect(cleanup.status('alice').runs[0].snapshot).toBeUndefined();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false }; });
    const snapshot = await f.auditor.snapshot('alice');
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(f.store.load('alice').checkedFingerprint).toBe(snapshot.fingerprint);
    expect((await f.auditor.snapshot('alice')).fingerprint).not.toBe(snapshot.fingerprint);
  });
  it('closes stale questions at midnight and never writes beyond the new window', async () => {
    const f = await fixture();
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    const q = cleanup.interactions.ask('alice', { issueKey: 'old', choices: [], entryVersions: [{ id: 'fish000001', date: '2026-09-03', version: 1 }] });
    f.clock.now = () => Date.parse('2026-09-05T07:00:00Z');
    await cleanup.tick('alice');
    expect(f.store.load('alice').questions[q.id].status).toBe('stale');
  });
});
