import { Text, Timeline } from '@mantine/core';
import { SourceIcon, sourceLabel } from "./shared/SourceIcon.jsx";
import { EmptyState } from "../../components/index.js";

/**
 * Vertical timeline showing source summaries for a single day.
 *
 * @param {Object} props
 * @param {Array} props.summaries - [{ source, category, text }]
 * @param {Array} [props.sources] - [{ source, category }] including sources without summaries
 */
export function LogTimeline({ summaries = [], sources = [] }) {
  const summarizedSources = new Set(summaries.map(summary => summary.source));
  const entries = [
    ...summaries,
    ...sources.filter(source => !summarizedSources.has(source.source)).map(source => ({ ...source, text: null })),
  ];
  if (entries.length === 0) {
    return <EmptyState title="No activity to show in this view." />;
  }

  return (
    <Timeline active={entries.length - 1} bulletSize={28} lineWidth={2}>
      {entries.map((s, i) => (
        <Timeline.Item
          key={`${s.source}-${i}`}
          bullet={<SourceIcon source={s.source} size="sm" />}
          title={sourceLabel(s.source)}
        >
          <Text size="sm" c="dimmed">{s.category}</Text>
          {s.text ? <Text size="sm" mt={4} style={{ whiteSpace: 'pre-line' }}>{s.text}</Text>
            : <Text size="sm" mt={4} c="dimmed">Data available; no summary was generated.</Text>}
        </Timeline.Item>
      ))}
    </Timeline>
  );
}
