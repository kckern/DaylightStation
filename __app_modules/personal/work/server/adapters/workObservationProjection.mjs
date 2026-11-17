import { createHash } from 'node:crypto';
import moment from 'moment-timezone';
import { keyOf, validateWorkRef, validateWorkItem, WORK_OPERATIONS } from '../domain/workModel.mjs';
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const error = () => {
  throw Object.assign(new Error('INVALID_WORK_OBSERVATION'), {
    code: 'INVALID_WORK_OBSERVATION'
  });
};
const id = value => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string') return value;
  return error();
};
const at = value => {
  if (value == null || value === '') return null;
  const result = typeof value === 'number' ? value : /^\d{10,13}$/.test(value) ? Number(value) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? moment.parseZone(value,moment.ISO_8601,true).valueOf() : null;
  return Number.isFinite(result) && result >= 0 ? result : null;
};
const makeRef = (provider, accountId, kind, value) => validateWorkRef({
  provider,
  accountId,
  kind,
  id: id(value)
});
function access({
  resolvePolicy,
  provider,
  accountId,
  username
}) {
  const policy = resolvePolicy(username);
  const matching = policy?.enabled ? Object.values(policy.providers).filter(p => p.type === provider && p.accountId === accountId && p.operations.includes('read')) : [];
  const domains = matching.length ? Object.values(policy.domains).filter(d => matching.some(p => policy.providers[d.provider] === p)) : [];
  return {
    policy,
    domains,
    allowed: matching.length > 0
  };
}
export function readCapabilities(input) {
  const {
    allowed
  } = access(input);
  return Object.fromEntries(WORK_OPERATIONS.map(operation => [operation, operation === 'read' && allowed]));
}
function scopeAllows(domains, containerId, assignees, requested) {
  if (requested?.containerIds && !requested.containerIds.includes(containerId)) return false;
  if (requested?.assigneeIds && !requested.assigneeIds.some(id => assignees.includes(id))) return false;
  return domains.some(d => d.containerId === containerId && (!d.assigneeIds || d.assigneeIds.some(id => assignees.includes(id))));
}
function categoryOf(provider, row, native) {
  if (provider === 'todoist') return row.checked === true || row.isCompleted === true ? 'done' : 'open';
  const status = (native ?? '').toLowerCase().replaceAll('_', ' '),
    type = row.statusType ?? row.status?.type;
  if (type === 'closed' || type === 'done') return 'done';
  if (['paused', 'on hold', 'back burner', 'backlog'].includes(status)) return 'paused';
  if (['in progress', 'doing', 'coding', 'review', 'in review'].includes(status)) return 'in_progress';
  if (['open', 'todo', 'to do', 'on deck'].includes(status) || type === 'open') return 'open';
  if (!type && ['done', 'complete', 'completed', 'closed'].includes(status)) return 'done';
  return 'unknown';
}
export function normalizeItem({
  row,
  provider,
  accountId,
  observedAt,
  timezone
}) {
  const ref = makeRef(provider, accountId, 'task', row.id),
    containerId = row.containerId ?? row.projectId ?? row.project_id ?? row.list?.id ?? null;
  const native = provider === 'todoist' ? row.checked === true ? 'done' : 'open' : row.status?.status ?? row.status ?? null;
  let ancestors = row.ancestorRefs;
  if (!ancestors && provider === 'clickup') ancestors = [...(row.space?.id ? [{
    ...row.space,
    nativeKind: 'space'
  }] : []), ...((row.folder ?? row.project)?.id ? [{
    ...(row.folder ?? row.project),
    nativeKind: 'folder'
  }] : [])];
  const ancestorRefs = (ancestors ?? []).filter(a => a.hidden !== true).map(a => ({
    ...makeRef(provider, accountId, 'container', a.id),
    nativeKind: a.nativeKind ?? 'folder'
  }));
  const rawDue = row.due ?? (row.dueDate ? {
    date: row.dueDate
  } : null);
  let due = null;
  if (rawDue) {
    const date = rawDue.date ?? null;
    const instant = date && date.includes('T') ? moment.tz(date, rawDue.timezone ?? timezone).valueOf() : at(row.due_date);
    due = {
      date: date?.slice(0, 10) ?? (instant !== null ? moment.tz(instant, timezone).format('YYYY-MM-DD') : null),
      at: Number.isFinite(instant) ? instant : null,
      recurring: rawDue.is_recurring === true || rawDue.recurring === true,
      occurrenceId: rawDue.occurrenceId ?? date ?? null
    };
  } else if (row.due_date != null) {
    const instant = at(row.due_date);
    if (instant !== null) due = {
      date: moment.tz(instant, timezone).format('YYYY-MM-DD'),
      at: instant,
      recurring: false,
      occurrenceId: null
    };
  }
  const source = {
    ref,
    title: row.content ?? row.name,
    description: row.description ?? null,
    status: {
      native,
      category: categoryOf(provider, row, native)
    },
    containerRef: containerId !== null ? makeRef(provider, accountId, 'container', containerId) : null,
    ancestorRefs,
    createdAt: at(row.createdAt ?? row.added_at ?? row.date_created),
    modifiedAt: at(row.modifiedAt ?? row.updated_at ?? row.date_updated),
    completedAt: at(row.completedAt ?? row.completed_at ?? row.date_done),
    due,
    assigneeIds: (row.assigneeIds ?? row.assignees?.map(a => a.id) ?? (row.responsible_uid != null ? [row.responsible_uid] : [])).map(id),
    url: row.url ?? null
  };
  return validateWorkItem({
    ...source,
    observedAt,
    version: hash({...source,...(provider==='todoist'?{completedCount:row.completed_count??null,deleted:row.is_deleted??false,priority:row.priority??null,labels:row.labels??[]}:{archived:row.archived??false,priority:row.priority??null,customFields:row.custom_fields??[],parent:row.parent??null})})
  });
}
function normalizeEvents({
  history,
  provider,
  accountId,
  username,
  domains,
  requested,
  asOf,
  timezone
}) {
  if (!history || Array.isArray(history) || typeof history !== 'object') error();
  const events = new Map();
  let unscoped = false;
  for (const [date, rows] of Object.entries(history)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!['created', 'completed', 'reopened', 'updated', 'archived', 'deleted'].includes(row.action)) continue;
      const ref = makeRef(provider, accountId, 'task', row.id),
        containerId = row.projectId ?? row.containerId ?? row.project_id ?? null;
      // Historical entries lacking assignment cannot satisfy an assignment-limited domain.
      const assignees = (row.assigneeIds ?? []).map(id);
      if (!scopeAllows(domains, containerId, assignees, requested)) continue;
      const exact = at(row.occurredAt),
        occurredAt = exact ?? moment.tz(date + ' ' + (row.time ?? '00:00'), 'YYYY-MM-DD HH:mm', true, timezone).valueOf();
      if (!Number.isFinite(occurredAt) || occurredAt < asOf - 90 * 86400000 || occurredAt > asOf) continue;
      if (!row.accountId) {
        unscoped = true;
        continue;
      }
      if (row.accountId !== accountId || row.provider && row.provider !== provider) continue;
      const occurrenceId = row.occurrenceId ?? String(occurredAt),
        eventId = 'work:' + hash([username, ref, row.action, occurrenceId]);
      events.set(eventId, {
        id: eventId,
        username,
        ref,
        containerRef: makeRef(provider,accountId,'container',containerId),
        assigneeIds: assignees,
        type: row.action,
        title:typeof (row.content??row.name)==='string'?(row.content??row.name).slice(0,2000):null,
        occurredAt,
        observedAt: asOf,
        providerVersion: row.providerVersion ?? hash(row),
        occurrenceId,
        origin: 'provider',
        causationId: row.causationId ?? null,
        sourceRefs: ['lifelog:' + provider + ':' + date + ':' + ref.id + ':' + row.action + ':' + occurrenceId],
        actorId: row.actorId ?? null,
        occurredAtEstimated: row.occurredAtEstimated === true || exact === null
      });
    }
  }
  return {
    events: [...events.values()].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id)),
    unscoped
  };
}
export async function readWorkSnapshot({
  provider,
  accountId,
  loadCurrent,
  loadHistory,
  resolvePolicy,
  username,
  scope,
  asOf
}) {
  const empty = reason => ({
    items: [],
    containers: [],
    events: [],
    observedAt: null,
    coverage: {
      complete: false,
      scope: scope ?? null,
      from: null,
      to: null,
      reason
    },
    revision: 'unavailable'
  });
  try {
    if (!Number.isFinite(asOf)) return empty('invalid_as_of');
    const {
      policy,
      domains,
      allowed
    } = access({
      provider,
      accountId,
      resolvePolicy,
      username
    });
    if (!allowed) return empty('work_disabled');
    if (scope?.accountId && scope.accountId !== accountId) return empty('account_mismatch');
    if (scope?.containerIds?.some(id => !domains.some(d => d.containerId === id))) return empty('scope_mismatch');
    const raw = await loadCurrent(username, provider);
    if (!raw) return empty('snapshot_missing');
    if (raw.accountId !== accountId || raw.coverage?.scope?.accountId !== accountId) return empty('unscoped_snapshot');
    if (!Number.isFinite(raw.observedAt) || !Array.isArray(raw.tasks)) return empty('invalid_snapshot');
    const compiledScope = {
      accountId,
      containerIds: [...new Set(domains.map(d => d.containerId))],
      assigneeIds: null
    };
    let reason = raw.coverage.complete === true ? null : raw.coverage.reason ?? 'incomplete_snapshot';
    if (raw.observedAt > asOf) reason = 'future_snapshot';else if (asOf - raw.observedAt > policy.limits.snapshotMaxAgeHours * 3600000) reason = 'stale_snapshot';
    const projectedItems = raw.tasks.map(row => normalizeItem({
      row,
      provider,
      accountId,
      observedAt: raw.observedAt,
      timezone: policy.timezone
    })).filter(item => scopeAllows(domains, item.containerRef?.id, item.assigneeIds, scope));
    const identities = new Map();
    for (const item of projectedItems) {
      const key = keyOf(item.ref), previous = identities.get(key);
      if (previous && previous.version !== item.version) return empty('inconsistent_snapshot');
      identities.set(key, item);
    }
    const items = [...identities.values()].sort((a,b)=>keyOf(a.ref).localeCompare(keyOf(b.ref)));
    const containers = (raw.containers ?? []).filter(row => compiledScope.containerIds.includes(String(row.id))).map(row => ({
      ref: makeRef(provider, accountId, 'container', row.id),
      nativeKind: row.nativeKind ?? (provider === 'todoist' ? 'project' : 'list'),
      name: row.name ?? null,
      statuses: row.statuses ?? [],
      parentId: row.parentId ?? row.parent_id ?? row.folder?.id ?? null,
      createdAt: at(row.createdAt ?? row.added_at),
      modifiedAt: at(row.modifiedAt ?? row.updated_at)
    }));
    const history = await normalizeEvents({
      history: await loadHistory(username, provider),
      provider,
      accountId,
      username,
      domains,
      requested: scope,
      asOf,
      timezone: policy.timezone
    });
    if (!reason && history.unscoped) reason = 'unscoped_history';
    return {
      items,
      containers,
      events: history.events,
      observedAt: raw.observedAt,
      coverage: {
        complete: reason === null,
        scope: compiledScope,
        from: raw.coverage.from ?? null,
        to: raw.coverage.to ?? null,
        reason
      },
      revision: hash({
        items: items.map(({
          observedAt,
          ...item
        }) => item),
        containers,
        sourceCoverage: raw.coverage
      })
    };
  } catch {
    return empty('invalid_snapshot');
  }
}
export async function getWorkItem(options) {
  try {
    validateWorkRef(options.ref);
    if (options.ref.provider !== options.provider || options.ref.accountId !== options.accountId || options.ref.kind !== 'task') return null;
    const snapshot = await readWorkSnapshot(options);
    return snapshot.items.find(item => keyOf(item.ref) === keyOf(options.ref)) ?? null;
  } catch {
    return null;
  }
}
