// frontend/src/modules/Media/search/MediaContentSearch.jsx
// The dock's content picker: the shared ContentCombobox wired as a TRANSIENT
// selector. It never persists a value (always value=""); selecting an item
// hands the id to useContentDispatch, which routes it to the full browse view,
// local playback, or a cast target based on the active view.
//
// Containers SELECT (selectContainers), they do not drill in the popover:
// picking "Tuttle Twins" opens the show on the canvas, where BrowseView has
// breadcrumbs, back, per-row Play Now, and survives a blur. In-popover
// drilling looked equivalent but threw the whole traversal away on close —
// on 2026-08-12 a user drilled show→season twice in 20s and still had to
// leave for Plex Web to find an episode id.
//
// Scope chips (ScopeChips.jsx, from SearchProvider's context) narrow the
// search sources via ContentCombobox's searchParams passthrough.
//
// Task 14 (spec D6): the same ONE tap grammar as SearchMode's mobile list.
// Row tap already routes through useContentDispatch's dispatch() (leaf ->
// play now, container -> ALWAYS browse — no change needed here for that
// part, it's the hook's job). What's new is the trailing verbs: ContentCombobox
// takes optional onPlayAll/onMore props (additive — every other caller of
// that shared, widely-used component leaves them unset and gets zero
// behavior change) that light up ResultRowActions on the container ▶ and
// leaf ⋯ respectively, wired to the exact same playContainerAsQueue /
// dispatch plumbing SearchMode uses (Details opens the info view from search).
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ContentCombobox } from "../../../../../__capabilities/content-catalog/browser/picker.mjs";
import { useSearchContext } from "./useSearchContext.js";
import { ScopeChips } from "./ScopeChips.jsx";
import { useContentDispatch } from "./useContentDispatch.js";
import { useDestinationInteraction } from "../cast/destinationInteraction.js";
import { useNav } from "../shell/NavProvider.jsx";
import { collapseResultEditions } from "./collapseResultEditions.js";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { useRowLabels } from "./useRowLabels.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { SEARCH_RESULTS_SHOWN } from "./searchLimits.js";
import mediaLog from "../logging/mediaLog.js";
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { useHouseholdResultActions } from "../household/useHouseholdResultActions.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { rankByHabits } from "../habits/mediaHabits.js";
import { DestinationChip, useDestinationCycle } from "./DestinationChip.jsx";
import { useReturnFromSearchDetail } from "./useReturnFromSearchDetail.js";
import { useSearchRecents } from "./useSearchRecents.js";
import "./Search.scss";

