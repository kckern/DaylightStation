/**
 * Earn rules: what the household pays in silver (and gems) for which evidence.
 * Pure — validation, defaults and per-learner resolution; no I/O, no clock.
 *
 * Vocabulary: docs/_wip/plans/2026-09-14-household-economy-taxonomy.md §5.
 * Design: docs/_wip/plans/2026-09-26-school-economy-earnings-preview.md.
 *
 * Seven kinds, one per earning trigger (scope × period):
 *   unit            each served unit matching the selector        School × Unit
 *   section-day     each day the matched section was served        School × Day, one subject
 *   section-week    every obligated day that week served           School × Week, one subject
 *   day-met         each term-grid day `met`                       School × Day
 *   week-met        the week row `met`                             School × Week
 *   ring-threshold  `rate` silver per N rings + each threshold crossed (award week) Fitness × Week (absolute)
 *   ring-contest    most rings in the roster at award-week close   Fitness × Week (relative)
 *
 * A rule that pays twice is two rules: there is no `bonus`.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export const RULE_KINDS = Object.freeze(['unit', 'section-day', 'section-week', 'day-met', 'week-met', 'ring-threshold', 'ring-contest']);
export const CURRENCIES = Object.freeze(['silver', 'gems']);
const SECTION_KINDS = new Set(['section-day', 'section-week']);
const TIES = new Set(['all', 'split', 'none']);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MULTIPLIER = 10;

/**
 * The starting rules — placeholder rates (the owner has not fixed them yet),
 * shaped after the 2026-09-26 brief: Korean pays every day it is done;
 * scripture pays only a whole week; a green day and a green week pay on top;
 * rings pay per ring with thresholds, plus a weekly contest.
 */
export const DEFAULT_RULESET = Object.freeze({
  revision: 0,
  currency: 'silver',
  rules: [
    { id: 'korean-daily', label: 'Korean (each day done)', kind: 'section-day', match: { subject: 'language' }, reward: { silver: 2 } },
    { id: 'scripture-week', label: 'Scripture (whole week)', kind: 'section-week', match: { subject: 'scripture' }, reward: { silver: 5 } },
    { id: 'piano-daily', label: 'Piano (each day done)', kind: 'section-day', match: { subject: 'arts' }, reward: { silver: 1 } },
    { id: 'reading-daily', label: 'Reading (each day done)', kind: 'section-day', match: { subject: 'english' }, reward: { silver: 1 } },
    { id: 'green-day', label: 'Green day', kind: 'day-met', reward: { silver: 1 } },
    { id: 'green-week', label: 'Green week', kind: 'week-met', reward: { silver: 5, gems: 1 } },
    // Rings run large (hundreds a week), so the rate is a ratio.
    { id: 'rings', label: 'Rings', kind: 'ring-threshold', rate: { rings: 100, silver: 1 }, thresholds: [{ at: 250, reward: { silver: 2 } }, { at: 500, reward: { silver: 3 } }, { at: 1000, reward: { silver: 5 } }] },
    { id: 'ring-contest', label: 'Most rings this week', kind: 'ring-contest', tie: 'all', reward: { silver: 5, gems: 1 } },
  ],
  users: {},
});

function fail(message, field) {
  throw new ValidationError(message, { code: 'INVALID_EARN_RULES', field });
}

function nonNegativeInt(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) fail(`${field} must be a whole number from 0 to 10000`, field);
  return value;
}

/** `2` or `{silver: 2, gems: 1}` → `{silver, gems}`. */
export function normalizeReward(reward, field = 'reward') {
  if (typeof reward === 'number') return { silver: nonNegativeInt(reward, field), gems: 0 };
  if (!reward || typeof reward !== 'object' || Array.isArray(reward)) fail(`${field} must be a number or {silver, gems}`, field);
  for (const key of Object.keys(reward)) if (!CURRENCIES.includes(key)) fail(`${field} has an unknown currency "${key}"`, field);
  return { silver: nonNegativeInt(reward.silver ?? 0, `${field}.silver`), gems: nonNegativeInt(reward.gems ?? 0, `${field}.gems`) };
}

