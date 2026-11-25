import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Text } from '@mantine/core';
import { LoadingState, useRetryRegion } from '@/lib/ui';
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
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({}); // id -> { busy, result }
  // Load once per open: the caller's loadLog may be a fresh function each render.
  const loadRef = useRef(loadLog);
  loadRef.current = loadLog;

  const read = useCallback(async (isCurrent, signal) => {
    setLoadError(null);
    setLoading(true);
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
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [logger]);
  const onTimeout = useCallback(() => {
    setLoadError("Couldn't load what was done.");
    setLoading(false);
    logger.warn('triage.log.read_timeout');
  }, [logger]);
  const { reload: load } = useRefreshableRead(read, { timeoutMs: 10000, onTimeout });
  const { regionProps, retry } = useRetryRegion(load, loading);

  useEffect(() => { load(); }, [load]);

  const undo = async (id, restoreFocus) => {
    setState((s) => ({ ...s, [id]: { ...s[id], busy: true } }));
    let result;
    let retryable = false;
    try {
      const out = await onUndo(id);
      retryable = out?.outcome === 'failed' && out.reason === 'propose_failed';
      result = retryable
        ? 'Undo could not be started. Retry when ready.'
        : UNDO_RESULT[out?.outcome] ?? 'Could not confirm the undo. Check the item before trying again.';
    } catch (err) {
      result = err?.code === 'pass_running' || err?.code === 'busy'
        ? 'Triage is updating — try again in a moment.'
        : 'Could not confirm the undo. Check the item before trying again.';
    }
    logger.info('triage.log.undo', { entryId: id, result });
    setState((s) => ({ ...s, [id]: { busy: false, result, retryable, restoreFocus } }));
  };

  let content;
  if (loadError) content = (
    <div className="life-triage__log-state" role="status">
      <Text size="sm" c="dimmed">{loadError}</Text>
      <Button size="compact-sm" variant="light" onClick={retry}>Try again</Button>
    </div>
  );
  else if (!entries) content = <LoadingState label="what was done" rows={1} />;
  else if (entries.length === 0) content = <Text size="sm" c="dimmed">Nothing in the last week.</Text>;
  else content = <ActionRows entries={entries} state={state} undo={undo} />;

  return <section aria-label="Triage action log" {...regionProps}>{content}</section>;
}

function ActionRows({ entries, state, undo }) {
  const retryButtons = useRef(new Map());

  useEffect(() => {
    for (const entry of entries) {
      const entryState = state[entry.id];
      if (entryState?.retryable && entryState.restoreFocus) {
        retryButtons.current.get(entry.id)?.focus();
      }
    }
  }, [entries, state]);

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
                <Text size="xs" c="dimmed" id={`triage-action-${e.id}`}>
                  {actionWord(e.action)}{e.dryRun ? ' (dry run — not done)' : ''}{e.uncertain ? ' (unconfirmed)' : ''}
                </Text>
              </div>
              <Text size="sm" className="life-triage__log-title" id={`triage-title-${e.id}`} td={undone ? 'line-through' : undefined}>{e.title || 'Untitled'}</Text>
            </div>
            {undone ? (
              <Text size="xs" c="dimmed">Undone</Text>
            ) : e.undoable || st.result ? (
              <div className="life-triage__log-actions">
                {e.undoable && (!st.result || st.retryable) && (
                  <Button
                    key="undo"
                    ref={(node) => {
                      if (node) retryButtons.current.set(e.id, node);
                      else retryButtons.current.delete(e.id);
                    }}
                    size="compact-sm"
                    variant="default"
                    loading={st.busy}
                    aria-describedby={`triage-action-${e.id} triage-title-${e.id}`}
                    onClick={(event) => undo(e.id, event.currentTarget === document.activeElement)}
                  >
                    {st.retryable ? 'Retry undo' : 'Undo'}
                  </Button>
                )}
                {st.result && <Text key="result" size="xs" c="dimmed" role="status" className="life-triage__log-result">{st.result}</Text>}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default ActionLog;
