import React, { useMemo, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import FingerprintIcon from './FingerprintIcon.jsx';
import FingerprintHands, { fingerLabel } from './FingerprintHands.jsx';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-enroll' }));

const FALLBACK_AVATAR = '/media/static/img/users/user';

// Turn a backend failure into one actionable line. The most common failure is
// the self/admin verify scan not matching (a tired/overheated reader, or a
// finger that didn't read) — that must NOT silently close the modal.
function friendlyError(result) {
  const rawError = String(result?.error || result?.reason || '');
  const raw = rawError.toLowerCase();
  if (raw.includes('duplicate')) {
    const who = rawError.match(/"registeredTo":"([^"]+)"/)?.[1] || 'another person';
    return `That fingerprint is already registered to ${who}. Each finger can belong to only one person.`;
  }
  if (raw.includes('verify-failed')) {
    return 'Couldn’t verify the finger (reader hiccup). Try again — nothing was saved.';
  }
  if (raw.includes('auth') || raw.includes('denied') || raw.includes('no-match')) {
    return 'Couldn’t verify your fingerprint. Press an already-enrolled finger firmly and flat, then try again.';
  }
  if (raw.includes('finger-taken')) return 'That finger is already enrolled. Pick another.';
  if (raw.includes('not-eligible')) return 'This person can’t hold fingerprints.';
  if (raw.includes('overheat') || raw.includes('busy') || raw.includes('enroll-failed')) {
    return 'The reader couldn’t capture the print. Give it a few seconds to settle, then try again.';
  }
  return 'Enrollment didn’t complete. Try again.';
}

/**
 * Enroll a finger for a person. The hands picker chooses which fingertip; the
 * scan phase streams capture progress from the backend rebroadcast
 * (`fitness.enroll.progress`, filtered to our clientToken) and fills the stage
 * dots. On failure it stays open and shows the reason (the enroll POST first runs
 * a self/admin verify scan for users who already have prints, then the multi-touch
 * capture — either can fail and the operator needs to retry, not lose the modal).
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
  const [phase, setPhase] = useState('pick'); // pick | scanning | done | error
  const [progress, setProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const enrolledSet = useMemo(() => new Set(enrolled), [enrolled]);
  const isTaken = enrolledSet.has(finger);

  useWebSocketSubscription('fitness.enroll.progress', (msg) => {
    if (!msg || msg.clientToken !== clientToken) return;
    logger().debug('enroll.progress', { username, finger, stage: msg.stage, stagesTotal: msg.stagesTotal });
    setProgress({ stage: msg.stage, stagesTotal: msg.stagesTotal });
  }, [clientToken]);

  const start = async () => {
    if (!finger || isTaken) return;
    logger().info('enroll.start', { username, finger, clientToken });
    setErrorMsg(null);
    setProgress(null);
    setPhase('scanning');
    const result = await onEnroll({ username, finger, clientToken });
    if (result?.success) {
      logger().info('enroll.success', { username, finger });
      setPhase('done');
      onDone?.(result); // parent closes + refreshes
    } else {
      // Stay open so the operator can retry — this is the bug that made the modal
      // vanish after the first (verify) tap when the reader couldn't read.
      logger().warn('enroll.failed', { username, finger, error: result?.error ?? null, reason: result?.reason ?? null });
      setErrorMsg(friendlyError(result));
      setPhase('error');
    }
  };

  const retry = () => { logger().info('enroll.retry', { username, finger }); setPhase('pick'); };
  const cancel = () => { logger().info('enroll.cancel', { username, finger, phase }); onCancel?.(); };

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
              onFingerTap={(f, alreadyEnrolled) => { if (!alreadyEnrolled) { logger().debug('enroll.pick', { username, finger: f }); setFinger(f); } }}
            />
            <p className="fp-enroll__hint">
              {isTaken
                ? `${fingerLabel(finger)} is already enrolled — pick another fingertip`
                : <>Tap a fingertip, then start. Selected: <strong>{fingerLabel(finger)}</strong></>}
            </p>
            <div className="fp-enroll__actions">
              <button type="button" className="fp-btn fp-btn--ghost" onClick={cancel}>Cancel</button>
              <button type="button" className="fp-btn fp-btn--primary" onClick={start} disabled={!finger || isTaken}>
                Start
              </button>
            </div>
          </>
        )}

        {phase === 'scanning' && (
          <div className="fp-enroll__scan">
            <div className="fp-enroll__glyph"><FingerprintIcon size="100%" /></div>
            <p className="fp-enroll__scan-title">Press your <strong>{fingerLabel(finger)}</strong> on the reader</p>
            <div className="fp-enroll__dots" aria-hidden="true">
              {Array.from({ length: stagesTotal }, (_, i) => (
                <span key={i} className={`fp-enroll__dot${i < stage ? ' is-filled' : ''}`} />
              ))}
            </div>
            <p className="fp-enroll__scan-meta">
              {stage > 0
                ? `Capture ${stage} of ${stagesTotal} — lift and press again`
                : 'Verifying… place the same finger repeatedly when prompted'}
            </p>
            <button type="button" className="fp-btn fp-btn--ghost" onClick={cancel}>Cancel</button>
          </div>
        )}

        {phase === 'error' && (
          <div className="fp-enroll__error">
            <span className="fp-enroll__error-mark" aria-hidden="true">!</span>
            <p className="fp-enroll__error-msg">{errorMsg}</p>
            <div className="fp-enroll__actions">
              <button type="button" className="fp-btn fp-btn--ghost" onClick={cancel}>Cancel</button>
              <button type="button" className="fp-btn fp-btn--primary" onClick={retry}>Try again</button>
            </div>
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
