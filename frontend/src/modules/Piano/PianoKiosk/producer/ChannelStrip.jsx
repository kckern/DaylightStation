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
 *
 * Carry pin (§4.1 continuity): a small latching toggle next to M/S. Pinned
 * layers are stored ONCE in the song draft on promote and SHARED across
 * every section promoted while the pin is on (a groove/bass that persists
 * while the harmony changes). Affects future promotes only.
 */
import { useEffect, useRef, useState } from 'react';
import { MaterialGlyph } from './MaterialGlyph.jsx';
import { RomanProgression } from '../../components/roman/RomanProgression.jsx';
import { LoopRoll, loopBars } from './LoopRoll.jsx';
import { GainStrip, levelFromGain, snapToGainLevel } from './GainStrip.jsx';
import { VoicePicker, voiceName } from './VoicePicker.jsx';
import './ChannelStrip.scss';

const REMOVE_ARM_MS = 3000;
const BEATS_PER_BAR = 4;

/**
 * The index of the Roman chord currently sounding, driven by the transport so
 * the live chord lights up as the loop plays. requestAnimationFrame reads the
 * position ref directly and only re-renders when the chord index CHANGES (a few
 * times per loop), never per frame. Returns -1 when idle or non-harmonic.
 */
function useActiveChordIndex(count, notesBundle, positionRef, isPlaying) {
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    if (!isPlaying || !positionRef || !count || !notesBundle) { setIdx(-1); return undefined; }
    const bars = loopBars(notesBundle.notes, notesBundle.ppq, notesBundle.barSpan);
    let raf = 0;
    let last = -1;
    const frame = () => {
      const p = positionRef.current || {};
      const barInLoop = ((((p.bar || 0) % bars) + bars) % bars);
      const frac = (barInLoop * BEATS_PER_BAR + (p.beat || 0)) / (bars * BEATS_PER_BAR);
      const next = Math.min(count - 1, Math.max(0, Math.floor(frac * count)));
      if (next !== last) { last = next; setIdx(next); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, positionRef, count, notesBundle]);
  return idx;
}

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
 * @param {(id:string) => void} [props.onToggleCarried] - carry pin (absent → no pin)
 * @param {(layer:object) => void} [props.onKeepToCrate] - persist a RECORDED
 *   (take-sourced) layer to the household loop pool (Task 8.2). Only recorded
 *   material shows this — library loops already live in the library.
 */
export function ChannelStrip({
  layer,
  grooveCount = 0,
  onboardGm = false,
  notesBundle = null,
  positionRef = null,
  isPlaying = false,
  onToggleMute,
  onToggleSolo,
  onRemove,
  onGain,
  onVoice,
  onToggleCarried,
  onKeepToCrate,
}) {
  const entry = layer.source?.kind === 'library' ? layer.source.entry : null;
  const isTake = layer.source?.kind === 'take';
  const isGroove = layer.role === 'groove';
  const [kept, setKept] = useState(false);
  const title = entry?.title || entry?.slug || layer.id;
  // Live chord highlight (harmonic loops) — the sounding Roman lights up.
  const activeChord = useActiveChordIndex(entry?.roman?.length || 0, notesBundle, positionRef, isPlaying);
  const hasNotes = !!notesBundle?.notes?.length;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [gainOpen, setGainOpen] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const gainLevel = snapToGainLevel(levelFromGain(layer.gain));
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

      {/* Identity + live loop view: a harmonic loop shows its Roman sequence
          with the SOUNDING chord lit; a melodic/groove loop shows a piano-roll
          with a playhead cursor. Falls back to a name while notes load. */}
      <div className="piano-channel-strip__identity">
        {entry?.roman?.length ? (
          <RomanProgression roman={entry.roman} inline activeIndex={activeChord} />
        ) : hasNotes ? (
          <LoopRoll
            notes={notesBundle.notes}
            ppq={notesBundle.ppq}
            barSpan={notesBundle.barSpan}
            positionRef={positionRef}
            isPlaying={isPlaying}
            muted={layer.muted}
          />
        ) : (
          <span className="piano-channel-strip__name">{title}</span>
        )}
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
      {onToggleCarried && (
        <button
          type="button"
          className={`piano-channel-strip__carry${layer.carried ? ' is-on' : ''}`}
          aria-pressed={!!layer.carried}
          aria-label="carry"
          title="Carry across sections"
          onClick={() => onToggleCarried(layer.id)}
        >⇉</button>
      )}

      {/* Compact gain: a chip with a level meter (the wide 11-segment strip
          used to dominate the row width — design §7 abomination fix). Tap opens
          the full segmented strip in a popover (no drag sliders; kiosk rule).
          The reclaimed width goes to the harmonic/notation identity lane. */}
      <div className="piano-channel-strip__gain">
        <button
          type="button"
          className={`piano-channel-strip__gain-chip${layer.muted ? ' is-muted' : ''}`}
          aria-label={`${title} volume`}
          aria-expanded={gainOpen}
          onClick={() => setGainOpen((v) => !v)}
        >
          <span
            className="piano-channel-strip__gain-meter"
            aria-hidden="true"
            style={{ '--lvl': `${layer.muted ? 0 : gainLevel}%` }}
          />
          <span className="piano-channel-strip__gain-val">{layer.muted ? 'Muted' : `${gainLevel}%`}</span>
        </button>
        {isGroove && grooveCount > 1 && (
          <span className="piano-channel-strip__drums-hint">all drums</span>
        )}
        {gainOpen && (
          <>
            <button
              type="button"
              className="piano-channel-strip__gain-scrim"
              aria-label="close volume"
              onClick={() => setGainOpen(false)}
            />
            <div className="piano-channel-strip__gain-pop" role="dialog" aria-label={`${title} volume`}>
              <div className="piano-channel-strip__gain-pop-head">
                <span className="piano-channel-strip__gain-pop-title">{layer.role} volume</span>
                <span className="piano-channel-strip__gain-pop-val">{layer.muted ? 'Muted' : `${gainLevel}%`}</span>
              </div>
              <GainStrip
                gain={layer.gain}
                muted={layer.muted}
                onGain={(gain) => onGain(layer.id, gain)}
                label={`${title} gain`}
              />
            </div>
          </>
        )}
      </div>

      {isTake && onKeepToCrate && (
        <button
          type="button"
          className={`piano-channel-strip__keep${kept ? ' is-kept' : ''}`}
          aria-label="keep to crate"
          title="Keep this recording to the Crate"
          disabled={kept}
          onClick={() => { onKeepToCrate(layer); setKept(true); }}
        >{kept ? 'Kept' : 'Keep'}</button>
      )}

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
