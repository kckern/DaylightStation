import { PianoKeyboard } from '../../components/PianoKeyboard.jsx';
import { projectHostPhase } from './gameLifecycle.js';
import './PianoGameHost.scss';

/**
 * Stable outer furniture for a piano-driven game.
 *
 * A game owns its scene. The platform owns the instrument dock and overlay
 * stacking so every game receives the same physical contract without sharing
 * a gameplay model.
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
}) {
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
      className={`piano-game-host${className ? ` ${className}` : ''}`}
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
