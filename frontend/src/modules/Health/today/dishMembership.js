// Add a food to a dish, or take one out, from the dish's own rows.
//
// Both are the meal command's `membership` action (MealFoodCommands.mjs) with
// the dish's next member list: the same write the "Edit groups" panel makes,
// so it carries the same version checks and the same Undo. Taking the last
// food out retires the dish header; the food itself is never deleted here.
import { useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('dish-membership');
const idOf = row => row.uuid || row.id;

/** Foods of this meal that could join `groupId`: anything not a dish and not already in it. */
export const dishCandidates = (rows, groupId) => rows.filter(row => row.kind !== 'group'
  && row.parentId !== groupId && !rows.some(other => other.parentId === idOf(row)));

export function useDishMembership({ date, bucket, rows, onChanged }) {
  const [busy, setBusy] = useState(null); // groupId while a write is in flight
  const [error, setError] = useState(null);
  const running = useRef(false);
  const save = async (groupId, members, event) => {
    if (running.current) return;
    running.current = true; setBusy(groupId); setError(null);
    const expectedVersions = Object.fromEntries(rows.map(row => [idOf(row), row.version ?? 1]));
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/meal-command', {
        date, bucket, action: 'membership', groupId, selectedIds: members, expectedVersions, operationId: crypto.randomUUID(),
      }, 'POST');
      logger.info(event, { date, bucket, groupId, members: members.length });
      onChanged?.(result);
    } catch (err) {
      setError({ groupId, message: err.message || 'Could not update this dish. Try again.' });
      logger.warn(`${event}-failed`, { date, bucket, groupId, error: err.message });
    } finally { running.current = false; setBusy(null); }
  };
  const membersOf = groupId => rows.filter(row => row.parentId === groupId).map(idOf);
  return {
    busy, error,
    add: (groupId, foodId) => save(groupId, [...membersOf(groupId), foodId], 'dish.add-food'),
    remove: (groupId, foodId) => save(groupId, membersOf(groupId).filter(id => id !== foodId), 'dish.remove-food'),
  };
}
