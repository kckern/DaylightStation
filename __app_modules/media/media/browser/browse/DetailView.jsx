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
import React, { useEffect, useRef } from 'react';
import { Stack, Title, Text, Button, Group } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconDeviceRemote } from '@tabler/icons-react';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { EmptyState } from '@/lib/ui/states.jsx';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import { useContentInfo } from "./useContentInfo.js";
import { useNav } from "../shell/NavProvider.jsx";
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { useItemVerbs } from "../household/useItemVerbs.jsx";
import { useHouseholdEntry } from "../household/useHousehold.js";
import { spotsSummary, formatLeft, whereLine } from "../household/householdModel.js";
import { useStartingOn } from "../cast/useStartingOn.js";
import { resultSubtitle } from "../search/resultPresentation.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { usePrepareStart } from "../cast/usePrepareStart.js";
import { InfoPreview } from "./InfoPreview.jsx";
import { usePlayingOn } from "../fleet/usePlayingOn.js";
import { usePhoneKeeps, useWatchPhoneKeeps } from "../cast/usePhoneKeeps.jsx";
import { KEEP_PROBLEM_STATES } from "../cast/phoneKeeps.js";
import { ItemActionRow } from "./ItemActionRow.jsx";
import mediaLog from "../logging/mediaLog.js";
import { ParentChip, ClampedSummary } from "./HeaderParts.jsx";
import { parentOf, pathFor } from "./browseHeaderModel.js";

// `focusPlay`: opened from search — PLAY takes focus once it can be pressed,
// so a second Enter plays by that button's own activation (no key handler
// here: a stray Enter elsewhere plays nothing). The Enter that opened the
// page may still be held when PLAY takes focus: its auto-repeat keydowns
// (repeat: true) are default-prevented, so one long press is not two.
export function DetailView({ contentId, focusPlay = false }) {
  const playRef = useRef(null);
  const previewRef = useRef(null);
  // Synchronously, before any play verb dispatches: a preview never overlaps a play.
  const stopPreview = () => previewRef.current?.stop();
  const playFocusedRef = useRef(false);
  const { info, loading, error, reload } = useContentInfo(contentId);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const { pop, push, backDestination } = useNav();
  const { nameFor } = useItemVerbs();
  // "Keep on Phone": audio only; the phone reports what it keeps (downloads hardening §H).
  const phoneKeeps = usePhoneKeeps();
  useWatchPhoneKeeps(info ? { id: contentId, ...info } : null);
  const { destinationFor } = usePlayDestination();
  const { entry, pending: pendingResume } = useHouseholdEntry(contentId);
  const { startingOnFor } = useStartingOn();
  const startingOn = startingOnFor(contentId);
  // Addendum item 5: already on a screen → "On <screen>", Pause / Open, and
  // PLAY is the explicit Start over there (ItemActionRow).
  const { playingOnFor, toggle: toggleOn, open: openOn } = usePlayingOn();
  const on = playingOnFor(contentId);
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
    // FIND.8a/AC2: what kind of thing it is and how long, in words ("Movie · 1 hr 56 min").
    const facts = resultSubtitle(detailItem);
    const description = info.description || info.metadata?.summary || null;
    const keep = phoneKeeps.forItem(detailItem);
    // One tap to the author, artist or show this item belongs to.
    const parent = parentOf(detailItem);

    body = (
      <>
        <InfoPreview ref={previewRef} item={detailItem} />
        <Title order={1}>{info.title ?? contentId}</Title>
        {parent && (
          <ParentChip parent={parent} testId="detail-parent"
            onOpen={() => {
              mediaLog.parentOpened({ from: contentId, to: parent.contentId, surface: 'detail' });
              push('browse', { path: pathFor(parent.contentId), label: parent.title });
            }} />
        )}
        {facts && <Text size="sm" c="dimmed" data-testid="detail-facts">{facts}</Text>}
        {description && <ClampedSummary text={description} testId="detail-summary" />}
        {progress && <Text size="sm" data-testid="detail-progress">{progress}</Text>}
        {keep.lines.map((k) => (
          <Group key={k.key} gap="xs" data-testid="detail-kept-row">
            <Text size="sm" c={KEEP_PROBLEM_STATES.has(k.state) ? 'red' : 'dimmed'}
              role="status" data-testid="detail-kept" data-state={k.state}>{k.line}</Text>
            <Button size="compact-xs" variant="subtle" data-testid="detail-kept-open"
              onClick={() => push('phone-keeps', { deviceId: k.deviceId })}>What's on it</Button>
          </Group>
        ))}
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
        <ItemActionRow item={detailItem} contentId={contentId} collection={collection}
          entry={entry} pendingResume={pendingResume} playRef={playRef} stopPreview={stopPreview} />
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
