// frontend/src/modules/Media/browse/DetailView.jsx
// One item, all its actions: artwork, description, Play Now / Play Next /
// Up Next / Add / Cast.
import React, { useState } from 'react';
import { Alert, Stack, Title, Text, Button, Group, Image } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd, IconAlertCircle } from '@tabler/icons-react';
import { useContentInfo } from './useContentInfo.js';
import { useContentDispatch } from '../search/useContentDispatch.js';
import { CastButton } from '../cast/CastButton.jsx';
import { useNav } from '../shell/NavProvider.jsx';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { ItemDestinationPicker } from '../actions/ItemDestinationPicker.jsx';
import { DestinationLine } from '../cast/DestinationLine.jsx';

export function DetailView({ contentId }) {
  const [oneShot, setOneShot] = useState(null);
  const { info, loading, error } = useContentInfo(contentId);
  const { dispatchLeafVerb } = useContentDispatch();
  const { pop, backDestination } = useNav();
  const back = (
    <Button variant="subtle" color="gray" data-testid="detail-back" className="detail-back" onClick={() => pop()}>
      ← {backDestination ?? 'Home'}
    </Button>
  );

  if (loading) {
    return (
      <Stack data-testid="detail-loading" gap="md" maw={520}>
        {back}
        <Skeleton height={280} radius="md" />
        <Skeleton height={28} width="60%" radius="sm" />
        <Skeleton height={44} radius="sm" />
      </Stack>
    );
  }
  if (error) {
    return <Stack data-testid="detail-error-state" gap="md">
      {back}
      <Alert data-testid="detail-error" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
        Couldn&rsquo;t load this item. Check the connection and try again.
        <details className="error-detail">
          <summary>Technical details</summary>
          {error.message}
        </details>
      </Alert>
    </Stack>;
  }
  if (!info) return <Stack data-testid="detail-empty" gap="md">{back}</Stack>;

  const detailItem = { id: contentId, ...info };

  return (
    <Stack data-testid="detail-view" className="detail-view" gap="md">
      {back}
      {info.thumbnail && (
        <Image src={info.thumbnail} alt={info.title ?? contentId} className="detail-poster" radius="md" />
      )}
      <Title order={1}>{info.title ?? contentId}</Title>
      {info.description && <Text c="dimmed">{info.description}</Text>}
      <DestinationLine surface="detail" />
      <Group className="detail-actions" gap="sm">
        <Button
          data-testid="detail-play-now"
          leftSection={<IconPlayerPlayFilled size={18} />}
          onClick={() => dispatchLeafVerb('playNow', contentId, detailItem)}
        >
          Play Now
        </Button>
        {isContainer(detailItem) && <Button variant="default" onClick={() => dispatchLeafVerb('shuffle', contentId, detailItem)}>Shuffle</Button>}
        <Button data-testid="detail-play-next" variant="default" leftSection={<IconPlayerTrackNext size={16} />}
                onClick={() => dispatchLeafVerb('playNext', contentId, detailItem)}>
          Play Next
        </Button>
        <Button data-testid="detail-up-next" variant="default" leftSection={<IconRowInsertTop size={16} />}
                onClick={() => dispatchLeafVerb('playFirst', contentId, detailItem)}>
          Play First
        </Button>
        <Button data-testid="detail-add" variant="default" leftSection={<IconPlaylistAdd size={16} />}
                onClick={() => dispatchLeafVerb('add', contentId, detailItem)}>
          Add to Queue
        </Button>
        <CastButton contentId={contentId} title={info.title ?? null} item={detailItem} />
        <Button variant="default" onClick={() => setOneShot({ kind: 'addOn', item: detailItem })}>Add on…</Button>
      </Group>
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
    </Stack>
  );
}

export default DetailView;
