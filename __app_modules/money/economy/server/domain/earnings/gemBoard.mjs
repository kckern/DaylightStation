/**
 * The Gem Board: every learner against every gem, for one week. Pure — the
 * caller hands in the week's priced preview (`EarningsPreviewService.roster`)
 * and each learner's lifetime gem counts from the ledger; nothing here reads
 * a clock or a file. Design: ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md.
 *
 * A board ROW is a gem category: a rule that pays gems (or names a `gem`
 * block), grouped by `gem.category` (default: the rule id). Rows keep the
 * rules' order. Columns are the learners in roster order — never ranked.
 *
 * A cell's state, best first when a row has several rules:
 *   won       a contest gem, decided and theirs
 *   earned    a weekly gem paid (or owed) this week
 *   leading   a contest gem they lead, not yet decided
 *   pending   a weekly gem still reachable (`progress` says how far)
 *   unknown   the evidence could not be read — never shown as missed
 *   none      not this week
 *   disabled  the rule is off for this learner
 */

/** Gem colour by rule kind when a rule names none — provenance (taxonomy D12). */
export const GEM_KIND_COLORS = Object.freeze({
  'week-met': '#d6304a',     // ruby: a green school week
  'ring-contest': '#1e88e5', // sapphire: the ring contest
  'ring-days': '#8e5bd0',    // amethyst: exercise
  'debrief-week': '#e0a030', // topaz: the debrief week
});
const DEFAULT_COLOR = '#1e88e5';

const CADENCE = Object.freeze({ 'ring-contest': 'contest' });
const STATE_ORDER = ['won', 'earned', 'leading', 'pending', 'unknown', 'none', 'disabled'];

const paysGems = (rule) => (rule.reward?.gems ?? 0) > 0
  || (rule.thresholds ?? []).some((t) => (t.reward?.gems ?? 0) > 0);

/** The board's rows, in rule order: `[{id, label, cadence, color, ruleIds}]`. */
export function gemCategories(ruleset) {
  const rows = new Map();
  for (const rule of ruleset?.rules ?? []) {
    if (!rule.gem && !paysGems(rule)) continue;
    const id = rule.gem?.category ?? rule.id;
    const row = rows.get(id);
    if (row) { row.ruleIds.push(rule.id); continue; }
    rows.set(id, {
      id,
      label: rule.gem?.label ?? rule.label ?? rule.id,
      cadence: CADENCE[rule.kind] ?? 'weekly',
      color: rule.gem?.color ?? GEM_KIND_COLORS[rule.kind] ?? DEFAULT_COLOR,
      ruleIds: [rule.id],
    });
  }
  return [...rows.values()];
}

function lineState(line) {
  const contest = line.kind === 'ring-contest';
  switch (line.status) {
    case 'earned': return (line.amount?.gems ?? 0) > 0 ? (contest ? 'won' : 'earned') : 'none';
    case 'pending': return contest ? (line.leader ? 'leading' : 'none') : 'pending';
    case 'indeterminate': return 'unknown';
    case 'disabled': return 'disabled';
    default: return 'none';
  }
}

const better = (a, b) => (STATE_ORDER.indexOf(a) <= STATE_ORDER.indexOf(b) ? a : b);

function cell(row, learner, lifetimeByRule) {
  const lines = (learner.lines ?? []).filter((l) => row.ruleIds.includes(l.ruleId));
  let state = null;
  let week = 0;
  let progress = null;
  let note = null;
  for (const line of lines) {
    const s = lineState(line);
    state = state == null ? s : better(s, state);
    if (line.status === 'earned') week += line.amount?.gems ?? 0;
    if (!progress && line.progress && s === 'pending') progress = line.progress;
    if (s === state) note = line.note ?? null;
  }
  const lifetime = row.ruleIds.reduce((sum, id) => sum + (lifetimeByRule?.[id] ?? 0), 0);
  return { state: state ?? 'none', progress, week, lifetime: Math.max(lifetime, week), note };
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
      cells[row.id][learner.learnerId] = cell(row, learner, lifetime[learner.learnerId]?.byRule);
    }
  }
  const totals = {};
  for (const { learnerId } of learners) {
    const weekGems = rows.reduce((sum, row) => sum + cells[row.id][learnerId].week, 0);
    const rowsLifetime = rows.reduce((sum, row) => sum + cells[row.id][learnerId].lifetime, 0);
    const wallet = lifetime[learnerId]?.total;
    totals[learnerId] = { week: weekGems, lifetime: Number.isFinite(wallet) ? Math.max(wallet, weekGems) : rowsLifetime };
  }
  return {
    mode,
    week: week?.windows?.school?.from ?? null,
    windows: week?.windows ?? null,
    today: week?.today ?? null,
    contestClosed: Boolean(week?.contestClosed),
    rulesRevision: week?.rulesRevision ?? ruleset?.revision ?? null,
    learners,
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
