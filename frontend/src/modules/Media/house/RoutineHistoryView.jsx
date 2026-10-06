// frontend/src/modules/Media/house/RoutineHistoryView.jsx
// Routine history (RQ-AUTO-05, AUTO.4a): recent routine starts — when, which
// screen, what, and how it went, with a failure's plain reason — and,
// ahead of time, the routines pointed at a screen that is off, unreachable,
// retired or unknown (GET /routines/history, /routines/flags; tech doc §2.6).
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { houseApi as defaultApi } from './houseApi.js';
import { routineRunLine } from './houseCopy.js';
import houseLog from './houseLog.js';
import './House.scss';

export function RoutineHistoryView({ api = defaultApi }) {
  const [state, setState] = useState({ loading: true, runs: [], flags: [], error: null, flagsError: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const [history, flags] = await Promise.allSettled([api.routineHistory({ limit: 50 }), api.routineFlags()]);
    const runs = history.status === 'fulfilled' && Array.isArray(history.value?.items) ? history.value.items : [];
    const flagItems = flags.status === 'fulfilled' && Array.isArray(flags.value?.items) ? flags.value.items : [];
    const error = history.status === 'rejected' ? history.reason : null;
    const flagsError = flags.status === 'rejected' ? flags.reason : null;
    if (error || flagsError) houseLog.routinesFailed({ history: error?.message ?? null, flags: flagsError?.message ?? null });
    else houseLog.routinesLoaded({ runs: runs.length, flags: flagItems.length });
    setState({ loading: false, runs, flags: flagItems, error, flagsError });
  }, [api]);

  useEffect(() => { houseLog.viewOpened({ view: 'routines' }); load(); }, [load]);

  const warnings = state.flags.filter((f) => f.severity === 'warn');
  const notes = state.flags.filter((f) => f.severity !== 'warn');

  return (
    <div className="fleet-view" data-testid="routine-history-view">
      <Group justify="space-between" align="center" mb="md">
        <Title order={1}>Routines</Title>
        <Button variant="subtle" className="house-action" leftSection={<IconRefresh size={16} aria-hidden />}
          loading={state.loading} onClick={load} data-testid="routine-history-refresh">
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
      {state.flagsError && (
        <Text size="sm" c="dimmed" mb="md">Couldn't check routines against the screens right now.</Text>
      )}

      <section className="house-section" aria-labelledby="routine-history-title">
        <Title order={2} size="h4" id="routine-history-title">Recent starts</Title>
        {state.loading && !state.runs.length ? (
          <Stack gap="xs">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius="md" />)}</Stack>
        ) : state.error ? (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} data-testid="routine-history-error">
            Couldn't load the routine history. Check the connection and try again.
          </Alert>
        ) : state.runs.length === 0 ? (
          <Text c="dimmed" data-testid="routine-history-empty">No routine has started anything in the last 30 days.</Text>
        ) : (
          <ul className="house-list" data-testid="routine-history-list">
            {state.runs.map((run, i) => {
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
        )}
      </section>
    </div>
  );
}

export default RoutineHistoryView;
