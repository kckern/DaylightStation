import React from 'react';
import SkylineAvatar from '../SkylineGlider/SkylineAvatar.jsx';
import GameSoundSheet from '../SkylineGlider/GameSoundSheet.jsx';
import { FlightList } from '../SkylineGlider/SkylineMenus.jsx';
import { PixelIcon, iconForSymbol } from '../SkylineGlider/SkylinePixelIcons.jsx';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';
import { GESTURE_INFO } from '../../lib/skylineInvaders/gestures.js';
import { MANUAL_METHOD, SETUP_METHODS, SETUP_STEPS, setupStepId, setupStepsView } from '../../lib/skylineInvaders/setupTest.js';
import { DRAWN_HINTS } from '../../lib/skylineInvaders/invadersPanel.js';
import GestureDemo from './GestureDemo.jsx';

// Every Skyline Invaders menu screen: one decision each, in Skyline Glider's
// window (`.skyline-menus`). Invaders is a touch-screen game played standing on
// the mat: people are tapped on their own tiles and each screen's actions are
// solid keys in the window (InvadersTouchKeys). The keyboard, gamepad and mat
// reach the same actions through lib/skylineInvaders/invadersPanel.js. No
// instructions in prose: the keys say what they do.

const LOCK_REASONS = Object.freeze({
  incomplete: 'Finish today’s school work to unlock.',
  expired: 'Finish today’s school work to unlock.',
  indeterminate: 'Today’s school work can’t be checked right now. A grown-up can unlock.',
  unavailable: 'The school check is offline. A grown-up can unlock.',
});
const PAUSE_REASONS = Object.freeze({
  player: 'The clock is stopped.',
  lifecycle: 'The workout is paused. The clock is stopped.',
  hidden: 'The screen was away. The clock is stopped.',
});

/** Three stars: won ones gold, the rest solid and dark (never faded). */
export function StarRow({ count = 0, className = '' }) {
  return (
    <span className={`skyline-invaders__star-row ${className}`.trim()} role="img" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((n) => <span key={n} className="skyline-invaders__star" data-won={n <= count}><PixelIcon name="star" /></span>)}
    </span>
  );
}

/**
 * A screen's actions as touch keys. `keys` come from invadersControls; blanks
 * are left out. A key says what it does in its label; the only hint drawn is
 * that the mat does the same (DRAWN_HINTS), the rest stay as the title.
 */
export function InvadersTouchKeys({ keys = [], onPress }) {
  if (!keys.length) return null;
  // The screen's decision is the row of four; Controls and Exit (positions 5
  // and 6) are a second, smaller row under it, so six keys never share a row.
  const main = keys.filter((key) => key.position <= 4);
  const extra = keys.filter((key) => key.position > 4);
  const button = (key) => (
    <button
      key={key.position} type="button" className="skyline-invaders__key" data-position={key.position}
      disabled={key.disabled} title={key.hint || undefined} onClick={() => onPress?.(key.position)}
    >
      {iconForSymbol(key.icon) && <span className="skyline-invaders__key-icon" aria-hidden="true"><PixelIcon name={iconForSymbol(key.icon)} /></span>}
      <strong>{key.label}</strong>
      {DRAWN_HINTS.includes(key.hint) && <small>{key.hint}</small>}
    </button>
  );
  return (
    <div className="skyline-invaders__keyboard" role="group" aria-label="Actions" data-testid="invaders-keys">
      {main.length > 0 && <div className="skyline-invaders__keys">{main.map(button)}</div>}
      {extra.length > 0 && <div className="skyline-invaders__keys skyline-invaders__keys--extra">{extra.map(button)}</div>}
    </div>
  );
}

/** People as tiles to tap: avatar and name. `cursorId` marks the keyboard/gamepad cursor. */
function PeopleTiles({ people = [], cursorId = null, onPick, extra = null }) {
  return (
    <div className="skyline-invaders__people" role="group" aria-label="People">
      {people.map((person) => (
        <button
          key={person.id} type="button" className="skyline-invaders__person" data-testid={`invaders-person-${person.id}`}
          aria-pressed={person.id === cursorId} onClick={() => onPick?.(person.id)}
        >
          <SkylineAvatar src={person.avatarSrc} name={person.name} />
          <strong>{person.name}</strong>
        </button>
      ))}
      {extra}
    </div>
  );
}

function Window({ screen, children }) {
  // (The shell's <main> is `skyline-invaders-loading` while loading.)
  return <div className="skyline-menus" data-phase={screen} data-testid={screen === 'loading' ? undefined : `skyline-invaders-${screen}`}>{children}</div>;
}

/**
 * @param {object} props
 * @param {string} props.screen
 */
