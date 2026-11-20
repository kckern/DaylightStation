/**
 * KeyTest — "Press a button on <name>": shows what the device sends and
 * whether games can use it.
 *
 * Owns the keys while it is up (window capture listener): every key is shown,
 * none acts, so a keyboard-mode device's arrows and Enter do not drive the
 * screen. Escape finishes. A gamepad's B held for HOLD_BACK_MS finishes (a
 * short B press is shown like any button). It also finishes after IDLE_MS with
 * no input. Gamepad input carries no Bluetooth address, so pad presses count
 * toward the verdict only when the tested device is a gamepad (or of unknown
 * kind); each event shows the pad's own id.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gameKeySet, keyLabel, normalizeKey, padChanges, testVerdict } from './keyTestModel.js';

const MAX_EVENTS = 8;
const IDLE_MS = 20000;
const HOLD_BACK_MS = 1500;
let eventSeq = 0;

export function KeyTest({ name, kind, keyboardMap, getGamepads, onDone, note = null, idleMs = IDLE_MS, holdBackMs = HOLD_BACK_MS }) {
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

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { finishRef.current(); return; }
      if (e.repeat) return;
      tally.current = { ...tally.current, keys: [...tally.current.keys, normalizeKey(e.key)] };
      setKeys(tally.current.keys);
      addEvent(keyLabel(e));
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

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
      if (pads.some((p) => p.buttons?.[1]?.pressed)) {
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
      <p className="bts-hint">Press Escape, or hold B, to finish. It also finishes after 20 seconds with no presses.</p>
      <button type="button" className="bts-button" ref={doneButton} onClick={() => finishRef.current()}>Done</button>
    </section>
  );
}

export default KeyTest;
