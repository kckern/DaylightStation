import { describe, it, expect, vi } from 'vitest';
import { GmailMailbox } from './GmailMailbox.mjs';
import { MAILBOX_NOT_FOUND } from '../ports/IMailbox.mjs';

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
        update: vi.fn(async () => ({ data: { id: 'd1' } })),
        get: vi.fn(async () => ({ data: { message: { threadId: 't1', payload: { headers: hdrs({ To: 'a@b.com', Cc: 'c@b.com', Bcc: 'h@b.com', Subject: 'Re: Hi', 'In-Reply-To': '<abc@x>', References: '<abc@x>' }) } } } })),
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
    expect(g.users.messages.list.mock.calls[0][0].q).toBe('to:"a@b.com" in:sent');
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

  it('rejects CR/LF in to and subject with MAILBOX_INVALID_HEADER', async () => {
    const g = fake();
    const mb = make(g);
    await expect(mb.createDraft('u', { to: 'a@b.com\r\nBcc: x@y.com', subject: 's', body: 'b' })).rejects.toMatchObject({ code: 'MAILBOX_INVALID_HEADER' });
    await expect(mb.createDraft('u', { to: 'a@b.com', subject: 's\nBcc: x@y.com', body: 'b' })).rejects.toMatchObject({ code: 'MAILBOX_INVALID_HEADER' });
    expect(g.users.drafts.create).not.toHaveBeenCalled();
  });

  it('strips line breaks from threading headers taken from inbound mail', async () => {
    const g = fake({ threads: { t1: { messages: [{ id: 'm1', payload: { headers: hdrs({ 'Message-ID': '<abc@x>\r\nBcc: evil@y.com', References: '<z@x>\nX: y' }) } }] } } });
    await make(g).createDraft('u', { threadId: 't1', to: 'a@b.com', subject: 's', body: 'b' });
    const raw = Buffer.from(g.users.drafts.create.mock.calls[0][0].requestBody.message.raw, 'base64url').toString();
    const headerBlock = raw.split('\r\n\r\n')[0].split('\r\n');
    expect(headerBlock.some((l) => l.startsWith('Bcc:'))).toBe(false);
    expect(headerBlock.some((l) => l.startsWith('X:'))).toBe(false);
  });

  it('RFC 2047 encodes non-ASCII subjects', async () => {
    const g = fake();
    await make(g).createDraft('u', { to: 'a@b.com', subject: 'Café', body: 'b' });
    const raw = Buffer.from(g.users.drafts.create.mock.calls[0][0].requestBody.message.raw, 'base64url').toString();
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Café').toString('base64')}?=`);
  });

  it('a write on a draft or message that is gone throws MAILBOX_NOT_FOUND', async () => {
    const g = fake();
    g.users.drafts.get = vi.fn(async () => { throw gmErr(404, 'notFound'); });
    await expect(make(g).updateDraft('u', 'gone', { body: 'x' })).rejects.toMatchObject({ code: MAILBOX_NOT_FOUND });
    g.users.messages.modify = vi.fn(async () => { throw gmErr(404, 'notFound'); });
    await expect(make(g).archive('u', 'gone')).rejects.toMatchObject({ code: MAILBOX_NOT_FOUND });
  });

  it('updateDraft preserves Cc, Bcc and threading', async () => {
    const g = fake();
    await make(g).updateDraft('u', 'd1', { body: 'new' });
    const m = g.users.drafts.update.mock.calls[0][0].requestBody.message;
    const raw = Buffer.from(m.raw, 'base64url').toString();
    expect(raw).toContain('Cc: c@b.com');
    expect(raw).toContain('Bcc: h@b.com');
    expect(raw).toContain('In-Reply-To: <abc@x>');
    expect(m.threadId).toBe('t1');
    expect(raw.endsWith('\r\n\r\nnew')).toBe(true);
  });

  it('listInbox skips a message that vanished (404) but propagates other errors', async () => {
    const g = fake({ messages: { a: msg({ id: 'a' }), b: msg({ id: 'b' }) } });
    const real = g.users.messages.get;
    g.users.messages.get = vi.fn(async (a) => { if (a.id === 'a') throw gmErr(404, 'notFound'); return real(a); });
    expect((await make(g).listInbox('u', {})).map((m) => m.ref.id)).toEqual(['b']);
    g.users.messages.get = vi.fn(async () => { throw gmErr(500, 'backendError'); });
    await expect(make(g).listInbox('u', {})).rejects.toMatchObject({ code: 500 });
  });

  it('read 403 insufficientPermissions maps to MAILBOX_SCOPE_MISSING and flips read', async () => {
    const g = fake();
    g.users.messages.list = vi.fn(async () => { throw gmErr(403, 'insufficientPermissions'); });
    const mb = make(g);
    await expect(mb.listInbox('u', {})).rejects.toMatchObject({ code: 'MAILBOX_SCOPE_MISSING' });
    expect(mb.capabilities('u').read).toBe(false);
    await expect(mb.getMessage('u', 'm1')).rejects.toMatchObject({ code: 'MAILBOX_SCOPE_MISSING' });
    await expect(mb.senderHistory('u', 'a@b.com')).rejects.toMatchObject({ code: 'MAILBOX_SCOPE_MISSING' });
  });
});
