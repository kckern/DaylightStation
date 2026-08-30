import {
  Assertion, PolicyGraph, decideEntitlement, evaluateRequirement, instanceKey,
} from '#domains/requirements/index.mjs';
import { appError, requireAuthorized } from './errors.mjs';
import { buildGraph, emptySnapshot, enumerateInstances, publicDefinition, resolvePeriod } from './contracts/state.mjs';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function comparableAssertion(assertion) {
  const { supersedesSourceRevision, status, retractedAt, ...rest } = assertion;
  return rest;
}

function filterItems(items, filters = {}) {
  return items.filter(item => {
    const subject = item.subject ?? item.evaluation?.subject ?? item.decision?.subject;
    const period = item.period ?? item.evaluation?.period ?? item.decision?.period;
    if (filters.subjectKind && subject?.kind !== filters.subjectKind) return false;
    if (filters.subjectId && subject?.id !== filters.subjectId) return false;
    if (filters.periodKind && period?.kind !== filters.periodKind) return false;
    if (filters.periodId && period?.id !== filters.periodId) return false;
    if (filters.requirementId && item.requirementId !== filters.requirementId) return false;
    if (filters.capabilityId && item.capabilityId !== filters.capabilityId) return false;
    return true;
  });
}

function changed(left, right) {
  return canonical(left) !== canonical(right);
}

function projectionChanged(left, right) {
  const semantic = value => {
    if (!value) return value;
    const { householdRevision, validFrom, ...rest } = value;
    return rest;
  };
  return changed(semantic(left), semantic(right));
}

function transitionId(householdId, revision, ordinal, kind, key) {
  return `requirements:${householdId}:${revision}:${String(ordinal).padStart(5, '0')}:${kind}:${key}`;
}

export class RequirementsEngine {
  #policySource; #projection; #transitions; #publisher; #authorizer; #subjects; #publisherIds; #roleIds; #now; #timezone; #logger;
  #validations = new Map();

  constructor({ policySource, projectionRepository, transitionRepository, eventPublisher, administrationAuthorizer,
    loadSubjects, publisherIds, roleIds = async () => [], now, timezone, logger = null }) {
    const required = [
      ['policySource.loadCandidate', policySource?.loadCandidate],
      ['projectionRepository.load', projectionRepository?.load],
      ['projectionRepository.commitRevision', projectionRepository?.commitRevision],
      ['transitionRepository.replayAfter', transitionRepository?.replayAfter],
      ['transitionRepository.pending', transitionRepository?.pending],
      ['transitionRepository.markPublished', transitionRepository?.markPublished],
      ['eventPublisher.publish', eventPublisher?.publish],
      ['administrationAuthorizer.authorize', administrationAuthorizer?.authorize],
      ['loadSubjects', loadSubjects], ['publisherIds', publisherIds], ['roleIds', roleIds],
      ['now', now], ['timezone', timezone],
    ];
    const missing = required.find(([, capability]) => typeof capability !== 'function');
    if (missing) throw new Error(`RequirementsEngine requires ${missing[0]}`);
    this.#policySource = policySource;
    this.#projection = projectionRepository;
    this.#transitions = transitionRepository;
    this.#publisher = eventPublisher;
    this.#authorizer = administrationAuthorizer;
    this.#subjects = loadSubjects;
    this.#publisherIds = publisherIds;
    this.#roleIds = roleIds;
    this.#now = now;
    this.#timezone = timezone;
    this.#logger = logger;
  }

