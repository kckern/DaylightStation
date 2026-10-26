import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { useHealthOperations } from './HealthOperationsProvider.jsx';
import { foodOperationScope } from './foodOperationScope.js';

/** An API-shaped dispatcher so every live command rechecks its targets at send time. */
export function useFoodMutation(rows = []) {
  const session = useHealthOperations();
  const dispatch = async (path, body = {}, method = 'GET', parentId = undefined, onResult = undefined) => {
    parentId ||= body.parentOperationId;
    if (body.parentOperationId) { const { parentOperationId, ...payload } = body; body = payload; }
    const item = path.match(/\/nutrilist\/([^/?]+)(?:\/(revise|revise-dish))?$/);
    const capture = path.endsWith('/nutrition/input');
    const command = /\/nutrition\/(meal-command|restore|meal-undo)$/.test(path);
    if (!session || method === 'GET' || (!item && !command && !capture)) {
      const result = await DaylightAPI(path, body, method);
      await onResult?.(result, null);
      return result;
    }
    const allRows = [...session.knownRows.values(), ...rows];
    const undoScope = session.undoScopes.get(body.undoToken);
    const selectedIds = body.action === 'groups' ? (body.groups || []).flatMap(group => group.selectedIds || []) : item ? [decodeURIComponent(item[1])] : body.selectedIds || body.entryIds || body.groups?.flatMap(group => group.selectedIds) || undoScope?.ids || [];
    const targetIds = foodOperationScope({ action: body.action || (method === 'DELETE' || body.date || body.mealTime ? 'membership' : 'edit'), rows: allRows, selectedIds, groupId: body.groupId });
    if (targetIds.some(id => id.startsWith('pending-'))) throw new Error('This food is still saving.');
    const source = allRows.find(row => selectedIds.map(String).includes(String(row.uuid ?? row.id)));
    const id = body.operationId || crypto.randomUUID();
    const existing = session.store.getSnapshot().operations.get(id);
    const inputFingerprint = JSON.stringify({ path, body: { ...body, operationId: id }, method });
    if (!existing) {
      const request = { path, body: { ...body, operationId: id,
        ...(capture && !body.expectedVersions ? { expectedVersions: Object.fromEntries(allRows.filter(row => row.date === body.date).map(row => [String(row.uuid ?? row.id), row.version ?? 1])) } : {}),
      }, method };
      const started = session.store.begin({ id, parentId, inputFingerprint, resumable: Boolean(onResult), kind: 'mutation', targetIds, date: source?.date || undoScope?.date || body.date, bucket: source?.mealTime || undoScope?.bucket || body.bucket, request,
        label: source?.name || source?.item || 'Food' });
      if (!started.ok) throw new Error('This food is already saving. Wait for it to finish.');
    } else if (existing.inputFingerprint !== inputFingerprint) {
      throw new Error('The previous change is still pending. Retry or discard it first.');
    }
    return session.execute(id, onResult);
  };
  dispatch.withContinuation = (path, body, method, apply) => dispatch(path, body, method, undefined, apply);
  dispatch.withReservation = async (members, action) => {
    if (!session) return action(dispatch);
    const targetIds = foodOperationScope({ action: 'edit', rows: members, selectedIds: members.map(row => row.uuid ?? row.id) });
    const id = crypto.randomUUID();
    if (!session.store.begin({ id, kind: 'batch', targetIds, date: members[0]?.date }).ok) throw new Error('An affected food is already saving. Wait for it to finish.');
    try { return await action((path, body, method) => dispatch(path, body, method, id)); }
    finally { session.store.discard(id); }
  };
  return dispatch;
}
