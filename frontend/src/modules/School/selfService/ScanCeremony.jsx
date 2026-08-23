/**
 * ScanCeremony — the visible half of the scan ceremony (Slice D2,
 * omr-grading-integrity design). Renders whatever `useScanCeremony()`
 * currently holds as a tone-coloured `role="status"` banner over the locked
 * panel (or, in unlocked mode, over whatever the wall is showing) — large
 * enough to read across the room on the Portal's 1280x800 screen.
 *
 * This is deliberately the ONLY acknowledgement guaranteed to land: the
 * matching tone (`scanCeremonySound.js`) is fired alongside it, but a
 * blocked/silent AudioContext must never take the visible banner down with
 * it — the effect below never gates rendering on the sound's result.
 */
import { useEffect, useRef } from 'react';
import { playScanCeremonyTone } from './scanCeremonySound.js';

/**
 * @param {object} props
 * @param {'success'|'warn'|'error'} props.tone
 * @param {string} props.title
 * @param {string} props.detail
 * @param {number} props.at - epoch ms; identifies THIS ceremony so the sound
 *   fires once per scan, not once per re-render.
 * @param {string|null} [props.code] - secondary detail only; never the
 *   headline (see the Slice D brief: plain words, code is a footnote).
 * @param {() => void} props.onDismiss - tap-to-dismiss early, before the
 *   ~12s auto-clear.
 */
export function ScanCeremony({ tone, title, detail, at, code = null, onDismiss }) {
  const playedAtRef = useRef(null);

  useEffect(() => {
    // Fire once per distinct ceremony (`at` is the scan's own timestamp), not
    // on every re-render this component happens to take.
    if (playedAtRef.current === at) return;
    playedAtRef.current = at;
    playScanCeremonyTone(tone);
  }, [tone, at]);

  return (
    <div
      className={`school-scan-ceremony school-scan-ceremony--${tone}`}
      role="status"
      data-testid="scan-ceremony"
      onClick={onDismiss}
    >
      <p className="school-scan-ceremony__title">{title}</p>
      <p className="school-scan-ceremony__detail">{detail}</p>
      {code && <p className="school-scan-ceremony__code">{code}</p>}
    </div>
  );
}

export default ScanCeremony;
