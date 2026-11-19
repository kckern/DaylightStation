// frontend/src/modules/Media/house/RoutineHistoryView.jsx
// Routine history (RQ-AUTO-05, AUTO.4a): recent routine starts — when, which
// screen, what, and how it went, with a failure's plain reason — and,
// ahead of time, the routines pointed at a screen that is off, unreachable,
// retired or unknown (GET /routines/history, /routines/flags; tech doc §2.6).
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { LoadingState, StateMessage } from '@/lib/ui/states.jsx';
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import { houseApi as defaultApi } from "./houseApi.js";
import { routineRunLine } from "./houseCopy.js";
import houseLog from "./houseLog.js";
import "./House.scss";

function useRoutineSection(read, section) {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const readSection = useCallback(async (isCurrent, signal) => {
    setState(current => ({ ...current, loading: true }));
    try {
      const result = await read(signal);
      if (!isCurrent()) return;
      const items = Array.isArray(result?.items) ? result.items : [];
      setState({ loading: false, items, error: null });
      houseLog.routinesLoaded({ section, [section === 'history' ? 'runs' : 'flags']: items.length });
    } catch (error) {
      if (!isCurrent()) return;
      setState(current => ({ ...current, loading: false, error }));
      houseLog.routinesFailed({ section, [section]: error?.message ?? null });
    }
  }, [read, section]);
  const { reload } = useRefreshableRead(readSection);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function RoutineReadError({ section, message, label, read }) {
  return (
    <StateMessage state="error" role="alert" title={message} data-testid={`routine-${section}-error`}>
      <Button variant="subtle" size="compact-sm" loading={read.loading} onClick={read.reload} aria-label={label}>
        Retry
      </Button>
    </StateMessage>
  );
}

export function RoutineHistoryView({ api = defaultApi }) {
  const readHistory = useCallback(signal => api.routineHistory({ limit: 50, signal }), [api]);
  const readFlags = useCallback(signal => api.routineFlags({ signal }), [api]);
  const history = useRoutineSection(readHistory, 'history');
  const flags = useRoutineSection(readFlags, 'flags');
  useEffect(() => { houseLog.viewOpened({ view: 'routines' }); }, []);

  const warnings = flags.items.filter((flag) => flag.severity === 'warn');
  const notes = flags.items.filter((flag) => flag.severity !== 'warn');
  const refresh = () => {
    history.reload();
    flags.reload();
  };

  return (
    <div className="fleet-view" data-testid="routine-history-view">
      <Group justify="space-between" align="center" mb="md">
        <Title order={1}>Routines</Title>
        <Button variant="subtle" className="house-action" leftSection={<IconRefresh size={16} aria-hidden />}
          loading={history.loading || flags.loading} onClick={refresh} data-testid="routine-history-refresh">
          Refresh
        </Button>
      </Group>

      {(warnings.length > 0 || notes.length > 0) && (
        <section className="house-section" aria-labelledby="routine-flags-title" data-testid="routine-flags">
          <Title order={2} size="h4" id="routine-flags-title">Before they run</Title>
          <ul className="house-list">
            {[...warnings, ...notes].map((flag) => (
              <li key={`${flag.routine?.id}|${flag.deviceId}|${flag.problem}`} className="house-item"
                data-testid={`routine-flag-${flag.routine?.id}`} data-severity={flag.severity}>
                <Text fw={600}>{flag.routine?.name ?? 'A routine'}</Text>
                <Text size="sm" className={flag.severity === 'warn' ? 'house-tone--warn' : 'house-tone--muted'}>
                  {flag.severity === 'warn' ? 'Needs attention: ' : ''}{flag.reason}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      )}
      {flags.error
        ? <RoutineReadError section="flags" message="Couldn't check routines against the screens right now." label="Retry routine flags" read={flags} />
        : flags.loading && !flags.items.length && <LoadingState label="routine flags" rows={1} />}

      <section className="house-section" aria-labelledby="routine-history-title">
        <Title order={2} size="h4" id="routine-history-title">Recent starts</Title>
        {history.error && (
          <RoutineReadError section="history" message="Couldn't load the routine history. Check the connection and try again." label="Retry routine history" read={history} />
        )}
        {history.items.length ? (
          <ul className="house-list" data-testid="routine-history-list">
            {history.items.map((run, i) => {
              const line = routineRunLine(run);
              return (
                <li key={`${run.at}|${run.routine?.id}|${i}`} className="house-item" data-testid="routine-run" data-outcome={run.outcome}>
                  <div className="house-item-head">
                    <Text size="sm" c="dimmed">{line.when}</Text>
                    <Text fw={600}>{line.routine}</Text>
                  </div>
                  <Text size="sm">{line.screen}{line.what ? ` — ${line.what}` : ''}</Text>
                  <Text size="sm" className={`house-tone--${line.tone}`} data-testid="routine-run-outcome">
                    {line.outcome}{line.reason ? `: ${line.reason}` : ''}
                  </Text>
                </li>
              );
            })}
          </ul>
        ) : !history.error && (history.loading ? (
          <LoadingState label="routine history">
            <Stack gap="xs">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius="md" />)}</Stack>
          </LoadingState>
        ) : (
          <Text c="dimmed" data-testid="routine-history-empty">No routine has started anything in the last 30 days.</Text>
        ))}
      </section>
    </div>
  );
}

export default RoutineHistoryView;
