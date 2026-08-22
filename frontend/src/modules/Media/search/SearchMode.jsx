// frontend/src/modules/Media/search/SearchMode.jsx
// Full-screen mobile search surface (spec D1-D2). The mobile dock had ~336px
// to split between the scope control, the search input, and a 168px icon
// cluster — the input landed at ~50px, too narrow to even show its own
// placeholder, and a `:has(.media-search-bar:focus-within)` rule hid the
// scope control and the icon cluster the instant the field got focus (the
// one moment scope mattered). That rule is deleted. On mobile the dock is
// now a launcher (Dock.jsx); tapping it mounts this component instead, which
// gets the whole screen: ✕ + input (autofocus), DestinationLine, ScopeChips,
// StreamStatusLine, then a results list filling the rest.
//
// Rendered by the shell (MediaAppShell.jsx), not a route — it overlays
// whatever view is current and unmounting it (✕, browser back, or a
// successful dispatch) restores that view untouched, since Canvas never
// unmounts underneath it.
//
// Reuses the useContentCombobox HOOK for search state/transport/dedupe/D5
// fallback, but NOT the ContentCombobox popover component — a Mantine
// Combobox portal doesn't fit a full-screen surface. Results render via the
// shared ResultRow (Content/combobox/ResultRow.jsx — Task 14, spec D6): a
// leaf tap plays now, a container tap browses; the trailing ▶/⋯ are the
// explicit verbs (play-as-queue for containers; Play Now/Play Next/Up Next/
// Add to Queue/Open detail for leaves). Tapping a row dispatches via the
// same useContentDispatch path MediaContentSearch already uses.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { IconX, IconAlertTriangle } from '@tabler/icons-react';
import { useContentCombobox } from '../../Content/combobox/useContentCombobox.js';
import { StreamStatusLine } from '../../Content/combobox/StreamStatusLine.jsx';
import { ResultRow } from '../../Content/combobox/ResultRow.jsx';
import { useSearchContext } from './SearchProvider.jsx';
import { ScopeChips } from './ScopeChips.jsx';
import { DestinationLine } from '../cast/DestinationLine.jsx';
import { useContentDispatch } from './useContentDispatch.js';
import { useSessionController } from '../controller/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { applyResultRowVerb } from './resultRowVerbs.js';
import { displayTitle, resultSubtitle } from './resultPresentation.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../../lib/logging/Logger.js';
import mediaLog from '../logging/mediaLog.js';
import './Search.scss';

