// frontend/src/modules/Media/fleet/FleetPlayPicker.jsx
// Inline "play something on THIS device" picker for a fleet card: search-as-
// you-type (useLiveSearch), tap a result to dispatch it straight to the card's
// device. Dispatch is always mode:'fork' — playing on a remote device must
// never stop whatever the LOCAL browser session is doing (this flow never
// involves local playback). Progress feedback comes from the existing
// DispatchProgressTray, and the card itself goes live when the device reports.
// No raw source ids render: titles via displayTitle, context via
// resultSubtitle, device names via deviceName.
import React, { useCallback, useMemo, useState } from 'react';
import { useClickOutside } from '@mantine/hooks';
import { useDevice } from "./useDevice.js";
import { deviceName } from "./deviceDisplay.js";
import { useLiveSearch } from "../search/useLiveSearch.js";
import { displayTitle, resultSubtitle } from "../search/resultPresentation.js";
import { SearchEmptyState } from "../search/SearchEmptyState.jsx";
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import { StreamStatusLine, SourceFailureNote } from "../../../../../__capabilities/content-catalog/browser/search-status.mjs";
import { describeBusy } from "../cast/castCopy.js";
import { useDispatch } from "../cast/useDispatch.js";
import { useHotkey } from "@/lib/hooks/useHotkey.js";
import { useDismissLayer } from "@/lib/ui/dismiss/useDismissLayer.js";
import "./Fleet.scss";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { rankByHabits } from "../habits/mediaHabits.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { TopMoreList } from '@/lib/ui/TopMore.jsx';
import { SEARCH_RESULTS_SHOWN } from "../search/searchLimits.js";
import mediaLog from "../logging/mediaLog.js";

// Thumbnail for a result row: explicit thumbnail wins, else the display
// endpoint derived from the id (the id only ever appears in the img src
// attribute — never as rendered text).
function thumbnailSrc(row) {
  if (row.thumbnail && typeof row.thumbnail === 'string' && row.thumbnail.length > 0) return row.thumbnail;
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const [source, ...rest] = String(id).split(':');
  if (!source || rest.length === 0) return null;
  const encodedPath = rest.join(':').split('/').map(encodeURIComponent).join('/');
  return `/api/v1/display/${encodeURIComponent(source)}/${encodedPath}`;
}

