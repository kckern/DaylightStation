import { ItemQualityButton } from "../quality/PlaybackQualityButtons.jsx";
// frontend/src/modules/Media/browse/DetailView.jsx
// One item, all its actions: artwork, description, then ONE primary play
// that names where it goes ("▶ Play on Office Screen" — the aim, else the
// screen this browser learned for this kind of thing, else "here"), with
// Play here / Play on… beside it for the other places, then the queue verbs.
// Opening this page never plays anything: it is where a look lands. It does
// ask the server to prepare the start on that screen (cast/usePrepareStart.js),
// which touches no screen. A video may be previewed inside its art
// (InfoPreview: muted, on this device, records nothing); every play verb
// stops that preview before it dispatches.
import React, { useEffect, useRef, useState } from 'react';
import { Stack, Title, Text, Button, Group } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd, IconCast } from '@tabler/icons-react';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { EmptyState } from '@/lib/ui/states.jsx';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import { useContentInfo } from "./useContentInfo.js";
import { useContentDispatch } from "../search/useContentDispatch.js";
import { useNav } from "../shell/NavProvider.jsx";
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { useItemVerbs } from "../household/useItemVerbs.jsx";
import { useFavourites, useHouseholdEntry } from "../household/useHousehold.js";
import { spotsSummary, formatLeft, whereLine } from "../household/householdModel.js";
import { IconHeart, IconHeartFilled, IconEye, IconEyeOff } from '@tabler/icons-react';
import { useStartingOn } from "../cast/useStartingOn.js";
import { usePressHoldOffer } from "../../../../../frontend/src/lib/ui/usePressHoldOffer.js";
import mediaLog from "../logging/mediaLog.js";
import { resultSubtitle } from "../search/resultPresentation.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { usePrepareStart } from "../cast/usePrepareStart.js";
import { InfoPreview } from "./InfoPreview.jsx";

