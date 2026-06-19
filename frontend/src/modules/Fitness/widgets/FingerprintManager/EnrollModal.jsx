import React, { useMemo, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import FingerprintIcon from './FingerprintIcon.jsx';
import FingerprintHands, { fingerLabel } from './FingerprintHands.jsx';

const FALLBACK_AVATAR = '/media/static/img/users/user';

/**
 * Enroll a finger for a person. The hands picker chooses which fingertip; the
 * scan phase streams capture progress from the backend rebroadcast
 * (`fitness.enroll.progress`, filtered to our clientToken) and fills the stage
 * dots. Visually a sibling of UnlockPrompt — same fingerprint hardware, same
 * slate card and glow language.
 *
 * useWebSocketSubscription(filter, callback, deps): the callback gets the message
 * object directly, so msg.clientToken / msg.stage / msg.stagesTotal are top-level.
 */
export function EnrollModal({
  username,
  displayName,
  avatarSrc,
  enrolled = [],
  preselect,
  clientToken,
  onEnroll,
  onDone,
  onCancel,
}) {
  const [finger, setFinger] = useState(preselect || 'right-index');
  const [phase, setPhase] = useState('pick'); // pick | scanning | done
  const [progress, setProgress] = useState(null);

  const enrolledSet = useMemo(() => new Set(enrolled), [enrolled]);
  const isTaken = enrolledSet.has(finger);

  useWebSocketSubscription('fitness.enroll.progress', (msg) => {
    if (!msg || msg.clientToken !== clientToken) return;
    setProgress({ stage: msg.stage, stagesTotal: msg.stagesTotal });
  }, [clientToken]);

  const start = async () => {
    if (!finger || isTaken) return;
    setPhase('scanning');
    const result = await onEnroll({ username, finger, clientToken });
    setPhase('done');
    onDone?.(result);
  };

  const stagesTotal = progress?.stagesTotal || 6;
  const stage = progress?.stage || 0;
  const name = displayName || username;

  return (
    <div className={`fp-enroll fp-enroll--${phase}`} role="dialog" aria-modal="true" aria-label={`Enroll fingerprint for ${name}`}>
      <div className="fp-enroll__backdrop" aria-hidden="true" />
      <div className="fp-enroll__card">
        <div className="fp-enroll__person">
          <img
            className="fp-enroll__avatar"
            src={avatarSrc || FALLBACK_AVATAR}
            alt=""
            onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
          />
          <div className="fp-enroll__person-text">
            <span className="fp-enroll__eyebrow">Enroll fingerprint</span>
            <span className="fp-enroll__name">{name}</span>
          </div>
        </div>

        {phase === 'pick' && (
          <>
            <FingerprintHands
              size="lg"
              interactive
              enrolled={enrolled}
              selected={finger}
              onFingerTap={(f, alreadyEnrolled) => { if (!alreadyEnrolled) setFinger(f); }}
            />
            <p className="fp-enroll__hint">
              {isTaken
                ? `${fingerLabel(finger)} is already enrolled — pick another fingertip`
                : <>Tap a fingertip, then start. Selected: <strong>{fingerLabel(finger)}</strong></>}
            </p>
            <div className="fp-enroll__actions">
              <button type="button" className="fp-btn fp-btn--ghost" onClick={onCancel}>Cancel</button>
              <button type="button" className="fp-btn fp-btn--primary" onClick={start} disabled={!finger || isTaken}>
                Start
              </button>
            </div>
          </>
        )}

        {phase === 'scanning' && (
          <div className="fp-enroll__scan">
            <div className="fp-enroll__glyph"><FingerprintIcon size="100%" /></div>
            <p className="fp-enroll__scan-title">Place your <strong>{fingerLabel(finger)}</strong> on the reader</p>
            <div className="fp-enroll__dots" aria-hidden="true">
              {Array.from({ length: stagesTotal }, (_, i) => (
                <span key={i} className={`fp-enroll__dot${i < stage ? ' is-filled' : ''}`} />
              ))}
            </div>
            <p className="fp-enroll__scan-meta">
              {stage > 0 ? `Capture ${stage} of ${stagesTotal} — lift and place again` : 'Waiting for the reader…'}
            </p>
            <button type="button" className="fp-btn fp-btn--ghost" onClick={onCancel}>Cancel</button>
          </div>
        )}

        {phase === 'done' && (
          <div className="fp-enroll__done">
            <span className="fp-enroll__check" aria-hidden="true">✓</span>
            <p className="fp-enroll__done-title">{fingerLabel(finger)} enrolled</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default EnrollModal;
