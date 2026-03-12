import { Stack, Title, Text, Loader } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';
import { LogTimeline } from './LogTimeline.jsx';

/**
 * Full day detail view showing all sources as a timeline.
 *
 * @param {Object} props
 * @param {string} props.date - YYYY-MM-DD
 * @param {string} [props.username]
 */
export function LogDayDetail({ date, username }) {
  const { data, loading, error } = useLifelog({ date, username });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  return (
    <Stack gap="md">
      <Title order={4}>{date}</Title>
      <LogTimeline summaries={data?.summaries || []} />
    </Stack>
  );
}
