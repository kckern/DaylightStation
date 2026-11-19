import { describe, it, expect, vi } from 'vitest';
import { createRunTriagePass } from './RunTriagePass.mjs';
import { createYamlTriageStore } from '../adapters/YamlTriageStore.mjs';
import { MAILBOX_SCOPE_MISSING } from '../ports/IMailbox.mjs';
import { refId } from '../domain/triageItem.mjs';

const NOW = Date.parse('2026-11-19T05:00:00Z');
const DAY = 86400000;

const msg = (id, o = {}) => ({
  ref: { provider: 'mail-a', accountId: 'kc', kind: 'message', id },
  threadId: `t-${id}`, version: 'v1',
  from: { name: 'Shop', address: 'news@shop.example' }, to: ['kc@home.example'],
  subject: `Weekly newsletter ${id}`, snippet: 'Our latest picks for you', receivedAt: NOW - DAY,
  labels: ['INBOX'], starred: false, hasAttachments: false, automated: true, ownerRepliedInThread: false,
  ...o,
});
const task = (id, o = {}) => ({
  ref: { provider: 'tasks-a', accountId: 'acc', kind: 'task', id },
  title: `Sort shelf ${id}`, description: null, status: { category: 'open', native: null },
  containerRef: { provider: 'tasks-a', accountId: 'acc', kind: 'container', id: 'c1' },
  ancestorRefs: [], assigneeIds: [], due: null, createdAt: NOW - 10 * DAY, modifiedAt: NOW - 2 * DAY,
  completedAt: null, observedAt: NOW, url: null, version: 'w1', ...o,
});
// Long overdue and untouched -> auto-close eligible at overdueDays 60.
const staleTask = (id) => task(id, {
  due: { date: '2026-01-02', at: null, recurring: false, occurrenceId: null }, modifiedAt: Date.parse('2026-01-02T00:00:00Z'),
});
const ALL_OPS = ['complete', 'update_task', 'create_task', 'reopen'];

function setup({ mode = 'live', messages = [], todos = [], answers = {}, caps, workDisabled = false, evaluate } = {}) {
  const files = new Map();
  const dataService = { user: {
    readStrict: vi.fn(async (p, u) => structuredClone(files.get(`${u}/${p}`) ?? null)),
    writeAtomic: vi.fn(async (p, d, u) => { files.set(`${u}/${p}`, structuredClone(d)); return true; }),
  } };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = createYamlTriageStore({ dataService, clock: () => NOW, logger });
  const state = { messages, todos, outside: {}, coverageComplete: true, caps: caps ?? { read: true, modify: true, compose: true, send: true } };
  const mailbox = {
    capabilities: vi.fn(() => ({ ...state.caps })),
    listInbox: vi.fn(async () => structuredClone(state.messages)),
    archive: vi.fn(async (u, id) => ({ version: `${id}-archived` })),
    senderHistory: vi.fn(async () => ({ sentToCount: 0 })),
    createDraft: vi.fn(async () => ({ draftId: 'd1' })),
    updateDraft: vi.fn(async (u, draftId) => ({ draftId })),
    getMessage: vi.fn(async (u, id) => structuredClone(state.messages.find((m) => m.ref.id === id) ?? state.outside[id] ?? null)),
  };
  const evaluateFn = evaluate ?? vi.fn(async (s, questions) => {
    if (questions.disposition) {
      const a = answers[s.subject] ?? { choice: 'keep', confidence: 0.5 };
      return { answers: {
        disposition: { type: 'choice', choice: a.choice, confidence: a.confidence, probabilities: { [a.choice]: a.confidence } },
        urgent: { type: 'yesNo', probability: a.urgent ?? 0 },
      } };
    }
    const a = answers[s.title] ?? { choice: 'push', confidence: 0.6 };
    return { answers: { next: { type: 'choice', choice: a.choice, confidence: a.confidence } } };
  });
  const decisionGateway = { evaluate: evaluateFn };
  const work = workDisabled ? { context: null, principal: null, commands: null, decisions: null } : {
    context: { actionableItems: vi.fn(async () => ({
      items: structuredClone(state.todos).map((item) => ({ item, domainId: 'home', operations: ALL_OPS })),
      coverage: { complete: state.coverageComplete, reason: null },
    })) },
    principal: { system: vi.fn(({ username, job }) => ({ platform: 'system', kind: 'job', job, username, authored: false })) },
    commands: {
      propose: vi.fn(async ({ intent }) => ({ command: { id: `cmd-${intent.ref.id}`, expectedVersion: 'w1' }, requiresConfirmation: true })),
      execute: vi.fn(async () => ({ outcome: 'applied', item: { version: 'w2' } })),
    },
    decisions: { confirmSystem: vi.fn(async () => ({ confirmationId: 'conf' })) },
  };
  const aiGateway = { chatStructured: vi.fn(async () => ({ body: 'Thanks, will do.' })) };
  const policy = { enrolled: true, mode, inboxWindowDays: 14, inboxMax: 200, autoArchiveConfidence: 0.92, overdueDays: 60, schedule: '0 5 * * *' };
  const pass = createRunTriagePass({
    mailbox, work, store, decisionGateway, aiGateway,
    resolvePolicy: (u) => (u === 'kc' ? policy : { enrolled: false, mode: 'off' }),
    ownerName: () => 'K C', clock: () => NOW, logger,
  });
  const queue = async () => (await store.readQueue('kc')).cards;
  const log = () => store.readLog('kc', { sinceMs: 0 });
  return { pass, mailbox, work, store, aiGateway, decisionGateway, evaluate: evaluateFn, logger, state, queue, log, files };
}

