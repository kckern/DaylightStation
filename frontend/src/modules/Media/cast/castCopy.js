// frontend/src/modules/Media/cast/castCopy.js
// Human-facing copy for the cast flow. Internal step names, device states,
// and raw ids stop here — everything this module returns is meant to be
// read by a person on a couch, not a developer in a log.

// Wake-and-load steps (WakeAndLoadService.mjs STEPS) → what the user sees.
// Order: power → verify → volume → prepare → prewarm → load (→ playback).
const STEP_LABELS = {
  power: 'Turning on TV…',
  verify: 'Checking screen…',
  volume: 'Setting volume…',
  prepare: 'Preparing video…',
  prewarm: 'Loading…',
  load: 'Starting playback…',
  playback: 'Starting playback…',
};

/** Friendly in-progress label for a wake step. */
export function friendlyStepLabel(step) {
  return STEP_LABELS[step] ?? 'Working…';
}

/** "Turning on TV" (no ellipsis) — for failure sentences. */
export function friendlyStepPhrase(step) {
  const label = STEP_LABELS[step];
  return label ? label.replace(/…$/, '') : null;
}

function fmtRemaining(position, duration) {
  if (!(duration > 0)) return null;
  const left = Math.max(0, Math.floor(duration - (position ?? 0)));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return `${m}:${s}`;
}

const BUSY_STATES = new Set(['playing', 'paused', 'buffering', 'stalled']);

/**
 * One-line live status for a device tile, from a fleet entry.
 * Returns null when the device has never published state (degrade to
 * showing nothing rather than guessing).
 * @returns {{text: string, tone: 'active'|'idle'|'off'}|null}
 */
export function deviceStatusLine(entry) {
  if (!entry || !entry.snapshot) return null;
  if (entry.offline) return { text: 'Off', tone: 'off' };
  const snap = entry.snapshot;
  const item = snap.currentItem;
  const title = item?.title ?? null;
  if (snap.state === 'paused' && title) {
    return { text: `Paused: ${title}`, tone: 'active' };
  }
  if (BUSY_STATES.has(snap.state) && title) {
    const remaining = fmtRemaining(snap.position, item?.duration);
    return {
      text: `Playing: ${title}${remaining ? ` — ${remaining} left` : ''}`,
      tone: 'active',
    };
  }
  if (snap.state === 'off' || snap.state === 'standby') {
    return { text: 'Off', tone: 'off' };
  }
  return { text: 'Idle', tone: 'idle' };
}

/**
 * Is this device mid-something a cast would steamroll?
 * Only answers when a snapshot exists — no snapshot means "unknown",
 * and unknown must not warn (returns null).
 * @returns {{phrase: string}|null} e.g. { phrase: 'playing Bluey' }
 */
export function describeBusy(entry) {
  const snap = entry?.snapshot;
  if (!snap || entry.offline) return null;
  const title = snap.currentItem?.title ?? null;
  if (!title || !BUSY_STATES.has(snap.state)) return null;
  return { phrase: snap.state === 'paused' ? `paused on ${title}` : `playing ${title}` };
}

export default { friendlyStepLabel, friendlyStepPhrase, deviceStatusLine, describeBusy };
