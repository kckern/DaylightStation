import { useMemo, useState, useEffect } from 'react';
import { getNotePosition, getNoteWidth, getNoteHue, getNoteName } from '../noteUtils.js';
import './NoteWaterfall.scss';

const DISPLAY_DURATION = 8000; // Show notes for 8 seconds as they rise
const TICK_INTERVAL = 16; // ~60fps
const EXPLOSION_DURATION_MS = 600;
const PARTICLE_COUNT = 8;
// Pre-computed particle directions (evenly spaced around a circle)
const PARTICLE_ANGLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
  const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
});

/**
 * Waterfall display showing notes rising up from the keyboard
 * with Star Wars crawl perspective effect
 *
 * @param {Object} props
 * @param {Array} props.noteHistory - Array of note events with startTime/endTime
 * @param {Map} props.activeNotes - Map of currently pressed notes (note number -> {velocity, timestamp})
 * @param {number} props.startNote - Lowest note on keyboard
 * @param {number} props.endNote - Highest note on keyboard
 */
export function NoteWaterfall({ noteHistory = [], activeNotes = new Map(), startNote = 21, endNote = 108, gameMode = null, wrongColumns = null }) {
  const [tick, setTick] = useState(0);

  // Continuous animation tick
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, TICK_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const visibleNotes = useMemo(() => {
    const now = Date.now();

    return noteHistory
      .filter(note => {
        // For active notes, always show them
        const activeNote = activeNotes.get(note.note);
        const isStillActive = activeNote && activeNote.timestamp === note.startTime;
        if (isStillActive) return true;

        // For completed notes, filter based on time since release
        if (note.endTime) {
          const timeSinceRelease = now - note.endTime;
          return timeSinceRelease < DISPLAY_DURATION;
        }

        // Orphaned notes (no endTime, not active) - use age as fallback
        const age = now - note.startTime;
        return age < DISPLAY_DURATION;
      })
      .map(note => {
        // Check if this specific note instance is still active by matching both
        // the note number AND the startTime with the activeNotes map
        const activeNote = activeNotes.get(note.note);
        const isStillActive = activeNote && activeNote.timestamp === note.startTime;

        const duration = isStillActive
          ? now - note.startTime
          : note.endTime
            ? note.endTime - note.startTime
            : now - note.startTime;

        // Calculate position differently for active vs completed notes
        let bottomPercent, progress;
        if (isStillActive) {
          // Active notes stay anchored to the keyboard
          bottomPercent = 0;
          progress = 0;
        } else if (note.endTime) {
          // Completed notes rise based on time since release
          const timeSinceRelease = now - note.endTime;
          progress = timeSinceRelease / DISPLAY_DURATION;
          bottomPercent = progress * 100;
        } else {
          // Orphaned notes - fallback to age-based positioning
          const age = now - note.startTime;
          progress = age / DISPLAY_DURATION;
          bottomPercent = progress * 100;
        }

        return {
          ...note,
          x: getNotePosition(note.note, startNote, endNote),
          width: getNoteWidth(note.note, startNote, endNote),
          hue: getNoteHue(note.note, startNote, endNote),
          duration,
          bottomPercent,
          progress,
          isActive: isStillActive
        };
      });
  }, [noteHistory, activeNotes, startNote, endNote, tick]);

  const gameNotes = useMemo(() => {
    if (!gameMode) return [];
    const now = Date.now();

    return gameMode.fallingNotes.map(fg => {
      // Calculate fall progress: 1.0 at spawn (top) → 0.0 at target (hit line)
      const elapsed = now - (fg.targetTime - gameMode.fallDuration);
      const progress = Math.min(1, elapsed / gameMode.fallDuration);

      // topPercent: 0% = top of waterfall, 100% = bottom (hit line)
      const topPercent = Math.max(-10, Math.min(110, progress * 100));

      return {
        ...fg,
        notePositions: fg.pitches.map(pitch => ({
          pitch,
          name: getNoteName(pitch),
          x: getNotePosition(pitch, startNote, endNote),
          width: getNoteWidth(pitch, startNote, endNote),
          hue: getNoteHue(pitch, startNote, endNote),
        })),
        topPercent,
        progress,
      };
    });
  }, [gameMode, startNote, endNote, tick]);

  // Lane highlights for game mode (all possible pitches in current level)
  const gameLanes = useMemo(() => {
    if (!gameMode?.currentLevel?.notes) return [];
    const fallingPitches = new Set();
    gameMode.fallingNotes.forEach(fn => {
      if (fn.state === 'falling') fn.pitches.forEach(p => fallingPitches.add(p));
    });
    return gameMode.currentLevel.notes.map(pitch => ({
      pitch,
      x: getNotePosition(pitch, startNote, endNote),
      width: getNoteWidth(pitch, startNote, endNote),
      hue: getNoteHue(pitch, startNote, endNote),
      active: fallingPitches.has(pitch),
    }));
  }, [gameMode, startNote, endNote, tick]);

  return (
    <div className={`note-waterfall${gameMode ? ' note-waterfall--game' : ''}`}>
      {/* Game mode: lane highlights */}
      {gameLanes.map(lane => (
        <div
          key={`lane-${lane.pitch}`}
          className={`game-lane${lane.active ? ' game-lane--active' : ''}`}
          style={{
            '--x': `${lane.x}%`,
            '--width': `${lane.width}%`,
            '--hue': lane.hue,
          }}
        />
      ))}

      {/* Wrong-press column flash */}
      {wrongColumns && Array.from(wrongColumns.keys()).map(pitch => (
        <div
          key={`wrong-col-${pitch}`}
          className="game-lane game-lane--wrong"
          style={{
            '--x': `${getNotePosition(pitch, startNote, endNote)}%`,
            '--width': `${getNoteWidth(pitch, startNote, endNote)}%`,
          }}
        />
      ))}

      <div className="waterfall-perspective">
        {/* Free-play rising notes (hidden during game mode via CSS) */}
        {visibleNotes.map((note, idx) => {
          const heldDuration = note.duration;
          const heightPercent = Math.min(95, Math.max(1, (heldDuration / DISPLAY_DURATION) * 100));

          return (
            <div
              key={`${note.note}-${note.startTime}-${idx}`}
              className={`waterfall-note ${note.isActive ? 'active' : ''}`}
              style={{
                '--x': `${note.x}%`,
                '--width': `${note.width}%`,
                '--height': `${heightPercent}%`,
                '--bottom': `${note.bottomPercent}%`,
                '--velocity': note.velocity / 127,
                '--hue': note.hue,
                '--progress': note.progress
              }}
            />
          );
        })}
      </div>

      {/* Game mode: falling target notes (outside perspective for clean 2D positioning) */}
      {gameNotes.map(gn => {
        const isInvadersHit = gameMode?.levelMode === 'invaders' && gn.state === 'hit' && gn.resolvedTime;
        const explosionProgress = isInvadersHit
          ? Math.min(1, (Date.now() - gn.resolvedTime) / EXPLOSION_DURATION_MS)
          : 0;

        return (
          <div key={`game-group-${gn.id}`}>
            {gn.notePositions.map(pos => (
              isInvadersHit ? (
                // Explosion particles replace the note
                PARTICLE_ANGLES.map((dir, pi) => {
                  const spread = explosionProgress * 80; // px spread radius
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
                  <span className="game-note-label">{pos.name.replace(/\d+$/, '')}</span>
                </div>
              )
            ))}
            {/* Hit/miss feedback text */}
            {gn.state !== 'falling' && gn.resolvedTime && (() => {
              const feedbackAge = Date.now() - gn.resolvedTime;
              const feedbackOpacity = Math.max(0, 1 - feedbackAge / 1000);
              if (feedbackOpacity <= 0) return null;
              return (
                <div
                  className={`hit-feedback hit-feedback--${gn.hitResult || 'miss'}`}
                  style={{
                    '--x': `${gn.notePositions[0]?.x ?? 50}%`,
                    '--top': `${gn.topPercent}%`,
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

      {gameMode && gameMode.levelMode !== 'invaders' && <div className="hit-line" />}
    </div>
  );
}

export default NoteWaterfall;
