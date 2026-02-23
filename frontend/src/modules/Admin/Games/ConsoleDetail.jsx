import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { SimpleGrid, Card, Image, Text, Stack, Loader } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';

const ConsoleDetail = () => {
  const logger = useMemo(() => getLogger().child({ component: 'ConsoleDetail' }), []);
  const { consoleId } = useParams();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('consoleDetail.mounted', { consoleId });
    fetch(`/api/v1/list/retroarch:${consoleId}`)
      .then(r => r.json())
      .then(data => {
        setGames(data?.items || data || []);
        setLoading(false);
      });
  }, [consoleId]);

  if (loading) return <Loader />;

  return (
    <Stack p="md">
      <Text size="xl" fw={700}>{games[0]?.metadata?.parentTitle || consoleId}</Text>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
        {games.map(game => (
          <Card key={game.id} padding="xs" withBorder>
            {game.thumbnail && <Image src={game.thumbnail} alt={game.title} height={160} fit="contain" />}
            <Text size="sm" ta="center" mt={4}>{game.title}</Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
};

export default ConsoleDetail;
