import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { useHealthOperations } from './HealthOperationsProvider.jsx';
import { foodOperationScope } from './foodOperationScope.js';

/** An API-shaped dispatcher so every live command rechecks its targets at send time. */
export function useFoodMutation(rows = []) {
  const session = useHealthOperations();
  // What a live command would touch, or null when it runs outside the session.
  const scopeOf = (path, body, method) => {
    const item = path.match(/\/nutrilist\/([^/?]+)(?:\/(revise|revise-dish))?$/);
    const capture = /\/nutrition\/(input|day-input)$/.test(path);
    const command = /\/nutrition\/(meal-command|restore|meal-undo|foods-move)$/.test(path);
    if (!session || method === 'GET' || (!item && !command && !capture)) return null;
    const allRows = [...session.knownRows.values(), ...rows];
    const undoScope = session.undoScopes.get(body.undoToken);
    const selectedIds = body.action === 'groups' ? (body.groups || []).flatMap(group => group.selectedIds || []) : item ? [decodeURIComponent(item[1])] : body.selectedIds || body.entryIds || body.groups?.flatMap(group => group.selectedIds) || undoScope?.ids || [];
    // A food move holds exactly the rows it carries: not the old dish of a loose
    // food, and not a stranded part it leaves behind, which the reply never returns.
    const targetIds = path.endsWith('/nutrition/foods-move')
      ? foodOperationScope({ action: 'edit', rows: allRows.filter(row => Object.hasOwn(body.expectedVersions || {}, String(row.uuid ?? row.id))), selectedIds })
      : foodOperationScope({ action: body.action || (method === 'DELETE' || body.date || body.mealTime ? 'membership' : 'edit'), rows: allRows, selectedIds, groupId: body.groupId });
    return { capture, allRows, undoScope, selectedIds, targetIds };
  };
  const dispatch = async (path, body = {}, method = 'GET', parentId = undefined, onResult = undefined) => {
    parentId ||= body.parentOperationId;
    if (body.parentOperationId) { const { parentOperationId, ...payload } = body; body = payload; }
    const scope = scopeOf(path, body, method);
    if (!scope) {
      const result = await DaylightAPI(path, body, method);
      await onResult?.(result, null);
      return result;
    }
    const { capture, allRows, undoScope, selectedIds, targetIds } = scope;
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
  /** Why this command cannot start now, or null. Check it before showing the change. */
  dispatch.refusal = (path, body, method) => {
    const scope = scopeOf(path, body, method);
    if (!scope || session.store.getSnapshot().operations.has(body.operationId)) return null;
    if (scope.targetIds.some(id => id.startsWith('pending-'))) return 'A food is still saving.';
    return session.store.isReserved(scope.targetIds) ? 'An earlier change has not finished.' : null;
  };
  /** Free the foods of an operation the server definitely refused. A committed reply is never dropped. */
  dispatch.release = id => {
    if (session && !session.store.getSnapshot().operations.get(id)?.response) session.store.discard(id);
  };
  dispatch.withContinuation = (path, body, method, apply) => dispatch(path, body, method, undefined, apply);
  return dispatch;
}
