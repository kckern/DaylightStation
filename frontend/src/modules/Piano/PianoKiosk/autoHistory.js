import { toTakeEvent, closeOpenNotes, takeDuration } from './modes/Studio/studioRecording.js';

const pad = (n) => String(n).padStart(2, '0');

/** Start a new take: relative-time events + a date/id derived from local start time. */
export function newTake(startedAtMs, owner) {
  const d = new Date(startedAtMs);
  return {
    startedAtMs,
    owner,
    events: [],
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    id: `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`,
  };
}

/** Append a live MIDI event ({type,note,velocity,time}) as a relative-time take event. */
export function addEvent(take, evt) {
  return { ...take, events: [...take.events, toTakeEvent(evt, take.startedAtMs)] };
}

export const noteCount = (take) => take.events.filter((e) => e.type === 'note_on').length;

/** A take is worth saving once it reaches minNotes (and minSeconds, if set). */
export function qualified(take, { minNotes = 0, minSeconds = 0 } = {}) {
  if (noteCount(take) < minNotes) return false;
  if (minSeconds > 0 && takeDuration(take.events) < minSeconds * 1000) return false;
  return true;
}

/** True once `silenceMs` has elapsed since the take's last event (absolute clock). */
export function silent(take, nowMs, silenceMs) {
  if (take.events.length === 0) return false;
  const lastAbs = take.startedAtMs + take.events[take.events.length - 1].t;
  return nowMs - lastAbs >= silenceMs;
}

/** Resolve a unique key, suffixing -2/-3 on a same-second collision within a date. */
export function takeKey(date, id, usedKeys) {
  if (!usedKeys.has(`${date}/${id}`)) return id;
  let n = 2;
  while (usedKeys.has(`${date}/${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

/** Build the PUT body, closing any held notes at `nowMs` so the .mid is valid. */
export function flushBody(take, nowMs) {
  const events = closeOpenNotes(take.events, Math.max(0, nowMs - take.startedAtMs));
  return { events, startedAt: new Date(take.startedAtMs).toISOString(), durationMs: takeDuration(events) };
}
