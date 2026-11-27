/**
 * Continue listening — pure rules for which long audio the household is in the
 * middle of (lookup spec §13, "Continue listening means listened, not touched").
 *
 * - An item counts only when it was really heard: `listenedSec` (measured at home
 *   from play/log reports, playback/domain/listenedTime.mjs) summed over the book
 *   or series reaches `minListenedMin` (household media config
 *   `continue.minListenedMin`, default 5). A seek to the middle never qualifies.
 * - One row per book or series: its parts collapse into it, the row showing the
 *   current part (the most recently played unfinished one).
 * - A row leaves when the book is finished, when it was removed from Continue
 *   (the household removed list, §10; hiding the book hides its parts), or when
 *   nothing in it was played for `unplayedDays` (90).
 * - A row shorter than 20 min in all (LONG_FORM_SECONDS) is not long audio: a
 *   standalone item by its own length, a book by its parts' total when known.
 * - Legacy: progress recorded before listened time was measured is not guessed.
 *   Undecided, it stays in the answer flagged `legacy` and is listed for review;
 *   a person's decision ("keep" / "clear") settles it.
 *
 * Inputs are plain progress records (see householdMediaList.mjs) with
 * `listenedSec` / `listenLegacy`; no I/O, no clock.
 *
 * @module domains/media/continueListening
 */

import { isSpotFinished, timestampEpoch, compareTimestamps } from "../../../../../__capabilities/playback/server/spot-history.mjs";
import { isHiddenByRemoval } from "./householdMediaList.mjs";

export const DEFAULT_MIN_LISTENED_MIN = 5;
export const DEFAULT_UNPLAYED_DAYS = 90;
/** Long audio with no library kind known (the phone's long-form line). */
export const LONG_FORM_SECONDS = 20 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDERED_KINDS = new Set(['books', 'talks']);
const AUDIO_TYPES = new Set(['track', 'audiobook', 'podcast', 'audio']);
export const REVIEW_DECISIONS = Object.freeze(['keep', 'clear']);

/** The household media config's `continue` block, with defaults. */
export function continueSettings(config) {
  const min = Number(config?.minListenedMin);
  const days = Number(config?.unplayedDays);
  return {
    minListenedMin: Number.isFinite(min) && min >= 0 ? min : DEFAULT_MIN_LISTENED_MIN,
    unplayedDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_UNPLAYED_DAYS,
  };
}

/** Whether a record holds a measure of listened time. */
export function isMeasured(record) {
  return Number.isFinite(record?.listenedSec);
}

/** A record whose progress predates the measure: flagged, or progress with no measure. */
export function isLegacyRecord(record) {
  if (!record) return false;
  if (record.listenLegacy === true) return true;
  return !isMeasured(record) && ((Number(record.playhead) || 0) > 0 || (Number(record.percent) || 0) > 0);
}

/**
 * Unfinished records played within `unplayedDays`, not removed by their own id,
 * newest first: the candidates for a Continue row (one per record id).
 * @param {Array<Object>} records
 * @param {{removed?: Object, nowEpoch: number, unplayedDays?: number}} opts
 */
export function continueCandidates(records, { removed = {}, nowEpoch, unplayedDays = DEFAULT_UNPLAYED_DAYS } = {}) {
  const since = nowEpoch - unplayedDays * DAY_MS;
  const byId = new Map();
  for (const record of records || []) {
    if (!record?.contentId) continue;
    const prev = byId.get(record.contentId);
    if (!prev || compareTimestamps(record.lastPlayed, prev.lastPlayed) > 0) byId.set(record.contentId, record);
  }
  return [...byId.values()]
    .filter((r) => {
      const at = timestampEpoch(r.lastPlayed);
      return Number.isFinite(at) && at >= since;
    })
    .filter((r) => !isSpotFinished(r) && (Number(r.playhead) || 0) > 0)
    .filter((r) => !isHiddenByRemoval(removed, r.contentId, r.lastPlayed))
    .sort((a, b) => compareTimestamps(b.lastPlayed, a.lastPlayed));
}

/**
 * Long audio for Continue listening: a books or talks library's item, an
 * audiobook or podcast; with no library kind known, an audio item of 20 min or
 * more. Music never; video never.
 * @param {{type?: string|null, duration?: number}} item - display fields + duration (s)
 * @param {string|null} kind - the item's library kind (orderedWork.libraryKindOf)
 */
export function isLongFormAudio(item, kind) {
  const type = item?.type ?? null;
  if (kind && ORDERED_KINDS.has(kind)) return true;
  if (type === 'audiobook' || type === 'podcast') return true;
  if (kind === 'music') return false;
  return AUDIO_TYPES.has(type) && (Number(item?.duration) || 0) >= LONG_FORM_SECONDS;
}

/** Whether a kind's items belong to a book or series (their parent is the row). */
export function collapsesIntoParent(kind) {
  return Boolean(kind && ORDERED_KINDS.has(kind));
}

/**
 * Judge one book or series (or a standalone item) and build its row.
 *
 * @param {Object} args
 * @param {string} args.groupId - the book/series id (or the item's own id)
 * @param {Object} args.current - the current part's progress record
 * @param {Object} args.display - the current part's display fields
 * @param {{title?:string|null, thumbnail?:string|null}|null} [args.parent] - the book's own display
 * @param {Array<{id:string, title?:string|null, duration?:number}>|null} [args.parts] - the book's parts in order
 * @param {Array<Object>} args.groupRecords - every progress record of the group's ids (parts and the book)
 * @param {Object} [args.removed] - household removed list
 * @param {Object} [args.decisions] - review decisions {<groupId>: {decision, decidedAt}}
 * @param {number} args.minListenedSec
 * @param {string|null} [args.kind]
 * @returns {{status: 'qualified'|'legacy'|'out', reason?: string, row?: Object}}
 */
