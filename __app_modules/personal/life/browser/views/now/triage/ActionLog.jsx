import { useMemo, useState } from 'react';
import { Button, Text } from '@mantine/core';
import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";

const ACTION_WORDS = { archive: 'Archived', complete: 'Closed', send: 'Sent', create_task: 'Made a todo', update_task: 'Rescheduled', keep: 'Kept' };
const actionWord = (a) => ACTION_WORDS[a] ?? a;

const UNDO_RESULT = {
  undone: 'Undone',
  already_undone: 'Undone',
  conflict: 'Changed since — not undone',
  not_undoable: "Can't be undone",
};

/**
 * What triage did, one row per entry, each with Undo where it has a clean inverse.
 * `entries` are recap entries ({ entryId, action, title, uncertain, undoneAt, undoable }).
 */
export function ActionLog({ entries = [], onUndo }) {
  const logger = useMemo(() => getLogger().child({ component: 'triage-action-log' }), []);
  const [state, setState] = useState({}); // entryId -> { busy, result }

  const undo = async (entryId) => {
    setState((s) => ({ ...s, [entryId]: { busy: true } }));
    let result;
    try {
      const out = await onUndo(entryId);
      result = UNDO_RESULT[out?.outcome] ?? "Couldn't undo — try again later";
    } catch (err) {
      result = err?.code === 'pass_running' || err?.code === 'busy'
        ? 'Triage is updating — try again in a moment.'
        : "Couldn't undo — try again later";
    }
    logger.info('triage.log.undo', { entryId, result });
    setState((s) => ({ ...s, [entryId]: { busy: false, result } }));
  };

  if (entries.length === 0) return <Text size="sm" c="dimmed">Nothing to show.</Text>;
  return (
    <ul className="life-triage__log" aria-label="What was done">
      {entries.map((e) => {
        const st = state[e.entryId] ?? {};
        const undone = !!e.undoneAt || st.result === 'Undone';
        return (
          <li key={e.entryId} className="life-triage__log-row">
            <div className="life-triage__log-text">
              <Text size="xs" c="dimmed">{actionWord(e.action)}{e.uncertain ? ' (unconfirmed)' : ''}</Text>
              <Text size="sm" className="life-triage__log-title" td={undone ? 'line-through' : undefined}>{e.title || 'Untitled'}</Text>
            </div>
            {undone ? (
              <Text size="xs" c="dimmed">Undone</Text>
            ) : st.result ? (
              <Text size="xs" c="dimmed" className="life-triage__log-result">{st.result}</Text>
            ) : e.undoable ? (
              <Button size="compact-sm" variant="default" loading={st.busy} onClick={() => undo(e.entryId)}>Undo</Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default ActionLog;
