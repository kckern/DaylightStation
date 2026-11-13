import React, { useEffect, useState } from 'react';
import { GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import { ActionButton, useActionFocus } from './InvadersActions.jsx';
import { formatClock } from './InvadersHud.jsx';
import './SkylineInvaders.scss';

// The screen before a round: who is shooting, which level, and one clear way
// to begin. Pure presentation: the shell owns every piece of state it shows.
//
// Every control is a button on screen (the garage TV is a touchscreen), and
// the same actions answer to the keyboard, the foot pad, the gamepad and the
// arms-wide hold. Nothing here waits on the camera: with the camera off a
// round starts with gamepad or keyboard aim. With it on, a shooter who has
// not picked their controls yet is sent to the controls intro first.

const cls = (...names) => names.filter(Boolean).join(' ');
const statusOf = (world, id) => (world ? world.levels?.find((item) => item.id === id)?.status || 'open' : 'open');
const bestOf = (world, id) => world?.levels?.find((item) => item.id === id)?.best || null;

/** The level the lobby offers first: the rider's next one on the world map, else the first open one. */
export function defaultLevelId(levels, world) {
  const open = levels.filter((level) => statusOf(world, level.id) !== 'locked');
  return (open.find((level) => level.id === world?.next) || open[0] || levels[0] || null)?.id ?? null;
}

/** The level in play for a choice: the chosen one when it is open, else the default. */
export function resolveLevelId(levels, world, chosenLevelId) {
  const chosen = levels.find((level) => level.id === chosenLevelId);
  return chosen && statusOf(world, chosen.id) !== 'locked' ? chosen.id : defaultLevelId(levels, world);
}

function Stars({ count }) {
  return (
    <span className="skyline-invaders__stars-row" role="img" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((n) => <span key={n} className={cls('skyline-invaders__star', n <= count && 'is-won')} aria-hidden="true">★</span>)}
    </span>
  );
}

const ACCESS_HINTS = Object.freeze({
  incomplete: 'School comes first today',
  indeterminate: 'School check is unsure',
  unavailable: 'School check is offline',
  expired: 'School check ran out',
});

const POLL_MS = 250;
// Is the shooter standing where the camera can see them? Read from the tracker
// a few times a second; the lobby never re-renders at the pose rate.
function useInFrame(tracker, enabled) {
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => {
    if (!enabled || !tracker?.presence) { setInFrame(false); return undefined; }
    const read = () => setInFrame(tracker.presence().body === true);
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [tracker, enabled]);
  return inFrame;
}

function cameraNote(poseStatus, inFrame) {
  const state = poseStatus?.state;
  if (state === 'camera-denied' || state === 'error') return 'Camera off — aim with the gamepad or the arrow keys';
  if (state !== 'detecting') return 'Camera starting… you can start now with gamepad aim';
  return inFrame ? 'The camera can see you' : 'Stand on the mat where the camera can see you';
}

/**
 * @param {object} props
 * @param {object[]} props.levels          validated levels in world order
 * @param {{ levels: object[], next: string|null }|null} props.world   null = every level open
 * @param {string|null} props.chosenLevelId
 * @param {{ id: string, name: string }|null} props.shooter
 * @param {{ id: string, name: string }[]} props.candidates
 * @param {{ equipmentId: string, matId: string }|null} props.mat
 * @param {{ riderId: string, name: string }|null} props.partner
 * @param {{ state: string }} props.poseStatus
 * @param {{ gesture: string }|null} props.controls   the aim gesture this shooter picked, if any
 * @param {{ unlocked: boolean, state: string|null, status?: string }} props.access
 * @param {object} [props.tracker]         aim tracker: enables the arms-wide press
 * @param {boolean} [props.active]         false while a prompt covers the lobby
 * @param {function} [props.onExit]        leave the game; no Exit button without it
 */
