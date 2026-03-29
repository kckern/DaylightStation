import { useMemo, useState, useEffect } from 'react';
import { getNotePosition, getNoteWidth, getNoteHue, getNoteName } from '../noteUtils.js';
import { InvaderSprite } from './InvaderSprite.jsx';
import './NoteWaterfall.scss';

const DISPLAY_DURATION = 8000;
const EXPLOSION_DURATION_MS = 600;
const PARTICLE_COUNT = 8;
const PARTICLE_ANGLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
  const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
});

/**
 * Waterfall display — unified rendering from noteHistory.
 *
 * Every note in noteHistory is rendered in a single pass:
 * - Active notes (endTime=null): bottom anchored at 0%, height grows with hold duration
 * - Released notes (endTime set): bottom rises over DISPLAY_DURATION, height is fixed
 *
 * No separate layers. No transition glitches.
 */
export function NoteWaterfall({ noteHistory = [], activeNotes = new Map(), startNote = 21, endNote = 108, gameMode = null }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let rafId;
    const step = () => {
      setTick(t => t + 1);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Unified note rendering — all notes from noteHistory in one pass
  const notes = useMemo(() => {
    const now = Date.now();

    return noteHistory
      .filter(note => {
        // Active notes always visible
        if (!note.endTime) return true;
        // Released notes visible until they've risen past the display
        return (now - note.endTime) < DISPLAY_DURATION;
      })
      .map(note => {
        const isActive = !note.endTime;
        const holdDuration = (isActive ? now : note.endTime) - note.startTime;
        const timeSinceRelease = isActive ? 0 : now - note.endTime;
        const progress = isActive ? 0 : timeSinceRelease / DISPLAY_DURATION;

        return {
          note: note.note,
          startTime: note.startTime,
          velocity: note.velocity,
          isActive,
          x: getNotePosition(note.note, startNote, endNote),
          width: getNoteWidth(note.note, startNote, endNote),
          hue: getNoteHue(note.note, startNote, endNote),
          heightPercent: Math.min(95, Math.max(1, (holdDuration / DISPLAY_DURATION) * 100)),
          bottomPercent: progress * 100,
          progress,
        };
      });
  }, [noteHistory, startNote, endNote, tick]);

  const gameNotes = useMemo(() => {
    if (!gameMode) return [];
    const now = Date.now();

    return gameMode.fallingNotes.map(fg => {
      const elapsed = now - (fg.targetTime - gameMode.fallDuration);
      const progress = Math.min(1, elapsed / gameMode.fallDuration);
      const topPercent = Math.max(-10, Math.min(110, progress * 100));

      return {
        ...fg,
        notePositions: fg.pitches.map(pitch => ({
          pitch,
          name: getNoteName(pitch),
          x: getNotePosition(pitch, startNote, endNote),
          width: getNoteWidth(pitch, startNote, endNote, true),
          hue: getNoteHue(pitch, startNote, endNote),
        })),
        topPercent,
        progress,
      };
    });
  }, [gameMode, startNote, endNote, tick]);

  const gameLasers = useMemo(() => {
    if (!gameMode?.lasers) return [];
    const now = Date.now();
    const travelMs = gameMode.laserTravelMs || 250;

    return gameMode.lasers
      .filter(l => l.active)
      .map(l => {
        const progress = Math.min(1, (now - l.spawnTime) / travelMs);
        return {
          ...l,
          x: getNotePosition(l.pitch, startNote, endNote),
          bottomPercent: progress * 100,
        };
      });
  }, [gameMode, startNote, endNote, tick]);

  return (
    <div className={`note-waterfall${gameMode ? ' note-waterfall--game' : ''}`}>
      <div className="waterfall-perspective">
        {notes.map(note => (
          <div
            key={`note-${note.note}-${note.startTime}`}
            className={`waterfall-note${note.isActive ? ' active' : ''}`}
            style={{
              '--x': `${note.x}%`,
              '--width': `${note.width}%`,
              '--height': `${note.heightPercent}%`,
              '--bottom': `${note.bottomPercent}%`,
              '--velocity': note.velocity / 127,
              '--hue': note.hue,
              '--progress': note.progress
            }}
          />
        ))}
      </div>

      {/* Game mode: falling target notes */}
      {gameNotes.map(gn => {
        const isInvadersHit = gameMode?.levelMode === 'invaders' && gn.state === 'hit' && gn.resolvedTime;
        const explosionProgress = isInvadersHit
          ? Math.min(1, (Date.now() - gn.resolvedTime) / EXPLOSION_DURATION_MS)
          : 0;

        return (
          <div key={`game-group-${gn.id}`}>
            {gn.notePositions.map(pos => (
              isInvadersHit ? (
                PARTICLE_ANGLES.map((dir, pi) => {
                  const spread = explosionProgress * 80;
                  const opacity = 1 - explosionProgress;
                  const size = 10 * (1 - explosionProgress * 0.5);
                  return (
                    <div
                      key={`particle-${gn.id}-${pos.pitch}-${pi}`}
                      className="explosion-particle"
                      style={{
                        left: `${pos.x}%`,
                        top: `${gn.topPercent}%`,
                        '--hue': pos.hue,
                        transform: `translate(calc(-50% + ${dir.dx * spread}px), calc(-50% + ${dir.dy * spread}px))`,
                        opacity,
                        width: `${size}px`,
                        height: `${size}px`,
                      }}
                    />
                  );
                })
              ) : (
                <div
                  key={`game-${gn.id}-${pos.pitch}`}
                  className={`game-note game-note--${gn.state}${gn.hitResult ? ` game-note--${gn.hitResult}` : ''}`}
                  style={{
                    '--x': `${pos.x}%`,
                    '--width': `${pos.width}%`,
                    '--top': `${gn.topPercent}%`,
                    '--hue': pos.hue,
                  }}
                >
                  <InvaderSprite
                    variant={gn.id % 3}
                    frame={gn.state === 'falling' ? Math.floor(Date.now() / 500) % 2 : 0}
                  />
                  <span className="game-note-label">{pos.name.replace(/\d+$/, '')}</span>
                </div>
              )
            ))}
            {gn.state !== 'falling' && gn.resolvedTime && (() => {
              const feedbackAge = Date.now() - gn.resolvedTime;
              const feedbackOpacity = Math.max(0, 1 - feedbackAge / 1000);
              if (feedbackOpacity <= 0) return null;
              const resolvedElapsed = gn.resolvedTime - (gn.targetTime - gameMode.fallDuration);
              const resolvedProgress = Math.min(1, resolvedElapsed / gameMode.fallDuration);
              const resolvedTop = Math.max(0, Math.min(100, resolvedProgress * 100));
              return (
                <div
                  className={`hit-feedback hit-feedback--${gn.hitResult || 'miss'}`}
                  style={{
                    '--x': `${gn.notePositions[0]?.x ?? 50}%`,
                    '--top': `${resolvedTop}%`,
                    opacity: feedbackOpacity,
                  }}
                >
                  {gameMode?.levelMode === 'invaders'
                    ? (gn.hitResult ? 'Zap!' : 'Miss!')
                    : (gn.hitResult === 'perfect' ? 'Perfect!' : gn.hitResult === 'good' ? 'Good!' : 'Miss!')}
                </div>
              );
            })()}
          </div>
        );
      })}

      {gameLasers.map(laser => (
        <div
          key={`laser-${laser.id}`}
          className={`laser-projectile${laser.wrong ? ' laser-projectile--wrong' : ''}`}
          style={{
            '--x': `${laser.x}%`,
            '--bottom': `${laser.bottomPercent}%`,
            ...(laser.wrong ? { '--angle': `${laser.driftAngle}deg` } : {}),
          }}
        />
      ))}

      {gameMode && gameMode.levelMode !== 'invaders' && <div className="hit-line" />}
    </div>
  );
}

export default NoteWaterfall;