export default function InvadersMenus(props) {
  const { screen } = props;
  if (screen === 'who') {
    return (
      <Window screen="who">
        <h1>Who’s defending?</h1>
        {!props.riders?.length && <p>Nobody is in the workout yet.</p>}
        <PeopleTiles
          people={props.riders} onPick={props.onPick}
          extra={(
            <button type="button" className="skyline-invaders__person skyline-invaders__person--more" data-testid="invaders-person-more" onClick={() => props.onSomeoneElse?.()}>
              <span className="skyline-invaders__person-icon" aria-hidden="true"><PixelIcon name="rider" /></span>
              <strong>Someone else</strong>
            </button>
          )}
        />
      </Window>
    );
  }
  if (screen === 'roster') {
    return (
      <Window screen="roster">
        <h1>Pick the defender</h1>
        <PeopleTiles people={props.everyone} cursorId={props.person?.id || null} onPick={props.onPick} />
      </Window>
    );
  }
  if (screen === 'waves') {
    const rows = props.rows || [];
    const selected = rows.find((row) => row.id === props.selectedId) || null;
    return (
      <Window screen="waves">
        <p className="skyline-menus__kicker">{`${props.shooterName} is defending`}</p>
        <h1>Pick a wave</h1>
        <FlightList
          testIdPrefix="invaders"
          rows={rows.map((row) => ({
            id: row.id, name: row.name, status: row.status,
            status_label: row.status === 'locked'
              ? <><PixelIcon name="lock" />Locked</>
              : row.status === 'completed' ? <><StarRow count={row.stars} />Done</> : 'New',
          }))}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
        />
        {selected && (
          <p className="skyline-invaders__wave-detail" data-testid="invaders-wave-detail">
            {selected.introduces.map((type) => INVADER_SPRITES[type] && <PixelSprite key={type} grid={INVADER_SPRITES[type].frames[0]} className={`skyline-invaders__wave-threat skyline-invaders__threat--${type}`} />)}
            <span>{selected.status === 'locked' ? 'A grown-up can unlock this wave.' : selected.detail}</span>
          </p>
        )}
      </Window>
    );
  }
  if (screen === 'method') return <MethodScreen {...props} />;
  if (screen === 'sweep') return <SweepScreen {...props} />;
  if (screen === 'locked') {
    return (
      <Window screen="locked">
        {props.blockedNames?.length > 0 && <p className="skyline-menus__kicker" data-testid="invaders-locked-for">{`School first: ${props.blockedNames.join(', ')}`}</p>}
        <h1>Round locked</h1>
        <p>{LOCK_REASONS[props.state] || LOCK_REASONS.incomplete}</p>
      </Window>
    );
  }
  if (screen === 'paused') {
    return (
      <Window screen="paused">
        <p className="skyline-menus__kicker">{props.waveName}</p>
        <h1>Paused</h1>
        <p>{PAUSE_REASONS[props.reason] || PAUSE_REASONS.player}</p>
      </Window>
    );
  }
  if (screen === 'sound') {
    return (
      <Window screen="sound">
        <h1>Sound</h1>
        <GameSoundSheet
          level={props.sound.level} muted={props.sound.muted} onLevel={props.sound.onLevel} onToggleMute={props.sound.onToggleMute}
          testIdPrefix="skyline-invaders-sound" controlId="skyline-invaders-volume"
        />
      </Window>
    );
  }
  if (screen === 'error') {
    return (
      <Window screen="error">
        <h1>Skyline Invaders</h1>
        <p role="alert">{props.error}</p>
      </Window>
    );
  }
  return (
    <Window screen="loading">
      <h1>Skyline Invaders</h1>
    </Window>
  );
}

// ── The setup ────────────────────────────────────────────────────────────────
const methodLabel = (method) => (method === MANUAL_METHOD ? 'Gamepad' : GESTURE_INFO[method]?.label || '');
const CAMERA_NOTES = Object.freeze({
  off: 'The camera is off. Aim with the gamepad.',
  starting: 'The camera is starting…',
});

/** A gamepad in pixels, for the method that needs no camera. */
function GamepadGlyph() {
  return (
    <svg className="skyline-invaders__method-pad" viewBox="0 0 24 14" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="2" y="2" width="20" height="10" />
      <rect className="skyline-invaders__method-pad-key" x="5" y="6" width="6" height="2" />
      <rect className="skyline-invaders__method-pad-key" x="7" y="4" width="2" height="6" />
      <rect className="skyline-invaders__method-pad-key" x="15" y="4" width="2" height="2" />
      <rect className="skyline-invaders__method-pad-key" x="18" y="7" width="2" height="2" />
    </svg>
  );
}

