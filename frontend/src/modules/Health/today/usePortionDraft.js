import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { foodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { numericFoodPatches, numericFoodValue } from '@shared-contracts/health/foodNumericEdit.mjs';
import { BUCKETS } from './mealBuckets.js';
import { entryId, entryError, isEntryConflict, updateEntry } from './entryCommands.js';
import { projectPortion } from './portionPreview.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('portion');
export const PortionContext = createContext(null);
export const usePortionControl = () => useContext(PortionContext);

export function usePortionDraft(day, date) {
  const [draft, setDraft] = useState(null);
  const current = useRef(null);
  const write = value => { current.current = value; setDraft(value); };
  useEffect(() => {
    if (current.current?.date !== date) write(null);
  }, [date]);
  // Retire a successful overlay only once the read model contains the command.
  const caughtUp = draft?.status === 'saved' && draft.versions
    && Object.entries(draft.versions).every(([id, version]) => day.items.some(row => entryId(row) === id && (row.version ?? 1) >= version));
  const visible = draft?.date === date && !caughtUp ? draft : null;
  const projected = useMemo(() => projectPortion(day.items, day.budget, visible), [day.items, day.budget, visible]);
  const byBucket = useMemo(() => {
    const map = new Map([...BUCKETS.map(bucket => [bucket.id, []]), [null, []]]);
    for (const row of projected.items) map.get(map.has(row.mealTime) ? row.mealTime : null).push(row);
    return map;
  }, [projected.items]);
  const control = {
    draft: visible,
    locked: Boolean(visible && ['saving', 'saved', 'reloading'].includes(visible.status)),
    begin(row, field = 'portion') {
      if (current.current && !caughtUp) return false;
      const portion = foodPortion(row);
      const numericEdit = field === 'portion' ? null : { field, value: numericFoodValue(row, field) };
      if (numericEdit) {
        try { numericFoodPatches(row, numericEdit); } catch { return false; }
      } else if (!portion.value) return false;
      write({ row, portion, ...(numericEdit ? { numericEdit } : {}), date, operationId: crypto.randomUUID(), status: 'editing' });
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
    cancel() { if (!['saving', 'saved', 'reloading'].includes(current.current?.status)) write(null); },
    async retry() {
      const state = current.current;
      if (state?.status !== 'error') return;
      if (state.conflict) {
        write({ ...state, status: 'reloading' });
        // This is an explicit user rebase, never an automatic retry against
        // unseen membership. Require a fresh snapshot before resubmitting.
        try {
          const { DaylightAPI } = await import('../../../lib/api.mjs');
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
          write({ ...state, row: { ...row, children }, operationId: crypto.randomUUID(), conflict: false });
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
        : state.portion.value === foodPortion(state.row).value) { write(null); return; }
      write({ ...state, status: 'saving' });
      try {
        const result = await updateEntry(state.row, state.numericEdit ? { numericEdit: state.numericEdit } : { portion: state.portion }, state.operationId);
        // One group command increments each changed member once. The root may
        // stay unchanged when its mass is unknown; trust the response version.
        const versions = result.versions || Object.fromEntries([state.row, ...(state.row.children || [])].map(row =>
          [entryId(row), entryId(row) === entryId(state.row) ? result.data.version : (row.version ?? 1) + 1]));
        if (current.current?.operationId === state.operationId) write({ ...state, status: 'saved', versions });
        day.reload();
        logger.info('saved', { id: entryId(state.row), ...(state.numericEdit ? { numericEdit: state.numericEdit } : { portion: state.portion }) });
      } catch (error) {
        if (current.current?.operationId === state.operationId) write({ ...state, status: 'error', conflict: isEntryConflict(error), error: entryError(error) });
        day.reload();
        logger.warn('failed', { id: entryId(state.row), field: state.numericEdit?.field || 'portion', error: error.message });
      }
    },
  };
  return { ...projected, byBucket, control };
}
