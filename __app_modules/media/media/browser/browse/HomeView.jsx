// frontend/src/modules/Media/browse/HomeView.jsx
// The start page (FIND.7a): what is
// playing on other screens right now ("Now on <screen> · Remote · Move here",
// FIND.10a/AC3), the server-built suggestions for THIS screen in their order —
// Favourites as large pictures first (FIND.12b), Carry on with where each
// screen stopped (FIND.10a), Usually (here) at this time, New — and the
// household's Recent from every screen, labelled with where it played
// (FIND.9a). Nothing playing anywhere is ever suggested (the server leaves it
// out). With nothing to suggest the page leads into Browse.
//
// Every item has the whole verb set (⋯) and follows the one tap rule: a
// picture (or title) opens the item — a collection's list, an item's detail
// page — and the small ▶ disc on the art plays it where the disc says. Rows share one left edge, scroll sideways with a hidden
// scrollbar and, with a pointer, step with ‹ › at the heading's right end.
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActionIcon, Button, Group, Stack, Title } from '@mantine/core';
import { IconDeviceRemote, IconArrowBarToDown, IconLayoutGrid, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { whileDocumentVisible } from "../../../../../frontend/src/lib/hooks/useVisibleRefresh.js";
import { getDeviceId } from "../../../../../frontend/src/lib/deviceIdentity.js";
import { EmptyState } from "../../../../../frontend/src/lib/ui/states.jsx";
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { getPreferredScrollBehavior } from '@/lib/ui/browserMotion.js';
import { useNav } from "../shell/NavProvider.jsx";
import mediaLog from "../logging/mediaLog.js";
import { HomeTile } from "./HomeTile.jsx";
import { tileKind, collapseEditions, editionsLabel, presentTitle, progressPercent } from "./tilePresentation.js";
import { HOUSEHOLD_PATHS, suggestionsPath } from "../household/householdApi.js";
import {
  toItem, formatLeft, spotLine, differingSpots, whereLine, playedAtLabel, nowOnScreenIds, bareScreenId,
} from "../household/householdModel.js";
import { useFavourites, householdResourceLogger } from "../household/useHousehold.js";
import { useItemVerbs } from "../household/useItemVerbs.jsx";
import { useMoveHere } from "../household/useMoveHere.js";
import { useStartingOn } from "../cast/useStartingOn.js";
import { ItemMenu } from "../household/ItemMenu.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import "./Home.scss";

export const DEGRADED_RELOAD_MS = 10_000;

function useRetryDegradedResource({ data, resourceKey, revalidating, poll }, deviceId) {
  const retriedKeys = useRef(new Set());
  const degraded = data?.degraded === true;
  useEffect(() => {
    if (!degraded || revalidating || retriedKeys.current.has(resourceKey)) return undefined;
    // Cold catalog lookups can return partial data. Give each read one
    // recovery attempt while Home is visible.
    return whileDocumentVisible(() => {
      if (retriedKeys.current.has(resourceKey)) return undefined;
      const timer = setTimeout(() => {
        retriedKeys.current.add(resourceKey);
        mediaLog.householdDegradedReload({ deviceId, resource: resourceKey });
        poll();
      }, DEGRADED_RELOAD_MS);
      return () => clearTimeout(timer);
    });
  }, [degraded, revalidating, resourceKey, poll, deviceId]);
}

function rowTestId(rowId) {
  return `home-row-${rowId}`;
}

function tileTestId(rowId, id) {
  return `home-tile-${rowId}-${id}`;
}

// How far a ‹ › step moves: most of the visible row, keeping one tile in view.
const STEP_FRACTION = 0.85;

function TileRow({ rowId, title, children }) {
  const scrollRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, children]);
  const step = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * STEP_FRACTION), behavior: getPreferredScrollBehavior(el) });
    mediaLog.rowStepped({ row: rowId, direction: direction < 0 ? 'back' : 'forward' });
  };
  return (
    <section className={`home-row home-row--${rowId}`} data-testid={rowTestId(rowId)} aria-labelledby={`${rowTestId(rowId)}-title`}>
      <div className="home-row-head">
        <Title order={2} className="home-row-title" id={`${rowTestId(rowId)}-title`}>{title}</Title>
        <div className="home-row-steps" hidden={edges.start && edges.end}>
          <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Scroll ${title} back`} data-testid={`home-step-${rowId}-back`}
            disabled={edges.start} onClick={() => step(-1)}>
            <IconChevronLeft size={20} aria-hidden />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Scroll ${title} forward`} data-testid={`home-step-${rowId}-forward`}
            disabled={edges.end} onClick={() => step(1)}>
            <IconChevronRight size={20} aria-hidden />
          </ActionIcon>
        </div>
      </div>
      <div
        className="home-row-scroll"
        ref={scrollRef}
        onScroll={measure}
        // A tile focused by keyboard is brought wholly into the row. The browser's own focus scroll stops short
        // and the row's snap then pulls it back, leaving the tile half outside; aligning it to a snap point
        // (the row's start edge) is the position the snap leaves alone.
        onFocus={(e) => {
          const tile = e.target?.closest?.('.home-tile');
          const row = scrollRef.current;
          if (!tile || !row) return;
          const t = tile.getBoundingClientRect();
          const r = row.getBoundingClientRect();
          if (t.left < r.left - 1 || t.right > r.right + 1) tile.scrollIntoView({ inline: 'start', block: 'nearest' });
        }}
      >{children}</div>
    </section>
  );
}

