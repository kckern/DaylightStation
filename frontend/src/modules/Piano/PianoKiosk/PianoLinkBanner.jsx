import { useEffect, useRef, useState } from 'react';
import { usePianoMidi } from './PianoMidiContext.jsx';

/**
 * PianoLinkBanner — visible feedback for the MIDI OUT link so a player's
 * instrument / tone / volume changes never vanish silently "into the void".
 *
 * When the OUT link is DOWN (a BLE flap), a send no-ops (`if (!out) return`),
 * so the UI looked like it worked while nothing reached the piano. This banner
 * says otherwise, and — because PianoSound/PianoMix now re-assert the current
 * sound on reconnect — it can honestly promise the change will land. On RECOVERY
 * it flashes a brief confirmation.
 *
 * Keyed on `outputConnected` (the port that actually flaps), NOT the input-level
 * `connected` the header chip shows — an output-only drop leaves the chip green.
 * The down banner is suppressed until the link has connected at least once, so a
 * cold page load (still connecting) doesn't read as a "drop"; that first connect
 * is the header chip's Reconnect affordance's job.
 */
export function PianoLinkBanner() {
  const { outputConnected, resetLink } = usePianoMidi();
  const everRef = useRef(false);   // have we EVER had the OUT link — gates "drop" vs "connecting"
  const prevRef = useRef(false);   // previous outputConnected, to detect the rising edge
  const [linkDown, setLinkDown] = useState(false);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = outputConnected;
    if (outputConnected) {
      const wasRealDrop = everRef.current && !prev; // rising edge after a prior connect
      everRef.current = true;
      setLinkDown(false);
      if (wasRealDrop) setRecovered(true);
    } else if (everRef.current) {
      setLinkDown(true);
      setRecovered(false);
    }
  }, [outputConnected]);

  // Auto-dismiss the recovery confirmation.
  useEffect(() => {
    if (!recovered) return undefined;
    const t = setTimeout(() => setRecovered(false), 2500);
    return () => clearTimeout(t);
  }, [recovered]);

  if (linkDown) {
    return (
      <div className="piano-linkbanner piano-linkbanner--down" role="alert">
        <span className="piano-linkbanner__icon" aria-hidden>⚠</span>
        <span className="piano-linkbanner__text">
          Piano link dropped — your changes are held and will apply when it reconnects.
        </span>
        <button type="button" className="piano-linkbanner__reset" onClick={resetLink}>
          Reset link
        </button>
      </div>
    );
  }
  if (recovered) {
    return (
      <div className="piano-linkbanner piano-linkbanner--ok" role="status">
        <span className="piano-linkbanner__icon" aria-hidden>✓</span>
        <span className="piano-linkbanner__text">Piano reconnected — settings restored.</span>
      </div>
    );
  }
  return null;
}

export default PianoLinkBanner;
