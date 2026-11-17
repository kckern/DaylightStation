/** Shared transport bounds and backward-compatible task observation merging. */
import moment from 'moment-timezone';
export const observationError = code => Object.assign(new Error(code), {
  code
});
export function providerId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw observationError('INVALID_PROVIDER_ID');
    return String(value);
  }
  if (typeof value !== 'string' || !value || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw observationError('INVALID_PROVIDER_ID');
  return value;
}
export function sourceInstant(value) {
  if (value == null || value === '') return null;
  const at = typeof value === 'number' ? value : /^\d{10,13}$/.test(value) ? Number(value) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? moment.parseZone(value,moment.ISO_8601,true).valueOf() : null;
  return Number.isFinite(at) && at >= 0 ? at : null;
}
export function historyRange(clock, daysBack) {
  const to = clock();
  if (!Number.isFinite(to) || !Number.isInteger(daysBack) || daysBack < 1 || daysBack > 90) throw observationError('INVALID_HARVEST_RANGE');
  return {
    from: to - daysBack * 86400000,
    to
  };
}
export async function cursorPages({
  client,
  url,
  headers,
  field,
  params = {},
  budget
}) {
  const all = [],
    seen = new Set();
  let cursor = null;
  do {
    if (budget.remaining-- <= 0) throw observationError('WORK_PAGE_LIMIT');
    const response = await client.get(url, {
        headers,
        params: {
          ...params,
          ...(cursor ? {
            cursor
          } : {})
        }
      }),
      body = response?.data;
    if (!Array.isArray(body?.[field])) throw observationError('INVALID_PROVIDER_PAGE');
    all.push(...body[field]);
    cursor = body.next_cursor ?? null;
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) throw observationError('INVALID_PROVIDER_CURSOR');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return all;
}
export function snapshotScope(scope) {
  if (!scope) return {
    accountId: null,
    containerIds: null,
    assigneeIds: null
  };
  return {
    accountId: providerId(scope.accountId),
    containerIds: scope.containerIds == null ? null : scope.containerIds.map(providerId),
    assigneeIds: scope.assigneeIds == null ? null : scope.assigneeIds.map(providerId)
  };
}
/** Separate attempt health preserves the last complete source projection on failure. */
export async function saveSourceHealth({currentStore,username,provider,scope,range,complete,reason=null}) {
  await currentStore?.save(username,provider+'-health',{schema:'work-source-health/v1',provider,accountId:scope.accountId,observedAt:range.to,complete,reason});
}
export function activity({
  id,
  title,
  at,
  action,
  timezone,
  projectId,
  createdAt = null,
  estimated = false,
  actorId = null,
  extra = {}
}) {
  const time = moment.tz(at, timezone);
  return {
    id: providerId(id),
    ...extra,
    content: title,
    name: title,
    date: time.format('YYYY-MM-DD'),
    time: time.format('HH:mm'),
    action,
    projectId: projectId == null ? null : providerId(projectId),
    occurredAt: at,
    occurrenceId: action === 'completed' ? String(at) : 'created',
    occurredAtEstimated: estimated,
    actorId: actorId == null ? null : providerId(actorId),
    ...(createdAt !== null ? {
      addedAt: new Date(createdAt).toISOString()
    } : {}),
    createdAt
  };
}
export function mergeTaskHistory(existing, newTasks) {
  const merged = existing && !Array.isArray(existing) ? structuredClone(existing) : {},
    added = new Map();
  for (const rows of Object.values(merged)) {
    if (!Array.isArray(rows)) throw observationError('INVALID_TASK_HISTORY');
    for (const row of rows) if (row.id != null && row.addedAt) added.set(String(row.id), row.addedAt);
  }
  for (const row of newTasks) {
    const rows = merged[row.date] ??= [];
    if (!row.addedAt && added.has(row.id)) row.addedAt = added.get(row.id);
    if (row.addedAt) added.set(row.id, row.addedAt);
    const duplicate = rows.find(old => String(old.id) === row.id && old.action === row.action && (!old.accountId || !row.accountId || old.accountId === row.accountId) && (row.action !== 'completed' || (old.occurrenceId ?? (old.occurredAt != null ? String(old.occurredAt) : old.time)) === (old.occurrenceId ? row.occurrenceId : old.occurredAt != null ? String(row.occurredAt) : row.time)));
    if (duplicate) {
      // Enrich a matching legacy minute record; never collapse two precise occurrences.
      if (duplicate.occurredAt == null || !duplicate.accountId && row.accountId) Object.assign(duplicate, row);
    } else rows.push(row);
  }
  return Object.fromEntries(Object.keys(merged).sort().reverse().filter(date => merged[date].length).map(date => [date, merged[date].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))]));
}
export function incompleteResult({
  error,
  scope,
  range
}) {
  const reason = error.code ?? (error.response?.status ? 'provider_http_' + error.response.status : 'provider_read_failed');
  return {
    status: 'error',
    reason: 'incomplete_snapshot',
    error: reason,
    current: 0,
    lifelog: {
      created: 0,
      completed: 0
    },
    coverage: {
      complete: false,
      scope,
      ...range,
      reason
    },
    latestDate: null
  };
}
