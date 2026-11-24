// KeyboardOnlyContext.js — the office screen telling Learn it has no touch.
//
// One context, absent on the tablet: ScorePlayer, LearnCoach and LearnLab read
// it and, when it is there, open on the coach's next step, draw no touch-only
// controls, and hand what those controls did to the host's key strip instead.
// PianoApp never provides it, so the tablet is unchanged.
import { createContext, useContext, useEffect, useRef } from 'react';

const KeyboardOnlyContext = createContext(null);

/**
 * `{ input: 'keyboard-only', canListen, onExit(reason), publishStrip(source, entry|null) }`
 * on the office screen; null everywhere else.
 */
export function useKeyboardOnly() {
  return useContext(KeyboardOnlyContext);
}

/**
 * Put actions on the host's key strip for as long as the caller is mounted.
 *
 * `actions` maps a strip key id (officeKeys STRIP_KEYS) to `{ onSelect, label? }`;
 * an id left out, or without `onSelect`, draws its key dim. `active: false`
 * takes the whole strip off the keys — during a take every key is music. The
 * handlers are read at press time from a ref, so a caller can pass fresh
 * closures every render without re-publishing at MIDI rates; only what is DRAWN
 * (ids, labels, enabled, active) is published.
 */
export function useKeyStrip(source, actions, { active = true } = {}) {
  const ctx = useContext(KeyboardOnlyContext);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const publish = ctx?.publishStrip ?? null;
  const signature = JSON.stringify([active, Object.entries(actions || {})
    .map(([id, action]) => [id, action?.label ?? null, typeof action?.onSelect === 'function'])]);
  useEffect(() => {
    if (!publish) return;
    publish(source, { actionsRef, active, signature });
  }, [publish, source, signature, active]);
  useEffect(() => () => { publish?.(source, null); }, [publish, source]);
}

export default KeyboardOnlyContext;