const ARCHIVE = { choice: 'archive', confidence: 0.95 };

describe('RunTriagePass', () => {
  it('live: archives a confident unblocked email once and logs a system entry', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.archive).toHaveBeenCalledTimes(1);
    expect(s.mailbox.archive).toHaveBeenCalledWith('kc', 'm1');
    expect(r.preDone).toEqual({ archived: 1, closed: 0 });
    expect(r.mailbox).toBe('ok');
    const [e] = await s.log();
    expect(e).toMatchObject({ actor: 'system', action: 'archive', dryRun: false, undoneAt: null,
      inverse: { action: 'unarchive', ref: { id: 'm1' } } });
    expect(await s.queue()).toEqual([]);
  });

  it('dryRun: never archives, logs dryRun:true and queues a "Would have archived" card', async () => {
    const s = setup({ mode: 'dryRun', messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.archive).not.toHaveBeenCalled();
    expect(r.preDone).toEqual({ archived: 0, closed: 0 });
    const [e] = await s.log();
    expect(e).toMatchObject({ actor: 'system', action: 'archive', dryRun: true, inverse: null });
    const cards = await s.queue();
    expect(cards).toHaveLength(1);
    expect(cards[0].why.startsWith('Would have archived: ')).toBe(true);
    expect(cards[0]).toMatchObject({ status: 'open', itemVersion: 'v1', kind: 'email', preDo: null });
  });

  it('dryRun: a todo auto-close is never attempted and reads "Would have closed"', async () => {
    const s = setup({ mode: 'dryRun', todos: [staleTask('t1')] });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.work.commands.propose).not.toHaveBeenCalled();
    expect((await s.log())[0]).toMatchObject({ action: 'complete', dryRun: true });
    expect((await s.queue())[0].why.startsWith('Would have closed: ')).toBe(true);
  });

  it('MAILBOX_SCOPE_MISSING on the first archive: no further archive attempts, items carded, reconnect_needed', async () => {
    const s = setup({
      messages: [msg('m1'), msg('m2'), msg('m3')],
      answers: { 'Weekly newsletter m1': ARCHIVE, 'Weekly newsletter m2': ARCHIVE, 'Weekly newsletter m3': ARCHIVE },
    });
    s.mailbox.archive.mockImplementation(async () => { throw Object.assign(new Error('scope'), { code: MAILBOX_SCOPE_MISSING }); });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.archive).toHaveBeenCalledTimes(1);
    expect(r.mailbox).toBe('reconnect_needed');
    expect(r.preDone.archived).toBe(0);
    const cards = await s.queue();
    expect(cards.map((c) => c.itemId).sort()).toEqual(['m1', 'm2', 'm3'].map((id) => refId(msg(id).ref)).sort());
    expect(await s.log()).toEqual([]);
  });

  it('two concurrent runs: one is skipped already_running and archive happens once', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const [a, b] = await Promise.all([
      s.pass.run({ username: 'kc', trigger: 'schedule' }),
      s.pass.run({ username: 'kc', trigger: 'manual' }),
    ]);
    expect([a.skipped, b.skipped].filter(Boolean)).toEqual(['already_running']);
    expect(s.mailbox.archive).toHaveBeenCalledTimes(1);
    // The lock is released afterwards.
    expect((await s.pass.run({ username: 'kc', trigger: 'manual' })).skipped).toBeUndefined();
  });

  it('a second pass over an unchanged inbox creates no new cards, drafts, decisions or log entries', async () => {
    const s = setup({
      mode: 'dryRun',
      messages: [msg('m1'), msg('m2', { automated: false, from: { name: 'Ann', address: 'ann@friends.example' } }), msg('m3')],
      todos: [task('t1'), staleTask('t2')],
      answers: { 'Weekly newsletter m1': ARCHIVE, 'Weekly newsletter m2': { choice: 'reply', confidence: 0.9 } },
    });
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    const first = await s.queue();
    const logged = (await s.log()).length;
    const evals = s.evaluate.mock.calls.length;
    // Dry run: the draft body stays on the card; no mailbox draft is created.
    expect(s.mailbox.createDraft).not.toHaveBeenCalled();
    const reply = first.find((c) => c.step === 'reply');
    expect(reply.draftBody).toBe('Thanks, will do.\n\nK C');
    expect(reply.draftId).toBeUndefined();
    expect(first).toHaveLength(5);
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(await s.queue()).toEqual(first);
    expect((await s.log()).length).toBe(logged);
    expect(s.evaluate.mock.calls.length).toBe(evals);
    expect(s.mailbox.createDraft).not.toHaveBeenCalled();
    expect(s.aiGateway.chatStructured).toHaveBeenCalledTimes(1);
  });

  it('a decision gateway that always throws: nothing pre-done, every item a "decision unavailable" card', async () => {
    const evaluate = vi.fn(async () => { throw new Error('timeout'); });
    const s = setup({ messages: [msg('m1'), msg('m2')], todos: [task('t1')], evaluate });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(r.preDone).toEqual({ archived: 0, closed: 0 });
    expect(s.mailbox.archive).not.toHaveBeenCalled();
    expect(s.work.commands.propose).not.toHaveBeenCalled();
    const cards = await s.queue();
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.why === 'decision unavailable')).toBe(true);
  });

  it('live todo pre-do: the system principal only ever proposes complete, logged with a reopen inverse', async () => {
    const s = setup({ todos: [staleTask('t1'), task('t2'), task('t3')],
      answers: { 'Sort shelf t2': { choice: 'drop', confidence: 0.99 }, 'Sort shelf t3': { choice: 'do_week', confidence: 0.99 } } });
    const r = await s.pass.run({ username: 'kc', trigger: 'schedule' });
    expect(s.work.principal.system).toHaveBeenCalledWith({ username: 'kc', job: 'triage-overnight' });
    expect(s.work.commands.propose).toHaveBeenCalledTimes(1);
    for (const [arg] of s.work.commands.propose.mock.calls) expect(arg.intent.operation).toBe('complete');
    expect(s.work.decisions.confirmSystem).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'cmd-t1', expectedVersion: 'w1' }));
    expect(r.preDone.closed).toBe(1);
    const [e] = await s.log();
    expect(e).toMatchObject({ actor: 'system', kind: 'todo', action: 'complete', dryRun: false,
      inverse: { action: 'reopen', ref: { id: 't1' }, payload: { domainId: 'home' }, expectedVersion: 'w2' } });
    // A Jev "drop" at high confidence is still only a card: only guardrail auto-close is pre-done.
    expect((await s.queue()).map((c) => c.itemId).sort()).toEqual([refId(task('t2').ref), refId(task('t3').ref)].sort());
  });

  it('a denied, failed or throwing complete leaves the item as a card, never retried in the pass', async () => {
    for (const fail of [
      (w) => w.commands.propose.mockResolvedValue({ outcome: 'denied', reason: 'system_operation_not_allowed' }),
      (w) => w.commands.execute.mockResolvedValue({ outcome: 'conflict', reason: 'changed' }),
      (w) => w.commands.propose.mockRejectedValue(Object.assign(new Error('x'), { code: 'WORK_SELECTION_CHANGED' })),
    ]) {
      const s = setup({ todos: [staleTask('t1')] });
      fail(s.work);
      const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
      expect(r.preDone.closed).toBe(0);
      expect(s.work.commands.propose).toHaveBeenCalledTimes(1);
      const cards = await s.queue();
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ preDo: null, suggested: 'drop' });
      expect(await s.log()).toEqual([]);
    }
  });

  it('a blocked email (known person) is never archived even at full confidence', async () => {
    const s = setup({ messages: [msg('m1', { automated: false, from: { name: 'Ann', address: 'ann@friends.example' } })],
      answers: { 'Weekly newsletter m1': { choice: 'archive', confidence: 1 } } });
    s.mailbox.senderHistory.mockResolvedValue({ sentToCount: 3 });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.archive).not.toHaveBeenCalled();
    expect((await s.queue())[0].why).toMatch(/^Not auto-archived/);
  });

  it('looks up each distinct non-automated sender once per pass, and fails closed when the lookup throws', async () => {
    const ann = { automated: false, from: { name: 'Ann', address: 'ann@friends.example' } };
    const s = setup({ messages: [msg('m1', ann), msg('m2', ann), msg('m3')],
      answers: { 'Weekly newsletter m1': { choice: 'archive', confidence: 1 } } });
    s.mailbox.senderHistory.mockRejectedValue(new Error('down'));
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.senderHistory).toHaveBeenCalledTimes(1);
    expect(s.mailbox.archive).not.toHaveBeenCalled();
  });

  it('drops cards whose item vanished, replaces cards whose item changed, keeps unchanged ones', async () => {
    const s = setup({ mode: 'dryRun', messages: [msg('m1'), msg('m2'), msg('m3')] });
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    const before = await s.queue();
    s.state.messages = [msg('m1'), msg('m2', { version: 'v2' })];
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    const after = await s.queue();
    expect(after).toHaveLength(2);
    expect(after.find((c) => c.itemId === refId(msg('m1').ref))).toEqual(before.find((c) => c.itemId === refId(msg('m1').ref)));
    expect(after.find((c) => c.itemId === refId(msg('m2').ref)).itemVersion).toBe('v2');
  });

  it('keeps a card whose message is outside the listing but still in the inbox; drops one that left it', async () => {
    const s = setup({ mode: 'dryRun', messages: [msg('m1'), msg('m2'), msg('m3')] });
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    s.state.outside = { m1: msg('m1'), m2: msg('m2', { labels: ['CATEGORY_UPDATES'] }) };
    s.state.messages = [];
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect((await s.queue()).map((c) => c.itemId)).toEqual([refId(msg('m1').ref)]);
  });

  it('live: one mailbox draft per reply item; a re-carded item updates its draft instead of making another', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': { choice: 'reply', confidence: 0.9 } } });
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    expect(s.mailbox.createDraft).toHaveBeenCalledTimes(1);
    expect(s.mailbox.createDraft).toHaveBeenCalledWith('kc', expect.objectContaining({ threadId: 't-m1', to: 'news@shop.example', subject: 'Re: Weekly newsletter m1' }));
    expect((await s.queue())[0]).toMatchObject({ draftId: 'd1', draftBody: 'Thanks, will do.\n\nK C' });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.createDraft).toHaveBeenCalledTimes(1);
    s.state.messages = [msg('m1', { version: 'v2' })];
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.createDraft).toHaveBeenCalledTimes(1);
    expect(s.mailbox.updateDraft).toHaveBeenCalledWith('kc', 'd1', { body: 'Thanks, will do.\n\nK C' });
    const cards = await s.queue();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ itemVersion: 'v2', draftId: 'd1' });
    expect(cards[0].redraft).toBeUndefined();
  });

  it('a reply card left without a draft gets one on a later live pass', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': { choice: 'reply', confidence: 0.9 } } });
    s.mailbox.createDraft.mockRejectedValueOnce(new Error('flaky'));
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    expect((await s.queue())[0].draftId).toBeUndefined();
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.createDraft).toHaveBeenCalledTimes(2);
    expect((await s.queue())[0].draftId).toBe('d1');
  });

  it('incomplete work coverage: a would-be close becomes a card and nothing is proposed', async () => {
    const s = setup({ todos: [staleTask('t1')] });
    s.state.coverageComplete = false;
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.work.commands.propose).not.toHaveBeenCalled();
    expect(r.preDone.closed).toBe(0);
    expect((await s.queue())[0].why).toMatch(/^Not closed automatically \(work data may be out of date\)/);
  });

  it('an exact duplicate closes only the newer copy while the twin is open in the same read', async () => {
    const older = task('t1', { title: 'Call plumber', createdAt: NOW - 20 * DAY });
    const newer = task('t2', { title: 'Call plumber', createdAt: NOW - 5 * DAY });
    const s = setup({ todos: [older, newer] });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.work.commands.propose).toHaveBeenCalledTimes(1);
    expect(s.work.commands.propose.mock.calls[0][0].intent.ref.id).toBe('t2');
  });

  it('an uncertain close (or applied without an item) is logged with a reopen inverse and keeps the card', async () => {
    for (const result of [{ outcome: 'uncertain', reason: 'reconciliation_required' }, { outcome: 'applied', item: null }]) {
      const s = setup({ todos: [staleTask('t1')] });
      s.work.commands.execute.mockResolvedValue(result);
      const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
      expect(r.preDone.closed).toBe(0);
      const [e] = await s.log();
      expect(e).toMatchObject({ action: 'complete', uncertain: true, dryRun: false,
        inverse: { action: 'reopen', payload: { domainId: 'home' }, expectedVersion: null } });
      const cards = await s.queue();
      expect(cards).toHaveLength(1);
      expect(cards[0].why).toMatch(/^May have been closed: /);
    }
  });

  it('dry run: a failed queue write leaves no log entry that would hide the item next time', async () => {
    const s = setup({ mode: 'dryRun', messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const real = s.store.writeQueue;
    s.store.writeQueue = vi.fn(async () => { throw new Error('disk full'); });
    await expect(s.pass.run({ username: 'kc', trigger: 'schedule' })).rejects.toThrow('disk full');
    expect(await s.log()).toEqual([]);
    s.store.writeQueue = real;
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect((await s.queue())[0].why).toMatch(/^Would have archived: /);
  });

  it('a failed inbox read keeps earlier email cards and still runs todos', async () => {
    const s = setup({ mode: 'dryRun', messages: [msg('m1')], todos: [task('t1')] });
    await s.pass.run({ username: 'kc', trigger: 'schedule' });
    s.mailbox.listInbox.mockRejectedValue(new Error('network'));
    s.state.todos = [task('t1'), task('t9')];
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect((await s.queue()).map((c) => c.kind).sort()).toEqual(['email', 'todo', 'todo']);
  });

  it('work disabled: todos are skipped and logged, email still runs', async () => {
    const s = setup({ workDisabled: true, messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(r.preDone.archived).toBe(1);
    expect(s.logger.info).toHaveBeenCalledWith('triage.pass.todos_skipped', expect.objectContaining({ reason: 'work_unavailable' }));
  });

  it('a draft failure leaves the reply card without a draft and does not fail the pass', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': { choice: 'reply', confidence: 0.9, urgent: 0.9 } } });
    s.aiGateway.chatStructured.mockRejectedValue(new Error('model down'));
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    const [card] = await s.queue();
    expect(card).toMatchObject({ step: 'reply', urgent: true });
    expect(card.draftId).toBeUndefined();
    expect(r.queued).toEqual({ unsure: 0, reply: 1, todo: 0, urgent: 1 });
  });

  it('no compose capability: no draft is attempted', async () => {
    const s = setup({ caps: { read: true, modify: true, compose: false, send: false },
      messages: [msg('m1')], answers: { 'Weekly newsletter m1': { choice: 'reply', confidence: 0.9 } } });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.aiGateway.chatStructured).not.toHaveBeenCalled();
    expect(s.mailbox.createDraft).not.toHaveBeenCalled();
  });

  it('live without the modify capability: no archive, card, reconnect_needed', async () => {
    const s = setup({ caps: { read: true, modify: false, compose: true, send: true },
      messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.mailbox.archive).not.toHaveBeenCalled();
    expect(r.mailbox).toBe('reconnect_needed');
    expect(await s.queue()).toHaveLength(1);
  });

  it('a user who is not enrolled is skipped without reading anything', async () => {
    const s = setup({ messages: [msg('m1')] });
    expect(await s.pass.run({ username: 'other', trigger: 'manual' })).toEqual({ skipped: 'not_enrolled' });
    expect(s.mailbox.listInbox).not.toHaveBeenCalled();
  });

  it('a log write failure after an archive does not abort the pass; the entry goes to the structured log', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    s.store.appendLog = vi.fn(async () => { throw new Error('disk'); });
    const r = await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(r.preDone.archived).toBe(1);
    expect(s.logger.error).toHaveBeenCalledWith('triage.pass.log_failed', expect.objectContaining({
      entry: expect.objectContaining({ action: 'archive', inverse: expect.objectContaining({ action: 'unarchive' }) }) }));
  });

  it('logs started and completed with counts', async () => {
    const s = setup({ messages: [msg('m1')], answers: { 'Weekly newsletter m1': ARCHIVE } });
    await s.pass.run({ username: 'kc', trigger: 'manual' });
    expect(s.logger.info).toHaveBeenCalledWith('triage.pass.started', expect.objectContaining({ username: 'kc', trigger: 'manual' }));
    expect(s.logger.info).toHaveBeenCalledWith('triage.pass.completed', expect.objectContaining({ archived: 1 }));
  });
});
