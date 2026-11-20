import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Loader, Text } from '@mantine/core';
import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";
import { useRefreshableRead } from "../../../../../../../frontend/src/lib/hooks/useRefreshableRead.js";

const ACTION_WORDS = { archive: 'Archived', complete: 'Closed', send: 'Sent', create_task: 'Made a todo', update_task: 'Rescheduled', keep: 'Kept' };
const actionWord = (a) => ACTION_WORDS[a] ?? a;

const UNDO_RESULT = {
  undone: 'Undone',
  already_undone: 'Undone',
  conflict: 'Changed since — not undone',
  not_undoable: "Can't be undone",
};

/**
 * Everything triage did lately, the automatic actions and the owner's own taps, each tagged
 * "auto" or "you", with Undo where the entry has an inverse and is not undone.
 * `loadLog({ signal })` resolves to the /log body ({ entries: [{ id, actor, action, title, dryRun,
 * uncertain, undoneAt, undoable }] }).
 */
export function ActionLog({ loadLog, onUndo }) {
  const logger = useMemo(() => getLogger().child({ component: 'triage-action-log' }), []);
  const [entries, setEntries] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [state, setState] = useState({}); // id -> { busy, result }
  // Load once per open: the caller's loadLog may be a fresh function each render.
  const loadRef = useRef(loadLog);
  loadRef.current = loadLog;

  const read = useCallback(async (isCurrent, signal) => {
    setLoadError(null);
    try {
      const out = await loadRef.current({ signal });
      if (!isCurrent()) return;
      setEntries(out?.entries ?? []);
      logger.debug('triage.log.loaded', { count: out?.entries?.length ?? 0 });
    } catch (err) {
      if (!isCurrent()) return;
      logger.warn('triage.log.load_failed', { code: err?.code ?? null, error: err?.message });
      setLoadError(err?.code === 'pass_running' || err?.code === 'busy'
        ? 'Triage is updating — try again in a moment.'
        : "Couldn't load what was done.");
    }
  }, [logger]);
  const onTimeout = useCallback(() => {
    setLoadError("Couldn't load what was done.");
    logger.warn('triage.log.read_timeout');
  }, [logger]);
  const { reload: load } = useRefreshableRead(read, { timeoutMs: 10000, onTimeout });

  useEffect(() => { load(); }, [load]);

  const undo = async (id) => {
    setState((s) => ({ ...s, [id]: { busy: true } }));
    let result;
    try {
      const out = await onUndo(id);
      result = UNDO_RESULT[out?.outcome] ?? "Couldn't undo — try again later";
    } catch (err) {
      result = err?.code === 'pass_running' || err?.code === 'busy'
        ? 'Triage is updating — try again in a moment.'
        : "Couldn't undo — try again later";
    }
    logger.info('triage.log.undo', { entryId: id, result });
    setState((s) => ({ ...s, [id]: { busy: false, result } }));
  };

  if (loadError) {
    return (
      <div className="life-triage__log-state" role="status">
        <Text size="sm" c="dimmed">{loadError}</Text>
        <Button size="compact-sm" variant="light" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!entries) return <Loader size="sm" aria-label="Loading what was done" />;
  if (entries.length === 0) return <Text size="sm" c="dimmed">Nothing in the last week.</Text>;
  return (
    <ul className="life-triage__log" aria-label="What was done">
      {entries.map((e) => {
        const st = state[e.id] ?? {};
        const undone = !!e.undoneAt || st.result === 'Undone';
        const owner = e.actor === 'owner';
        return (
          <li key={e.id} className="life-triage__log-row">
            <div className="life-triage__log-text">
              <div className="life-triage__log-meta">
                <Badge size="xs" variant={owner ? 'light' : 'outline'} color={owner ? undefined : 'gray'}>{owner ? 'you' : 'auto'}</Badge>
                <Text size="xs" c="dimmed">
                  {actionWord(e.action)}{e.dryRun ? ' (dry run — not done)' : ''}{e.uncertain ? ' (unconfirmed)' : ''}
                </Text>
              </div>
              <Text size="sm" className="life-triage__log-title" td={undone ? 'line-through' : undefined}>{e.title || 'Untitled'}</Text>
            </div>
            {undone ? (
              <Text size="xs" c="dimmed">Undone</Text>
            ) : st.result ? (
              <Text size="xs" c="dimmed" className="life-triage__log-result">{st.result}</Text>
            ) : e.undoable ? (
              <Button size="compact-sm" variant="default" loading={st.busy} onClick={() => undo(e.id)}>Undo</Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default ActionLog;
