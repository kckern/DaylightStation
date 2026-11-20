// Email classifier: asks Jev what to do with one message and builds a TriageProposal.
// Pure apart from the injected `evaluate` call and optional `logger`.
import { choice, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';

const TIMEOUT_MS = 20000;
const URGENT_P = 0.7;
// A confident "keep" needs no card: the mail stays in the inbox and the pass logs it as kept.
export const KEEP_CONFIDENCE = 0.85;

export const EMAIL_CHOICES = Object.freeze([
  { key: 'archive', label: 'Archive' },
  { key: 'reply', label: 'Reply (draft)' },
  { key: 'task', label: 'Make a todo' },
  { key: 'keep', label: 'Keep in inbox' },
]);
const KEYS = new Set(EMAIL_CHOICES.map((c) => c.key));

const RULE_WORDS = {
  known_person: 'a person you have written to',
  deadline: 'a deadline',
  money: 'money',
  sensitive_topic: 'a legal, medical or school matter',
  attachment_from_person: 'an attachment from a person',
  starred: 'a star',
  replied_thread: 'a thread you replied in',
  missing_facts: 'missing details',
};
const joinWords = (ws) => (ws.length < 2 ? ws.join('') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`);
const pct = (p) => `${Math.round(p * 100)}%`;

export function emailState(item, { mentions = [] } = {}) {
  const m = item.facts ?? {};
  return {
    ...(mentions.length ? { mentions } : {}),
    from: { name: m.from?.name ?? '', address: m.from?.address ?? '' },
    automated: !!m.automated,
    subject: m.subject ?? '',
    snippet: m.snippet ?? '',
    receivedAt: Number.isFinite(m.receivedAt) ? new Date(m.receivedAt).toISOString() : null,
    labels: m.labels ?? [],
    hasAttachments: !!m.hasAttachments,
    ownerRepliedInThread: !!m.ownerRepliedInThread,
  };
}

const unavailable = (item) => ({
  itemId: item.id, kind: 'email', step: 'unsure', urgent: false,
  choices: EMAIL_CHOICES.map((c) => ({ ...c })), suggested: null, confidence: 0,
  why: 'decision unavailable', preDo: null,
});

export async function classifyEmail({ item, guard, policy, evaluate, logger }) {
  const questions = {
    disposition: choice('What should the owner do with this email?', {
      archive: 'closed, nothing needed',
      reply: 'owner must respond',
      task: 'work to do later',
      keep: 'reference',
    }),
    urgent: yesNo('A person is waiting on the owner and the reply matters today.'),
  };
  const soft = Array.isArray(guard?.soft) ? guard.soft : [];
  const mentions = soft.map((r) => (r === 'deadline' ? 'a deadline or expiry' : r === 'money' ? 'money' : r));
  let disp; let urg;
  try {
    const res = await evaluate(emailState(item, { mentions }), questions, { timeout: TIMEOUT_MS });
    disp = res?.answers?.disposition;
    urg = res?.answers?.urgent;
    if (!disp || disp.type !== 'choice' || !KEYS.has(disp.choice)) throw new Error('malformed disposition answer');
  } catch (err) {
    logger?.warn?.('triage.classify.decision_unavailable', { itemId: item.id, kind: 'email', error: err?.message });
    return unavailable(item);
  }

  const blocked = guard?.blocked !== false; // fail closed on a missing verdict
  const confidence = Number.isFinite(disp.confidence) ? Math.min(1, Math.max(0, disp.confidence)) : 0;
  const threshold = policy?.autoArchiveConfidence;
  const step = disp.choice === 'reply' ? 'reply' : 'unsure';
  const urgent = step === 'reply' && urg?.type === 'yesNo' && urg.probability >= URGENT_P;
  let preDo = null;
  if (disp.choice === 'archive' && Number.isFinite(threshold) && confidence >= threshold && !blocked) {
    preDo = { action: 'archive', reason: 'confident archive' };
  } else if (disp.choice === 'keep' && confidence >= KEEP_CONFIDENCE) {
    preDo = { action: 'keep', reason: 'confident keep' };
  }

  let why;
  if (blocked && disp.choice === 'archive') {
    const rules = guard?.rules?.length ? guard.rules : ['missing_facts'];
    why = `Not auto-archived: mentions ${joinWords(rules.map((r) => RULE_WORDS[r] ?? r))}`;
  } else if (preDo?.action === 'archive') {
    why = `Archived: ${pct(confidence)} sure nothing is needed`;
  } else if (preDo?.action === 'keep') {
    why = `Kept in inbox: ${pct(confidence)} sure it is reference`;
  } else {
    const top = Object.entries(disp.probabilities ?? {}).filter(([k, p]) => KEYS.has(k) && Number.isFinite(p))
      .sort((a, b) => b[1] - a[1]).slice(0, 2);
    why = top.length
      ? `${Number.isFinite(threshold) && confidence >= threshold ? 'Suggested' : 'Unsure'}: ${top.map(([k, p]) => `${k} ${pct(p)}`).join(' / ')}`
      : `Suggested: ${disp.choice}`;
  }
  return {
    itemId: item.id, kind: 'email', step, urgent,
    choices: EMAIL_CHOICES.map((c) => ({ ...c })), suggested: disp.choice, confidence, why, preDo,
  };
}
