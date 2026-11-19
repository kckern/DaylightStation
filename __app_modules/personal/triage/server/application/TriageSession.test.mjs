import { describe, it, expect, vi } from 'vitest';
import { createTriageSession, dueDateFor } from './TriageSession.mjs';
import { createUserLock } from './userLock.mjs';
import { MAILBOX_SCOPE_MISSING, MAILBOX_NOT_FOUND } from '../ports/IMailbox.mjs';

const NOW = Date.parse('2026-11-19T17:00:00Z'); // Thursday
const TZ = 'America/Los_Angeles';
const AUTH = { session: { username: 'sample', sid: 's1' }, requestId: 'req-1' };
const EMAIL_CHOICES = [
  { key: 'archive', label: 'Archive' }, { key: 'reply', label: 'Reply (draft)' },
  { key: 'task', label: 'Make a todo' }, { key: 'keep', label: 'Keep in inbox' },
];
const TODO_CHOICES = [
  { key: 'do_week', label: 'Do it this week' }, { key: 'push', label: 'Push to next month' },
  { key: 'drop', label: 'Drop it' }, { key: 'shrink', label: 'Turn into a smaller next step…' },
];
const mailRef = (id) => ({ provider: 'mx', accountId: 'sample', kind: 'message', id });
const taskRef = (id) => ({ provider: 'wx', accountId: 'acct', kind: 'task', id });

const emailCard = (id, extra = {}) => ({
  cardId: `card.${id}`, passId: 'pass.1', createdAt: NOW - 3600000, itemId: `item.${id}`, kind: 'email', ref: mailRef(id),
  itemVersion: 'v1', step: 'unsure', urgent: false, choices: EMAIL_CHOICES, suggested: 'archive', confidence: 0.5,
  why: 'Unsure', preDo: null, status: 'open',
  display: { title: `Subject ${id}`, from: { name: 'Pat', address: 'pat@example.com' }, snippet: 'hello', at: NOW, threadId: `t${id}`, url: `https://mail.example/${id}`, source: 'Mail' },
  ...extra,
});
const todoCard = (id, extra = {}) => ({
  cardId: `card.${id}`, passId: 'pass.1', createdAt: NOW - 3600000, itemId: `item.${id}`, kind: 'todo', ref: taskRef(id),
  itemVersion: 'w1', step: 'todo', urgent: false, choices: TODO_CHOICES, suggested: 'push', confidence: 0.6,
  why: 'Overdue 3 days', preDo: null, status: 'open', domainId: 'home',
  display: { title: `Task ${id}`, snippet: '', due: { date: '2026-11-10', at: null, recurring: false, occurrenceId: null }, at: NOW, url: null, source: 'Home list' },
  ...extra,
});

function memoryStore(queue = { passId: 'pass.1', builtAt: NOW - 7200000, cards: [] }, log = []) {
  let q = structuredClone(queue);
  const entries = structuredClone(log);
  let state = null;
  return {
    get queue() { return q; },
    entries,
    readQueue: vi.fn(async () => structuredClone(q)),
    writeQueue: vi.fn(async (_u, next) => { q = structuredClone(next); }),
    appendLog: vi.fn(async (_u, e) => { entries.push(structuredClone(e)); return e; }),
    readLog: vi.fn(async (_u, { sinceMs = 0 } = {}) => entries.filter((e) => e.at >= sinceMs)),
    getEntry: vi.fn(async (_u, id) => entries.find((e) => e.id === id) ?? null),
    markUndone: vi.fn(async () => ({})),
    readState: vi.fn(async () => state),
    writeState: vi.fn(async (_u, s) => { state = structuredClone(s); }),
  };
}

function fakeMailbox(messages = {}) {
  return {
    getMessage: vi.fn(async (_u, id) => (id in messages ? messages[id] : null)),
    archive: vi.fn(async () => ({ version: 'v2' })),
    createDraft: vi.fn(async () => ({ draftId: 'dNew' })),
    updateDraft: vi.fn(async (_u, id) => ({ draftId: id })),
    sendDraft: vi.fn(async () => ({ messageId: 'm-sent' })),
  };
}

