// frontend/src/modules/Media/search/SearchMode.jsx
// Full-screen mobile search surface (spec D1-D2). The mobile dock had ~336px
// to split between the scope control, the search input, and a 168px icon
// cluster — the input landed at ~50px, too narrow to even show its own
// placeholder, and a `:has(.media-search-bar:focus-within)` rule hid the
// scope control and the icon cluster the instant the field got focus (the
// one moment scope mattered). That rule is deleted. On mobile the dock is
// now a launcher (Dock.jsx); tapping it mounts this component instead, which
// gets the whole screen: ✕ + input (autofocus) + the destination chip (where
// ▶ plays; Tab in the box or a tap on it cycles it — DestinationChip.jsx),
// ScopeChips, StreamStatusLine, then a results list filling the rest.
//
// Rendered by the shell (MediaAppShell.jsx), not a route — it overlays
// whatever view is current. Playback and queue actions keep it mounted so
// the person's exact query and narrowing survive a building session; only
// explicit dismissal/back or navigation into browse/detail unmounts it.
//
// Reuses the useContentCombobox HOOK for search state/transport/dedupe/D5
// fallback, but NOT the ContentCombobox popover component — a Mantine
// Combobox portal doesn't fit a full-screen surface. Results render via the
// shared ResultRow (Content/combobox/ResultRow.jsx): a tap is a LOOK — a
// leaf opens its detail page, a container its list — and the trailing ▶ that
// names a screen ("▶ Office Screen") is the one deliberate play; ⋯ holds the
// rest (Play here, Play Next, Up Next, Add to Queue, Open detail). Results
// this person picked for these words before come first (habits/). Tapping a row dispatches via the
// same useContentDispatch path MediaContentSearch already uses.
import { useWatchPhoneKeeps } from "../cast/usePhoneKeeps.jsx";
import { isKeepable } from "../cast/phoneKeeps.js";
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Button, UnstyledButton } from '@mantine/core';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { useContentCombobox } from "../../../../../__capabilities/content-catalog/browser/picker-controller.mjs";
import { StreamStatusLine, SearchSkeletonRows } from "../../../../../__capabilities/content-catalog/browser/search-status.mjs";
import { ResultRow } from "../../../../../__capabilities/content-catalog/browser/result-row.mjs";
import { useSearchContext } from "./useSearchContext.js";
import { ScopeChips } from "./ScopeChips.jsx";
import { DestinationChip, useDestinationCycle } from "./DestinationChip.jsx";
import { useContentDispatch } from "./useContentDispatch.js";
import { useSessionController } from "../controller/useSessionController.js";
import { useNav } from "../shell/NavProvider.jsx";
import { applyResultRowVerb } from "./resultRowVerbs.js";
import { collapseResultEditions } from "./collapseResultEditions.js";
import { useRowLabels } from "./useRowLabels.js";
import { displayTitle, resultSubtitle } from "./resultPresentation.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import mediaLog from "../logging/mediaLog.js";
import { useDialogFocus } from '@/lib/ui/dismiss/useDialogFocus.js';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { useHouseholdResultActions } from "../household/useHouseholdResultActions.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { rankByHabits } from "../habits/mediaHabits.js";
import { TopMoreList } from '@/lib/ui/TopMore.jsx';
import { SEARCH_RESULTS_SHOWN } from "./searchLimits.js";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { useSearchRecents } from "./useSearchRecents.js";
import "./Search.scss";
import "../shell/SessionControls.scss";

function SearchResultRow({ onAction, ...props }) {
  const moreTriggerRef = useRef(null);
  return (
    <ResultRow
      {...props}
      MoreMenu={ActionMenu}
      moreTriggerRef={moreTriggerRef}
      onAction={({ kind, item }) => onAction(kind, item, moreTriggerRef)}
    />
  );
}

