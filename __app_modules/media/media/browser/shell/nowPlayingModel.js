import { playbackStateLabel } from './stateCopy.js';
// shell/nowPlayingModel.js
// Pure rules for the Now Playing view (spec addendum "Now Playing",
// 2026-11-27): one hero, one status, the queue around what plays now.

/** How many items after the current one the queue shows before More. */
export const UP_NEXT_SHOWN = 5;

/**
 * The queue split around the current item: what already played (collapsed
 * into one line), the current item and the next few, and the rest (More).
 * A queue that has not started (index -1) windows from its head.
 */
export function queueWindow(items = [], currentIndex = -1, upNext = UP_NEXT_SHOWN) {
  const list = Array.isArray(items) ? items : [];
  const start = Number.isInteger(currentIndex) && currentIndex >= 0 ? Math.min(currentIndex, list.length) : 0;
  const end = Math.min(list.length, start + 1 + upNext);
  return { earlier: list.slice(0, start), window: list.slice(start, end), later: list.slice(end) };
}

/** The folded row for items that already played in this queue ("2 played ›"). */
export function earlierLabel(count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  return `${count} played`;
}

/**
 * The hero names the state only when it is not simply playing (the play/pause
 * button already says that): Paused, Buffering…, Finished and the like.
 */
export function heroStateWord(state) {
  if (!state || state === 'playing') return null;
  return playbackStateLabel(state) || null;
}

/**
 * One status: the bottom bar never repeats the hero. Now Playing is the hero,
 * so the bar is hidden there whatever the session holds.
 */
export function miniBarVisible({ view, hasItem = false, queueCount = 0 }) {
  if (view === 'nowPlaying') return false;
  return !!hasItem || queueCount > 0;
}

const isRawId = (value, item) => typeof value === 'string' && (value === item?.contentId || /^[a-z-]+:[\w/.-]+$/i.test(value) && !/\s/.test(value));

/**
 * The line under the title: "<show> · S1 E3" for an episode, "<artist> ·
 * <album>" for a track. Never the title again, never a raw id.
 */
export function heroSubtitle(item, entry) {
  if (!item && !entry) return null;
  const title = item?.title ?? entry?.title ?? null;
  const artist = entry?.artist ?? item?.artist ?? null;
  const album = entry?.album ?? item?.album ?? null;
  let parts;
  if (artist || album) {
    parts = [artist, album];
  } else {
    const show = entry?.containerTitle ?? item?.containerTitle ?? item?.grandparentTitle ?? null;
    const season = entry?.parentIndex ?? item?.parentIndex ?? null;
    const episode = entry?.itemIndex ?? item?.itemIndex ?? null;
    const se = Number.isFinite(season) && Number.isFinite(episode) ? `S${season} E${episode}` : null;
    parts = [show, se];
  }
  const clean = parts.filter((part) => typeof part === 'string' && part.trim() && part !== title && !isRawId(part, item));
  return clean.length ? clean.join(' · ') : null;
}

/** Where the hero's item plays. */
export function wherePlayingLabel({ local, name = null }) {
  if (local) return 'on This device';
  return typeof name === 'string' && name.trim() ? `on ${name.trim()}` : null;
}

// Controls that use the arrow keys themselves.
const ARROW_OWNERS = 'input, textarea, select, [contenteditable="true"], [role="slider"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="radiogroup"], [role="radio"], [role="tablist"], [role="spinbutton"], [aria-modal="true"]';

/** ← / → seek 10 s while nothing is being typed or steered with the arrows. */
export function seekKeyStep(event) {
  if (!event || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const step = event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : null;
  if (step == null) return null;
  const target = event.target;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return null;
  if (target?.closest?.(ARROW_OWNERS)) return null;
  return step;
}

/** What happens when the queue ends: one control, showing the current choice. */
export const END_ACTION_OPTIONS = Object.freeze([
  { value: 'stop', label: 'Stop' },
  { value: 'repeat', label: 'Repeat the queue' },
  { value: 'similar', label: 'Keep similar playing' },
]);

export function endActionOption(value) {
  return END_ACTION_OPTIONS.find((option) => option.value === value) ?? END_ACTION_OPTIONS[0];
}
