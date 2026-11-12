import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { calibrationFromSamples } from '../../lib/skylineInvaders/aim.js';
import './SkylineInvaders.scss';

// The Ready screen's window: arm-aim calibration folded into the way to the
// countdown. Stand on the mat, reach left, now right; each step finishes by
// itself when the pose is held still, and the last one starts the round.
// Without the camera the shell never comes here (gamepad aim, straight to the
// countdown); with a gamepad connected its panel offers Skip.
// Framing asks for head and shoulders only: at rest the wrists hang below the
// camera frame. No step asks for the arms above the shoulders.

const POLL_MS = 100;
const FRAMING_HOLD_MS = 1000;
const HOLD_SAMPLES = 8;        // 0.8 s of a still reach
const HOLD_TOLERANCE = 0.2;    // shoulder widths the hands may wander while "still" (the pose is unsmoothed)
const SIDE_MIN = 0.4;          // a reach starts this far from the midline, so resting hands are not one
const METER_REACH = 2;         // shoulder widths shown each side of the midline

const STEPS = Object.freeze(['framing', 'left', 'right']);
const TITLES = Object.freeze({ framing: 'Stand on the mat.', left: 'Reach left…', right: '…now right.' });
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round2 = (value) => Math.round(value * 100) / 100;
const cls = (...names) => names.filter(Boolean).join(' ');

// The player as the screen mirrors them: their left is the screen's left.
function Figure({ step }) {
  const side = step === 'left' ? -1 : step === 'right' ? 1 : 0;
  return (
    <svg className="skyline-invaders__figure" viewBox="0 0 200 150" aria-hidden="true">
      <rect x="88" y="14" width="24" height="24" />
      <rect x="76" y="44" width="48" height="60" />
      <rect x="80" y="104" width="16" height="36" />
      <rect x="104" y="104" width="16" height="36" />
      {side === 0
        ? <><rect x="60" y="46" width="12" height="50" /><rect x="128" y="46" width="12" height="50" /></>
        : (
          <g className="skyline-invaders__figure-arms" transform={side < 0 ? undefined : 'translate(200 0) scale(-1 1)'}>
            <rect x="20" y="50" width="62" height="12" />
            <rect x="26" y="68" width="92" height="12" />
            <path d="M 4 65 L 18 52 L 18 78 Z" />
          </g>
        )}
    </svg>
  );
}

/**
 * @param {object} props
 * @param {object} props.tracker      aim tracker: `presence()` and `setCalibration()`
 * @param {{ state: string, error?: string }} props.poseStatus
 * @param {function} props.onDone     (calibration) => void, after the tracker has it
 * @param {string} [props.waveName]
 */
