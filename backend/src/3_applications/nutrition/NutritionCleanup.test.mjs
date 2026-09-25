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
import { cleanupDates, entryKey } from '#domains/nutrition/services/cleanupPolicy.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';
import { JsonlAuditJournalStore } from '#adapters/persistence/yaml/JsonlAuditJournalStore.mjs';
import { AgentTranscriptFileStore } from '#adapters/agents/AgentTranscriptFileStore.mjs';

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
  const review = new FoodLogReview({ foodLogs, items, logger, clock });
  const log = createNutriLog({ userId: 'alice', meal: { date: '2026-09-04', time: 'afternoon' }, timezone: timezoneFor(), timestamp: new Date(clock.now()),
    metadata: { source: 'voice' }, items: [
      { id: 'fish000001', label: 'White Fish', calories: 52, grams: 55, amount: 55, unit: 'g', icon: 'default', color: 'green', settled: false },
      { id: 'tortilla01', label: 'Tortilla', calories: 145, grams: 50, amount: 50, unit: 'g', icon: 'default', color: 'yellow', settled: false },
    ] });
  await foodLogs.save(log);
  if (!pending) await review.capture({ userId: 'alice', logUuid: log.id });
  const repairs = new NutritionRepairService({ items, foodLogs, review, clock, timezoneFor, icons: { has: slug => slug === 'fish' } });
  const auditor = new NutritionAuditor({ items, foodLogs, clock, timezoneFor, runtime: {} });
  const proposal = changes => ({ reason: 'Original capture identifies white fish', evidenceIds: ['source'], logUuid: pending ? log.id : null,
    expectedLogVersion: pending ? nutritionLogVersion(log) : null, updates: [{ id: 'fish000001', expectedVersion: 1, changes }], createGroups: [] });
  const apply = (changes, overrides = {}) => repairs.apply({ userId: 'alice', operationId: 'repair', proposal: proposal(changes), evidence: [{ id: 'source', kind: 'capture', data: 'white fish' }], ...overrides });
  return { root, logger, dataService, foodLogs, items, store, clock, timezoneFor, review, log, repairs, auditor, proposal, apply };
}
describe('nutrition cleanup policy and journal', () => {
  it('does not reopen settled legacy history or untouched legacy pending food', async () => {
    const f = await fixture({ pending: true });
    await f.items.saveMany([{ userId: 'alice', uuid: 'legacy', id: 'legacy', name: 'Old food', date: '2026-09-04', calories: 80 }]);
    const snapshot = await f.auditor.snapshot('alice');
    expect(snapshot.rows).toEqual([]);
    await expect(f.repairs.apply({ userId: 'alice', operationId: 'legacy',
      proposal: { reason: 'Artwork', updates: [{ id: 'legacy', expectedVersion: 1, changes: { icon: 'fish' } }] },
      evidence: [{ kind: 'icons' }] })).rejects.toMatchObject({ code: 'CLEANUP_DATE_WINDOW' });
  });
  it('allows a bounded provisional estimate, labels it honestly, and accepts better verified evidence once', async () => {
    const f = await fixture();
    const proposed = { ...f.proposal({ calories: 60 }), mode: 'estimate', confidence: 0.9, reason: 'Estimated cooked white fish at the captured 55g portion' };
    await f.apply({}, { proposal: proposed });
    let row = await f.items.findByUuid('alice', 'fish000001');
    expect(row).toMatchObject({ calories: 60, settled: false, nutrientProvenance: { calories: { source: 'nutrition-auditor-estimate', confidence: 0.9 } } });
    const verified = { ...f.proposal({ calories: 65 }), updates: [{ id: row.uuid, expectedVersion: row.version, changes: { calories: 65 } }] };
    const evidence = [{ id: 'new-panel', kind: 'label', facts: [{ entryId: row.uuid, field: 'calories', value: 65 }] }];
    await f.apply({}, { operationId: 'verified', proposal: verified, evidence });
    await f.apply({}, { operationId: 'verified', proposal: verified, evidence });
    row = await f.items.findByUuid('alice', row.uuid);
    expect(row).toMatchObject({ calories: 65, nutrientProvenance: { calories: { source: 'nutrition-auditor-verified' } } });
    await expect(f.apply({}, { operationId: 'oscillate', proposal: { ...verified, updates: [{ id: row.uuid, expectedVersion: row.version, changes: { calories: 60 } }] }, evidence }))
      .rejects.toMatchObject({ code: 'CLEANUP_ALREADY_REPAIRED' });
  });
  it('rejects low confidence, guessed portions and estimates beyond the review deadline', async () => {
    const f = await fixture();
    await expect(f.apply({}, { proposal: { ...f.proposal({ calories: 60 }), mode: 'estimate', confidence: 0.6 } })).rejects.toMatchObject({ code: 'CLEANUP_REVIEW_REQUIRED' });
    await expect(f.apply({}, { proposal: { ...f.proposal({ grams: 500 }), mode: 'estimate', confidence: 0.99 } })).rejects.toMatchObject({ code: 'CLEANUP_REVIEW_REQUIRED' });
    f.clock.now = () => Date.parse('2026-09-07T19:00:00Z');
    await expect(f.apply({ icon: 'fish' })).rejects.toMatchObject({ code: 'CLEANUP_DATE_WINDOW' });
  });
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
  it('gate mode skips the LLM audit on a clean triage verdict; shadow mode records it and audits anyway', async () => {
    const clean = { active: true, gating: true, assess: vi.fn(async () => ({ needsAudit: false, reason: 'clean', score: 0.05 })) };
    const f = await fixture();
    f.store.update('alice', state => { state.settings.enabled = true; });
    const runs = { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } })) };
    const gated = new NutritionCleanup({ ...f, runs, triage: clean });
    expect(await gated.request('alice')).toBeNull();
    expect(runs.start).not.toHaveBeenCalled();
    expect(f.logger.info).toHaveBeenCalledWith('nutrition.cleanup.skipped', expect.objectContaining({ reason: 'clean' }));
    // the skipped fingerprint counts as checked
    expect(await gated.request('alice')).toBeNull();
    // manual and reconcile runs are never gated
    await gated.request('alice', { manual: true }); await gated.settled('alice');
    expect(runs.start).toHaveBeenCalledTimes(1);

    const g = await fixture();
    g.store.update('alice', state => { state.settings.enabled = true; });
    const shadowRuns = { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } })) };
    const shadow = { active: true, gating: false, assess: vi.fn(async () => ({ needsAudit: false, reason: 'clean', score: 0.05 })) };
    const cleanup = new NutritionCleanup({ ...g, runs: shadowRuns, triage: shadow });
    await cleanup.request('alice'); await cleanup.settled('alice');
    expect(shadowRuns.start).toHaveBeenCalledTimes(1);
    expect(g.logger.info).toHaveBeenCalledWith('nutrition.cleanup.completed', expect.objectContaining({
      changed: 0, triageNeedsAudit: false, triageReason: 'clean', triageScore: 0.05 }));
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
    // minGapMinutes 0: this test is about the debounce, not the gap between runs.
    f.store.update('alice', state => { state.settings.enabled = true; state.settings.minGapMinutes = 0; });
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
  it('deduplicates simultaneous requests and defaults to preview', async () => {
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
  });
  it('does not re-audit its own repair', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false, minGapMinutes: 0 }; });
    const repair = { summary: 'Match art', repairs: [f.proposal({ icon: 'fish' })], questions: [], evidence: [{ id: 'source', kind: 'capture' }] };
    const start = vi.fn().mockResolvedValueOnce({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } })
      .mockResolvedValue({ status: 'success', result: repair });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start }, hash: sha256Text });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    const pre = await f.auditor.snapshot('alice');
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect((await f.items.findByUuid('alice', 'fish000001')).icon).toBe('fish');
    const post = await f.auditor.snapshot('alice');
    expect(post.fingerprint).not.toBe(pre.fingerprint);
    expect(f.store.load('alice').checkedFingerprint).toBe(post.fingerprint);
    f.clock.now = () => Date.parse('2026-09-04T19:05:00Z');
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('does not swallow a capture that lands while the audit is reasoning', async () => {
    const f = await fixture(); let now = f.clock.now(); f.clock.now = () => now;
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false, minGapMinutes: 0 }; });
    let release;
    const start = vi.fn().mockResolvedValueOnce({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValue({ status: 'success', result: { summary: 'No changes', repairs: [], questions: [], evidence: [] } });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start }, hash: sha256Text });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    const pre = await f.auditor.snapshot('alice');
    await cleanup.request('alice', { manual: true });
    const log = createNutriLog({ userId: 'alice', meal: { date: '2026-09-04', time: 'afternoon' }, timezone: f.timezoneFor(), timestamp: new Date(now),
      metadata: { source: 'voice' }, items: [{ id: 'apple00001', label: 'Apple', calories: 95, grams: 180, amount: 1, unit: 'each', icon: 'default', color: 'green', settled: false }] });
    await f.foodLogs.save(log); await f.review.capture({ userId: 'alice', logUuid: log.id });
    release({ status: 'success', result: { summary: 'Match art', repairs: [f.proposal({ icon: 'fish' })], questions: [], evidence: [{ id: 'source', kind: 'capture' }] } });
    await cleanup.settled('alice');
    expect(f.store.load('alice').checkedFingerprint).toBe(pre.fingerprint);
    await cleanup.tick('alice'); now += 120000; await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(3);
    expect(Object.values(f.store.load('alice').runs).find(run => !run.manual && run.trigger?.includes('captures'))).toBeTruthy();
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

