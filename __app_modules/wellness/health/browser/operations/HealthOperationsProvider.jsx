import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { foodOperationScope } from "./foodOperationScope.js";
import { createHealthOperations } from './healthOperations.js';
import { createHealthReconciliation } from './healthReconciliation.js';
import { normalizeFoodOperationResult } from './healthOperationResults.js';
import { primeApiResource, peekApiResource, patchApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { healthDayPath, refreshHealthResources } from '../healthResources.js';

const Context = createContext(null);
const EMPTY = { operations: new Map(), revision: 0 };
const subscribeEmpty = () => () => {};
const getEmpty = () => EMPTY;

export function HealthOperationsProvider({ userId, children, send = DaylightAPI }) {
  // The keyed owner also disposes requests when the confirmed user changes.
  return <Session key={userId} userId={userId} send={send}>{children}</Session>;
}
function Session({ userId, children, send }) {
  const store = useMemo(() => createHealthOperations({ userId }), [userId]);
  const running = useRef(new Map());
  const continuations = useRef(new Map());
  const reconciliation = useMemo(createHealthReconciliation, [userId]);
  const lease = useRef(null);
  const knownRows = useRef(new Map());
  const undoScopes = useRef(new Map());
  const logger = useMemo(() => createAppLogger("health").child("food-operations"), []);
  useEffect(() => {
    const token = { active: true }; lease.current = token;
    return () => {
      token.active = false;
      // StrictMode can replay an effect; disposal belongs to the departed session.
      queueMicrotask(() => { if (lease.current === token) { store.dispose(); reconciliation.dispose(); continuations.current.clear(); } });
    };
  }, [store, reconciliation]);
  const value = useMemo(() => {
    const accept = async (response, op, owner) => {
      if (!op.date || !op.request.path.startsWith('api/v1/health/')) return;
      let result = normalizeFoodOperationResult(op, response);
      if (response.undoToken) undoScopes.current.set(response.undoToken, { ids: [...new Set([...(op.targetIds || []), ...result.resultIds, ...(response.affectedIds || [])].map(String))], date: op.date, bucket: op.bucket });
      if (result.outcome !== 'committed') return;
      reconciliation.acknowledge(op, result);
      if (result.readRequired) {
        store.transition(op.id, { phase: 'reconciling', response });
        // A failed refresh retries THIS read, never a write already acknowledged.
        const dates = result.affectedDates.length ? result.affectedDates : [op.date];
        const rows = [];
        for (const date of dates) {
          const readToken = reconciliation.beginRead();
          const fresh = await send(healthDayPath(date));
          if (!owner?.active || store.disposed) return;
          const current = fresh.items || fresh.data || [];
          if (Object.entries(result.versions).some(([id, version]) => {
            const row = current.find(row => String(row.uuid ?? row.id) === String(id));
            return row?.date === date && (row.version ?? 0) < version;
          })) throw new Error('Saved changes are still refreshing. Retry refresh.');
          const projected = reconciliation.reconcile({ date, rows: current, budget: fresh.budget, readToken });
          const snapshot = { ...fresh, items: projected.rows, budget: projected.budget };
          if (!patchApiResource(healthDayPath(date), () => snapshot)) primeApiResource(healthDayPath(date), snapshot);
          rows.push(...current);
        }
        result = { ...result, rows, removedIds: (op.targetIds || []).filter(id => !rows.some(row => String(row.uuid ?? row.id) === id)) };
        reconciliation.acknowledge(op, result);
      }
      store.transition(op.id, { normalizedResult: result });
    };
    const execute = (id, onResult) => {
      if (onResult) continuations.current.set(id, onResult);
      if (running.current.has(id)) return running.current.get(id);
      const op = store.getSnapshot().operations.get(id);
      if (!op || store.disposed) return Promise.resolve();
      const owner = lease.current;
      const submittedEpoch = op.submittedEpoch ?? reconciliation.beginRead();
      const submitted = { ...op, submittedEpoch };
      store.transition(id, { phase: 'pending', error: null, submittedEpoch });
      logger.info('operation.pending', { operationId: id, kind: op.kind, affected: op.targetIds.length });
      const request = op.response ? Promise.resolve(op.response) : send(op.request.path, structuredClone(op.request.body), op.request.method);
      const promise = Promise.resolve(request).then(async response => {
        if (!owner?.active || store.disposed) return;
        await accept(response, submitted, owner);
        if (!owner?.active || store.disposed) return;
        const continuation = continuations.current.get(id);
        if (continuation) {
          store.transition(id, { response }); // resume application from this exact proposal
          await continuation(response, op);
        }
        if (owner.active) {
          const outcome = normalizeFoodOperationResult(op, response).outcome;
          store.transition(id, ['committed', 'proposal'].includes(outcome) ? { phase: 'succeeded', response } : {
            phase: outcome, response, error: response.message || response.responseText || 'No food was logged. Review the submitted sentence and try a new entry.',
          });
        }
        if (owner.active && normalizeFoodOperationResult(op, response).outcome === "committed") refreshHealthResources();
        logger.info("operation.finished", { operationId: id, kind: op.kind, affected: op.targetIds.length, elapsedMs: Date.now() - op.startedAt });
        continuations.current.delete(id);
        return response;
      }).catch(error => {
        if (owner?.active && !store.disposed) store.transition(id, { phase: error.status === 409 ? 'conflict' : 'error', error: error.message });
        throw error;
      }).finally(() => running.current.delete(id));
      running.current.set(id, promise);
      return promise;
    };
    const submitSentence = ({ text, date, bucket, clarification }) => {
      const id = crypto.randomUUID();
      const day = peekApiResource(healthDayPath(date));
      const expectedVersions = Object.fromEntries((day?.items || []).map(row => [String(row.uuid ?? row.id), row.version ?? 1]));
      const body = { type: 'text', content: text, operationId: id, ...(clarification ? { clarification } : {}), ...(date ? { date } : {}), ...(bucket ? { bucket } : {}), ...(day?.items ? { expectedVersions } : {}) };
      const targetIds = clarification ? foodOperationScope({ action: 'edit', rows: [...knownRows.current.values()], selectedIds: [clarification] }) : [];
      if (!store.begin({ id, kind: 'sentence', date, bucket, targetIds, request: { path: 'api/v1/health/nutrition/input', method: 'POST', body } }).ok) return null;
      execute(id).catch(() => {});
      return id;
    };
    return { store, reconciliation, knownRows: knownRows.current, undoScopes: undoScopes.current, execute, submitSentence, retry: execute, isActive: () => Boolean(lease.current?.active) && !store.disposed };
  }, [store, send, reconciliation, logger]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHealthOperations() {
  const context = useContext(Context);
  const snapshot = useSyncExternalStore(context?.store.subscribe || subscribeEmpty, context?.store.getSnapshot || getEmpty);
  return context ? { ...context, snapshot } : null;
}