/** `{rings: N, silver: M}` — M silver per whole N rings. */
function normalizeRate(rate, field) {
  if (rate == null) return { rings: 1, silver: 0 };
  if (typeof rate !== 'object' || Array.isArray(rate)) fail(`${field} must be {rings, silver}`, field);
  if (!Number.isInteger(rate.rings) || rate.rings <= 0) fail(`${field}.rings must be a positive whole number`, field);
  return { rings: rate.rings, silver: nonNegativeInt(rate.silver ?? 0, `${field}.silver`) };
}

function normalizeThresholds(list, field) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail(`${field} must be a list`, field);
  const out = list.map((t, i) => {
    if (!Number.isInteger(t?.at) || t.at <= 0) fail(`${field}[${i}] threshold "at" must be a positive whole number`, field);
    return { at: t.at, reward: normalizeReward(t.reward, `${field}[${i}].reward`) };
  }).sort((a, b) => a.at - b.at);
  if (new Set(out.map((t) => t.at)).size !== out.length) fail(`${field} has a repeated threshold`, field);
  return out;
}

function normalizeMatch(match, field) {
  if (match == null) return {};
  if (typeof match !== 'object' || Array.isArray(match)) fail(`${field} must be an object`, field);
  const out = {};
  for (const key of ['subject', 'courseId', 'unitId']) {
    if (match[key] == null) continue;
    if (typeof match[key] !== 'string' || !match[key]) fail(`${field}.${key} must be a string`, field);
    out[key] = match[key];
  }
  return out;
}

function normalizeEffective(effective, field) {
  if (effective == null) return null;
  const out = {};
  for (const key of ['from', 'to']) {
    if (effective[key] == null) continue;
    if (!DAY.test(effective[key])) fail(`${field}.${key} must be YYYY-MM-DD`, field);
    out[key] = effective[key];
  }
  return Object.keys(out).length ? out : null;
}

function normalizeRule(rule, i) {
  const field = `rules[${i}]`;
  if (!rule || typeof rule !== 'object') fail(`${field} must be an object`, field);
  if (!ID.test(rule.id ?? '')) fail(`${field}.id must be a lowercase slug`, `${field}.id`);
  if (!RULE_KINDS.includes(rule.kind)) fail(`${field}.kind must be one of ${RULE_KINDS.join(', ')}`, `${field}.kind`);
  const match = normalizeMatch(rule.match, `${field}.match`);
  if (SECTION_KINDS.has(rule.kind) && !match.subject) fail(`${field} (${rule.kind}) needs match.subject`, `${field}.match`);
  const out = {
    id: rule.id,
    label: typeof rule.label === 'string' && rule.label.trim() ? rule.label.trim() : rule.id,
    kind: rule.kind,
    match,
    reward: rule.kind === 'ring-threshold' && rule.reward == null ? { silver: 0, gems: 0 } : normalizeReward(rule.reward, `${field}.reward`),
  };
  const effective = normalizeEffective(rule.effective, `${field}.effective`);
  if (effective) out.effective = effective;
  if (rule.kind === 'ring-threshold') {
    out.rate = normalizeRate(rule.rate, `${field}.rate`);
    out.thresholds = normalizeThresholds(rule.thresholds, `${field}.thresholds`);
  }
  if (rule.kind === 'ring-contest') {
    const tie = rule.tie ?? 'all';
    if (!TIES.has(tie)) fail(`${field}.tie must be all, split or none`, `${field}.tie`);
    out.tie = tie;
  }
  return out;
}

