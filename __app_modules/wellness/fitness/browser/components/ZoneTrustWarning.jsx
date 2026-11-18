import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useFitnessContext} from '../context/FitnessContext.jsx';
import {useIdentity} from '../identity/useIdentity.js';
import UnlockPrompt from '../player/overlays/UnlockPrompt.jsx';
import './ZoneTrustWarning.scss';

/** Keep the scoring pause visible everywhere, including full-screen playback. */
export default function ZoneTrustWarning() {
  const {zoneProfiles = [], fitnessSessionInstance: session, forceUpdate} = useFitnessContext();
  const identity = useIdentity();
  const live = useRef(null);
  const attempt = useRef(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const profiles = Array.isArray(zoneProfiles) ? zoneProfiles : Object.values(zoneProfiles);
  const active = Boolean(session?.sessionId && !session.endTime);
  const untrusted = active ? profiles.filter(p => p.zoneTrusted === false && p.heartRate > 0) : [];
  live.current = {session, sessionId: session?.sessionId, profiles, identity, forceUpdate};

  function valid(token) {
    const now = live.current;
    const rider = now.profiles.find(p => p.id === token.userId);
    return attempt.current === token && now.session === token.session && now.sessionId === token.sessionId
      && now.session?.sessionId === token.sessionId && !now.session.endTime
      && rider?.zoneTrusted === false && rider.heartRate > 0
      && rider.zoneReadingDeviceId === token.deviceId && rider.trustRevision === token.trustRevision;
  }
  function release(token) {
    if (attempt.current !== token) return;
    attempt.current = null;
    token.clearUnlock();
    setPending(null);
  }
  useLayoutEffect(() => {
    if (attempt.current && !valid(attempt.current)) release(attempt.current);
  });
  useEffect(() => () => {
    const token = attempt.current;
    attempt.current = null;
    token?.clearUnlock();
  }, []);

  async function unlock(profile) {
    if (attempt.current) return;
    const token = {session, sessionId: session.sessionId, userId: profile.id,
      deviceId: profile.zoneReadingDeviceId, trustRevision: profile.trustRevision,
      clearUnlock: identity.clearUnlock};
    attempt.current = token;
    setPending(profile.id);
    setError(null);
    try {
      const result = await identity.registerAdmin('zone-trust');
      if (!valid(token)) return;
      if (result?.matched && result.userId) {
        const grant = token.session.approveZoneTrust({sessionId: token.sessionId, userId: token.userId,
          deviceId: token.deviceId, trustRevision: token.trustRevision, adminId: result.userId});
        if (grant?.ok) live.current.forceUpdate?.();
        else setError('Reading remains untrusted. Please try again.');
      } else setError('Admin unlock was not approved.');
    } catch {
      if (valid(token)) setError('Admin unlock unavailable. Please try again.');
    } finally {
      release(token);
    }
  }

  if (!untrusted.length) return null;
  return <><aside className="zone-trust-warning" aria-label="Heart rate reading trust">
    <strong>Reading not trusted</strong>
    <p>Rings and Fire celebrations are paused</p>
    {untrusted.map(profile => {
      const name = profile.displayName || profile.name || profile.id;
      const threshold = profile.zoneConfig?.find(zone => zone.id === 'active')?.min;
      return <div className="zone-trust-warning__rider" key={profile.id}>
        <strong>{name}</strong>
        <span>{!profile.zoneReadingEligible
          ? 'Wait for an accepted reading, or ask an admin to unlock.'
          : `Bring heart rate below your personal Active threshold${Number.isFinite(threshold) ? ` (${threshold} BPM)` : ''}, or ask an admin to unlock.`}</span>
        <button type="button" disabled={pending !== null} onClick={() => unlock(profile)} aria-label={`Admin unlock ${name}`}>Admin unlock</button>
      </div>;
    })}
    {error && <p role="status">{error}</p>}
  </aside>
    <UnlockPrompt open={pending !== null} state={identity.unlockState} unlockedUser={identity.unlockedUser}
      lockLabel="Trust this rider’s heart rate reading" onCancel={() => {if (attempt.current) release(attempt.current);}} />
  </>;
}
