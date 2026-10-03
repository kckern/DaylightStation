// frontend/src/modules/Media/house/houseCopy.js
// Words for the house view: start progress (§9.15), "Started by" (§2.7),
// screen notes (§9.14 controls.notes), rename history, house-wide actions and
// routine runs (§2.6). Everything returned is meant for a person; raw ids,
// step names and codes stop here.
import { friendlyStepLabel, friendlyStepPhrase } from '../cast/castCopy.js';
import { isPlaceholderName } from '../identity/browserIdentity.js';

const STARTED_SHOWN_MS = 60_000;
const PLAYED_WINDOW_MS = 5 * 60_000;
const SPEAKER_TYPES = new Set(['speaker', 'speaker-lane']);

function ms(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
}

/** "7:02", or "Fri 7:02" when it was not today. */
export function clockTime(iso, now = Date.now()) {
  const t = ms(iso);
  if (t == null) return '';
  const date = new Date(t);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function failureText({ step, error, at }, kind, now) {
  const phrase = friendlyStepPhrase(step, kind);
  const what = phrase ? `${phrase} failed` : 'it failed';
  return `Couldn't start at ${clockTime(at, now)}: ${what}${error ? ` (${error})` : ''}`;
}

/**
 * A house row's start line (RQ-HOUSE-04): the start under way, or the last
 * failure, for everyone. Null when there is nothing worth saying.
 * @returns {{tone: 'progress'|'ok'|'failed', text: string}|null}
 */
export function startStatusLine(status, { kind = 'screen', now = Date.now() } = {}) {
  if (!status || typeof status !== 'object') return null;
  const { phase, step, error, updatedAt, lastFailure, stale } = status;
  if (phase === 'failed') return { tone: 'failed', text: failureText({ step, error, at: updatedAt }, kind, now) };
  if ((phase === 'starting' || phase === 'delivered') && stale) {
    return { tone: 'failed', text: `A start stopped reporting at ${clockTime(updatedAt, now)}` };
  }
  if (phase === 'starting' || phase === 'delivered') {
    return { tone: 'progress', text: `Starting: ${friendlyStepLabel(step ?? 'load', kind)}` };
  }
  if (lastFailure) return { tone: 'failed', text: failureText(lastFailure, kind, now) };
  const updated = ms(updatedAt);
  const fresh = updated != null && now - updated < STARTED_SHOWN_MS;
  if (phase === 'queued' && fresh) return { tone: 'ok', text: 'Added to its queue' };
  if (phase === 'started' && fresh) return { tone: 'ok', text: 'Started' };
  return null;
}

/** "Started by Kitchen button, 7:02" (RQ-HOUSE-07); null when unknown. */
export function startedByText(info, now = Date.now()) {
  const who = info?.startedBy;
  if (!who) return null;
  const name = typeof who.name === 'string' && who.name.trim()
    ? who.name.trim()
    : who.kind === 'routine' ? 'a routine' : who.kind === 'device' ? 'another device' : null;
  if (!name) return null;
  const when = clockTime(info.at, now);
  return when ? `Started by ${name}, ${when}` : `Started by ${name}`;
}

/** Screens with no display of their own record notes on their house row. */
export function canShowNotes(device) {
  return !SPEAKER_TYPES.has(device?.type);
}

/** controls.notes as row lines (grouped by the screen; ×N when repeated). */
export function rowNotes(controls, now = Date.now()) {
  const notes = Array.isArray(controls?.notes) ? controls.notes : [];
  return notes.map((note) => {
    const until = ms(note.putBack?.availableUntil);
    const count = Number.isInteger(note.count) && note.count > 1 ? ` ×${note.count}` : '';
    const when = clockTime(note.at, now);
    return {
      id: note.id,
      text: `${note.label}${count}${when ? ` · ${when}` : ''}`,
      putBack: until != null && until > now,
    };
  });
}

/** "(was Kitchen tablet)" for a recently renamed screen (RQ-HOUSE-06). */
export function wasNameLabel(screen) {
  const was = typeof screen?.wasName === 'string' ? screen.wasName.trim() : '';
  // A made-up "Browser 1a2b3c4d" was never a name anyone knew it by.
  if (!was || was === screen?.name || isPlaceholderName(was)) return null;
  return `(was ${was})`;
}

const QUIET_VERBS = {
  pause: { done: 'Paused', not: 'Not paused', none: 'Nothing is playing' },
  stop: { done: 'Stopped', not: 'Not stopped', none: 'Nothing is playing' },
  resume: { done: 'Resumed', not: 'Not resumed', none: 'Nothing to resume' },
};

/** Outcome copy for Pause all / Stop all / Resume all (RQ-STEER-13). */
export function quietSummary(verb, { done = [], missed = [] } = {}) {
  const words = QUIET_VERBS[verb];
  if (!done.length && !missed.length) return { primary: words.none, secondary: null };
  const primary = `${words.done} ${done.length} screen${done.length === 1 ? '' : 's'}`;
  const secondary = missed.length
    ? `${words.not}: ${missed.map(({ name, reason }) => `${name} (${reason})`).join(', ')}`
    : done.join(', ');
  return { primary, secondary: secondary || null };
}

/** One routine start, in plain words (RQ-AUTO-05). */
export function routineRunLine(run, now = Date.now()) {
  const what = run?.played?.title ?? run?.what?.value ?? run?.what?.contentId ?? null;
  let outcome = 'Started';
  let tone = 'ok';
  if (run?.outcome === 'failed') { outcome = 'Failed'; tone = 'failed'; }
  else if (run?.outcome === 'deduplicated') { outcome = 'Repeat ignored'; tone = 'muted'; }
  else if (run?.played) outcome = 'Played';
  else if ((now - (ms(run?.at) ?? now)) > PLAYED_WINDOW_MS) { outcome = 'Started, not seen playing'; tone = 'warn'; }
  return {
    when: clockTime(run?.at, now),
    routine: run?.routine?.name ?? 'A routine',
    screen: run?.screenName ?? run?.deviceId ?? 'an unknown screen',
    what,
    outcome,
    tone,
    reason: run?.outcome === 'failed' ? (run.reason ?? 'Something went wrong') : null,
  };
}
