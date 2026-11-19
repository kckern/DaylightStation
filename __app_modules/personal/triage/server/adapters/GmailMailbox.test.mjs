import { describe, it, expect, vi } from 'vitest';
import { GmailMailbox } from './GmailMailbox.mjs';

const hdrs = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const gmErr = (code, reason) => Object.assign(new Error('x'), { code, errors: [{ reason }] });

function msg(over = {}) {
  return {
    id: 'm1', threadId: 't1', historyId: '99', snippet: 'hi', internalDate: '1700000000000',
    labelIds: ['INBOX'], payload: { headers: hdrs({ From: 'Pat <pat@x.com>', To: 'me@x.com', Subject: 'Lunch', Date: 'Mon, 1 Jan 2024 00:00:00 +0000' }), parts: [] },
    ...over,
  };
}

function fake({ messages = {}, threads = {}, attachIds = [], modify } = {}) {
  return {
    users: {
      messages: {
        list: vi.fn(async ({ q }) => ({ data: { messages: (q.includes('has:attachment') ? attachIds : Object.keys(messages)).map((id) => ({ id })) } })),
        get: vi.fn(async ({ id }) => {
          if (!messages[id]) throw gmErr(404, 'notFound');
          return { data: messages[id] };
        }),
        modify: modify || vi.fn(async () => ({ data: { historyId: '100' } })),
      },
      threads: { get: vi.fn(async ({ id }) => ({ data: threads[id] || { messages: [{ id: 'm1', labelIds: ['INBOX'] }] } })) },
      drafts: {
        create: vi.fn(async () => ({ data: { id: 'd1' } })),
        send: vi.fn(async () => ({ data: { id: 'sent1' } })),
      },
    },
  };
}
const make = (g) => new GmailMailbox({ createClient: async () => g, logger: { info() {}, warn: vi.fn(), error() {}, debug() {} }, clock: { now: () => 0 } });

describe('GmailMailbox', () => {
  it('flags bulk mail automated and a person not', async () => {
    const g = fake({ messages: {
      b: msg({ id: 'b', payload: { headers: hdrs({ From: 'News <news@x.com>', 'List-Unsubscribe': '<mailto:u@x.com>' }) } }),
      p: msg({ id: 'p' }),
    } });
    const out = await make(g).listInbox('u', {});
    expect(out.find((m) => m.ref.id === 'b').automated).toBe(true);
    const p = out.find((m) => m.ref.id === 'p');
    expect(p.automated).toBe(false);
    expect(p).toMatchObject({ from: { name: 'Pat', address: 'pat@x.com' }, to: ['me@x.com'], version: '99', receivedAt: 1700000000000 });
    expect(p.ref).toEqual({ provider: 'gmail', accountId: 'u', kind: 'message', id: 'p' });
  });

  it('flags noreply senders automated', async () => {
    const g = fake({ messages: { n: msg({ id: 'n', payload: { headers: hdrs({ From: 'noreply@x.com' }) } }) } });
    expect((await make(g).getMessage('u', 'n')).automated).toBe(true);
  });

  it('marks attachments in listings via the has:attachment search', async () => {
    const g = fake({ messages: { a: msg({ id: 'a' }), b: msg({ id: 'b' }) }, attachIds: ['a'] });
    const out = await make(g).listInbox('u', {});
    expect(out.map((m) => m.hasAttachments)).toEqual([true, false]);
  });

  it('getMessage reads attachment parts and returns null on 404', async () => {
    const g = fake({ messages: { a: msg({ id: 'a', payload: { headers: [], parts: [{ filename: 'f.pdf' }] } }) } });
    const mb = make(g);
    expect((await mb.getMessage('u', 'a')).hasAttachments).toBe(true);
    expect(await mb.getMessage('u', 'gone')).toBeNull();
  });

  it('ownerRepliedInThread is true when another message in the thread is SENT', async () => {
    const g = fake({ messages: { m1: msg() }, threads: { t1: { messages: [{ id: 'm1', labelIds: ['INBOX'] }, { id: 'm0', labelIds: ['SENT'] }] } } });
    expect((await make(g).getMessage('u', 'm1')).ownerRepliedInThread).toBe(true);
  });

  it('archive removes INBOX', async () => {
    const g = fake();
    const r = await make(g).archive('u', 'm1');
    expect(g.users.messages.modify).toHaveBeenCalledWith({ userId: 'me', id: 'm1', requestBody: { removeLabelIds: ['INBOX'] } });
    expect(r).toEqual({ version: '100' });
  });

  it('403 insufficientPermissions throws MAILBOX_SCOPE_MISSING and flips modify', async () => {
    const g = fake({ modify: vi.fn(async () => { throw gmErr(403, 'insufficientPermissions'); }) });
    const mb = make(g);
    await expect(mb.archive('u', 'm1')).rejects.toMatchObject({ code: 'MAILBOX_SCOPE_MISSING' });
    expect(mb.capabilities('u').modify).toBe(false);
    expect(mb.capabilities('other').modify).toBe(true);
    g.users.messages.modify.mockClear();
    await expect(mb.star('u', 'm1')).rejects.toMatchObject({ code: 'MAILBOX_SCOPE_MISSING' });
    expect(g.users.messages.modify).not.toHaveBeenCalled();
  });

  it('other errors propagate unchanged', async () => {
    const e = gmErr(500, 'backendError');
    const g = fake({ modify: vi.fn(async () => { throw e; }) });
    await expect(make(g).archive('u', 'm1')).rejects.toBe(e);
  });

  it('senderHistory caps at 5', async () => {
    const g = fake();
    g.users.messages.list = vi.fn(async () => ({ data: { messages: Array.from({ length: 9 }, (_, i) => ({ id: String(i) })) } }));
    expect(await make(g).senderHistory('u', 'a@b.com')).toEqual({ sentToCount: 5 });
    expect(g.users.messages.list.mock.calls[0][0].q).toBe('to:a@b.com in:sent');
  });

  it('createDraft builds threaded RFC 2822 raw', async () => {
    const g = fake({ threads: { t1: { messages: [{ id: 'm1', payload: { headers: hdrs({ 'Message-ID': '<abc@x>', References: '<zero@x>' }) } }] } } });
    const r = await make(g).createDraft('u', { threadId: 't1', to: 'a@b.com', subject: 'Re: Hi', body: 'Yes' });
    expect(r).toEqual({ draftId: 'd1' });
    const arg = g.users.drafts.create.mock.calls[0][0].requestBody.message;
    expect(arg.threadId).toBe('t1');
    const raw = Buffer.from(arg.raw, 'base64url').toString();
    expect(raw).toContain('To: a@b.com');
    expect(raw).toContain('In-Reply-To: <abc@x>');
    expect(raw).toContain('References: <zero@x> <abc@x>');
    expect(raw.endsWith('\r\n\r\nYes')).toBe(true);
  });

  it('sendDraft returns the message id', async () => {
    expect(await make(fake()).sendDraft('u', 'd1')).toEqual({ messageId: 'sent1' });
  });
});