export function judgeContinueGroup({
  groupId, current, display = {}, parent = null, parts = null, groupRecords = [],
  removed = {}, decisions = {}, minListenedSec, kind = null,
}) {
  const standalone = groupId === current.contentId;
  const lastPlayed = groupRecords.reduce(
    (latest, r) => (compareTimestamps(r?.lastPlayed, latest) > 0 ? r.lastPlayed : latest),
    current.lastPlayed,
  );
  // Hidden: the book, or any of its parts, was removed after the book's last play
  // (a phone that removed the row by its part id hides the whole book).
  const ids = new Set([groupId, ...groupRecords.map((r) => r?.contentId).filter(Boolean)]);
  if ([...ids].some((id) => isHiddenByRemoval(removed, id, lastPlayed))) return { status: 'out', reason: 'hidden' };

  // Finished: the book itself was marked finished after its parts were last
  // played (a mark keeps lastPlayed, so completedAt is the mark's time), or
  // every part is finished.
  const bookRecord = standalone ? null : groupRecords.find((r) => r?.contentId === groupId) ?? null;
  const partsLastPlayed = groupRecords
    .filter((r) => r?.contentId !== groupId)
    .reduce((latest, r) => (compareTimestamps(r.lastPlayed, latest) > 0 ? r.lastPlayed : latest), current.lastPlayed);
  if (bookRecord?.completedAt && isSpotFinished(bookRecord)
      && compareTimestamps(bookRecord.completedAt, partsLastPlayed) >= 0) {
    return { status: 'out', reason: 'finished' };
  }
  if (Array.isArray(parts) && parts.length) {
    const recordOf = new Map(groupRecords.map((r) => [r.contentId, r]));
    if (parts.every((p) => isSpotFinished(recordOf.get(p.id) ?? null))) return { status: 'out', reason: 'finished' };
  }

  // Too short to continue: Continue listening is long audio (a book, a talk), never a
  // 79-second item or an 11-minute clip filed in a books library (2026-11-27: "Orlando
  // Saunders · 1 min left" and a film's audio on the phone). A standalone item by its
  // own length; a book by its parts' total when they are known (unknown parts keep it).
  const total = totalSeconds({ standalone, current, display, parts });
  if (total !== null && total < LONG_FORM_SECONDS) return { status: 'out', reason: 'short' };

  // Listened, rolled up per id (the highest measure where an id lives twice).
  const listenedById = new Map();
  for (const r of groupRecords) {
    if (!isMeasured(r)) continue;
    listenedById.set(r.contentId, Math.max(listenedById.get(r.contentId) ?? 0, r.listenedSec));
  }
  const listenedSec = Number([...listenedById.values()].reduce((a, b) => a + b, 0).toFixed(1));
  const legacy = groupRecords.some(isLegacyRecord);
  const decision = decisions?.[groupId]?.decision ?? null;

  let status;
  if (listenedSec >= minListenedSec || decision === 'keep') status = 'qualified';
  else if (legacy && decision !== 'clear') status = 'legacy';
  else return { status: 'out', reason: legacy ? 'cleared' : 'not-listened' };

  const playhead = Number(current.playhead) || 0;
  const duration = Number(current.duration) || Number(display.duration) || 0;
  const partIndex = Array.isArray(parts) ? parts.findIndex((p) => p.id === current.contentId) : -1;
  let remainingSec = Math.max(0, duration - playhead);
  if (partIndex >= 0) {
    for (const p of parts.slice(partIndex + 1)) remainingSec += Number(p.duration) || 0;
  }
  const row = {
    contentId: groupId,
    playContentId: current.contentId,
    title: standalone
      ? (display.title ?? null)
      : (parent?.title ?? display.parentTitle ?? display.title ?? null),
    byline: standalone
      ? (display.grandparentTitle ?? display.parentTitle ?? null)
      : (display.grandparentTitle ?? null),
    thumbnail: (standalone ? display.thumbnail : (parent?.thumbnail ?? display.thumbnail)) ?? null,
    type: standalone ? (display.type ?? null) : (parent?.type ?? 'album'),
    kind: kind ?? null,
    partTitle: standalone ? null : (display.title ?? null),
    partIndex: partIndex >= 0 ? partIndex + 1 : (standalone ? null : (display.itemIndex ?? null)),
    partCount: Array.isArray(parts) && parts.length ? parts.length : null,
    playhead,
    duration,
    remainingSec: Math.round(remainingSec),
    listenedSec,
    lastPlayed: lastPlayed ?? null,
    legacy: status === 'legacy',
  };
  return { status, row };
}

/**
 * A Continue row's whole length in seconds: a standalone item's own, a book's parts summed
 * (null when its parts are not known, so a lookup that failed never drops a real book).
 */
export function totalSeconds({ standalone, current, display = {}, parts = null }) {
  if (standalone) return Number(current?.duration) || Number(display?.duration) || 0;
  if (!Array.isArray(parts) || !parts.length) return null;
  const sum = parts.reduce((a, p) => a + (Number(p?.duration) || 0), 0);
  return sum > 0 ? sum : null;
}

/** A review decision, validated. */
export function reviewDecision(decision, at) {
  if (!REVIEW_DECISIONS.includes(decision)) return null;
  return { decision, decidedAt: at };
}

export default {
  continueSettings, continueCandidates, isLongFormAudio, collapsesIntoParent, judgeContinueGroup,
  isLegacyRecord, isMeasured, reviewDecision,
};
