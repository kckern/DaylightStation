import { DaylightAPI, daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Group, Text, Badge, Stack, Loader, Alert } from '@mantine/core';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { ErrorState } from '../../../../../frontend/src/lib/ui/states.jsx';
import GameScheduleEditor from "./GameScheduleEditor.jsx";
import { configPath } from "../../../../../frontend/src/modules/Admin/utils/adminConfigPaths.js";

const readConsoles = async signal => {
  const list = await DaylightAPI('/api/v1/list/retroarch', {}, 'GET', { signal });
  return Array.isArray(list) ? list : list?.items || [];
};
const readSyncStatus = signal => DaylightAPI('/api/v1/sync/retroarch/status', {}, 'GET', { signal });

const GamesIndex = () => {
  const logger = useMemo(() => getLogger().child({ component: 'GamesIndex' }), []);
  const view = useRef(null);
  const [syncError, setSyncError] = useState(null);
  const [consoles, setConsoles] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState(null);

  const [scheduleError, setScheduleError] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const loadSchedule = useCallback(async (signal, lifetime = signal) => {
    setScheduleLoading(true);
    try {
      const data = await DaylightAPI('/api/v1/content/schedule/retroarch', {}, 'GET', { signal });
      if (lifetime.aborted) return;
      setSchedule(data.schedule);
      setScheduleError(null);
    } catch (error) {
      if (!lifetime.aborted) setScheduleError(error);
    } finally {
      if (!lifetime.aborted) setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    logger.info('gamesIndex.mounted');
    const lifetime = new AbortController();
    view.current = lifetime;
    const initial = new AbortController();
    const deadline = setTimeout(() => initial.abort(), 5000);
    Promise.all([
      readConsoles(initial.signal).catch(() => []),
      readSyncStatus(initial.signal).catch(() => null),
      loadSchedule(initial.signal, lifetime.signal),
    ]).then(([list, status]) => {
      clearTimeout(deadline);
      if (lifetime.signal.aborted) return;
      setConsoles(list);
      setSyncStatus(status);
      setLoading(false);
    });
    return () => {
      clearTimeout(deadline);
      initial.abort();
      lifetime.abort();
    };
  }, [logger, loadSchedule]);

  const handleSync = async () => {
    const { signal } = view.current;
    setSyncing(true);
    setSyncError(null);
    logger.info('admin.sync.triggered', { source: 'retroarch' });
    try {
      const response = await daylightApiResponse('/api/v1/sync/retroarch', { method: 'POST' });
      if (!response.ok) throw new Error(`Sync failed (HTTP ${response.status})`);
      if (signal.aborted) return;
      const results = await Promise.allSettled([
        readConsoles(signal).then(list => { if (!signal.aborted) setConsoles(list); }),
        readSyncStatus(signal).then(status => { if (!signal.aborted) setSyncStatus(status); }),
      ]);
      if (signal.aborted) return;
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      logger.info('admin.sync.complete');
    } catch (err) {
      if (!signal.aborted) {
        setSyncError(err.message);
        logger.error('admin.sync.failed', { error: err.message });
      }
    } finally {
      if (!signal.aborted) setSyncing(false);
    }
  };

  const handleScheduleSave = async newSchedule => {
    const url = `/api/v1/admin/config/files/${configPath('games')}`;
    const { parsed, revision } = await DaylightAPI(url);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Could not read the current games configuration.');
    }
    if (typeof revision !== 'string') throw new Error('Could not read the current games configuration revision.');
    if (JSON.stringify(parsed.schedule ?? {}) !== JSON.stringify(schedule ?? {})) {
      throw new Error('The game schedule changed elsewhere. Reload before saving.');
    }
    const receipt = await DaylightAPI(url, { parsed: { ...parsed, schedule: newSchedule }, expectedRevision: revision }, 'PUT');
    if (receipt?.ok !== true) throw new Error('The server did not confirm the schedule save.');
    setSchedule(newSchedule);
    logger.info('schedule.saved', { schedule: newSchedule });
  };

  if (loading) return <Loader />;

  return (
    <Stack p="md">
      <Group justify="space-between">
        <Text size="xl" fw={700}>Games</Text>
        <Group>
          {syncStatus && (
            <Text size="sm" c="dimmed">
              {syncStatus.itemCount} games · Last synced {syncStatus.lastSynced ? new Date(syncStatus.lastSynced).toLocaleString() : 'never'}
            </Text>
          )}
          <Button onClick={handleSync} loading={syncing}>Sync from Device</Button>
        </Group>
      </Group>

      {syncError && <Alert color="red" role="alert">{syncError}</Alert>}
      {scheduleLoading ? <Loader aria-label="Loading game schedule" />
        : scheduleError ? <ErrorState label="Game schedule" error={scheduleError} onRetry={() => loadSchedule(view.current.signal)} />
        : <GameScheduleEditor schedule={schedule} onSave={handleScheduleSave} />}

      {consoles.map(c => (
        <Card key={c.id} padding="sm" withBorder component={Link} to={`/admin/content/games/${encodeURIComponent(c.localId || c.id?.split(':')[1])}`}>
          <Group justify="space-between">
            <Text fw={500}>{c.title}</Text>
            <Badge>{c.metadata?.gameCount || 0} games</Badge>
          </Group>
        </Card>
      ))}
    </Stack>
  );
};

export default GamesIndex;
