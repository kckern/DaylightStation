// frontend/src/screen-framework/session/continuationResolver.js
//
// "Keep similar things playing" for a screen (RQ-STEER-19, O2 as revised):
// resolve the finished item's container through the existing siblings and
// queue APIs, then let the shared policy pick the next batch.
//
//   - siblings API → parent container (natural order) + ancestors. A parent
//     id starting `library:` is the adapter's whole-library fallback, not a
//     container: nothing similar.
//   - episodes climb from the season into the show, tracks from the album
//     into the artist (queue API of that ancestor, sorted by season/disc then
//     index); a playlist is never climbed.
//   - the queue API supplies playable items and household `lastPlayed`
//     (MediaProgress) for the 7-day preference.
//   - excluded: anything queued here and anything playing on another screen.
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { isLibraryFallbackParent, selectContinuationBatch } from '@shared-contracts/media/continuation.mjs';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenContinuation' });
  return _logger;
}

const CLIMB_TYPES = new Set(['show', 'artist']);
const ACTIVE = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled']);
const idOf = (item) => item?.contentId ?? item?.id ?? null;

function splitId(contentId) {
  const index = String(contentId).indexOf(':');
  return index > 0 ? [contentId.slice(0, index), contentId.slice(index + 1)] : [null, contentId];
}

const naturalKey = (item) => [Number(item.parentIndex ?? 0), Number(item.itemIndex ?? 0)];

export function createContinuationResolver({ api = DaylightAPI, ownerId, now = () => Date.now() } = {}) {
  async function playingElsewhere() {
    try {
      const config = await api('api/v1/device/config');
      const ids = Object.entries(config?.devices ?? {})
        .filter(([id, device]) => id !== ownerId && (device?.content_control || device?.fleet))
        .map(([id]) => id);
      const sessions = await Promise.allSettled(ids.map((id) => api(`api/v1/device/${encodeURIComponent(id)}/session`)));
      return sessions
        .map((r) => (r.status === 'fulfilled' && ACTIVE.has(r.value?.state) ? r.value?.currentItem?.contentId : null))
        .filter(Boolean);
    } catch (err) {
      logger().warn('continuation.fleet-unreadable', { ownerId, error: String(err?.message ?? err) });
      return [];
    }
  }

  return async function resolveContinuation({ finished, queue = null } = {}) {
    const finishedId = idOf(finished);
    if (!finishedId) return [];
    const [source, localId] = splitId(finishedId);
    let siblings;
    try {
      siblings = await api(`api/v1/siblings/${source}/${localId}?offset=0&limit=500`);
    } catch (err) {
      logger().warn('continuation.siblings-failed', { ownerId, contentId: finishedId, error: String(err?.message ?? err) });
      return [];
    }
    const parent = siblings?.parent ?? null;
    if (isLibraryFallbackParent(parent)) {
      logger().info('continuation.no-container', { ownerId, contentId: finishedId, parentId: parent?.id ?? null });
      return [];
    }
    const kind = parent.type === 'playlist' ? 'playlist' : 'container';
    const climb = kind === 'container'
      ? (siblings.ancestors ?? []).find((a) => CLIMB_TYPES.has(a?.type) && a.id !== parent.id) ?? null
      : null;
    const containerId = climb?.id ?? parent.id;

    let pool = [];
    try {
      const response = await api(`api/v1/queue/${containerId}`);
      pool = Array.isArray(response?.items) ? response.items : [];
    } catch (err) {
      logger().warn('continuation.queue-failed', { ownerId, containerId, error: String(err?.message ?? err) });
      return [];
    }
    const byId = new Map(pool.map((item) => [idOf(item), { ...item, contentId: idOf(item) }]));

    let ordered;
    if (climb) {
      ordered = [...byId.values()]
        .map((item, i) => ({ item, i }))
        .sort((a, b) => {
          const [ap, ai] = naturalKey(a.item);
          const [bp, bi] = naturalKey(b.item);
          return ap - bp || ai - bi || a.i - b.i;
        })
        .map(({ item }) => item);
    } else {
      ordered = (siblings.items ?? []).map((s) => byId.get(idOf(s))).filter(Boolean);
      if (!ordered.length) ordered = [...byId.values()];
    }

    const exclude = [
      ...(queue?.items ?? []).map(idOf).filter(Boolean),
      ...(await playingElsewhere()),
    ];
    const batch = selectContinuationBatch({ items: ordered, finishedId, kind, exclude, now: now() });
    logger().info('continuation.resolved', {
      ownerId, contentId: finishedId, parentId: parent.id, containerId, kind,
      poolSize: ordered.length, excluded: exclude.length, batch: batch.map(idOf),
    });
    return batch;
  };
}

export default createContinuationResolver;
