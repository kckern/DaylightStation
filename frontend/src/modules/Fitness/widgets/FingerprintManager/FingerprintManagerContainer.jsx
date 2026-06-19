import React, { useEffect, useState } from 'react';
import { useFingerprintManager } from './useFingerprintManager.js';
import { EnrollModal } from './EnrollModal.jsx';
import FingerprintHands from './FingerprintHands.jsx';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import './FingerprintManager.scss';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

const FALLBACK_AVATAR = DaylightMediaPath('static/img/users/user');

// A throwaway per-enroll token used to correlate the backend progress rebroadcast.
function makeToken() {
  return `fp-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6)}`;
}

export default function FingerprintManagerContainer() {
  const { users, refresh, enroll, remove } = useFingerprintManager();
  const [enrolling, setEnrolling] = useState(null); // { username, displayName, avatarSrc, enrolled, preselect, clientToken }

  useEffect(() => {
    logger().info('manager.opened');
    refresh();
  }, [refresh]);

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
                    size={66}
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
