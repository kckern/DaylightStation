import React from 'react';
import SkylineAvatar from '../SkylineGlider/SkylineAvatar.jsx';
import GameSoundSheet from '../SkylineGlider/GameSoundSheet.jsx';
import { FlightList } from '../SkylineGlider/SkylineMenus.jsx';
import { PixelIcon, iconForSymbol } from '../SkylineGlider/SkylinePixelIcons.jsx';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';
import { STOMP_HINT } from '../../lib/skylineInvaders/invadersPanel.js';

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
 * that the mat does the same (STOMP_HINT), the rest stay as the title.
 */
export function InvadersTouchKeys({ keys = [], onPress }) {
  if (!keys.length) return null;
  return (
    <div className="skyline-invaders__keys" role="group" aria-label="Actions" data-testid="invaders-keys">
      {keys.map((key) => (
        <button
          key={key.position} type="button" className="skyline-invaders__key" data-position={key.position}
          disabled={key.disabled} title={key.hint || undefined} onClick={() => onPress?.(key.position)}
        >
          {iconForSymbol(key.icon) && <span className="skyline-invaders__key-icon" aria-hidden="true"><PixelIcon name={iconForSymbol(key.icon)} /></span>}
          <strong>{key.label}</strong>
          {key.hint === STOMP_HINT && <small>{key.hint}</small>}
        </button>
      ))}
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
