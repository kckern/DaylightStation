import { useSyncExternalStore } from 'react';

/**
 * What the running client already knows about the session it just recorded,
 * for the screens that otherwise read the saved copy from the API.
 *
 * Landing on a finished session races its save: the voice memo and the end of
 * playback are in memory before the API has them. Rows and details overlay this
 * until the API catches up. It deliberately lives outside FitnessContext, whose
 * value changes on every sensor tick, so a screen reading it re-renders only
 * when these values change. The last session is kept after it ends: the final
 * save may still be in flight when its in-memory copy is reset.
 */
export const SESSION_SAVED_EVENT = 'fitness-session-saved';

const NO_MEMO = new Set(['[no memo]', 'no memo']);
const EMPTY = { sessionId: null, memos: [], playbackEvents: [] };

let state = EMPTY;
const listeners = new Set();

const setState = (next) => {
  state = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getState = () => state;

const memoText = (memo) => String(memo?.transcriptClean || memo?.transcriptRaw || memo?.transcript || '').trim();
const textKey = (text) => text.toLowerCase();

const normalizeMemos = (memos) => (Array.isArray(memos) ? memos : []).flatMap((memo) => {
  const transcript = memoText(memo);
  if (!transcript || NO_MEMO.has(textKey(transcript))) return [];
  return [{
    memoId: memo.memoId ?? null,
    transcript,
    createdAt: memo.createdAt ?? null,
    durationSeconds: memo.durationSeconds ?? null,
  }];
});

const forSession = (sessionId) => (state.sessionId === sessionId ? state : { ...EMPTY, sessionId });

/** A session id is required: a reset session must not erase its last copy. */
export function publishLiveMemos(sessionId, memos) {
  if (!sessionId) return;
  const next = normalizeMemos(memos);
  const base = forSession(sessionId);
  if (state.sessionId === sessionId && JSON.stringify(base.memos) === JSON.stringify(next)) return;
  setState({ ...base, memos: next });
}

export function publishLivePlayback(sessionId, events) {
  if (!sessionId) return;
  const playbackEvents = (Array.isArray(events) ? events : []).filter((e) => e?.type === 'playback_state');
  setState({ ...forSession(sessionId), playbackEvents });
}

export function resetLiveSessionStore() {
  setState(EMPTY);
}

export const useLiveSession = () => useSyncExternalStore(subscribe, getState, getState);

/** Saved memos win; a live memo is added only if the save has neither its id nor its words. */
export function mergeVoiceMemos(saved, live) {
  const savedMemos = Array.isArray(saved) ? saved : [];
  const ids = new Set(savedMemos.map((m) => m?.memoId).filter((id) => id != null).map(String));
  const texts = new Set(savedMemos.map((m) => textKey(memoText(m))).filter(Boolean));
  const missing = (Array.isArray(live) ? live : []).filter(
    (m) => !(m.memoId != null && ids.has(String(m.memoId))) && !texts.has(textKey(memoText(m)))
  );
  return missing.length ? [...savedMemos, ...missing] : savedMemos;
}

/** The sessions list with the live session's unsaved memos on its row. */
export function withLiveMemos(sessions, live) {
  if (!Array.isArray(sessions) || !live?.sessionId || !live.memos?.length) return sessions;
  let changed = false;
  const next = sessions.map((row) => {
    if (row?.sessionId !== live.sessionId) return row;
    const voiceMemos = mergeVoiceMemos(row.voiceMemos, live.memos);
    if (voiceMemos === row.voiceMemos) return row;
    changed = true;
    return { ...row, voiceMemos };
  });
  return changed ? next : sessions;
}

const playbackKey = (e) => `${e?.data?.playbackRunId}|${e?.timestamp}|${e?.data?.observation}`;

/** A session detail with the live playback observations the save does not have yet. */
export function withLivePlayback(detail, sessionId, live) {
  if (!detail || !sessionId || live?.sessionId !== sessionId || !live.playbackEvents?.length) return detail;
  const events = Array.isArray(detail.timeline?.events) ? detail.timeline.events : [];
  const known = new Set(events.filter((e) => e?.type === 'playback_state').map(playbackKey));
  const missing = live.playbackEvents.filter((e) => !known.has(playbackKey(e)));
  if (!missing.length) return detail;
  return { ...detail, timeline: { ...detail.timeline, events: [...events, ...missing] } };
}
