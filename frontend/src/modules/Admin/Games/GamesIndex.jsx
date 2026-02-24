import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Group, Text, Badge, Stack, Loader } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import GameScheduleEditor from './GameScheduleEditor.jsx';

const GamesIndex = () => {
  const logger = useMemo(() => getLogger().child({ component: 'GamesIndex' }), []);
  const navigate = useNavigate();
  const [consoles, setConsoles] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState(null);

  useEffect(() => {
    logger.info('gamesIndex.mounted');
    const withTimeout = (promise, ms = 5000) => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
      return Promise.race([promise, timeout]);
    };
    Promise.all([
      withTimeout(fetch('/api/v1/list/retroarch').then(r => r.json())).catch(() => []),
      withTimeout(fetch('/api/v1/sync/retroarch/status').then(r => r.json())).catch(() => null),
      withTimeout(fetch('/api/v1/content/schedule/retroarch').then(r => r.json())).catch(() => null)
    ]).then(([list, status, scheduleData]) => {
      setConsoles(list?.items || list || []);
      setSyncStatus(status);
      setSchedule(scheduleData?.schedule || null);
      setLoading(false);
    });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    logger.info('admin.sync.triggered', { source: 'retroarch' });
    try {
      await fetch('/api/v1/sync/retroarch', { method: 'POST' });
      const status = await fetch('/api/v1/sync/retroarch/status').then(r => r.json());
      setSyncStatus(status);
      const list = await fetch('/api/v1/list/retroarch').then(r => r.json());
      setConsoles(list?.items || list || []);
      logger.info('admin.sync.complete');
    } catch (err) {
      logger.error('admin.sync.failed', { error: err.message });
    }
    setSyncing(false);
  };

  const handleScheduleSave = async (newSchedule) => {
    const configRes = await fetch('/api/v1/admin/config/files/household/config/games.yml');
    const configData = await configRes.json();
    const parsed = configData.parsed || {};
    parsed.schedule = newSchedule;
    await fetch('/api/v1/admin/config/files/household/config/games.yml', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parsed })
    });
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

      <GameScheduleEditor schedule={schedule} onSave={handleScheduleSave} />

      {consoles.map(c => (
        <Card key={c.id} padding="sm" withBorder onClick={() => navigate(`/admin/content/games/${c.localId || c.id?.split(':')[1]}`)} style={{ cursor: 'pointer' }}>
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
