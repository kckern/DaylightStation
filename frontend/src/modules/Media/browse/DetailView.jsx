// frontend/src/modules/Media/browse/DetailView.jsx
// One item, all its actions: artwork, description, Play Now / Play Next /
// Up Next / Add / Cast.
import React, { useState } from 'react';
import { Stack, Title, Text, Button, Group, Image } from '@mantine/core';
import { IconChevronLeft, IconPlayerPlayFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd } from '@tabler/icons-react';
import { LoadErrorLine } from '../shared/LoadErrorLine.jsx';
import { useContentInfo } from './useContentInfo.js';
import { useContentDispatch } from '../search/useContentDispatch.js';
import { CastButton } from '../cast/CastButton.jsx';
import { useNav } from '../shell/NavProvider.jsx';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { ItemDestinationPicker } from '../actions/ItemDestinationPicker.jsx';
import { DestinationLine } from '../cast/DestinationLine.jsx';
import { useItemVerbs, householdEntryFor } from '../household/useItemVerbs.jsx';
import { useFavourites, useHouseholdEntry } from '../household/useHousehold.js';
import { spotsSummary, formatLeft, whereLine } from '../household/householdModel.js';
import { IconHeart, IconHeartFilled, IconEye, IconEyeOff } from '@tabler/icons-react';
import { useStartingOn } from '../cast/useStartingOn.js';
import { usePressHoldOffer } from '../../../lib/ui/usePressHoldOffer.js';
import mediaLog from '../logging/mediaLog.js';
import { resultSubtitle } from '../search/resultPresentation.js';

export function DetailView({ contentId }) {
  const [oneShot, setOneShot] = useState(null);
  const { info, loading, error, reload } = useContentInfo(contentId);
  const { dispatchLeafVerb } = useContentDispatch();
  const { pop, backDestination } = useNav();
  const { run, overlays, nameFor } = useItemVerbs();
  const favourites = useFavourites();
  const loadedEntry = useHouseholdEntry(contentId);
  // PLAY.5a/AC3: pressing and holding Play Next offers "At the very front".
  const { startingOnFor } = useStartingOn();
  const startingOn = startingOnFor(contentId);
  const playNextHold = usePressHoldOffer({ onOffered: () => mediaLog.playNextHoldOffered({ surface: 'detail' }) });
  const back = (
    <Button variant="subtle" color="gray" data-testid="detail-back" className="detail-back" onClick={() => pop()}>
      <IconChevronLeft size={16} aria-hidden /> {backDestination ?? 'Home'}
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
      <LoadErrorLine kind="item" testId="detail-error" onRetry={reload} />
    </Stack>;
  }
  if (!info) return <Stack data-testid="detail-empty" gap="md">{back}</Stack>;

  const detailItem = { id: contentId, ...info };
  const collection = isContainer(detailItem);
  // How far anyone has got, per screen (FIND.8a / PLAY.4a), when the
  // household lists already know this item.
  const entry = loadedEntry ?? householdEntryFor(contentId);
  const progress = entry && !entry.finished
    ? (spotsSummary(entry, nameFor)
      ?? [formatLeft(entry.playhead, entry.duration), whereLine(entry, nameFor)].filter(Boolean).join(' · '))
    : null;
  const favourite = favourites.has(contentId);
  // FIND.8a/AC2: what kind of thing it is and how long, in words ("Movie · 1 hr 56 min").
  const facts = resultSubtitle(detailItem);
  const description = info.description || info.metadata?.summary || null;

  return (
    <Stack data-testid="detail-view" className="detail-view" gap="md">
      {back}
      {info.thumbnail && (
        <Image src={info.thumbnail} alt={info.title ?? contentId} className="detail-poster" radius="md" />
      )}
      <Title order={1}>{info.title ?? contentId}</Title>
      {facts && <Text size="sm" c="dimmed" data-testid="detail-facts">{facts}</Text>}
      {description && <Text c="dimmed">{description}</Text>}
      {progress && <Text size="sm" data-testid="detail-progress">{progress}</Text>}
      {startingOn && <Text size="sm" data-testid="detail-starting" role="status">{startingOn}</Text>}
      <DestinationLine surface="detail" />
      <Group className="detail-actions" gap="sm">
        <Button
          data-testid="detail-play-now"
          leftSection={<IconPlayerPlayFilled size={18} />}
          onClick={() => (collection ? dispatchLeafVerb('playNow', contentId, detailItem) : run('playNow', detailItem, { entry }))}
        >
          Play Now
        </Button>
        {isContainer(detailItem) && <Button variant="default" onClick={() => dispatchLeafVerb('shuffle', contentId, detailItem)}>Shuffle</Button>}
        <Button data-testid="detail-play-next" variant="default" leftSection={<IconPlayerTrackNext size={16} />}
                {...playNextHold.bind}
                onClick={playNextHold.guardClick(() => dispatchLeafVerb('playNext', contentId, detailItem))}>
          Play Next
        </Button>
        {playNextHold.offered && (
          <Button data-testid="detail-play-next-front" variant="default" leftSection={<IconRowInsertTop size={16} />}
                  onClick={() => { mediaLog.playNextFrontChosen({ surface: 'detail' }); playNextHold.dismiss(); dispatchLeafVerb('playFirst', contentId, detailItem); }}>
            At the very front
          </Button>
        )}
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
        <Button variant="default" data-testid="detail-show-briefly" onClick={() => setOneShot({ kind: 'showBrieflyOn', item: detailItem })}>Show briefly on…</Button>
      </Group>
      <Group className="detail-actions" gap="sm">
        <Button
          data-testid="detail-favourite"
          variant="default"
          mih={44}
          aria-pressed={favourite}
          leftSection={favourite ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
          onClick={() => run(favourite ? 'unfavourite' : 'favourite', detailItem)}
        >
          {favourite ? 'Remove from favourites' : 'Add to favourites'}
        </Button>
        {!collection && (
          <>
            <Button data-testid="detail-watched" variant="default" mih={44} leftSection={<IconEye size={16} />}
                    onClick={() => run('watched', detailItem)}>
              Mark watched
            </Button>
            <Button data-testid="detail-unwatched" variant="default" mih={44} leftSection={<IconEyeOff size={16} />}
                    onClick={() => run('unwatched', detailItem)}>
              Mark unwatched
            </Button>
          </>
        )}
      </Group>
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
      {overlays}
    </Stack>
  );
}

export default DetailView;
