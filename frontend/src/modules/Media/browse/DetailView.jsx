// frontend/src/modules/Media/browse/DetailView.jsx
// One item, all its actions: artwork, description, Play Now / Play Next /
// Up Next / Add / Cast.
import React from 'react';
import { Skeleton, Alert, Stack, Title, Text, Button, Group, Image } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd, IconAlertCircle } from '@tabler/icons-react';
import { useContentInfo } from './useContentInfo.js';
import { useSessionController } from '../controller/useSessionController.js';
import { resultToQueueInput } from '../search/resultToQueueInput.js';
import { CastButton } from '../cast/CastButton.jsx';

export function DetailView({ contentId }) {
  const { info, loading, error } = useContentInfo(contentId);
  const { queue } = useSessionController('local');

  if (loading) {
    return (
      <Stack data-testid="detail-loading" gap="md" maw={520}>
        <Skeleton height={280} radius="md" />
        <Skeleton height={28} width="60%" radius="sm" />
        <Skeleton height={44} radius="sm" />
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert data-testid="detail-error" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
        {error.message}
      </Alert>
    );
  }
  if (!info) return null;

  const input = resultToQueueInput({ id: contentId, ...info }) ?? { contentId };

  return (
    <Stack data-testid="detail-view" className="detail-view" gap="md">
      {info.thumbnail && (
        <Image src={info.thumbnail} alt={info.title ?? contentId} className="detail-poster" radius="md" />
      )}
      <Title order={1}>{info.title ?? contentId}</Title>
      {info.description && <Text c="dimmed">{info.description}</Text>}
      <Group className="detail-actions" gap="sm">
        <Button
          data-testid="detail-play-now"
          leftSection={<IconPlayerPlayFilled size={18} />}
          onClick={() => queue.playNow(input, { clearRest: true })}
        >
          Play Now
        </Button>
        <Button data-testid="detail-play-next" variant="default" leftSection={<IconPlayerTrackNext size={16} />}
                onClick={() => queue.playNext(input)}>
          Play Next
        </Button>
        <Button data-testid="detail-up-next" variant="default" leftSection={<IconRowInsertTop size={16} />}
                onClick={() => queue.addUpNext(input)}>
          Up Next
        </Button>
        <Button data-testid="detail-add" variant="default" leftSection={<IconPlaylistAdd size={16} />}
                onClick={() => queue.add(input)}>
          Add to Queue
        </Button>
        <CastButton contentId={contentId} title={info.title ?? null} />
      </Group>
    </Stack>
  );
}

export default DetailView;
