import React from 'react';
import GameSoundSheet from './GameSoundSheet.jsx';

/**
 * The sound sheet over a live flight: one framed window near the top of the
 * scene, which keeps flying under it. Touch-only (the bike buttons keep their
 * flight meaning). Done, a second tap on "more", or 8 s with no change closes
 * it (SkylineGlider owns that timer).
 */
export default function SkylineSoundOverlay({ sound, onClose }) {
  return <div className="skyline-sound" role="dialog" aria-label="Sound" data-testid="skyline-sound-overlay">
    <h2 className="skyline-sound__title">Sound</h2>
    <GameSoundSheet level={sound.level} muted={sound.muted} onLevel={sound.onLevel} onToggleMute={sound.onToggleMute}
      classPrefix="skyline-sound" testIdPrefix="skyline-sound" controlId="skyline-volume"/>
    <button type="button" className="skyline-sound__done" onClick={onClose} data-testid="skyline-sound-done">Done</button>
  </div>;
}