/**
 * Choose how you aim: every aim gesture and the gamepad, as tiles to tap. The
 * defender's own method is marked. Choosing a gesture goes to its test sweep;
 * the gamepad needs none. The mat does nothing here.
 */
function MethodScreen({ setup = {}, shooterName = '', onMethod }) {
  // `setup.cursor` is null under touch: a gold tile would read as already chosen.
  const cameraOff = setup.camera === 'off';
  return (
    <Window screen="method">
      <p className="skyline-menus__kicker">{shooterName ? `${shooterName}: how do you aim?` : 'How do you aim?'}</p>
      <h1>Choose your controls</h1>
      <div className="skyline-invaders__methods" role="group" aria-label="Controls">
        {SETUP_METHODS.map((method, index) => {
          const gesture = method !== MANUAL_METHOD;
          return (
            <button
              key={method} type="button" className="skyline-invaders__method" data-testid={`invaders-method-${method}`} data-method={method}
              aria-pressed={index === setup.cursor} data-current={method === setup.current || undefined}
              disabled={gesture && cameraOff} onClick={() => onMethod?.(method)}
            >
              <span className="skyline-invaders__method-art" aria-hidden="true">{gesture ? <GestureDemo gesture={method} /> : <GamepadGlyph />}</span>
              <strong>{methodLabel(method)}</strong>
              {method === setup.current && <small className="skyline-invaders__method-yours">Yours</small>}
            </button>
          );
        })}
      </div>
      {CAMERA_NOTES[setup.camera] && <p className="skyline-invaders__setup-note" role="status" data-testid="invaders-setup-note">{CAMERA_NOTES[setup.camera]}</p>}
    </Window>
  );
}

/**
 * The test sweep: go left, go right, stomp. Each step is ticked only when it is
 * detected; the real cannon follows the defender on the two edge targets
 * behind this window. A step not detected in time says so, and the keys offer
 * Try again or Choose another.
 */
function SweepScreen({ setup = {}, shooterName = '' }) {
  const test = setup.test;
  const method = test?.gesture || setup.method;
  const info = GESTURE_INFO[method] || {};
  const status = test?.status || 'running';
  const current = SETUP_STEPS.find((step) => step.id === setupStepId(test)) || SETUP_STEPS[0];
  const fireLabel = setup.mat ? 'Stomp to fire' : 'Press fire';
  const label = (step) => (step.id === 'fire' ? fireLabel : step.label);
  let headline = label(current);
  let line = current.id === 'fire' ? (setup.mat ? 'Stomp the mat.' : 'Press A or Space.') : current.how;
  if (status === 'passed') { headline = 'It works!'; line = setup.from === 'start' ? 'Here comes the wave.' : 'These are your controls now.'; }
  else if (status === 'timeout') { headline = 'Not detected'; line = `${label(current)} did not register. Try again, or choose another.`; }
  else if (setup.camera !== 'on') line = CAMERA_NOTES[setup.camera];
  else if (setup.lost && current.id !== 'fire') line = 'Stand where the camera can see you.';
  return (
    <Window screen="sweep">
      <p className="skyline-menus__kicker">{`${shooterName ? `${shooterName} · ` : ''}Test: ${info.label || ''}`}</p>
      <div className="skyline-invaders__sweep-body" data-status={status} data-step={current.id}>
        <GestureDemo gesture={method} />
        <div className="skyline-invaders__sweep-text">
          <h1 data-testid="invaders-sweep-headline">{headline}</h1>
          <p className="skyline-invaders__sweep-line" role="status" data-testid="invaders-sweep-line">{line}</p>
          <p className="skyline-invaders__sweep-how" data-testid="invaders-sweep-how">{info.how}</p>
          <ol className="skyline-invaders__sweep-steps" data-testid="invaders-sweep-steps">
            {setupStepsView(test).map((step, index) => (
              <li key={step.id} data-state={step.state} data-testid={`invaders-sweep-step-${step.id}`}>
                <span className="skyline-invaders__sweep-mark" aria-hidden="true">
                  {step.state === 'done' ? <PixelIcon name="check" /> : step.state === 'failed' ? <PixelIcon name="cross" /> : index + 1}
                </span>
                <span>{label(SETUP_STEPS[index])}</span>
              </li>
            ))}
          </ol>
          {status === 'running' && (
            <div className="skyline-invaders__controls-timer" role="timer" aria-label={`${setup.leftS ?? 0} seconds left`}>
              <span style={{ width: `${Math.max(0, Math.min(100, (100 * (setup.leftS ?? 0)) / (setup.timeoutS || 15)))}%` }} />
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}
