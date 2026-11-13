import React, { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import './SkylineInvaders.scss';

// The Ready screen's window, on the way to the countdown: stand on the mat
// where the camera can see you. Once head and shoulders have been in view for
// a second the round starts by itself. There is nothing to calibrate: every
// aim gesture has a fixed gain, so no reach is measured here.
// Without the camera the shell never comes here (gamepad aim, straight to the
// countdown); with a gamepad connected its panel offers Skip.
// Framing asks for head and shoulders only: at rest the wrists hang below the
// camera frame.

const POLL_MS = 100;
const FRAMING_HOLD_MS = 1000;

// The player as the screen mirrors them, arms at rest.
function Figure() {
  return (
    <svg className="skyline-invaders__figure" viewBox="0 0 200 150" aria-hidden="true">
      <rect x="88" y="14" width="24" height="24" />
      <rect x="76" y="44" width="48" height="60" />
      <rect x="80" y="104" width="16" height="36" />
      <rect x="104" y="104" width="16" height="36" />
      <rect x="60" y="46" width="12" height="50" />
      <rect x="128" y="46" width="12" height="50" />
    </svg>
  );
}

/**
 * @param {object} props
 * @param {object} props.tracker      aim tracker: `presence()`
 * @param {{ state: string, error?: string }} props.poseStatus
 * @param {function} props.onDone     () => void, once the defender is in view
 * @param {string} [props.waveName]
 * @param {string} [props.gesture]    the aim gesture the round will use: its one line of how is the legend
 * @param {boolean} [props.mat]       a step mat is in play: the legend says to step
 */
export default function InvadersReady({ tracker, poseStatus = null, onDone, waveName = '', gesture = null, mat = true }) {
  const log = useMemo(() => getLogger().child({ app: 'fitness', component: 'skyline-invaders-ready' }), []);
  const [view, setView] = useState({ body: false, hold: 0 });
  const work = useRef({ bodySince: null, done: false, startedAt: Date.now() });
  const live = useRef({});
  live.current = { onDone, tracker };
  const poseState = poseStatus?.state || 'loading';
  const unavailable = poseState === 'camera-denied' || poseState === 'error';

  useEffect(() => {
    log.info('skyline_invaders.lobby.ready.started', { pose: poseState, gesture });
    return () => log.debug('skyline_invaders.lobby.ready.closed', { inView: work.current.done });
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  useEffect(() => {
    if (unavailable) return undefined;
    const timer = setInterval(() => {
      const w = work.current;
      if (w.done) return;   // the parent closes this screen
      const seen = live.current.tracker.presence();
      const now = Date.now();
      w.bodySince = seen.body ? (w.bodySince ?? now) : null;
      const hold = w.bodySince === null ? 0 : Math.min(1, (now - w.bodySince) / FRAMING_HOLD_MS);
      if (hold >= 1) {
        w.done = true;
        log.info('skyline_invaders.lobby.ready.in_view', { elapsedMs: now - w.startedAt });
        live.current.onDone?.();
        return;
      }
      setView((current) => (current.body === seen.body && current.hold === hold ? current : { body: seen.body, hold }));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [unavailable, log]);

  const how = GESTURE_INFO[gesture]?.how || null;
  return (
    <div className="skyline-menus skyline-invaders__ready" data-phase="ready" data-testid="skyline-invaders-ready" data-step={unavailable ? 'unavailable' : 'framing'} aria-label="Ready">
      <p className="skyline-menus__kicker">{waveName}</p>
      <div className="skyline-invaders__ready-body">
        <Figure />
        <div>
          <h1>Stand on the mat.</h1>
          {how && <p data-testid="invaders-ready-how">{how}</p>}
        </div>
      </div>
      <div className="skyline-invaders__meter" data-testid="invaders-ready-meter" data-seen={view.body}>
        <div className="skyline-invaders__meter-hold" role="progressbar" aria-label="In view" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.hold * 100)}>
          <span style={{ width: `${view.hold * 100}%` }} />
        </div>
      </div>
      <p className="skyline-invaders__legend">{mat ? 'Step to fire · Keep stepping · Stomp for the bomb' : 'A or Space to fire · B or X for the bomb'}</p>
    </div>
  );
}
