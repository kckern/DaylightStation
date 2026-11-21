// usePressFeed — what one device is pressing right now, for its device face.
//
// A remote: the garage's per-remote feed (`bt.remote.key`, subscribeRemoteKeys)
// from THIS address only; down/repeat holds a key, up releases it. Without the
// feed (a host that has none), browser keys stand in. A gamepad: the browser
// Gamepad API, every connected pad (a browser pad has no Bluetooth address).
//
// Returns { held, seen, keys, padInputs }: held = keys down now, seen = keys
// pressed at least once this visit (never faked), keys = every press in order
// (for the verdict and the test-result log), padInputs = pad presses.
import { useEffect, useRef, useState } from 'react';
import { normalizeKey } from './keyTestModel.js';
import { padHeld } from './deviceFaceModel.js';

const EMPTY = new Set();
// Keys that always move or leave the screen; never taken for trying a device.
export const NAV_KEYS = new Set(['Escape', 'Backspace', 'Tab']);

export function usePressFeed({ address = null, kind = 'remote', subscribeRemoteKeys = null, getGamepads = null, active = true, onPress = null }) {
  const [state, setState] = useState(() => ({ held: EMPTY, seen: EMPTY, keys: [], padInputs: 0 }));
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const addr = address ? String(address).toUpperCase() : null;
  const hasFeed = kind !== 'pad' && typeof subscribeRemoteKeys === 'function' && !!addr;

  // A new device (or a pause) starts a fresh visit.
  useEffect(() => { setState({ held: EMPTY, seen: EMPTY, keys: [], padInputs: 0 }); }, [addr, kind]);

  const down = (key, { pad = false } = {}) => {
    setState((s) => {
      const held = new Set(s.held); held.add(key);
      const seen = s.seen.has(key) ? s.seen : new Set([...s.seen, key]);
      return { held, seen, keys: pad ? s.keys : [...s.keys, key], padInputs: s.padInputs + (pad ? 1 : 0) };
    });
    onPressRef.current?.(key);
  };
  const up = (key) => setState((s) => {
    if (!s.held.has(key)) return s;
    const held = new Set(s.held); held.delete(key);
    return { ...s, held };
  });
  const downRef = useRef(down); downRef.current = down;
  const upRef = useRef(up); upRef.current = up;

  // The garage's per-remote feed.
  useEffect(() => {
    if (!active || !hasFeed) return undefined;
    const off = subscribeRemoteKeys((msg) => {
      if (String(msg?.address || '').toUpperCase() !== addr || !msg.key) return;
      const key = normalizeKey(msg.key);
      if (msg.state === 'up') upRef.current(key);
      else if (msg.state === 'repeat') setState((s) => (s.held.has(key) ? s : { ...s, held: new Set([...s.held, key]) }));
      else downRef.current(key);
    });
    return () => { off?.(); setState((s) => (s.held.size ? { ...s, held: EMPTY } : s)); };
  }, [active, hasFeed, addr, subscribeRemoteKeys]);

  // No feed: browser keys stand in (not the ones that move or leave).
  useEffect(() => {
    if (!active || hasFeed || kind === 'pad') return undefined;
    const onDown = (e) => {
      if (NAV_KEYS.has(e.key) || e.repeat) return;
      downRef.current(normalizeKey(e.key));
    };
    const onUp = (e) => upRef.current(normalizeKey(e.key));
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, [active, hasFeed, kind]);

  // A gamepad: poll the Gamepad API once a frame while the page is up.
  useEffect(() => {
    if (!active || kind !== 'pad') return undefined;
    const read = getGamepads
      || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    let prev = null;
    let raf = null;
    let stopped = false;
    const poll = () => {
      if (stopped) return;
      let pads = [];
      try { pads = [...(read() || [])].filter(Boolean); } catch { pads = []; }
      const now = padHeld(pads);
      // The first look records what is already held without calling it a press.
      if (prev) {
        for (const k of now) if (!prev.has(k)) downRef.current(k, { pad: true });
        for (const k of prev) if (!now.has(k)) upRef.current(k);
      } else if (now.size) {
        setState((s) => ({ ...s, held: now }));
      }
      prev = now;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { stopped = true; if (raf !== null) cancelAnimationFrame(raf); };
  }, [active, kind, getGamepads]);

  return { ...state, hasFeed };
}

export default usePressFeed;
