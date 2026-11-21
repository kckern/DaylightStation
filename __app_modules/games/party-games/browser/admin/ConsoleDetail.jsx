import { ErrorState } from '../../../../../frontend/src/lib/ui/states.jsx';
import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { SimpleGrid, Card, Image, Text, Stack, Loader, Select, Group, Button, Alert } from '@mantine/core';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import { wsService } from "../../../../../frontend/src/services/WebSocketService.js";
import { useKioskLaunchTargets } from "./useKioskLaunchTargets.js";

const KIOSK_LAUNCH_TOPIC = 'kiosk.launch';
const KIOSK_LAUNCH_RESULT_TOPIC = 'kiosk.launch.result';

const RESULT_MESSAGES = {
  unavailable: 'Connection unavailable. Reconnect before launching.',
  unconfirmed: 'The device did not confirm the launch. Check the device before retrying.',
  not_allowed: 'That title is not on this device\'s allowlist.',
  intent_resolve_failed: 'The device could not resolve the game.',
  target_malformed: 'The game is misconfigured — no launch target.',
  fkb_unavailable: 'The device is not running the kiosk browser.'
};

const ConsoleDetail = () => {
  const logger = useMemo(() => getLogger().child({ component: 'ConsoleDetail' }), []);
  const { consoleId } = useParams();
  const { data, loading, error, reload } = useApiResource(`/api/v1/list/retroarch:${encodeURIComponent(consoleId)}`);
  const games = Array.isArray(data) ? data : data?.items || [];
  const [targetId, setTargetId] = useState(null);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null);

  const { targets, loading: targetsLoading, error: targetsError, reload: reloadTargets } = useKioskLaunchTargets();
  const targetsReady = !targetsLoading && !targetsError;
  const attemptRef = useRef(null);
  const clearAttempt = useCallback(() => {
    clearTimeout(attemptRef.current?.timer);
    attemptRef.current = null;
  }, []);

  useEffect(() => {
    setPending(null);
    setResult(null);
    return clearAttempt;
  }, [consoleId, targetId, clearAttempt]);

  useEffect(() => {
    logger.info('consoleDetail.mounted', { consoleId });
  }, [consoleId, logger]);

  // Default to the only target rather than making the parent pick from a list of one.
  useEffect(() => {
    if (targetsReady && !targetId && targets.length === 1) setTargetId(targets[0].deviceId);
  }, [targetsReady, targets, targetId]);

  const target = targetsReady ? targets.find(t => t.deviceId === targetId) : null;

  useWebSocketSubscription(KIOSK_LAUNCH_RESULT_TOPIC, (msg) => {
    const attempt = attemptRef.current;
    if (!attempt || msg?.deviceId !== attempt.deviceId || msg.contentId !== attempt.contentId) return;
    clearAttempt();
    setPending(null);
    setResult(msg);
    logger.info('launch.result', { contentId: msg.contentId, ok: msg.ok, error: msg.error });
  }, [clearAttempt, logger]);

  const handleLaunch = useCallback((game) => {
    if (!targetId || attemptRef.current) return;
    setResult(null);
    setPending(game.id);
    logger.info('launch.requested', { contentId: game.id, deviceId: targetId });
    const timer = setTimeout(() => {
      clearAttempt();
      setPending(null);
      setResult({ ok: false, error: 'unconfirmed' });
    }, 15000);
    attemptRef.current = { deviceId: targetId, contentId: game.id, timer };
    if (!wsService.sendEphemeral({ topic: KIOSK_LAUNCH_TOPIC, deviceId: targetId, contentId: game.id })) {
      clearAttempt();
      setPending(null);
      setResult({ ok: false, error: 'unavailable' });
    }
  }, [targetId, clearAttempt, logger]);

  if (loading) return <Loader />;
  if (error) return <ErrorState label="games" error={error} onRetry={reload} />;

  const canLaunch = (game) => !!target && target.allow.includes(game.id);

  return (
    <Stack p="md">
      <Group justify="space-between" align="center">
        <Text size="xl" fw={700}>{games[0]?.metadata?.parentTitle || consoleId}</Text>
        {targetsReady && targets.length > 0 && (
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

      {targetsError && <ErrorState label="Launch targets" error={targetsError} onRetry={reloadTargets} />}

      {targetsReady && targets.length === 0 && (
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
                disabled={!canLaunch(game) || pending !== null}
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
