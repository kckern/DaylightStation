import { MAILBOX_SCOPE_MISSING } from '../ports/IMailbox.mjs';

const HEADERS = ['From', 'To', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted', 'Date'];
const NOREPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce)/i;
const SENT_CAP = 5;

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const fromB64url = (s) => Buffer.from(s || '', 'base64url').toString('utf8');
const noop = () => {};

function parseAddress(raw = '') {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  return { name: '', address: raw.trim().toLowerCase() };
}
const splitAddresses = (raw = '') =>
  raw.split(',').map((s) => parseAddress(s).address).filter(Boolean);

function hasAttachmentPart(part) {
  if (!part) return false;
  if (part.filename) return true;
  return (part.parts || []).some(hasAttachmentPart);
}

function errReason(err) {
  return err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason;
}
const isNotFound = (err) => err?.code === 404 || err?.response?.status === 404;
const isScopeError = (err) =>
  (err?.code === 403 || err?.response?.status === 403) && errReason(err) === 'insufficientPermissions';

/** Gmail implementation of IMailbox. Capabilities are assumed true until Gmail says otherwise. */
export class GmailMailbox {
  #createClient;
  #logger;
  #clock;
  #caps = new Map();

  constructor({ createClient, logger, clock } = {}) {
    if (!createClient) throw new Error('GmailMailbox requires createClient');
    this.#createClient = createClient;
    this.#logger = logger || { info: noop, warn: noop, error: noop, debug: noop };
    this.#clock = clock || { now: () => Date.now() };
  }

  capabilities(username) {
    return { ...(this.#caps.get(username) || { read: true, modify: true, compose: true, send: true }) };
  }

  #flip(username, cap) {
    const caps = this.capabilities(username);
    caps[cap] = false;
    this.#caps.set(username, caps);
  }

  /** Run a write; map insufficientPermissions to MAILBOX_SCOPE_MISSING. `cap` is the capability it needs. */
  async #write(username, cap, op, fn) {
    if (!this.capabilities(username)[cap]) throw this.#scopeError(cap);
    try {
      return await fn(await this.#createClient(username));
    } catch (err) {
      if (isScopeError(err)) {
        this.#flip(username, cap);
        this.#logger.warn?.('triage.mailbox.scope_missing', { username, op, capability: cap });
        throw this.#scopeError(cap, err);
      }
      this.#logger.error?.('triage.mailbox.write_failed', { username, op, error: err?.message });
      throw err;
    }
  }

  #scopeError(cap, cause) {
    const e = new Error(`Mailbox capability "${cap}" is missing`);
    e.code = MAILBOX_SCOPE_MISSING;
    e.capability = cap;
    if (cause) e.cause = cause;
    return e;
  }

  #normalize(username, msg, { hasAttachments, ownerReplied }) {
    const headers = {};
    for (const h of msg.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
    const from = parseAddress(headers['from']);
    const labels = msg.labelIds || [];
    const precedence = (headers['precedence'] || '').trim().toLowerCase();
    const autoSub = (headers['auto-submitted'] || '').trim().toLowerCase();
    const localPart = from.address.split('@')[0] || '';
    const automated = Boolean(
      headers['list-unsubscribe'] ||
      ['bulk', 'list', 'junk'].includes(precedence) ||
      (autoSub && autoSub !== 'no') ||
      NOREPLY.test(localPart)
    );
    const dateMs = Date.parse(headers['date'] || '');
    return {
      ref: { provider: 'gmail', accountId: username, kind: 'message', id: msg.id },
      threadId: msg.threadId,
      version: String(msg.historyId ?? ''),
      from,
      to: splitAddresses(headers['to']),
      subject: headers['subject'] || '',
      snippet: msg.snippet || '',
      receivedAt: Number(msg.internalDate) || (Number.isNaN(dateMs) ? 0 : dateMs),
      labels,
      starred: labels.includes('STARRED'),
      hasAttachments,
      automated,
      ownerRepliedInThread: ownerReplied,
    };
  }