describe('auditor settings, permissions and history', () => {
  const noChanges = { summary: 'No changes', repairs: [], questions: [], evidence: [] };
  it('rejects an unknown model with 400 and leaves state unchanged; still 409 on a stale version', async () => {
    const f = await fixture();
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    const before = f.store.load('alice');
    await expect(cleanup.settings('alice', { expectedVersion: before.version, model: 'gpt-9' })).rejects.toMatchObject({ status: 400 });
    expect(f.store.load('alice')).toEqual(before);
    await expect(cleanup.settings('alice', { expectedVersion: before.version + 7, model: 'gpt-4o' })).rejects.toMatchObject({ status: 409 });
  });
  it('logs each changed leaf once, newest first, and nothing for a no-op', async () => {
    const f = await fixture();
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, model: 'gpt-4.1-mini', permissions: { nutrients: true } });
    expect(cleanup.settingsLog('alice')).toEqual([]);
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, model: 'gpt-4o' });
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, permissions: { nutrients: false } });
    const log = cleanup.settingsLog('alice');
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ field: 'permissions.nutrients', from: true, to: false, actor: 'user' });
    expect(log[1]).toEqual({ at: '2026-09-04T19:00:00.000Z', actor: 'user', field: 'model', from: 'gpt-4.1-mini', to: 'gpt-4o' });
    const status = cleanup.status('alice').settings;
    expect(status.model).toBe('gpt-4o');
    expect(status.permissions).toMatchObject({ nutrients: false, naming: true });
  });
  it('exposes effective defaults for a fresh user beside the existing switches', async () => {
    const f = await fixture();
    const settings = new NutritionCleanup({ ...f, runs: { register: vi.fn() } }).status('alice').settings;
    expect(settings).toMatchObject({ enabled: false, dryRun: true, telegram: false, model: 'gpt-4.1-mini' });
    expect(Object.values(settings.permissions).every(Boolean)).toBe(true);
  });
  it('blocks a nutrient repair when nutrients are switched off, without writing', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false, permissions: { nutrients: false } }; });
    const row = await f.items.findByUuid('alice', 'fish000001');
    const result = { summary: 'Panel', repairs: [f.proposal({ calories: 60 })], questions: [],
      evidence: [{ id: 'source', kind: 'product', facts: [{ entryId: row.uuid, field: 'calories', value: 60 }] }] };
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) } });
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(cleanup.status('alice').runs[0].outcomes[0]).toMatchObject({ status: 'blocked', kinds: ['nutrients'] });
    expect((await f.items.findByUuid('alice', 'fish000001')).calories).toBe(52);
    expect(f.logger.info).toHaveBeenCalledWith('nutrition.cleanup.blocked', expect.objectContaining({ userId: 'alice', kinds: ['nutrients'] }));
  });
  it('keeps questions off the cards when questions are switched off', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false, permissions: { questions: false } }; });
    const question = { question: 'Was the fish 55 g or 100 g?', entryIds: ['fish000001'],
      choices: [{ label: '55 g', repair: f.proposal({ grams: 55 }) }, { label: '100 g', repair: f.proposal({ grams: 100 }) }] };
    const result = { summary: 'Portion unclear', repairs: [], questions: [question], evidence: [{ id: 'source', kind: 'capture' }] };
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) } });
    const ask = vi.spyOn(cleanup.interactions, 'ask');
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(ask).not.toHaveBeenCalled();
    expect(cleanup.status('alice').runs[0].suppressedQuestions).toEqual([{ question: question.question, entryIds: ['fish000001'], reason: 'questions-off' }]);
  });
  it('runs the chosen model and keeps its usage and cost on the completed run', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: true, telegram: false, model: 'gpt-4o' }; });
    const result = { ...noChanges, model: { provider: 'openai', name: 'gpt-4o' }, usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 1024, raw: { prompt_tokens: 1200 } },
      costUsd: 0.0038, turnId: 'turn_1', toolCalls: [{ name: 'find_food_art', args: '{"q":"fish"}' }] };
    const runs = { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) };
    const cleanup = new NutritionCleanup({ ...f, runs });
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(runs.start.mock.calls[0][0].input).toMatchObject({ model: 'gpt-4o', permissions: { nutrients: true, questions: true } });
    const [run] = Object.values(f.store.load('alice').runs);
    expect(run).toMatchObject({ status: 'completed', model: 'gpt-4o', usage: { input: 1200, cached: 1024, output: 80 }, costUsd: 0.0038, turnId: 'turn_1',
      toolCalls: [{ name: 'find_food_art' }] });
    expect(run.result).toBeUndefined();
  });
  it('keeps the model as its plain name on a completed run', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: true, telegram: false, model: 'gpt-4o' }; });
    const result = { ...noChanges, model: { provider: 'openai', name: 'gpt-4o' } };
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) } });
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(Object.values(f.store.load('alice').runs)[0]).toMatchObject({ status: 'completed', model: 'gpt-4o' });
  });
  it('drops choices the settings forbid and does not ask a question left with one answer', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: false, telegram: false, permissions: { nutrients: false } }; });
    const tortilla = changes => ({ ...f.proposal({}), updates: [{ id: 'tortilla01', expectedVersion: 1, changes }] });
    const fish = { question: 'Was the fish 55 g or 60 kcal?', entryIds: ['fish000001'],
      choices: [{ label: '55 g', repair: f.proposal({ grams: 55 }) }, { label: '60 kcal', repair: f.proposal({ calories: 60 }) }] };
    const wrap = { question: 'Was it corn or flour?', entryIds: ['tortilla01'], choices: [{ label: 'Corn', repair: tortilla({ name: 'Corn Tortilla' }) },
      { label: 'Flour', repair: tortilla({ name: 'Flour Tortilla' }) }, { label: '99 kcal', repair: tortilla({ calories: 99 }) }] };
    const result = { summary: 'Unclear', repairs: [], questions: [fish, wrap], evidence: [{ id: 'source', kind: 'capture' }] };
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) } });
    const ask = vi.spyOn(cleanup.interactions, 'ask');
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][1].choices.map(c => [c.id, c.label])).toEqual([['0', 'Corn'], ['1', 'Flour']]);
    expect(cleanup.status('alice').runs[0].suppressedQuestions).toEqual([{ question: fish.question, entryIds: ['fish000001'], reason: 'blocked' }]);
  });
  const seedQuestion = async (f, run, choices) => {
    const row = await f.items.findByUuid('alice', 'fish000001');
    f.store.update('alice', state => {
      state.runs[run.id] = { status: 'completed', ...run };
      state.questions.q1 = { id: 'q1', userId: 'alice', version: 1, status: 'open', runId: run.id, question: 'How much fish?',
        entryVersions: [{ id: entryKey(row), version: row.version ?? 1, date: '2026-09-04' }], choices, evidence: [{ id: 'source', kind: 'capture' }] };
    });
  };
  it('refuses a chosen answer whose repair the originating run did not permit', async () => {
    const f = await fixture();
    const row = await f.items.findByUuid('alice', 'fish000001');
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    const repair = { ...f.proposal({ calories: 60 }), evidenceIds: ['source'] };
    await seedQuestion(f, { id: 'audit_old', permissions: { ...cleanup.status('alice').settings.permissions, nutrients: false } }, [{ id: '0', label: '60 kcal', repair }]);
    const answered = await cleanup.interactions.answer({ userId: 'alice', id: 'q1', expectedVersion: 1, operationId: 'op1', choiceId: '0' });
    expect(answered).toMatchObject({ status: 'stale', outcome: { message: 'Not permitted by auditor settings' } });
    expect((await f.items.findByUuid('alice', row.uuid)).calories).toBe(52);
    expect((await f.items.listCleanupAudit('alice')).total).toBe(0);
  });
  it('re-audits a typed answer with the originating run model and permissions, and refuses a forbidden result', async () => {
    const f = await fixture();
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    const permissions = { ...cleanup.status('alice').settings.permissions, nutrients: false };
    await seedQuestion(f, { id: 'audit_old', model: 'gpt-4o', permissions }, []);
    f.auditor.audit = vi.fn(async () => ({ summary: '', questions: [], repairs: [f.proposal({ calories: 60 })], evidence: [{ id: 'source', kind: 'capture' }] }));
    const answered = await cleanup.interactions.answer({ userId: 'alice', id: 'q1', expectedVersion: 1, operationId: 'op1', text: 'it was 60 kcal' });
    expect(f.auditor.audit.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o', permissions, answer: { text: 'it was 60 kcal' } });
    expect(answered).toMatchObject({ status: 'stale', outcome: { message: 'Not permitted by auditor settings' } });
    expect((await f.items.findByUuid('alice', 'fish000001')).calories).toBe(52);
  });
  it('falls back to current settings when the originating run is gone', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: false, dryRun: true, telegram: false, model: 'gpt-4.1', permissions: { naming: false } }; });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    await seedQuestion(f, { id: 'pruned' }, []);
    f.store.update('alice', state => { delete state.runs.pruned; });
    f.auditor.audit = vi.fn(async () => ({ summary: '', questions: [], repairs: [f.proposal({ name: 'Cod' })], evidence: [{ id: 'source', kind: 'capture' }] }));
    const answered = await cleanup.interactions.answer({ userId: 'alice', id: 'q1', expectedVersion: 1, operationId: 'op1', text: 'cod' });
    expect(f.auditor.audit.mock.calls[0][0]).toMatchObject({ model: 'gpt-4.1', permissions: { naming: false } });
    expect(answered).toMatchObject({ status: 'stale', outcome: { message: 'Not permitted by auditor settings' } });
  });
  it('refuses a prepared answer the originating run did not permit', async () => {
    const f = await fixture();
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    await seedQuestion(f, { id: 'audit_old', permissions: { ...cleanup.status('alice').settings.permissions, nutrients: false } }, []);
    const row = await f.items.findByUuid('alice', 'fish000001');
    f.store.update('alice', state => Object.assign(state.questions.q1, { status: 'answering', answerAttempts: 0,
      answer: { operationId: 'op1', choiceId: null, text: '60 kcal', dismiss: false },
      prepared: { proposal: f.proposal({ calories: 60 }), evidence: [{ id: 'panel', kind: 'product', facts: [{ entryId: row.uuid, field: 'calories', value: 60 }] }] } }));
    await cleanup.interactions.recover('alice');
    expect(f.store.load('alice').questions.q1).toMatchObject({ status: 'stale', outcome: { message: 'Not permitted by auditor settings' } });
    expect((await f.items.findByUuid('alice', 'fish000001')).calories).toBe(52);
  });
  it('records blocked and unmatched questions in dry run too', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: true, telegram: false, permissions: { nutrients: false } }; });
    const blocked = { question: 'How many calories?', entryIds: ['fish000001'],
      choices: [{ label: '60 kcal', repair: f.proposal({ calories: 60 }) }, { label: '70 kcal', repair: f.proposal({ calories: 70 }) }] };
    const missing = { question: 'Which fish?', entryIds: ['gone000001'],
      choices: [{ label: 'Cod', repair: f.proposal({ name: 'Cod' }) }, { label: 'Hake', repair: f.proposal({ name: 'Hake' }) }] };
    const result = { summary: 'Unclear', repairs: [], questions: [blocked, missing], evidence: [{ id: 'source', kind: 'capture' }] };
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result })) } });
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(cleanup.status('alice').runs[0].suppressedQuestions).toEqual([
      { question: blocked.question, entryIds: ['fish000001'], reason: 'blocked' },
      { question: missing.question, entryIds: ['gone000001'], reason: 'entries-missing' },
    ]);
  });
  it('retries with the input fixed at queue time, even after a settings change', async () => {
    const f = await fixture(); let now = f.clock.now(); f.clock.now = () => now;
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: true, telegram: false }; });
    const start = vi.fn().mockRejectedValueOnce(new Error('provider timeout')).mockResolvedValue({ status: 'success', result: noChanges });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start } });
    await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, model: 'gpt-4o', permissions: { naming: false } });
    now += 61000; await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1][0]).toEqual(start.mock.calls[0][0]);
    expect(start.mock.calls[1][0].input.model).toBe('gpt-4.1-mini');
    expect(cleanup.status('alice').runs[0]).toMatchObject({ status: 'completed', model: 'gpt-4.1-mini' });
  });
  it('keeps the newest 500 settings changes', async () => {
    const f = await fixture();
    f.store.update('alice', state => { state.settingsLog = Array.from({ length: 499 }, (_, i) => ({ at: 'old', actor: 'user', field: 'dryRun', from: i, to: i })); });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, model: 'gpt-4o', minGapMinutes: 30 });
    const log = cleanup.settingsLog('alice');
    expect(log).toHaveLength(500);
    expect(log[0].field).toBe('minGapMinutes'); expect(log.at(-1).from).toBe(1);
  });
  it('reads and writes state saved before the settings log existed', async () => {
    const f = await fixture();
    f.store.update('alice', state => { delete state.settingsLog; });
    expect(f.store.load('alice')).not.toHaveProperty('settingsLog');
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() } });
    expect(cleanup.settingsLog('alice')).toEqual([]);
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, dryRun: false });
    expect(cleanup.settingsLog('alice')).toMatchObject([{ field: 'dryRun', from: true, to: false }]);
  });
  it('keeps the newest 50 finished runs and any run a question still points at', async () => {
    const f = await fixture();
    f.store.update('alice', state => {
      for (let i = 0; i < 55; i++) {
        const id = 'r' + String(i).padStart(2, '0');
        state.runs[id] = { id, status: ['completed', 'failed', 'cancelled'][i % 3], createdAt: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60000).toISOString() };
      }
      state.questions.q1 = { id: 'q1', status: 'open', runId: 'r00', entryVersions: [], choices: [] };
      state.questions.q2 = { id: 'q2', status: 'resolved', runId: 'r01', entryVersions: [], choices: [] };
    });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn(), start: vi.fn(async () => ({ status: 'success', result: noChanges })) } });
    const { runId } = await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    const kept = Object.keys(f.store.load('alice').runs);
    expect(kept).toHaveLength(51);
    expect(kept).toEqual(expect.arrayContaining([runId, 'r00', 'r06', 'r54']));
    expect(kept).not.toContain('r01'); expect(kept).not.toContain('r05');
  });
});

