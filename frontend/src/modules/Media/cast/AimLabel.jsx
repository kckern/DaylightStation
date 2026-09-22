import React from 'react';
import { deviceLocation, deviceName } from '../fleet/deviceDisplay.js';

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

export default AimLabel;
