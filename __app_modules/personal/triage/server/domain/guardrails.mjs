// Never-auto guardrails. Pure functions, no I/O. When in doubt, block.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Optional inflection suffix so "appointments", "billed", "refunding" match their stems.
const wordList = (terms) => new RegExp(`\\b(?:${terms.map((t) => escape(t).replace(/\\? /g, '\\s+')).join('|')})(?:s|es|ed|d|ing)?\\b`, 'i');

export const DEADLINE_KEYWORDS = [
  'due', 'deadline', 'deadlines', 'expires', 'expire', 'expiring', 'expiration', 'last day', 'rsvp',
  'respond by', 'reply by', 'final notice', 'overdue', 'past due', 'action required', 'time sensitive',
  'urgent', 'asap', 'reminder:', 'closes', 'closing', 'ends', 'ending', 'today only', 'no later than', 'renewal', 'renew',
];
// "by Friday", "by tomorrow", "by 5pm", "by Dec 3", "by end of day", "by 12/3"
export const DEADLINE_PATTERN = new RegExp(
  '\\bby\\s+(?:(?:this|next|end\\s+of)\\s+)?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\b'
  + '|\\bby\\s+(?:tomorrow|today|tonight|eod|cob|eow|end\\s+of\\s+(?:the\\s+)?(?:day|week|month|year)|noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}[/-]\\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s+\\d{1,2})',
  'i',
);
// "no later than Monday", "before Friday", "within 48 hours", "closes tonight", "ends Friday"
export const DEADLINE_PATTERN_2 = new RegExp(
  '\\b(?:no\\s+later\\s+than|before|until|through|closes?|ends?|ending|closing)\\s+(?:(?:this|next|end\\s+of)\\s+)?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\b'
  + '|\\b(?:closes?|ends?|expires?|due)\\s+(?:tonight|today|tomorrow|soon|midnight)\\b'
  + '|\\bwithin\\s+(?:\\d+|a|an|one|two|three|four|five|six|seven|ten|twelve)\\s*(?:hours?|hrs?|days?|weeks?|minutes?)\\b'
  + '|\\b(?:today|tonight)\\s+only\\b|\\bno\\s+later\\s+than\\b|\\blast\\s+chance\\b',
  'i',
);
export const MONEY_KEYWORDS = [
  'invoice', 'invoices', 'payment', 'payments', 'bill', 'bills', 'billing', 'refund', 'refunds', 'charge', 'charged', 'charges',
  'balance due', 'amount due', 'wire', 'transfer', 'transferred', 'tax', 'taxes',
  'rent', 'rental', 'mortgage', 'statement', 'subscription', 'renewal', 'renew', 'pay', 'paid', 'payroll',
  'receipt', 'loan', 'bank', 'credit card', 'debit', 'dollar', 'dollars', 'fee', 'fees', 'salary', 'deposit', 'overdraft',
];
// $1,240  € 12  £3.50  USD 12  12 USD
export const MONEY_PATTERN = /[$€£¥]\s?\d|\b(?:usd|eur|gbp|cad|chf|aud|jpy)\s?\d|\d\s?(?:[€£¥]|(?:usd|eur|gbp|cad|chf|aud|jpy|dollars?|bucks)\b)/i;
export const SENSITIVE_KEYWORDS = {
  legal: ['lawyer', 'attorney', 'court', 'subpoena', 'contract', 'lawsuit', 'notary', 'lease', 'legal', 'custody', 'divorce', 'passport', 'visa', 'immigration', 'police'],
  medical: ['medical', 'health', 'pediatrician', 'pharmacy', 'therapy', 'therapist', 'vaccine', 'vaccination', 'surgery', 'daycare', 'doctor', 'appointment', 'prescription', 'lab results', 'diagnosis', 'insurance claim', 'eob', 'clinic', 'hospital', 'dentist'],
  school: ['school', 'teacher', 'principal', 'report card', 'parent-teacher', 'iep', 'enrollment', 'field trip', 'permission slip', 'pta'],
};

const DEADLINE_RE = wordList(DEADLINE_KEYWORDS.filter((k) => !k.endsWith(':')));
const REMINDER_RE = /\breminder\s*:/i;
const MONEY_RE = wordList(MONEY_KEYWORDS);
const SENSITIVE_RE = wordList(Object.values(SENSITIVE_KEYWORDS).flat());

// Hyphens, underscores and punctuation shouldn't hide a term ("parent–teacher").
const norm = (text) => String(text ?? '').replace(/[‐-―]/g, '-');

const hitsDeadline = (t) => DEADLINE_RE.test(t) || REMINDER_RE.test(t) || DEADLINE_PATTERN.test(t) || DEADLINE_PATTERN_2.test(t);
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

// Deadline and money words in mail from an automated sender (sign-in links that "expire",
// receipts) are weighed by the decision, not hard blocks: they come back as `soft` and the
// classifier tells Jev about them. From a person they still block.
const SOFT_WHEN_AUTOMATED = new Set(['deadline', 'money']);

export function emailGuardrails(item, { sentToCount = 0 } = {}) {
  if (!item || !item.facts || typeof item.facts !== 'object') return { blocked: true, rules: ['missing_facts'], soft: [] };
  const m = item.facts;
  const rules = [];
  const soft = [];
  if (!m.automated && sentToCount > 0) rules.push('known_person');
  for (const r of contentRules(`${m.subject ?? ''}\n${m.snippet ?? ''}`)) {
    (m.automated === true && SOFT_WHEN_AUTOMATED.has(r) ? soft : rules).push(r);
  }
  if (m.hasAttachments && !m.automated) rules.push('attachment_from_person');
  if (m.starred) rules.push('starred');
  if (m.ownerRepliedInThread) rules.push('replied_thread');
  return { blocked: rules.length > 0, rules, soft };
}

export function todoGuardrails(item) {
  if (!item || !item.facts || typeof item.facts !== 'object') return { blocked: true, rules: ['missing_facts'] };
  const w = item.facts;
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
      if (isNewer(w, o)) return { eligible: true, reason: 'exact_duplicate', duplicateOf: { ...o.ref, title: o.title ?? null } };
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
