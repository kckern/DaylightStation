import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import {useFitnessContext} from '../context/FitnessContext.jsx';
import {useIdentity} from '../identity/useIdentity.js';
import {AppModal} from '../shared/composites/index.js';
import {AppButton} from '../shared/primitives/index.js';
import UnlockPrompt from '../player/overlays/UnlockPrompt.jsx';
import './ZoneTrustDialog.scss';

/** A rider whose live reading the zone store has not accepted yet. */
export function isUntrustedReading(profile) {
  return profile?.zoneTrusted === false && Number(profile?.heartRate) > 0;
}

/**
 * Why one rider's heart rate earns nothing yet, and the admin unlock.
 *
 * Opened from the "?" mark on that rider's card. It replaced a screen-wide
 * warning that covered every rider's video whenever anyone's reading was
 * waiting to be accepted — on 2026-11-23 that was each kid at rest for ~16s
 * as they joined (owner: the problem belongs on the rider's card).
 *
 * Closes itself when the rider's reading is accepted, the rider leaves, or the
 * session ends. A fingerprint approval is checked again against the live
 * session, strap and trust revision before it is granted.
 */
export default function ZoneTrustDialog({riderId, onClose}) {
  const logger = useMemo(() => getLogger().child({component: 'zone-trust-dialog'}), []);
  const {zoneProfiles = [], fitnessSessionInstance: session, forceUpdate} = useFitnessContext();
  const identity = useIdentity();
  const live = useRef(null);
  const attempt = useRef(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const profiles = Array.isArray(zoneProfiles) ? zoneProfiles : Object.values(zoneProfiles);
  const active = Boolean(session?.sessionId && !session.endTime);
  const found = profiles.find(p => p?.id === riderId) || null;
  const profile = active && isUntrustedReading(found) ? found : null;
  live.current = {session, sessionId: session?.sessionId, profiles, identity, forceUpdate};

  function valid(token) {
    const now = live.current;
    const rider = now.profiles.find(p => p.id === token.userId);
    return attempt.current === token && now.session === token.session && now.sessionId === token.sessionId
      && now.session?.sessionId === token.sessionId && !now.session.endTime
      && isUntrustedReading(rider)
      && rider.zoneReadingDeviceId === token.deviceId && rider.trustRevision === token.trustRevision;
  }
  function release(token) {
    if (attempt.current !== token) return;
    attempt.current = null;
    token.clearUnlock();
    setPending(false);
  }
  useLayoutEffect(() => {
    if (attempt.current && !valid(attempt.current)) release(attempt.current);
  });
  useEffect(() => () => {
    const token = attempt.current;
    attempt.current = null;
    token?.clearUnlock();
  }, []);

  const shown = Boolean(profile);
  useEffect(() => {
    if (!shown) return undefined;
    logger.info('fitness.zone_trust.dialog_opened', {
      userId: riderId, deviceId: profile?.zoneReadingDeviceId ?? null,
      heartRate: profile?.heartRate ?? null, eligible: profile?.zoneReadingEligible !== false,
    });
    return () => logger.info('fitness.zone_trust.dialog_closed', {userId: riderId});
    // Log once per opening, not per reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, riderId, logger]);
  // Nothing left to explain: the reading was accepted, or the rider/session is gone.
  useEffect(() => {
    if (!shown) onClose?.();
  }, [shown, onClose]);

  async function unlock() {
    if (attempt.current || !profile) return;
    const token = {session, sessionId: session.sessionId, userId: profile.id,
      deviceId: profile.zoneReadingDeviceId, trustRevision: profile.trustRevision,
      clearUnlock: identity.clearUnlock};
    attempt.current = token;
    setPending(true);
    setError(null);
    logger.info('fitness.zone_trust.unlock_requested', {userId: token.userId, deviceId: token.deviceId});
    try {
      const result = await identity.registerAdmin('zone-trust');
      if (!valid(token)) {
        logger.info('fitness.zone_trust.unlock_stale', {userId: token.userId});
        return;
      }
      if (result?.matched && result.userId) {
        const grant = token.session.approveZoneTrust({sessionId: token.sessionId, userId: token.userId,
          deviceId: token.deviceId, trustRevision: token.trustRevision, adminId: result.userId});
        if (grant?.ok) live.current.forceUpdate?.();
        else {
          logger.warn('fitness.zone_trust.unlock_refused', {userId: token.userId, reason: grant?.reason ?? null});
          setError('The reading is still not trusted. Try again.');
        }
      } else {
        logger.info('fitness.zone_trust.unlock_not_approved', {userId: token.userId});
        setError('The fingerprint was not approved.');
      }
    } catch (err) {
      logger.warn('fitness.zone_trust.unlock_failed', {userId: token.userId, error: err?.message ?? String(err)});
      if (valid(token)) setError('Fingerprint unlock is unavailable. Try again.');
    } finally {
      release(token);
    }
  }

  if (!profile) return null;
  const name = profile.displayName || profile.name || profile.id;
  const threshold = profile.zoneConfig?.find(zone => zone.id === 'active')?.min;
  const howItClears = profile.zoneReadingEligible === false
    ? 'It will be accepted once the strap sends a steady reading.'
    : `It will be accepted once ${name}'s heart rate drops below ${Number.isFinite(threshold) ? `${threshold} BPM` : 'the Active zone'}.`;

  return <>
    <AppModal
      isOpen
      onClose={() => { if (attempt.current) release(attempt.current); onClose?.(); }}
      title={`${name}'s heart rate isn't trusted yet`}
      size="md"
      className="zone-trust-dialog"
      footer={<>
        <AppButton variant="secondary" size="lg" onClick={onClose}>Close</AppButton>
        <AppButton variant="primary" size="lg" disabled={pending} onClick={unlock}
          aria-label={`Admin unlock ${name}`}>Admin unlock</AppButton>
      </>}
    >
      <p className="zone-trust-dialog__reading">
        <span className="zone-trust-dialog__bpm">{Math.round(profile.heartRate)}</span>
        <span className="zone-trust-dialog__unit">BPM</span>
      </p>
      <p>Rings and Fire don't count for {name} until this reading is accepted.</p>
      <p>{howItClears}</p>
      <p className="zone-trust-dialog__hint">An admin can accept it now with a fingerprint.</p>
      {error && <p className="zone-trust-dialog__error" role="status">{error}</p>}
    </AppModal>
    <UnlockPrompt open={pending} state={identity.unlockState} unlockedUser={identity.unlockedUser}
      lockLabel="Trust this rider’s heart rate reading" onCancel={() => {if (attempt.current) release(attempt.current);}} />
  </>;
}

ZoneTrustDialog.propTypes = {
  riderId: PropTypes.string.isRequired,
  onClose: PropTypes.func,
};