// `focusPlay`: opened from search — PLAY takes focus once it can be pressed,
// so a second Enter plays by that button's own activation (no key handler
// here: a stray Enter elsewhere plays nothing). The Enter that opened the
// page may still be held when PLAY takes focus: its auto-repeat keydowns
// (repeat: true) are default-prevented, so one long press is not two.
export function DetailView({ contentId, focusPlay = false }) {
  const [oneShot, setOneShot] = useState(null);
  const playRef = useRef(null);
  const previewRef = useRef(null);
  // Synchronously, before any play verb dispatches: a preview never overlaps a play.
  const stopPreview = () => previewRef.current?.stop();
  const playFocusedRef = useRef(false);
  const { info, loading, error, reload } = useContentInfo(contentId);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const { dispatchLeafVerb } = useContentDispatch();
  const { pop, backDestination } = useNav();
  const { run, overlays, nameFor } = useItemVerbs();
  const { destinationFor, labelsFor } = usePlayDestination();
  const favourites = useFavourites();
  const { entry, pending: pendingResume } = useHouseholdEntry(contentId);
  // PLAY.5a/AC3: pressing and holding Play Next offers "At the very front".
  const { startingOnFor } = useStartingOn();
  const startingOn = startingOnFor(contentId);
  const playNextHold = usePressHoldOffer({ onOffered: () => mediaLog.playNextHoldOffered({ surface: 'detail' }) });
  const playReady = !!info && !loading && !error;
  // Prepare on look: warm the start on the screen PLAY names (server-side
  // only — nothing reaches that screen until PLAY).
  const lookedAt = playReady ? { id: contentId, ...info } : null;
  usePrepareStart(lookedAt, lookedAt ? destinationFor(lookedAt).targetIds : []);
  useEffect(() => {
    if (!focusPlay || playFocusedRef.current || !playReady) return;
    const el = playRef.current;
    if (!el || el.disabled) return;
    playFocusedRef.current = true;
    el.focus({ preventScroll: true });
  }, [focusPlay, playReady, pendingResume]);
  const back = (
    <Button variant="subtle" color="gray" data-testid="detail-back" className="detail-back" onClick={() => pop()}>
      <UiIcon name="back" /> {backDestination ?? 'Home'}
    </Button>
  );

  let surface = 'detail-empty';
  let body;
  if (loading) {
    surface = 'detail-loading';
    body = (
      <>
        <Skeleton height={280} radius="md" />
        <Skeleton height={28} width="60%" radius="sm" />
        <Skeleton height={44} radius="sm" />
      </>
    );
  } else if (error) {
    surface = 'detail-error-state';
    body = <LoadErrorLine kind="item" testId="detail-error" onRetry={retry} />;
  } else if (info) {
    surface = 'detail-view';
    const detailItem = { id: contentId, ...info };
    const collection = isContainer(detailItem);
    // How far anyone has got, per screen (FIND.8a / PLAY.4a), when the
    // household lists already know this item.
    const progress = entry && !entry.finished
      ? (spotsSummary(entry, nameFor)
        ?? [formatLeft(entry.playhead, entry.duration), whereLine(entry, nameFor)].filter(Boolean).join(' · '))
      : null;
    const favourite = favourites.has(contentId);
    // FIND.8a/AC2: what kind of thing it is and how long, in words ("Movie · 1 hr 56 min").
    const facts = resultSubtitle(detailItem);
    const description = info.description || info.metadata?.summary || null;
    // Where Play, Shuffle and the queue verbs go (the aim, else the usual
    // screen for this kind of thing, else here) — named on the page.
    const where = destinationFor(detailItem);
    const elsewhere = where.targetIds.length > 0;
    const whereName = elsewhere ? labelsFor(detailItem).short : null;

    body = (
      <>
        <InfoPreview ref={previewRef} item={detailItem} />
        <Title order={1}>{info.title ?? contentId}</Title>
        {facts && <Text size="sm" c="dimmed" data-testid="detail-facts">{facts}</Text>}
        {description && <Text c="dimmed">{description}</Text>}
        {progress && <Text size="sm" data-testid="detail-progress">{progress}</Text>}
        {startingOn && <Text size="sm" data-testid="detail-starting" role="status">{startingOn}</Text>}
        <Group className="detail-actions" gap="sm">
          <Button
            data-testid="detail-play-now"
            ref={playRef}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
            leftSection={elsewhere ? <IconCast size={18} /> : <IconPlayerPlayFilled size={18} />}
            loading={!collection && pendingResume}
            onClick={() => {
              stopPreview();
              const route = collection ? dispatchLeafVerb('playNow', contentId, detailItem) : run('playNow', detailItem, { entry });
              if (route === 'ask') setOneShot({ kind: 'playOn', item: detailItem });
            }}
          >
            {labelsFor(detailItem).sentence}
          </Button>
          {elsewhere && (
            <Button
              data-testid="detail-play-here"
              variant="default"
              onClick={() => { stopPreview(); dispatchLeafVerb('playNow', contentId, detailItem, { targetIds: [] }); }}
            >
              Play here
            </Button>
          )}
          <Button variant="default" data-testid="detail-play-on" onClick={() => { stopPreview(); setOneShot({ kind: 'playOn', item: detailItem }); }}>Play on…</Button>
          <ItemQualityButton item={detailItem} />
          {isContainer(detailItem) && <Button variant="default" onClick={() => { stopPreview(); if (dispatchLeafVerb('shuffle', contentId, detailItem) === 'ask') setOneShot({ kind: 'playOn', item: detailItem }); }}>{elsewhere ? `Shuffle on ${whereName}` : 'Shuffle'}</Button>}
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
          <Button variant="default" onClick={() => setOneShot({ kind: 'addOn', item: detailItem })}>Add on…</Button>
          <Button variant="default" data-testid="detail-show-briefly" onClick={() => setOneShot({ kind: 'showBrieflyOn', item: detailItem })}>Show briefly on…</Button>
        </Group>
        {elsewhere && (
          <Text size="sm" c="dimmed" data-testid="detail-queue-where">
            Play Next, Play First and Add to Queue go to {whereName}.
          </Text>
        )}
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
      </>
    );
  } else {
    body = <EmptyState title="No details available for this item" />;
  }

  return (
    <Stack component="section" gap="md" aria-label="Item details" {...regionProps}
      data-testid={surface} className={surface === 'detail-view' ? 'detail-view' : undefined}
      maw={loading ? 520 : undefined}>
      {back}
      {body}
    </Stack>
  );
}

export default DetailView;
