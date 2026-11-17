const key = ref => ref && ['provider', 'accountId', 'id'].every(field => typeof ref[field] === 'string') && ['task', 'container'].includes(ref.kind) ? JSON.stringify([ref.provider, ref.accountId, ref.kind, ref.id]) : null;

/** Provider facts corroborate a report. They never become authored journal evidence. */
export function corroborateWork({
  username,
  from,
  asOf,
  objects,
  work
}) {
  const completed = [],
    ambiguous = [],
    related = [],
    unconfirmed = [];
  const scoped = ref => (work.coverage?.sources ?? []).some(source => source.provider === ref.provider && source.accountId === ref.accountId && source.complete === true);
  for (const object of objects) {
    const links = (work.links ?? []).filter(link => link.username === username && link.kbObjectId === object.id && key(link.workRef));
    const equivalents = new Map(links.filter(link => link.relation === 'same_commitment').map(link => [key(link.workRef), link]));
    const observations = link => (work.events ?? []).filter(event => event.username === username && event.origin === 'provider' && key(event.ref) === key(link.workRef) && Number.isFinite(event.occurredAt) && event.occurredAt >= from && event.occurredAt > object.created.sourceAt && event.occurredAt <= asOf).sort((a, b) => a.occurredAt - b.occurredAt);
    for (const link of links.filter(link => link.relation !== 'same_commitment')) {
      if (!scoped(link.workRef)) continue;
      for (const event of observations(link).filter(event => event.type === 'completed')) related.push({
        objectId: object.id,
        workRef: link.workRef,
        relation: link.relation,
        eventId: event.id,
        occurredAt: event.occurredAt,
        estimated: event.occurredAtEstimated !== false
      });
    }
    if (!equivalents.size || object.kind !== 'loop') continue;
    if (equivalents.size > 1) {
      ambiguous.push({
        type: 'work_match',
        objectId: object.id,
        reason: 'multiple_same_commitment_links',
        workRefs: [...equivalents.values()].map(link => link.workRef)
      });
      continue;
    }
    const link = [...equivalents.values()][0],
      base = {
        objectId: object.id,
        workRef: link.workRef,
        relation: link.relation,
        kbStatus: object.status
      };
    if (!scoped(link.workRef)) {
      unconfirmed.push({
        ...base,
        reason: 'work_coverage_unavailable'
      });
      continue;
    }
    const events = observations(link),
      completions = events.filter(event => event.type === 'completed');
    if (!completions.length) {
      unconfirmed.push({
        ...base,
        reason: 'no_later_completion_evidence'
      });
      continue;
    }
    if (completions.length > 1) {
      ambiguous.push({
        ...base,
        type: 'work_match',
        reason: 'multiple_completion_occurrences'
      });
      continue;
    }
    const event = completions[0],
      current = (work.items ?? []).find(item => key(item.ref) === key(link.workRef));
    if (event.occurredAtEstimated !== false || events.some(later => later.type === 'reopened' && later.occurredAt >= event.occurredAt) || current && !current.due?.recurring && ['open', 'in_progress', 'paused'].includes(current.status?.category)) {
      ambiguous.push({
        ...base,
        type: 'work_match',
        reason: event.occurredAtEstimated !== false ? 'estimated_completion' : 'work_reopened_or_active',
        eventId: event.id
      });
      continue;
    }
    completed.push({
      ...base,
      eventId: event.id,
      occurredAt: event.occurredAt,
      source: 'provider'
    });
  }
  return {
    completed,
    ambiguous,
    related,
    unconfirmed
  };
}
