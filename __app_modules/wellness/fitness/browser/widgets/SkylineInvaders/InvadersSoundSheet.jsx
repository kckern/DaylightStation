import React from 'react';
import GameSoundSheet from '../SkylineGlider/GameSoundSheet.jsx';
import { ActionButton, useActionFocus } from './InvadersActions.jsx';

/**
 * The Sound sheet: the game's own volume (useGameVolume('skyline-invaders')).
 * Touch: the shared strip from Skyline Glider. Keys, foot pad and gamepad: a
 * row of actions with Back focused first, so a stray foot-pad press only
 * closes the sheet. The bike buttons (handled by the shell) step the same
 * level, and each action says which bike button does it.
 */
export default function InvadersSoundSheet({ level, muted, onLevel, onStep, onToggleMute, onBack, active = true, tracker = null }) {
  const actions = [
    { id: 'back', label: 'Back', hint: 'Bike button 3', onPress: () => onBack?.('touch') },
    { id: 'quieter', label: 'Quieter', hint: 'Bike button 1', disabled: muted || level <= 0, onPress: () => onStep?.(-10) },
    { id: 'louder', label: 'Louder', hint: 'Bike button 2', disabled: level >= 100 && !muted, onPress: () => onStep?.(10) },
    { id: 'mute', label: muted ? 'Unmute' : 'Mute', hint: 'Bike button 4', onPress: () => onToggleMute?.() },
  ];
  const { focused, hold, press } = useActionFocus({ actions, active, axis: 'row', onBack: () => onBack?.('key'), tracker });
  return (
    <section className="skyline-invaders__sound" data-testid="skyline-invaders-sound" aria-label="Sound">
      <h1>Sound</h1>
      <GameSoundSheet
        level={level} muted={muted} onLevel={onLevel} onToggleMute={onToggleMute} showMute={false}
        classPrefix="skyline-invaders" testIdPrefix="skyline-invaders-sound" controlId="skyline-invaders-volume"
      />
      <div className="skyline-invaders__actions">
        {actions.map((action, index) => (
          <ActionButton key={action.id} action={action} primary={index === 0} focused={index === focused} hold={index === 0 ? hold : 0} onPress={() => press(index)} />
        ))}
      </div>
      <p className="skyline-invaders__how">Tap a volume, or press a button. Left and right move between the choices.</p>
    </section>
  );
}