function fakeWork({ items = {}, containers = [], execute = null } = {}) {
  let n = 0;
  return {
    principal: { web: vi.fn(() => ({ platform: 'web', username: 'sample' })) },
    context: {
      getItem: vi.fn(async ({ ref }) => items[ref.id] ?? null),
      execute: vi.fn(async () => ({ items: [], containers, coverage: { complete: true } })),
    },
    commands: {
      propose: vi.fn(async ({ intent }) => ({ command: { id: `cmd${++n}`, expectedVersion: intent.expectedVersion ?? 'c1' } })),
      execute: vi.fn(execute ?? (async () => ({ outcome: 'applied', item: { version: 'w2' } }))),
    },
    decisions: { confirmWeb: vi.fn(async () => ({ confirmationId: 'conf1' })) },
  };
}

const policy = { enrolled: true, mode: 'live', taskDomain: 'personal' };
const make = (over = {}) => {
  let id = 0;
  return createTriageSession({
    store: memoryStore(), mailbox: fakeMailbox(), work: fakeWork(), aiGateway: null,
    resolvePolicy: () => policy, userTimezone: () => TZ, clock: () => NOW,
    nextId: () => `id${++id}`, logger: null, ...over,
  });
};
const workItem = (id, version = 'w1', extra = {}) => ({
  ref: taskRef(id), version, title: `Task ${id}`, status: { category: 'open', native: null },
  containerRef: { provider: 'wx', accountId: 'acct', kind: 'container', id: 'list-1' },
  due: { date: '2026-11-10', at: null, recurring: false, occurrenceId: null }, ...extra,
});

describe('session order', () => {
  it('puts urgent reply cards first, then recap, unsure, reply, todo; omits empty steps', async () => {
    const cards = [
      todoCard('t1', { createdAt: NOW - 9000 }),
      emailCard('u1', { createdAt: NOW - 8000 }),
      emailCard('r1', { step: 'reply', createdAt: NOW - 7000 }),
      emailCard('x1', { step: 'reply', urgent: true, createdAt: NOW - 2000 }),
      emailCard('x2', { step: 'reply', urgent: true, createdAt: NOW - 1000 }),
      emailCard('gone', { status: 'answered', answeredAt: NOW - 100 }),
    ];
    const log = [{ id: 'log.a', at: NOW - 60000, actor: 'system', action: 'archive', kind: 'email', title: 'Newsletter', dryRun: false, inverse: { action: 'unarchive', ref: mailRef('n') }, undoneAt: null }];
    const store = memoryStore({ passId: 'pass.1', builtAt: NOW - 7200000, cards }, log);
    const s = make({ store });
    const out = await s.session({ username: 'sample' });
    expect(out.cards.map((c) => c.cardId)).toEqual(['card.x1', 'card.x2', 'recap', 'card.u1', 'card.r1', 'card.t1']);
    expect(out.steps).toEqual([
      { id: 'urgent', count: 2 }, { id: 'recap', count: 1 }, { id: 'unsure', count: 1 }, { id: 'reply', count: 1 }, { id: 'todo', count: 1 },
    ]);
    expect(out.done).toBe(1);
    expect(out.total).toBe(7);
    const recap = out.cards[2];
    expect(recap.entries).toEqual([expect.objectContaining({ entryId: 'log.a', action: 'archive', title: 'Newsletter', undoable: true })]);
    // A reply card offers send in place of reply.
    expect(out.cards[0].choices.map((c) => c.key)).toEqual(['send', 'archive', 'task', 'keep']);
  });

  it('leaves out a step with no cards (no recap without system actions, no todo)', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('u1')] });
    const out = await make({ store }).session({ username: 'sample' });
    expect(out.steps).toEqual([{ id: 'unsure', count: 1 }]);
  });

  it('orders a skipped card after the others in its step', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('a', { createdAt: 1 }), emailCard('b', { createdAt: 2 })] });
    const s = make({ store });
    await s.skip({ username: 'sample', cardId: 'card.a' });
    const out = await s.session({ username: 'sample' });
    expect(out.cards.map((c) => c.cardId)).toEqual(['card.b', 'card.a']);
    expect(store.queue.cards.find((c) => c.cardId === 'card.a').status).toBe('open');
  });

  it('acknowledging the recap hides it until new system actions', async () => {
    const log = [{ id: 'log.a', at: NOW - 60000, actor: 'system', action: 'archive', kind: 'email', title: 'N', dryRun: false, inverse: null, undoneAt: null }];
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [] }, log);
    const s = make({ store });
    expect((await s.session({ username: 'sample' })).steps).toEqual([{ id: 'recap', count: 1 }]);
    expect((await s.answer({ username: 'sample', cardId: 'recap', choice: 'ok', auth: AUTH })).outcome).toBe('applied');
    expect((await s.session({ username: 'sample' })).steps).toEqual([]);
  });
});

