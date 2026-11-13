import React from 'react';
import { PixelIcon } from './SkylinePixelIcons.jsx';
import { TouchVolumeButtons } from '../../../../../../__capabilities/playback/browser/volume/TouchVolumeButtons.jsx';

/**
 * The body of a fitness game's Sound sheet: a readout, the house touch volume
 * strip (11 keys, 0 = off -- never a slider on the garage touch screen) and a
 * mute key. Shared by Skyline Glider and Skyline Invaders; each game frames it
 * in its own window and styles it under its own `classPrefix`
 * (`<prefix>__readout`, `<prefix>__volume`, `<prefix>__mute`).
 *
 * The level is the useGameVolume() button level (0..100); `onLevel` gets the
 * level a key was tapped for. `showMute={false}` leaves the mute key to a game
 * that draws it among its own actions.
 */
export default function GameSoundSheet({
  level, muted, onLevel, onToggleMute,
  classPrefix = 'skyline-menus', testIdPrefix = 'skyline-sound', controlId = 'game-volume', showMute = true,
}) {
  const shown = Number.isFinite(level) ? level : 0;
  return <>
    <strong className={`${classPrefix}__readout`} data-testid={`${testIdPrefix}-readout`} data-muted={muted || undefined}>
      <PixelIcon name="sound"/>{muted ? 'Muted' : `Volume ${shown}`}
    </strong>
    <div className={`${classPrefix}__volume`}>
      <TouchVolumeButtons controlId={controlId} currentLevel={muted ? 0 : shown} onSelect={(next) => onLevel?.(next)}/>
    </div>
    {showMute && <button type="button" className={`${classPrefix}__mute`} aria-pressed={!!muted} onClick={() => onToggleMute?.()}>{muted ? 'Unmute' : 'Mute'}</button>}
  </>;
}
