// Eager, without outside effects (browse navigation, 2026-11-27): a container
// row or link the pointer rests on, or the keyboard focuses, has its first
// page and its info read ahead into the shared resource cache, so opening it
// paints at once. GET only; nothing is played, woken or recorded.
import { readApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import mediaLog from "../logging/mediaLog.js";
import { browseListUrl } from "./browsePath.js";
import { pathFor } from "./browseHeaderModel.js";

const AGAIN_AFTER_MS = 30_000;
const recent = new Map();

export function infoUrl(contentId) {
  const at = String(contentId).indexOf(':');
  return `api/v1/info/${contentId.slice(0, at)}/${contentId.slice(at + 1)}`;
}

/**
 * Warm one container's page. Returns false when there is nothing to warm (a
 * source root, a leaf id shape it cannot list, or warmed in the last 30 s).
 */
export function prefetchBrowse(contentId, { modifiers = {}, take = 50, now = Date.now() } = {}) {
  const id = String(contentId ?? '');
  if (!/^[\w-]+:.+/.test(id)) return false;
  const last = recent.get(id);
  if (last !== undefined && now - last < AGAIN_AFTER_MS) return false;
  if (recent.size > 200) recent.clear();
  recent.set(id, now);
  const urls = [browseListUrl(pathFor(id), { modifiers: { ...modifiers, expand: true }, take }), infoUrl(id)];
  for (const url of urls) readApiResource(url).catch(() => {});
  mediaLog.browsePrefetched({ contentId: id });
  return true;
}

/** Tests only. */
export function resetBrowsePrefetch() { recent.clear(); }
