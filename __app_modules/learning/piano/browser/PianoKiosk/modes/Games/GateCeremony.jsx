import { useEffect, useRef } from 'react';
import Icon from '../../../ui/icons/Icon.jsx';
import { getGameEntry } from '../../../gameRegistry.js';
import './GateCeremony.scss';

/**
 * GateCeremony — the curtain between clearing the gate and playing the game.
 *
 * It is the TRANSITION, not a card shown before one. The gate is a real gate
 * and the thing behind it is the game, so the curtain closes on the practice,
 * announces the verdict on its own face, and then parts onto what was earned.
 * The reward and the navigation are one gesture, which is why it feels like a
 * door opening rather than a cutscene interrupting.
 *
 * WHAT IT OPENS ONTO comes from `gameRegistry` — the same `{ label, icon }` the
 * launcher and the office chrome read. Nothing new is registered for this, and
 * a game added later gets a ceremony without anyone remembering to teach this
 * component about it.
 *
 * The 400ms of stillness at the top is deliberate and is the most important
 * frame in it: a reward that begins the instant the last note lands reads as a
 * cutscene, and one that waits a beat reads as a response.
 */

/** Total wall-clock before the game is handed control. Mirrors GateCeremony.scss. */
export const CEREMONY_MS = 3400;

export default function GateCeremony({ gameId = null, gameLabel = null, score = null, onDone }) {
  const entry = gameId ? getGameEntry(gameId) : null;
  const label = gameLabel ?? entry?.label ?? 'Your game';
  const icon = entry?.icon ?? 'game';

  // THE HAND-OVER IS ARMED ONCE, ON MOUNT, AND NOTHING MAY RE-ARM IT.
  // `onDone` is an inline closure in the gate, so it is a new function on every
  // render — and the gate re-renders on every MIDI note (`usePianoMidiNotes`)
  // and on every bridge link change. An effect keyed on it therefore cleared
  // and restarted this timeout each time, so a child who kept a hand on the
  // keys (or a note bridge that reconnected) held the curtain shut
  // indefinitely: "Cleared" on screen, the game never arriving. The callback
  // lives in a ref so the latest one still runs; only the mount arms the timer.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current?.(), CEREMONY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="gate-ceremony" role="status" aria-label={`Gate cleared. ${label} unlocked.`}>
      {/* What is behind the curtain. Opaque before the panels part, so the
          practice screen is never visible through the gap. */}
      <div className="gate-ceremony__behind" aria-hidden="true">
        <Icon name={icon} className="gate-ceremony__icon" />
        <span className="gate-ceremony__unlocked">Unlocked</span>
        <span className="gate-ceremony__game">{label}</span>
      </div>

      {/* Two panels and a valance. One keyframe closes and opens them, so the
          hold in the middle cannot drift out of step with the verdict. */}
      <div className="gate-ceremony__curtain" aria-hidden="true">
        <div className="gate-ceremony__panel gate-ceremony__panel--l" />
        <div className="gate-ceremony__panel gate-ceremony__panel--r" />
        <div className="gate-ceremony__valance" />
      </div>

      <div className="gate-ceremony__verdict" aria-hidden="true">
        <span className="gate-ceremony__word">Cleared</span>
        {Number.isFinite(score) && (
          <span className="gate-ceremony__score">{Math.round(score * 100)}%</span>
        )}
      </div>
    </div>
  );
}
