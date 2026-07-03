import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { GhostIcon } from './icons.jsx';
import { FALLBACK_AVATAR } from './constants.js';
import './GhostSlot.scss';

/**
 * A phantom lane in the starting grid for a selected ghost rider — same
 * `.cgh-slot` footprint as a real BikeSlot so it reads as an extra rider in
 * the SAME row, not a separate/secondary UI. There is no physical bike (no
 * RPM device, nothing to click/assign), so this is display-only.
 *
 * Audit C6: ghosts used to be invisible from selection until they
 * materialized mid-race (a "vs Name" chip on the race-type picker was the
 * only pre-race trace) — the starting grid, ready strip, and countdown
 * mapped physical bikes only. User feedback (2026-07-02): if a ghost is
 * racing, it should appear in the pre-race screen with the real riders.
 */
export function GhostSlot({ rider, lane }) {
  return (
    <div className="cgh-slot cgh-slot--ghost" data-testid={`ghost-slot-${rider.userId}`}>
      <span className="cgh-slot__lane" aria-hidden="true">{lane}</span>
      <span className="cgh-slot__main cgh-slot__main--ghost">
        <span className="cgh-slot__device-wrap">
          <span className="cgh-slot__rider-avatar cgh-slot__rider-avatar--ghost cg-ghost">
            <CircularUserAvatar
              name={rider.displayName}
              avatarSrc={rider.avatarSrc}
              fallbackSrc={FALLBACK_AVATAR}
              size={48}
              showIndicator={false}
            />
          </span>
        </span>
        <span className="cgh-slot__ghost-badge" aria-hidden="true"><GhostIcon /></span>
        <span className="cgh-slot__ghost-name">{rider.displayName}</span>
      </span>
    </div>
  );
}

GhostSlot.propTypes = {
  rider: PropTypes.shape({
    userId: PropTypes.string.isRequired,
    displayName: PropTypes.string,
    avatarSrc: PropTypes.string,
  }).isRequired,
  lane: PropTypes.number,
};

export default GhostSlot;
