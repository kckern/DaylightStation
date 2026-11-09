import { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { readPads, padsSignature, describePress, dropTwins, LIT_MS } from './liveInput.js';

// When a controller button last went DOWN (any pad). Module-level so the key
// guard can ask without a React render in between.
let lastPadEdgeAt = 0;
const EDGE_WINDOW_MS = 250;

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
  const twins = useRef({ twins: new Set(), real: new Set() });
  const prevPressed = useRef({});

  useEffect(() => {
    let frame;
    let signature = '';
    let decay;
    const tick = () => {
      const pads = dropTwins(readPads(readRaw()), twins.current);
      const now = Date.now();
      let lit = false;
      for (const pad of pads) {
        const before = prevPressed.current[pad.index] || [];
        if (pad.pressed.some((on, i) => on && !before[i])) lastPadEdgeAt = now;
        prevPressed.current[pad.index] = pad.pressed;
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
      // One pending decay re-render at a time (not a fresh timer every frame
      // while a button is held); it re-arms itself if a press is still recent.
      if (lit && !decay) {
        const fire = () => {
          const t = Date.now();
          setView((v) => ({ ...v, lastSeen: { ...lastSeen.current }, now: t }));
          const recent = Object.values(lastSeen.current).some((x) => t - x.at <= LIT_MS);
          decay = recent ? setTimeout(fire, LIT_MS + 20) : null;
        };
        decay = setTimeout(fire, LIT_MS + 20);
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
 * Did this key come from a controller rather than the TV remote? The screen
 * host's GamepadAdapter marks its synthetic keys; Android's own A→OK / B→Back
 * fallbacks are unmarked, so also treat a key landing within EDGE_WINDOW_MS of
 * a controller button going down as the controller's. Edge-based, never
 * "a button is held": a pad lying on a held button must not lock out the remote.
 */
export function isControllerKey(event) {
  return Boolean(event?.__gamepadSynthetic) || Date.now() - lastPadEdgeAt < EDGE_WINDOW_MS;
}

export const isLit = (seen, now) => Boolean(seen && now - seen.at <= LIT_MS);