function normalizeUsers(users, ruleIds) {
  if (users == null) return {};
  if (typeof users !== 'object' || Array.isArray(users)) fail('users must be an object keyed by learner', 'users');
  const out = {};
  for (const [learnerId, entry] of Object.entries(users)) {
    const field = `users.${learnerId}`;
    if (!entry || typeof entry !== 'object') fail(`${field} must be an object`, field);
    const user = {};
    if (entry.multiplier != null) {
      if (typeof entry.multiplier !== 'number' || !(entry.multiplier > 0) || entry.multiplier > MAX_MULTIPLIER) {
        fail(`${field}.multiplier must be above 0 and at most ${MAX_MULTIPLIER}`, `${field}.multiplier`);
      }
      user.multiplier = entry.multiplier;
    }
    const rules = {};
    for (const [ruleId, override] of Object.entries(entry.rules ?? {})) {
      if (!ruleIds.has(ruleId)) fail(`${field}.rules names an unknown rule "${ruleId}"`, `${field}.rules`);
      const o = {};
      if (override?.reward != null) o.reward = normalizeReward(override.reward, `${field}.rules.${ruleId}.reward`);
      if (override?.rate != null) o.rate = normalizeRate(override.rate, `${field}.rules.${ruleId}.rate`);
      if (override?.thresholds != null) o.thresholds = normalizeThresholds(override.thresholds, `${field}.rules.${ruleId}.thresholds`);
      if (override?.disabled != null) o.disabled = override.disabled === true;
      if (Object.keys(o).length) rules[ruleId] = o;
    }
    if (Object.keys(rules).length) user.rules = rules;
    out[learnerId] = user;
  }
  return out;
}

/**
 * Validate and normalize a ruleset document. Throws ValidationError naming the field.
 * @returns {{revision:number, revisedAt:string|null, revisedBy:string|null, currency:'silver', rules:object[], users:object}}
 */
export function validateRuleset(doc) {
  if (!doc || typeof doc !== 'object') fail('earn rules must be an object', null);
  if (!Array.isArray(doc.rules)) fail('rules must be a list', 'rules');
  const rules = doc.rules.map(normalizeRule);
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) fail(`duplicate rule id "${rule.id}"`, 'rules');
    ids.add(rule.id);
  }
  return {
    revision: Number.isInteger(doc.revision) && doc.revision >= 0 ? doc.revision : 0,
    revisedAt: doc.revisedAt ?? null,
    revisedBy: doc.revisedBy ?? null,
    currency: 'silver',
    rules,
    users: normalizeUsers(doc.users, ids),
  };
}

/**
 * The rules as they apply to one learner: household rule + that learner's
 * override, with the learner's multiplier. Most specific wins.
 */
export function resolveRules(ruleset, learnerId) {
  const user = ruleset.users?.[learnerId] ?? {};
  const multiplier = user.multiplier ?? 1;
  return ruleset.rules.map((rule) => {
    const o = user.rules?.[rule.id] ?? {};
    return {
      ...rule,
      ...(o.reward ? { reward: o.reward } : {}),
      ...(o.rate ? { rate: o.rate } : {}),
      ...(o.thresholds ? { thresholds: o.thresholds } : {}),
      multiplier,
      disabled: o.disabled === true,
      overridden: Object.keys(o).length > 0,
    };
  });
}

/**
 * Set (or clear, with `null`) one learner's override. Pure: returns a new,
 * validated ruleset; the caller stores it as the next revision.
 * @param {object} patch - `{multiplier?, rules?: {<ruleId>: {reward?, rate?, thresholds?, disabled?}|null}}`
 */
export function withUserOverride(ruleset, learnerId, patch) {
  if (!learnerId || typeof learnerId !== 'string') fail('learnerId is required', 'learnerId');
  const current = ruleset.users?.[learnerId] ?? {};
  const next = { ...current, rules: { ...(current.rules ?? {}) } };
  if (patch && 'multiplier' in patch) {
    if (patch.multiplier == null || patch.multiplier === 1) delete next.multiplier;
    else next.multiplier = patch.multiplier;
  }
  for (const [ruleId, override] of Object.entries(patch?.rules ?? {})) {
    if (override == null) delete next.rules[ruleId];
    else next.rules[ruleId] = { ...(next.rules[ruleId] ?? {}), ...override };
  }
  if (!Object.keys(next.rules).length) delete next.rules;
  const users = { ...ruleset.users };
  if (Object.keys(next).length) users[learnerId] = next; else delete users[learnerId];
  return validateRuleset({ ...ruleset, users });
}
