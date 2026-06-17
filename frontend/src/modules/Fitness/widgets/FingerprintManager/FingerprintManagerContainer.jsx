// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.jsx
import React, { useEffect, useState } from 'react';
import { useFingerprintManager } from './useFingerprintManager.js';
import { EnrollModal } from './EnrollModal.jsx';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'fingerprint-manager' }));

// A throwaway per-enroll token used to correlate the backend progress rebroadcast.
function makeToken() {
  return `fp-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6)}`;
}

export default function FingerprintManagerContainer() {
  const { users, refresh, enroll, remove } = useFingerprintManager();
  const [enrolling, setEnrolling] = useState(null); // { username, clientToken }

  useEffect(() => {
    logger().info('manager.opened');
    refresh();
  }, [refresh]);

  const startAdd = (user) => {
    // Unenrolled users enroll freely (TOFU). Enrolled users still open the modal;
    // the backend enforces the self/admin scan when the enroll POST is made, so the
    // modal's "Place your finger" step doubles as the auth+capture prompt.
    setEnrolling({ username: user.username, clientToken: makeToken() });
  };

  const handleEnroll = async (args) => {
    const result = await enroll(args);
    return result;
  };

  const handleDone = async () => {
    setEnrolling(null);
    await refresh();
  };

  const handleDelete = async (username, finger) => {
    // The list never exposes uuids — deletion is keyed by finger name and the
    // backend re-resolves it to the uuid the user owns. Each finger name is unique
    // per user (enroll rejects a duplicate with 409 finger-taken).
    const result = await remove({ username, finger });
    if (result?.success) await refresh();
  };

  return (
    <div className="fp-manager" data-testid="fingerprint-manager">
      <h2>Fingerprints</h2>
      <ul className="fp-user-list">
        {users.map((u) => (
          <li key={u.username} className="fp-user-row">
            <span className="fp-user-name"><span className="fp-display-name">{u.displayName}</span>{u.admin ? <span className="fp-admin-badge"> (admin)</span> : null}</span>
            <span className="fp-user-fingers">
              {u.fingerprints.length === 0
                ? <em>no prints</em>
                : u.fingerprints.map((f) => (
                    <button
                      key={f.finger}
                      type="button"
                      className="fp-finger-chip"
                      onClick={() => handleDelete(u.username, f.finger)}
                      title={`Delete ${f.finger} (enrolled ${f.enrolled})`}
                    >👍 {f.finger} ✕</button>
                  ))}
            </span>
            <button type="button" className="fp-add" onClick={() => startAdd(u)}>+ Add to {u.displayName}</button>
          </li>
        ))}
      </ul>

      {enrolling && (
        <EnrollModal
          username={enrolling.username}
          clientToken={enrolling.clientToken}
          onEnroll={handleEnroll}
          onDone={handleDone}
          onCancel={() => setEnrolling(null)}
        />
      )}
    </div>
  );
}
