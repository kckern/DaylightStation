/**
 * Artwork remediation queue — pure policy (design 2026-09-23 §5).
 *
 * The household rule: a food whose icon or photo cannot be shown is never
 * abandoned. It becomes a queue item that is worked until it is fixed, with a
 * growing wait between attempts and NO attempt cap. This module owns the item
 * shape, the dedupe key and the backoff; persistence and the actual repair
 * live in the adapter and application layers.
 *
 * Item:
 *   { key, kind, foodId, rowIds[], earliestDate, name, icon, photoRef, attempts,
 *     nextAttemptAt, lastError, createdAt, updatedAt, resolvedAt, resolution }
 * `earliestDate` is the oldest day any of its rows is logged on, so a worker can
 * read the ledger once from that day instead of searching all history per row.
 */

import { normalizeIconFoodName } from './icons.mjs';

export const ARTWORK_KINDS = Object.freeze(['icon-missing', 'icon-failed', 'photo-failed']);
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_CEILING_MS = 24 * 60 * 60 * 1000;

export const isArtworkKind = kind => ARTWORK_KINDS.includes(kind);

/**
 * The dedupe key. One item per FOOD for icon kinds (its foodId, else its
 * normalized name) and one per PHOTO for photo failures. A bare slug failure
 * reported by the browser, with no row behind it, is keyed by the slug.
 * @returns {string|null} null when there is nothing to key on
 */
export function artworkQueueKey({ kind, foodId = null, name = null, photoRef = null, icon = null }) {
  if (kind === 'photo-failed') return photoRef ? `photo:${photoRef}` : null;
  if (foodId) return `food:${foodId}`;
  const normalized = normalizeIconFoodName(name);
  if (normalized) return `name:${normalized}`;
  return icon ? `icon:${icon}` : null;
}

/** Wait after the Nth failed attempt: 1 min, 2, 4 … capped at 24 h. Never "give up". */
export function backoffMs(attempts) {
  const n = Math.max(1, Math.floor(Number(attempts) || 1));
  return Math.min(BACKOFF_CEILING_MS, BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 30));
}

export const isOpen = item => !!item && !item.resolvedAt;
export const isDue = (item, nowMs) => isOpen(item) && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= nowMs);

const earliest = (...dates) => dates.flat().filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0] ?? null;
const uniq = list => [...new Set((list || []).filter(id => typeof id === 'string' && id))];

/**
 * Merge a new report into the queue's current item for the same key.
 * A new report on a resolved item REOPENS it (the fix did not hold), due now.
 * A report on an open item adds its rows and leaves the backoff alone, so a
 * browser re-reporting every session cannot starve the wait.
 * @returns {{ item: Object, created: boolean, reopened: boolean }}
 */
export function mergeArtworkReport(existing, report, nowIso) {
  const incoming = {
    kind: report.kind, foodId: report.foodId ?? null, name: report.name ?? null,
    icon: report.icon ?? null, photoRef: report.photoRef ?? null, rowIds: uniq(report.rowIds),
    earliestDate: earliest(report.dates || []),
  };
  if (!existing) {
    return { created: true, reopened: false, item: { key: report.key, ...incoming, attempts: 0, nextAttemptAt: nowIso,
      lastError: report.error ?? null, createdAt: nowIso, updatedAt: nowIso, resolvedAt: null, resolution: null } };
  }
  const reopened = !isOpen(existing);
  const item = { ...existing,
    foodId: existing.foodId ?? incoming.foodId, name: existing.name ?? incoming.name,
    icon: incoming.icon ?? existing.icon ?? null, photoRef: existing.photoRef ?? incoming.photoRef,
    rowIds: uniq([...(existing.rowIds || []), ...incoming.rowIds]),
    earliestDate: earliest(existing.earliestDate, incoming.earliestDate ?? []), updatedAt: nowIso };
  if (reopened) Object.assign(item, { kind: incoming.kind, resolvedAt: null, resolution: null, nextAttemptAt: nowIso,
    lastError: report.error ?? null });
  return { item, created: false, reopened };
}

/** A failed attempt: counted, with its error, and scheduled again. Never dropped. */
export function recordArtworkFailure(item, error, nowMs) {
  const attempts = (item.attempts || 0) + 1;
  return { ...item, attempts, lastError: String(error || 'unknown error').slice(0, 500),
    nextAttemptAt: new Date(nowMs + backoffMs(attempts)).toISOString(), updatedAt: new Date(nowMs).toISOString() };
}

/** A fixed item. `resolution` says how: `{ via, icon?, photoRef?, rows }`. */
export function resolveArtworkItem(item, resolution, nowMs) {
  const at = new Date(nowMs).toISOString();
  return { ...item, attempts: (item.attempts || 0) + 1, resolvedAt: at, updatedAt: at, lastError: null,
    nextAttemptAt: null, resolution };
}

/** Open items first (soonest due), then the most recently resolved. */
export function queueView(items, { resolvedLimit = 10 } = {}) {
  const all = Object.values(items || {});
  const open = all.filter(isOpen).sort((a, b) => String(a.nextAttemptAt).localeCompare(String(b.nextAttemptAt)));
  const recentlyResolved = all.filter(item => !isOpen(item))
    .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, resolvedLimit);
  return { open, recentlyResolved };
}
