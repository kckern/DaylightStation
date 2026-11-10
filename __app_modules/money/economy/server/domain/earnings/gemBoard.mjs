/**
 * The Gem Board: every learner against every gem, for one week. Pure — the
 * caller hands in the week's priced preview (`EarningsPreviewService.roster`)
 * and each learner's lifetime gem counts from the ledger; nothing here reads
 * a clock or a file. Design: ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md.
 *
 * A board ROW is a gem category: the rules that pay gems (or name a `gem`
 * block), placed by `gem.category`, else the default row for the rule's
 * activity or kind (reading, piano, racing, …), else the rule id. A row lists
 * the rules folded into it as `parts`. Rows keep the rules' order and sit in
 * sections (`groups`: Move / Games / School, or a slug a rule names with
 * `gem.group`). Columns are the learners in roster order — never ranked.
 *
 * Totals per learner: `week` is what they HOLD this week (earned, plus a
 * contest gem while they lead it — the agenda card's figure), `earned` only
 * what is earned, `lifetime` what the ledger has paid (the wallet's gems).
 *
 * A cell's state, best first when a row has several rules:
 *   won       a contest gem, decided and theirs
 *   earned    a weekly gem paid (or owed) this week
 *   leading   a contest gem they lead, not yet decided
 *   pending   a weekly gem still reachable (`progress` says how far)
 *   unknown   the evidence could not be read — never shown as missed
 *   none      not this week
 *   disabled  the rule is off for this learner
 *
 * A cell also carries `parts`, one per rule in the row (its own state, this
 * week's and lifetime gems, the days that counted, the milestone items paid,
 * a contest score), and `streak`: the pending day-count nearest done, as
 * `{have, need, left, reach, ruleId}`. `left` is the study days still usable
 * (today included unless it already counted) and `reach` says whether the
 * rest fits: `on-track`, `tight` (every day left is needed) or `out`. A cell
 * can be `earned` and still carry a streak when its row folds two rules.
 */

/** Gem colour by rule kind when a rule names none — provenance (taxonomy D12). */
export const GEM_KIND_COLORS = Object.freeze({
  'week-met': '#d6304a',     // ruby: a green school week
  'ring-contest': '#1e88e5', // sapphire: the ring contest
  'ring-days': '#8e5bd0',    // amethyst: exercise
  'debrief-week': '#e0a030', // topaz: the debrief week
});
/** …and by the activity an achievement rule names. */
export const GEM_ACTIVITY_COLORS = Object.freeze({
  'piano-practice': '#e0457b', 'piano-rung': '#e0457b',          // rose: piano
  'card-goal': '#2bb3a3', 'cards-mastered': '#2bb3a3',          // turquoise: flashcards
  'story-read': '#f2c94c', 'book-finished': '#f2c94c',          // citrine: reading
  'perfect-sheet': '#d6304a',                                    // ruby: schoolwork
  race: '#ff7a2f', 'race-pb': '#ff7a2f',                          // fire opal: cycling
  'glider-act': '#4fc3f7', 'glider-bells': '#4fc3f7',            // aquamarine: Skyline Glider
  'board-game-level': '#9e9e9e',                                  // diamond: board games
  'ring-improved': '#8e5bd0', 'rings-lifetime': '#8e5bd0',        // amethyst: exercise
});
const DEFAULT_COLOR = '#1e88e5';

const CADENCE = Object.freeze({ 'ring-contest': 'contest', 'activity-contest': 'contest', milestone: 'milestone' });
const CONTEST_KINDS = new Set(['ring-contest', 'activity-contest']);
const STATE_ORDER = ['won', 'earned', 'leading', 'pending', 'unknown', 'none', 'disabled'];

const paysGems = (rule) => (rule.reward?.gems ?? 0) > 0
  || (rule.thresholds ?? []).some((t) => (t.reward?.gems ?? 0) > 0);

/** The board's sections, in display order. A rule may name another with `gem.group`. */
export const GEM_GROUPS = Object.freeze([
  Object.freeze({ id: 'move', label: 'Move' }),
  Object.freeze({ id: 'games', label: 'Games' }),
  Object.freeze({ id: 'school', label: 'School' }),
]);
const DEFAULT_GROUP = 'school';

const defaultRow = (category, label, group) => Object.freeze({ category, label, group });
const PIANO = defaultRow('piano', 'Piano', 'school');
const FLASHCARDS = defaultRow('flashcards', 'Flashcards', 'school');
const READING = defaultRow('reading', 'Reading', 'school');
const RACING = defaultRow('racing', 'Racing', 'games');
const GLIDER = defaultRow('skyline-glider', 'Skyline Glider', 'games');
const RING_CONTESTS = defaultRow('ring-contests', 'Ring contests', 'move');
/** Where a rule sits on the board when its `gem` block does not say. */
const ROW_BY_ACTIVITY = Object.freeze({
  'piano-practice': PIANO, 'piano-rung': PIANO,
  'card-goal': FLASHCARDS, 'cards-mastered': FLASHCARDS,
  'story-read': READING, 'book-finished': READING,
  race: RACING, 'race-pb': RACING,
  'glider-act': GLIDER, 'glider-bells': GLIDER,
  'ring-improved': RING_CONTESTS,
  'board-game-level': Object.freeze({ group: 'games' }),
  'rings-lifetime': Object.freeze({ group: 'move' }),
});
const ROW_BY_KIND = Object.freeze({
  'ring-contest': RING_CONTESTS,
  'ring-days': Object.freeze({ group: 'move' }),
});

