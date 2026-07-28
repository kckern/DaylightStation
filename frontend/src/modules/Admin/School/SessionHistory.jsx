/**
 * SessionHistory — what a learner has actually done, per unit, as threads.
 *
 * The point of this screen is the LINEAGE. A child who failed a unit and was
 * given a fresh sheet has one story, not two rows: the console records that with
 * `remediationOf` on the retry's `created` event, and this page follows it so a
 * parent reads "Attempt 1 — needs remediation → Attempt 2 — passed" in one card.
 *
 * Every row costs one index read plus one event read per session, because the
 * index carries none of the detail (see `sessionLineage.js` for exactly why).
 * That fan-out is bounded by one learner's history and is done in parallel; a
 * single session whose log will not load is reported against that session
 * instead of blanking the page.
 *
 * READ-ONLY. Nothing on this screen writes, so nothing here is adult-gated —
 * the write surfaces are the review queue and the planner.
 *
 * @module Admin/School/SessionHistory
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Code, Divider, Group, Loader, Select, Stack, Text, Title,
} from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { schoolAdminApi } from './schoolAdminApi.js';
import { useRoster } from './useRoster.js';
import { deriveSession, buildThreads } from './sessionLineage.js';
import './SchoolAdmin.scss';

/** The session state machine, in words, with the colour a parent reads at a glance. */
const STATES = {
  created: { color: 'gray', label: 'Opened' },
  issued: { color: 'blue', label: 'Sheet printed' },
  reprinted: { color: 'blue', label: 'Sheet reprinted' },
  media_dispatched: { color: 'blue', label: 'Video sent' },
  media_completed: { color: 'blue', label: 'Video watched' },
  media_stalled: { color: 'orange', label: 'Video stalled' },
  submitted: { color: 'yellow', label: 'Handed in' },
  graded: { color: 'yellow', label: 'Graded' },
  outcome_recorded: { color: 'green', label: 'Finished' },
  rewarded: { color: 'green', label: 'Rewarded' },
  remediation_opened: { color: 'orange', label: 'Retry opened' },
  abandoned: { color: 'red', label: 'Abandoned' },
};

const OUTCOMES = {
  passed: { color: 'green', label: 'Passed' },
  needs_remediation: { color: 'red', label: 'Needs another go' },
};

const stateOf = (state) => STATES[state] ?? { color: 'gray', label: state || 'Not started' };

