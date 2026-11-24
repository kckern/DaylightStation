/**
 * Pick by typed decisions (3_applications): the edition's step 3 on the
 * decision gateway (Jev, IDecisionGateway) instead of one big chat call.
 *
 * Units are stories, not headlines: one per briefing cluster (cross-outlet
 * coverage of one event) plus one per remaining single headline, after the
 * select filters. Each unit is asked two questions in one `evaluate`:
 *
 *   category  choice over the categories the unit is ELIGIBLE for (its
 *             sources pass the category's `sources` / `exclude`), each
 *             described by its topic, plus `none`.
 *   interest  score on a five-level rubric, lowest first.
 *
 * Ranking is code: value = interest score + a small bonus per extra outlet.
 * A unit joins its chosen category unless `none` has the largest
 * probability. The lead is the highest-valued unit with two or more
 * outlets (any unit when none has), taken out of its category; then each
 * category keeps its top `stories`, with `balance: lean` preferring wider
 * grid-column coverage as a tie-break. `confidence` is never used (erratic in
 * the field); only probabilities and the score.
 *
 * Falls back (returns null) when the gateway is missing or unconfigured, or
 * more than half the calls fail; the caller then uses the chat pick.
 */
import { choice, score, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import { ApplicationError } from '#apps/common/errors/ApplicationError.mjs';
import { mapLimit, withTimeout } from './editionGather.mjs';
import { MATURE_QUESTION, isMature, DEFAULT_THRESHOLD } from './familySafe.mjs';

export const PICK_CONCURRENCY = 8;
export const PICK_TIMEOUT_MS = 20000;
export const OUTLET_BONUS = 0.15;
export const OUTLET_BONUS_MAX = 0.6;

export const INTEREST_LEVELS = Object.freeze([
  'Routine; no lasting consequence',
  'Minor or niche',
  'Notable; worth a paragraph',
  'Major; a significant national or world development',
  'Historic',
]);

const NONE = 'none';

/** Stories from candidates: one unit per cluster, plus each unclustered headline. */
export function buildUnits(candidates) {
  const byCluster = new Map();
  const units = [];
  for (const c of candidates) {
    if (c.clusterId) {
      if (!byCluster.has(c.clusterId)) {
        const unit = { key: `cluster:${c.clusterId}`, members: [] };
        byCluster.set(c.clusterId, unit);
        units.push(unit);
      }
      byCluster.get(c.clusterId).members.push(c);
    } else {
      units.push({ key: `single:${c.id}`, members: [c] });
    }
  }
  return units.map((u) => {
    const lead = u.members[0];
    const sourceIds = [...new Set(u.members.map((m) => m.sourceId))];
    return {
      key: u.key,
      ids: u.members.map((m) => m.id),
      members: u.members,
      title: lead.title,
      blurb: u.members.find((m) => m.desc)?.desc || '',
      sources: [...new Set(u.members.map((m) => m.sourceLabel))],
      sourceIds,
      outlets: sourceIds.length,
      cols: [...new Set(u.members.map((m) => m.col).filter((c) => c != null))],
    };
  });
}

/** The member ids a category may use from this unit (its source limits). */
export function eligibleIds(unit, category) {
  const only = category.sources ? new Set(category.sources) : null;
  const not = new Set(category.exclude || []);
  return unit.members.filter((m) => (!only || only.has(m.sourceId)) && !not.has(m.sourceId)).map((m) => m.id);
}

export function questionsFor(unit, categories, { familySafe = false } = {}) {
  const eligible = categories.filter((c) => eligibleIds(unit, c).length);
  if (!eligible.length) return null;
  const options = Object.fromEntries(eligible.map((c) => [c.id, c.topic ? `${c.label}: ${c.topic}` : c.label]));
  options[NONE] = 'Fits none of these sections';
  return {
    category: choice('Which section of a morning newspaper does this story belong in?', options),
    interest: score('How much does this story matter to a general reader this morning?', [...INTEREST_LEVELS]),
    ...(familySafe ? { mature: MATURE_QUESTION } : {}),
  };
}

export const unitValue = (interest, outlets) => interest + Math.min(OUTLET_BONUS_MAX, OUTLET_BONUS * Math.max(0, outlets - 1));

/** The category a decision assigns, or null when `none` wins. */
export function assignedCategory(answer) {
  const probs = answer?.probabilities || {};
  const entries = Object.entries(probs);
  if (entries.length) {
    const [top] = [...entries].sort((a, b) => b[1] - a[1])[0];
    if (top === NONE) return null;
    if (answer.choice && answer.choice !== NONE) return answer.choice;
    return top;
  }
  return answer?.choice && answer.choice !== NONE ? answer.choice : null;
}

/**
 * @param {object} args
 * @param {object} args.gateway - IDecisionGateway, scoped
 * @param {object[]} args.candidates
 * @param {object[]} args.categories - parsed news.categories
 * @param {boolean} [args.leadEnabled]
 * @returns {Promise<null | { lead, categories, interest: Map<string, number>, units: number, failed: number }>}
 *   null → fall back to the chat pick
 */
export async function decisionPick({ gateway, candidates, categories, leadEnabled = true, familySafe = null, logger = console, logContext = {}, timeoutMs = PICK_TIMEOUT_MS, timing = null }) {
  if (!gateway?.evaluate || (typeof gateway.isConfigured === 'function' && !gateway.isConfigured())) return null;
  const screen = !!familySafe?.enabled;
  const threshold = familySafe?.threshold ?? DEFAULT_THRESHOLD;
  const units = buildUnits(candidates).map((u) => ({ ...u, questions: questionsFor(u, categories, { familySafe: screen }) })).filter((u) => u.questions);
  if (!units.length) return null;

  let failed = 0;
  const mature = [];
  const judged = await mapLimit(units, PICK_CONCURRENCY, async (unit) => {
    try {
      const state = { title: unit.title, blurb: unit.blurb, sources: unit.sources, outlets: unit.outlets };
      const result = await withTimeout(gateway.evaluate(state, unit.questions, { timeout: timeoutMs }), timeoutMs + 1000, 'decision', timing);
      const interest = Number(result?.answers?.interest?.score);
      const category = assignedCategory(result?.answers?.category);
      if (!Number.isFinite(interest)) throw new Error('no interest score');
      if (screen) {
        const answer = result?.answers?.mature;
        // Screening on, no answer: the unit is not cleared, so it is not printed.
        if (!answer || isMature(answer, threshold)) {
          mature.push(unit.title);
          return null;
        }
      }
      return { unit, category, interest, value: unitValue(interest, unit.outlets) };
    } catch (error) {
      failed += 1;
      logger.warn?.('newsreporter.edition.pick.unit_failed', { ...logContext, unit: unit.key, error: error?.message || String(error) });
      return null;
    }
  });
  if (failed > units.length / 2) {
    logger.warn?.('newsreporter.edition.pick.fallback', { ...logContext, reason: 'too_many_failures', units: units.length, failed });
    return null;
  }

  const placed = judged.filter((j) => j && j.category && categories.some((c) => c.id === j.category))
    .sort((a, b) => b.value - a.value);
  const interest = new Map();
  for (const j of placed) for (const id of j.unit.ids) interest.set(id, j.interest);

  // Kept stories so far, in the order they were kept: what a later unit is
  // checked against so one event never prints twice (2026-11-23: NATO's
  // space-defence pledge printed from BBC and France 24 as two World stories).
  const kept = [];
  const sameAsKept = (j) => firstSameEvent({ gateway, unit: j.unit, kept, timeoutMs, timing, logger, logContext });
  let merged = 0;

  let lead = null;
  if (leadEnabled && placed.length) {
    const pickLead = placed.find((j) => j.unit.outlets >= 2) || placed[0];
    lead = [...pickLead.unit.ids];
    kept.push({ unit: pickLead.unit, ids: lead });
    placed.splice(placed.indexOf(pickLead), 1);
  }

  const out = [];
  for (const category of categories) {
    const mine = placed.filter((j) => j.category === category.id);
    if (category.balance === 'lean') {
      mine.sort((a, b) => (Math.round((b.value - a.value) * 100) || (b.unit.cols.length - a.unit.cols.length)));
    }
    const stories = [];
    for (const j of mine) {
      if (stories.length >= category.stories) break;
      const ids = eligibleIds(j.unit, category);
      if (!ids.length) continue;
      const twin = await sameAsKept(j);
      if (twin) {
        // Same event as a story already in the paper: its coverage joins
        // that story (more outlets credited) instead of printing again.
        for (const id of j.unit.ids) if (!twin.ids.includes(id)) twin.ids.push(id);
        merged += 1;
        continue;
      }
      const story = { ids, rank: stories.length + 1, interest: j.interest };
      stories.push(story);
      kept.push({ unit: j.unit, ids: story.ids });
    }
    if (stories.length) out.push({ id: category.id, stories });
  }
  if (!out.length && !lead) {
    throw new ApplicationError('edition pick left every category empty', { code: 'EDITION_PICK_EMPTY' });
  }
  if (merged) logger.info?.('newsreporter.edition.pick.merged_duplicates', { ...logContext, merged });
  if (mature.length) logger.info?.('newsreporter.edition.family_safe.removed', { ...logContext, stage: 'pick', removed: mature });
  return { lead, categories: out, interest, unknownIds: [], disallowed: [], units: units.length, failed, merged, mature };
}

const STOP = new Set(['about', 'after', 'again', 'against', 'amid', 'before', 'being', 'from', 'have', 'into', 'more', 'over', 'says', 'said', 'than', 'that', 'their', 'there', 'they', 'this', 'what', 'when', 'will', 'with', 'would', 'your']);

/** Content words of a title (4+ letters, lowercased, crude plural/-ce folding). */
export function contentWords(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, '').replace(/ce$/, 'se')));
}

