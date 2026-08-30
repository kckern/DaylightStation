import moment from 'moment-timezone';
import { PeriodRef, PolicyGraph, SubjectRef, instanceKey } from '#domains/requirements/index.mjs';

export function emptySnapshot() {
  return {
    schemaVersion: 1,
    householdRevision: 0,
    activePolicyCandidate: null,
    activeValidationContext: null,
    assertions: [],
    evaluations: [],
    decisions: [],
  };
}

export function buildGraph(snapshot, validationContext) {
  if (!snapshot?.activePolicyCandidate) return null;
  return PolicyGraph.create(snapshot.activePolicyCandidate, snapshot.activeValidationContext ?? validationContext);
}

export function currentPeriods(now, timezone) {
  const local = moment.tz(now, timezone);
  return [
    PeriodRef.localDay(local.format('YYYY-MM-DD'), timezone),
    PeriodRef.localWeek(local.format('GGGG-[W]WW'), timezone),
  ];
}

export function resolvePeriod(value, timezone) {
  if (!value || typeof value !== 'object') return value;
  let resolved;
  if (value.kind === 'local_day') resolved = PeriodRef.localDay(value.id, timezone);
  else if (value.kind === 'local_week') resolved = PeriodRef.localWeek(value.id, timezone);
  else return value instanceof PeriodRef ? value : new PeriodRef(value);
  if ((value.startsAt != null && value.startsAt !== resolved.startsAt)
    || (value.endsAt != null && value.endsAt !== resolved.endsAt)) {
    const error = new Error('Period boundaries do not match the household timezone');
    error.name = 'ValidationError';
    error.code = 'PERIOD_BOUNDARY_MISMATCH';
    error.field = 'period';
    throw error;
  }
  return resolved;
}

export function enumerateInstances({ graph, snapshot, subjects, now, timezone }) {
  const pairs = new Map();
  const add = (subject, period) => pairs.set(`${subject.kind}:${subject.id}|${period.kind}:${period.id}`, { subject, period });
  for (const evaluation of snapshot.evaluations ?? []) add(new SubjectRef(evaluation.subject), new PeriodRef(evaluation.period));
  for (const assertion of snapshot.assertions ?? []) add(new SubjectRef(assertion.subject), new PeriodRef(assertion.period));
  const current = currentPeriods(now, timezone);
  for (const subjectValue of subjects) {
    const subject = subjectValue instanceof SubjectRef ? subjectValue : new SubjectRef(subjectValue);
    for (const period of current) add(subject, period);
  }
  const instances = [];
  for (const requirement of graph.requirements.values()) {
    for (const pair of pairs.values()) {
      if (requirement.subjectKinds.includes(pair.subject.kind) && requirement.periodKinds.includes(pair.period.kind)) {
        instances.push({ requirementId: requirement.id, ...pair, key: instanceKey(requirement.id, pair.subject, pair.period) });
      }
    }
  }
  return instances;
}

export function publicDefinition(definition) {
  return {
    id: definition.id,
    schemaVersion: definition.schemaVersion,
    subjectKinds: [...definition.subjectKinds],
    periodKinds: [...definition.periodKinds],
    expression: definition.expression,
    progress: definition.progress,
    reasonLabels: definition.reasonLabels,
  };
}
