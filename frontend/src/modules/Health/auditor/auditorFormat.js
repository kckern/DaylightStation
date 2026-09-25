// Plain-word labels and formatters shared by the auditor page, its run detail
// and the Settings status line.

export const TRIGGER_LABELS = {
  captures: 'New food captured',
  reviews: 'You reviewed food',
  stabilization: '72-hour review window closed',
  scaleReconcile: 'Scale readings updated',
  artwork: 'Artwork changed',
  dayRollover: 'New day',
  edits: 'Food edited',
  dailySweep: 'Daily sweep',
  manual: 'Run manually',
  unclassified: 'First check after update',
  unknown: 'Before tracking began',
};
export const triggerLabel = kind => TRIGGER_LABELS[kind] || kind;

export const PERMISSION_LABELS = {
  naming: 'Names',
  identification: 'Food identity',
  mealPlacement: 'Meal time',
  grouping: 'Grouping',
  artwork: 'Icons and photos',
  portion: 'Portions',
  nutrients: 'Nutrient values',
  estimates: 'Estimates',
  completeCaptures: 'Finishing captures',
  questions: 'Asking questions',
};
export const permissionLabel = kind => PERMISSION_LABELS[kind] || kind;

/** One-line description of what each permission lets the auditor do. */
export const PERMISSION_DESCRIPTIONS = {
  naming: 'Rename foods',
  identification: 'Match foods to known products',
  mealPlacement: 'Move food between meals/days',
  grouping: 'Group foods into meals',
  artwork: 'Choose icons and photos',
  portion: 'Change amounts and weights',
  nutrients: 'Change nutrient values',
  estimates: 'Estimate missing values',
  completeCaptures: 'Finish stranded captures',
  questions: 'Ask you questions',
};

/** Triggers a person can switch off ('manual', 'unclassified', 'unknown' are journal-only). */
export const SWITCHABLE_TRIGGERS = ['captures', 'reviews', 'stabilization', 'scaleReconcile', 'artwork', 'dayRollover', 'edits', 'dailySweep'];

export const AUDITOR_MODELS = ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.6-luna'];

/**
 * The server's own message from a DaylightAPI error ("HTTP 400: Bad Request -
 * {"error":"Invalid daily cap"}"), or the error message when there is none.
 */
export function serverMessage(error) {
  const body = /^HTTP \d+: [^-]* - (.*)$/s.exec(error?.message || '')?.[1];
  try { return JSON.parse(body).error || error.message; } catch { return body || error?.message || 'Something went wrong'; }
}

export const SUPPRESSED_REASONS = {
  'questions-off': 'Questions are switched off',
  blocked: "Every answer needed a change it isn't allowed to make",
  'entries-missing': 'The food it asked about changed',
};

/** `$0.0123` (4 dp by default); "—" when there is no number. */
export function formatUsd(value, digits = 4) {
  return Number.isFinite(value) ? `$${value.toFixed(digits)}` : '—';
}

/** Local time for today, "Sep 24, 3:42 PM" otherwise; "—" for a missing or bad instant. */
export function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '—';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Run length from start to finish: "42 s", "1 m", "3 m 5 s"; "—" when either end is missing. */
export function formatDuration(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} m${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
}

/** The enforced figure for today: the AI usage ledger (includes failed runs) when present. */
export const spentToday = spend => (Number.isFinite(spend?.ledgerTodayUsd) ? spend.ledgerTodayUsd : spend?.today);

/** One journal run row's outcome counts. Backfilled rows only have raw proposals. */
export function runCounts(row) {
  const outcomes = row.outcomes || [];
  const count = (...statuses) => outcomes.filter(outcome => statuses.includes(outcome.status)).length;
  return {
    changed: count('applied'),
    proposed: row.backfilled ? (row.proposals || []).length : count('proposed'),
    rejected: count('rejected', 'skipped'),
    blocked: count('blocked'),
    asked: (row.questions || []).length,
    suppressed: (row.suppressedQuestions || []).length,
  };
}