  async #ownerReplied(gmail, msg) {
    if (!msg.threadId) return false;
    const t = await gmail.users.threads.get({ userId: 'me', id: msg.threadId, format: 'minimal' });
    return (t.data.messages || []).some((m) => m.id !== msg.id && (m.labelIds || []).includes('SENT'));
  }

  async listInbox(username, { newerThanDays = 14, max = 200 } = {}) {
    const gmail = await this.#createClient(username);
    const q = `in:inbox newer_than:${newerThanDays}d`;
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: max });
    const ids = (list.data.messages || []).map((m) => m.id);
    // metadata format carries no parts; one extra search flags attachments instead of fetching full bodies.
    const att = await gmail.users.messages.list({ userId: 'me', q: `${q} has:attachment`, maxResults: max });
    const withAtt = new Set((att.data.messages || []).map((m) => m.id));
    const out = [];
    for (const id of ids) {
      const res = await gmail.users.messages.get({
        userId: 'me', id, format: 'metadata', metadataHeaders: HEADERS,
      });
      const msg = res.data;
      out.push(this.#normalize(username, msg, {
        hasAttachments: withAtt.has(id),
        ownerReplied: await this.#ownerReplied(gmail, msg),
      }));
    }
    this.#logger.info?.('triage.mailbox.listed', { username, count: out.length, newerThanDays });
    return out;
  }

  async getMessage(username, id) {
    const gmail = await this.#createClient(username);
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const msg = res.data;
      return this.#normalize(username, msg, {
        hasAttachments: hasAttachmentPart(msg.payload),
        ownerReplied: await this.#ownerReplied(gmail, msg),
      });
    } catch (err) {
      if (isNotFound(err)) {
        this.#logger.debug?.('triage.mailbox.message_gone', { username, id });
        return null;
      }
      throw err;
    }
  }

  async #modify(username, id, op, body) {
    return this.#write(username, 'modify', op, async (gmail) => {
      const res = await gmail.users.messages.modify({ userId: 'me', id, requestBody: body });
      this.#logger.info?.(`triage.mailbox.${op}`, { username, id });
      return { version: String(res.data?.historyId ?? '') };
    });
  }

  archive(username, id) { return this.#modify(username, id, 'archive', { removeLabelIds: ['INBOX'] }); }
  unarchive(username, id) { return this.#modify(username, id, 'unarchive', { addLabelIds: ['INBOX'] }); }
  star(username, id) { return this.#modify(username, id, 'star', { addLabelIds: ['STARRED'] }); }
  unstar(username, id) { return this.#modify(username, id, 'unstar', { removeLabelIds: ['STARRED'] }); }

  async senderHistory(username, address) {
    const gmail = await this.#createClient(username);
    const res = await gmail.users.messages.list({
      userId: 'me', q: `to:${address} in:sent`, maxResults: SENT_CAP,
    });
    return { sentToCount: Math.min((res.data.messages || []).length, SENT_CAP) };
  }

  async #raw(gmail, { threadId, to, subject, body }) {
    const lines = [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"'];
    if (threadId) {
      const t = await gmail.users.threads.get({
        userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'],
      });
      const last = (t.data.messages || []).slice(-1)[0];
      const h = Object.fromEntries((last?.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      if (h['message-id']) {
        lines.push(`In-Reply-To: ${h['message-id']}`);
        lines.push(`References: ${[h['references'], h['message-id']].filter(Boolean).join(' ')}`);
      }
    }
    return b64url(`${lines.join('\r\n')}\r\n\r\n${body}`);
  }

  createDraft(username, { threadId, to, subject, body }) {
    return this.#write(username, 'compose', 'create_draft', async (gmail) => {
      const raw = await this.#raw(gmail, { threadId, to, subject, body });
      const res = await gmail.users.drafts.create({
        userId: 'me', requestBody: { message: { raw, ...(threadId ? { threadId } : {}) } },
      });
      this.#logger.info?.('triage.mailbox.draft_created', { username, draftId: res.data.id, threadId });
      return { draftId: res.data.id };
    });
  }

  updateDraft(username, draftId, { body }) {
    return this.#write(username, 'compose', 'update_draft', async (gmail) => {
      const cur = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
      const msg = cur.data.message || {};
      const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      const lines = [`To: ${h['to'] || ''}`, `Subject: ${h['subject'] || ''}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"'];
      if (h['in-reply-to']) lines.push(`In-Reply-To: ${h['in-reply-to']}`);
      if (h['references']) lines.push(`References: ${h['references']}`);
      const raw = b64url(`${lines.join('\r\n')}\r\n\r\n${body}`);
      const res = await gmail.users.drafts.update({
        userId: 'me', id: draftId,
        requestBody: { message: { raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) } },
      });
      this.#logger.info?.('triage.mailbox.draft_updated', { username, draftId });
      return { draftId: res.data.id || draftId };
    });
  }

  sendDraft(username, draftId) {
    return this.#write(username, 'send', 'send_draft', async (gmail) => {
      const res = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draftId } });
      this.#logger.info?.('triage.mailbox.draft_sent', { username, draftId, messageId: res.data.id });
      return { messageId: res.data.id };
    });
  }
}

export default GmailMailbox;
