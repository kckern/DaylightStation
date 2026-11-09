import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { readPads, padsSignature, describePress, LIT_MS } from './liveInput.js';

const readRaw = () => {
  try { return typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []; }
  catch { return []; }
};

/**
 * Live gamepad state for the Controllers screen. Polls on animation frames
 * (the Gamepad API has no press events) but only re-renders when what is
 * pressed changes, plus once when a lamp's LIT_MS runs out.
 *
 * Reading getGamepads() is also what makes Chromium on Android stop turning
 * pad buttons into key presses, so mashing a pad here cannot click the
 * focused button — see `gamepadIsPressing` for the belt-and-braces check.
 *
 * @returns {{ pads, lastSeen: Record<number, {at:number, press:string}>, now:number }}
 */
export function useGamepadActivity() {
  const logger = useMemo(() => getLogger().child({ component: 'controller-live-input' }), []);
  const [view, setView] = useState({ pads: readPads(readRaw()), lastSeen: {}, now: Date.now() });
  const lastSeen = useRef({});
  const seenOnce = useRef(new Set());

  useEffect(() => {
    let frame;
    let signature = '';
    let decay;
    const tick = () => {
      const pads = readPads(readRaw());
      const now = Date.now();
      let lit = false;
      for (const pad of pads) {
        if (!pad.active) continue;
        lastSeen.current[pad.index] = { at: now, press: describePress(pad) };
        lit = true;
        if (!seenOnce.current.has(pad.id)) {
          seenOnce.current.add(pad.id);
          logger.info('controller-live-input.first-press', { index: pad.index, id: pad.id });
        }
      }
      const next = padsSignature(pads);
      if (next !== signature) {
        signature = next;
        setView({ pads, lastSeen: { ...lastSeen.current }, now });
      }
      if (lit) {
        clearTimeout(decay);
        decay = setTimeout(() => setView((v) => ({ ...v, now: Date.now() })), LIT_MS + 20);
      }
      frame = requestAnimationFrame(tick);
    };
    const onConnect = (event) => logger.info('controller-live-input.gamepad', {
      connected: event.type === 'gamepadconnected', index: event.gamepad?.index, id: event.gamepad?.id,
    });
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onConnect);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); clearTimeout(decay);
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onConnect);
    };
  }, [logger]);

  return view;
}

/**
 * True while a controller (not the remote) has a BUTTON held. Buttons only: a
 * drifting stick resting past the deadzone must not swallow the remote forever.
 */
export function gamepadIsPressing() {
  return readPads(readRaw()).some((p) => p.pressed.some(Boolean));
}

export const isLit = (seen, now) => Boolean(seen && now - seen.at <= LIT_MS);
