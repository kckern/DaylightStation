import { useState, useCallback, useMemo } from 'react';
import { Stack, Paper, Title, Text, Button, Loader, TypographyStylesProvider } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import getLogger from '../../../../lib/logging/Logger.js';

export function Briefing({ username }) {
  const logger = useMemo(() => getLogger().child({ component: 'Briefing' }), []);
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    setError(null);
    logger.info('briefing-fetch-start');
    try {
      const qs = username ? `?username=${username}` : '';
      const res = await fetch(`/api/v1/life/now/briefing${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBriefing(data);
      logger.info('briefing-fetch-complete', { generated: data.generated });
    } catch (err) {
      setError(err.message);
      logger.error('briefing-fetch-error', { error: err.message });
    } finally {
      setLoading(false);
    }
  }, [username, logger]);

  if (!briefing && !loading) {
    return (
      <Paper p="md" withBorder>
        <Stack align="center" gap="sm">
          <Text size="sm" c="dimmed">Generate your daily briefing</Text>
          <Button size="sm" onClick={fetchBriefing}>Generate Briefing</Button>
        </Stack>
      </Paper>
    );
  }

  if (loading) {
    return (
      <Paper p="md" withBorder>
        <Stack align="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Generating briefing...</Text>
        </Stack>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper p="md" withBorder>
        <Text c="red" size="sm">{error}</Text>
        <Button size="xs" mt="sm" onClick={fetchBriefing}>Retry</Button>
      </Paper>
    );
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Title order={5}>Daily Briefing</Title>
        <TypographyStylesProvider>
          <div dangerouslySetInnerHTML={{ __html: briefing.text?.replace(/\n/g, '<br/>') || '' }} />
        </TypographyStylesProvider>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={fetchBriefing}
        >
          Refresh
        </Button>
      </Stack>
    </Paper>
  );
}
