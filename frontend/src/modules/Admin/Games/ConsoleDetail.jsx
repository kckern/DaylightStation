import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { SimpleGrid, Card, Image, Text, Stack, Loader, Select, Group, Button, Alert } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useWebSocketSend, useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { useKioskLaunchTargets } from './useKioskLaunchTargets.js';

const KIOSK_LAUNCH_TOPIC = 'kiosk.launch';
const KIOSK_LAUNCH_RESULT_TOPIC = 'kiosk.launch.result';

const RESULT_MESSAGES = {
  not_allowed: 'That title is not on this device\'s allowlist.',
  intent_resolve_failed: 'The device could not resolve the game.',
  target_malformed: 'The game is misconfigured — no launch target.',
  fkb_unavailable: 'The device is not running the kiosk browser.'
};

const ConsoleDetail = () => {
  const logger = useMemo(() => getLogger().child({ component: 'ConsoleDetail' }), []);
  const { consoleId } = useParams();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState(null);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null);

  const { targets, loading: targetsLoading } = useKioskLaunchTargets();
  const send = useWebSocketSend();

  useEffect(() => {
    logger.info('consoleDetail.mounted', { consoleId });
    fetch(`/api/v1/list/retroarch:${consoleId}`)
      .then(r => r.json())
      .then(data => {
        setGames(data?.items || data || []);
        setLoading(false);
      });
  }, [consoleId]);

  // Default to the only target rather than making the parent pick from a list of one.
  useEffect(() => {
    if (!targetId && targets.length === 1) setTargetId(targets[0].deviceId);
  }, [targets, targetId]);

  const target = targets.find(t => t.deviceId === targetId) || null;

  useWebSocketSubscription(KIOSK_LAUNCH_RESULT_TOPIC, (msg) => {
    if (!msg || msg.deviceId !== targetId) return;
    setPending(null);
    setResult(msg);
    logger.info('launch.result', { contentId: msg.contentId, ok: msg.ok, error: msg.error });
  }, [targetId, logger]);

  const handleLaunch = useCallback((game) => {
    if (!targetId) return;
    setResult(null);
    setPending(game.id);
    logger.info('launch.requested', { contentId: game.id, deviceId: targetId });
    send({ topic: KIOSK_LAUNCH_TOPIC, deviceId: targetId, contentId: game.id });
  }, [targetId, send, logger]);

  if (loading) return <Loader />;

  const canLaunch = (game) => !!target && target.allow.includes(game.id);

  return (
    <Stack p="md">
      <Group justify="space-between" align="center">
        <Text size="xl" fw={700}>{games[0]?.metadata?.parentTitle || consoleId}</Text>
        {!targetsLoading && targets.length > 0 && (
          <Select
            label="Launch on"
            placeholder="Pick a device"
            data={targets.map(t => ({ value: t.deviceId, label: t.label }))}
            value={targetId}
            onChange={setTargetId}
            allowDeselect={false}
            w={220}
          />
        )}
      </Group>

      {!targetsLoading && targets.length === 0 && (
        <Alert color="gray" variant="light">
          No launch targets configured. Add <code>launch.device_targets</code> to games.yml to
          launch a game on a device from here.
        </Alert>
      )}

      {target && (
        <Text size="sm" c="dimmed">
          {target.allow.length} of {games.length} titles available on {target.label}. Titles with a
          live save on another device are deliberately excluded.
        </Text>
      )}

      {result && (
        <Alert color={result.ok ? 'green' : 'red'} variant="light" onClose={() => setResult(null)} withCloseButton>
          {result.ok
            ? 'Launched.'
            : (RESULT_MESSAGES[result.error] || `Launch failed: ${result.error || 'unknown'}`)}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
        {games.map(game => (
          <Card key={game.id} padding="xs" withBorder>
            {game.thumbnail && <Image src={game.thumbnail} alt={game.title} height={160} fit="contain" />}
            <Text size="sm" ta="center" mt={4}>{game.title}</Text>
            {target && (
              <Button
                size="xs"
                mt={6}
                fullWidth
                variant={canLaunch(game) ? 'light' : 'subtle'}
                disabled={!canLaunch(game)}
                loading={pending === game.id}
                onClick={() => handleLaunch(game)}
              >
                {canLaunch(game) ? 'Launch' : 'Not on device'}
              </Button>
            )}
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
};

export default ConsoleDetail;
