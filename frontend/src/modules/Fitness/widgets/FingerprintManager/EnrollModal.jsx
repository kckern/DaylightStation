// frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.jsx
import React, { useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import FingerprintIcon from './FingerprintIcon.jsx';

const FINGERS = [
  'right-thumb', 'right-index', 'right-middle', 'right-ring', 'right-little',
  'left-thumb', 'left-index', 'left-middle', 'left-ring', 'left-little',
];

/**
 * Enroll a finger for `username`. Streams capture progress from the backend
 * rebroadcast (`fitness.enroll.progress`, filtered to our clientToken) so the
 * user sees "place finger N of M". `onEnroll` performs the actual POST and
 * resolves with the final result; `onDone` fires when it completes.
 *
 * Real hook signature: useWebSocketSubscription(filter: string|string[]|fn, callback, deps)
 * The callback receives the full WS message object directly (no envelope wrapper).
 * So msg.clientToken / msg.stage / msg.stagesTotal are top-level fields.
 */
export function EnrollModal({ username, clientToken, onEnroll, onDone, onCancel }) {
  const [finger, setFinger] = useState('right-index');
  const [phase, setPhase] = useState('pick'); // pick | scanning | done
  const [progress, setProgress] = useState(null);

  useWebSocketSubscription('fitness.enroll.progress', (msg) => {
    if (!msg || msg.clientToken !== clientToken) return;
    setProgress({ stage: msg.stage, stagesTotal: msg.stagesTotal });
  }, [clientToken]);

  const start = async () => {
    setPhase('scanning');
    const result = await onEnroll({ username, finger, clientToken });
    setPhase('done');
    onDone?.(result);
  };

  return (
    <div className="fp-enroll-modal" role="dialog" aria-modal="true" aria-label={`Enroll fingerprint for ${username}`}>
      <div className="fp-enroll-panel">
        <h3 className="fp-enroll-title">Enroll fingerprint</h3>
        {phase === 'pick' && (
          <>
            <label htmlFor="fp-finger">Finger</label>
            <select id="fp-finger" value={finger} onChange={(e) => setFinger(e.target.value)}>
              {FINGERS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="fp-enroll-actions">
              <button type="button" className="fp-btn fp-btn-primary" onClick={start}>Start</button>
              <button type="button" className="fp-btn fp-btn-ghost" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}
        {(phase === 'scanning' || phase === 'done') && (
          <div className="fp-enroll-progress">
            {phase === 'scanning' && <div className="fp-scan-pulse"><FingerprintIcon /></div>}
            {phase === 'scanning' && <p>Place your finger on the reader…</p>}
            {phase === 'scanning' && progress && <p className="fp-scan-stage">{`Stage ${progress.stage} of ${progress.stagesTotal} — lift and place again`}</p>}
            {phase === 'done' && <p className="fp-scan-done">✓ Done.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default EnrollModal;
