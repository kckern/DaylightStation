/**
 * KeyTest — "Press a button on <name>": shows what the device sends and
 * whether games can use it.
 *
 * Owns the keys while it is up (window capture listener): every key is shown,
 * none acts, so a keyboard-mode device's arrows and Enter do not drive the
 * screen. Escape finishes (a held Escape's repeats are ignored). Holding a
 * press key (Enter, Space, a remote's play/pause) or a pad's back or select
 * button (useArcadeInput's mapping: B; A or Start) for HOLD_BACK_MS finishes;
 * a short press is shown like any other. It also finishes after IDLE_MS with
 * no input. Gamepad input carries no Bluetooth address, so pad presses count
 * toward the verdict only when the tested device is a gamepad (or of unknown
 * kind); each event shows the pad's own id.
 *
 * With `address` and `subscribeRemoteKeys` (the garage's per-remote feed), a
 * key counts only when the remote under test sent it: two remotes of the same
 * model send identical browser keys, and only the feed knows which is which
 * (createKeyAttributor). A press from another remote is shown, not counted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createKeyAttributor, gameKeySet, keyLabel, keyName, normalizeKey, padChanges, testVerdict } from './keyTestModel.js';
import { BACK_BUTTONS, SELECT_BUTTONS } from '../ui/useArcadeInput.js';

const HOLD_TO_FINISH_KEYS = new Set(['Enter', ' ', 'MediaPlayPause']);
const HOLD_TO_FINISH_BUTTONS = [...BACK_BUTTONS, ...SELECT_BUTTONS];

const MAX_EVENTS = 8;
const IDLE_MS = 20000;
const HOLD_BACK_MS = 1500;
let eventSeq = 0;

export function KeyTest({ name, kind, keyboardMap, getGamepads, onDone, note = null, idleMs = IDLE_MS, holdBackMs = HOLD_BACK_MS, address = null, subscribeRemoteKeys = null }) {
  const gameKeys = useMemo(() => gameKeySet(keyboardMap), [keyboardMap]);
  const [events, setEvents] = useState([]);
  const [keys, setKeys] = useState([]);
  const [padInputs, setPadInputs] = useState(0);
  const tally = useRef({ keys: [], padInputs: 0 });
  const lastAt = useRef(Date.now());
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const countPads = kind === 'gamepad' || !kind;
  const doneButton = useRef(null);

  // The button that opened the test (Test, or the pick) is gone: land focus
  // here so it never falls to <body>. Keys do not press it (they are shown);
  // a touch or a click does.
  useEffect(() => { doneButton.current?.focus(); }, []);

  const finishRef = useRef(null);
  finishRef.current = () => {
    if (done.current) return;
    done.current = true;
    const { keys: k, padInputs: p } = tally.current;
    onDoneRef.current?.({ keys: k, padInputs: p, verdict: testVerdict({ keys: k, padInputs: p, gameKeys }).id });
  };
  const addEvent = (text) => {
    lastAt.current = Date.now();
    eventSeq += 1;
    const id = eventSeq;
    setEvents((list) => [{ id, text }, ...list].slice(0, MAX_EVENTS));
  };

  const countKey = (k, label) => {
    tally.current = { ...tally.current, keys: [...tally.current.keys, k] };
    setKeys(tally.current.keys);
    addEvent(label);
  };
  const countKeyRef = useRef(countKey);
  countKeyRef.current = countKey;
  const addEventRef = useRef(addEvent);
  addEventRef.current = addEvent;

  // The garage's per-remote feed: which remote sent each key.
  const attributorRef = useRef(null);
  useEffect(() => {
    if (!address || typeof subscribeRemoteKeys !== 'function') return undefined;
    const attributor = createKeyAttributor({
      address,
      onCount: (k) => countKeyRef.current(k, keyName(k)),
      onOther: (k, from) => addEventRef.current(`${keyName(k)} (another remote …${from.slice(-5)})`),
    });
    attributorRef.current = attributor;
    const unsubscribe = subscribeRemoteKeys((msg) => attributor.tagged(msg));
    return () => { unsubscribe?.(); attributor.stop(); attributorRef.current = null; };
  }, [address, subscribeRemoteKeys]);

  useEffect(() => {
    let holdKey = null;
    const handler = (e) => {
      const attributor = attributorRef.current;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) {
        // A held press key: long enough finishes, like holding the pad's back button.
        if (holdKey && holdKey.key === e.key && Date.now() - holdKey.since >= holdBackMs) finishRef.current();
        return;
      }
      if (e.key === 'Escape') { finishRef.current(); return; }
      holdKey = HOLD_TO_FINISH_KEYS.has(e.key) ? { key: e.key, since: Date.now() } : null;
      lastAt.current = Date.now();
      if (attributor) {
        // Unidentified keys have no tagged twin to wait for: count them now.
        if (normalizeKey(e.key) !== 'Unidentified') { attributor.browser(e.key); return; }
      }
      countKey(normalizeKey(e.key), keyLabel(e));
    };
    const up = (e) => { if (holdKey?.key === e.key) holdKey = null; };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [holdBackMs]);

  useEffect(() => {
    const read = getGamepads
      || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
    let prev = null;
    let raf = null;
    let bSince = null;
    let stopped = false;
    const poll = () => {
      if (stopped) return;
      let pads = [];
      try { pads = [...(read() || [])].filter(Boolean); } catch { pads = []; }
      const { events: evs, snapshot } = padChanges(prev, pads);
      prev = snapshot;
      for (const ev of evs) {
        if (countPads) {
          tally.current = { ...tally.current, padInputs: tally.current.padInputs + 1 };
          setPadInputs(tally.current.padInputs);
        }
        addEvent(`${ev.input} (${ev.padId})`);
      }
      if (pads.some((p) => HOLD_TO_FINISH_BUTTONS.some((i) => p.buttons?.[i]?.pressed))) {
        bSince ??= Date.now();
        if (Date.now() - bSince >= holdBackMs) { finishRef.current(); return; }
      } else {
        bSince = null;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { stopped = true; if (raf !== null) cancelAnimationFrame(raf); };
  }, [getGamepads, countPads, holdBackMs]);

  useEffect(() => {
    const t = setInterval(() => { if (Date.now() - lastAt.current >= idleMs) finishRef.current(); }, 1000);
    return () => clearInterval(t);
  }, [idleMs]);

  const verdict = testVerdict({ keys, padInputs, gameKeys });
  return (
    <section className="bts-test" aria-label={`Test ${name}`}>
      {note ? <p className="bts-status-line bts-tone-ok">{note}</p> : null}
      <p className="bts-test-prompt">Press a button on {name}</p>
      <p className={`bts-status-line bts-tone-${verdict.tone}`} role="status">{verdict.text || 'Waiting for a press…'}</p>
      <ul className="bts-test-events" aria-label="What arrived">
        {events.map((e) => <li key={e.id}>{e.text}</li>)}
      </ul>
      <p className="bts-hint">
        Press Escape, or hold the back or Start button, to finish. It also finishes after {Math.round(idleMs / 1000)} seconds with no presses.
      </p>
      {/* For touch. It holds focus (so focus never falls to the page) but shows
          no focus ring: keys here are captured, so A or Enter would not press it. */}
      <button type="button" className="bts-button bts-test-done" ref={doneButton} onClick={() => finishRef.current()}>Done</button>
    </section>
  );
}

export default KeyTest;
