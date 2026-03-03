import React from 'react';
import { Text, Title, Group, Stack, Badge, Paper } from '@mantine/core';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { DashboardCard } from '../_shared/DashboardCard.jsx';
import './FitnessUpNextWidget.scss';

function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx).trim(), localId: contentId.slice(colonIdx + 1).trim() };
}

function ContentThumbnail({ contentId }) {
  const { source, localId } = parseContentId(contentId);
  const thumbUrl = `/api/v1/display/${source}/${localId}`;
  return (
    <div className="content-thumbnail">
      <img src={thumbUrl} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
    </div>
  );
}

function UpNextCard({ curated, onPlay }) {
  if (!curated?.up_next?.primary) return null;
  const { primary, alternates } = curated.up_next;

  return (
    <DashboardCard className="dashboard-card--upnext">
      <Group gap="md" wrap="nowrap" align="flex-start">
        <ContentThumbnail contentId={primary.content_id} />
        <Stack gap="xs" style={{ flex: 1 }}>
          {primary.program_context && (
            <Text size="xs" c="dimmed" tt="uppercase">{primary.program_context}</Text>
          )}
          <Title order={3}>{primary.title}</Title>
          <Group gap="xs">
            <Badge variant="light">{primary.duration} min</Badge>
          </Group>
          <div
            className="dashboard-play-btn"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => { e.stopPropagation(); onPlay?.(primary); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(primary); }}
          >
            <Text fw={700} size="lg">Play</Text>
          </div>
        </Stack>
      </Group>
      {alternates?.length > 0 && (
        <div className="upnext-alternates">
          <Text size="xs" c="dimmed" mt="md" mb="xs">Or try:</Text>
          <Group gap="xs">
            {alternates.map((alt, i) => (
              <Paper
                key={i}
                className="alternate-chip"
                p="xs"
                radius="sm"
                onPointerDown={() => onPlay?.(alt)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(alt); }}
                role="button"
                tabIndex={0}
              >
                <Text size="sm">{alt.title}</Text>
                <Text size="xs" c="dimmed">{alt.duration} min</Text>
              </Paper>
            ))}
          </Group>
        </div>
      )}
    </DashboardCard>
  );
}

export default function FitnessUpNextWidget() {
  const dashboard = useScreenData('dashboard');
  const { onPlay } = useFitnessScreen();

  if (!dashboard?.dashboard?.curated) return null;

  const handlePlay = (contentItem) => {
    if (!contentItem?.content_id || !onPlay) return;
    const { source, localId } = parseContentId(contentItem.content_id);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: contentItem.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(`api/v1/display/${source}/${localId}`),
      duration: contentItem.duration,
    });
  };

  return <UpNextCard curated={dashboard.dashboard.curated} onPlay={handlePlay} />;
}
