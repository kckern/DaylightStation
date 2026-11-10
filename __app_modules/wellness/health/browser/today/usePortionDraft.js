import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { foodPortion } from "../../portable/contracts/health/foodQuantity.mjs";
import { numericFoodPatches, numericFoodValue } from "../../portable/contracts/health/foodNumericEdit.mjs";
import { useHealthOperations } from "../operations/HealthOperationsProvider.jsx";
import { foodOperationScope } from "../operations/foodOperationScope.js";
import { BUCKETS } from "./mealBuckets.js";
import { entryId, entryError, isEntryConflict, updateEntry } from "./entryCommands.js";
import { projectPortions } from "./portionPreview.js";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";

const logger = createAppLogger('health').child('portion');
export const PortionContext = createContext(null);
export const usePortionControl = row => {
  const control = useContext(PortionContext);
  return row && control?.forRow ? control.forRow(row) : control;
};

export function usePortionDraft(day, date) {
  const session = useHealthOperations();
  const [drafts, setDrafts] = useState(new Map());
  const states = useRef(new Map());
  const focused = useRef(null);
  const caught = state => state?.status === 'saved' && state.versions && Object.entries(state.versions)
    .every(([id, version]) => day.items.some(row => String(entryId(row)) === String(id) && (row.version ?? 1) >= version));
  const visibleDrafts = [...drafts.values()].filter(state => state.date === date && !caught(state));
  const projected = useMemo(() => projectPortions(day.items, day.budget, visibleDrafts), [day.items, day.budget, drafts, date]);
  const byBucket = useMemo(() => {
    const map = new Map([...BUCKETS.map(bucket => [bucket.id, []]), [null, []]]);
    for (const row of projected.items) map.get(map.has(row.mealTime) ? row.mealTime : null).push(row);
    return map;
  }, [projected.items]);
  const forRow = (selectedRow, selectedField = 'portion') => {
    const key = String(entryId(selectedRow));
    const current = { get current() { return states.current.get(key); } };
    const draft = current.current;
    const caughtUp = caught(draft);
    const visible = draft?.date === date && !caughtUp ? draft : null;
    const scope = foodOperationScope({ action: 'edit', rows: day.items, selectedIds: [key] });
    const otherDraft = [...states.current.entries()].some(([id, state]) => id !== key && !caught(state)
      && foodOperationScope({ action: 'edit', rows: [state.row], selectedIds: [entryId(state.row)] }).some(id => scope.includes(id)));
    const write = value => {
      if (value) states.current.set(key, value); else states.current.delete(key);
      setDrafts(new Map(states.current));
    };
  const control = {
    draft: visible,
    saving: visible?.status === 'saving' || [...(session?.snapshot.operations.values() || [])].some(op => ['pending', 'reconciling'].includes(op.phase) && op.targetIds.some(id => scope.includes(id))),
    locked: key.startsWith('pending-') || otherDraft || Boolean(session?.store.isReserved(scope, visible?.operationId)) || Boolean(visible && ['saving', 'saved', 'reloading'].includes(visible.status)),
    begin(row = selectedRow, field = selectedField) {
      if (key.startsWith('pending-') || (current.current && !caughtUp) || otherDraft || session?.store.isReserved(scope)) return false;
      focused.current = key;
      const portion = foodPortion(row);
      const numericEdit = field === 'portion' ? null : { field, value: numericFoodValue(row, field) };
      if (numericEdit) {
        try { numericFoodPatches(row, numericEdit); } catch { return false; }
      } else if (!portion.value) return false;
      const operationId = crypto.randomUUID();
      if (session && !session.store.begin({ id: operationId, kind: 'numeric', phase: 'editing', date, targetIds: scope }).ok) return false;
      write({ row, portion, ...(numericEdit ? { numericEdit } : {}), date, operationId, status: 'editing' });
      logger.debug('begin', { id: entryId(row), field, unit: portion.unit });
      return true;
    },
    preview(value) {
      const state = current.current;
      if (!state || state.status !== 'editing' || !Number.isFinite(value)) return;
      if (state.numericEdit) {
        const numericEdit = { ...state.numericEdit, value };
        try { numericFoodPatches(state.row, numericEdit); }
        catch (error) { write({ ...state, validationError: error.message }); return; }
        write({ ...state, numericEdit, validationError: null });
      } else if (value > 0) write({ ...state, portion: { ...state.portion, value } });
    },
    cancel() { if (!['saving', 'saved', 'reloading'].includes(current.current?.status)) { session?.store.discard(current.current?.operationId); write(null); } },
    async retry() {
      const state = current.current;
      if (state?.status !== 'error') return;
      if (state.conflict) {
        write({ ...state, status: 'reloading' });
        // This is an explicit user rebase, never an automatic retry against
        // unseen membership. Require a fresh snapshot before resubmitting.
        try {
          const { DaylightAPI } = await import("../../../../../frontend/src/lib/api.mjs");
          const fresh = await DaylightAPI(`api/v1/health/day?date=${state.date}`);
          const row = fresh.items?.find(row => entryId(row) === entryId(state.row));
          if (!row) throw new Error('The entry is no longer on this day. Discard this draft and choose the correct entry.');
          const children = row.kind === 'group' ? fresh.items.filter(child => child.parentId != null && [row.id, row.uuid].includes(child.parentId)) : [];
          const previousIds = (state.row.children || []).map(entryId).sort();
          if (JSON.stringify(children.map(entryId).sort()) !== JSON.stringify(previousIds)) {
            throw new Error('Group membership changed. Discard this draft and review the updated group before adjusting it.');
          }
          const freshPortion = foodPortion({ ...row, children });
          if (state.numericEdit) numericFoodPatches({ ...row, children }, state.numericEdit);
          else if (!freshPortion.value || freshPortion.unit !== state.portion.unit) throw new Error('The portion unit changed or is unknown. Discard this draft and review the entry.');
          if (current.current?.operationId !== state.operationId) return;
          const operationId = crypto.randomUUID();
          session?.store.discard(state.operationId);
          session?.store.begin({ id: operationId, kind: 'numeric', phase: 'editing', date: state.date, targetIds: scope });
          write({ ...state, row: { ...row, children }, operationId, conflict: false });
        } catch (error) {
          if (current.current?.operationId === state.operationId) write({ ...state, error: error.message });
          return;
        }
      }
      return control.commit();
    },
    async commit() {
      const state = current.current;
      if (!state || !['editing', 'error'].includes(state.status) || state.validationError) return;
      if (state.numericEdit ? state.numericEdit.value === numericFoodValue(state.row, state.numericEdit.field)
        : state.portion.value === foodPortion(state.row).value) { session?.store.discard(state.operationId); write(null); return; }
      write({ ...state, status: 'saving' });
      try {
        const changes = state.numericEdit ? { numericEdit: state.numericEdit } : { portion: state.portion };
        let result;
        if (session) {
          session.store.transition(state.operationId, { request: { path: `api/v1/health/nutrilist/${entryId(state.row)}`, method: 'PUT', body: { ...changes, operationId: state.operationId, expectedVersion: state.row.version ?? 1, expectedVersions: Object.fromEntries([state.row, ...(state.row.children || [])].map(row => [entryId(row), row.version ?? 1])) } } });
          result = await session.execute(state.operationId);
          if (!session.isActive()) return;
        } else result = await updateEntry(state.row, changes, state.operationId);
        const versions = result.versions || (result.data?.version != null ? { [entryId(state.row)]: result.data.version } : {});
        if (current.current?.operationId === state.operationId) {
          if (session) write(null); // authoritative values now live in the reconciliation overlay
          else write({ ...state, status: 'saved', versions });
        }
        day.reload();
        logger.info('saved', { id: entryId(state.row), ...(state.numericEdit ? { numericEdit: state.numericEdit } : { portion: state.portion }) });
      } catch (error) {
        if (current.current?.operationId === state.operationId) write({ ...state, status: 'error', conflict: isEntryConflict(error), error: entryError(error) });
        day.reload();
        logger.warn('failed', { id: entryId(state.row), field: state.numericEdit?.field || 'portion', error: error.message });
      }
    },
  };
  return control;
  };
  const selected = states.current.get(focused.current);
  const legacy = selected ? forRow(selected.row, selected.numericEdit?.field || 'portion') : null;
  const control = { ...legacy, draft: legacy?.draft || null, drafts: visibleDrafts, forRow,
    begin: (row, field) => forRow(row, field).begin(row, field),
    ...Object.fromEntries(['preview', 'commit', 'retry', 'cancel'].map(method => [method, (...args) => {
      const state = states.current.get(focused.current);
      return state ? forRow(state.row, state.numericEdit?.field || 'portion')[method](...args) : undefined;
    }])),
  };
  return { ...projected, byBucket, control };
}