/** Cheap prefilter: only pairs sharing two content words are worth a model call. */
export function mightBeSameEvent(a, b) {
  const wa = contentWords(`${a.title} ${a.blurb}`);
  let shared = 0;
  for (const w of contentWords(`${b.title} ${b.blurb}`)) if (wa.has(w) && ++shared >= 2) return true;
  return false;
}

const SAME_EVENT = {
  same: yesNo(
    'Do stories `a` and `b` report the same specific news event (the same incident, announcement, ruling, or result), not merely the same topic, people, or ongoing story?',
    { yes: 'Both are covering one specific event.', no: 'Different events, or only the same broad topic or people.' }),
};

/** The kept story `unit` duplicates, or null. A failed call counts as "different". */
export async function firstSameEvent({ gateway, unit, kept, timeoutMs = PICK_TIMEOUT_MS, timing = null, logger = console, logContext = {} }) {
  const suspects = kept.filter((k) => mightBeSameEvent(k.unit, unit));
  if (!suspects.length) return null;
  const verdicts = await Promise.all(suspects.map(async (k) => {
    try {
      const state = { a: { title: k.unit.title, blurb: k.unit.blurb }, b: { title: unit.title, blurb: unit.blurb } };
      const result = await withTimeout(gateway.evaluate(state, SAME_EVENT, { timeout: timeoutMs }), timeoutMs + 1000, 'decision', timing);
      return Number(result?.answers?.same?.probability) > 0.5;
    } catch (error) {
      logger.warn?.('newsreporter.edition.pick.same_event_failed', { ...logContext, unit: unit.key, error: error?.message || String(error) });
      return false;
    }
  }));
  return suspects.find((_, i) => verdicts[i]) || null;
}

export default decisionPick;
