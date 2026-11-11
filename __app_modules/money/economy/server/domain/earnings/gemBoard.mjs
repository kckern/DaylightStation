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
 * week's and lifetime gems, its colour, the days that counted, `lastDay` (the
 * last day a day-count can be worked on, else null), the milestone
 * items paid, a contest `score` — see `contestScore`), and `streak`: the pending day-count nearest done, as
 * `{have, need, left, reach, ruleId}`. `left` is the study days still usable
 * (from today or the week's first day, whichever is later, to the rule's last
 * day, inside its `effective` dates; today is out once it counted) and `reach` says whether the
 * rest fits: `on-track`, `tight` (every day left is needed) or `out`. A cell
 * can be `earned` and still carry a streak when its row folds two rules.
 */

/**
 * The three areas a gem can belong to. A gem's colour and icon come ONLY from
 * its area, so on an unlabeled overview its look always means the same thing.
 * Order everywhere: Move, School, Games.
 */
export const GEM_AREAS = Object.freeze({
  move: Object.freeze({ label: 'Move', color: '#1e88e5', icon: 'move' }),       // sapphire
  school: Object.freeze({ label: 'School', color: '#f2c94c', icon: 'school' }), // citrine
  games: Object.freeze({ label: 'Games', color: '#2e9e5b', icon: 'games' }),    // emerald
});
export const AREA_ORDER = Object.freeze(['move', 'school', 'games']);

const CADENCE = Object.freeze({ 'ring-contest': 'contest', 'activity-contest': 'contest', milestone: 'milestone' });
const CONTEST_KINDS = new Set(['ring-contest', 'activity-contest']);
const STATE_ORDER = ['won', 'earned', 'leading', 'pending', 'unknown', 'none', 'disabled'];

const paysGems = (rule) => (rule.reward?.gems ?? 0) > 0
  || (rule.thresholds ?? []).some((t) => (t.reward?.gems ?? 0) > 0);

/** The board's sections, in display order. A rule may name another with `gem.group`. */
export const GEM_GROUPS = Object.freeze([
  Object.freeze({ id: 'move', label: 'Move' }),
  Object.freeze({ id: 'school', label: 'School' }),
  Object.freeze({ id: 'games', label: 'Games' }),
]);
const DEFAULT_GROUP = 'school';

const defaultRow = (category, label, group) => Object.freeze({ category, label, group });
const PIANO = defaultRow('piano', 'Piano', 'school');
const FLASHCARDS = defaultRow('flashcards', 'Flashcards', 'school');
const READING = defaultRow('reading', 'Reading', 'school');
const RACING = defaultRow('racing', 'Cycle Race', 'games');
const GLIDER = defaultRow('skyline-glider', 'Skyline Glider', 'games');
const RING_CONTESTS = defaultRow('ring-contests', 'Most Rings', 'move');
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

const onBoard = (rule) => Boolean(rule.gem) || paysGems(rule);
const fallbackRow = (rule) => ROW_BY_ACTIVITY[rule.match?.activity] ?? ROW_BY_KIND[rule.kind] ?? {};
/** A rule's group (see `gem.group`, else the default row's, else School) is its area; a custom slug falls to School. */
const ruleGroup = (rule) => rule.gem?.group ?? fallbackRow(rule).group ?? DEFAULT_GROUP;
const areaOf = (group) => (Object.hasOwn(GEM_AREAS, group) ? group : DEFAULT_GROUP);

/**
 * The board's rows, in rule order:
 * `[{id, label, cadence, group, area, color, ruleIds, parts: [{ruleId, label, cadence, area, color}]}]`.
 * A merged row takes its label, cadence, group and area from its first rule;
 * its colour, and every part's, is the area's (`GEM_AREAS`) — never a rule's.
 *
 * A rule may be NAMED like a default row (`reading`, a school subject's week).
 * That rule keeps its own row; the default merged row then takes `<id>-all`,
 * wherever the two sit in the rules. An explicit `gem.category` is a literal
 * row id and joins whichever row has it.
 */
