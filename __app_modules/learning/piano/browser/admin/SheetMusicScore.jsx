import React, { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Stack, Text, Title } from '@mantine/core';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

/**
 * One score's admin page. The splat holds the full content id (it keeps its
 * slashes as path segments). Placeholder until the score editor lands.
 */
export default function SheetMusicScore() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-sheet-music' }), []);
  const params = useParams();
  const id = params['*'] || '';
  useEffect(() => { logger.info('admin.sheetmusic.score-mounted', { id }); }, [logger, id]);
  return (
    <Stack gap="xs" p="md">
      <Title order={3}>Sheet music</Title>
      <Text size="sm" ff="monospace">{id}</Text>
      <Text c="dimmed" size="sm">Score editor coming.</Text>
    </Stack>
  );
}
