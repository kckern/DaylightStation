import { createHash } from 'node:crypto';
import { MAILBOX_SCOPE_MISSING, MAILBOX_NOT_FOUND } from '../ports/IMailbox.mjs';

const HEADERS = ['From', 'To', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted', 'Date'];
const NOREPLY = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce)/i;
const SENT_CAP = 5;

/** Version = what triage cares about: the labels, minus those that change when the owner just reads the mail. */
function labelVersion(labelIds) {
  const kept = (labelIds || []).filter((l) => l !== 'UNREAD' && l !== 'IMPORTANT' && !l.startsWith('CATEGORY_')).sort();
  return createHash('sha256').update(kept.join('\n')).digest('hex').slice(0, 16);
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const fromB64url = (s) => Buffer.from(s || '', 'base64url').toString('utf8');
const noop = () => {};
const INVALID_HEADER = 'MAILBOX_INVALID_HEADER';

/** Caller-supplied header value: CR/LF would inject headers, so refuse it. */
function strictHeader(name, value) {
  const v = String(value ?? '');
  if (/[\r\n]/.test(v)) {
    const e = new Error(`Header "${name}" contains a line break`);
    e.code = INVALID_HEADER;
    throw e;
  }
  return v;
}
/** Value copied from inbound mail (untrusted): strip line breaks. */
const cleanHeader = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

// Gmail's `snippet` is HTML-escaped ("didn&#39;t"); headers are not. One pass, so
// "&amp;lt;" becomes "&lt;" (what the sender wrote), never "<".
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeSnippet(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
/** RFC 2047 encode a subject when it holds non-ASCII. */
const encodeSubject = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function buildRaw({ to, subject, cc, bcc, inReplyTo, references, body }) {
  const lines = [`To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"');
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  return b64url(`${lines.join('\r\n')}\r\n\r\n${body}`);
}

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

  /** Display name of this mailbox source, for the owner-facing UI. */
  get displayName() { return 'Gmail'; }

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
      if (isNotFound(err)) {
        this.#logger.warn?.('triage.mailbox.write_target_gone', { username, op });
        throw Object.assign(new Error(`mailbox ${op}: not found`), { code: MAILBOX_NOT_FOUND, cause: err });
      }
      this.#logger.error?.('triage.mailbox.write_failed', { username, op, error: err?.message });
      throw err;
    }
  }

  /** Run a read; map insufficientPermissions to MAILBOX_SCOPE_MISSING and flip `read`. */
  async #read(username, op, fn) {
    if (!this.capabilities(username).read) throw this.#scopeError('read');
    try {
      return await fn(await this.#createClient(username));
    } catch (err) {
      if (isScopeError(err)) {
        this.#flip(username, 'read');
        this.#logger.warn?.('triage.mailbox.scope_missing', { username, op, capability: 'read' });
        throw this.#scopeError('read', err);
      }
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
      version: labelVersion(labels),
      from,
      to: splitAddresses(headers['to']),
      subject: headers['subject'] || '',
      snippet: decodeSnippet(msg.snippet),
      receivedAt: Number(msg.internalDate) || (Number.isNaN(dateMs) ? 0 : dateMs),
      labels,
      starred: labels.includes('STARRED'),
      hasAttachments,
      automated,
      ownerRepliedInThread: ownerReplied,
      url: `https://mail.google.com/mail/#all/${encodeURIComponent(msg.id)}`,
      sourceName: 'Gmail',
    };
  }

  async #ownerReplied(gmail, msg) {
    if (!msg.threadId) return false;
    const t = await gmail.users.threads.get({ userId: 'me', id: msg.threadId, format: 'minimal' });
    return (t.data.messages || []).some((m) => m.id !== msg.id && (m.labelIds || []).includes('SENT'));
  }

  listInbox(username, { newerThanDays = 14, max = 200 } = {}) {
    return this.#read(username, 'list_inbox', async (gmail) => {
      const q = `in:inbox newer_than:${newerThanDays}d`;
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: max });
      const ids = (list.data.messages || []).map((m) => m.id);
      // metadata format carries no parts; one extra search flags attachments instead of fetching full bodies.
      const att = await gmail.users.messages.list({ userId: 'me', q: `${q} has:attachment`, maxResults: max });
      const withAtt = new Set((att.data.messages || []).map((m) => m.id));
      const out = [];
      for (const id of ids) {
        try {
          const res = await gmail.users.messages.get({
            userId: 'me', id, format: 'metadata', metadataHeaders: HEADERS,
          });
          const msg = res.data;
          out.push(this.#normalize(username, msg, {
            hasAttachments: withAtt.has(id),
            ownerReplied: await this.#ownerReplied(gmail, msg),
          }));
        } catch (err) {
          if (isNotFound(err)) {
            this.#logger.debug?.('triage.mailbox.message_gone', { username, id });
            continue;
          }
          throw err;
        }
      }
      this.#logger.info?.('triage.mailbox.listed', { username, count: out.length, newerThanDays });
      return out;
    });
  }

  getMessage(username, id) {
    return this.#read(username, 'get_message', async (gmail) => {
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
    });
  }

  async #modify(username, id, op, body) {
    return this.#write(username, 'modify', op, async (gmail) => {
      const res = await gmail.users.messages.modify({ userId: 'me', id, requestBody: body });
      this.#logger.info?.(`triage.mailbox.${op}`, { username, id });
      return { version: labelVersion(res.data?.labelIds) };
    });
  }

  archive(username, id) { return this.#modify(username, id, 'archive', { removeLabelIds: ['INBOX'] }); }
  unarchive(username, id) { return this.#modify(username, id, 'unarchive', { addLabelIds: ['INBOX'] }); }
  star(username, id) { return this.#modify(username, id, 'star', { addLabelIds: ['STARRED'] }); }
  unstar(username, id) { return this.#modify(username, id, 'unstar', { removeLabelIds: ['STARRED'] }); }

  senderHistory(username, address) {
    return this.#read(username, 'sender_history', async (gmail) => {
      const safe = String(address).replace(/["\\\r\n]/g, '');
      const res = await gmail.users.messages.list({
        userId: 'me', q: `to:"${safe}" in:sent`, maxResults: SENT_CAP,
      });
      return { sentToCount: Math.min((res.data.messages || []).length, SENT_CAP) };
    });
  }

  async #raw(gmail, { threadId, to, subject, body }) {
    const fields = {
      to: strictHeader('To', to),
      subject: encodeSubject(strictHeader('Subject', subject)),
      body,
    };
    if (threadId) {
      const t = await gmail.users.threads.get({
        userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'],
      });
      const last = (t.data.messages || []).slice(-1)[0];
      const h = Object.fromEntries((last?.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      const mid = cleanHeader(h['message-id']);
      if (mid) {
        fields.inReplyTo = mid;
        fields.references = [cleanHeader(h['references']), mid].filter(Boolean).join(' ');
      }
    }
    return buildRaw(fields);
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
      const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), cleanHeader(x.value)]));
      const raw = buildRaw({
        to: h['to'] || '', cc: h['cc'], bcc: h['bcc'],
        subject: encodeSubject(h['subject'] || ''),
        inReplyTo: h['in-reply-to'], references: h['references'], body,
      });
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
