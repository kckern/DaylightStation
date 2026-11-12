import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { calibrationFromSamples } from '../../lib/skylineInvaders/aim.js';
import InvadersActions from './InvadersActions.jsx';
import './SkylineInvaders.scss';

// Arm-aim calibration: stand in view, reach left, reach right. About ten
// seconds, and built so nobody can be stuck in it:
//   - each step finishes by itself when the pose is held still,
//   - each step can also be finished by a press (touch, any key, gamepad A),
//   - Skip is on screen at every step and leaves with gamepad aim.
// Framing asks for head and shoulders only: at rest the wrists hang below the
// camera frame. No step asks for the arms above the shoulders.

const POLL_MS = 100;
const FRAMING_HOLD_MS = 1000;
const HOLD_SAMPLES = 8;        // 0.8 s of a still reach
const HOLD_TOLERANCE = 0.2;    // shoulder widths the hands may wander while "still" (the pose is unsmoothed)
const SIDE_MIN = 0.4;          // a reach starts this far from the midline, so resting hands are not one
const METER_REACH = 2;         // shoulder widths shown each side of the midline

const STEPS = Object.freeze(['framing', 'left', 'right']);
const COPY = Object.freeze({
  framing: { title: 'Stand on the mat and face the screen', body: 'The camera needs to see your head and shoulders.' },
  left: { title: 'Reach both hands to your left and hold still', body: 'As far as is comfortable, at chest height. Hold for one second.' },
  right: { title: 'Now reach both hands to your right and hold still', body: 'As far as is comfortable, at chest height. Hold for one second.' },
});
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
 * @param {function} props.onSkip     leave with gamepad aim
 */
export default function InvadersCalibration({ tracker, poseStatus = null, onDone, onSkip }) {
  const log = useMemo(() => getLogger().child({ component: 'skyline-invaders-calibration' }), []);
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
      setMessage('Reach further apart. Let’s try that again.');
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

  // The press: always does something, and says so when it cannot.
  const pressOn = () => {
    const w = work.current;
    if (w.done) return;
    if (w.step === 'framing') { goTo('left', 'pressed'); return; }
    const offset = w.run.length ? mean(w.run) : live.current.tracker.presence().offset;
    if (offset === null) { setMessage('I can’t see your hands. Hold them out to the side at chest height, then press again.'); return; }
    capture(offset, 'pressed');
  };
  const skip = () => {
    log.info('skyline_invaders.lobby.calibration.skipped', { step: work.current.step, pose: poseState, elapsedMs: Date.now() - work.current.startedAt });
    onSkip?.();
  };

  if (unavailable) {
    return (
      <section className="skyline-invaders__calibration" data-testid="skyline-invaders-calibration" data-step="unavailable" aria-label="Arm aim calibration">
        <h1>Arm aim needs the camera</h1>
        <p role="alert">{`The camera is not available${poseStatus?.error ? ` (${poseStatus.error})` : ''}. You can still play: aim with the gamepad stick or the arrow keys.`}</p>
        <InvadersActions actions={[{ id: 'skip', label: 'Aim with the gamepad', onPress: skip }]} onBack={skip} />
      </section>
    );
  }

  const copy = COPY[step];
  const index = STEPS.indexOf(step);
  const dot = view.offset === null ? null : 50 + Math.max(-1, Math.min(1, view.offset / METER_REACH)) * 50;
  const captured = work.current.left === null || step === 'left' ? null : 50 + Math.max(-1, Math.min(1, work.current.left / METER_REACH)) * 50;
  const status = poseState === 'loading' ? 'Vision engine loading…'
    : step === 'framing' ? (view.body ? 'I can see you. Hold there.' : 'Looking for you…')
      : view.offset === null ? 'Lift your hands into view' : view.hold > 0 ? 'Hold still…' : `Reach to your ${step}`;
  return (
    <section className="skyline-invaders__calibration" data-testid="skyline-invaders-calibration" data-step={step} aria-label="Arm aim calibration">
      <ol className="skyline-invaders__steps" aria-label="Calibration steps">
        {['Stand', 'Left', 'Right'].map((label, i) => (
          <li key={label} className={cls(i < index && 'is-done', i === index && 'is-current')} aria-current={i === index ? 'step' : undefined}>{label}</li>
        ))}
      </ol>
      <div className="skyline-invaders__calibration-body">
        <Figure step={step} />
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          {message && <p className="skyline-invaders__calibration-alert" role="alert">{message}</p>}
        </div>
      </div>
      <div className="skyline-invaders__meter" data-testid="invaders-calibration-meter" data-seen={view.body || view.offset !== null}>
        <div className="skyline-invaders__meter-track">
          {captured !== null && <span className="skyline-invaders__meter-flag" style={{ left: `${captured}%` }} />}
          {dot !== null && <span className="skyline-invaders__meter-dot" style={{ left: `${dot}%` }} />}
        </div>
        <div className="skyline-invaders__meter-hold" role="progressbar" aria-label="Hold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.hold * 100)}>
          <span style={{ width: `${view.hold * 100}%` }} />
        </div>
        <p role="status">{status}</p>
      </div>
      <InvadersActions
        actions={[
          { id: 'continue', label: step === 'framing' ? 'Continue' : 'Use this position', hint: 'Or just hold still', onPress: pressOn },
          { id: 'skip', label: 'Skip — use the gamepad', onPress: skip },
        ]}
        onBack={skip}
      />
      <p className="skyline-invaders__how">Tap a button, press any key, or A on the gamepad. Escape or B skips.</p>
    </section>
  );
}