// A placeholder row in the same tile shape as the row it stands for (Home opens on
// Carry on: 16:9 stills), so nothing jumps when the real row arrives.
const SKELETON_SIZE = { wide: [208, 117], poster: [136, 204], square: [152, 152] };
function RowSkeleton({ kind = 'wide' }) {
  const [w, h] = SKELETON_SIZE[kind] ?? SKELETON_SIZE.wide;
  return (
    <div className="home-row" data-testid="home-loading">
      <Skeleton height={22} width="30%" radius="sm" />
      <div className="home-row-scroll">
        {[0, 1, 2].map(i => <Skeleton key={i} height={h} width={w} radius="md" />)}
      </div>
    </div>
  );
}

/**
 * "Now on Living Room TV · Remote · Move here" — never offered as carry on.
 * Remote needs that screen's live session here (the fleet store, keyed by
 * its fleet/peek id, browsers included); Move here additionally needs a
 * playback-owner identity. A screen with no live session here shows
 * "Now on <screen>" with its ⋯ verbs only.
 */
function NowOnRow({ entries, nameFor, run, favourites }) {
  const { push } = useNav();
  const moveHere = useMoveHere();
  const fleet = useContext(FleetContext);
  const store = fleet?.store ?? null;
  // Re-render when screens report state, so the verbs appear once they can work.
  useSyncExternalStore(store?.subscribeAll ?? noSubscribe, store?.getAll ?? noSnapshot, store?.getAll ?? noSnapshot);
  if (!entries.length) return null;
  return (
    <TileRow rowId="now-on" title="Playing now">
      {entries.map((entry) => {
        const screen = nameFor(entry.deviceId) ?? 'another screen';
        const deviceId = bareScreenId(entry.deviceId);
        // Remote needs only a live session here (browser rows included);
        // Move here also needs the playback-owner identity createMoveRequest
        // checks, which browser snapshots do not carry.
        const fleetEntry = store?.getEntry?.(deviceId) ?? null;
        const canRemote = Boolean(fleetEntry?.snapshot);
        const canMove = Boolean(!fleetEntry?.offline && fleetEntry?.snapshot?.meta?.playbackOwner);
        const testId = tileTestId('now-on', `${deviceId}-${entry.contentId}`);
        const contextId = `now-on-${encodeURIComponent(deviceId)}-${encodeURIComponent(entry.contentId)}`;
        const item = toItem(entry);
        return (
          <div key={`${entry.deviceId}-${entry.contentId}`} className={`home-tile home-tile--now home-tile--${tileKind(entry)}`} data-testid={testId}>
            <div className="home-tile-art">
              <div className="home-tile-picture home-tile-picture--static" aria-hidden>
                {entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" /> : null}
              </div>
            </div>
            <div className="home-tile-head">
              <div className="home-tile-body">
                <span id={`${contextId}-title`} className="home-tile-title" title={entry.title ?? 'Something'}>{presentTitle(entry) ?? 'Something'}</span>
                <span id={`${contextId}-where`} className="home-tile-line" data-testid={`${testId}-where`}>Now on {screen}</span>
              </div>
              {item && (
                <div className="home-tile-more">
                  <ItemMenu item={{ ...item, title: entry.title ?? item.title }} onVerb={kind => run(kind, item, { entry })}
                    favourite={favourites.has(item.id)} testId={testId} />
                </div>
              )}
            </div>
            {(canRemote || canMove) && (
              <Group gap={6} className="home-tile-actions">
                {canRemote && <Button size="sm" variant="default" data-testid={`${testId}-remote`}
                  aria-describedby={`${contextId}-title ${contextId}-where`}
                  leftSection={<IconDeviceRemote size={14} aria-hidden />}
                  onClick={() => push('peek', { deviceId })}>
                  Remote
                </Button>}
                {canMove && <Button size="sm" variant="default" data-testid={`${testId}-move-here`}
                  aria-describedby={`${contextId}-title ${contextId}-where`}
                  leftSection={<IconArrowBarToDown size={14} aria-hidden />}
                  onClick={() => moveHere(entry.deviceId, entry)}>
                  Move here
                </Button>}
              </Group>
            )}
          </div>
        );
      })}
    </TileRow>
  );
}

const noSubscribe = () => () => {};
const noSnapshot = () => null;

/**
 * The ONE muted meta line under a tile: the most useful fact. Carry on is
 * "time left · where" (real data) or "Next episode"; an edition group says how
 * many editions it stands for.
 */
export function tileMeta(rowId, item, entry, nameFor, { editionCount = 1 } = {}) {
  const editions = editionsLabel(editionCount);
  if (editions) {
    const base = tileMeta(rowId, item, entry, nameFor, { editionCount: 1 });
    return typeof base === 'string' && base ? `${base} · ${editions}` : editions;
  }
  if (rowId === 'carry-on') {
    if (item.reason === 'next-episode' || entry?.reason === 'next-episode') return 'Next episode';
    const source = entry ?? item;
    // A book or series (Continue listening's row, lookup spec §13): its current
    // part and the time left in the whole book.
    if (source?.playContentId && Number.isFinite(source.remainingSec)) {
      const part = source.partIndex && source.partCount ? `Part ${source.partIndex} of ${source.partCount}` : null;
      return [part, formatLeft(0, source.remainingSec)].filter(Boolean).join(' · ') || 'In progress';
    }
    const spots = differingSpots(entry);
    // FIND.10a/AC4: screens holding different spots show each one (a short line per spot).
    if (spots.length > 1) return spots.slice(0, 2).map(spot => spotLine(spot, nameFor));
    const line = [formatLeft(source.playhead, source.duration), whereLine(source, nameFor)].filter(Boolean).join(' · ');
    return line || 'In progress';
  }
  // A favourite show names its next part (its Continue is in the ⋯ menu).
  if (rowId === 'favourites' && item.continue?.title) return `Next: ${item.continue.title}`;
  if (rowId === 'time-of-day') return item.days ? `${item.days} days at about this time` : null;
  if (rowId === 'new') return item.latest?.title ? `New: ${item.latest.title}` : 'Recently added';
  return null;
}

export function HomeView() {
  // Read each render: the app may adopt its browser id after first paint.
  const deviceId = getDeviceId();
  const suggestions = useApiResource(suggestionsPath(deviceId), { swr: true, label: 'media-suggestions', logger: householdResourceLogger });
  const carryOn = useApiResource(HOUSEHOLD_PATHS.carryOn, { swr: true, label: 'media-carry-on', logger: householdResourceLogger });
  const recent = useApiResource(HOUSEHOLD_PATHS.recent, { swr: true, label: 'media-recent', logger: householdResourceLogger });
  const { regionProps: suggestionsRegion, retry: retrySuggestions } = useRetryRegion(suggestions.reload, suggestions.loading || suggestions.revalidating);
  const { regionProps: recentRegion, retry: retryRecent } = useRetryRegion(recent.reload, recent.loading || recent.revalidating);
  useRetryDegradedResource(suggestions, deviceId);
  useRetryDegradedResource(carryOn, deviceId);
  useRetryDegradedResource(recent, deviceId);
  const favourites = useFavourites();
  const { run, overlays, nameFor } = useItemVerbs();
  const { labelsFor, destinationFor } = usePlayDestination();
  // The tile's ▶ names its screen, the same words the detail page's Play uses.
  const playLabelFor = (item, title) => labelsFor(item, { verb: `Play ${title}` }).sentence;
  const { startingOnFor } = useStartingOn();
  const { goToArea } = useNav();

  const carryById = useMemo(() => new Map((carryOn.data?.items ?? []).map(entry => [entry.contentId, entry])), [carryOn.data]);
  const nowOn = useMemo(() => (carryOn.data?.nowOn ?? []).filter(entry => entry?.deviceId && entry.deviceId !== deviceId), [carryOn.data, deviceId]);
  const nowOnIds = useMemo(() => nowOnScreenIds(nowOn), [nowOn]);
  const rows = Array.isArray(suggestions.data?.rows) ? suggestions.data.rows.filter(row => row?.items?.length) : [];
  const recentItems = Array.isArray(recent.data?.items) ? recent.data.items : [];

  const shownKey = suggestions.data?.generatedAt ?? null;
  const loggedRef = useRef(null);
  useEffect(() => {
    if (!suggestions.data || loggedRef.current === shownKey) return;
    loggedRef.current = shownKey;
    mediaLog.homeShown({
      deviceId,
      empty: suggestions.data.empty === true,
      rows: rows.map(row => ({ id: row.id, count: row.items.length })),
      nowOn: nowOn.length,
      recent: recentItems.length,
    });
  }, [suggestions.data, shownKey, deviceId, rows, nowOn.length, recentItems.length]);
  useEffect(() => {
    for (const [section, resource] of [['suggestions', suggestions], ['carry-on', carryOn], ['recent', recent]]) {
      if (resource.error) mediaLog.householdLoadFailed({ section, error: resource.error.message });
    }
  }, [suggestions.error, carryOn.error, recent.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const tileFor = (rowId, raw, group = null) => {
    const item = toItem(raw);
    if (!item) return null;
    const title = presentTitle(raw) ?? item.title ?? 'Untitled';
    const entry = carryById.get(item.id) ?? null;
    const favourite = favourites.has(item.id);
    const testId = tileTestId(rowId, item.id);
    const big = rowId === 'favourites';
    const cont = raw.continue?.contentId ? { id: raw.continue.contentId, title: raw.continue.title ?? null, itemType: 'leaf' } : null;
    const editionItems = group && group.editions.length > 1 ? group.editions.map(toItem).filter(Boolean) : null;
    const percent = progressPercent(raw.percent ?? entry?.percent ?? null, (entry ?? raw).finished === true);
    return (
      <HomeTile
        key={item.id}
        item={item}
        title={title}
        kind={null}
        size={big ? 'large' : 'normal'}
        testId={testId}
        meta={startingOnFor(item.id) ?? tileMeta(rowId, raw, entry, nameFor, { editionCount: group?.editions.length ?? 1 })}
        progress={percent}
        // A tile's picture is a look: it opens the item (or its list). The ▶
        // disc is the one deliberate play, aimed where it says.
        onPicture={() => run('open', item, { entry, via: 'tile' })}
        pictureLabel={`Open ${title}`}
        onPlay={() => run('playNow', item, { entry })}
        playLabel={playLabelFor(item, title)}
        playElsewhere={destinationFor(item).targetIds.length > 0}
        onVerb={kind => (kind === 'continue' && cont ? run('playNow', cont) : run(kind, item, { entry }))}
        favourite={favourite}
        watched={entry ? entry.finished === true : null}
        removable
        editions={editionItems}
        onEdition={(edition) => { mediaLog.tileEditionOpened({ contentId: edition.id, editions: group?.editions.length ?? 1 }); run('open', edition); }}
        continueLabel={cont ? `Continue ${cont.title ?? ''}`.trim() : null}
      />
    );
  };

  let suggestionBody;
  if (suggestions.loading && !suggestions.data) suggestionBody = <RowSkeleton />;
  else if (suggestions.error && !suggestions.data) {
    suggestionBody = <LoadErrorLine kind="suggestions" testId="home-suggestions-error" onRetry={retrySuggestions} />;
  } else if (!suggestions.error && (suggestions.data?.empty === true || rows.length === 0)) {
    suggestionBody = (
      <div data-testid="home-suggestions-empty">
        <EmptyState
          title="Nothing to suggest yet"
          hint="Browse the library to find something to play."
          action={{ label: 'Browse', onClick: () => goToArea('browse') }}
        />
      </div>
    );
  } else {
    suggestionBody = (
      <>
        {suggestions.error ? <LoadErrorLine kind="suggestions" testId="home-suggestions-error" onRetry={retrySuggestions} /> : null}
        {rows.map(row => (
          <TileRow key={row.id} rowId={row.id} title={row.title}>
            {collapseEditions(row.items, { idOf: raw => raw?.contentId ?? raw?.id, collapse: row.id !== 'carry-on' })
              .map(group => tileFor(row.id, group.entry, group))}
          </TileRow>
        ))}
      </>
    );
  }

  let recentBody;
  if (recent.loading && !recent.data) recentBody = <RowSkeleton />;
  else if (recent.error && !recent.data) {
    recentBody = <LoadErrorLine kind="recent" testId="home-recent-error" onRetry={retryRecent} />;
  } else if (!recent.error && recentItems.length === 0) {
    recentBody = <p className="home-recents-empty" data-testid="home-recents-empty">Things played on any screen will show up here.</p>;
  } else {
    recentBody = (
      <>
        {recent.error ? <LoadErrorLine kind="recent" testId="home-recent-error" onRetry={retryRecent} /> : null}
        <TileRow rowId="recent" title="Recent">
          {collapseEditions(recentItems, { idOf: entry => entry?.contentId ?? entry?.id }).map(({ entry, editions }) => {
            const item = toItem(entry);
            if (!item) return null;
            const title = presentTitle(entry) ?? item.title ?? 'Untitled';
            const screens = nowOnIds.get(item.id);
            const where = screens?.length ? `Now on ${nameFor(screens[0])}` : whereLine(entry, nameFor);
            const editionItems = editions.length > 1 ? editions.map(toItem).filter(Boolean) : null;
            const base = [playedAtLabel(entry.plays?.[0]?.startedAt ?? entry.lastPlayed), where].filter(Boolean).join(' · ');
            const label = editionsLabel(editions.length);
            const meta = label ? [base, label].filter(Boolean).join(' · ') : base;
            return (
              <HomeTile
                key={item.id}
                item={item}
                title={title}
                testId={tileTestId('recent', item.id)}
                meta={meta || null}
                progress={progressPercent(entry.percent ?? null, entry.finished === true)}
                onPicture={() => run('open', item, { entry, via: 'tile' })}
                pictureLabel={`Open ${title}`}
                onPlay={() => run('playNow', item, { entry })}
                playLabel={playLabelFor(item, title)}
                playElsewhere={destinationFor(item).targetIds.length > 0}
                onVerb={kind => run(kind, item, { entry })}
                favourite={favourites.has(item.id)}
                watched={entry.finished === true}
                removable
                editions={editionItems}
                onEdition={(edition) => { mediaLog.tileEditionOpened({ contentId: edition.id, editions: editions.length }); run('open', edition); }}
              />
            );
          })}
        </TileRow>
      </>
    );
  }

  return (
    <Stack data-testid="home-view" className="home-view" gap="lg">
      <NowOnRow entries={nowOn} nameFor={nameFor} run={run} favourites={favourites} />
      <Stack component="section" gap="lg" aria-label="Suggestions" {...suggestionsRegion}>{suggestionBody}</Stack>
      <section aria-label="Recent activity" {...recentRegion}>{recentBody}</section>
      <Group justify="flex-start">
        <Button variant="subtle" color="gray" leftSection={<IconLayoutGrid size={16} aria-hidden />}
          data-testid="home-browse" onClick={() => goToArea('browse')}>
          Browse everything
        </Button>
      </Group>
      {overlays}
    </Stack>
  );
}

export default HomeView;