// "playing Bluey" → "Playing Bluey" (describeBusy phrases start a sentence here).
function sentenceCase(phrase) {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

const OUTSIDE_EVENTS = ['pointerdown'];

export function FleetPlayPicker({ deviceId, onClose, openerRef }) {
  const { device, entry } = useDevice(deviceId);
  const { dispatchToTarget } = useDispatch();
  const liveSearch = useLiveSearch();
  const { results: rawResults, error, sourceErrors, setQuery, retry } = liveSearch;
  const [text, setText] = useState('');
  // What this person picked for these words before comes first, as in the
  // search box (habits/mediaHabits.js).
  const { scoresFor, recordPick } = usePlayDestination();
  const results = useMemo(() => rankByHabits(rawResults, scoresFor(text)), [rawResults, scoresFor, text]);
  const playableResults = results.filter((row) => row.id ?? row.itemId);
  const [panel, setPanel] = useState(null);
  const inside = useMemo(() => {
    const opener = openerRef?.current;
    return opener ? [panel, opener] : [panel];
  }, [panel, openerRef]);
  const closeFromKeyboard = useCallback(() => {
    onClose?.();
    openerRef?.current?.focus({ preventScroll: true });
  }, [onClose, openerRef]);
  const usesDismissStack = useDismissLayer(true, closeFromKeyboard);
  useHotkey('escape', () => {
    if (usesDismissStack) return false;
    closeFromKeyboard();
  });
  useClickOutside(onClose, OUTSIDE_EVENTS, inside);

  const name = deviceName(device, deviceId);
  const busy = describeBusy(entry);
  const state = liveSearch.state ?? {
    query: text, scope: '',
    sources: Object.fromEntries([
      ...(liveSearch.pending ?? []).map((source) => [source, 'pending']),
      ...(sourceErrors ?? []).map(({ source }) => [source, 'failed']),
    ]),
    results,
    phase: error ? 'failed' : liveSearch.isSearching ? (results.length ? 'partial' : 'loading')
      : text.trim().length < 2 ? 'idle' : 'complete',
    failedSources: (sourceErrors ?? []).map(({ source }) => source),
  };
  const hasResults = state.results.length > 0;
  const idle = state.phase === 'idle' && !liveSearch.isSearching;
  const searching = !hasResults && (state.phase === 'loading' || liveSearch.isSearching);
  const empty = state.phase === 'complete' && !hasResults;
  const failed = state.phase === 'failed';
  const showStreamStatus = hasResults || state.phase === 'partial';

  const onInput = useCallback((e) => {
    setText(e.target.value);
    setQuery(e.target.value);
  }, [setQuery]);

  const playRow = useCallback((row) => {
    const id = row.id ?? row.itemId;
    if (!id) return;
    recordPick(text, { ...row, id }, 'fleet-play');
    // fork: never touches the local session — see header comment.
    dispatchToTarget({ targetIds: [deviceId], play: id, title: displayTitle(row), mode: 'fork',
      itemAction: { kind: 'playNow', item: { ...row, contentId: id }, clearRest: isContainer(row) } });
    closeFromKeyboard();
  }, [dispatchToTarget, deviceId, closeFromKeyboard, recordPick, text]);

  return (
    <div ref={setPanel} data-testid={`fleet-play-panel-${deviceId}`} className="fleet-play-panel">
      <input
        data-testid={`fleet-play-input-${deviceId}`}
        className="fleet-play-input"
        type="search"
        autoFocus
        placeholder={`Play on ${name}…`}
        aria-label={`Search for something to play on ${name}`}
        value={text}
        onChange={onInput}
      />
      {busy && (
        <div
          role="status"
          data-testid={`fleet-play-busy-${deviceId}`}
          className="fleet-play-busy"
        >
          {sentenceCase(busy.phrase)} — this will replace it
        </div>
      )}
      {idle && (
        <div className="fleet-play-hint">Search your libraries for something to play here.</div>
      )}
      {searching && (
        <div data-testid="fleet-play-searching" className="search-still-searching" aria-live="polite">
          <span className="search-still-searching-spinner" aria-hidden="true" />
          Searching…
        </div>
      )}
      {empty && (
        <SearchEmptyState query={state.query} sourceErrors={sourceErrors} onRetry={retry} />
      )}
      {failed && (
        <LoadErrorLine kind="search" error={error} onRetry={retry}
          testId="search-error" retryTestId="search-retry" className="search-state search-state--error" />
      )}
      {showStreamStatus && (
        <div data-testid={Object.values(state.sources).includes('pending') ? 'fleet-play-pending' : undefined}>
          <StreamStatusLine state={state} onRetry={retry} />
        </div>
      )}
      {hasResults && (
        <ul className="fleet-play-results">
          <TopMoreList
            items={playableResults}
            n={SEARCH_RESULTS_SHOWN}
          // Results stream in and re-rank: the first eight are the first eight.
          stable={false}
            getId={(row) => row.id ?? row.itemId}
            moreAs="li"
            testId={`fleet-play-results-${deviceId}`}
            moreLabel={() => `Show all ${playableResults.length}`}
            onExpand={(counts) => mediaLog.listMoreExpanded({ surface: 'devices-play-search', ...counts })}
            renderItem={(row) => {
            const id = row.id ?? row.itemId;
            const thumb = thumbnailSrc(row);
            const subtitle = resultSubtitle(row);
            return (
              <li key={id}>
                <button
                  type="button"
                  data-testid={`fleet-play-result-${id}`}
                  className="fleet-play-result"
                  onClick={() => playRow(row)}
                >
                  {thumb && (
                    <img
                      className="fleet-play-thumb"
                      src={thumb}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    />
                  )}
                  <span className="fleet-play-result-text">
                    <span className="fleet-play-result-title">{displayTitle(row)}</span>
                    {subtitle && <span className="fleet-play-result-subtitle">{subtitle}</span>}
                  </span>
                </button>
              </li>
            );
          }}
          />
        </ul>
      )}
      {/* An everything search: libraries that did not answer are one quiet
          line under the results, never a row per source above them. */}
      {!liveSearch.isSearching && state.phase !== 'idle' && (
        <SourceFailureNote failedSources={state.failedSources ?? []} onRetry={retry} />
      )}
    </div>
  );
}

export default FleetPlayPicker;