export function SearchMode({ onClose }) {
  const { scopes, currentScopeKey, currentScope, scopeError, resetScope } = useSearchContext();
  const { dispatch, playContainerAsQueue } = useContentDispatch();
  const { queue } = useSessionController('local');
  const { push } = useNav();
  const log = useMemo(() => getLogger().child({ component: 'search-mode' }), []);
  const inputRef = useRef(null);
  // Guards against a close path AND the popstate it triggers both firing a
  // close (every non-'back' close consumes the history entry pushed on open
  // via history.back(), which itself fires a popstate — this makes that
  // second one a no-op instead of a double-close).
  const closedRef = useRef(false);

  // ALL exits — ✕, browser back, and a successful dispatch — must leave
  // history exactly where it was before SearchMode opened. Centralizing the
  // history.back() call here (rather than duplicating it per exit path) is
  // what closes the CRITICAL 1 gap: handleChange used to call closeSurface
  // directly without ever consuming the pushed entry, so the most common
  // exit (tap a result) leaked a `mediaSearchMode: true` history entry that
  // then propagated into every later pushState via the `{...history.state}`
  // spread (here and in NavProvider's syncHistory) — the user's next real
  // back press would silently no-op, compounding with every open→dispatch
  // cycle.
  //
  // `opts.navigated` marks the exits where the dispatch ITSELF pushed a route
  // (a container tap, which browses; the ⋯ "Open detail" verb). Those must NOT
  // call history.back(): the route was written OVER this surface's marker
  // entry (NavProvider push with `replaceEntry`, threaded from here), so there
  // is nothing left to traverse. Calling back() anyway was CRITICAL 1 of the
  // final review — it popped the entry the navigation had just created and
  // landed on the marker's PRE-search nav stack, so tapping "Tuttle Twins" in
  // mobile search navigated to the episode list and instantly bounced back to
  // Home. The signal is the dispatch's own return value, never a timer.
  const closeSurface = useCallback((reason, opts = {}) => {
    if (closedRef.current) return;
    closedRef.current = true;
    mediaLog.searchModeExited({ reason });
    onClose?.();
    if (reason === 'back') return; // the popstate we're reacting to already consumed it
    if (opts.navigated) {
      // The pushed route replaced this entry. Strip the marker flag so it
      // can't ride along into every later pushState via the
      // `{...history.state}` spread (NavProvider's syncHistory does the same
      // spread, and reads whatever we leave here).
      const state = { ...(window.history.state || {}) };
      delete state.mediaSearchMode;
      window.history.replaceState(state, '');
      return;
    }
    // Nothing navigated: consume the entry pushed on open so the user isn't
    // left needing two backs. This fires a popstate too, but closedRef is
    // already set, so the listener below no-ops for it.
    window.history.back();
  }, [onClose]);

  // NavProvider's push, bound to replace this surface's marker entry — see
  // closeSurface. Handed to the ⋯ verb applier so "Open detail" gets the same
  // treatment a container tap gets through dispatch().
  const pushOverSurface = useCallback(
    (view, params) => push(view, params, { replaceEntry: true }),
    [push]
  );

  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    const route = dispatch(id, item, { replaceHistoryEntry: true });
    log.info('dispatch', { contentId: id, route });
    // Cast/peek dispatches already surface their own toast
    // (useContentDispatch's confirmation/failure notifications); a local
    // queue play has none today, and a bare close with no acknowledgement is
    // exactly the "hidden state, silent tap" pattern this whole remediation
    // exists to fix.
    if (route === 'local') {
      notifications.show({
        id: 'search-mode-dispatch-local',
        color: 'teal',
        autoClose: 2500,
        title: item?.title ? `Playing ${item.title}` : 'Playing',
      });
    }
    // 'browse' is the only route that navigates (containers always browse).
    closeSurface('dispatch', { navigated: route === 'browse' });
  }, [dispatch, log, closeSurface]);

  // Trailing ▶ on a container row (Task 14, spec D6): explicitly send the
  // whole container to the current destination, replacing the queue. Same
  // toast/close treatment as a leaf tap — this IS a dispatch, just one the
  // user opted into via the verb instead of the row tap.
  const handlePlayAll = useCallback((item) => {
    const id = item?.id;
    if (!id) return;
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb: 'playAll' });
    const route = playContainerAsQueue(id, item);
    log.info('dispatch', { contentId: id, route, verb: 'playAll' });
    if (route === 'local') {
      notifications.show({
        id: 'search-mode-dispatch-local',
        color: 'teal',
        autoClose: 2500,
        title: item?.title ? `Playing ${item.title}` : 'Playing',
      });
    }
    closeSurface('dispatch');
  }, [playContainerAsQueue, log, closeSurface]);

  // Trailing ⋯ on a leaf row: Play Now / Play Next / Up Next / Add to Queue
  // / Open detail. Reuses the exact appliers BrowseView rows use (queueOps
  // via LocalSessionController) — see resultRowVerbs.js.
  const handleMore = useCallback((action, item) => {
    const id = item?.id;
    if (!id) return;
    log.info('row_action', { contentId: id, action });
    applyResultRowVerb(action, item, { queue, push: pushOverSurface });
    // 'detail' is the only verb that navigates; the four queue verbs don't.
    closeSurface('dispatch', { navigated: action === 'detail' });
  }, [queue, pushOverSurface, log, closeSurface]);

  const combo = useContentCombobox({
    value: '',
    onChange: handleChange,
    searchParams: currentScope?.params ?? '',
    // D5: scopes[0] is the catalog-wide ("All") scope by convention.
    fallbackSearchParams: scopes[0]?.params ?? '',
    scopeKey: currentScopeKey,
    scopeLabel: currentScope?.label ?? null,
    appResults: true,
    selectContainers: true,
    allowFreeform: false,
    logApp: 'media',
  });
  const { state, handleInput, select, isSearching, pendingSources, sourceErrors, fellBackToAll } = combo;
  const results = state.results;
  const searchText = state.search ?? '';

  // Every open resets scope to catalog-wide (spec D1: scope never carries
  // over from a prior search session) and autofocuses the input. This is a
  // mount-once effect — SearchMode is only ever in the tree while open (the
  // shell conditionally mounts it), so mount === open.
  useEffect(() => {
    resetScope();
    mediaLog.searchModeEntered({});
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once per mount
  }, []);

  // Browser back closes the surface: push one history entry on open, close
  // (without pushing another) on popstate from ANY back gesture while open.
  useEffect(() => {
    window.history.pushState({ ...(window.history.state || {}), mediaSearchMode: true }, '');
    const onPopState = () => closeSurface('back');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once per mount
  }, []);

  const closeViaButton = useCallback(() => {
    closeSurface('dismiss');
  }, [closeSurface]);

  const handleStreamRetry = useCallback((source) => {
    log.info('stream_status.retry', { source, text: searchText });
    handleInput(searchText);
  }, [handleInput, searchText, log]);

  const showHint = results.length === 0 && !isSearching && searchText.trim().length < 2;
  // The widening notice below already explains an empty widened search in
  // scope-aware wording, so the generic empty line would only repeat it.
  const showEmpty = results.length === 0 && !isSearching && searchText.trim().length >= 2 && !fellBackToAll;
  // D5 widening notice (Finding 2 of the final review). The hook widens a
  // scope that settled empty and ContentCombobox says so on desktop — but this
  // surface, the one the whole remediation exists for, rendered nothing: the
  // Ambient chip stayed aria-pressed while catalog-wide results appeared under
  // it with no explanation. Same wording as the desktop notice, naming the
  // scope that came up empty. Held back while the widened search is still in
  // flight so it can't flash "nothing anywhere" before the results land.
  const scopeThatCameUpEmpty = currentScope?.label || 'this scope';
  const showWideningNotice = fellBackToAll && !isSearching;

  return (
    <div className="search-mode" data-testid="search-mode" role="dialog" aria-modal="true" aria-label="Search media">
      <div className="search-mode-header">
        <button
          type="button"
          className="search-mode-close"
          data-testid="search-mode-close"
          aria-label="Close search"
          onClick={closeViaButton}
        >
          <IconX size={22} />
        </button>
        <input
          ref={inputRef}
          type="search"
          className="search-mode-input"
          data-testid="search-mode-input"
          placeholder="Search media…"
          aria-label="Search media"
          value={searchText}
          onChange={(e) => handleInput(e.target.value)}
        />
      </div>

      <DestinationLine surface="search-mode" />

      <div className="search-mode-scope">
        <ScopeChips />
        {scopeError && (
          <span data-testid="scope-error" className="scope-error" title={scopeError.message}>
            <IconAlertTriangle size={16} aria-label="Scope config failed to load" />
          </span>
        )}
      </div>

      <StreamStatusLine pending={pendingSources} sourceErrors={sourceErrors} onRetry={handleStreamRetry} />

      {showWideningNotice && (
        <div className="search-mode-widening-notice" data-testid="search-mode-widening-notice" role="status">
          {results.length > 0
            ? `Nothing in ${scopeThatCameUpEmpty} — showing ${results.length} result${results.length === 1 ? '' : 's'} from everywhere.`
            : `Nothing in ${scopeThatCameUpEmpty} — and nothing found anywhere else either.`}
        </div>
      )}

      <ul className="search-mode-results media-search-results" data-testid="search-mode-results">
        {showHint && (
          <li className="search-mode-hint" data-testid="search-mode-hint">Type to search…</li>
        )}
        {showEmpty && (
          <li className="search-mode-hint" data-testid="search-mode-empty">
            No results for &ldquo;{searchText}&rdquo;. Try a different word or change the scope.
          </li>
        )}
        {results.map((item) => (
          <li key={item.id} className="result-row">
            <ResultRow
              item={item}
              title={displayTitle(item)}
              subtitle={resultSubtitle(item)}
              thumbnail={item.thumbnail}
              onTap={() => select(item)}
              onPlayAll={() => handlePlayAll(item)}
              onMore={(action) => handleMore(action, item)}
              testId={`search-mode-result-${item.id}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SearchMode;