describe('answer: version check (Review Focus 2)', () => {
  it('archive on a message that is gone -> conflict, archive not called, card dropped', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({});
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH });
    expect(out.outcome).toBe('conflict');
    expect(mailbox.archive).not.toHaveBeenCalled();
    expect(store.queue.cards[0].status).toBe('conflict');
    expect(store.entries).toEqual([]);
  });

  it('a todo whose version changed -> conflict and no propose', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1', 'w9') } });
    const out = await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH });
    expect(out.outcome).toBe('conflict');
    expect(work.commands.propose).not.toHaveBeenCalled();
    expect(store.queue.cards[0].status).toBe('conflict');
  });

  it('a todo closed elsewhere -> conflict', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1', 'w1', { status: { category: 'done', native: null } }) } });
    expect((await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH })).outcome).toBe('conflict');
    expect(work.commands.propose).not.toHaveBeenCalled();
  });

  it('a work execute conflict -> conflict', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1') }, execute: async () => ({ outcome: 'conflict' }) });
    expect((await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH })).outcome).toBe('conflict');
    expect(store.queue.cards[0].status).toBe('conflict');
  });
});

describe('answer: email', () => {
  it('archive -> archive, owner log entry with unarchive inverse, card answered', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1', labels: ['INBOX'] } });
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH });
    expect(out.outcome).toBe('applied');
    expect(mailbox.archive).toHaveBeenCalledWith('sample', 'm1');
    expect(store.entries).toEqual([expect.objectContaining({
      actor: 'owner', action: 'archive', itemId: 'item.m1', itemVersion: 'v2', priorVersion: 'v1',
      inverse: { action: 'unarchive', ref: mailRef('m1') }, dryRun: false, undoneAt: null, title: 'Subject m1',
    })]);
    expect(store.queue.cards[0]).toMatchObject({ status: 'answered', answer: { choice: 'archive' } });
  });

  it('a mailbox permission rejection -> failed mailbox_permission_missing, card stays open', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    mailbox.archive.mockRejectedValueOnce(Object.assign(new Error('x'), { code: MAILBOX_SCOPE_MISSING }));
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', reason: 'mailbox_permission_missing' });
    expect(store.queue.cards[0].status).toBe('open');
    expect(store.entries).toEqual([]);
  });

  it('task -> create_task in the policy task domain, then confirmWeb and execute; inverse null', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const work = fakeWork({ containers: [{ ref: { provider: 'wx', accountId: 'acct', kind: 'container', id: 'inbox-list' }, title: 'Personal' }] });
    const out = await make({ store, mailbox, work }).answer({ username: 'sample', cardId: 'card.m1', choice: 'task', auth: AUTH });
    expect(out.outcome).toBe('applied');
    expect(work.context.execute).toHaveBeenCalledWith(expect.objectContaining({ username: 'sample', domainIds: ['personal'] }));
    const { intent } = work.commands.propose.mock.calls[0][0];
    expect(intent).toMatchObject({ operation: 'create_task', domainId: 'personal', ref: null,
      payload: { title: 'Subject m1', containerId: 'inbox-list' } });
    expect(intent.payload.description).toContain('https://mail.example/m1');
    expect(intent.payload.description).toContain('hello');
    expect(work.principal.web).toHaveBeenCalledWith(AUTH);
    expect(work.decisions.confirmWeb).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'cmd1' }));
    expect(work.commands.execute).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'cmd1', confirmationId: 'conf1' }));
    expect(store.entries[0]).toMatchObject({ actor: 'owner', action: 'create_task', inverse: null });
  });

  it('reply on an unsure card moves it to the reply step with a draft body', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const draftReply = vi.fn(async () => ({ body: 'Thanks!' }));
    const out = await make({ store, mailbox, draftReply }).answer({ username: 'sample', cardId: 'card.m1', choice: 'reply', auth: AUTH });
    expect(out.outcome).toBe('draft_updated');
    expect(store.queue.cards[0]).toMatchObject({ status: 'open', step: 'reply', draftBody: 'Thanks!' });
    expect(out.card.choices[0].key).toBe('send');
  });

  it('send with a body but no draftId creates the draft (edited body) then sends it; inverse null', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftBody: 'old' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'send', draft: { body: 'edited' }, auth: AUTH });
    expect(out.outcome).toBe('applied');
    expect(mailbox.createDraft).toHaveBeenCalledWith('sample', expect.objectContaining({ threadId: 'tm1', to: 'pat@example.com', subject: 'Re: Subject m1', body: 'edited' }));
    expect(mailbox.sendDraft).toHaveBeenCalledWith('sample', 'dNew');
    expect(store.entries[0]).toMatchObject({ action: 'send', inverse: null });
  });

  it('send with a draftId and an edit updates first; a deleted draft is recreated', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'old' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    mailbox.updateDraft.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: MAILBOX_NOT_FOUND }));
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'send', draft: { body: 'new' }, auth: AUTH });
    expect(out.outcome).toBe('applied');
    expect(mailbox.updateDraft).toHaveBeenCalledWith('sample', 'd1', { body: 'new' });
    expect(mailbox.createDraft).toHaveBeenCalledWith('sample', expect.objectContaining({ body: 'new' }));
    expect(mailbox.sendDraft).toHaveBeenCalledWith('sample', 'dNew');
  });

  it('send with an existing draft and no edit sends it as is', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'old' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH });
    expect(mailbox.updateDraft).not.toHaveBeenCalled();
    expect(mailbox.sendDraft).toHaveBeenCalledWith('sample', 'd1');
  });

  it('a draft edit alone updates the draft and leaves the card open', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'old' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', draft: { body: 'better' }, auth: AUTH });
    expect(out.outcome).toBe('draft_updated');
    expect(mailbox.updateDraft).toHaveBeenCalledWith('sample', 'd1', { body: 'better' });
    expect(mailbox.sendDraft).not.toHaveBeenCalled();
    expect(store.queue.cards[0]).toMatchObject({ status: 'open', draftBody: 'better' });
  });

  it('keep logs an owner entry with no inverse so the pass does not re-card it', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    expect((await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'keep', auth: AUTH })).outcome).toBe('applied');
    expect(store.entries[0]).toMatchObject({ actor: 'owner', action: 'keep', inverse: null, itemVersion: 'v1' });
  });

  it('executes in dry-run mode too (dry run governs only unattended pre-dos)', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    await make({ store, mailbox, resolvePolicy: () => ({ ...policy, mode: 'dryRun' }) })
      .answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH });
    expect(mailbox.archive).toHaveBeenCalled();
  });
});

