// frontend/src/modules/Media/browse/DetailView.jsx
// One item, all its actions: artwork, description, then row 1 — ONE primary
// play that names where it goes ("▶ Play on Office Screen" — the aim, else the
// screen this browser learned for this kind of thing, else "here"), with
// Play here / Play on… beside it for the other places — and a More ⋯ menu
// holding the rest (queue verbs named for their screen, Show briefly on…,
// Quality…, favourites and watched marks; owner ruling 2026-11-26).
// Opening this page never plays anything: it is where a look lands. It does
// ask the server to prepare the start on that screen (cast/usePrepareStart.js),
// which touches no screen. A video may be previewed inside its art
// (InfoPreview: muted, on this device, records nothing); every verb that
// sends the item anywhere (play, queue, show briefly) stops that preview first —
// a queue verb landing in an empty local queue starts a play.
import React, { useEffect, useRef, useState } from 'react';
import { Stack, Title, Text, Button, Group, Menu } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd, IconCast, IconDeviceRemote, IconRotate, IconDots, IconArrowsShuffle, IconPlaylist, IconPhoto, IconAdjustments } from '@tabler/icons-react';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
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
import { itemMenuEntries, menuItemKind, MENU_LABELS } from "../actions/itemMenuTable.js";
import { usePlaybackQuality } from "../quality/PlaybackQualityProvider.jsx";
import { supportsQualityOverrides } from "../quality/PlaybackQualityButtons.jsx";
import { useStartingOn } from "../cast/useStartingOn.js";
import { usePressHoldOffer } from "../../../../../frontend/src/lib/ui/usePressHoldOffer.js";
import mediaLog from "../logging/mediaLog.js";
import { resultSubtitle } from "../search/resultPresentation.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { usePrepareStart } from "../cast/usePrepareStart.js";
import { InfoPreview } from "./InfoPreview.jsx";
import { usePlayingOn } from "../fleet/usePlayingOn.js";

// More ⋯ entries keep the test ids their buttons had before the owner's
// 2026-11-26 ruling moved them here.
const MORE_TEST_ID = {
  shuffle: 'detail-shuffle', playNext: 'detail-play-next', playFirst: 'detail-up-next', add: 'detail-add',
  addOn: 'detail-add-on', showBrieflyOn: 'detail-show-briefly', quality: 'detail-quality',
  favourite: 'detail-favourite', unfavourite: 'detail-favourite', watched: 'detail-watched', unwatched: 'detail-unwatched',
};
const MORE_ICON = {
  shuffle: IconArrowsShuffle, playNext: IconPlayerTrackNext, playFirst: IconRowInsertTop, add: IconPlaylistAdd,
  addOn: IconPlaylist, showBrieflyOn: IconPhoto, quality: IconAdjustments,
  favourite: IconHeart, unfavourite: IconHeartFilled, watched: IconEye, unwatched: IconEyeOff,
};

// "720p" / "Custom" beside Quality… when this item has an override.
function qualitySummary(quality, item) {
  if (!quality || !supportsQualityOverrides(item)) return null;
  const overrides = quality.getOverrides(item.contentId ?? item.id);
  if (overrides.maxResolution) return `${overrides.maxResolution}p`;
  return Object.keys(overrides).length ? 'Custom' : null;
}

