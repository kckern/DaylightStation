import React, { useCallback, useContext, useSyncExternalStore } from 'react';
import { deviceLocation, deviceName } from '../fleet/deviceDisplay.js';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';
import { useLocalPlaybackActive } from './useDispatchTargetPicker.js';

const EMPTY_FLEET = new Map();

export function busyOriginName(targetIds = [], devices = [], entries = EMPTY_FLEET) {
  if (targetIds.length !== 1) return null;
  const entry = entries.get?.(targetIds[0]);
  if (!entry || entry.offline || entry.isStale
    || !['playing', 'paused', 'buffering', 'stalled'].includes(entry.snapshot?.state)) return null;
  const origin = entry.snapshot?.meta?.origin;
  if (origin?.kind === 'device' && typeof origin.id === 'string' && origin.id) {
    const device = devices.find((candidate) => candidate.id === origin.id);
    // An unrecognised id is not human provenance; never leak or humanise it.
    return device ? deviceName(device, origin.id) : null;
  }
  if (origin?.kind === 'routine' && typeof origin.name === 'string' && origin.name.trim()) {
    return `${origin.name.trim()} routine`;
  }
  return null;
}

export function aimName(targetIds = [], devices = [], localName = null) {
  if (targetIds.length === 0) return localName ? `This device · ${localName}` : 'This device';
  if (targetIds.length > 1) return `${targetIds.length} screens`;
  const targetId = targetIds[0];
  const device = devices.find((candidate) => candidate.id === targetId);
  const location = deviceLocation(device) || device?.room?.trim?.() || '';
  return `${deviceName(device, targetId)}${location ? ` · ${location}` : ''}`;
}

export function AimLabel({
  targetIds = [], devices = [], localName = null, busyOrigin = null,
  localPlaying = false, mode = 'transfer', compact = false,
}) {
  const label = aimName(targetIds, devices, localName);
  const behavior = localPlaying && targetIds.length > 0
    ? (mode === 'fork' ? 'keep playing here too' : 'move playback')
    : null;
  return (
    <span className={`cast-aim-label${compact ? ' cast-aim-label--compact' : ''}`} data-testid="aim-label">
      <span className="cast-aim-label-prefix">Aim:</span>{' '}
      <strong>{label}</strong>
      {busyOrigin && (
        <span className="cast-aim-busy" data-testid="aim-busy-origin"> · Busy — started from {busyOrigin}</span>
      )}
      {behavior && (
        <span className="cast-aim-behavior" data-testid="aim-behavior"> · Next tap will {behavior}</span>
      )}
    </span>
  );
}

export function GlobalAimLabel({ compact = false }) {
  const { targetIds, mode } = useCastTarget();
  const { devices, store } = useFleetContext();
  const localName = useContext(ClientIdentityContext)?.displayName ?? null;
  const localPlaying = useLocalPlaybackActive();
  const subscribe = useCallback((notify) => store?.subscribeAll?.(notify) ?? (() => {}), [store]);
  const getSnapshot = useCallback(() => store?.getAll?.() ?? EMPTY_FLEET, [store]);
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <AimLabel
      targetIds={targetIds}
      devices={devices}
      localName={localName}
      busyOrigin={busyOriginName(targetIds, devices, entries)}
      localPlaying={localPlaying}
      mode={mode}
      compact={compact}
    />
  );
}

export default AimLabel;