describe('answer: todo', () => {
  const run = async (choice, extra = {}) => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1') } });
    const out = await make({ store, work, ...extra }).answer({ username: 'sample', cardId: 'card.t1', choice, auth: AUTH, ...(extra.body ?? {}) });
    return { out, store, work };
  };

  it('drop -> complete with a reopen inverse at the post-action version', async () => {
    const { out, store, work } = await run('drop');
    expect(out.outcome).toBe('applied');
    expect(work.commands.propose.mock.calls[0][0].intent).toMatchObject({ operation: 'complete', domainId: 'home', ref: taskRef('t1'), payload: {}, expectedVersion: 'w1' });
    expect(store.entries[0]).toMatchObject({ actor: 'owner', action: 'complete', itemVersion: 'w2',
      inverse: { action: 'reopen', ref: taskRef('t1'), payload: { domainId: 'home' }, expectedVersion: 'w2' } });
  });

  it('push from 2026-11-19 -> dueDate 2026-12-01, inverse restores the prior due date', async () => {
    const { store, work } = await run('push');
    expect(work.commands.propose.mock.calls[0][0].intent).toMatchObject({ operation: 'update_task', payload: { dueDate: '2026-12-01' } });
    expect(store.entries[0].inverse).toEqual({ action: 'update_task', ref: taskRef('t1'), payload: { domainId: 'home', dueDate: '2026-11-10', priorDue: { date: '2026-11-10', at: null, recurring: false } }, expectedVersion: 'w2' });
  });

  it('do_week -> the coming Friday', async () => {
    const { work } = await run('do_week');
    expect(work.commands.propose.mock.calls[0][0].intent.payload).toEqual({ dueDate: '2026-11-20' });
  });

  it('shrink without text asks for text and takes no action', async () => {
    const { out, work, store } = await run('shrink');
    expect(out).toMatchObject({ outcome: 'skipped', needsText: true });
    expect(work.commands.propose).not.toHaveBeenCalled();
    expect(store.queue.cards[0].status).toBe('open');
  });

  it('shrink with text creates a task in the same container; the original stays open', async () => {
    const { out, work, store } = await run('shrink', { body: { text: 'Call the plumber' } });
    expect(out.outcome).toBe('applied');
    expect(work.commands.propose).toHaveBeenCalledTimes(1);
    expect(work.commands.propose.mock.calls[0][0].intent).toMatchObject({ operation: 'create_task', domainId: 'home', ref: null, payload: { title: 'Call the plumber', containerId: 'list-1' } });
    expect(store.entries[0]).toMatchObject({ action: 'create_task', inverse: null });
  });

  it('a denied proposal -> failed with the reason, card stays open', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1') } });
    work.commands.propose.mockResolvedValueOnce({ outcome: 'denied', reason: 'nope' });
    const out = await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', reason: 'nope' });
    expect(store.queue.cards[0].status).toBe('open');
  });

  it('an uncertain execute -> failed, card stays open', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1') }, execute: async () => ({ outcome: 'uncertain', reason: 'timeout' }) });
    const out = await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', reason: 'timeout' });
    expect(store.queue.cards[0].status).toBe('open');
  });

  it('rejects a choice the card does not offer', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1', { choices: [{ key: 'push', label: 'Push' }] })] });
    await expect(make({ store }).answer({ username: 'sample', cardId: 'card.t1', choice: 'drop', auth: AUTH }))
      .rejects.toMatchObject({ code: 'TRIAGE_INVALID_ANSWER' });
  });
});

