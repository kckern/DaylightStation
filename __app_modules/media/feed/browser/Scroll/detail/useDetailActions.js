import { useLayoutEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { useKeyedSubmission } from '../../../../../../frontend/src/lib/ui/useKeyedSubmission.js';

const log = getLogger().child({ app: 'feed', module: 'detail-actions' });
const actionRequest = action => [action.endpoint, action.body || {}, action.method || 'POST'];

// Detail sections and JSON object fields can arrive in a different order on re-read.
function actionSignature(action) {
  return JSON.stringify([action.id, ...actionRequest(action)], (_, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

/** Commands stay admitted across layouts. Refusal feedback belongs to an article visit. */
export function useDetailActions(itemId) {
  const visit = useRef(null);
  const { pending, run: submit } = useKeyedSubmission();
  const [errors, setErrors] = useState(() => new Map());

  useLayoutEffect(() => {
    visit.current = { itemId };
    setErrors(previous => previous.size ? new Map() : previous);
    return () => { visit.current = null; };
  }, [itemId]);

  const keyFor = action => JSON.stringify([itemId, actionSignature(action)]);

  const run = (section, action) => {
    const submittingVisit = visit.current;
    if (!itemId || submittingVisit?.itemId !== itemId) return;
    return submit(keyFor(action), async () => {
      setErrors(previous => {
        if (!previous.has(section)) return previous;
        const next = new Map(previous);
        next.delete(section);
        return next;
      });
      try {
        await DaylightAPI(...actionRequest(action));
      } catch (error) {
        log.error('feed.detail.action_failed', { actionId: action.id, error: error.message });
        if (visit.current === submittingVisit) {
          setErrors(previous => new Map(previous).set(section, `Could not ${action.label.toLowerCase()}. Try again.`));
        }
      }
    });
  };

  return {
    forSection(actions) {
      const section = JSON.stringify(actions.map(actionSignature).sort());
      return { error: errors.get(section), pending: action => pending.has(keyFor(action)), run: action => run(section, action) };
    },
  };
}
