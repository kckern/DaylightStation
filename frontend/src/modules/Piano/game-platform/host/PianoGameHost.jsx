import { PianoKeyboard } from '../../components/PianoKeyboard.jsx';
import { projectHostPhase } from './gameLifecycle.js';
import { usePianoFullscreen } from '../../PianoKiosk/PianoFullscreenContext.jsx';
import './PianoGameHost.scss';

/**
 * Stable outer furniture for a piano-driven game.
 *
 * A game owns its scene. The platform owns the instrument dock and overlay
 * stacking so every game receives the same physical contract without sharing
 * a gameplay model.
 *
 * In kiosk full screen the host says so (`piano-game-host--fullscreen`), so a
 * game can spend the room it was given. `compactInstrument` opts the dock into
 * a slim keyboard while full screen is on — right for a board game, where the
 * keyboard only echoes the hands, and wrong for a game whose keyboard IS the
 * playfield (Space Invaders), which is why it is opt-in.
 */
export function PianoGameHost({
  gameId,
  className = '',
  style = undefined,
  children,
  instrument,
  instrumentClassName = '',
  overlay = null,
  phase = 'ready',
  phaseMapping = undefined,
  compactInstrument = false,
  hostRef = undefined,
}) {
  const { fullscreen } = usePianoFullscreen();
  const hostClassName = [
    'piano-game-host',
    fullscreen && 'piano-game-host--fullscreen',
    fullscreen && compactInstrument && 'piano-game-host--compact-instrument',
    className,
  ].filter(Boolean).join(' ');
  const keyboard = instrument ? (
    <div className={`piano-game-host__instrument${instrumentClassName ? ` ${instrumentClassName}` : ''}`}>
      <PianoKeyboard
        activeNotes={instrument.activeNotes}
        startNote={instrument.startNote}
        endNote={instrument.endNote}
        showLabels={instrument.showLabels ?? true}
        targetNotes={instrument.targetNotes ?? null}
        wrongNotes={instrument.wrongNotes ?? null}
        destroyedKeys={instrument.destroyedKeys ?? null}
        onNoteOn={instrument.onNoteOn}
        onNoteOff={instrument.onNoteOff}
      />
    </div>
  ) : null;

  return (
    <div
      ref={hostRef}
      className={hostClassName}
      data-piano-game={gameId}
      data-game-phase={projectHostPhase(phase, phaseMapping)}
      style={style}
    >
      {children}
      {keyboard}
      {overlay && <div className="piano-game-host__overlays">{overlay}</div>}
    </div>
  );
}

export default PianoGameHost;