describe('auditor journal and run gates', () => {
  const noChanges = { summary: 'No changes', repairs: [], questions: [], evidence: [] };
  const gated = async (settings = {}, extra = {}) => {
    const f = await fixture(); let now = f.clock.now(); f.clock.now = () => now;
    f.store.update('alice', state => { state.settings = { enabled: true, dryRun: true, telegram: false, ...settings }; });
    const journal = new JsonlAuditJournalStore({ dataService: f.dataService, logger: f.logger });
    const start = vi.fn(async () => ({ status: 'success', result: noChanges }));
    const make = () => new NutritionCleanup({ ...f, runs: { register: vi.fn(), start }, hash: sha256Text, journalStore: journal, ...extra });
    return { f, journal, start, cleanup: make(), make, advance: ms => { now += ms; }, now: () => now, at: time => { now = Date.parse(time); } };
  };
  const capture = async (f, date, label = 'Apple') => {
    const log = createNutriLog({ userId: 'alice', meal: { date, time: 'morning' }, timezone: f.timezoneFor(), timestamp: new Date(f.clock.now()),
      metadata: { source: 'voice' }, items: [{ id: label.toLowerCase().padEnd(10, '0').slice(0, 10), label, calories: 95, grams: 180, amount: 1, unit: 'each', icon: 'default', color: 'green', settled: false }] });
    await f.foodLogs.save(log); await f.review.capture({ userId: 'alice', logUuid: log.id });
  };
  const latestRun = f => Object.values(f.store.load('alice').runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  it('a 03:00 sweep with the daily sweep off still audits a capture that landed just before it', async () => {
    const { f, journal, start, cleanup, at } = await gated({ minGapMinutes: 0, triggers: { dailySweep: false } });
    at('2026-09-05T09:00:00Z');
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(latestRun(f).trigger).toEqual(['unclassified', 'dailySweep']);
    at('2026-09-05T09:59:30Z'); await capture(f, '2026-09-05'); await cleanup.tick('alice');
    at('2026-09-05T10:00:00Z'); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(2);
    expect(latestRun(f).trigger).toEqual(expect.arrayContaining(['captures', 'dailySweep']));
    expect((await journal.list('alice')).filter(row => row.skipped)).toEqual([]);
  });
  it('a restart while a capture is debouncing still audits it with the daily sweep off', async () => {
    const { f, start, cleanup, make, advance } = await gated({ minGapMinutes: 0, triggers: { dailySweep: false } });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    advance(60000); await capture(f, '2026-09-04'); await cleanup.tick('alice');
    const restarted = make();
    advance(10000); await restarted.tick('alice'); await restarted.settled('alice');
    expect(start).toHaveBeenCalledTimes(2);
    expect(latestRun(f).trigger).toEqual(expect.arrayContaining(['captures', 'dailySweep']));
  });
  it('caps on ledger spend, reads it once while capped, and lifts when the cap is raised', async () => {
    const spendSource = vi.fn(async () => [{ ts: '2026-09-04T18:00:00.000Z', costUsd: 1.5 }, { ts: 'garbage', costUsd: 9 }, { ts: '2026-09-03T18:00:00.000Z', costUsd: 9 }]);
    const { f, journal, start, cleanup, advance } = await gated({ minGapMinutes: 0, dailyCapUsd: 1 }, { spendSource });
    for (let i = 0; i < 10; i++) {
      if (i === 3) await f.items.update('alice', 'fish000001', { name: 'Cod' });
      await cleanup.tick('alice'); await cleanup.settled('alice'); advance(60000);
    }
    expect(start).not.toHaveBeenCalled();
    expect(spendSource).toHaveBeenCalledTimes(1);
    expect(f.logger.info.mock.calls.filter(([event]) => event === 'nutrition.cleanup.capped')).toHaveLength(1);
    expect((await journal.list('alice')).filter(row => row.skipped)).toEqual([expect.objectContaining({ skipped: 'cap', spentUsd: 1.5, capUsd: 1 })]);
    // A raised cap that is still exceeded is its own event.
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, dailyCapUsd: 1.25 });
    await cleanup.tick('alice'); await cleanup.settled('alice'); advance(1000);
    expect(start).not.toHaveBeenCalled();
    expect((await journal.list('alice')).filter(row => row.skipped).map(row => row.capUsd)).toEqual([1.25, 1]);
    await cleanup.settings('alice', { expectedVersion: cleanup.status('alice').version, dailyCapUsd: 5 });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('a sweep due while the gap holds runs once the gap ends', async () => {
    const { f, start, cleanup, advance, now } = await gated({ minGapMinutes: 15 });
    f.store.update('alice', state => { state.lastAutoRunAt = now() - 5 * 60000; });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).not.toHaveBeenCalled();
    advance(9 * 60000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).not.toHaveBeenCalled();
    advance(60000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(latestRun(f).trigger).toContain('dailySweep');
  });
  it('backs a failing sweep off for ten minutes instead of failing every tick', async () => {
    const { f, start, cleanup, advance } = await gated({ minGapMinutes: 0 });
    const snapshot = vi.spyOn(f.auditor, 'snapshot').mockRejectedValueOnce(new Error('food log unreadable'));
    await expect(cleanup.tick('alice')).resolves.toBeUndefined();
    expect(f.logger.warn).toHaveBeenCalledWith('nutrition.cleanup.sweep_failed', expect.objectContaining({ userId: 'alice', error: 'food log unreadable' }));
    advance(60000); await cleanup.tick('alice');
    advance(8 * 60000); await cleanup.tick('alice');
    expect(snapshot).toHaveBeenCalledTimes(1);
    advance(60000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('does not audit a deleted entry; the remaining rows are unchanged', async () => {
    const { f, journal, start, cleanup, advance } = await gated({ minGapMinutes: 0 });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    const tortilla = await f.items.findByUuid('alice', 'tortilla01');
    await f.items.deleteById('alice', tortilla.uuid);
    advance(60000); await cleanup.tick('alice'); advance(120000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(f.store.load('alice').checkedFingerprint).toBe((await f.auditor.snapshot('alice')).fingerprint);
    expect((await journal.list('alice')).filter(row => row.skipped)).toEqual([]);
  });
  it('a capped sweep is retried once the household day turns over', async () => {
    const spendSource = vi.fn(async () => [{ ts: '2026-09-04T18:00:00.000Z', costUsd: 1.5 }]);
    const { f, start, cleanup, at } = await gated({ minGapMinutes: 0 }, { spendSource });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).not.toHaveBeenCalled();
    expect(f.store.load('alice').lastSweepDay).toBeUndefined();
    at('2026-09-05T11:00:00Z');
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(latestRun(f).trigger).toContain('dailySweep');
    expect(f.store.load('alice').lastSweepDay).toBe('2026-09-05');
  });
  it('never fails a request over an unreadable spend source', async () => {
    const spendSource = vi.fn(async () => { throw new Error('ledger unreadable'); });
    const { start, cleanup } = await gated({ minGapMinutes: 0 }, { spendSource });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('holds automatic runs to the minimum gap while changes accumulate', async () => {
    const { f, start, cleanup, advance, now } = await gated({ minGapMinutes: 15 });
    const t0 = now();
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(cleanup.status('alice').nextEligibleAt).toBe(new Date(t0 + 15 * 60000).toISOString());
    advance(60000); await f.items.update('alice', 'fish000001', { name: 'Cod' }); await cleanup.tick('alice');
    advance(120000); await cleanup.tick('alice');
    advance(180000); await f.items.update('alice', 'tortilla01', { name: 'Corn Tortilla' }); await cleanup.tick('alice');
    advance(180000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    advance(t0 + 15 * 60000 - now()); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(2);
    expect(latestRun(f).trigger).toEqual(['edits']);
    expect(start.mock.calls[1][0].input.snapshot.rows.map(row => row.name)).toEqual(expect.arrayContaining(['Cod', 'Corn Tortilla']));
  });
  it('skips automatic runs once today is over the spend cap, noting it once; a manual run still goes', async () => {
    const { f, journal, start, cleanup, advance, now } = await gated({ dailyCapUsd: 1 });
    await journal.append('alice', { runId: 'audit_earlier', at: new Date(now() - 3600000).toISOString(), status: 'completed', costUsd: 1.2 });
    await journal.append('alice', { runId: 'audit_yesterday', at: new Date(now() - 30 * 3600000).toISOString(), status: 'completed', costUsd: 5 });
    await cleanup.tick('alice'); await cleanup.settled('alice');
    advance(60000); await cleanup.tick('alice'); advance(120000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).not.toHaveBeenCalled();
    const skips = (await journal.list('alice')).filter(row => row.skipped);
    expect(skips).toEqual([expect.objectContaining({ skipped: 'cap', spentUsd: 1.2, capUsd: 1 })]);
    const { runId } = await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(f.store.load('alice').runs[runId]).toMatchObject({ status: 'completed', overCap: true, trigger: ['manual'] });
  });
  it('marks a change of a switched-off trigger as checked without a run', async () => {
    const { f, journal, start, cleanup, advance } = await gated({ minGapMinutes: 0, triggers: { scaleReconcile: false } });
    let observations = [];
    f.auditor.observations = { listByDate: async (_userId, date) => observations.filter(o => o.date === date) };
    await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    observations = [{ id: 'scale1', date: '2026-09-04', grams: 180 }];
    advance(60000); await cleanup.tick('alice'); advance(120000); await cleanup.tick('alice'); await cleanup.settled('alice');
    expect(start).toHaveBeenCalledTimes(1);
    expect(f.store.load('alice').checkedFingerprint).toBe((await f.auditor.snapshot('alice')).fingerprint);
    expect((await journal.list('alice')).filter(row => row.skipped)).toEqual([expect.objectContaining({ skipped: 'filtered', kinds: ['scaleReconcile'] })]);
  });
  it('journals a completed run under its start time', async () => {
    const { f, journal, start, cleanup } = await gated({ minGapMinutes: 0 });
    const question = { question: 'Was the fish 55 g or 100 g?', entryIds: ['fish000001'],
      choices: [{ label: '55 g', repair: f.proposal({ grams: 55 }) }, { label: '100 g', repair: f.proposal({ grams: 100 }) }] };
    start.mockResolvedValue({ status: 'success', result: { summary: 'Match art', repairs: [f.proposal({ icon: 'fish' })], questions: [question],
      evidence: [{ id: 'source', kind: 'capture' }], model: { provider: 'openai', name: 'gpt-4.1-mini' }, usage: { inputTokens: 900, outputTokens: 40, raw: { any: 'provider detail' } }, costUsd: 0.002,
      turnId: 'turn_9', toolCalls: [{ name: 'find_food_art', args: '{}' }] } });
    const { runId } = await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    const run = f.store.load('alice').runs[runId];
    const [row] = await journal.list('alice');
    expect(row).toEqual({ runId, at: run.createdAt, completedAt: run.completedAt, status: 'completed', trigger: ['manual'], model: 'gpt-4.1-mini',
      usage: { input: 900, cached: null, output: 40 }, costUsd: 0.002, turnId: 'turn_9', toolCalls: [{ name: 'find_food_art', args: '{}' }],
      outcomes: [expect.objectContaining({ status: 'proposed' })], questions: [{ question: question.question, choices: ['55 g', '100 g'] }],
      suppressedQuestions: [], summary: 'Match art', dryRun: true, manual: true, overCap: false });
  });
  it('journals a run that fails for good, and a journal failure never fails a run', async () => {
    const { f, journal, start, cleanup } = await gated({ minGapMinutes: 0 });
    start.mockRejectedValue(Object.assign(new Error('bad schema'), { code: 'AGENT_SCHEMA_INVALID' }));
    const { runId } = await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    const run = f.store.load('alice').runs[runId];
    expect((await journal.list('alice'))[0]).toMatchObject({ runId, at: run.createdAt, status: 'failed', error: 'bad schema', attempt: 1, trigger: ['manual'], model: 'gpt-4.1-mini' });
    start.mockResolvedValue({ status: 'success', result: noChanges });
    cleanup.journalStore = { append: vi.fn(async () => { throw new Error('disk full'); }), list: vi.fn(async () => []) };
    const second = await cleanup.request('alice', { manual: true }); await cleanup.settled('alice');
    expect(f.store.load('alice').runs[second.runId].status).toBe('completed');
    expect(f.logger.warn).toHaveBeenCalledWith('nutrition.cleanup.journal_failed', expect.objectContaining({ runId: second.runId, error: 'disk full' }));
  });
});

describe('auditor journal and spend views', () => {
  const run = (runId, at, extra) => ({ runId, at, status: 'completed', model: 'gpt-4.1-mini', trigger: ['captures'], outcomes: [], ...extra });
  const seeded = async () => {
    const f = await fixture();
    const journal = new JsonlAuditJournalStore({ dataService: f.dataService, logger: f.logger });
    const store = new AgentTranscriptFileStore({ mediaDir: path.join(f.root, 'media') });
    const transcripts = { find: args => store.find({ agentId: 'nutrition-auditor', ...args }) };
    const spendSource = vi.fn(async () => [{ ts: '2026-09-04T18:00:00.000Z', costUsd: 0.03 }, { ts: '2026-09-03T18:00:00.000Z', costUsd: 9 }]);
    for (const row of [
      run('r4', '2026-08-20T18:00:00.000Z', { model: 'gpt-4o', costUsd: 0.1 }),
      run('r3', '2026-09-01T06:00:00.000Z', { trigger: ['unclassified', 'dailySweep'], costUsd: 0.02, outcomes: [{ status: 'proposed' }] }),
      run('r2', '2026-09-03T18:00:00.000Z', { model: 'gpt-4o', trigger: ['edits'], costUsd: 0.05, outcomes: [{ status: 'skipped' }], turnId: 'turnbbbb0000',
        usage: { inputTokens: 5000, outputTokens: 300, cachedInputTokens: 0, raw: { prompt_tokens: 5000 } } }),
      { runId: 'r5', at: '2026-09-04T16:00:00.000Z', status: 'failed', error: 'bad schema', attempt: 1, trigger: ['captures'], model: 'gpt-4.1-mini' },
      { at: '2026-09-04T17:00:00.000Z', skipped: 'filtered', kinds: ['artwork'] },
      run('r1', '2026-09-04T18:00:00.000Z', { costUsd: 0.01, outcomes: [{ status: 'applied' }], turnId: 'turnaaaa1111', usage: { input: 1000, cached: 512, output: 50 } }),
      run('r4b', '2026-08-21T18:00:00.000Z', { model: 'gpt-4o', costUsd: null, usage: { input: 100, cached: 0, output: 10 } }),
    ]) await journal.append('alice', row);
    await store.save({ agentId: 'nutrition-auditor', userId: 'alice', turnId: 'turnaaaa1111', startedAt: new Date('2026-09-04T18:00:02.500Z'), transcript: {
      turnId: 'turnaaaa1111', systemPrompt: 'You audit nutrition records.',
      input: { text: JSON.stringify({ snapshot: { rows: [{ id: 'a' }, { id: 'b' }], pending: [{ id: 'log', items: [{ id: 'c' }] }] } }), context: {} },
      toolCalls: [{ ix: 0, name: 'find_food_art', args: { q: 'fish' }, result: { slugs: ['fish'] }, ok: true, latencyMs: 12, ts: 'x', linkedAttachments: [] }],
    } });
    const cleanup = new NutritionCleanup({ ...f, runs: { register: vi.fn() }, hash: sha256Text, journalStore: journal, transcripts, spendSource });
    return { f, cleanup };
  };
  it('lists the last seven household days newest first, with trigger, changed and paging filters', async () => {
    const { cleanup } = await seeded();
    const all = await cleanup.journal('alice');
    expect(all.total).toBe(5);
    expect(all.rows.map(row => row.runId ?? row.skipped)).toEqual(['r1', 'filtered', 'r5', 'r2', 'r3']);
    expect((await cleanup.journal('alice', { trigger: 'captures' })).rows.map(row => row.runId)).toEqual(['r1', 'r5']);
    expect((await cleanup.journal('alice', { changed: true })).rows.map(row => row.runId)).toEqual(['r1', 'r3']);
    expect(await cleanup.journal('alice', { offset: 1, limit: 2 })).toMatchObject({ total: 5, rows: [{ skipped: 'filtered' }, { runId: 'r5' }] });
    // r3 started at 23:00 on 08-31 household time
    expect((await cleanup.journal('alice', { from: '2026-08-31', to: '2026-08-31' })).rows.map(row => row.runId)).toEqual(['r3']);
    expect((await cleanup.journal('alice', { from: '2026-08-20', to: '2026-08-20' })).total).toBe(1);
  });
  it('opens one run with its transcript, or marks the transcript expired', async () => {
    const { cleanup } = await seeded();
    expect(await cleanup.journalEntry('alice', 'r1')).toMatchObject({ runId: 'r1', costUsd: 0.01, transcriptExpired: false, transcript: {
      toolCalls: [{ name: 'find_food_art', args: { q: 'fish' }, result: { slugs: ['fish'] }, ok: true, latencyMs: 12 }],
      inputRows: 3, systemPromptChars: 'You audit nutrition records.'.length } });
    expect(await cleanup.journalEntry('alice', 'r2')).toMatchObject({ runId: 'r2', transcript: null, transcriptExpired: true });
    expect(await cleanup.journalEntry('alice', 'r3')).toMatchObject({ runId: 'r3', transcript: null, transcriptExpired: false });
    expect(await cleanup.journalEntry('alice', 'nope')).toBeNull();
    expect((await cleanup.journalEntry('alice', 'r2')).usage).toEqual({ input: 5000, cached: 0, output: 300 });
    expect((await cleanup.journal('alice', { from: '2026-09-03', to: '2026-09-04' })).rows.filter(row => row.runId).map(row => row.usage))
      .toEqual([{ input: 1000, cached: 512, output: 50 }, null, { input: 5000, cached: 0, output: 300 }]);
    expect(await cleanup.journalEntry('alice', 'r1', { at: '2026-09-04T18:00:00.000Z' })).toMatchObject({ runId: 'r1', transcriptExpired: false });
  });
  it('caps large tool results and reports an unreadable transcript apart from an expired one', async () => {
    const { f, cleanup } = await seeded();
    const big = 'x'.repeat(9000);
    cleanup.transcripts = { find: vi.fn(async () => ({ systemPrompt: 'p', input: { text: '{}' }, toolCalls: [
      { name: 'a', args: {}, result: big, ok: true, latencyMs: 1 },
      { name: 'b', args: {}, result: { blob: big }, ok: true, latencyMs: 2 },
      { name: 'c', args: {}, result: { small: 1 }, ok: true, latencyMs: 3 },
    ] })) };
    const { transcript } = await cleanup.journalEntry('alice', 'r1');
    expect(transcript.toolCalls[0].result).toBe('x'.repeat(8192) + '…[truncated 808 chars]');
    expect(transcript.toolCalls[1].result).toEqual({ truncated: true, chars: JSON.stringify({ blob: big }).length, preview: JSON.stringify({ blob: big }).slice(0, 2048) });
    expect(transcript.toolCalls[2].result).toEqual({ small: 1 });
    cleanup.transcripts = { find: vi.fn(async () => { throw new Error('EACCES'); }) };
    expect(await cleanup.journalEntry('alice', 'r1')).toMatchObject({ transcript: null, transcriptError: true, transcriptExpired: false });
    expect(f.logger.warn).toHaveBeenCalledWith('nutrition.cleanup.transcript_read_failed', expect.objectContaining({ runId: 'r1' }));
  });
  it('totals spend by household day, trigger and model, zero days included', async () => {
    const { cleanup } = await seeded();
    const spend = await cleanup.spend('alice', { days: 30 });
    expect(spend.days).toHaveLength(30);
    expect(spend.days[0]).toEqual({ date: '2026-08-06', costUsd: 0, runs: 0, changed: 0 });
    const byDate = Object.fromEntries(spend.days.map(day => [day.date, day]));
    expect(byDate['2026-09-04']).toEqual({ date: '2026-09-04', costUsd: 0.01, runs: 2, changed: 1 });
    expect(byDate['2026-09-03']).toEqual({ date: '2026-09-03', costUsd: 0.05, runs: 1, changed: 0 });
    expect(byDate['2026-08-31']).toEqual({ date: '2026-08-31', costUsd: 0.02, runs: 1, changed: 1 });
    expect(byDate['2026-08-20'].costUsd).toBe(0.1);
    expect(spend.days.at(-1).date).toBe('2026-09-04');
    expect(spend).toMatchObject({ today: 0.01, week: 0.08, month: 0.06, capUsd: 1, cappedToday: false, ledgerTodayUsd: 0.03 });
    expect(spend.byTrigger).toEqual([
      { trigger: 'captures', runs: 4, costUsd: 0.11, avgUsd: 0.055 },
      { trigger: 'edits', runs: 1, costUsd: 0.05, avgUsd: 0.05 },
      { trigger: 'unclassified', runs: 1, costUsd: 0.02, avgUsd: 0.02 },
      { trigger: 'dailySweep', runs: 1, costUsd: 0.02, avgUsd: 0.02 },
    ]);
    // Rows written live before usage was normalized (inputTokens/…) and backfilled rows ({ input, cached, output }) total together.
    expect(spend.byModel).toEqual([
      { model: 'gpt-4o', runs: 3, avgUsd: 0.075, tokens: { input: 5100, cached: 0, output: 310 } },
      { model: 'gpt-4.1-mini', runs: 3, avgUsd: 0.015, tokens: { input: 1000, cached: 512, output: 50 } },
    ]);
    expect(byDate['2026-08-21']).toEqual({ date: '2026-08-21', costUsd: 0, runs: 1, changed: 0 });
    const oneDay = await cleanup.spend('alice', { days: 1 });
    expect(oneDay.days).toEqual([{ date: '2026-09-04', costUsd: 0.01, runs: 2, changed: 1 }]);
    // near a month start the week reaches back past both the day range and the month
    expect(oneDay).toMatchObject({ today: 0.01, week: 0.08, month: 0.06 });
  });
});
