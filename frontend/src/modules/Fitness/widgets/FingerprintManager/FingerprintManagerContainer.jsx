import React, { useEffect, useState } from 'react';
import { useFingerprintManager } from './useFingerprintManager.js';
import { EnrollModal } from './EnrollModal.jsx';
import FingerprintHands from './FingerprintHands.jsx';
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

  const handleDelete = async (username, finger) => {
    // Deletion is keyed by finger name; the backend re-resolves it to the uuid the
    // user owns (each finger name is unique per user — enroll rejects duplicates).
    logger().info('manager.delete.tap', { username, finger });
    const result = await remove({ username, finger });
    if (result?.success) await refresh();
  };

  const onFingerTap = (user) => (finger, isEnrolled) => {
    if (isEnrolled) handleDelete(user.username, finger);
    else openEnroll(user, finger);
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
    </div>
  );
}