// `destinationWrapper`: a component the chip is wrapped in — the desktop dock
// passes FirstUseCard so the first-use naming prompt points at the chip.
export function MediaContentSearch({ inputRef: suppliedInputRef, destinationWrapper: DestinationWrapper = null, destinationControlRef = null }) {
  const ownInputRef = useRef(null);
  const inputRef = suppliedInputRef ?? ownInputRef;
  // How the last pick was made, for the log: Enter in the box, else a tap.
  const viaRef = useRef('tap');
  const [oneShotAction, setOneShotAction] = useState(null);
  const { scopes, currentScopeKey, currentScope, setScopeKey, resetScope } = useSearchContext();
  const { dispatch, dispatchLeafVerb, playContainerAsQueue } = useContentDispatch();
  const { rowLabelsFor, continueFor, screenFor } = useRowLabels();
  const { extraActions, runHousehold } = useHouseholdResultActions();
  const { push } = useNav();
  const { scoresFor, rememberedFor, recordPick } = usePlayDestination();
  const lastRankedRef = useRef(null);
  const log = useMemo(() => getLogger().child({ component: 'media-content-search' }), []);
  // The words the list on screen was ranked for: a pick is remembered
  // against them (a row opened or played is what those words meant).
  const queryRef = useRef('');
  // The empty box offers Continue and recent searches (owner ruling
  // 2026-11-27). Words are remembered, with their scope, only once the person
  // acts on their results (opens or plays a row), never per keystroke.
  const recents = useSearchRecents({ allScopeKey: scopes[0]?.key ?? null });
  const currentScopeRef = useRef(currentScope);
  currentScopeRef.current = currentScope;
  const rememberWords = useCallback(() => {
    const words = queryRef.current;
    if (words && words.trim().length >= 2) recents.remember(words.trim(), currentScopeRef.current);
  }, [recents]);
  const idle = useMemo(() => ({
    items: recents.continueItems,
    itemsTitle: 'Continue',
    searches: recents.searches,
    onPickItem: (item, via) => log.info('search.recent-picked', { kind: 'continue', contentId: item?.id ?? null, via }),
    onPickSearch: (entry, via) => {
      log.info('search.recent-picked', { kind: 'search', scopeKey: entry.scopeKey ?? null, via });
      const known = scopes.some((sc) => sc.key === entry.scopeKey || (sc.children || []).some((c) => c.key === entry.scopeKey));
      if (entry.scopeKey && known) setScopeKey?.(entry.scopeKey);
      else resetScope?.();
    },
    onForgetSearch: (entry) => recents.forget(entry.text),
    onClearSearches: () => recents.clear(),
    onShown: (counts) => log.info('search.recents-shown', counts),
  }), [recents, scopes, setScopeKey, resetScope, log]);
  // A remembered pick holds row 1 from the first keystroke (drawn from what
  // was kept of it) in the catalog-wide scope only — a narrowed scope shows
  // only what the search returns for it.
  const wholeCatalog = currentScopeKey == null || currentScopeKey === scopes[0]?.key;
  const transformResults = useCallback((results, { query = '', searching = false } = {}) => {
    queryRef.current = query;
    const collapsed = collapseResultEditions(results);
    const scores = scoresFor(query);
    const ranked = // A placeholder only while sources are still answering: a search that
    // settles without the item (gone from the library) shows what it found.
    rankByHabits(collapsed, scores, wholeCatalog && searching ? rememberedFor(query) : null);
    if (ranked !== collapsed && lastRankedRef.current !== query) {
      lastRankedRef.current = query;
      mediaLog.habitResultsRanked({ textLength: query.trim().length, boosted: scores.size });
    }
    return ranked;
  }, [scoresFor, rememberedFor, wholeCatalog]);
  // The destination lives in the box: Tab / Shift+Tab (input focused only)
  // and a click on the chip step through where ▶ plays. Outside an aim
  // provider nothing is handled and Tab closes the search as before.
  const { cycle: cycleDestination } = useDestinationCycle();
  const handleTabKey = useCallback((dir) => cycleDestination(dir, 'tab'), [cycleDestination]);
  const destinationChip = DestinationWrapper
    ? <DestinationWrapper><DestinationChip controlRef={destinationControlRef} /></DestinationWrapper>
    : <DestinationChip controlRef={destinationControlRef} />;
  // The header's destination control is in use: keep this search open (FIND.1b).
  const { active: destinationInteractionActive } = useDestinationInteraction();

  // Transient: ContentCombobox reverts to value="" on close, so a selection is
  // a one-shot dispatch, never a committed/persisted value.
  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    recordPick(queryRef.current, { ...item, id }, 'open');
    rememberWords();
    // `route` is 'peek' | 'cast' | 'browse' | 'local' — without it, a selection that went
    // to the wrong surface is invisible in the logs. It records the routing
    // INTENT, not the outcome: the cast dispatch is async and unawaited, so a
    // dispatch that later fails (or is swallowed by the dedupe window) still
    // logs route:'cast'. Outcome lives in dispatch.succeeded/failed/deduplicated.
    // From search: the info view opens with its PLAY focused (a second Enter
    // plays, by that button's own activation), and Back comes back here.
    const route = dispatch(id, item, { from: 'search', via: viaRef.current });
    viaRef.current = 'tap';
    log.info('dispatch', { contentId: id, route });
    return route;
  }, [dispatch, log, recordPick, rememberWords]);

  // Back from an info view this search opened: the box takes focus again,
  // which reopens the kept list on the row that was picked. Only while the
  // box is on screen (on a phone the full-screen search reopens instead —
  // MediaAppShell).
  useReturnFromSearchDetail(useCallback(({ contentId }) => {
    const el = inputRef.current;
    if (!el?.isConnected || !el.getClientRects().length) return;
    el.focus({ preventScroll: true });
    mediaLog.searchReturned({ contentId, surface: 'dock' });
  }, [inputRef]));

  // Trailing ▶ on a container row: send the whole thing to the current
  // destination. Its outcome is reported by useContentDispatch through the
  // one outcome system, the same as every other entry point.
  const handlePlayAll = useCallback((item) => {
    const id = item?.id;
    if (!id) return;
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb: 'playAll' });
    recordPick(queryRef.current, item, 'play');
    rememberWords();
    // A playable row's own ▶: play it where the ▶ says.
    // A film nobody has chosen a screen for asks where (its ▶ read "Play on…").
    const ask = (route, what = item) => { if (route === 'ask') setOneShotAction({ kind: 'playOn', item: what }); };
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
  }, [playContainerAsQueue, dispatchLeafVerb, continueFor, log, recordPick, rememberWords]);

  // Trailing ⋯ on a leaf row: Play Now / Play Next / Up Next / Add to Queue
  // / Open detail.
  const handleMore = useCallback((action, item) => {
    const id = item?.id;
    if (!id) return;
    log.info('row_action', { contentId: id, action });
    if (['playNow', 'playHere', 'playOn', 'detail', 'details'].includes(action)) { recordPick(queryRef.current, item, action); rememberWords(); }
    if (runHousehold(action, item)) return;
    if (action === 'openScreen') {
      const deviceId = screenFor(item);
      if (!deviceId) return;
      push('peek', { deviceId });
      return 'close';
    }
    if (action === 'playHere') { dispatchLeafVerb('playNow', id, item, { targetIds: [] }); return; }
    if (action === 'playOn' || action === 'addOn') { setOneShotAction({ kind: action, item }); return; }
    if (action !== 'detail' && action !== 'details') {
      const route = dispatchLeafVerb(action === 'upNext' ? 'playFirst' : action, id, item);
      if (route === 'ask') setOneShotAction({ kind: 'playOn', item });
      return;
    }
    // Details is a look, like selecting the row: the list closes (the words
    // stay) and the info view opens; Back comes back to these results.
    push('detail', { contentId: id, from: 'search' });
    return 'close';
  }, [push, log, dispatchLeafVerb, runHousehold, recordPick, screenFor, rememberWords]);

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <ItemDestinationPicker action={oneShotAction} onClose={() => setOneShotAction(null)} />
      <div className="media-search-controls">
        <ScopeChips />
        <div
          className="media-search-input-wrap"
          onKeyDownCapture={(e) => { viaRef.current = e.key === 'Enter' ? 'enter' : 'tap'; }}
          onPointerDownCapture={() => { viaRef.current = 'tap'; }}
        >
          <ContentCombobox
            inputRef={inputRef}
            value=""
            onChange={handleChange}
            onPlayAll={handlePlayAll}
            onMore={handleMore}
            onAction={({ kind, item }) => handleMore(kind, item)}
            inputAccessory={destinationChip}
            onTabKey={handleTabKey}
            transformResults={transformResults}
            // Smart long lists: the first eight (habit-ranked), then Show all N.
            collapseAt={SEARCH_RESULTS_SHOWN}
            onShowAll={(counts) => mediaLog.listMoreExpanded({ surface: 'search', ...counts })}
            resultExtraActions={extraActions}
            resultRowLabels={rowLabelsFor}
            placeholder="Search media…"
            selectContainers
            quietErrors
            searchParams={currentScope?.params ?? ''}
            // D5: scopes[0] is the catalog-wide ("All") scope by convention
            // (SearchProvider seeds currentScopeKey from it and resetScope()
            // returns to it). A scope chip is the person's choice, so an empty
            // scoped search is offered the wider search ("Search everything")
            // rather than widened for them (2026-11-27). scopeKey/scopeLabel
            // are for observability and for naming the scope.
            fallbackSearchParams={scopes[0]?.params ?? ''}
            widenOnEmpty="offer"
            idle={idle}
            scopeKey={currentScopeKey}
            scopeLabel={currentScope?.label ?? null}
            logApp="media"
            dropdownClassName="media-search-dropdown"
            appResults
            allowFreeform={false}
            retainQueryOnEscape
            // The box keeps its words and results when the list closes for any
            // reason (clicking away, opening a result): going back to the same
            // search is the common case. ✕ clears it.
            retainQueryOnClose
            // No retainPlayableSelection: picking a playable row OPENS it (its
            // detail page), so the list closes like any navigation does.
            // No scope reset on close: the kept query keeps its scope too, so the
            // results shown on reopen are the ones it found.
            // A one-shot Play on… / Add on… picker is a destination choice made FOR this search: its
            // modal takes focus, which must not read as leaving the search (FIND.1a/AC5).
            destinationInteractionActive={destinationInteractionActive || oneShotAction !== null}
          />
        </div>
      </div>
    </div>
  );
}

export default MediaContentSearch;
