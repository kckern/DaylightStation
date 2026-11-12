import React from 'react';
import SkylineAvatar from '../SkylineGlider/SkylineAvatar.jsx';
import GameSoundSheet from '../SkylineGlider/GameSoundSheet.jsx';
import { FlightList } from '../SkylineGlider/SkylineMenus.jsx';
import { PixelIcon } from '../SkylineGlider/SkylinePixelIcons.jsx';
import PixelSprite from '../../../../../../__capabilities/gaming/browser/platform/ui/PixelSprite.jsx';
import { INVADER_SPRITES } from '../../lib/skylineInvaders/sprites.js';

// The window half of every Skyline Invaders menu screen: one decision each, in
// Skyline Glider's window (`.skyline-menus`). The bike-button panel beside it
// is the shell's (SkylineControlPanel, lib/skylineInvaders/invadersPanel.js).
// No instructions in prose: the panel says what each button does.

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
        <h1>Who’s shooting?</h1>
        <p>{props.riders?.length ? 'Hold a button for other riders.' : 'Nobody is riding yet. Hold a button for other riders.'}</p>
      </Window>
    );
  }
  if (screen === 'roster') {
    const person = props.person;
    return (
      <Window screen="roster">
        <h1>Other riders</h1>
        {person && <div className="skyline-menus__person"><SkylineAvatar src={person.avatarSrc} name={person.name} /><strong>{person.name}</strong></div>}
      </Window>
    );
  }
  if (screen === 'waves') {
    const rows = props.rows || [];
    const selected = rows.find((row) => row.id === props.selectedId) || null;
    return (
      <Window screen="waves">
        <p className="skyline-menus__kicker">{`${props.shooterName} is shooting`}</p>
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