/**
 * The board's rows, in rule order:
 * `[{id, label, cadence, group, color, ruleIds, parts: [{ruleId, label, cadence}]}]`.
 * A merged row takes its label, cadence, group and colour from its first rule.
 */
export function gemCategories(ruleset) {
  const rows = new Map();
  for (const rule of ruleset?.rules ?? []) {
    if (!rule.gem && !paysGems(rule)) continue;
    const fallback = ROW_BY_ACTIVITY[rule.match?.activity] ?? ROW_BY_KIND[rule.kind] ?? {};
    // A named category is the household's own row: the default label is not its label.
    const usesDefaultRow = !rule.gem?.category && fallback.category;
    const id = rule.gem?.category ?? fallback.category ?? rule.id;
    const cadence = CADENCE[rule.kind] ?? 'weekly';
    const part = { ruleId: rule.id, label: rule.label ?? rule.id, cadence };
    const existing = rows.get(id);
    if (existing) { existing.ruleIds.push(rule.id); existing.parts.push(part); continue; }
    rows.set(id, {
      id,
      label: rule.gem?.label ?? (usesDefaultRow ? fallback.label : null) ?? rule.label ?? rule.id,
      cadence,
      group: rule.gem?.group ?? fallback.group ?? DEFAULT_GROUP,
      color: rule.gem?.color ?? GEM_ACTIVITY_COLORS[rule.match?.activity] ?? GEM_KIND_COLORS[rule.kind] ?? DEFAULT_COLOR,
      ruleIds: [rule.id],
      parts: [part],
    });
  }
  return [...rows.values()];
}

function lineState(line) {
  const contest = CONTEST_KINDS.has(line.kind);
  switch (line.status) {
    case 'earned': return (line.amount?.gems ?? 0) > 0 ? (contest ? 'won' : 'earned') : 'none';
    case 'pending': return contest ? (line.leader ? 'leading' : 'none') : 'pending';
    case 'indeterminate': return 'unknown';
    case 'disabled': return 'disabled';
    default: return 'none';
  }
}

const better = (a, b) => (STATE_ORDER.indexOf(a) <= STATE_ORDER.indexOf(b) ? a : b);

const DAY_MS = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const COUNTED = new Set(['done', 'moved']);
const DAY_COUNT_KINDS = new Set(['ring-days', 'activity-days']);

/** The last study day a day-count rule can still be worked on. */
function lastDayFor(kind, windows) {
  const school = windows?.school;
  if (!school?.from || !school?.to) return null;
  return kind === 'ring-days' ? addDays(school.from, 5) : school.to; // rings close Saturday
}

/** Study days still usable, today included unless it already counted. */
function daysLeft(today, lastDay, countedDays) {
  if (!today || !lastDay || today > lastDay) return 0;
  const span = Math.round((Date.parse(lastDay) - Date.parse(today)) / DAY_MS) + 1;
  return countedDays.includes(today) ? span - 1 : span;
}

function reachOf(progress, left) {
  const short = progress.need - progress.have;
  if (short <= 0) return null;
  return short > left ? 'out' : short === left ? 'tight' : 'on-track';
}

/** One rule's share of a cell: what the detail box shows. */
function partOf(meta, line, lifetime, week) {
  const state = line ? lineState(line) : 'none';
  const evidence = line?.evidence ?? [];
  // Days only for the day-count rules: other kinds' evidence carries school
  // verdicts per day, which are not "a day that counted" and must not read as short.
  const days = DAY_COUNT_KINDS.has(line?.kind)
    ? evidence.filter((e) => e.day).map((e) => ({ day: e.day, state: COUNTED.has(e.state) ? 'done' : 'short' }))
    : [];
  const items = evidence.filter((e) => e.key != null && e.state === 'paid')
    .map((e) => ({ day: e.day, label: e.label ?? null }));
  const scored = evidence.find((e) => Number.isFinite(e.score));
  const progress = line?.progress ?? null;
  let left = null;
  let reach = null;
  if (state === 'pending' && progress) {
    left = daysLeft(week?.today, lastDayFor(line.kind, week?.windows), days.filter((d) => d.state === 'done').map((d) => d.day));
    reach = reachOf(progress, left);
  }
  const earned = line?.status === 'earned' ? line.amount?.gems ?? 0 : 0;
  return {
    ...meta, state, week: earned, lifetime: Math.max(lifetime ?? 0, earned),
    progress, left, reach, days, items,
    score: scored ? { mine: scored.score, best: scored.best ?? null } : null,
    note: line?.note ?? null,
  };
}

