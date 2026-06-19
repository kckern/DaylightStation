import React, { useEffect, useState } from 'react';
import { useFingerprintManager } from './useFingerprintManager.js';
import { EnrollModal } from './EnrollModal.jsx';
import FingerprintHands, { fingerLabel } from './FingerprintHands.jsx';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { useIdentity } from '@/modules/Fitness/identity/IdentityProvider';
import UnlockPrompt from '@/modules/Fitness/player/overlays/UnlockPrompt.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import './FingerprintManager.scss';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

const FALLBACK_AVATAR = DaylightMediaPath('static/img/users/user');

// This surface edits everyone's biometrics, so it's gated behind an admin scan.
// The garage stays dumb; the backend grants this lock only to fitness.yml admins,
// so a recognized non-admin finger is shown "not allowed", not granted.
const ADMIN_LOCK = 'admin';

// A throwaway per-enroll token used to correlate the backend progress rebroadcast.
function makeToken() {
  return `fp-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6)}`;
}

export default function FingerprintManagerContainer({ onClose }) {
  const { users, refresh, enroll, remove } = useFingerprintManager();
  const { registerUnlock, clearUnlock, unlockState, unlockedUser } = useIdentity();
  const [unlocked, setUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(true);
  const [enrolling, setEnrolling] = useState(null); // { username, displayName, avatarSrc, enrolled, preselect, clientToken }
  const [confirmDelete, setConfirmDelete] = useState(null); // { username, displayName, finger }
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Require an admin fingerprint before the manager renders.
  useEffect(() => {
    if (unlocked) return undefined;
    let cancelled = false;
    logger().info('manager.gate.scan');
    registerUnlock(ADMIN_LOCK).then((verdict) => {
      if (cancelled) return;
      if (verdict?.matched) { setUnlocked(true); clearUnlock(); }
      else { setGateOpen(false); }
    });
    return () => { cancelled = true; };
  }, [unlocked, registerUnlock, clearUnlock]);

  // Fetch the roster only after the admin unlock — don't leak it pre-auth.
  useEffect(() => {
    if (!unlocked) return;
    logger().info('manager.opened');
    refresh();
  }, [unlocked, refresh]);

  const closeGate = () => { clearUnlock(); onClose?.(); };

  const openEnroll = (user, preselect) => {
    // Unenrolled users enroll freely (TOFU). Enrolled users still open the modal;
    // the backend enforces the self/admin scan when the enroll POST is made.
    setEnrolling({
      username: user.username,
      displayName: user.displayName,
      avatarSrc: DaylightMediaPath(`static/img/users/${user.username}`),
      enrolled: user.fingerprints.map((f) => f.finger),
      preselect,
      clientToken: makeToken(),
    });
  };

  const handleEnroll = async (args) => enroll(args);

  const handleDone = async () => {
    setEnrolling(null);
    await refresh();
  };

  // Confirmed delete. Keyed by finger name; the backend re-resolves it to the uuid
  // the user owns and authorizes via the admin session (no second scan needed).
  const performDelete = async () => {
    if (!confirmDelete) return;
    const { username, finger } = confirmDelete;
    logger().info('manager.delete.confirm', { username, finger });
    setDeleting(true);
    setDeleteError(null);
    const result = await remove({ username, finger });
    setDeleting(false);
    if (result?.success) {
      logger().info('manager.delete.done', { username, finger });
      setConfirmDelete(null);
      await refresh();
    } else {
      logger().warn('manager.delete.failed', { username, finger, error: result?.error ?? null });
      setDeleteError('Couldn’t remove that print. Try again.');
    }
  };

  const closeConfirm = () => { setConfirmDelete(null); setDeleteError(null); };

  const onFingerTap = (user) => (finger, isEnrolled) => {
    if (isEnrolled) {
      logger().debug('manager.delete.tap', { username: user.username, finger });
      setConfirmDelete({ username: user.username, displayName: user.displayName, finger });
    } else {
      openEnroll(user, finger);
    }
  };

  if (!unlocked) {
    return (
      <UnlockPrompt
        open={gateOpen}
        state={unlockState}
        lockLabel="Fingerprint manager · admins only"
        unlockedUser={unlockedUser}
        onCancel={closeGate}
      />
    );
  }

  return (
    <div className="fp-manager" data-testid="fingerprint-manager">
      <header className="fp-manager__header">
        <h2 className="fp-manager__title">Fingerprints</h2>
        <p className="fp-manager__subtitle">
          Who can unlock gated workouts and arm the emergency stop. Tap a fingertip to add or remove a print.
        </p>
      </header>

      <ul className="fp-roster">
        {users.map((u) => {
          const enrolled = u.fingerprints.map((f) => f.finger);
          const count = enrolled.length;
          const avatarSrc = DaylightMediaPath(`static/img/users/${u.username}`);
          return (
            <li key={u.username} className={`fp-card${count ? ' fp-card--enrolled' : ''}`}>
              <div className="fp-card__id">
                <div className="fp-card__avatar">
                  <CircularUserAvatar
                    name={u.displayName}
                    avatarSrc={avatarSrc}
                    fallbackSrc={FALLBACK_AVATAR}
                    size={46}
                    showGauge={false}
                    showIndicator={false}
                  />
                </div>
                <div className="fp-card__meta">
                  <span className="fp-card__name">
                    {u.displayName}
                    {u.admin ? <span className="fp-card__badge">Admin</span> : null}
                  </span>
                  <span className="fp-card__count">
                    {count === 0 ? 'No fingerprints yet' : `${count} ${count === 1 ? 'print' : 'prints'} enrolled`}
                  </span>
                  <button
                    type="button"
                    className="fp-card__add"
                    aria-label={`Add fingerprint for ${u.displayName}`}
                    onClick={() => openEnroll(u)}
                  >
                    + Add fingerprint
                  </button>
                </div>
              </div>

              <FingerprintHands
                size="md"
                interactive
                enrolled={enrolled}
                onFingerTap={onFingerTap(u)}
                className="fp-card__hands"
              />
            </li>
          );
        })}
      </ul>

      {enrolling && (
        <EnrollModal
          username={enrolling.username}
          displayName={enrolling.displayName}
          avatarSrc={enrolling.avatarSrc}
          enrolled={enrolling.enrolled}
          preselect={enrolling.preselect}
          clientToken={enrolling.clientToken}
          onEnroll={handleEnroll}
          onDone={handleDone}
          onCancel={() => setEnrolling(null)}
        />
      )}

      {confirmDelete && (
        <div className="fp-confirm" role="dialog" aria-modal="true" aria-label="Remove fingerprint">
          <div className="fp-confirm__backdrop" aria-hidden="true" />
          <div className="fp-confirm__card">
            <p className="fp-confirm__title">Remove fingerprint</p>
            <p className="fp-confirm__body">
              Delete <strong>{fingerLabel(confirmDelete.finger)}</strong> from <strong>{confirmDelete.displayName}</strong>?
            </p>
            {deleteError && <p className="fp-confirm__error">{deleteError}</p>}
            <div className="fp-enroll__actions">
              <button type="button" className="fp-btn fp-btn--ghost" onClick={closeConfirm} disabled={deleting}>Cancel</button>
              <button type="button" className="fp-btn fp-btn--danger" onClick={performDelete} disabled={deleting}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
