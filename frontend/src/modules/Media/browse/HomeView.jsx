// frontend/src/modules/Media/browse/HomeView.jsx
// The start page (FIND.7a): this device's own session (Resume), what is
// playing on other screens right now ("Now on <screen> · Remote · Move here",
// FIND.10a/AC3), the server-built suggestions for THIS screen in their order —
// Favourites as large pictures first (FIND.12b), Carry on with where each
// screen stopped (FIND.10a), Usually (here) at this time, New — and the
// household's Recent from every screen, labelled with where it played
// (FIND.9a). Nothing playing anywhere is ever suggested (the server leaves it
// out). With nothing to suggest the page leads into Browse.
//
// Every item has the whole verb set (⋯) and follows the one tap rule: a
// collection's picture opens it and its inline Play/Continue plays it; a
// playable item's picture plays it at the aim.
import React, { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Button, Group, Stack, Title } from '@mantine/core';
import { IconDeviceRemote, IconArrowBarToDown, IconLayoutGrid } from '@tabler/icons-react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { getDeviceId } from '../../../lib/deviceIdentity.js';
import { EmptyState, ErrorState } from '../../../lib/ui/states.jsx';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { useNav } from '../shell/NavProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import { ResumeCard } from './ResumeCard.jsx';
import { HomeTile } from './HomeTile.jsx';
import { HOUSEHOLD_PATHS, suggestionsPath } from '../household/householdApi.js';
import {
  toItem, formatLeft, spotLine, differingSpots, whereLine, playedAtLabel, nowOnScreenIds, bareScreenId,
} from '../household/householdModel.js';
import { useFavourites, householdResourceLogger } from '../household/useHousehold.js';
import { useItemVerbs, isCollection } from '../household/useItemVerbs.jsx';
import { useMoveHere } from '../household/useMoveHere.js';
import { ItemMenu } from '../household/ItemMenu.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import './Home.scss';

export const DEGRADED_RELOAD_MS = 10_000;

function rowTestId(rowId) {
  return `home-row-${rowId}`;
}

function tileTestId(rowId, id) {
  return `home-tile-${rowId}-${id}`;
}

function TileRow({ rowId, title, children }) {
  return (
    <section className={`home-row home-row--${rowId}`} data-testid={rowTestId(rowId)} aria-labelledby={`${rowTestId(rowId)}-title`}>
      <Title order={2} className="home-row-title" id={`${rowTestId(rowId)}-title`}>{title}</Title>
      <div className="home-row-scroll">{children}</div>
    </section>
  );
}

