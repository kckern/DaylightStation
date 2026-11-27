// Unwatched counts for show and season tiles and rows (owner-approved
// 2026-11-27, jellyfin study rec 11): how many episodes under a show or a
// season the household has not finished. Ids asked for in the same moment are
// fetched together (`GET /api/v1/content/query/unwatched?ids=…`, at most 40
// per request) and kept for a minute; every reader of an id hears the answer.
import { useEffect, useState } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import mediaLog from "../logging/mediaLog.js";

const COUNTED_TYPES = new Set(['show', 'season', 'series']);
const FRESH_MS = 60_000;
const BATCH = 40;

const cache = new Map(); // id -> { at, value }
const waiting = new Set();
const listeners = new Map(); // id -> Set<fn>
let timer = null;

/** Whether a tile or row of this item gets a count. */
export function countsUnwatched(item) {
  const type = String(item?.type ?? item?.metadata?.type ?? '').toLowerCase();
  return COUNTED_TYPES.has(type) && /^plex:\d+$/.test(String(item?.id ?? ''));
}

function publish(id, value) {
  for (const fn of listeners.get(id) ?? []) fn(value);
}

async function flush() {
  timer = null;
  const ids = [...waiting];
  waiting.clear();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      const res = await DaylightAPI(`api/v1/content/query/unwatched?ids=${chunk.map(encodeURIComponent).join(',')}`);
      const counts = res?.counts ?? {};
      for (const id of chunk) {
        const value = counts[id] ?? null;
        cache.set(id, { at: Date.now(), value });
        publish(id, value);
      }
    } catch (error) {
      mediaLog.unwatchedCountsFailed({ ids: chunk.length, error: error?.message ?? String(error) });
    }
  }
}

/** Ask for one id's count; `fn(value)` hears `{ unwatched, total }` or null. */
export function watchUnwatched(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) fn(hit.value);
  else {
    waiting.add(id);
    if (!timer) timer = setTimeout(flush, 30);
  }
  return () => listeners.get(id)?.delete(fn);
}

/** `{ unwatched, total }` for a show or season item, else null. */
export function useUnwatchedCount(item) {
  const id = countsUnwatched(item) ? item.id : null;
  const [value, setValue] = useState(() => (id ? cache.get(id)?.value ?? null : null));
  useEffect(() => (id ? watchUnwatched(id, setValue) : undefined), [id]);
  return id ? value : null;
}

/** "3 unwatched" / "All watched", or null. */
export function unwatchedLine(count) {
  if (!count || !Number.isFinite(count.total) || count.total <= 0) return null;
  return count.unwatched > 0 ? `${count.unwatched} unwatched` : 'All watched';
}

/** Tests only. */
export function resetUnwatchedCounts() { cache.clear(); waiting.clear(); listeners.clear(); if (timer) clearTimeout(timer); timer = null; }
