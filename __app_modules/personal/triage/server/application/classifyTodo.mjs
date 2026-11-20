// Todo classifier: auto-close is decided by guardrails (no Jev call); otherwise ask Jev what next.
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const TIMEOUT_MS = 20000;
const DAY_MS = 86400000;

const ALL = [
  { key: 'do_week', label: 'Do it this week', needs: 'update_task', desc: 'schedule it for this week' },
  { key: 'push', label: 'Push to next month', needs: 'update_task', desc: 'not now, move its due date out a month' },
  { key: 'drop', label: 'Drop it', needs: 'complete', desc: 'no longer relevant, close it' },
  { key: 'shrink', label: 'Turn into a smaller next step…', needs: 'create_task', desc: 'too big, replace with a smaller first step' },
];

const dueMs = (due) => {
  if (!due) return null;
  if (Number.isFinite(due.at)) return due.at;
  if (typeof due.date === 'string') { const t = Date.parse(`${due.date}T00:00:00Z`); return Number.isFinite(t) ? t : null; }
  return null;
};
const days = (ms) => Math.max(0, Math.floor(ms / DAY_MS));

export function todoState(item, asOf) {
  const w = item.facts ?? {};
  const created = Number.isFinite(w.createdAt) ? w.createdAt : null;
  const modified = Number.isFinite(w.modifiedAt) ? w.modifiedAt : null;
  return {
    title: w.title ?? '',
    description: typeof w.description === 'string' ? w.description.slice(0, 500) : '',
    due: w.due ?? null,
    ageDays: created === null ? null : days(asOf - created),
    lastModifiedDays: modified === null ? null : days(asOf - modified),
    container: w.containerRef?.name ?? w.containerRef?.id ?? null,
  };
}

const span = (n) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

function staleWhy(item, asOf) {
  const w = item.facts ?? {};
  const due = dueMs(w.due);
  if (due !== null && due < asOf) {
    const n = days(asOf - due);
    return n === 0 ? 'Due today' : `Overdue ${span(n)}`;
  }
  if (Number.isFinite(w.modifiedAt)) {
    const n = days(asOf - w.modifiedAt);
    return n === 0 ? 'Touched today' : `Idle ${span(n)}`;
  }
  return 'Open todo';
}

function autoCloseWhy(item, autoClose, asOf) {
  if (autoClose.reason === 'exact_duplicate') {
    const d = autoClose.duplicateOf;
    return `Duplicate of \u201c${d?.title ?? d?.id ?? 'another open todo'}\u201d`;
  }
  const w = item.facts ?? {};
  const due = dueMs(w.due);
  if (due !== null && Number.isFinite(w.modifiedAt)) {
    return `Overdue ${span(days(asOf - due))} and untouched for ${span(days(asOf - w.modifiedAt))}`;
  }
  return 'Long overdue and untouched';
}

export async function classifyTodo({ item, autoClose, evaluate, capabilities, logger, asOf = Date.now() }) {
  const base = { itemId: item.id, kind: 'todo', step: 'todo', urgent: false };
  const caps = capabilities instanceof Set ? capabilities : new Set(capabilities ?? []);
  const offered = ALL.filter((c) => caps.has(c.needs));
  const choices = offered.map(({ key, label }) => ({ key, label }));
  if (autoClose?.eligible && caps.has('complete')) {
    const reason = autoClose.reason ?? 'auto_close';
    return { ...base, choices, suggested: 'drop', confidence: 1, why: autoCloseWhy(item, autoClose, asOf),
      preDo: { action: 'complete', reason } };
  }
  if (offered.length === 0) {
    return { ...base, choices: [], suggested: null, confidence: 0, why: 'no actions available', preDo: null };
  }
  if (offered.length === 1) {
    return { ...base, choices, suggested: offered[0].key === 'drop' ? null : offered[0].key, confidence: 0, why: staleWhy(item, asOf), preDo: null };
  }
  let ans;
  try {
    const q = choice('What should the owner do with this open todo?',
      Object.fromEntries(offered.map((c) => [c.key, c.desc])));
    const res = await evaluate(todoState(item, asOf), { next: q }, { timeout: TIMEOUT_MS });
    ans = res?.answers?.next;
    if (!ans || ans.type !== 'choice' || !offered.some((c) => c.key === ans.choice)) throw new Error('malformed next answer');
  } catch (err) {
    logger?.warn?.('triage.classify.decision_unavailable', { itemId: item.id, kind: 'todo', error: err?.message });
    return { ...base, choices, suggested: null, confidence: 0, why: 'decision unavailable', preDo: null };
  }
  return { ...base, choices, suggested: ans.choice, confidence: Number.isFinite(ans.confidence) ? ans.confidence : 0,
    why: staleWhy(item, asOf), preDo: null };
}
