// What the empty search box offers (owner ruling 2026-11-27): "Continue",
// the in-progress items Home's carry-on row reads (same endpoint, same
// stale-while-revalidate cache, so it shows at once), and "Recent searches"
// (recentSearches.js). Both surfaces (the dock combobox and the phone sheet)
// use this one hook.
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { HOUSEHOLD_PATHS } from "../household/householdApi.js";
import { householdResourceLogger } from "../household/useHousehold.js";
import {
  recentSearches, rememberSearch, forgetSearch, clearSearches, subscribeRecentSearches, RECENT_SEARCHES_SHOWN,
} from "./recentSearches.js";

export const CONTINUE_SHOWN = 4;

/**
 * The carry-on entries as result rows: unfinished only, most recently played
 * first, at most `limit`. Pure, for tests.
 */
export function continueRows(entries, limit = CONTINUE_SHOWN) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e?.contentId && e.finished !== true)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => String(b.e.lastPlayed ?? '').localeCompare(String(a.e.lastPlayed ?? '')) || a.i - b.i)
    .slice(0, limit)
    .map(({ e }) => ({
      id: e.contentId,
      title: e.title ?? 'Untitled',
      thumbnail: e.thumbnail ?? null,
      type: e.type ?? null,
      itemType: e.kind === 'collection' ? 'container' : 'leaf',
      parentTitle: e.grandparentTitle ?? e.parentTitle ?? e.byline ?? null,
      percent: e.percent ?? null,
    }));
}

/** Recent searches as rows: words plus a scope tag ("nephi · Scripture"). */
export function searchRows(list, allScopeKey = null, limit = RECENT_SEARCHES_SHOWN) {
  return (Array.isArray(list) ? list : []).slice(0, limit).map((entry) => ({
    key: entry.text.toLowerCase(),
    text: entry.text,
    scopeKey: entry.scopeKey,
    tag: entry.scopeKey && entry.scopeKey !== allScopeKey ? (entry.scopeLabel ?? null) : null,
  }));
}

export function useSearchRecents({ enabled = true, allScopeKey = null } = {}) {
  const carryOn = useApiResource(enabled ? HOUSEHOLD_PATHS.carryOn : null, {
    swr: true, label: 'media-search-continue', logger: householdResourceLogger, enabled,
  });
  const list = useSyncExternalStore(subscribeRecentSearches, recentSearches, recentSearches);
  const continueItems = useMemo(() => continueRows(carryOn.data?.items), [carryOn.data]);
  const searches = useMemo(() => searchRows(list, allScopeKey), [list, allScopeKey]);
  const remember = useCallback((text, scope) => {
    if (!text || !String(text).trim()) return;
    rememberSearch({ text, scopeKey: scope?.key ?? null, scopeLabel: scope?.label ?? null });
  }, []);
  return { continueItems, searches, remember, forget: forgetSearch, clear: clearSearches };
}