// The info view's More ⋯: every verb that is not row 1, grouped by the table's
// dividers. Esc closes it and leaves focus on More (ActionMenu), never the page.
function DetailMoreMenu({ contentId, entries, qualitySummary: summary, playNextHold, onPick }) {
  const pick = (kind) => () => {
    mediaLog.detailMorePicked({ contentId, verb: kind });
    onPick(kind);
  };
  return (
    <ActionMenu
      withinPortal
      position="bottom-end"
      shadow="sm"
      onOpen={() => mediaLog.detailMoreOpened({ contentId, entries: entries.filter((e) => !e.divider).length })}
      dropdownProps={{ 'data-testid': 'detail-more-menu' }}
      trigger={(
        <Button variant="default" data-testid="detail-more" rightSection={<IconDots size={16} />}>
          {MENU_LABELS.more}
        </Button>
      )}
    >
      {entries.map((entry, index) => {
        if (entry.divider) return <Menu.Divider key={`divider-${index}`} />;
        const Icon = MORE_ICON[entry.kind];
        const leftSection = Icon ? <Icon size={16} /> : null;
        if (entry.kind === 'playNext') {
          return (
            <React.Fragment key="playNext">
              <Menu.Item data-testid={MORE_TEST_ID.playNext} leftSection={leftSection}
                closeMenuOnClick={!playNextHold.offered} {...playNextHold.bind}
                onClick={playNextHold.guardClick(pick('playNext'))}>
                {entry.label}
              </Menu.Item>
              {playNextHold.offered && (
                <Menu.Item data-testid="detail-play-next-front" leftSection={<IconRowInsertTop size={16} />}
                  onClick={() => { playNextHold.dismiss(); pick('playNextFront')(); }}>
                  {MENU_LABELS.playNextFront}
                </Menu.Item>
              )}
            </React.Fragment>
          );
        }
        return (
          <Menu.Item key={entry.kind} data-testid={MORE_TEST_ID[entry.kind]} leftSection={leftSection}
            rightSection={entry.kind === 'quality' && summary ? <Text size="xs" c="dimmed">{summary}</Text> : null}
            onClick={pick(entry.kind)}>
            {entry.label}
          </Menu.Item>
        );
      })}
    </ActionMenu>
  );
}

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
  const quality = usePlaybackQuality();
  const { entry, pending: pendingResume } = useHouseholdEntry(contentId);
  // PLAY.5a/AC3: pressing and holding Play Next offers "At the very front".
  const { startingOnFor, isStarting } = useStartingOn();
  const startingOn = startingOnFor(contentId);
  // Addendum item 6: PLAY spins while this item's own start is in flight.
  const starting = isStarting(contentId);
  // Addendum item 5: already on a screen → "On <screen>", Pause / Open, and
  // PLAY is the explicit Start over there.
  const { playingOnFor, toggle: toggleOn, startOver: startOverOn, open: openOn } = usePlayingOn();
  const on = playingOnFor(contentId);
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
        {on && !startingOn && (
          <Group gap="sm" className="detail-playing-on" data-testid="detail-playing-on">
            <Text size="sm" role="status" data-testid="detail-playing-on-text">On {on.name} · {on.paused ? 'Paused' : 'Playing'}</Text>
            <Button size="compact-md" variant="default" data-testid="detail-on-toggle"
              leftSection={on.paused ? <IconPlayerPlayFilled size={14} /> : <IconPlayerPauseFilled size={14} />}
              onClick={() => toggleOn(on, contentId)}>
              {on.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="compact-md" variant="default" data-testid="detail-on-open" leftSection={<IconDeviceRemote size={14} />}
              onClick={() => openOn(on)}>
              Open {on.name}
            </Button>
          </Group>
        )}
        {/* Owner ruling 2026-11-26: row 1 is PLAY, Play here and Play on…;
            everything else sits behind More ⋯ (one table: actions/itemMenuTable.js). */}
        <Group className="detail-actions detail-row-one" gap="sm" data-testid="detail-row-one">
          <Button
            data-testid="detail-play-now"
            className="detail-play-primary"
            ref={playRef}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
            leftSection={on ? <IconRotate size={18} /> : elsewhere ? <IconCast size={18} /> : <IconPlayerPlayFilled size={18} />}
            loading={(!collection && pendingResume) || starting}
            data-busy={starting || undefined}
            onClick={() => {
              stopPreview();
              if (on) { startOverOn(on, contentId); return; }
              const route = collection ? dispatchLeafVerb('playNow', contentId, detailItem) : run('playNow', detailItem, { entry });
              if (route === 'ask') setOneShot({ kind: 'playOn', item: detailItem });
            }}
          >
            {on ? `Start over on ${on.name}` : labelsFor(detailItem).sentence}
          </Button>
          {elsewhere && (
            <Button
              data-testid="detail-play-here"
              variant="default"
              onClick={() => { stopPreview(); dispatchLeafVerb('playNow', contentId, detailItem, { targetIds: [] }); }}
            >
              {MENU_LABELS.playHere}
            </Button>
          )}
          <Button variant="default" data-testid="detail-play-on" onClick={() => { stopPreview(); setOneShot({ kind: 'playOn', item: detailItem }); }}>{MENU_LABELS.playOn}</Button>
          <DetailMoreMenu
            contentId={contentId}
            entries={itemMenuEntries({
              surface: 'detail',
              kind: menuItemKind({ collection }),
              where: { elsewhere, short: whereName },
              favourite,
              quality: !!quality && supportsQualityOverrides(detailItem),
            })}
            qualitySummary={qualitySummary(quality, detailItem)}
            playNextHold={playNextHold}
            onPick={(kind) => {
              if (kind === 'quality') { quality.openForItem(detailItem); return; }
              if (kind === 'favourite' || kind === 'unfavourite' || kind === 'watched' || kind === 'unwatched') { run(kind, detailItem); return; }
              stopPreview();
              if (kind === 'addOn' || kind === 'showBrieflyOn') { setOneShot({ kind, item: detailItem }); return; }
              if (kind === 'playNextFront') { mediaLog.playNextFrontChosen({ surface: 'detail' }); dispatchLeafVerb('playFirst', contentId, detailItem); return; }
              if (dispatchLeafVerb(kind, contentId, detailItem) === 'ask') setOneShot({ kind: 'playOn', item: detailItem });
            }}
          />
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