describe('answer: free text', () => {
  it('unclear -> skipped, card open, no action', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const interpret = vi.fn(async () => ({ unclear: true }));
    const out = await make({ store, mailbox, interpret }).answer({ username: 'sample', cardId: 'card.m1', text: 'hmm banana', auth: AUTH });
    expect(out.outcome).toBe('skipped');
    expect(mailbox.archive).not.toHaveBeenCalled();
    expect(mailbox.getMessage).not.toHaveBeenCalled();
    expect(store.queue.cards[0].status).toBe('open');
  });

  it('an interpreted choice is applied', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const interpret = vi.fn(async () => ({ choice: 'archive' }));
    expect((await make({ store, mailbox, interpret }).answer({ username: 'sample', cardId: 'card.m1', text: 'get rid of it', auth: AUTH })).outcome).toBe('applied');
    expect(mailbox.archive).toHaveBeenCalled();
  });
});

describe('serialization', () => {
  it('two answers to one card run one at a time: the second finds it answered', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const s = make({ store, mailbox });
    const [a, b] = await Promise.allSettled([
      s.answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH }),
      s.answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH }),
    ]);
    expect(a.value.outcome).toBe('applied');
    expect(b.reason.code).toBe('TRIAGE_CARD_NOT_OPEN');
    expect(mailbox.archive).toHaveBeenCalledTimes(1);
  });
});

