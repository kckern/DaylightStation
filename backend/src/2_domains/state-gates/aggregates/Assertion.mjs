import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import {
  deepFreeze, fail, instant, optionalInstant, requireNonEmpty, requirePositiveInteger, samePeriod, sameSubject,
} from '../support.mjs';
import { SubjectRef } from '../refs/SubjectRef.mjs';
import { PeriodRef } from '../refs/PeriodRef.mjs';
import { AssertionCorrected, AssertionObserved, AssertionRetracted } from '../events/GateEvents.mjs';

function event(kind, assertion, occurredAt, extra = {}) {
  const EventType = { AssertionObserved, AssertionCorrected, AssertionRetracted }[kind];
  return new EventType({
    assertionId: assertion.id,
    publisherId: assertion.publisherId,
    sourceRevision: assertion.sourceRevision,
    occurredAt,
    ...extra,
  });
}

export class Assertion {
  constructor(props, claimType) {
    this.id = requireNonEmpty(props.id, 'assertion.id', 'INVALID_ASSERTION_ID');
    this.claimTypeId = requireNonEmpty(props.claimTypeId, 'assertion.claimTypeId');
    this.subject = props.subject instanceof SubjectRef ? props.subject : new SubjectRef(props.subject);
    this.period = props.period instanceof PeriodRef ? props.period : new PeriodRef(props.period);
    this.publisherId = requireNonEmpty(props.publisherId, 'assertion.publisherId');
    this.value = props.value;
    this.sourceRevision = requirePositiveInteger(props.sourceRevision, 'assertion.sourceRevision');
    this.observedAt = instant(props.observedAt, 'assertion.observedAt');
    this.validFrom = instant(props.validFrom ?? props.observedAt, 'assertion.validFrom');
    this.validUntil = optionalInstant(props.validUntil, 'assertion.validUntil');
    this.actor = this.#actor(props.actor, 'actor');
    this.retractionActor = this.#actor(props.retractionActor, 'retractionActor');
    this.evidenceRef = props.evidenceRef == null ? null : String(props.evidenceRef);
    this.status = props.status ?? 'active';
    this.supersedesSourceRevision = props.supersedesSourceRevision ?? null;
    this.retractedAt = optionalInstant(props.retractedAt, 'assertion.retractedAt');
    this.#validate(claimType);
    deepFreeze(this);
  }

  #actor(value, field) {
    return value ? deepFreeze({
      id: requireNonEmpty(value.id, `${field}.id`),
      kind: value.kind ?? 'user',
      roles: [...new Set(value.roles ?? [])],
      authenticatedBy: value.authenticatedBy ?? null,
    }) : null;
  }

  #validate(claimType) {
    if (!claimType || claimType.id !== this.claimTypeId) fail('Claim type does not match assertion', 'CLAIM_TYPE_MISMATCH', 'claimTypeId');
    if (!claimType.subjectKinds.includes(this.subject.kind)) fail('Subject kind is not accepted', 'SUBJECT_KIND_MISMATCH', 'subject.kind');
    if (!claimType.periodKinds.includes(this.period.kind)) fail('Period kind is not accepted', 'PERIOD_KIND_MISMATCH', 'period.kind');
    if (!claimType.acceptedPublishers.includes(this.publisherId)) fail('Publisher is not accepted', 'PUBLISHER_NOT_ACCEPTED', 'publisherId');
    claimType.validateValue(this.value);
    if (this.validUntil != null && this.validUntil <= this.validFrom) fail('Assertion validity is not ordered', 'INVALID_VALIDITY', 'validUntil');
    if (claimType.validity.mustFitPeriod && (this.validFrom < this.period.startsAt || (this.period.endsAt != null && (this.validUntil ?? this.validFrom) > this.period.endsAt))) {
      fail('Assertion validity must fit its period', 'VALIDITY_OUTSIDE_PERIOD', 'validUntil');
    }
    if (claimType.validity.actorRequired && !this.actor) fail('Authenticated actor is required', 'ACTOR_REQUIRED', 'actor');
    if (this.actor && claimType.validity.acceptedActorRoles.length
      && !this.actor.roles.some(role => claimType.validity.acceptedActorRoles.includes(role))) {
      fail('Actor role is not accepted', 'ACTOR_ROLE_NOT_ACCEPTED', 'actor.roles');
    }
    if (!['active', 'retracted'].includes(this.status)) fail('Invalid assertion status', 'INVALID_ASSERTION_STATUS', 'status');
    if (this.status === 'retracted' && this.retractedAt == null) fail('Retraction time is required', 'RETRACTION_TIME_REQUIRED', 'retractedAt');
    if (this.status === 'active' && (this.retractedAt != null || this.retractionActor != null)) fail('Active assertion cannot carry retraction metadata', 'INVALID_RETRACTION_METADATA', 'retractedAt');
  }

  static observe(props, claimType, { now = props.observedAt } = {}) {
    const assertion = new Assertion(props, claimType);
    const maxSkew = claimType.validity.maxFutureSkewMs ?? 0;
    if (assertion.observedAt > instant(now, 'now') + maxSkew) fail('Observation is too far in the future', 'FUTURE_OBSERVATION', 'observedAt');
    return { assertion, events: [event('AssertionObserved', assertion, assertion.observedAt)] };
  }

  correct(replacement, claimType, { now = replacement.observedAt } = {}) {
    this.#assertReplacement(replacement);
    const next = new Assertion({
      ...replacement,
      id: this.id,
      publisherId: this.publisherId,
      supersedesSourceRevision: this.sourceRevision,
      status: 'active',
      retractedAt: null,
      retractionActor: null,
    }, claimType);
    if (next.observedAt > instant(now, 'now') + (claimType.validity.maxFutureSkewMs ?? 0)) fail('Observation is too far in the future', 'FUTURE_OBSERVATION', 'observedAt');
    return { assertion: next, events: [event('AssertionCorrected', next, next.observedAt, { fromSourceRevision: this.sourceRevision, toSourceRevision: next.sourceRevision })] };
  }

  retract({ sourceRevision, retractedAt, actor = null, evidenceRef = this.evidenceRef }, claimType) {
    if (!Number.isInteger(sourceRevision) || sourceRevision <= this.sourceRevision) {
      throw new DomainInvariantError('Retraction source revision must increase', { code: 'STALE_SOURCE_REVISION' });
    }
    const next = new Assertion({
      ...this,
      sourceRevision,
      observedAt: retractedAt,
      validFrom: this.validFrom,
      validUntil: this.validUntil,
      actor: this.actor,
      retractionActor: actor,
      evidenceRef,
      status: 'retracted',
      supersedesSourceRevision: this.sourceRevision,
      retractedAt,
    }, claimType);
    return { assertion: next, events: [event('AssertionRetracted', next, next.retractedAt, { fromSourceRevision: this.sourceRevision, toSourceRevision: next.sourceRevision })] };
  }

  #assertReplacement(replacement) {
    if (!Number.isInteger(replacement.sourceRevision) || replacement.sourceRevision <= this.sourceRevision) {
      throw new DomainInvariantError('Source revision must increase', { code: 'STALE_SOURCE_REVISION' });
    }
    if (replacement.claimTypeId !== this.claimTypeId || !sameSubject(replacement.subject, this.subject)
      || !samePeriod(replacement.period, this.period)) {
      throw new DomainInvariantError('Correction cannot change assertion fact slot', { code: 'ASSERTION_SLOT_CHANGED' });
    }
  }
}

export default Assertion;
