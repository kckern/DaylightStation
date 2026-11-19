// A pass and an owner's answer overlapping (review fix round 1, finding 1): the real pass
// and session built by composition share one per-user lock, and a pass write never brings
// back a card the stored queue has as answered.
import { describe, it, expect, vi } from 'vitest';
import { createTriageRuntime } from '../composition.mjs';
import { refId, cardIdFor } from '../domain/triageItem.mjs';

const NOW = Date.parse('2026-11-19T17:00:00Z');
const AUTH = { session: { username: 'sample', sid: 's1' }, requestId: 'req-1' };
const CFG = { triage: { enabled: true, defaults: { mode: 'live' }, users: { sample: {} } } };
const QUEUE = 'sample/apps/triage/queue';

const message = () => ({
  ref: { provider: 'mx', accountId: 'sample', kind: 'message', id: 'm1' }, threadId: 't1', version: 'v1',
  from: { name: 'Pat', address: 'pat@example.com' }, to: ['me@example.com'], subject: 'Lunch?', snippet: 'Free Friday?',
  receivedAt: NOW - 60000, labels: ['INBOX'], starred: false, hasAttachments: false, automated: false, ownerRepliedInThread: false,
});
const itemId = refId(message().ref);
const cardId = cardIdFor(itemId, 'v1');
const replyCard = () => ({
  cardId, passId: 'pass.0', createdAt: NOW - 3600000, itemId, kind: 'email', ref: message().ref, itemVersion: 'v1',
  step: 'reply', urgent: false, choices: [{ key: 'archive', label: 'Archive' }, { key: 'reply', label: 'Reply' }, { key: 'task', label: 'Todo' }, { key: 'keep', label: 'Keep' }],
  suggested: 'reply', confidence: 0.9, why: 'Suggested', preDo: null, status: 'open', draftId: 'd1', draftBody: 'Yes!',
  display: { title: 'Lunch?', from: { name: 'Pat', address: 'pat@example.com' }, snippet: 'Free Friday?', threadId: 't1' },
});
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 5));

function build({ hooks = {} } = {}) {
  const files = new Map([[QUEUE, { passId: 'pass.0', builtAt: NOW - 3600000, cards: [replyCard()] }]]);
  const dataService = { user: {
    readStrict: async (p, u) => { await hooks.beforeRead?.(`${u}/${p}`, files); return structuredClone(files.get(`${u}/${p}`) ?? null); },
    writeAtomic: async (p, d, u) => { files.set(`${u}/${p}`, structuredClone(d)); return true; },
  } };
  const mailbox = {
    capabilities: () => ({ read: true, modify: true, compose: true, send: true }),
    listInbox: vi.fn(async () => [message()]),
    getMessage: vi.fn(async () => message()),
    senderHistory: vi.fn(async () => ({ sentToCount: 1 })),
    archive: vi.fn(async () => ({ version: 'v2' })),
    createDraft: vi.fn(async () => ({ draftId: 'dX' })),
    updateDraft: vi.fn(async (_u, id) => ({ draftId: id })),
    sendDraft: vi.fn(async () => ({ messageId: 'sent1' })),
  };
  const rt = createTriageRuntime({
    configuration: () => CFG, defaultUsername: 'sample', isKnownUser: () => true, dataService, mailbox,
    work: null, decisionGateway: null, aiGateway: null, clock: () => NOW, logger: null, answerWaitMs: 2000,
  });
  return { rt, files, mailbox };
}

describe('a pass and an answer overlapping', () => {
  it('an answer during a pass waits for it; the next pass keeps the card answered and nothing is sent twice', async () => {
    const { rt, files, mailbox } = build();
    const gate = deferred();
    mailbox.listInbox.mockImplementationOnce(async () => { await gate.promise; return [message()]; });

    const pass = rt.pass.run({ username: 'sample', trigger: 'manual' });
    await tick();
    expect(mailbox.listInbox).toHaveBeenCalledTimes(1); // the pass holds the lock, stale queue in hand
    const answer = rt.session.answer({ username: 'sample', cardId, choice: 'send', auth: AUTH });
    await tick();
    expect(mailbox.sendDraft).not.toHaveBeenCalled(); // waiting for the pass

    gate.resolve();
    await pass;
    expect((await answer).outcome).toBe('applied');
    expect(files.get(QUEUE).cards[0].status).toBe('answered');

    await rt.pass.run({ username: 'sample', trigger: 'manual' });
    expect(files.get(QUEUE).cards[0]).toMatchObject({ status: 'answered', answer: { choice: 'send' } });
    expect((await rt.session.session({ username: 'sample' })).cards).toEqual([]);
    expect(mailbox.sendDraft).toHaveBeenCalledTimes(1);
  });

  it('a pass started during an answer waits for it and does not resurrect the card', async () => {
    const { rt, files, mailbox } = build();
    const gate = deferred();
    mailbox.getMessage.mockImplementationOnce(async () => { await gate.promise; return message(); });

    const answer = rt.session.answer({ username: 'sample', cardId, choice: 'send', auth: AUTH });
    await tick();
    const pass = rt.pass.run({ username: 'sample', trigger: 'manual' });
    await tick();
    expect(mailbox.listInbox).not.toHaveBeenCalled(); // waiting for the answer

    gate.resolve();
    expect((await answer).outcome).toBe('applied');
    await pass;
    expect(files.get(QUEUE).cards[0].status).toBe('answered');
    expect(mailbox.sendDraft).toHaveBeenCalledTimes(1);
  });

  it('every pass write merges against the stored queue: a card answered there stays answered', async () => {
    // Simulates a write the lock does not cover (e.g. another process) landing mid-pass.
    let queueReads = 0;
    const { rt, files } = build({ hooks: { beforeRead: (key, f) => {
      if (key !== QUEUE) return;
      queueReads += 1;
      if (queueReads === 2) {
        const q = f.get(QUEUE);
        q.cards[0] = { ...q.cards[0], status: 'answered', answeredAt: NOW, answer: { choice: 'send' }, logEntryId: 'log.x' };
      }
    } } });
    await rt.pass.run({ username: 'sample', trigger: 'manual' });
    expect(queueReads).toBeGreaterThanOrEqual(2);
    expect(files.get(QUEUE).cards[0]).toMatchObject({ status: 'answered', answer: { choice: 'send' }, logEntryId: 'log.x', draftId: 'd1' });
  });
});
