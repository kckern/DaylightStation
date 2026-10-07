// frontend/src/modules/Media/household/collectionContinue.js
// FIND.8b/AC2 (RQ-FIND-09): a collection result carries an inline Play, or
// "Continue S2E7" when the household has one under way. The facts come from
// carry on (an unfinished episode, or the episode after a finished one);
// nothing here is invented — no entry, no Continue.
import { useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { HOUSEHOLD_PATHS } from './householdApi.js';
import { householdResourceLogger } from './useHousehold.js';

function sourceOf(contentId) {
  const colon = typeof contentId === 'string' ? contentId.indexOf(':') : -1;
  return colon > 0 ? contentId.slice(0, colon) : null;
}

function seasonNumber(entry) {
  if (Number.isInteger(entry?.parentIndex)) return entry.parentIndex;
  const match = /(\d+)\s*$/.exec(entry?.parentTitle ?? '');
  return match ? Number(match[1]) : null;
}

/** "Continue S2E7" for an episode, "Continue" when the part has no numbers. */
export function continueLabel(entry) {
  const season = seasonNumber(entry);
  const episode = Number.isInteger(entry?.itemIndex) ? entry.itemIndex : null;
  if (entry?.type === 'episode' && season != null && episode != null) return `Continue S${season}E${episode}`;
  return 'Continue';
}

/**
 * Map collection id (the show, and its season) → what to continue with.
 * The newest carry-on entry wins (the list is newest first).
 * @returns {Map<string, { contentId: string, title: string|null, label: string }>}
 */
export function buildContinueIndex(carryOnItems = []) {
  const index = new Map();
  for (const entry of Array.isArray(carryOnItems) ? carryOnItems : []) {
    const source = sourceOf(entry?.contentId);
    if (!source || entry.type !== 'episode') continue;
    const value = { contentId: entry.contentId, title: entry.title ?? null, label: continueLabel(entry) };
    for (const parent of [entry.grandparentId, entry.parentId]) {
      if (parent == null) continue;
      const key = `${source}:${parent}`;
      if (!index.has(key)) index.set(key, value);
    }
  }
  return index;
}

/** The household's carry-on, as a lookup for collection rows. */
export function useCollectionContinue() {
  const carryOn = useApiResource(HOUSEHOLD_PATHS.carryOn, { swr: true, label: 'media-carry-on', logger: householdResourceLogger });
  const index = useMemo(() => buildContinueIndex(carryOn.data?.items), [carryOn.data]);
  return useMemo(() => ({
    continueFor: (item) => (item?.id ? index.get(item.id) ?? null : null),
  }), [index]);
}