export default function InvadersCalibration({ tracker, poseStatus = null, onDone, waveName = '' }) {
  const log = useMemo(() => getLogger().child({ app: 'fitness', component: 'skyline-invaders-calibration' }), []);
  const [step, setStep] = useState('framing');
  const [view, setView] = useState({ body: false, offset: null, hold: 0 });
  const [message, setMessage] = useState(null);
  const work = useRef({ step: 'framing', bodySince: null, run: [], left: null, attempts: 0, startedAt: Date.now() });
  const live = useRef({});
  live.current = { onDone, tracker };
  const poseState = poseStatus?.state || 'loading';
  const unavailable = poseState === 'camera-denied' || poseState === 'error';

  const goTo = useCallback((next, how) => {
    const w = work.current;
    w.step = next;
    w.run = [];
    w.bodySince = null;
    setStep(next);
    setView((current) => ({ ...current, hold: 0 }));
    log.info('skyline_invaders.lobby.calibration.step', { step: next, how, attempt: w.attempts, elapsedMs: Date.now() - w.startedAt });
  }, [log]);

  // One reach is in hand: move on, or finish when it was the second.
  const capture = useCallback((offset, how) => {
    const w = work.current;
    setMessage(null);
    if (w.step === 'left') { w.left = offset; goTo('right', how); return; }
    const calibration = calibrationFromSamples({ offset: w.left }, { offset });
    if (!calibration) {
      w.attempts += 1;
      log.warn('skyline_invaders.lobby.calibration.too_narrow', { left: round2(w.left), right: round2(offset), attempt: w.attempts });
      setMessage('Reach further apart.');
      goTo('left', 'too-narrow');
      return;
    }
    w.done = true;   // the parent closes this screen; until it does, capture nothing more
    live.current.tracker.setCalibration(calibration);
    log.info('skyline_invaders.lobby.calibrated', {
      left: round2(calibration.left), right: round2(calibration.right), span: round2(calibration.right - calibration.left),
      how, attempts: w.attempts + 1, elapsedMs: Date.now() - w.startedAt,
    });
    live.current.onDone?.(calibration);
  }, [goTo, log]);

  useEffect(() => {
    log.info('skyline_invaders.lobby.calibration.started', { pose: poseState });
    return () => log.debug('skyline_invaders.lobby.calibration.closed', { step: work.current.step });
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  useEffect(() => {
    if (unavailable) return undefined;
    const timer = setInterval(() => {
      const w = work.current;
      if (w.done) return;
      const seen = live.current.tracker.presence();
      const now = Date.now();
      let hold = 0;
      if (w.step === 'framing') {
        w.bodySince = seen.body ? (w.bodySince ?? now) : null;
        hold = w.bodySince === null ? 0 : Math.min(1, (now - w.bodySince) / FRAMING_HOLD_MS);
        if (hold >= 1) { goTo('left', 'auto'); return; }
      } else {
        const onSide = seen.offset !== null && (w.step === 'left' ? seen.offset <= -SIDE_MIN : seen.offset >= SIDE_MIN);
        if (!onSide) w.run = [];
        else {
          w.run.push(seen.offset);
          // Keep the longest recent stretch that stayed within the tolerance.
          while (Math.max(...w.run) - Math.min(...w.run) > HOLD_TOLERANCE) w.run.shift();
        }
        hold = Math.min(1, w.run.length / HOLD_SAMPLES);
        if (w.run.length >= HOLD_SAMPLES) { capture(mean(w.run), 'held'); return; }
      }
      setView((current) => (current.body === seen.body && current.offset === seen.offset && current.hold === hold ? current : { body: seen.body, offset: seen.offset, hold }));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [unavailable, capture, goTo]);

  const copyTitle = TITLES[step];
  const index = STEPS.indexOf(step);
  const dot = view.offset === null ? null : 50 + Math.max(-1, Math.min(1, view.offset / METER_REACH)) * 50;
  const captured = work.current.left === null || step === 'left' ? null : 50 + Math.max(-1, Math.min(1, work.current.left / METER_REACH)) * 50;
  return (
    <div className="skyline-menus skyline-invaders__ready" data-phase="ready" data-testid="skyline-invaders-calibration" data-step={unavailable ? 'unavailable' : step} aria-label="Ready">
      <p className="skyline-menus__kicker">{waveName}</p>
      <div className="skyline-invaders__ready-body">
        <Figure step={step} />
        <div>
          <h1>{copyTitle}</h1>
          <ol className="skyline-invaders__steps" aria-label="Steps">
            {['Stand', 'Left', 'Right'].map((label, i) => (
              <li key={label} className={cls(i < index && 'is-done', i === index && 'is-current')} aria-current={i === index ? 'step' : undefined}>{label}</li>
            ))}
          </ol>
        </div>
      </div>
      {message && <p className="skyline-invaders__ready-alert" role="alert">{message}</p>}
      <div className="skyline-invaders__meter" data-testid="invaders-calibration-meter" data-seen={view.body || view.offset !== null}>
        <div className="skyline-invaders__meter-track">
          {captured !== null && <span className="skyline-invaders__meter-flag" style={{ left: `${captured}%` }} />}
          {dot !== null && <span className="skyline-invaders__meter-dot" style={{ left: `${dot}%` }} />}
        </div>
        <div className="skyline-invaders__meter-hold" role="progressbar" aria-label="Hold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.hold * 100)}>
          <span style={{ width: `${view.hold * 100}%` }} />
        </div>
      </div>
      <p className="skyline-invaders__legend">Point to aim · Step to fire</p>
    </div>
  );
}