export default function InvadersLobby({
  levels, world = null, chosenLevelId = null, onChooseLevel, onRequestUnlock,
  shooter = null, candidates = [], onPickShooter,
  mat = null, partner = null, poseStatus = null, controls = null, onPickControls,
  access = { unlocked: true, state: null }, onRequestAdmin, onStart,
  tracker = null, active = true, onExit,
}) {
  const [changing, setChanging] = useState(false);
  useEffect(() => { setChanging(false); }, [shooter?.id]);
  const picking = !shooter || changing;
  const currentId = resolveLevelId(levels, world, chosenLevelId);
  const open = levels.filter((level) => statusOf(world, level.id) !== 'locked');
  const poseState = poseStatus?.state || 'loading';
  const cameraOff = poseState === 'camera-denied' || poseState === 'error';
  const inFrame = useInFrame(tracker, poseState === 'detecting');
  const chosen = GESTURE_INFO[controls?.gesture] ? controls.gesture : null;

  const start = { id: 'start', label: 'Start', onPress: () => onStart?.() };
  let main;
  if (!shooter) main = [{ ...start, disabled: true, hint: 'Pick who is shooting' }];
  else if (access.status === 'loading') main = [{ ...start, disabled: true, hint: 'Checking school…' }];
  else if (!access.unlocked) main = [{ id: 'admin', label: 'Ask a grown-up', hint: ACCESS_HINTS[access.state] || 'Locked for now', onPress: () => onRequestAdmin?.() }];
  else if (cameraOff) main = [{ ...start, hint: 'Gamepad or arrow keys aim' }];
  else if (chosen) main = [start, { id: 'controls', label: 'Change controls', hint: GESTURE_INFO[chosen].label, onPress: () => onPickControls?.() }];
  // No controls picked yet: with the camera up the intro comes first; while it
  // is still starting, a round can begin on gamepad aim.
  else if (poseState === 'detecting') main = [{ id: 'controls', label: 'Pick your controls', hint: 'Try each one, then choose', onPress: () => onPickControls?.() }];
  else main = [{ ...start, hint: 'Gamepad aim until the camera is ready' }];

  const people = picking ? candidates.map((person) => ({ id: `pick-${person.id}`, label: person.name, onPress: () => { setChanging(false); onPickShooter?.(person.id); } })) : [];
  // While a shooter is being picked the names come first: they are what the next press should choose.
  const actions = [
    ...people, ...main,
    ...(!picking && candidates.length > 1 ? [{ id: 'change-shooter', label: 'Change shooter', onPress: () => setChanging(true) }] : []),
    ...(onExit ? [{ id: 'exit', label: 'Exit', hint: 'Leave the game', onPress: () => onExit('button') }] : []),
  ];

  const moveLevel = (direction) => {
    const at = open.findIndex((level) => level.id === currentId);
    const next = open[at + (direction === 'right' ? 1 : -1)];
    if (next) onChooseLevel?.(next.id);
  };
  const { focused, hold, press } = useActionFocus({
    actions, active, axis: 'column', tracker: picking ? null : tracker,
    onOther: moveLevel,
    // Back steps out of the shooter picker first, then out of the game.
    onBack: () => { if (changing) setChanging(false); else onExit?.('back'); },
  });
  const button = (action) => {
    const index = actions.indexOf(action);
    return <ActionButton key={action.id} action={action} primary={action === main[0]} focused={index === focused} hold={index === 0 ? hold : 0} onPress={() => press(index)} />;
  };
  const handsFree = !picking && !!tracker && poseState === 'detecting' && !main[0].disabled;
  const aimHow = cameraOff || !chosen ? (cameraOff ? 'Aim with the gamepad stick or the arrow keys.' : 'Pick how you want to aim, then defend the city.') : GESTURE_INFO[chosen].how;
  const fireHow = mat ? 'Step on the mat to fire, and keep stepping to keep firing.' : 'Press A or Space to fire.';

  return (
    <section className="skyline-invaders__lobby" data-testid="skyline-invaders-lobby" aria-label="Skyline Invaders lobby">
      <header className="skyline-invaders__lobby-head">
        <h1>Skyline Invaders</h1>
        {/* Only what these players can do right now: no arm aim without a camera, no mat step without a mat. */}
        <p data-testid="invaders-howto">
          {`${aimHow} ${fireHow}`}
        </p>
      </header>

      <ol className="skyline-invaders__levels" aria-label="Levels">
        {levels.map((level) => {
          const status = statusOf(world, level.id);
          const locked = status === 'locked';
          const best = bestOf(world, level.id);
          return (
            <li key={level.id}>
              <button
                type="button"
                className={cls('skyline-invaders__level', level.id === currentId && 'is-chosen', locked && 'is-locked')}
                aria-pressed={level.id === currentId}
                data-level={level.id}
                data-status={status}
                onClick={(event) => { event.currentTarget.blur(); if (locked) onRequestUnlock?.(level); else onChooseLevel?.(level.id); }}
              >
                <b>{level.name}</b>
                {locked
                  ? <span className="skyline-invaders__level-goal">Locked — a grown-up can open it</span>
                  : <span className="skyline-invaders__level-goal">{`${level.pass.kills} to shoot down in ${formatClock(level.duration_s)}`}</span>}
                {!locked && <Stars count={best?.stars || 0} />}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="skyline-invaders__crew">
        <p className="skyline-invaders__crew-line" data-testid="invaders-shooter">
          <span>Shooter</span>
          <b>{shooter ? shooter.name : 'Nobody yet'}</b>
        </p>
        {partner && (
          <p className="skyline-invaders__crew-line" data-testid="invaders-partner">
            <span>Boost partner</span>
            <b>{partner.name}</b>
          </p>
        )}
        {chosen && !cameraOff && (
          <p className="skyline-invaders__crew-line" data-testid="invaders-controls-chosen">
            <span>Controls</span>
            <b>{GESTURE_INFO[chosen].label}</b>
          </p>
        )}
        <p className="skyline-invaders__crew-note" role="status" data-testid="invaders-camera-note">{cameraNote(poseStatus, inFrame)}</p>
        {!mat && <p className="skyline-invaders__crew-note" role="status">No step mat found — fire with the gamepad or Space</p>}
      </div>

      {picking && (
        <div className="skyline-invaders__picker" role="group" aria-label="Who is shooting?">
          <h2>Who is shooting?</h2>
          <div className="skyline-invaders__actions">{people.map(button)}</div>
          {!people.length && <p role="status">Nobody is in the session yet. Join the workout first.</p>}
        </div>
      )}

      <div className="skyline-invaders__actions skyline-invaders__actions--lobby">
        {actions.filter((action) => !people.includes(action)).map(button)}
      </div>
      <p className="skyline-invaders__how">
        {`Tap a button, press any key, or A on the gamepad. Up and down move between the buttons.${open.length > 1 ? ' Left and right change the level.' : ''}${handsFree ? ` Or hold both arms straight out to your sides for ${main[0].label}.` : ''}${onExit ? ' Escape or B leaves the game.' : ''}`}
      </p>
    </section>
  );
}
