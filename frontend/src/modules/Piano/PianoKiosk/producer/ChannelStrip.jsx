/**
 * ChannelStrip — one workspace layer as a DAW-grade, touch-first mixer row
 * (design §7 Mix view). Replaces the shell's interim LayerRow (Task 4.5).
 *
 * Anatomy, left to right:
 *   glyph · identity (roman progression OR title, + role tag) · voice chip
 *   · M/S latching buttons · GainStrip · remove (2-tap confirm)
 *
 * Voice chip: shows the current program's friendly name; tap opens the
 * VoicePicker drawer. Groove layers get a DISABLED "Drums" chip — the GM drum
 * channel ignores program changes (the reducer's SET_VOICE is a groove no-op
 * too; the UI just tells the truth up front).
 *
 * Shared drum channel honesty: every groove layer lives on channel 9, so the
 * synth-side channel gain is shared — with more than one groove in the mix, a
 * gain change on one strip audibly affects ALL grooves. The strip shows an
 * "all drums" hint in exactly that case rather than pretending independence.
 *
 * Remove is a 2-tap confirm: first tap arms ("Sure?") for 3 s, second tap
 * within the window removes. Touch kiosks get accidental taps, and remove is
 * the one destructive control on the strip.
 */
import { useEffect, useRef, useState } from 'react';
import { MaterialGlyph } from './MaterialGlyph.jsx';
import { RomanProgression } from '../../components/roman/RomanProgression.jsx';
import { GainStrip } from './GainStrip.jsx';
import { VoicePicker, voiceName } from './VoicePicker.jsx';
import './ChannelStrip.scss';

const REMOVE_ARM_MS = 3000;

/**
 * @param {object} props
 * @param {object} props.layer - workspace layer (workspaceReducer shape)
 * @param {number} [props.grooveCount] - groove layers in the mix (shared-drums hint)
 * @param {boolean} [props.onboardGm] - onboard tier live → picker offers all 128
 * @param {(id:string) => void} props.onToggleMute
 * @param {(id:string) => void} props.onToggleSolo
 * @param {(id:string) => void} props.onRemove
 * @param {(id:string, gain:number) => void} props.onGain
 * @param {(id:string, program:number) => void} props.onVoice
 */
export function ChannelStrip({
  layer,
  grooveCount = 0,
  onboardGm = false,
  onToggleMute,
  onToggleSolo,
  onRemove,
  onGain,
  onVoice,
}) {
  const entry = layer.source?.kind === 'library' ? layer.source.entry : null;
  const isGroove = layer.role === 'groove';
  const title = entry?.title || entry?.slug || layer.id;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const disarmTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(disarmTimerRef.current), []);

  const handleRemoveTap = () => {
    if (removeArmed) {
      clearTimeout(disarmTimerRef.current);
      setRemoveArmed(false);
      onRemove(layer.id);
      return;
    }
    setRemoveArmed(true);
    clearTimeout(disarmTimerRef.current);
    disarmTimerRef.current = setTimeout(() => setRemoveArmed(false), REMOVE_ARM_MS);
  };

  return (
    <div className={`piano-channel-strip${layer.muted ? ' is-muted' : ''}`}>
      <MaterialGlyph
        material={entry ?? { kind: 'take', id: layer.id }}
        size={44}
        className="piano-channel-strip__glyph"
        title={title}
      />

      <div className="piano-channel-strip__identity">
        {entry?.roman?.length
          ? <RomanProgression roman={entry.roman} inline />
          : <span className="piano-channel-strip__name">{title}</span>}
        <span className="piano-channel-strip__role">{layer.role}</span>
      </div>

      <button
        type="button"
        className="piano-channel-strip__voice"
        aria-label="voice"
        disabled={isGroove}
        title={isGroove ? 'Drum layers use the GM drum kit' : 'Change voice'}
        onClick={() => setPickerOpen(true)}
      >{isGroove ? 'Drums' : voiceName(layer.gmProgram)}</button>

      <button
        type="button"
        className={`piano-channel-strip__m${layer.muted ? ' is-on' : ''}`}
        aria-pressed={layer.muted}
        aria-label="mute"
        onClick={() => onToggleMute(layer.id)}
      >M</button>
      <button
        type="button"
        className={`piano-channel-strip__s${layer.soloed ? ' is-on' : ''}`}
        aria-pressed={layer.soloed}
        aria-label="solo"
        onClick={() => onToggleSolo(layer.id)}
      >S</button>

      <div className="piano-channel-strip__gain">
        <GainStrip
          gain={layer.gain}
          muted={layer.muted}
          onGain={(gain) => onGain(layer.id, gain)}
          label={`${title} gain`}
        />
        {isGroove && grooveCount > 1 && (
          <span className="piano-channel-strip__drums-hint">all drums</span>
        )}
      </div>

      <button
        type="button"
        className={`piano-channel-strip__remove${removeArmed ? ' is-armed' : ''}`}
        aria-label="remove layer"
        onClick={handleRemoveTap}
      >{removeArmed ? 'Sure?' : '✕'}</button>

      {pickerOpen && !isGroove && (
        <VoicePicker
          current={layer.gmProgram}
          onboardGm={onboardGm}
          onSelect={(program) => onVoice(layer.id, program)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export default ChannelStrip;