function cell(row, learner, lifetimeByRule, week) {
  const lines = (learner.lines ?? []).filter((l) => row.ruleIds.includes(l.ruleId));
  let state = null;
  let weekGems = 0;
  let held = 0; // weekGems, plus a contest gem while they lead it (the agenda's "held")
  let progress = null;
  let note = null;
  for (const line of lines) {
    const s = lineState(line);
    state = state == null ? s : better(s, state);
    if (line.status === 'earned') weekGems += line.amount?.gems ?? 0;
    if (line.status === 'earned' || s === 'leading') held += line.amount?.gems ?? 0;
    if (!progress && line.progress && s === 'pending') progress = line.progress;
    if (s === state) note = line.note ?? null;
  }
  const lifetime = row.ruleIds.reduce((sum, id) => sum + (lifetimeByRule?.[id] ?? 0), 0);
  const parts = row.parts.map((meta) => partOf(
    meta, lines.find((l) => l.ruleId === meta.ruleId), lifetimeByRule?.[meta.ruleId], week,
  ));
  // The ring: the pending day-count nearest done.
  const running = parts.filter((p) => p.state === 'pending' && p.progress)
    .sort((a, b) => b.progress.have / b.progress.need - a.progress.have / a.progress.need)[0];
  const streak = running
    ? { have: running.progress.have, need: running.progress.need, left: running.left, reach: running.reach, ruleId: running.ruleId }
    : null;
  return { state: state ?? 'none', progress, week: weekGems, held, lifetime: Math.max(lifetime, weekGems), note, streak, parts };
}

/** The sections that have rows: the known ones in order, then any the config named. */
function boardGroups(rows) {
  const used = [...new Set(rows.map((r) => r.group))];
  const known = GEM_GROUPS.filter((g) => used.includes(g.id));
  const custom = used.filter((id) => !GEM_GROUPS.some((g) => g.id === id))
    .map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ') }));
  return [...known, ...custom];
}

/**
 * @param {object} args
 * @param {object} args.ruleset - validated
 * @param {{windows, contestClosed, rulesRevision, today, learners: object[]}} args.week - the preview roster
 * @param {Record<string, {byRule: Record<string, number>, total: number|null}>} [args.lifetime]
 *   per learner: gems ever paid by each rule (payout entries), and the wallet's gem balance
 * @param {string} [args.mode] - the catalog mode
 */
export function buildGemBoard({ ruleset, week, lifetime = {}, mode = 'live' }) {
  const rows = gemCategories(ruleset);
  const learners = (week?.learners ?? []).map((l) => ({ learnerId: l.learnerId, name: l.learnerName ?? l.learnerId }));
  const cells = {};
  for (const row of rows) {
    cells[row.id] = {};
    for (const learner of week?.learners ?? []) {
      cells[row.id][learner.learnerId] = cell(row, learner, lifetime[learner.learnerId]?.byRule, week);
    }
  }
  const totals = {};
  for (const { learnerId } of learners) {
    const weekGems = rows.reduce((sum, row) => sum + cells[row.id][learnerId].week, 0);
    const heldGems = rows.reduce((sum, row) => sum + cells[row.id][learnerId].held, 0);
    const rowsLifetime = rows.reduce((sum, row) => sum + cells[row.id][learnerId].lifetime, 0);
    const wallet = lifetime[learnerId]?.total;
    // `week` is what the child HOLDS this week — earned, plus a contest gem
    // while they lead it — the same figure as the agenda card's gem count.
    // `lifetime` counts only what was paid.
    totals[learnerId] = { week: heldGems, earned: weekGems, lifetime: Number.isFinite(wallet) ? Math.max(wallet, weekGems) : rowsLifetime };
  }
  return {
    mode,
    week: week?.windows?.school?.from ?? null,
    windows: week?.windows ?? null,
    today: week?.today ?? null,
    contestClosed: Boolean(week?.contestClosed),
    rulesRevision: week?.rulesRevision ?? ruleset?.revision ?? null,
    learners,
    groups: boardGroups(rows),
    categories: rows.map(({ ruleIds, ...row }) => row),
    cells,
    totals,
  };
}

/**
 * Gems each rule has ever paid a learner, from their ledger: payout entries
 * in gems by `ruleId`, less any grown-up reversal of one (`reverse:<ref>`).
 */
export function lifetimeGemsByRule(transactions, { isPayoutEntry, paidRefOf }) {
  const ruleOfRef = new Map();
  const byRule = {};
  for (const t of transactions ?? []) {
    if ((t.currency ?? 'silver') !== 'gems' || !isPayoutEntry(t) || !t.ruleId) continue;
    ruleOfRef.set(t.ref, t.ruleId);
    byRule[t.ruleId] = (byRule[t.ruleId] ?? 0) + (t.delta || 0);
  }
  for (const t of transactions ?? []) {
    if ((t.currency ?? 'silver') !== 'gems' || t.kind !== 'adjust') continue;
    const ruleId = ruleOfRef.get(paidRefOf(t));
    if (ruleId) byRule[ruleId] = Math.max(0, (byRule[ruleId] ?? 0) + (t.delta || 0));
  }
  return byRule;
}