describe('summary and log', () => {
  it('summarizes the queue', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW - 1000, mailbox: 'reconnect_needed', preDone: { archived: 3, closed: 1 },
      cards: [emailCard('a'), emailCard('b', { step: 'reply', draftBody: 'x' }), emailCard('c', { step: 'reply' }), todoCard('t'), emailCard('d', { status: 'answered' })] });
    expect(await make({ store }).summary({ username: 'sample' })).toEqual({
      enrolled: true, mode: 'live', mailbox: 'reconnect_needed', lastPassAt: NOW - 1000,
      preDone: { archived: 3, closed: 1 }, open: { unsure: 1, reply: 2, todo: 1 }, wouldHave: { archived: 0, closed: 0 }, draftsReady: 1,
    });
  });

  it('lists log entries since N days with undoable flags', async () => {
    const log = [
      { id: 'old', at: NOW - 10 * 86400000, actor: 'system', action: 'archive', inverse: { action: 'unarchive' }, dryRun: false, undoneAt: null },
      { id: 'a', at: NOW - 1000, actor: 'owner', action: 'send', kind: 'email', title: 'Hi', inverse: null, dryRun: false, undoneAt: null },
      { id: 'b', at: NOW - 500, actor: 'system', action: 'archive', kind: 'email', title: 'N', inverse: { action: 'unarchive' }, dryRun: false, undoneAt: null },
    ];
    const out = await make({ store: memoryStore(undefined, log) }).log({ username: 'sample', sinceDays: 7 });
    expect(out.entries.map((e) => [e.id, e.undoable])).toEqual([['b', true], ['a', false]]);
  });

  it('undo passes a web principal to UndoAction', async () => {
    const undoAction = { undo: vi.fn(async () => ({ outcome: 'undone' })) };
    const work = fakeWork();
    const out = await make({ undoAction, work }).undo({ username: 'sample', entryId: 'log.1', auth: AUTH });
    expect(out).toEqual({ outcome: 'undone' });
    expect(undoAction.undo).toHaveBeenCalledWith({ username: 'sample', entryId: 'log.1', principal: { platform: 'web', username: 'sample' } });
  });
});

describe('dueDateFor', () => {
  const at = (iso) => Date.parse(iso);
  it('push -> first day of next month in the user timezone', () => {
    expect(dueDateFor('push', at('2026-11-19T17:00:00Z'), TZ)).toBe('2026-12-01');
    // 2026-12-01 03:00Z is still Nov 30 in Los Angeles.
    expect(dueDateFor('push', at('2026-12-01T03:00:00Z'), TZ)).toBe('2026-12-01');
    expect(dueDateFor('push', at('2026-12-15T12:00:00Z'), TZ)).toBe('2027-01-01');
  });
  it('do_week -> coming Friday, or today Friday to Sunday', () => {
    expect(dueDateFor('do_week', at('2026-11-18T17:00:00Z'), TZ)).toBe('2026-11-20');
    expect(dueDateFor('do_week', at('2026-11-16T17:00:00Z'), TZ)).toBe('2026-11-20');
    expect(dueDateFor('do_week', at('2026-11-20T17:00:00Z'), TZ)).toBe('2026-11-20');
    expect(dueDateFor('do_week', at('2026-11-22T17:00:00Z'), TZ)).toBe('2026-11-22');
  });
});

describe('applying: actions the version check cannot guard (fix round 1)', () => {
  const replyCard = () => emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'hi' });

  it('a queue write failure after send: the retry finds the log entry and does not send again', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [replyCard()] });
    const realWrite = store.writeQueue.getMockImplementation();
    store.writeQueue.mockImplementation(async (u, next) => {
      if (next.cards.some((c) => c.status === 'answered')) throw new Error('disk full');
      return realWrite(u, next);
    });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const s = make({ store, mailbox });
    await expect(s.answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH })).rejects.toThrow('disk full');
    expect(store.queue.cards[0]).toMatchObject({ status: 'applying', answer: { choice: 'send' } });
    expect((await s.session({ username: 'sample' })).cards[0]).toMatchObject({ cardId: 'card.m1', applying: true });

    store.writeQueue.mockImplementation(realWrite);
    const again = await s.answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH });
    expect(again.outcome).toBe('applied');
    expect(mailbox.sendDraft).toHaveBeenCalledTimes(1);
    expect(store.queue.cards[0]).toMatchObject({ status: 'answered', logEntryId: store.entries[0].id });
    expect(store.queue.cards[0]).not.toHaveProperty('applyingAt');
  });

  it('a send that may have gone out stays applying; a retry is answer_in_doubt and never re-sends', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [replyCard()] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    mailbox.sendDraft.mockRejectedValueOnce(new Error('socket hang up'));
    const s = make({ store, mailbox });
    const out = await s.answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', inDoubt: true });
    expect(store.queue.cards[0].status).toBe('applying');
    await expect(s.answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH })).rejects.toMatchObject({ code: 'TRIAGE_ANSWER_IN_DOUBT' });
    expect(mailbox.sendDraft).toHaveBeenCalledTimes(1);
  });

  it('a send that surely did not go out returns the card to open', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [replyCard()] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    mailbox.sendDraft.mockRejectedValueOnce(Object.assign(new Error('x'), { code: MAILBOX_SCOPE_MISSING }));
    const out = await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', reason: 'mailbox_permission_missing' });
    expect(store.queue.cards[0].status).toBe('open');
    expect(store.queue.cards[0]).not.toHaveProperty('applyingAt');
    expect(store.queue.cards[0]).not.toHaveProperty('answer');
  });

  it('an uncertain create_task (shrink) stays applying', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
    const work = fakeWork({ items: { t1: workItem('t1') }, execute: async () => ({ outcome: 'uncertain', reason: 'timeout' }) });
    const out = await make({ store, work }).answer({ username: 'sample', cardId: 'card.t1', choice: 'shrink', text: 'Call', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'failed', inDoubt: true });
    expect(store.queue.cards[0].status).toBe('applying');
  });

  it('the card is marked applying before the send happens', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [replyCard()] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    let statusAtSend = null;
    mailbox.sendDraft.mockImplementation(async () => { statusAtSend = store.queue.cards[0].status; return { messageId: 'x' }; });
    await make({ store, mailbox }).answer({ username: 'sample', cardId: 'card.m1', choice: 'send', auth: AUTH });
    expect(statusAtSend).toBe('applying');
  });
});

