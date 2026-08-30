import moment from 'moment-timezone';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { earliestBoundary, instanceKey, samePeriod, sameSubject } from '../support.mjs';
import { RequirementEvaluation } from '../evaluations/RequirementEvaluation.mjs';
import { EntitlementDecision } from '../evaluations/EntitlementDecision.mjs';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function result(state, reasons = [], extras = {}) {
  return { state, reasons, boundary: extras.boundary ?? null, progress: extras.progress ?? null, raw: extras.raw };
}

function selectorSubject(binding, context) {
  if (!binding || binding === '$subject') return context.subject;
  if (typeof binding === 'string' && binding.startsWith('$')) return context.bindings[binding.slice(1)] ?? null;
  return binding;
}

function selectorPeriod(binding, context) {
  if (!binding || binding === '$period') return context.period;
  return binding;
}

function resolveAssertion(selector, context) {
  const subject = selectorSubject(selector.subject, context);
  const period = selectorPeriod(selector.period, context);
  if (!subject || !period) return result('indeterminate', [{ code: 'CLAIM_MISSING' }]);
  const assertion = context.assertions.find(item => item.claimTypeId === selector.claimTypeId
    && item.publisherId === selector.publisherId && sameSubject(item.subject, subject) && samePeriod(item.period, period));
  if (!assertion || assertion.status !== 'active') return result('indeterminate', [{ code: assertion ? 'CLAIM_RETRACTED' : 'CLAIM_MISSING' }]);
  const claim = context.graph.claimTypes.get(selector.claimTypeId);
  try { claim.validateValue(assertion.value); } catch { return result('indeterminate', [{ code: 'CLAIM_TYPE_CONFLICT' }]); }
  if (assertion.validFrom > context.now) return result('indeterminate', [{ code: 'CLAIM_NOT_YET_VALID' }], { boundary: { at: assertion.validFrom, kind: 'evidence_expiry' } });
  const expiresAt = [assertion.validUntil, claim.validity.maxAgeMs == null ? null : assertion.observedAt + claim.validity.maxAgeMs]
    .filter(Number.isFinite).reduce((min, value) => Math.min(min, value), Infinity);
  if (expiresAt <= context.now) return result('indeterminate', [{ code: 'CLAIM_STALE' }]);
  const boundary = Number.isFinite(expiresAt) ? { at: expiresAt, kind: 'evidence_expiry' } : null;
  return result(null, [], { raw: assertion.value, boundary });
}

function combine(kind, children) {
  const applicable = children.filter(child => child.state !== 'not_applicable');
  if (!applicable.length) return result('not_applicable', [{ code: 'NOT_APPLICABLE' }], { boundary: earliestBoundary(children.map(child => child.boundary)) });
  const precedence = kind === 'all'
    ? ['unsatisfied', 'indeterminate', 'satisfied']
    : ['satisfied', 'indeterminate', 'unsatisfied'];
  const state = precedence.find(candidate => applicable.some(child => child.state === candidate));
  return result(state, applicable.flatMap(child => child.reasons), { boundary: earliestBoundary(children.map(child => child.boundary)) });
}

function comparison(node, context) {
  const resolved = resolveAssertion(node.claim, context);
  if (resolved.state) return resolved;
  const left = resolved.raw;
  const right = node.value;
  let satisfied;
  switch (node.op) {
    case 'eq': satisfied = left === right; break;
    case 'neq': satisfied = left !== right; break;
    case 'lt': satisfied = left < right; break;
    case 'lte': satisfied = left <= right; break;
    case 'gt': satisfied = left > right; break;
    case 'gte': satisfied = left >= right; break;
    case 'in': satisfied = Array.isArray(right) && right.includes(left); break;
    default: throw new ValidationError('Unsupported comparison', { code: 'INVALID_COMPARISON' });
  }
  const claim = context.graph.claimTypes.get(node.claim.claimTypeId);
  const positiveProgress = claim.visibility === 'subscriber' && ['gte', 'gt'].includes(node.op) && Number.isFinite(left) && Number.isFinite(right) && right > 0;
  return result(satisfied ? 'satisfied' : 'unsatisfied', satisfied ? [] : [{ code: 'THRESHOLD_NOT_MET' }], {
    boundary: resolved.boundary,
    progress: positiveProgress ? { current: Math.max(0, left), target: right, unit: node.unit ?? 'count', ratio: Math.max(0, Math.min(1, left / right)), basisNodeId: node.nodeId } : null,
  });
}

