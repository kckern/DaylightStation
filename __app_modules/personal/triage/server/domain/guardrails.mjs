// Never-auto guardrails. Pure functions, no I/O. When in doubt, block.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordList = (terms) => new RegExp(`\\b(?:${terms.map((t) => escape(t).replace(/\\? /g, '\\s+')).join('|')})\\b`, 'i');

export const DEADLINE_KEYWORDS = [
  'due', 'deadline', 'deadlines', 'expires', 'expire', 'expiring', 'expiration', 'last day', 'rsvp',
  'respond by', 'reply by', 'final notice', 'overdue', 'past due', 'action required', 'time sensitive',
  'urgent', 'asap', 'reminder:',
];
// "by Friday", "by tomorrow", "by 5pm", "by Dec 3", "by end of day", "by 12/3"
export const DEADLINE_PATTERN = new RegExp(
  '\\bby\\s+(?:(?:this|next|end\\s+of)\\s+)?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\b'
  + '|\\bby\\s+(?:tomorrow|today|tonight|eod|cob|eow|end\\s+of\\s+(?:the\\s+)?(?:day|week|month|year)|noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}[/-]\\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s+\\d{1,2})',
  'i',
);
export const MONEY_KEYWORDS = [
  'invoice', 'invoices', 'payment', 'payments', 'bill', 'bills', 'billing', 'refund', 'refunds', 'charge', 'charged', 'charges',
  'balance due', 'amount due', 'wire', 'transfer', 'tax', 'taxes',
];
// $1,240  € 12  £3.50  USD 12  12 USD
export const MONEY_PATTERN = /[$€£]\s?\d|\b(?:usd|eur|gbp|cad)\s?\d|\d\s?(?:usd|eur|gbp|cad)\b/i;
export const SENSITIVE_KEYWORDS = {
  legal: ['lawyer', 'attorney', 'court', 'subpoena', 'contract', 'lawsuit', 'notary', 'lease'],
  medical: ['doctor', 'appointment', 'prescription', 'lab results', 'diagnosis', 'insurance claim', 'eob', 'clinic', 'hospital', 'dentist'],
  school: ['school', 'teacher', 'principal', 'report card', 'parent-teacher', 'iep', 'enrollment', 'field trip', 'permission slip', 'pta'],
};

const DEADLINE_RE = wordList(DEADLINE_KEYWORDS.filter((k) => !k.endsWith(':')));
const REMINDER_RE = /\breminder\s*:/i;
const MONEY_RE = wordList(MONEY_KEYWORDS);
const SENSITIVE_RE = wordList(Object.values(SENSITIVE_KEYWORDS).flat());

// Hyphens, underscores and punctuation shouldn't hide a term ("parent–teacher").
const norm = (text) => String(text ?? '').replace(/[‐-―]/g, '-');

const hitsDeadline = (t) => DEADLINE_RE.test(t) || REMINDER_RE.test(t) || DEADLINE_PATTERN.test(t);
const hitsMoney = (t) => MONEY_PATTERN.test(t) || MONEY_RE.test(t);
const hitsSensitive = (t) => SENSITIVE_RE.test(t);

function contentRules(text) {
  const t = norm(text);
  const rules = [];
  if (hitsDeadline(t)) rules.push('deadline');
  if (hitsMoney(t)) rules.push('money');
  if (hitsSensitive(t)) rules.push('sensitive_topic');
  return rules;
}

export function emailGuardrails(item, { sentToCount = 0 } = {}) {
  const m = item?.facts ?? {};
  const rules = [];
  if (!m.automated && sentToCount > 0) rules.push('known_person');
  rules.push(...contentRules(`${m.subject ?? ''}\n${m.snippet ?? ''}`));
  if (m.hasAttachments && !m.automated) rules.push('attachment_from_person');
  if (m.starred) rules.push('starred');
  if (m.ownerRepliedInThread) rules.push('replied_thread');
  return { blocked: rules.length > 0, rules };
}

export function todoGuardrails(item) {
  const w = item?.facts ?? {};
  const rules = contentRules(`${w.title ?? ''}\n${w.description ?? ''}`);
  return { blocked: rules.length > 0, rules };
}

const OPEN = new Set(['open', 'in_progress', 'paused']);
const isOpen = (w) => OPEN.has(w?.status?.category);
const normTitle = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const DAY_MS = 86400000;
const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
const dueMs = (due) => {
  if (!due) return null;
  if (Number.isFinite(due.at)) return due.at;
  if (typeof due.date === 'string') { const t = Date.parse(`${due.date}T00:00:00Z`); return Number.isFinite(t) ? t : null; }
  return null;
};
const sameContainer = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Newer = later createdAt; ties/unknown fall to ref id order so exactly one of a pair is "newer".
const isNewer = (a, b) => {
  const ca = a.createdAt ?? 0; const cb = b.createdAt ?? 0;
  if (ca !== cb) return ca > cb;
  return String(a.ref?.id) > String(b.ref?.id);
};

export function todoAutoClose(item, { openItems = [], asOf, overdueDays } = {}) {
  const no = { eligible: false, reason: null };
  const w = item?.facts;
  if (!w || !isOpen(w)) return no;
  if (todoGuardrails(item).blocked) return no;

  const title = normTitle(w.title);
  if (title) {
    for (const other of openItems) {
      const o = other?.facts ?? other;
      if (!o || o === w || (o.ref?.id === w.ref?.id && o.ref?.provider === w.ref?.provider)) continue;
      if (!isOpen(o) || normTitle(o.title) !== title || !sameContainer(o.containerRef, w.containerRef)) continue;
      if (isNewer(w, o)) return { eligible: true, reason: 'exact_duplicate', duplicateOf: o.ref };
    }
  }

  const now = toMs(asOf);
  if (Number.isFinite(now) && Number.isFinite(overdueDays) && overdueDays > 0 && w.due && !w.due.recurring) {
    const cutoff = now - overdueDays * DAY_MS;
    const due = dueMs(w.due);
    if (due !== null && due <= cutoff && Number.isFinite(w.modifiedAt) && w.modifiedAt <= cutoff) {
      return { eligible: true, reason: 'long_overdue' };
    }
  }
  return no;
}