// `addTo` ({ deviceId, name }) opens this search for ONE addition to that
// screen's queue (STEER.1b/AC7, RQ-STEER-22): every pick is added there, the
// aim is untouched, and the surface closes once the addition is sent.
// The phone search surface unmounts when it closes; its last words live
// here for this tab so the next open starts from them.
const LAST_SEARCH_KEY = 'media-app.last-search';
function lastSearchText() {
  try { return sessionStorage.getItem(LAST_SEARCH_KEY) || ''; } catch { return ''; }
}
function rememberSearchText(text) {
  try {
    if (text) sessionStorage.setItem(LAST_SEARCH_KEY, text);
    else sessionStorage.removeItem(LAST_SEARCH_KEY);
  } catch { /* private mode: nothing kept */ }
}

export function SearchMode({ onClose, addTo = null, restoreSearchFocus, keepScope = false }) {
  const [oneShotAction, setOneShotAction] = useState(null);
  const { scopes, currentScopeKey, currentScope, resetScope, setScopeKey } = useSearchContext();
  const { dispatch, dispatchLeafVerb, playContainerAsQueue, addToScreen } = useContentDispatch();
  const { rowLabelsFor, continueFor, screenFor } = useRowLabels();
  const { extraActions, runHousehold } = useHouseholdResultActions();
  const { queue } = useSessionController('local');
  const { push } = useNav();
  const { scoresFor, rememberedFor, recordPick } = usePlayDestination();
  const { cycle: cycleDestination } = useDestinationCycle();
  const log = useMemo(() => getLogger().child({ component: 'search-mode' }), []);
  // The words on screen when a row is opened or played (set below, read by
  // the handlers, which are defined before the combobox that owns the text).
  const searchTextRef = useRef('');
  // The empty box offers Continue and recent searches (owner ruling
  // 2026-11-27); words are remembered with their scope only when acted on.
  const recents = useSearchRecents({ enabled: !addTo, allScopeKey: scopes[0]?.key ?? null });
  const currentScopeRef = useRef(currentScope);
  currentScopeRef.current = currentScope;
  const rememberWords = useCallback(() => {
    const words = searchTextRef.current;
    if (!addTo && words && words.trim().length >= 2) recents.remember(words.trim(), currentScopeRef.current);
  }, [recents, addTo]);
  const dialogRef = useRef(null);
  const searchInputRef = useRef(null);
  const handleDialogKeys = useDialogFocus(true, dialogRef, searchInputRef);
  const priorFocusRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const priorScrollRef = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  // Guards against a close path AND the popstate it triggers both firing a
  // close (every non-'back' close consumes the history entry pushed on open
  // via history.back(), which itself fires a popstate — this makes that
  // second one a no-op instead of a double-close).
  const closedRef = useRef(false);

  // ALL exits — ✕, browser back, and result navigation — must leave a
  // coherent one-step history. Playback/queue
  // actions are deliberately absent from this helper: they retain both the
  // mounted search state and its marker until the person dismisses Search.
  // Centralizing actual exits here prevents a marker from leaking into later
  // NavProvider entries through their `{...history.state}` spread.
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
    if (!opts.navigated) {
      const previous = priorFocusRef.current;
      previous?.focus?.({ preventScroll: true });
      if (previous === document.body || document.activeElement !== previous) {
        restoreSearchFocus?.();
      }
      if (typeof window !== 'undefined' && window.scrollY !== priorScrollRef.current) {
        window.scrollTo?.({ top: priorScrollRef.current, behavior: 'instant' });
      }
    }
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
  }, [onClose, restoreSearchFocus]);

  // NavProvider's push, bound to replace this surface's marker entry — see
  // closeSurface. Handed to the ⋯ verb applier so "Open detail" gets the same
  // treatment a container tap gets through dispatch().
  const pushOverSurface = useCallback(
    (view, params) => push(view, params, { replaceEntry: true }),
    [push]
  );

  const addOnce = useCallback((id, item, verb) => {
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb, addTo: addTo.deviceId });
    addToScreen(addTo.deviceId, id, item);
    mediaLog.addToQueueClosed({ deviceId: addTo.deviceId, reason: 'added', contentId: id });
    closeSurface('added');
  }, [addTo, addToScreen, closeSurface, log]);

  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    if (addTo) { addOnce(id, item, 'tap'); return; }
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    recordPick(searchTextRef.current, { ...item, id }, 'open');
    rememberWords();
    // From search: the info view lands on its PLAY, and Back from it reopens
    // this search with the same words (MediaAppShell).
    const route = dispatch(id, item, { replaceHistoryEntry: true, from: 'search', via: 'tap' });
    log.info('dispatch', { contentId: id, route });
    // A tap is a look: a collection opens its list, an item its detail page —
    // both navigate, so the marker entry is handed over and the surface
    // exits. (A camera shown here is the one tap that does not navigate.)
    if (route === 'browse' || route === 'detail') closeSurface('dispatch', { navigated: true });
  }, [dispatch, log, closeSurface, addTo, addOnce, recordPick, rememberWords]);

  // Trailing ▶ on a container row (Task 14, spec D6): explicitly send the
  // whole container to the current destination, replacing the queue. This is
  // playback, not navigation, so SearchMode stays mounted for the next pick.
  const handlePlayAll = useCallback((item) => {
    const id = item?.id;
    if (!id) return;
    if (addTo) { addOnce(id, item, 'playAll'); return; }
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb: 'playAll' });
    recordPick(searchTextRef.current, item, 'play');
    rememberWords();
    // A playable row's own ▶: play it where the ▶ says. Playback is not
    // navigation, so Search stays open for the next pick.
    // A film nobody has chosen a screen for asks where (its ▶ read "Play on…").
    const ask = (route, what = item) => { if (route === 'ask') setOneShotAction({ kind: 'playOn', item: what, returnFocusRef: searchInputRef }); };
    if (!isContainer(item)) {
      const route = dispatchLeafVerb('playNow', id, item);
      ask(route);
      log.info('dispatch', { contentId: id, route, verb: 'play' });
      return;
    }
    // FIND.8b/AC2: with a part under way the inline play IS "Continue S2E7".
    const cont = continueFor(item);
    if (cont) {
      mediaLog.collectionContinued({ collectionId: id, contentId: cont.contentId, label: cont.label });
      const episode = { id: cont.contentId, title: cont.title, type: 'episode', itemType: 'leaf' };
      const route = dispatchLeafVerb('playNow', cont.contentId, episode);
      ask(route, episode);
      log.info('dispatch', { contentId: cont.contentId, route, verb: 'continue' });
      return;
    }
    const route = playContainerAsQueue(id, item);
    ask(route);
    log.info('dispatch', { contentId: id, route, verb: 'playAll' });
  }, [playContainerAsQueue, dispatchLeafVerb, continueFor, log, addTo, addOnce, recordPick, rememberWords]);

  // Trailing ⋯ on a leaf row: Play Now / Play Next / Up Next / Add to Queue
  // / Open detail. Reuses the exact appliers BrowseView rows use (queueOps
  // via LocalSessionController) — see resultRowVerbs.js.
  const handleMore = useCallback((action, item, moreTriggerRef) => {
    const id = item?.id;
    if (!id) return;
    log.info('row_action', { contentId: id, action });
    if (addTo && action !== 'detail' && action !== 'details') { addOnce(id, item, action); return; }
    if (['playNow', 'playHere', 'playOn', 'detail', 'details'].includes(action)) { recordPick(searchTextRef.current, item, action); rememberWords(); }
    if (runHousehold(action, item)) return;
    if (action === 'openScreen') {
      const deviceId = screenFor(item);
      if (deviceId) { pushOverSurface('peek', { deviceId }); closeSurface('dispatch', { navigated: true }); }
      return;
    }
    if (action === 'playHere') { dispatchLeafVerb('playNow', id, item, { targetIds: [] }); return; }
    if (action === 'playOn' || action === 'addOn') {
      const returnFocusRef = {
        get current() {
          const trigger = moreTriggerRef.current;
          return trigger?.isConnected ? trigger : searchInputRef.current;
        },
      };
      setOneShotAction({ kind: action, item, returnFocusRef });
      return;
    }
    if (action !== 'detail' && action !== 'details') {
      const route = dispatchLeafVerb(action === 'upNext' ? 'playFirst' : action, id, item);
      if (route === 'ask') setOneShotAction({ kind: 'playOn', item, returnFocusRef: searchInputRef });
      return;
    }
    applyResultRowVerb('detail', item, { queue, push: pushOverSurface });
    // 'detail' is the only verb that navigates; queue mutations leave search
    // and its marker untouched.
    if (action === 'detail' || action === 'details') closeSurface('dispatch', { navigated: true });
  }, [queue, pushOverSurface, log, closeSurface, dispatchLeafVerb, addTo, addOnce, runHousehold, recordPick, screenFor, rememberWords]);

  const combo = useContentCombobox({
    value: '',
    onChange: handleChange,
    searchParams: currentScope?.params ?? '',
    // D5: scopes[0] is the catalog-wide ("All") scope by convention. A picked
    // scope is honoured: empty reads "Nothing for … in ‹scope›" and offers
    // Search everything (2026-11-27), it never widens on its own.
    fallbackSearchParams: scopes[0]?.params ?? '',
    widenOnEmpty: 'offer',
    scopeKey: currentScopeKey,
    scopeLabel: currentScope?.label ?? null,
    appResults: true,
    selectContainers: true,
    allowFreeform: false,
    logApp: 'media',
  });
  const {
    state, searchState, handleInput, isSearching, pendingSources, sourceErrors,
    streamError, retrySource = () => {}, fellBackToAll, searchSettled,
    scopeEmpty = false, widenSearch = () => {},
  } = combo;
  const searchText = state.search ?? '';
  searchTextRef.current = searchText;
  // Written only once the open has restored the last words (below), so the
  // first, empty render does not erase them.
  const restoredRef = useRef(false);
  useEffect(() => { if (!addTo && restoredRef.current) rememberSearchText(searchText); }, [searchText, addTo]);
  // What this person picked for these words before comes first.
  // A remembered pick holds row 1 from the first keystroke, in the
  // catalog-wide scope only (see MediaContentSearch).
  const wholeCatalog = currentScopeKey == null || currentScopeKey === scopes[0]?.key;
  const results = useMemo(
    () => rankByHabits(collapseResultEditions(state.results), scoresFor(searchText), wholeCatalog && isSearching ? rememberedFor(searchText) : null),
    [state.results, scoresFor, rememberedFor, searchText, wholeCatalog, isSearching],
  );
  // Keep on Phone states stay fresh only while keepable rows are shown.
  useWatchPhoneKeeps(null, { always: results.some(isKeepable) });

  // Every open resets scope to catalog-wide (spec D1: scope never carries
  // over from a prior search session). This is a
  // mount-once effect — SearchMode is only ever in the tree while open (the
  // shell conditionally mounts it), so mount === open. Coming BACK from an
  // info view this search opened is the same search session, not a new one
  // (`keepScope`): the words, results and narrowing all stay.
  useEffect(() => {
    if (!keepScope) resetScope();
    mediaLog.searchModeEntered({});
    // Reopening search shows the last words and what they find: going back to
    // the same search is the common case; ✕ in the box clears it.
    const last = lastSearchText();
    if (last && !addTo) handleInput(last);
    restoredRef.current = true;
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
    if (addTo) mediaLog.addToQueueClosed({ deviceId: addTo.deviceId, reason: 'dismissed' });
    closeSurface('dismiss');
  }, [closeSurface, addTo]);

  useDismissLayer(true, closeViaButton);

  const handleStreamRetry = useCallback((source) => {
    log.info('stream_status.retry', { source, text: searchText });
    retrySource(source);
  }, [retrySource, searchText, log]);

  // The empty box: Continue, then recent searches, at once from cache.
  const idleActive = !addTo && searchText === '' && (recents.continueItems.length + recents.searches.length) > 0;
  const idleShownRef = useRef(false);
  useEffect(() => {
    if (!idleActive) { idleShownRef.current = false; return; }
    if (idleShownRef.current) return;
    idleShownRef.current = true;
    log.info('search.recents-shown', { continue: recents.continueItems.length, searches: recents.searches.length });
  }, [idleActive]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentsRef = useRef(null);
  const pickRecentSearch = useCallback((entry, via) => {
    log.info('search.recent-picked', { kind: 'search', scopeKey: entry.scopeKey ?? null, via });
    const known = scopes.some((sc) => sc.key === entry.scopeKey || (sc.children || []).some((c) => c.key === entry.scopeKey));
    if (entry.scopeKey && known) setScopeKey?.(entry.scopeKey);
    else resetScope?.();
    handleInput(entry.text);
    searchInputRef.current?.focus();
  }, [log, scopes, setScopeKey, resetScope, handleInput]);
  // ↓ from the box goes into the list; ↑ / ↓ move between its rows.
  const moveInRecents = useCallback((dir, from = null) => {
    const rows = [...(recentsRef.current?.querySelectorAll('[data-recents-row]') ?? [])];
    if (!rows.length) return false;
    const at = from ? rows.indexOf(from) : -1;
    const next = at + dir;
    if (next < 0) { searchInputRef.current?.focus(); return true; }
    rows[Math.min(next, rows.length - 1)]?.focus();
    return true;
  }, []);
  const showHint = !idleActive && results.length === 0 && !isSearching && searchText.trim().length < 2;
  // A completed transport can still retain an individually failed source.
  // Keep that recovery state distinct from a successful empty search.
  const hasUnresolvedSourceFailures = sourceErrors.length > 0;
  // The widening notice below already explains an empty widened search in
  // scope-aware wording, so the generic empty line would only repeat it.
  // Addendum item 4: until the words typed are the words searched, the list
  // holds its shape (skeleton rows) and never says "No results".
  const awaitingResults = searchText.trim().length >= 2 && searchSettled === false && !streamError;
  // A picked scope that came up empty offers the wider search instead.
  const showScopeEmpty = scopeEmpty && results.length === 0 && !isSearching && !streamError;
  const showEmpty = !showScopeEmpty && results.length === 0 && !isSearching && !awaitingResults && !streamError && !hasUnresolvedSourceFailures && searchText.trim().length >= 2 && !fellBackToAll;
  const emptyMessage = showScopeEmpty
    ? `Nothing for “${searchText}” in ${currentScope?.label || 'this scope'}`
    : `No results for “${searchText}”. Try a different word or change the scope.`;
  // D5 widening notice (Finding 2 of the final review). The hook widens a
  // scope that settled empty and ContentCombobox says so on desktop — but this
  // surface, the one the whole remediation exists for, rendered nothing: the
  // Ambient chip stayed aria-pressed while catalog-wide results appeared under
  // it with no explanation. Same wording as the desktop notice, naming the
  // scope that came up empty. Held back while the widened search is still in
  // flight so it can't flash "nothing anywhere" before the results land.
  const scopeThatCameUpEmpty = currentScope?.label || 'this scope';
  useEffect(() => {
    if (streamError) mediaLog.loadFailed({ surface: 'search-mode', kind: streamError.kind, error: streamError.message });
  }, [streamError]);
  const showWideningNotice = fellBackToAll && !isSearching && !streamError;

  return (
    <div ref={dialogRef} onKeyDown={handleDialogKeys} className="search-mode" data-testid="search-mode" role="dialog" aria-modal="true" aria-label="Search media">
      <div className="search-mode-header">
        <button
          type="button"
          className="search-mode-close"
          data-testid="search-mode-close"
          aria-label="Close search"
          onClick={closeViaButton}
        >
          <UiIcon name="close" size={22} />
        </button>
        <input
          ref={searchInputRef}
          data-autofocus
          type="search"
          className="search-mode-input"
          data-testid="search-mode-input"
          placeholder="Search media…"
          aria-label="Search media"
          value={searchText}
          onChange={(e) => handleInput(e.target.value)}
          // Tab / Shift+Tab in the box cycle where ▶ plays (an add-to-one-screen
          // search has no destination to change).
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && idleActive) { if (moveInRecents(1)) e.preventDefault(); return; }
            if (e.key !== 'Tab' || addTo || e.altKey || e.ctrlKey || e.metaKey) return;
            if (cycleDestination(e.shiftKey ? -1 : 1, 'tab')) e.preventDefault();
          }}
        />
        {!addTo && <DestinationChip compact />}
      </div>

      {addTo && (
        <div className="search-mode-add-to" data-testid="search-add-to-banner" role="status">
          Adding to the queue on <strong>{addTo.name ?? 'this screen'}</strong> — just this once; your aim doesn&apos;t change.
        </div>
      )}

      <div className="search-mode-scope">
        <ScopeChips />
      </div>

      <StreamStatusLine
        state={searchState ?? {
          query: searchText,
          scope: currentScopeKey ?? '',
          sources: Object.fromEntries([
            ...pendingSources.map((source) => [source, 'pending']),
            ...sourceErrors.map(({ source }) => [source, 'failed']),
          ]),
          results,
          phase: isSearching ? (results.length ? 'partial' : 'loading') : sourceErrors.length ? 'partial' : 'complete',
          failedSources: sourceErrors.map(({ source }) => source),
        }}
        widening={showWideningNotice
          ? { active: true, from: scopeThatCameUpEmpty, resultCount: results.length, testId: 'search-mode-widening-notice' }
          : null}
        onRetry={handleStreamRetry}
      />

      <div className="media-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="search-mode-empty-announcement">
        {showEmpty || showScopeEmpty ? emptyMessage : ''}
      </div>

      {streamError && (
        <LoadErrorLine kind="search" error={streamError} testId="search-mode-stream-error" retryTestId="search-mode-stream-retry" onRetry={() => retrySource()} />
      )}

      <ul className="search-mode-results media-search-results" data-testid="search-mode-results">
        {showHint && (
          <li className="search-mode-hint" data-testid="search-mode-hint">Type to search…</li>
        )}
        {idleActive && (
          <li
            className="search-mode-recents"
            data-testid="search-mode-recents"
            ref={recentsRef}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              const row = e.target.closest?.('[data-recents-row]');
              if (!row) return;
              e.preventDefault();
              moveInRecents(e.key === 'ArrowDown' ? 1 : -1, row);
            }}
          >
            {recents.continueItems.length > 0 && (
              <>
                <div className="search-mode-recents-head">Continue</div>
                <ul className="search-mode-recents-list">
                  {recents.continueItems.map((item) => (
                    <li key={item.id} className="result-row" data-recents-row tabIndex={-1}
                      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); log.info('search.recent-picked', { kind: 'continue', contentId: item.id, via: 'keyboard' }); handleChange(item.id, item); } }}>
                      <SearchResultRow
                        item={item}
                        title={displayTitle(item)}
                        subtitle={rowLabelsFor(item)?.subtitle ?? resultSubtitle(item)}
                        thumbnail={item.thumbnail}
                        onTap={() => { log.info('search.recent-picked', { kind: 'continue', contentId: item.id, via: 'tap' }); handleChange(item.id, item); }}
                        onPlayAll={() => handlePlayAll(item)}
                        rowLabels={rowLabelsFor(item)}
                        onAction={handleMore}
                        extraActions={extraActions}
                        testId={`search-mode-continue-${item.id}`}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {recents.searches.length > 0 && (
              <>
                <div className="search-mode-recents-head">
                  <span>Recent searches</span>
                  <UnstyledButton className="search-mode-recents-clear" data-testid="search-mode-recent-clear" onClick={() => recents.clear()}>
                    Clear
                  </UnstyledButton>
                </div>
                <ul className="search-mode-recents-list">
                  {recents.searches.map((entry, j) => (
                    <li key={entry.key} className="search-mode-recent">
                      <UnstyledButton
                        className="search-mode-recent-pick"
                        data-recents-row
                        data-testid={`search-mode-recent-${j}`}
                        onClick={(e) => pickRecentSearch(entry, e.detail === 0 ? 'keyboard' : 'tap')}
                      >
                        <UiIcon name="search" size={16} />
                        <span className="search-mode-recent-text">{entry.text}</span>
                        {entry.tag && <span className="search-mode-recent-tag">· {entry.tag}</span>}
                      </UnstyledButton>
                      <ActionIcon
                        variant="subtle"
                        size="lg"
                        aria-label={`Forget ${entry.text}`}
                        data-testid={`search-mode-recent-forget-${j}`}
                        onClick={() => recents.forget(entry.text)}
                      >
                        <UiIcon name="close" size={16} />
                      </ActionIcon>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        )}
        {(isSearching || awaitingResults) && results.length === 0 && (
          <li className="search-mode-skeleton" data-testid="search-mode-loading">
            <SearchSkeletonRows testId="search-mode-skeleton" />
          </li>
        )}
        {showEmpty && (
          <li className="search-mode-hint" data-testid="search-mode-empty">
            {emptyMessage}
          </li>
        )}
        {showScopeEmpty && (
          <li className="search-mode-scope-empty" data-testid="search-mode-scope-empty">
            <span className="search-mode-hint">{emptyMessage}</span>
            <Button
              variant="default"
              size="md"
              className="search-mode-widen"
              data-testid="search-mode-widen"
              onClick={() => widenSearch('tap')}
            >
              Search everything
            </Button>
          </li>
        )}
        {/* Smart long lists: the first eight, then Show all N (stays open
            until search closes). */}
        <TopMoreList
          items={results}
          n={SEARCH_RESULTS_SHOWN}
          // Results stream in and re-rank: the first eight are the first eight.
          stable={false}
          moreAs="li"
          testId="search-mode-results"
          moreClassName="search-mode-show-all"
          moreLabel={() => `Show all ${results.length}`}
          onExpand={(counts) => mediaLog.listMoreExpanded({ surface: 'search-mode', ...counts })}
          renderItem={(item) => (
          <li key={item.id} className="result-row">
            <SearchResultRow
              item={item}
              title={displayTitle(item)}
              subtitle={rowLabelsFor(item)?.subtitle ?? resultSubtitle(item)}
              thumbnail={item.thumbnail}
              // The shared combobox select() helper commits and closes its
              // editing machine after onChange. SearchMode is a retained work
              // surface, so Play invokes its dispatch boundary directly and
              // leaves the hook's query/results intact.
              onTap={() => handleChange(item.id, item)}
              onPlayAll={() => handlePlayAll(item)}
              rowLabels={rowLabelsFor(item)}
              onAction={handleMore}
              extraActions={extraActions}
              testId={`search-mode-result-${item.id}`}
            />
          </li>
          )}
        />
      </ul>
      <ItemDestinationPicker
        action={oneShotAction}
        onClose={() => setOneShotAction(null)}
        returnFocusRef={oneShotAction?.returnFocusRef}
      />
    </div>
  );
}

export default SearchMode;
