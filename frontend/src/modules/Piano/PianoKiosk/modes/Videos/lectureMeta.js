// lectureMeta.js
const num = (v) => {
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : null; }
  return Number.isFinite(v) ? v : null;
};

/** Plex content id for the Player, e.g. "plex:662039". Null if unresolved. */
export function lectureContentId(item) {
  if (!item) return null;
  if (item.plex) return `plex:${item.plex}`;
  if (typeof item.id === 'string' && /^plex:/i.test(item.id)) return item.id;
  if (typeof item.contentId === 'string') return item.contentId;
  return null;
}

/**
 * True when `item` carries the piano courses endpoint's per-user enrichment
 * (`UserVideoProgressStore#enrich`) — `userPercent`/`userWatched` are ALWAYS
 * present (even `null`/`false`) once a known kiosk user's request went
 * through it, so their presence — not their value — is the enrichment signal.
 * Absent entirely on device-level-only payloads: the no-user/guest fallback
 * (the fitness-show endpoint) never adds these fields. That's the only case
 * allowed to read device-level (Plex media-memory) signals below.
 */
function isUserScoped(item) {
  return item?.userPercent != null || item?.userWatched != null;
}

/**
 * Where to open a lecture. A COMPLETED lecture (per the standard completion
 * gate — lectureUserStatus) restarts from 0: rewatching a done video must not
 * drop you at the tail. Progress/completion records are untouched — replaying
 * never un-completes anything. In-progress lectures resume at the saved
 * per-user playhead. When a kiosk user is active (the item is user-scoped)
 * but has no playhead of their own, start at 0 — device-level signals (Plex
 * media-memory shared by everyone on the kiosk) must never stand in for
 * another user's/device's position. The device-level fallback is reserved
 * for the genuine no-user path (guest / no persistent user selected).
 */
export function resumeSecondsFor(item) {
  // The restart-from-0 check intentionally reads device-level `lectureStatus`
  // (not the user-scoped-only `lectureUserStatus`) for unenriched items: this
  // is the guest/no-user resume path, where "this device says I finished it"
  // is a reasonable restart signal for the person sitting at THIS kiosk right
  // now — unlike badges, it's never shown to, or attributed to, anyone else.
  const watched = isUserScoped(item) ? lectureUserStatus(item).watched : lectureStatus(item).watched;
  if (watched) return 0;
  if (item?.userPlayhead != null) return item.userPlayhead;
  if (isUserScoped(item)) return 0;
  return deriveResumeSeconds(item);
}

/** Resume position in seconds from a /playable lecture item (0 = start). */
export function deriveResumeSeconds(item) {
  const ws = num(item?.watchSeconds);
  if (ws && ws > 0) return ws;
  const dur = num(item?.duration);
  const pct = num(item?.watchProgress);
  if (pct && pct > 0 && dur && dur > 0) {
    return Math.min(dur, (Math.max(0, Math.min(100, pct)) / 100) * dur);
  }
  return 0;
}

/**
 * Device-level watch status from Plex media-memory signals (watched flag +
 * integer percent) — shared by everyone on the kiosk, so it must NEVER be
 * shown as a per-user badge (see `lectureUserStatus`). Its only remaining
 * consumer is `resumeSecondsFor`'s guest/no-user restart-from-0 check. The
 * backend `isWatched` flag is unreliable for generic Plex collections (it
 * comes back true with playCount 0 / progress 0), so derive "watched" from the
 * honest per-item history instead: a real completed view (playCount) or
 * near-complete progress.
 */
export function lectureStatus(item) {
  const pct = num(item?.watchProgress);
  const plays = num(item?.playCount);
  const percent = pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  const watched = (plays != null && plays > 0) || percent >= 90;
  // Device-level signals carry no completion timestamp.
  return { watched, percent, completedAt: null };
}

/**
 * Per-user watch status for anything shown/derived as a badge — tile
 * checkmarks/percent, sequential-lock gating, "current lesson" selection.
 * Reads ONLY the user-keyed fields from the piano courses endpoint
 * (userWatched/userPercent); an item with no per-user enrichment (the guest /
 * no-persistent-user fallback never adds these fields) reports unwatched/0
 * rather than falling back to device-level Plex media-memory signals — those
 * are shared by everyone on the kiosk and must never be attributed to, or
 * shown to, a specific person. (Device-level `lectureStatus` still backs the
 * narrow resume-restart decision in `resumeSecondsFor` — see its comment.)
 */
export function lectureUserStatus(item) {
  if (isUserScoped(item)) {
    const pct = num(item.userPercent);
    const percent = pct ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
    return { watched: !!item.userWatched, percent, completedAt: item.userCompletedAt || null };
  }
  return { watched: false, percent: 0, completedAt: null };
}
