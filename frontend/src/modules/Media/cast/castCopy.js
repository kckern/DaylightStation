// frontend/src/modules/Media/cast/castCopy.js
// Human-facing copy for the cast flow. Internal step names, device states,
// and raw ids stop here — everything this module returns is meant to be
// read by a person on a couch, not a developer in a log.

// Wake-and-load steps (WakeAndLoadService.mjs STEPS) → what the user sees.
// Order: power → verify → volume → prepare → prewarm → load (→ playback).
// Wording fits the kind of screen (RELY.2a/AC3): a speaker is never a "TV".
const STEP_LABELS = {
  tv: {
    power: 'Turning on TV…',
    verify: 'Checking the TV…',
  },
  speaker: {
    power: 'Waking the speaker…',
    verify: 'Checking the speaker…',
  },
  screen: {
    power: 'Waking the screen…',
    verify: 'Checking the screen…',
  },
};
const COMMON_STEPS = {
  volume: 'Setting volume…',
  prepare: 'Getting ready…',
  prewarm: 'Loading…',
  load: 'Starting playback…',
  playback: 'Starting playback…',
};

const SPEAKER_TYPES = new Set(['speaker', 'speaker-lane']);
const TV_TYPES = new Set(['shield-tv']);

/**
 * The kind of screen a device is, for wording only: 'tv' | 'speaker' | 'screen'.
 * Unknown devices are a generic screen — never assumed to be a TV.
 */
export function deviceKind(device) {
  const type = typeof device?.type === 'string' ? device.type : '';
  const icon = typeof device?.icon === 'string' ? device.icon.trim() : '';
  if (SPEAKER_TYPES.has(type) || icon === 'speaker' || icon === '🔊') return 'speaker';
  if (TV_TYPES.has(type) || /tv$/i.test(type) || icon === 'tv' || icon === '📺') return 'tv';
  return 'screen';
}

/** Friendly in-progress label for a wake step on a kind of screen. */
export function friendlyStepLabel(step, kind = 'tv') {
  return STEP_LABELS[kind]?.[step] ?? STEP_LABELS.screen[step] ?? COMMON_STEPS[step] ?? 'Working…';
}

/** "Turning on TV" (no ellipsis) — for failure sentences. */
export function friendlyStepPhrase(step, kind = 'tv') {
  const label = STEP_LABELS[kind]?.[step] ?? STEP_LABELS.screen[step] ?? COMMON_STEPS[step];
  return label ? label.replace(/…$/, '') : null;
}

/** What the screen is called in a sentence: "the TV", "the speaker", "the screen". */
export function deviceKindNoun(kind) {
  return kind === 'tv' ? 'TV' : kind === 'speaker' ? 'speaker' : 'screen';
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

export default { friendlyStepLabel, friendlyStepPhrase, deviceKind, deviceKindNoun, deviceStatusLine, describeBusy };