function findNode(root, nodeId) {
  if (!nodeId) return null;
  if (root.nodeId === nodeId) return root;
  const children = root.kind === 'all' || root.kind === 'any' ? root.children
    : root.kind === 'not' ? [root.child]
      : root.kind === 'count' ? [root.where] : [];
  for (const child of children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function localMoment(date, time, timezone) {
  if (time === '24:00') return moment.tz(`${date} 00:00`, 'YYYY-MM-DD HH:mm', timezone).add(1, 'day');
  return moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', timezone);
}

function schedule(node, context) {
  const now = moment.tz(context.now, context.timezone);
  const windows = [];
  for (let offset = -1; offset <= 8; offset += 1) {
    const day = now.clone().startOf('day').add(offset, 'day');
    if (!node.days.includes(DAYS[day.day()])) continue;
    const date = day.format('YYYY-MM-DD');
    const start = localMoment(date, node.start, context.timezone);
    let end = localMoment(date, node.end, context.timezone);
    if (!end.isAfter(start)) end = end.add(1, 'day');
    windows.push({ start: start.valueOf(), end: end.valueOf() });
  }
  const active = windows.find(window => context.now >= window.start && context.now < window.end);
  const nextStart = windows.filter(window => window.start > context.now).sort((a, b) => a.start - b.start)[0];
  const at = active?.end ?? nextStart?.start ?? null;
  return result(active ? 'satisfied' : 'unsatisfied', active ? [] : [{ code: 'OUTSIDE_SCHEDULE' }], {
    boundary: at == null ? null : { at, kind: 'schedule' },
  });
}

function count(node, context, evaluateNode) {
  const members = context.graph.subjectSets.get(node.over) ?? [];
  const children = members.map(member => evaluateNode(node.where, { ...context, bindings: { ...context.bindings, [node.as]: member } }));
  const applicable = children.filter(child => child.state !== 'not_applicable');
  if (!applicable.length) return result('not_applicable', [{ code: 'NOT_APPLICABLE' }], { boundary: earliestBoundary(children.map(child => child.boundary)) });
  const satisfied = applicable.filter(child => child.state === 'satisfied').length;
  const indeterminate = applicable.filter(child => child.state === 'indeterminate').length;
  const [kind, target] = Object.entries(node.threshold)[0];
  let state;
  if (kind === 'atLeast') state = satisfied >= target ? 'satisfied' : satisfied + indeterminate < target ? 'unsatisfied' : 'indeterminate';
  if (kind === 'atMost') state = satisfied + indeterminate <= target ? 'satisfied' : satisfied > target ? 'unsatisfied' : 'indeterminate';
  if (kind === 'exactly') state = indeterminate === 0 && satisfied === target ? 'satisfied' : satisfied > target || satisfied + indeterminate < target ? 'unsatisfied' : 'indeterminate';
  return result(state, state === 'satisfied' ? [] : [{ code: state === 'indeterminate' ? 'COUNT_UNRESOLVED' : 'THRESHOLD_NOT_MET' }], {
    boundary: earliestBoundary(children.map(child => child.boundary)),
    progress: ['atLeast', 'exactly'].includes(kind) && target > 0
      ? { current: satisfied, target, unit: 'count', ratio: Math.max(0, Math.min(1, satisfied / target)), basisNodeId: node.nodeId }
      : null,
  });
}

function evaluateNode(node, context) {
  switch (node.kind) {
    case 'claim': {
      const resolved = resolveAssertion(node, context);
      if (resolved.state) return resolved;
      return result(resolved.raw === true ? 'satisfied' : 'unsatisfied', resolved.raw === true ? [] : [{ code: 'CLAIM_FALSE' }], { boundary: resolved.boundary });
    }
    case 'comparison': return comparison(node, context);
    case 'all': return combine('all', node.children.map(child => evaluateNode(child, context)));
    case 'any': return combine('any', node.children.map(child => evaluateNode(child, context)));
    case 'not': {
      const child = evaluateNode(node.child, context);
      const state = child.state === 'satisfied' ? 'unsatisfied' : child.state === 'unsatisfied' ? 'satisfied' : child.state;
      return result(state, child.reasons, { boundary: child.boundary });
    }
    case 'reference': return context.evaluateReference(node.requirementId, context.subject, context.period);
    case 'count': return count(node, context, evaluateNode);
    case 'schedule': return schedule(node, context);
    default: throw new ValidationError('Unsupported expression', { code: 'UNSUPPORTED_EXPRESSION' });
  }
}

export function evaluateRequirement({ graph, assertions = [], requirementId, subject, period, now, timezone, householdRevision = 0, cache = new Map() }) {
  const definition = graph.requirements.get(requirementId);
  if (!definition) throw new ValidationError('Requirement not found', { code: 'REQUIREMENT_NOT_FOUND', field: 'requirementId' });
  const key = instanceKey(requirementId, subject, period);
  if (cache.has(key)) return cache.get(key);
  if (!definition.subjectKinds.includes(subject.kind) || !definition.periodKinds.includes(period.kind)) {
    const evaluation = new RequirementEvaluation({
      requirementId, subject, period, state: 'not_applicable', progress: null,
      reasons: [{ code: 'NOT_APPLICABLE' }], validFrom: now, validUntil: period.endsAt ?? null,
      nextBoundary: period.endsAt ? { at: period.endsAt, kind: 'period_end' } : null,
      policyRevision: graph.policyRevision, householdRevision,
    });
    cache.set(key, evaluation);
    return evaluation;
  }
  const context = {
    graph, assertions, subject, period, now, timezone, bindings: {},
    evaluateReference: (id, refSubject, refPeriod) => {
      const value = evaluateRequirement({ graph, assertions, requirementId: id, subject: refSubject, period: refPeriod, now, timezone, householdRevision, cache });
      return result(value.state, value.reasons, { boundary: value.nextBoundary, progress: value.progress });
    },
  };
  const draft = evaluateNode(definition.expression, context);
  const selectedProgressNode = findNode(definition.expression, definition.progress?.basisNodeId);
  const selectedProgress = selectedProgressNode ? evaluateNode(selectedProgressNode, context).progress : null;
  const nextBoundary = earliestBoundary(draft.boundary, period.endsAt > now ? { at: period.endsAt, kind: 'period_end' } : null);
  const evaluation = new RequirementEvaluation({
    requirementId, subject, period, state: draft.state, progress: selectedProgress ?? draft.progress,
    reasons: draft.reasons, validFrom: now, validUntil: nextBoundary?.at ?? null,
    nextBoundary, policyRevision: graph.policyRevision, householdRevision,
  });
  cache.set(key, evaluation);
  return evaluation;
}

export function decideEntitlement({ definition, evaluation, householdRevision = evaluation.householdRevision }) {
  const table = {
    satisfied: ['granted', false],
    unsatisfied: ['denied', false],
    not_applicable: ['granted', false],
    indeterminate: definition.failurePosture === 'fail_open' ? ['granted', true] : ['denied', true],
  };
  const [decision, degraded] = table[evaluation.state];
  return new EntitlementDecision({
    capabilityId: definition.capabilityId, requirementId: definition.requirementId,
    subject: evaluation.subject, period: evaluation.period, decision,
    basisState: evaluation.state, degraded, reasons: evaluation.reasons,
    validFrom: evaluation.validFrom, validUntil: evaluation.validUntil,
    policyRevision: evaluation.policyRevision, householdRevision,
  });
}

export const fourState = Object.freeze({
  all: states => combine('all', states.map(state => result(state))).state,
  any: states => combine('any', states.map(state => result(state))).state,
  not: state => state === 'satisfied' ? 'unsatisfied' : state === 'unsatisfied' ? 'satisfied' : state,
});