export function gemCategories(ruleset) {
  const rules = (ruleset?.rules ?? []).filter(onBoard);
  // Row ids that belong to a rule under its own name.
  const ownIds = new Set(rules.filter((r) => !r.gem?.category && !fallbackRow(r).category).map((r) => r.id));
  const rows = new Map();
  for (const rule of rules) {
    const fallback = fallbackRow(rule);
    // A named category is the household's own row: the default label is not its label.
    const usesDefaultRow = !rule.gem?.category && Boolean(fallback.category);
    const defaultId = usesDefaultRow && ownIds.has(fallback.category) ? `${fallback.category}-all` : fallback.category;
    const id = rule.gem?.category ?? defaultId ?? rule.id;
    const cadence = CADENCE[rule.kind] ?? 'weekly';
    const existing = rows.get(id);
    const area = existing?.area ?? areaOf(ruleGroup(rule));
    const part = { ruleId: rule.id, label: rule.label ?? rule.id, cadence, area, color: GEM_AREAS[area].color };
    if (existing) { existing.ruleIds.push(rule.id); existing.parts.push(part); continue; }
    rows.set(id, {
      id,
      label: rule.gem?.label ?? (usesDefaultRow ? fallback.label : null) ?? rule.label ?? rule.id,
      cadence,
      group: ruleGroup(rule),
      area,
      color: part.color,
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
const COUNTED = new Set(['done', 'moved', 'met', 'completed']);
/** Kinds the board draws as a ring of days. */
const DAY_COUNT_KINDS = new Set(['ring-days', 'activity-days', 'week-met', 'debrief-week']);
/**
 * Day-counts that need EVERY owed day (green week, debrief week): one segment
 * per owed day, and every day not yet done is still needed.
 */
const EVERY_DAY_KINDS = new Set(['week-met', 'debrief-week']);
/** A debrief that can no longer be done (late still counts, so only these). */
const DEBRIEF_LOST = new Set(['missed', 'rejected']);

/**
 * One day of a day-count's evidence as the strip draws it: `done`, `short`
 * (a day that went by without it), or null (not drawn: still open, excused).
 * For the every-day kinds a day is short only once it is SETTLED: a green
 * week's day before today that was not green, a debrief that was missed.
 */
function dayMark(kind, e, today) {
  if (COUNTED.has(e.state)) return 'done';
  if (kind === 'week-met') return e.state !== 'exempt' && today != null && e.day < today ? 'short' : null;
  if (kind === 'debrief-week') return DEBRIEF_LOST.has(e.state) ? 'short' : null;
  return 'short';
}

const later = (a, b) => (a && b ? (a > b ? a : b) : a ?? b ?? null);
const earlier = (a, b) => (a && b ? (a < b ? a : b) : a ?? b ?? null);

/**
 * The study days a day-count rule can be worked on: the week, cut to the
 * rule's own `effective` dates. Ring days close Saturday with the award week.
 */
function workingDays(line, windows) {
  const school = windows?.school;
  if (!school?.from || !school?.to) return null;
  // Ring days close Saturday with the award week; green week and debriefs are owed Monday to Friday.
  const weekEnd = line.kind === 'ring-days' ? addDays(school.from, 5) : EVERY_DAY_KINDS.has(line.kind) ? addDays(school.from, 4) : school.to;
  return { from: later(school.from, line.effective?.from), to: earlier(weekEnd, line.effective?.to) };
}

/** Study days still usable, today included unless it already counted. */
function daysLeft(today, span, countedDays) {
  if (!today || !span) return 0;
  const start = later(today, span.from);
  if (start > span.to) return 0;
  const days = Math.round((Date.parse(span.to) - Date.parse(start)) / DAY_MS) + 1;
  return start === today && countedDays.includes(today) ? days - 1 : days;
}

function reachOf(progress, left) {
  const short = progress.need - progress.have;
  if (short <= 0) return null;
  return short > left ? 'out' : short === left ? 'tight' : 'on-track';
}

/** One rule's share of a cell: what the detail box shows. */
function partOf(meta, line, lifetime, week, contestBoard) {
  const state = line ? lineState(line) : 'none';
  const evidence = line?.evidence ?? [];
  // Days only for the day-count rules: other kinds' evidence carries school
  // verdicts per day, which are not "a day that counted" and must not read as short.
  const days = DAY_COUNT_KINDS.has(line?.kind)
    ? evidence.filter((e) => e.day).map((e) => ({ day: e.day, state: dayMark(line.kind, e, week?.today ?? null) })).filter((d) => d.state)
    : [];
  const items = evidence.filter((e) => e.key != null && e.state === 'paid')
    .map((e) => ({ day: e.day, label: e.label ?? null }));
  const score = line ? contestScore(line, contestBoard?.[line.ruleId]) : null;
  const progress = line?.progress ?? null;
  // The span a day-count can be worked on; its end is the part's `lastDay`.
  const span = DAY_COUNT_KINDS.has(line?.kind) ? workingDays(line, week?.windows) : null;
  let left = null;
  let reach = null;
  if (state === 'pending' && progress && EVERY_DAY_KINDS.has(line.kind)) {
    // Every owed day is needed, and each one not done yet can still be (late debriefs count; today is open).
    left = Math.max(0, progress.need - progress.have);
    reach = left > 0 ? 'on-track' : null;
  } else if (state === 'pending' && progress) {
    left = daysLeft(week?.today, span ?? workingDays(line, week?.windows), days.filter((d) => d.state === 'done').map((d) => d.day));
    reach = reachOf(progress, left);
  }
  const earned = line?.status === 'earned' ? line.amount?.gems ?? 0 : 0;
  return {
    ...meta, state, week: earned, lifetime: Math.max(lifetime ?? 0, earned),
    progress, left, reach, lastDay: span?.to ?? null, days, items,
    score,
    note: line?.note ?? null,
  };
}

function cell(row, learner, lifetimeByRule, week, contestBoard) {
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
    meta, lines.find((l) => l.ruleId === meta.ruleId), lifetimeByRule?.[meta.ruleId], week, contestBoard,
  ));
  // The ring: the pending day-count nearest done.
  const running = parts.filter((p) => p.state === 'pending' && p.progress)
    .sort((a, b) => b.progress.have / b.progress.need - a.progress.have / a.progress.need)[0];
  const streak = running
    ? { have: running.progress.have, need: running.progress.need, left: running.left, reach: running.reach, ruleId: running.ruleId }
    : null;
  return { state: state ?? 'none', progress, week: weekGems, held, lifetime: Math.max(lifetime, weekGems), note, streak, parts };
}

/**
 * One learner's entry in a contest, as a child reads it: `raw` ranks it
 * (higher is better — the evaluator's own score), `value` is what is shown in
 * `unit`. Units: `rings` (the ring contest: award-week rings), `rings-vs-usual`
 * (most improved: rings over (+) or under (−) their 4-week average, whole
 * rings), `seconds` / `metres` (a race: the time on a distance course, the
 * distance on a timed one), else `points`. Null when the line has no score.
 */
function contestEntry(line) {
  if (line.kind === 'ring-contest') {
    return line.status !== 'indeterminate' && Number.isFinite(line.count)
      ? { raw: line.count, value: line.count, unit: 'rings', course: null }
      : null;
  }
  if (line.kind !== 'activity-contest') return null;
  const e = (line.evidence ?? []).find((x) => Number.isFinite(x.score));
  if (!e) return null;
  if (Number.isFinite(e.value) && e.unit) return { raw: e.score, value: e.value, unit: e.unit, course: e.course ?? null };
  if (line.match?.activity === 'ring-improved') return { raw: e.score, value: Math.round(e.score), unit: 'rings-vs-usual', course: null };
  return { raw: e.score, value: e.score, unit: 'points', course: null };
}

/**
 * Every contest's standings across the roster, by rule id, best first:
 * `[{learnerId, name, raw, value, unit, course, leader}]`. A leader holds the
 * top score, and only a score above zero leads (the evaluators' own rule).
 */
function contestBoards(learners) {
  const boards = {};
  for (const learner of learners ?? []) {
    for (const line of learner.lines ?? []) {
      if (!CONTEST_KINDS.has(line.kind)) continue;
      const entry = contestEntry(line);
      if (!entry) continue;
      (boards[line.ruleId] ??= []).push({ learnerId: learner.learnerId, name: learner.learnerName ?? learner.learnerId, ...entry });
    }
  }
  for (const list of Object.values(boards)) {
    list.sort((a, b) => b.raw - a.raw);
    const top = list[0]?.raw;
    for (const row of list) row.leader = top > 0 && row.raw === top;
  }
  return boards;
}

/**
 * A contest part's `score`: `mine` / `best` (raw, best only when someone
 * leads), and for display `value` + `unit` + `course` and the roster's
 * `standings` (best first, each `{learnerId, name, value, leader}`).
 */
function contestScore(line, board) {
  const mine = contestEntry(line);
  if (!mine) return null;
  const top = board?.[0]?.raw;
  return {
    mine: mine.raw,
    best: top > 0 ? top : null,
    value: mine.value,
    unit: mine.unit,
    course: mine.course,
    standings: (board ?? []).map(({ learnerId, name, value, leader }) => ({ learnerId, name, value, leader })),
  };
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
  const boards = contestBoards(week?.learners);
  const cells = {};
  for (const row of rows) {
    cells[row.id] = {};
    for (const learner of week?.learners ?? []) {
      cells[row.id][learner.learnerId] = cell(row, learner, lifetime[learner.learnerId]?.byRule, week, boards);
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
