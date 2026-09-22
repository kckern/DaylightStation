// frontend/src/modules/Media/fleet/FleetPlayPicker.jsx
// Inline "play something on THIS device" picker for a fleet card: search-as-
// you-type (useLiveSearch), tap a result to dispatch it straight to the card's
// device. Dispatch is always mode:'fork' — playing on a remote device must
// never stop whatever the LOCAL browser session is doing (this flow never
// involves local playback). Progress feedback comes from the existing
// DispatchProgressTray, and the card itself goes live when the device reports.
// No raw source ids render: titles via displayTitle, context via
// resultSubtitle, device names via deviceName.
import React, { useCallback, useRef, useState } from 'react';
import { useDevice } from './useDevice.js';
import { deviceName } from './deviceDisplay.js';
import { useLiveSearch } from '../search/useLiveSearch.js';
import { displayTitle, resultSubtitle } from '../search/resultPresentation.js';
import { SearchEmptyState } from '../search/SearchEmptyState.jsx';
import { SearchErrorState } from '../search/SearchErrorState.jsx';
import { StreamStatusLine } from '../../Content/combobox/StreamStatusLine.jsx';
import { describeBusy } from '../cast/castCopy.js';
import { useDispatch } from '../cast/useDispatch.js';
import { useDismissable } from '../../../hooks/useDismissable.js';
import './Fleet.scss';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';

// Thumbnail for a result row: explicit thumbnail wins, else the display
// endpoint derived from the id (the id only ever appears in the img src
// attribute — never as rendered text).
function thumbnailSrc(row) {
  if (row.thumbnail && typeof row.thumbnail === 'string' && row.thumbnail.length > 0) return row.thumbnail;
  const id = row.id ?? row.itemId;
  if (!id) return null;
  const [source, ...rest] = String(id).split(':');
  if (!source || rest.length === 0) return null;
  return `/api/v1/display/${encodeURIComponent(source)}/${rest.join(':')}`;
}

// "playing Bluey" → "Playing Bluey" (describeBusy phrases start a sentence here).
function sentenceCase(phrase) {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function FleetPlayPicker({ deviceId, onClose }) {
  const { device, entry } = useDevice(deviceId);
  const { dispatchToTarget } = useDispatch();
  const liveSearch = useLiveSearch();
  const { results, error, sourceErrors, setQuery, retry } = liveSearch;
  const [text, setText] = useState('');
  const panelRef = useRef(null);

  // Escape / tap-outside dismisses. The card's own "Play…" button is marked
  // data-play-toggle=<id> and ignored here so its click toggles cleanly
  // (dismiss + re-open flicker otherwise).
  useDismissable(panelRef, { open: true, onDismiss: onClose, ignore: `[data-play-toggle="${deviceId}"]` });

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
  const idle = state.phase === 'idle';
  const searching = state.phase === 'loading';
  const hasResults = state.results.length > 0;
  const empty = state.phase === 'complete' && !hasResults;
  const failed = state.phase === 'failed';

  const onInput = useCallback((e) => {
    setText(e.target.value);
    setQuery(e.target.value);
  }, [setQuery]);

  const playRow = useCallback((row) => {
    const id = row.id ?? row.itemId;
    if (!id) return;
    // fork: never touches the local session — see header comment.
    dispatchToTarget({ targetIds: [deviceId], play: id, title: displayTitle(row), mode: 'fork',
      itemAction: { kind: 'playNow', item: { ...row, contentId: id }, clearRest: isContainer(row) } });
    onClose?.();
  }, [dispatchToTarget, deviceId, onClose]);

  return (
    <div ref={panelRef} data-testid={`fleet-play-panel-${deviceId}`} className="fleet-play-panel">
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
        <SearchErrorState error={error} onRetry={retry} />
      )}
      {hasResults && (
        <ul className="fleet-play-results">
          {results.map((row) => {
            const id = row.id ?? row.itemId;
            if (!id) return null;
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
          })}
          <li data-testid={Object.values(state.sources).includes('pending') ? 'fleet-play-pending' : undefined}>
            <StreamStatusLine state={state} onRetry={retry} />
          </li>
        </ul>
      )}
    </div>
  );
}

export default FleetPlayPicker;