export default function SessionHistory() {
  const logger = useMemo(() => getLogger().child({ component: 'school-session-history' }), []);

  const { roster, error: rosterError, nameFor } = useRoster();
  const [learnerId, setLearnerId] = useState(null);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [eventErrors, setEventErrors] = useState([]);

  const seqRef = useRef(0);

  // Default to the first non-adult on the roster — the person whose homework
  // this screen is about.
  useEffect(() => {
    if (learnerId || !roster.length) return;
    const year = new Date().getFullYear();
    const child = roster.find((u) => !u.birthyear || year - u.birthyear < 18);
    setLearnerId((child ?? roster[0]).id);
  }, [roster, learnerId]);

  const load = useCallback(async (id) => {
    if (!id) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setEventErrors([]);
    logger.debug('history-load', { learnerId: id });
    try {
      const index = await schoolAdminApi.learnerSessions(id);
      const rows = Array.isArray(index?.sessions) ? index.sessions : [];

      // One event read per session. A failure on one is reported and that
      // session still renders — from its index row alone.
      const failures = [];
      const derived = await Promise.all(rows.map(async (row) => {
        try {
          const data = await schoolAdminApi.sessionEvents(row.sessionId);
          return deriveSession(row, data?.events ?? []);
        } catch (err) {
          failures.push({ sessionId: row.sessionId, message: err.message });
          logger.error('events-failed', { sessionId: row.sessionId, error: err.message, status: err.status });
          return deriveSession(row, []);
        }
      }));

      if (seq !== seqRef.current) {
        logger.debug('history-superseded', { seq, latest: seqRef.current });
        return;
      }
      setThreads(buildThreads(derived));
      setEventErrors(failures);
      logger.info('history-loaded', { learnerId: id, sessions: rows.length, threads: buildThreads(derived).length });
    } catch (err) {
      if (seq !== seqRef.current) return;
      setThreads([]);
      setError(err.message);
      logger.error('history-failed', { learnerId: id, error: err.message, status: err.status });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    logger.info('mounted', {});
    return () => logger.info('unmounted', {});
  }, [logger]);

  useEffect(() => { load(learnerId); }, [learnerId, load]);

  return (
    <Stack gap="md" p="md" className="school-admin">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Title order={3}>Work sessions</Title>
          <Text size="sm" c="dimmed">
            Every unit a learner has started. A unit that had to be done twice reads as one
            thread.
          </Text>
        </Stack>
        <Button variant="subtle" size="xs" onClick={() => load(learnerId)}>Refresh</Button>
      </Group>

      {rosterError && (
        <Alert color="red" title="Could not load the household roster">{rosterError}</Alert>
      )}

      <Select
        label="Learner"
        placeholder="Choose a learner"
        data={roster.map((u) => ({ value: u.id, label: u.name }))}
        value={learnerId}
        onChange={setLearnerId}
        allowDeselect={false}
        w={240}
      />

      {error && (
        <Alert color="red" title="Could not load this learner's sessions">{error}</Alert>
      )}

      {eventErrors.length > 0 && (
        <Alert color="orange" title="Some session logs would not load">
          <Stack gap={2}>
            {eventErrors.map((f) => (
              <Text size="sm" key={f.sessionId}>
                <Code>{f.sessionId}</Code> — {f.message}. Its detail below is incomplete.
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {loading && <Loader />}

      {!loading && !error && threads.length === 0 && learnerId && (
        <Card withBorder padding="lg" className="school-admin__empty">
          <Stack gap={4} align="center">
            <Text fw={600}>{nameFor(learnerId)} has not started anything yet.</Text>
            <Text size="sm" c="dimmed" ta="center">
              A session opens when they scan their card at the console and a sheet prints.
            </Text>
          </Stack>
        </Card>
      )}

      <Stack gap="md">
        {threads.map((chain) => {
          const head = chain[0];
          const last = chain[chain.length - 1];
          return (
            <Card withBorder padding="md" key={head.sessionId} data-testid="session-thread">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Group gap="xs" wrap="wrap">
                  <Text fw={600}>{head.unitId || 'unknown unit'}</Text>
                  {chain.length > 1 && (
                    <Badge color="orange" variant="light">
                      {chain.length} attempts
                    </Badge>
                  )}
                  {last.outcomeResult && (
                    <Badge color={(OUTCOMES[last.outcomeResult] ?? {}).color ?? 'gray'}>
                      {(OUTCOMES[last.outcomeResult] ?? {}).label ?? last.outcomeResult}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {last.updatedAt ? new Date(last.updatedAt).toLocaleString() : ''}
                </Text>
              </Group>

              <Stack gap="xs" mt="sm">
                {chain.map((session, index) => (
                  <div key={session.sessionId} className="school-admin__attempt">
                    {index > 0 && <Divider my="xs" labelPosition="left" label="then, after a retry was opened" />}
                    <Group gap="xs" wrap="wrap" align="center">
                      <Text size="sm" fw={600}>Attempt {index + 1}</Text>
                      <Badge size="sm" color={stateOf(session.state).color} variant="light">
                        {stateOf(session.state).label}
                      </Badge>
                      {session.terminal && <Badge size="sm" color="gray" variant="outline">closed</Badge>}
                      <Code>{session.sessionId}</Code>
                    </Group>

                    <Group gap="lg" mt={4} wrap="wrap">
                      <Text size="sm" c="dimmed">
                        Issued:{' '}
                        {session.issuedArtifacts.length
                          ? session.issuedArtifacts.join(', ')
                          : 'nothing yet'}
                        {session.reprints > 0 && ` (reprinted ${session.reprints}×, same sheet)`}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Attempts recorded: {session.attemptIds.length}
                      </Text>
                      <Text size="sm" c="dimmed">
                        Score: {session.gradedPercent === null ? 'not graded' : `${session.gradedPercent}%`}
                      </Text>
                      {session.transport && (
                        <Text size="sm" c="dimmed">Handed in: {session.transport}</Text>
                      )}
                    </Group>

                    {session.remediationOf && (
                      <Text size="sm" c="dimmed" mt={2}>
                        Retry of <Code>{session.remediationOf}</Code>
                      </Text>
                    )}
                    {session.remediationNewSessionId
                      && !chain.some((s) => s.sessionId === session.remediationNewSessionId) && (
                      <Text size="sm" c="orange" mt={2}>
                        Opened a retry, <Code>{session.remediationNewSessionId}</Code>, which is not
                        in this learner&apos;s list.
                      </Text>
                    )}
                    {session.lastFailure && (
                      <Text size="sm" c="red" mt={2}>
                        Failed at {session.lastFailure.stage}: {session.lastFailure.reason}
                      </Text>
                    )}
                  </div>
                ))}
              </Stack>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
}