describe('interpreted answers (fix round 1)', () => {
  it('an interpreted send is never executed', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'hi' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const out = await make({ store, mailbox, interpret: async () => ({ choice: 'send' }) })
      .answer({ username: 'sample', cardId: 'card.m1', text: 'send it', auth: AUTH });
    expect(out).toMatchObject({ outcome: 'skipped', interpreted: 'send' });
    expect(mailbox.sendDraft).not.toHaveBeenCalled();
    expect(store.queue.cards[0].status).toBe('open');
  });

  it('an interpreted draft edit updates the draft and does not send', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'hi' })] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const out = await make({ store, mailbox, interpret: async () => ({ draftEdit: 'hi, at noon' }) })
      .answer({ username: 'sample', cardId: 'card.m1', text: 'send it but say noon', auth: AUTH });
    expect(out.outcome).toBe('draft_updated');
    expect(mailbox.updateDraft).toHaveBeenCalledWith('sample', 'd1', { body: 'hi, at noon' });
    expect(mailbox.sendDraft).not.toHaveBeenCalled();
  });

  it('an interpreted shrink keeps the owner\'s words (or the extracted title) as the new step', async () => {
    for (const [read, title] of [[{ choice: 'shrink', stepTitle: 'Call the plumber' }, 'Call the plumber'], [{ choice: 'shrink' }, 'just call the plumber']]) {
      const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [todoCard('t1')] });
      const work = fakeWork({ items: { t1: workItem('t1') } });
      const out = await make({ store, work, interpret: async () => read })
        .answer({ username: 'sample', cardId: 'card.t1', text: 'just call the plumber', auth: AUTH });
      expect(out.outcome).toBe('applied');
      expect(work.commands.propose.mock.calls[0][0].intent.payload.title).toBe(title);
    }
  });

  it('an interpreted archive is applied', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    await make({ store, mailbox, interpret: async () => ({ choice: 'archive' }) }).answer({ username: 'sample', cardId: 'card.m1', text: 'bin', auth: AUTH });
    expect(mailbox.archive).toHaveBeenCalledTimes(1);
  });
});

describe('shared lock (fix round 1)', () => {
  it('an answer waiting longer than answerWaitMs for a running pass -> TRIAGE_BUSY holder pass, nothing done', async () => {
    const lock = createUserLock({ after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    const release = await lock.acquire('sample', { kind: 'pass' });
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const s = make({ store, mailbox, lock, answerWaitMs: 20 });
    await expect(s.answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH })).rejects.toMatchObject({ code: 'TRIAGE_BUSY', holder: 'pass' });
    expect(mailbox.getMessage).not.toHaveBeenCalled();
    release();
    // The lock is usable again once the pass is done.
    expect((await s.answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH })).outcome).toBe('applied');
  });

  it('an answer waits for a short pass instead of failing', async () => {
    const lock = createUserLock({ after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    const release = await lock.acquire('sample', { kind: 'pass' });
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const pending = make({ store, mailbox, lock, answerWaitMs: 5000 }).answer({ username: 'sample', cardId: 'card.m1', choice: 'archive', auth: AUTH });
    await new Promise((r) => setTimeout(r, 10));
    expect(mailbox.getMessage).not.toHaveBeenCalled();
    release();
    expect((await pending).outcome).toBe('applied');
  });
});

