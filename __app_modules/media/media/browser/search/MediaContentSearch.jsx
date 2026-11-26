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
// applyResultRowVerb plumbing SearchMode uses.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ContentCombobox } from "../../../../../__capabilities/content-catalog/browser/picker.mjs";
import { useSearchContext } from "./useSearchContext.js";
import { ScopeChips } from "./ScopeChips.jsx";
import { useContentDispatch } from "./useContentDispatch.js";
import { useDestinationInteraction } from "../cast/destinationInteraction.js";
import { useSessionController } from "../controller/useSessionController.js";
import { useNav } from "../shell/NavProvider.jsx";
import { collapseResultEditions } from "./collapseResultEditions.js";
import { applyResultRowVerb } from "./resultRowVerbs.js";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { useRowLabels } from "./useRowLabels.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import mediaLog from "../logging/mediaLog.js";
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { useHouseholdResultActions } from "../household/useHouseholdResultActions.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { rankByHabits } from "../habits/mediaHabits.js";
import "./Search.scss";

export function MediaContentSearch({ inputRef }) {
  const [oneShotAction, setOneShotAction] = useState(null);
  const { scopes, currentScopeKey, currentScope, resetScope } = useSearchContext();
  const { dispatch, dispatchLeafVerb, playContainerAsQueue } = useContentDispatch();
  const { rowLabelsFor, continueFor } = useRowLabels();
  const { extraActions, runHousehold } = useHouseholdResultActions();
  const { queue } = useSessionController('local');
  const { push } = useNav();
  const { scoresFor, rememberedFor, recordPick } = usePlayDestination();
  const lastRankedRef = useRef(null);
  const log = useMemo(() => getLogger().child({ component: 'media-content-search' }), []);
  // The words the list on screen was ranked for: a pick is remembered
  // against them (a row opened or played is what those words meant).
  const queryRef = useRef('');
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
  // The header's destination control is in use: keep this search open (FIND.1b).
  const { active: destinationInteractionActive } = useDestinationInteraction();

  // Transient: ContentCombobox reverts to value="" on close, so a selection is
  // a one-shot dispatch, never a committed/persisted value.
  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    recordPick(queryRef.current, { ...item, id }, 'open');
    // `route` is 'peek' | 'cast' | 'browse' | 'local' — without it, a selection that went
    // to the wrong surface is invisible in the logs. It records the routing
    // INTENT, not the outcome: the cast dispatch is async and unawaited, so a
    // dispatch that later fails (or is swallowed by the dedupe window) still
    // logs route:'cast'. Outcome lives in dispatch.succeeded/failed/deduplicated.
    const route = dispatch(id, item);
    log.info('dispatch', { contentId: id, route });
    return route;
  }, [dispatch, log, recordPick]);

  // Trailing ▶ on a container row: send the whole thing to the current
  // destination. Its outcome is reported by useContentDispatch through the
  // one outcome system, the same as every other entry point.
  const handlePlayAll = useCallback((item) => {
    const id = item?.id;
    if (!id) return;
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb: 'playAll' });
    recordPick(queryRef.current, item, 'play');
    // A playable row's own ▶: play it where the ▶ says.
    if (!isContainer(item)) {
      const route = dispatchLeafVerb('playNow', id, item);
      log.info('dispatch', { contentId: id, route, verb: 'play' });
      return;
    }
    // FIND.8b/AC2: with a part under way the inline play IS "Continue S2E7".
    const cont = continueFor(item);
    if (cont) {
      mediaLog.collectionContinued({ collectionId: id, contentId: cont.contentId, label: cont.label });
      const route = dispatchLeafVerb('playNow', cont.contentId, { id: cont.contentId, title: cont.title, type: 'episode', itemType: 'leaf' });
      log.info('dispatch', { contentId: cont.contentId, route, verb: 'continue' });
      return;
    }
    const route = playContainerAsQueue(id, item);
    log.info('dispatch', { contentId: id, route, verb: 'playAll' });
  }, [playContainerAsQueue, dispatchLeafVerb, continueFor, log, recordPick]);

  // Trailing ⋯ on a leaf row: Play Now / Play Next / Up Next / Add to Queue
  // / Open detail.
  const handleMore = useCallback((action, item) => {
    const id = item?.id;
    if (!id) return;
    log.info('row_action', { contentId: id, action });
    if (['playNow', 'playHere', 'playOn', 'detail', 'details'].includes(action)) recordPick(queryRef.current, item, action);
    if (runHousehold(action, item)) return;
    if (action === 'playHere') { dispatchLeafVerb('playNow', id, item, { targetIds: [] }); return; }
    if (action === 'playOn' || action === 'addOn') { setOneShotAction({ kind: action, item }); return; }
    if (action !== 'detail' && action !== 'details') {
      dispatchLeafVerb(action === 'upNext' ? 'playFirst' : action, id, item);
      return;
    }
    applyResultRowVerb('detail', item, { queue, push });
  }, [queue, push, log, dispatchLeafVerb, runHousehold, recordPick]);

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <ItemDestinationPicker action={oneShotAction} onClose={() => setOneShotAction(null)} />
      <div className="media-search-controls">
        <ScopeChips />
        <div className="media-search-input-wrap">
          <ContentCombobox
            inputRef={inputRef}
            value=""
            onChange={handleChange}
            onPlayAll={handlePlayAll}
            onMore={handleMore}
            onAction={({ kind, item }) => handleMore(kind, item)}
            transformResults={transformResults}
            resultExtraActions={extraActions}
            resultRowLabels={rowLabelsFor}
            placeholder="Search media…"
            selectContainers
            quietErrors
            searchParams={currentScope?.params ?? ''}
            // D5: scopes[0] is the catalog-wide ("All") scope by convention
            // (SearchProvider seeds currentScopeKey from it and resetScope()
            // returns to it) — that's what a scoped search settling empty
            // silently widens to. scopeKey/scopeLabel are for observability
            // and for naming the scope in the widened-search notice.
            fallbackSearchParams={scopes[0]?.params ?? ''}
            scopeKey={currentScopeKey}
            scopeLabel={currentScope?.label ?? null}
            logApp="media"
            dropdownClassName="media-search-dropdown"
            appResults
            allowFreeform={false}
            retainQueryOnEscape
            // No retainPlayableSelection: picking a playable row OPENS it (its
            // detail page), so the list closes like any navigation does.
            onClose={resetScope}
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
