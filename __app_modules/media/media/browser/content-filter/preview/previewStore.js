/**
 * previewStore — the content-filter preview surround's view of the playing title.
 *
 * The player's filter hook (useMediaVideoPresentation) publishes its live state here
 * and binds the transport and actions; the surround modules (rail, timeline) read it
 * with useFilterPreview() and call the actions. A module singleton because the
 * producer (inside VideoPlayer) and the consumers (surround modules mounted by
 * SurroundFrame) share no props path. Works with no subscribers and no open surround:
 * every action is a safe no-op until a player binds.
 */
import { useSyncExternalStore } from 'react';

/** Jump/replay lead: seek this many seconds before a cue's `in`. */
export const PREVIEW_LEAD_SEC = 4;

const INITIAL = Object.freeze({
  ratingKey: null,
  title: null,
  cues: [],
  scenes: [],
  certification: null,
  summary: '',
  override: null,
  profile: null,
  lastFired: null,
  filterActive: false,
  open: false,
});

const NOOP_BINDING = Object.freeze({
  position: () => null,
  seek() {},
  play() {},
  peek() {},
  refresh: async () => {},
  close() {},
});

let snapshot = INITIAL;
let binding = NOOP_BINDING;
let owner = null;
// The title a host forces the filter on for (Admin review player). Outlives a player reset:
// the host owns it, not the player.
let forced = null;
const digits = (id) => String(id ?? '').replace(/[^0-9]/g, '');
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => { try { fn(); } catch (_) { /* a broken subscriber must not stop the rest */ } });
}

function jumpTo(cue) {
  if (!cue || !Number.isFinite(cue.in)) return;
  binding.seek(Math.max(0, cue.in - PREVIEW_LEAD_SEC));
  binding.play();
}

export const previewStore = {
  getSnapshot: () => snapshot,
  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Merge `partial` into the snapshot (a new object) and notify once. */
  publish(partial) {
    snapshot = { ...snapshot, ...partial };
    notify();
  },
  /**
   * Bind the player: `{ position(), seek(s), play(), peek(id), refresh(), close() }` (any subset).
   * Returns an unbind that only clears this binding (a newer player keeps its own).
   */
  bind(handlers) {
    const mine = { ...NOOP_BINDING, ...handlers };
    binding = mine;
    owner = mine;
    const unbind = () => { if (binding === mine) binding = NOOP_BINDING; };
    // Empty the store, but only while this binding is still the latest one bound.
    unbind.reset = () => { if (owner === mine) previewStore.reset(); };
    return unbind;
  },
  /** Back to the empty, closed snapshot with no binding (player unmount; tests). */
  reset() {
    binding = NOOP_BINDING;
    owner = null;
    snapshot = INITIAL;
    notify();
  },

  seekTo(seconds) { if (Number.isFinite(seconds)) binding.seek(Math.max(0, seconds)); },
  jumpToCue(cue) { jumpTo(cue); },
  replayLast() { jumpTo(snapshot.lastFired); },
  peek(id) { if (id != null) binding.peek(String(id)); },
  /** The bound player's position in seconds, or null. */
  currentTime() { const t = binding.position(); return Number.isFinite(t) ? t : null; },
  /** Force the filter on for one title (rating key or content id); null clears. */
  forceFilter(id) { forced = id == null ? null : digits(id); },
  isForced(id) { return forced != null && forced !== '' && digits(id) === forced; },
  refresh() { return Promise.resolve(binding.refresh()).then(() => undefined); },
  close() { binding.close(); },
};

/** The live preview snapshot, for surround modules. */
export function useFilterPreview() {
  return useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot, previewStore.getSnapshot);
}