describe('done counter (fix round 1)', () => {
  it('counts answers since the queue was first built, not reset by a later pass', async () => {
    const cards = [emailCard('a', { status: 'answered', answeredAt: NOW - 5000 }), emailCard('b')];
    const store = memoryStore({ passId: 'p2', builtAt: NOW - 1000, firstBuiltAt: NOW - 9000, cards });
    expect((await make({ store }).session({ username: 'sample' })).done).toBe(1);
  });
  it('counts answers since the recap was acknowledged', async () => {
    const cards = [emailCard('a', { status: 'answered', answeredAt: NOW - 5000 }), emailCard('b', { status: 'answered', answeredAt: NOW - 500 })];
    const store = memoryStore({ passId: 'p2', builtAt: NOW - 100, firstBuiltAt: NOW - 9000, cards });
    await store.writeState('sample', { recapSeenAt: NOW - 1000 });
    expect((await make({ store }).session({ username: 'sample' })).done).toBe(1);
  });
});

describe('resolve: the owner exit for an in-doubt card', () => {
  const applyingCard = (choice = 'send') => emailCard('m1', { step: 'reply', draftId: 'd1', draftBody: 'hi', status: 'applying', applyingAt: NOW - 1000, answer: { choice } });

  it('happened:true logs the answer as the normal path would and marks it answered', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [applyingCard()] });
    const mailbox = fakeMailbox({ m1: { version: 'v1' } });
    const s = make({ store, mailbox });
    const out = await s.resolve({ username: 'sample', cardId: 'card.m1', happened: true });
    expect(out.outcome).toBe('applied');
    expect(store.entries).toEqual([expect.objectContaining({ actor: 'owner', action: 'send', choice: 'send', inverse: null, cardId: 'card.m1' })]);
    expect(store.queue.cards[0]).toMatchObject({ status: 'answered', logEntryId: store.entries[0].id });
    expect(store.queue.cards[0]).not.toHaveProperty('applyingAt');
    expect(mailbox.sendDraft).not.toHaveBeenCalled();
  });
  it('happened:false returns the card to open and clears applyingAt and answer', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [applyingCard()] });
    const s = make({ store, mailbox: fakeMailbox({}) });
    const out = await s.resolve({ username: 'sample', cardId: 'card.m1', happened: false });
    expect(out.outcome).toBe('reopened');
    expect(store.queue.cards[0].status).toBe('open');
    expect(store.queue.cards[0]).not.toHaveProperty('applyingAt');
    expect(store.queue.cards[0]).not.toHaveProperty('answer');
    expect(store.entries).toEqual([]);
  });
  it('refuses a card that is not applying with CARD_NOT_APPLYING', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [emailCard('m1')] });
    const s = make({ store, mailbox: fakeMailbox({}) });
    await expect(s.resolve({ username: 'sample', cardId: 'card.m1', happened: true })).rejects.toMatchObject({ code: 'TRIAGE_CARD_NOT_APPLYING' });
    await expect(s.resolve({ username: 'sample', cardId: 'nope', happened: true })).rejects.toMatchObject({ code: 'TRIAGE_CARD_NOT_FOUND' });
  });
});

describe('summary wouldHave (dry run)', () => {
  it('counts open cards the pass worded as would-have-done', async () => {
    const store = memoryStore({ passId: 'p', builtAt: NOW, cards: [
      emailCard('a', { why: 'Would have archived: newsletter' }), emailCard('b'), todoCard('t', { why: 'Would have closed: stale' }),
    ] });
    const s = make({ store });
    expect((await s.summary({ username: 'sample' })).wouldHave).toEqual({ archived: 1, closed: 1 });
  });
});
