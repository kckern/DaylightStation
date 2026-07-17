import { Text, Timeline } from '@mantine/core';
import { SourceIcon } from './shared/SourceIcon.jsx';
import { EmptyState } from '../../components/index.js';

/**
 * Vertical timeline showing source summaries for a single day.
 *
 * @param {Object} props
 * @param {Array} props.summaries - [{ source, category, text }]
 */
export function LogTimeline({ summaries = [] }) {
  if (summaries.length === 0) {
    return <EmptyState message="No activity recorded." />;
  }

  return (
    <Timeline active={summaries.length - 1} bulletSize={28} lineWidth={2}>
      {summaries.map((s, i) => (
        <Timeline.Item
          key={`${s.source}-${i}`}
          bullet={<SourceIcon source={s.source} size="sm" />}
          title={s.source}
        >
          <Text size="sm" c="dimmed">{s.category}</Text>
          <Text size="sm" mt={4}>{s.text}</Text>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
