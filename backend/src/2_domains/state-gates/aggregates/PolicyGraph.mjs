import moment from 'moment-timezone';
import { ClaimTypeDefinition } from '../definitions/ClaimTypeDefinition.mjs';
import { GateDefinition } from '../definitions/GateDefinition.mjs';
import { EntitlementDefinition } from '../definitions/EntitlementDefinition.mjs';
import { SubjectRef } from '../refs/SubjectRef.mjs';
import { ReadonlyMap, asEntries, deepFreeze, fail, requirePositiveInteger, subjectKey } from '../support.mjs';

const NODE_KINDS = new Set(['claim', 'reference', 'all', 'any', 'not', 'comparison', 'count', 'schedule']);

function walk(node, visitor, path = 'expression') {
  visitor(node, path);
  if (node.kind === 'all' || node.kind === 'any') node.children.forEach((child, index) => walk(child, visitor, `${path}/${index}`));
  else if (node.kind === 'not') walk(node.child, visitor, `${path}/not`);
  else if (node.kind === 'count') walk(node.where, visitor, `${path}/where`);
}

function validateExpression(node, graph, gate, path, bindings = new Map([['subject', gate.subjectKinds], ['period', gate.periodKinds]])) {
  if (!node || !NODE_KINDS.has(node.kind)) fail('Unsupported gate expression', 'UNSUPPORTED_EXPRESSION', path);
  if ((node.kind === 'all' || node.kind === 'any') && (!Array.isArray(node.children) || !node.children.length)) fail(`${node.kind} requires children`, 'EMPTY_EXPRESSION', path);
  if (node.kind === 'not' && !node.child) fail('not requires one child', 'EXPRESSION_REQUIRED', path);
  if (node.kind === 'claim' || node.kind === 'comparison') {
    const selector = node.kind === 'claim' ? node : node.claim;
    const claim = graph.claimTypes.get(selector?.claimTypeId);
    if (!claim) fail('Expression references unknown claim type', 'UNKNOWN_CLAIM_TYPE', path, { claimTypeId: selector?.claimTypeId });
    if (!selector.publisherId || !claim.acceptedPublishers.includes(selector.publisherId)) fail('Expression publisher is not accepted', 'PUBLISHER_NOT_ACCEPTED', path);
    if (typeof selector.subject === 'string' && selector.subject.startsWith('$')) {
      const kinds = bindings.get(selector.subject.slice(1));
      if (!kinds) fail('Expression uses an unbound subject variable', 'UNBOUND_SUBJECT', path);
      if (kinds.some(kind => !claim.subjectKinds.includes(kind))) fail('Claim subject binding is incompatible', 'SUBJECT_KIND_MISMATCH', path);
    } else if (selector.subject && !graph.catalog.has(subjectKey(selector.subject))) {
      fail('Expression references an unknown subject', 'UNKNOWN_SUBJECT', path);
    }
    if (typeof selector.period === 'string' && selector.period.startsWith('$')) {
      const kinds = bindings.get(selector.period.slice(1));
      if (!kinds || kinds.some(kind => !claim.periodKinds.includes(kind))) fail('Claim period binding is incompatible', 'PERIOD_KIND_MISMATCH', path);
    }
    if (node.kind === 'claim' && claim.valueSchema.type !== 'boolean') fail('claim nodes require a boolean claim type', 'CLAIM_NOT_BOOLEAN', path);
    if (node.kind === 'comparison') {
      const numeric = ['number', 'integer', 'duration'].includes(claim.valueSchema.type);
      const allowed = numeric ? ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] : ['eq', 'neq', 'in'];
      if (!allowed.includes(node.op)) fail('Comparison operator is incompatible', 'INVALID_COMPARISON', path);
      if (node.op === 'in') {
        if (!Array.isArray(node.value) || !node.value.length) fail('Membership comparison requires values', 'INVALID_COMPARISON', path);
        node.value.forEach(value => claim.validateValue(value));
      } else claim.validateValue(node.value);
      if ((claim.valueSchema.unit != null || node.unit != null) && claim.valueSchema.unit !== node.unit) fail('Comparison unit is incompatible', 'UNIT_MISMATCH', path);
    }
  }
  if (node.kind === 'reference') {
    const referenced = graph.gates.get(node.gateId);
    if (!referenced) fail('Unknown gate reference', 'UNKNOWN_GATE', path);
    if (gate.subjectKinds.some(kind => !referenced.subjectKinds.includes(kind))
      || gate.periodKinds.some(kind => !referenced.periodKinds.includes(kind))) {
      fail('Gate reference has an incompatible subject/period contract', 'INCOMPATIBLE_GATE_REFERENCE', path);
    }
  }
  if (node.kind === 'count') {
    if (!graph.subjectSets.has(node.over)) fail('Unknown subject set', 'UNKNOWN_SUBJECT_SET', path);
    if (typeof node.as !== 'string' || !node.as.trim() || ['subject', 'period'].includes(node.as)) fail('Count binding is invalid', 'INVALID_COUNT_BINDING', path);
    const thresholdKeys = Object.keys(node.threshold ?? {}).filter(key => ['atLeast', 'atMost', 'exactly'].includes(key));
    if (thresholdKeys.length !== 1 || !Number.isInteger(node.threshold[thresholdKeys[0]]) || node.threshold[thresholdKeys[0]] < 0) {
      fail('Count threshold is invalid', 'INVALID_COUNT_THRESHOLD', path);
    }
  }
  if (node.kind === 'schedule') {
    if (!Array.isArray(node.days) || !node.days.length || node.days.some(day => !['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(day))) {
      fail('Schedule days are invalid', 'INVALID_SCHEDULE', path);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(node.start) || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(node.end)) {
      fail('Schedule time is invalid', 'INVALID_SCHEDULE', path);
    }
  }
  if (node.kind === 'count') {
    const memberKind = graph.subjectSets.get(node.over)[0].kind;
    validateExpression(node.where, graph, gate, `${path}/where`, new Map([...bindings, [node.as, [memberKind]]]));
  } else {
    walkChildren(node, (child, index) => validateExpression(child, graph, gate, `${path}/${index ?? child.kind}`, bindings));
  }
}

function walkChildren(node, visitor) {
  if (node.kind === 'all' || node.kind === 'any') node.children.forEach(visitor);
  else if (node.kind === 'not') visitor(node.child, 'not');
}

function detectCycles(gates) {
  const edges = new Map();
  for (const [id, gate] of gates) {
    const refs = [];
    walk(gate.expression, node => { if (node.kind === 'reference') refs.push(node.gateId); });
    edges.set(id, refs);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) fail('Gate reference cycle detected', 'GATE_CYCLE', 'gates', { gateId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of edges.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of gates.keys()) visit(id);
  return edges;
}

export class PolicyGraph {
  constructor({ schemaVersion, policyRevision, digest, publishers, subjectSets, claimTypes, gates, entitlements, activatedAt, dependencyGraph }) {
    this.schemaVersion = schemaVersion;
    this.policyRevision = policyRevision;
    this.digest = digest;
    this.publishers = publishers;
    this.subjectSets = subjectSets;
    this.claimTypes = claimTypes;
    this.gates = gates;
    this.entitlements = entitlements;
    this.activatedAt = activatedAt;
    this.dependencyGraph = dependencyGraph;
    Object.freeze(this);
  }

  static create(candidate, context = {}) {
    const schemaVersion = requirePositiveInteger(candidate.schemaVersion, 'policy.schemaVersion');
    if (schemaVersion !== 1) fail('Unsupported policy schema version', 'UNSUPPORTED_POLICY_SCHEMA', 'schemaVersion');
    const policyRevision = requirePositiveInteger(candidate.policyRevision, 'policy.policyRevision');
    if (!candidate.digest) fail('Policy digest is required', 'POLICY_DIGEST_REQUIRED', 'digest');
    if (!moment.tz.zone(context.timezone)) fail('Household timezone is invalid', 'INVALID_TIMEZONE', 'timezone');
    const publishers = new ReadonlyMap(asEntries(candidate.publishers).map(([id, value]) => [id, deepFreeze({ ...(value ?? {}) })]));
    const knownPublishers = new Set(context.publisherIds ?? publishers.keys());
    for (const publisherId of publishers.keys()) if (!knownPublishers.has(publisherId)) fail('Publisher has no authenticated authority', 'UNKNOWN_PUBLISHER_AUTHORITY', 'publishers', { publisherId });

    const claimTypes = new ReadonlyMap(asEntries(candidate.claimTypes).map(([id, value]) => [id, value instanceof ClaimTypeDefinition ? value : new ClaimTypeDefinition({ ...value, id })]));
    for (const claim of claimTypes.values()) {
      if (claim.schemaVersion !== 1) fail('Unsupported claim schema version', 'UNSUPPORTED_CLAIM_SCHEMA', 'schemaVersion', { claimTypeId: claim.id });
      for (const publisherId of claim.acceptedPublishers) {
        if (!publishers.has(publisherId) || !knownPublishers.has(publisherId)) fail('Claim type references an unauthorized publisher', 'UNKNOWN_PUBLISHER_AUTHORITY', 'acceptedPublishers', { publisherId });
      }
      if (context.roleIds && claim.validity.acceptedActorRoles.some(role => !context.roleIds.includes(role))) {
        fail('Claim type references an unknown actor role', 'UNKNOWN_ACTOR_ROLE', 'acceptedActorRoles', { claimTypeId: claim.id });
      }
    }

    const catalog = new Map((context.subjects ?? []).map(value => {
      const subject = value instanceof SubjectRef ? value : new SubjectRef(value);
      return [subjectKey(subject), subject];
    }));
    const subjectSets = new ReadonlyMap(asEntries(candidate.subjectSets).map(([id, values]) => {
      const members = (values ?? []).map(value => value instanceof SubjectRef ? value : new SubjectRef(value));
      if (!members.length) fail('Subject sets must not be empty', 'EMPTY_SUBJECT_SET', 'subjectSets', { subjectSetId: id });
      if (new Set(members.map(subjectKey)).size !== members.length) fail('Subject set contains duplicates', 'DUPLICATE_SUBJECT', 'subjectSets', { subjectSetId: id });
      if (new Set(members.map(member => member.kind)).size !== 1) fail('Subject set must be homogeneous', 'MIXED_SUBJECT_SET', 'subjectSets', { subjectSetId: id });
      for (const member of members) if (!catalog.has(subjectKey(member))) fail('Subject set member is not in the household catalog', 'UNKNOWN_SUBJECT', 'subjectSets', { subjectSetId: id, subject: subjectKey(member) });
      return [id, deepFreeze(members)];
    }));

    const gates = new ReadonlyMap(asEntries(candidate.gates).map(([id, value]) => [id, value instanceof GateDefinition ? value : new GateDefinition({ ...value, id })]));
    for (const gate of gates.values()) if (gate.schemaVersion !== 1) fail('Unsupported gate schema version', 'UNSUPPORTED_GATE_SCHEMA', 'schemaVersion', { gateId: gate.id });
    const shell = { claimTypes, subjectSets, gates, catalog };
    for (const gate of gates.values()) {
      validateExpression(gate.expression, shell, gate, gate.id);
      if (gate.progress) {
        const nodes = [];
        walk(gate.expression, node => nodes.push(node));
        const basis = nodes.find(node => node.nodeId === gate.progress.basisNodeId);
        const clearComparison = basis?.kind === 'comparison' && ['gte', 'gt'].includes(basis.op) && Number.isFinite(basis.value) && basis.value > 0;
        const clearCount = basis?.kind === 'count' && (basis.threshold.atLeast != null || basis.threshold.exactly != null);
        if (!clearComparison && !clearCount) fail('Progress basis is missing or ambiguous', 'INVALID_PROGRESS_BASIS', 'progress', { gateId: gate.id });
      }
    }
    const dependencyGraph = detectCycles(gates);
    const entitlements = new ReadonlyMap(asEntries(candidate.entitlements).map(([id, value]) => [id, value instanceof EntitlementDefinition ? value : new EntitlementDefinition({ ...value, capabilityId: id })]));
    for (const entitlement of entitlements.values()) if (!gates.has(entitlement.gateId)) fail('Entitlement references unknown gate', 'UNKNOWN_GATE', 'entitlements', { capabilityId: entitlement.capabilityId });

    return new PolicyGraph({
      schemaVersion, policyRevision, digest: candidate.digest, publishers: deepFreeze(publishers),
      subjectSets, claimTypes, gates, entitlements, activatedAt: candidate.activatedAt,
      dependencyGraph: new ReadonlyMap(dependencyGraph),
    });
  }
}

export default PolicyGraph;
