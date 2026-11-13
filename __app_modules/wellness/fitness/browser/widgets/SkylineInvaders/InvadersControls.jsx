import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGameState } from '../../lib/skylineInvaders/engine.js';
import { GESTURES, GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import { laneAim } from '../../lib/skylineInvaders/lanes.js';
import { advanceTryout, createTryout, tryoutSummary, tryoutTargets } from '../../lib/skylineInvaders/tryout.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import GestureDemo from './GestureDemo.jsx';
import { ActionButton, useActionFocus } from './InvadersActions.jsx';
import InvadersScene from './InvadersScene.jsx';
import './SkylineInvaders.scss';

// Pick your controls: the eight aim gestures, one card at a time. Each card
// shows the movement (GestureDemo), says it in one line, and lets the child
// try it at once: the real cannon follows them with that gesture, and three
// practice targets (left edge, middle, right edge) light when the cannon is
// under them. Nothing falls and nothing is scored.
//
// Hands-free: a step on the mat is the next card, a stomp picks this one.
// Every control is also a button on screen, with the keyboard, the foot pad
// and the gamepad on the same buttons. A card moves on by itself after
// `tryoutCardS`, so eight cards cannot take five minutes.
//
// The three targets are the same for every gesture, so the time to reach each
// one (logged per card by the shell) compares the gestures directly.

const TRYOUT_LEVEL = Object.freeze({ id: 'controls-tryout', duration_s: 60, cannons: 1, pass: { kills: 1, base_hp_min: 0 }, waves: [{ at: 0, spawn: { meteor: 1 }, rate_s: 60 }] });
const POLL_MS = 50;

/**
 * @param {object} props
 * @param {object} props.tracker            the game's aim tracker; this screen switches its gesture card by card
 * @param {string|null} props.current       the gesture the shooter already has, if any
 * @param {{ name: string }|null} props.shooter
 * @param {{ state: string }} props.poseStatus
 * @param {string|null} props.matId         the shooter mat's hardware id: step = next card, stomp = pick
 * @param {function} props.subscribeToAppEvent
 * @param {function} props.onChoose         (gesture, how) the shooter picked this card
 * @param {function} props.onClose          left without picking
 * @param {function} [props.onTryout]       (summary) one card's tryout ended (tryout.js tryoutSummary)
 * @param {function} [props.onCard]         (gesture, index) a card opened
 * @param {function} [props.onTick]         ({ at, lane, tryout }) every poll, for the trace recorder
 * @param {boolean} [props.active]          false while a prompt covers the screen
 */
export default function InvadersControls({
  tracker, current = null, shooter = null, poseStatus = null, matId = null, subscribeToAppEvent,
  onChoose, onClose, onTryout, onCard, onTick, active = true, tunables = INVADERS_TUNABLES,
}) {
  const start = Math.max(0, GESTURES.indexOf(current));
  const [index, setIndex] = useState(start);
  const [view, setView] = useState(() => ({ tryout: createTryout(GESTURES[start], Date.now()), lane: tracker.sample().lane, lost: true, leftS: tunables.tryoutCardS }));
  const tryoutRef = useRef(view.tryout);
  const idle = useMemo(() => createGameState(TRYOUT_LEVEL, { seed: 1 }), []);
  const gesture = GESTURES[index];
  const live = useRef({});
  live.current = { index, onChoose, onClose, onTryout, onCard, onTick };

  // Close out the card in hand, with how it ended.
  const finish = useCallback((how) => {
    live.current.onTryout?.(tryoutSummary(tryoutRef.current, Date.now(), how));
  }, []);
  const go = useCallback((delta, how) => {
    finish(how);
    setIndex((at) => (at + delta + GESTURES.length) % GESTURES.length);
  }, [finish]);
  const choose = useCallback((how) => {
    finish(`chosen-${how}`);
    live.current.onChoose?.(GESTURES[live.current.index], how);
  }, [finish]);
  const close = useCallback(() => { finish('closed'); live.current.onClose?.(); }, [finish]);

  // A card opens: the tracker takes its gesture and the tryout starts over.
  useEffect(() => {
    tracker.setGesture(gesture);
    const opened = Date.now();
    tryoutRef.current = createTryout(gesture, opened);
    setView({ tryout: tryoutRef.current, lane: tracker.sample().lane, lost: tracker.sample().lost, leftS: tunables.tryoutCardS });
    live.current.onCard?.(gesture, index);
    let timedOut = false;
    const timer = setInterval(() => {
      if (timedOut) return;
      const at = Date.now();
      const sample = tracker.sample();
      const next = advanceTryout(tryoutRef.current, sample.lane, at, { holdMs: tunables.tryoutTargetHoldMs });
      tryoutRef.current = next;
      live.current.onTick?.({ at, lane: sample.lane, tryout: next });
      const leftS = Math.max(0, Math.ceil(tunables.tryoutCardS - (at - opened) / 1000));
      setView((prior) => (prior.lane === sample.lane && prior.lost === sample.lost && prior.leftS === leftS && prior.tryout.on === next.on && prior.tryout.reached === next.reached
        ? prior : { tryout: next, lane: sample.lane, lost: sample.lost, leftS }));
      if (at - opened >= tunables.tryoutCardS * 1000) { timedOut = true; go(1, 'timeout'); }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [gesture, index, tracker, tunables, go]);

  // The mat: step = next card, stomp = this one.
  useEffect(() => {
    if (!active || !matId || !subscribeToAppEvent) return undefined;
    const wanted = String(matId);
    const mine = (event) => String(event?.payload?.id ?? event?.source) === wanted;
    const stops = [
      subscribeToAppEvent('pressure-mat:step', (event) => { if (mine(event)) go(1, 'step'); }),
      subscribeToAppEvent('pressure-mat:stomp', (event) => { if (mine(event)) choose('stomp'); }),
    ];
    return () => stops.forEach((stop) => stop?.());
  }, [active, matId, subscribeToAppEvent, go, choose]);

  const info = GESTURE_INFO[gesture];
  const actions = [
    { id: 'choose', label: 'Use these controls', hint: info.label, onPress: () => choose('button') },
    { id: 'next', label: 'Next', hint: GESTURE_INFO[GESTURES[(index + 1) % GESTURES.length]].label, onPress: () => go(1, 'button') },
    { id: 'back', label: 'Back', hint: GESTURE_INFO[GESTURES[(index - 1 + GESTURES.length) % GESTURES.length]].label, onPress: () => go(-1, 'button') },
    { id: 'close', label: current ? `Keep ${GESTURE_INFO[current]?.label || 'mine'}` : 'Not now', onPress: close },
  ];
  const { focused, press } = useActionFocus({
    actions, active, axis: 'row', onBack: close,
    // Up and down turn the cards, so the row's own arrows can stay on the buttons.
    onOther: (direction) => go(direction === 'down' ? 1 : -1, 'key'),
  });
  const camera = poseStatus?.state;
  const cameraNote = camera === 'camera-denied' || camera === 'error'
    ? 'The camera is off, so the cannon cannot follow you here.'
    : camera !== 'detecting' ? 'The camera is starting…' : view.lost ? 'Stand on the mat where the camera can see you.' : null;
  const reached = Object.keys(view.tryout.reached).length;

  return (
    <section className="skyline-invaders__controls" data-testid="skyline-invaders-controls" data-gesture={gesture} data-card={index} aria-label="Pick your controls">
      <InvadersScene state={idle} level={TRYOUT_LEVEL} aim={laneAim(view.lane)} targets={tryoutTargets(view.tryout)} live />
      <div className="skyline-invaders__controls-card">
        <GestureDemo gesture={gesture} />
        <div className="skyline-invaders__controls-text">
          <p className="skyline-invaders__controls-step">{`${shooter?.name ? `${shooter.name}: pick` : 'Pick'} your controls · ${index + 1} of ${GESTURES.length}`}</p>
          <h1 data-testid="invaders-controls-name">{info.label}</h1>
          <p className="skyline-invaders__controls-how" data-testid="invaders-controls-how">{info.how}</p>
          <p className="skyline-invaders__controls-task" role="status" data-testid="invaders-controls-task">
            {cameraNote || (reached === 3 ? 'All three lit!' : `Light the three targets: ${reached} of 3`)}
          </p>
          <div className="skyline-invaders__controls-timer" role="timer" aria-label={`${view.leftS} seconds left on this card`}>
            <span style={{ width: `${(100 * view.leftS) / tunables.tryoutCardS}%` }} />
          </div>
        </div>
        <ol className="skyline-invaders__controls-dots" aria-hidden="true">
          {GESTURES.map((id, i) => <li key={id} className={i === index ? 'is-current' : id === current ? 'is-mine' : undefined} />)}
        </ol>
      </div>
      <div className="skyline-invaders__controls-foot">
        <p className="skyline-invaders__how" data-testid="invaders-controls-keys">
          {`${matId ? 'STEP on the mat for the next one. STOMP to pick this one. ' : ''}Or tap a button, press any key, or A on the gamepad. Up and down change the card.`}
        </p>
        <div className="skyline-invaders__actions">
          {actions.map((action, i) => <ActionButton key={action.id} action={action} primary={i === 0} focused={i === focused} onPress={() => press(i)} />)}
        </div>
      </div>
    </section>
  );
}