  async #context(householdId) {
    return {
      timezone: this.#timezone(householdId),
      publisherIds: await this.#publisherIds(householdId),
      roleIds: await this.#roleIds(householdId),
      subjects: await this.#subjects(householdId),
    };
  }

  async #load(householdId) {
    return (await this.#projection.load(householdId)) ?? emptySnapshot();
  }

  async #deliver(householdId, envelopes) {
    if (!envelopes.length) return false;
    try {
      await this.#publisher.publish(envelopes);
      await this.#transitions.markPublished(householdId, envelopes.map(item => item.transitionId));
      return false;
    } catch (error) {
      this.#logger?.error?.('requirements.delivery.pending', { householdId, count: envelopes.length, error: error.message });
      return true;
    }
  }

  #publicEnvelope(householdId, revision, ordinal, kind, key, occurredAt, payload) {
    return {
      transitionId: transitionId(householdId, revision, ordinal, kind, key),
      householdRevision: revision,
      ordinal,
      occurredAt,
      kind,
      payload,
    };
  }

  #derive({ householdId, snapshot, graph, cause, now, subjects, nextRevision, policyActivated = false }) {
    const instances = enumerateInstances({ graph, snapshot, subjects, now, timezone: this.#timezone(householdId) });
    const oldEvaluations = new Map((snapshot.evaluations ?? []).map(value => [instanceKey(value.requirementId, value.subject, value.period), value]));
    const oldDecisions = new Map((snapshot.decisions ?? []).map(value => [instanceKey(value.capabilityId, value.subject, value.period), value]));
    const evaluations = instances.map(instance => evaluateRequirement({
      graph, assertions: snapshot.assertions, requirementId: instance.requirementId,
      subject: instance.subject, period: instance.period, now,
      timezone: this.#timezone(householdId), householdRevision: nextRevision,
    }));
    const decisions = [];
    for (const evaluation of evaluations) {
      for (const definition of graph.entitlements.values()) {
        if (definition.requirementId === evaluation.requirementId) decisions.push(decideEntitlement({ definition, evaluation, householdRevision: nextRevision }));
      }
    }
    const drafts = [];
    if (policyActivated) drafts.push({ kind: 'PolicyGraphActivated', key: `policy:${graph.policyRevision}`, payload: { policyRevision: graph.policyRevision, digest: graph.digest } });
    for (const current of evaluations) {
      const key = instanceKey(current.requirementId, current.subject, current.period);
      const previous = oldEvaluations.get(key);
      if (!previous || projectionChanged(previous, current)) {
        drafts.push({ kind: 'StateObservation', key, payload: { observationKind: 'requirement', key, current, initial: !previous, cause } });
      }
      if (previous && previous.state !== current.state) {
        drafts.push({ kind: 'RequirementStateChanged', key, payload: { requirementId: current.requirementId, subject: current.subject, period: current.period, from: previous.state, to: current.state, cause, reasons: current.reasons, validUntil: current.validUntil, policyRevision: graph.policyRevision } });
      }
    }
    for (const current of decisions) {
      const key = instanceKey(current.capabilityId, current.subject, current.period);
      const previous = oldDecisions.get(key);
      if (!previous || projectionChanged(previous, current)) {
        drafts.push({ kind: 'StateObservation', key, payload: { observationKind: 'entitlement', key, current, initial: !previous, cause } });
      }
      if (previous && (previous.decision !== current.decision || previous.degraded !== current.degraded || previous.basisState !== current.basisState)) {
        drafts.push({ kind: 'EntitlementDecisionChanged', key, payload: { capabilityId: current.capabilityId, subject: current.subject, period: current.period, from: { decision: previous.decision, degraded: previous.degraded, basisState: previous.basisState }, to: { decision: current.decision, degraded: current.degraded, basisState: current.basisState }, cause, reasons: current.reasons, validUntil: current.validUntil, policyRevision: graph.policyRevision } });
      }
    }
    return {
      evaluations,
      decisions,
      envelopes: drafts.map((draft, ordinal) => this.#publicEnvelope(householdId, nextRevision, ordinal, draft.kind, draft.key, now, draft.payload)),
    };
  }

  async #commit(householdId, mutate, cause) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await this.#load(householdId);
      const context = await this.#context(householdId);
      const graph = buildGraph(snapshot, context);
      if (!graph) throw appError('Requirements policy is unavailable', 'POLICY_UNAVAILABLE', 503);
      const now = this.#now();
      const mutation = await mutate({ snapshot, graph, context, now });
      if (mutation.noop) return { result: 'idempotent', currentRevision: snapshot.householdRevision, deliveryPending: false };
      const nextRevision = snapshot.householdRevision + 1;
      const working = { ...snapshot, ...mutation.snapshot, householdRevision: nextRevision };
      const derived = this.#derive({ householdId, snapshot: working, graph: mutation.graph ?? graph, cause: mutation.cause ?? cause, now, subjects: context.subjects, nextRevision, policyActivated: mutation.policyActivated });
      const next = { ...working, evaluations: derived.evaluations, decisions: derived.decisions };
      const committed = await this.#projection.commitRevision(householdId, snapshot.householdRevision, next, derived.envelopes);
      if (!committed?.committed) continue;
      const deliveryPending = await this.#deliver(householdId, derived.envelopes);
      return { result: mutation.result ?? 'accepted', currentRevision: nextRevision, deliveryPending };
    }
    throw appError('Requirements state changed concurrently', 'REVISION_CONFLICT', 409);
  }

  async observeAssertion(householdId, command) {
    return this.#commit(householdId, async ({ snapshot, graph, context, now }) => {
      const claimType = graph.claimTypes.get(command.claimTypeId);
      if (!claimType) throw appError('Claim type not found', 'CLAIM_TYPE_NOT_FOUND', 404);
      const current = snapshot.assertions.find(item => item.publisherId === command.publisherId && item.id === command.assertionId);
      const props = { ...command, period: resolvePeriod(command.period, context.timezone), id: command.assertionId };
      delete props.assertionId;
      if (current) {
        if (command.sourceRevision < current.sourceRevision) throw appError('Source revision is stale', 'STALE_SOURCE_REVISION', 409);
        if (command.sourceRevision === current.sourceRevision) {
          let normalized;
          try { normalized = new Assertion({ ...props, status: 'active' }, claimType); } catch { normalized = props; }
          if (current.status === 'active' && canonical(comparableAssertion(normalized)) === canonical(comparableAssertion(current))) return { noop: true };
          throw appError('Source revision conflicts with current content', 'SOURCE_REVISION_CONFLICT', 409);
        }
      }
      let observed;
      try {
        observed = current
          ? new Assertion(current, claimType).correct(props, claimType, { now })
          : Assertion.observe(props, claimType, { now });
      } catch (error) {
        if (error.code === 'ASSERTION_SLOT_CHANGED' || error.code === 'STALE_SOURCE_REVISION') {
          throw appError(error.message, error.code, 409);
        }
        throw error;
      }
      const assertions = snapshot.assertions.filter(item => !(item.publisherId === command.publisherId && item.id === command.assertionId));
      assertions.push(observed.assertion);
      return { snapshot: { assertions }, result: current ? 'corrected' : 'observed', cause: current ? 'assertion_corrected' : 'assertion_observed' };
    }, command.cause ?? 'assertion_observed');
  }

  async retractAssertion(householdId, command) {
    if (!Number.isInteger(command.sourceRevision) || command.sourceRevision < 1) {
      throw appError('sourceRevision is required', 'INVALID_SOURCE_REVISION', 400);
    }
    return this.#commit(householdId, async ({ snapshot, graph, now }) => {
      const index = snapshot.assertions.findIndex(item => item.publisherId === command.publisherId && item.id === command.assertionId);
      if (index < 0) throw appError('Assertion not found', 'ASSERTION_NOT_FOUND', 404);
      const current = snapshot.assertions[index];
      if (command.sourceRevision < current.sourceRevision) throw appError('Source revision is stale', 'STALE_SOURCE_REVISION', 409);
      if (command.sourceRevision === current.sourceRevision && current.status === 'retracted') return { noop: true };
      if (command.sourceRevision === current.sourceRevision) throw appError('Source revision conflicts with current content', 'SOURCE_REVISION_CONFLICT', 409);
      const claimType = graph.claimTypes.get(current.claimTypeId);
      if (!claimType) throw appError('Claim type not found', 'CLAIM_TYPE_NOT_FOUND', 404);
      const retracted = new Assertion(current, claimType).retract({ ...command, retractedAt: command.retractedAt ?? now }, claimType).assertion;
      const assertions = [...snapshot.assertions];
      assertions[index] = retracted;
      return { snapshot: { assertions }, result: 'retracted' };
    }, 'assertion_retracted');
  }

  async observeManualAttestation(householdId, actor, command) {
    requireAuthorized(await this.#authorizer.authorize(actor, 'attest', { claimTypeId: command.claimTypeId, subject: command.subject }));
    return this.observeAssertion(householdId, { ...command, publisherId: 'manual-attestation', actor, cause: 'assertion_observed' });
  }

  async retractManualAttestation(householdId, actor, command) {
    requireAuthorized(await this.#authorizer.authorize(actor, 'retract_attestation', { assertionId: command.assertionId }));
    return this.retractAssertion(householdId, { ...command, publisherId: 'manual-attestation', actor });
  }

  async activatePolicyGraph(householdId, actor = null) {
    if (actor) requireAuthorized(await this.#authorizer.authorize(actor, 'activate_policy', { householdId }));
    const candidate = await this.#policySource.loadCandidate(householdId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await this.#load(householdId);
      const context = await this.#context(householdId);
      let graph;
      try {
        graph = PolicyGraph.create({ ...candidate, activatedAt: this.#now() }, context);
        this.#validations.set(householdId, { valid: true, checkedAt: this.#now(), digest: graph.digest, errors: [] });
      } catch (error) {
        this.#validations.set(householdId, { valid: false, checkedAt: this.#now(), digest: candidate?.digest ?? null, errors: [{ code: error.code ?? 'VALIDATION_ERROR', field: error.field, message: error.message }] });
        throw error;
      }
      if (snapshot.activePolicyCandidate?.digest === graph.digest) return { result: 'unchanged', policyRevision: graph.policyRevision, digest: graph.digest, currentRevision: snapshot.householdRevision, deliveryPending: false };
      if (snapshot.activePolicyCandidate && graph.policyRevision <= snapshot.activePolicyCandidate.policyRevision) throw appError('Policy revision must increase', 'POLICY_REVISION_CONFLICT', 409);
      const now = this.#now();
      const nextRevision = snapshot.householdRevision + 1;
      const activePolicyCandidate = { ...candidate, activatedAt: now };
      const activeValidationContext = {
        timezone: context.timezone,
        publisherIds: [...context.publisherIds],
        roleIds: [...context.roleIds],
        subjects: context.subjects.map(subject => ({ ...subject })),
      };
      const working = { ...snapshot, activePolicyCandidate, activeValidationContext, householdRevision: nextRevision };
      const derived = this.#derive({ householdId, snapshot: working, graph, cause: 'policy_activated', now, subjects: context.subjects, nextRevision, policyActivated: true });
      const next = { ...working, evaluations: derived.evaluations, decisions: derived.decisions };
      const committed = await this.#projection.commitRevision(householdId, snapshot.householdRevision, next, derived.envelopes);
      if (!committed?.committed) continue;
      const deliveryPending = await this.#deliver(householdId, derived.envelopes);
      return { result: 'activated', policyRevision: graph.policyRevision, digest: graph.digest, currentRevision: nextRevision, deliveryPending };
    }
    throw appError('Requirements state changed concurrently', 'REVISION_CONFLICT', 409);
  }

  async evaluateRequirements(householdId, cause = 'validity_boundary') {
    return this.#commit(householdId, async () => ({ snapshot: {}, result: 'evaluated' }), cause);
  }

  async getCurrentRequirements(householdId, filters = {}) {
    const snapshot = await this.#load(householdId);
    const graph = buildGraph(snapshot, await this.#context(householdId));
    if (!graph) throw appError('Requirements policy is unavailable', 'POLICY_UNAVAILABLE', 503);
    const evaluations = filterItems(snapshot.evaluations, filters);
    const definitions = [...graph.requirements.values()]
      .filter(definition => !filters.requirementId || definition.id === filters.requirementId)
      .map(publicDefinition);
    return { schema: 'daylight.requirements-query/v1', currentRevision: snapshot.householdRevision, definitions, items: evaluations.map(evaluation => ({ definition: publicDefinition(graph.requirements.get(evaluation.requirementId)), evaluation })) };
  }

  async getCurrentEntitlements(householdId, filters = {}) {
    const snapshot = await this.#load(householdId);
    const graph = buildGraph(snapshot, await this.#context(householdId));
    if (!graph) throw appError('Requirements policy is unavailable', 'POLICY_UNAVAILABLE', 503);
    const definitions = [...graph.entitlements.values()]
      .filter(definition => !filters.capabilityId || definition.capabilityId === filters.capabilityId)
      .map(definition => ({ capabilityId: definition.capabilityId, requirementId: definition.requirementId, failurePosture: definition.failurePosture }));
    return { schema: 'daylight.entitlements-query/v1', currentRevision: snapshot.householdRevision, definitions, items: filterItems(snapshot.decisions, filters) };
  }

  async getDiagnostics(householdId, actor) {
    requireAuthorized(await this.#authorizer.authorize(actor, 'read_diagnostics', { householdId }));
    const snapshot = await this.#load(householdId);
    return { currentRevision: snapshot.householdRevision, assertions: snapshot.assertions, policy: { active: snapshot.activePolicyCandidate ? { digest: snapshot.activePolicyCandidate.digest, policyRevision: snapshot.activePolicyCandidate.policyRevision } : null, candidateValidation: this.#validations.get(householdId) ?? null } };
  }

  async replayTransitions(householdId, afterRevision = 0, limit = 100) {
    if (!Number.isInteger(afterRevision) || afterRevision < 0) throw appError('afterRevision must be a non-negative integer', 'INVALID_REPLAY_CURSOR', 400);
    if (!Number.isInteger(limit) || limit < 1) throw appError('limit must be a positive integer', 'INVALID_REPLAY_LIMIT', 400);
    return this.#transitions.replayAfter(householdId, afterRevision, Math.max(1, Math.min(500, limit)));
  }

  async reconcile(householdId) {
    const pending = await this.#transitions.pending(householdId);
    const deliveryPending = await this.#deliver(householdId, pending);
    let activation;
    try { activation = await this.activatePolicyGraph(householdId); }
    catch (error) {
      const snapshot = await this.#load(householdId);
      if (!snapshot.activePolicyCandidate) throw error;
      this.#logger?.warn?.('requirements.policy.candidate_rejected', { householdId, code: error.code, error: error.message });
      activation = { result: 'retained', currentRevision: snapshot.householdRevision };
    }
    const snapshot = await this.#load(householdId);
    const now = this.#now();
    const boundaryDue = [...(snapshot.evaluations ?? []), ...(snapshot.decisions ?? [])].some(item => item.validUntil != null && item.validUntil <= now);
    const evaluation = boundaryDue ? await this.evaluateRequirements(householdId, 'reconciliation') : null;
    return { activation, evaluation, deliveryPending, nextBoundary: this.nextBoundary(await this.#load(householdId)) };
  }

  nextBoundary(snapshot) {
    return (snapshot.evaluations ?? []).map(item => item.nextBoundary?.at).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  }
}

export default RequirementsEngine;