function RowSkeleton() {
  return (
    <div className="home-row" data-testid="home-loading">
      <Skeleton height={22} width="30%" radius="sm" />
      <div className="home-row-scroll">
        {[0, 1, 2].map(i => <Skeleton key={i} height={180} width={136} radius="md" />)}
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
        const canMove = Boolean(fleetEntry?.snapshot?.meta?.playbackOwner);
        const testId = tileTestId('now-on', `${deviceId}-${entry.contentId}`);
        const item = toItem(entry);
        return (
          <div key={`${entry.deviceId}-${entry.contentId}`} className="home-tile home-tile--now" data-testid={testId}>
            <div className="home-tile-picture home-tile-picture--static" aria-hidden>
              {entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" /> : null}
            </div>
            <div className="home-tile-head">
              <div className="home-tile-body">
                <span className="home-tile-title">{entry.title ?? 'Something'}</span>
                <span className="home-tile-line" data-testid={`${testId}-where`}>Now on {screen}</span>
              </div>
              {item && (
                <ItemMenu item={{ ...item, title: entry.title ?? item.title }} onVerb={kind => run(kind, item, { entry })}
                  favourite={favourites.has(item.id)} testId={testId} />
              )}
            </div>
            {(canRemote || canMove) && (
              <Group gap={6} className="home-tile-actions">
                {canRemote && <Button size="sm" variant="default" data-testid={`${testId}-remote`}
                  leftSection={<IconDeviceRemote size={14} aria-hidden />}
                  onClick={() => push('peek', { deviceId })}>
                  Remote
                </Button>}
                {canMove && <Button size="sm" variant="default" data-testid={`${testId}-move-here`}
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

function suggestionLines(rowId, item, entry, nameFor) {
  if (rowId === 'carry-on') {
    if (item.reason === 'next-episode' || entry?.reason === 'next-episode') {
      return [item.grandparentTitle ?? entry?.grandparentTitle ?? null, 'Next episode'];
    }
    const source = entry ?? item;
    const spots = differingSpots(entry);
    // FIND.10a/AC4: when screens hold different spots, each is its own line.
    if (spots.length > 1) {
      return [item.grandparentTitle ?? entry?.grandparentTitle ?? null,
        ...spots.map(spot => spotLine(spot, nameFor))];
    }
    return [item.grandparentTitle ?? entry?.grandparentTitle ?? null,
      formatLeft(source.playhead, source.duration), whereLine(source, nameFor)];
  }
  if (rowId === 'time-of-day') return [item.days ? `${item.days} days at about this time` : null];
  if (rowId === 'new') return [item.latest?.title ? `New: ${item.latest.title}` : 'Recently added'];
  return [];
}

export function HomeView() {
  // Read each render: the app may adopt its browser id after first paint.
  const deviceId = getDeviceId();
  const suggestions = useApiResource(suggestionsPath(deviceId), { swr: true, label: 'media-suggestions', logger: householdResourceLogger });
  const carryOn = useApiResource(HOUSEHOLD_PATHS.carryOn, { swr: true, label: 'media-carry-on', logger: householdResourceLogger });
  const recent = useApiResource(HOUSEHOLD_PATHS.recent, { swr: true, label: 'media-recent', logger: householdResourceLogger });
  const favourites = useFavourites();
  const { run, overlays, nameFor } = useItemVerbs();
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
  // A degraded answer (the server's catalog lookups ran out of time on a cold
  // start) is reloaded once, ~10 s later, so missing titles fill in.
  const reloadedRef = useRef(false);
  const degraded = [suggestions.data, carryOn.data, recent.data].some(data => data?.degraded === true);
  useEffect(() => {
    if (!degraded || reloadedRef.current) return undefined;
    const timer = setTimeout(() => {
      reloadedRef.current = true;
      mediaLog.householdDegradedReload({ deviceId });
      for (const resource of [suggestions, carryOn, recent]) if (resource.data?.degraded) resource.reload();
    }, DEGRADED_RELOAD_MS);
    return () => clearTimeout(timer);
  }, [degraded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const [section, resource] of [['suggestions', suggestions], ['carry-on', carryOn], ['recent', recent]]) {
      if (resource.error) mediaLog.householdLoadFailed({ section, error: resource.error.message });
    }
  }, [suggestions.error, carryOn.error, recent.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const tileFor = (rowId, raw) => {
    const item = toItem(raw);
    if (!item) return null;
    const entry = carryById.get(item.id) ?? null;
    const collection = isCollection(item);
    const favourite = favourites.has(item.id);
    const testId = tileTestId(rowId, item.id);
    const big = rowId === 'favourites';
    const cont = raw.continue?.contentId ? { id: raw.continue.contentId, title: raw.continue.title ?? null, itemType: 'leaf' } : null;
    let primary = null;
    // R8: "Continue S2E7" — the part is named on its own line so the button never truncates it.
    if (cont) primary = { label: 'Continue', ariaLabel: `Continue ${cont.title ?? ''}`.trim(), onClick: () => run('playNow', cont) };
    else if (collection || big) primary = { label: 'Play', onClick: () => run('playNow', item, { entry }) };
    const percent = raw.percent ?? entry?.percent ?? null;
    return (
      <HomeTile
        key={item.id}
        item={item}
        size={big ? 'large' : 'normal'}
        testId={testId}
        lines={[...suggestionLines(rowId, raw, entry, nameFor), cont?.title ? `Next: ${cont.title}` : null]}
        progress={rowId === 'carry-on' ? percent : null}
        primary={primary}
        // FIND.12b: a favourite's picture opens it; elsewhere the tap rule.
        onPicture={() => run(big ? 'open' : 'tap', item, { entry })}
        pictureLabel={big || collection ? `Open ${item.title ?? ''}`.trim() : `Play ${item.title ?? ''}`.trim()}
        onVerb={kind => run(kind, item, { entry })}
        favourite={favourite}
        watched={entry ? entry.finished === true : null}
        removable
      />
    );
  };

  let suggestionBody;
  if (suggestions.loading && !suggestions.data) suggestionBody = <RowSkeleton />;
  else if (suggestions.error && !suggestions.data) {
    suggestionBody = <ErrorState label="Suggestions" error={suggestions.error} onRetry={suggestions.reload} />;
  } else if (suggestions.data?.empty === true || rows.length === 0) {
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
    suggestionBody = rows.map(row => (
      <TileRow key={row.id} rowId={row.id} title={row.title}>
        {row.items.map(raw => tileFor(row.id, raw))}
      </TileRow>
    ));
  }

  return (
    <Stack data-testid="home-view" className="home-view" gap="lg">
      <ResumeCard />
      <NowOnRow entries={nowOn} nameFor={nameFor} run={run} favourites={favourites} />
      {suggestionBody}
      {recentItems.length > 0 && (
        <TileRow rowId="recent" title="Recent">
          {recentItems.map(entry => {
            const item = toItem(entry);
            if (!item) return null;
            const screens = nowOnIds.get(item.id);
            const where = screens?.length ? `Now on ${nameFor(screens[0])}` : whereLine(entry, nameFor);
            const collection = isCollection(item);
            return (
              <HomeTile
                key={item.id}
                item={item}
                testId={tileTestId('recent', item.id)}
                lines={[where, playedAtLabel(entry.plays?.[0]?.startedAt ?? entry.lastPlayed)]}
                onPicture={() => run('tap', item, { entry })}
                pictureLabel={collection ? `Open ${item.title ?? ''}`.trim() : `Play ${item.title ?? ''}`.trim()}
                onVerb={kind => run(kind, item, { entry })}
                favourite={favourites.has(item.id)}
                watched={entry.finished === true}
                removable
              />
            );
          })}
        </TileRow>
      )}
      {recent.error && !recent.data && (
        <ErrorState label="Recent" error={recent.error} onRetry={recent.reload} />
      )}
      {!recent.loading && !recent.error && recentItems.length === 0 && suggestions.data && (
        <p className="home-recents-empty" data-testid="home-recents-empty">Things played on any screen will show up here.</p>
      )}
      <Group justify="center">
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
