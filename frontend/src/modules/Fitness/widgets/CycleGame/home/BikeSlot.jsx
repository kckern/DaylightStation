import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import RpmDeviceAvatar from '@/modules/Fitness/components/RpmDeviceAvatar.jsx';
import { EQUIPMENT_FALLBACK, FALLBACK_AVATAR } from './constants.js';
import './BikeSlot.scss';

/**
 * A single bike slot in the starting grid. The equipment icon is always the
 * hero; an assigned rider's avatar overlaps the bottom-right quadrant as a
 * secondary circle. Clicking the slot (empty OR filled) opens the rider picker.
 */
export function BikeSlot({ bike, person, onPick, lane }) {
  const filled = !!person;
  const rpm = Number.isFinite(bike.rpm) ? bike.rpm : 0;
  const spinDuration = rpm > 0 ? `${(60 / rpm).toFixed(2)}s` : '0s';
  return (
    <div className={`cgh-slot${filled ? ' is-filled' : ''}`} data-testid={`bike-${bike.id}`}>
      <span className="cgh-slot__lane" aria-hidden="true">{lane}</span>
      <button
        type="button"
        className="cgh-slot__main"
        onClick={() => onPick?.(bike)}
        aria-label={filled ? `Change rider for ${bike.name}` : `Assign rider to ${bike.name}`}
      >
        <span className="cgh-slot__device-wrap">
          <RpmDeviceAvatar
            className="cgh-slot__device"
            avatarSrc={bike.iconSrc}
            avatarAlt={bike.name}
            fallbackSrc={EQUIPMENT_FALLBACK}
            rpm={rpm}
            animationDuration={spinDuration}
            showValue
            renderValue={(v, isZero) => (isZero ? '' : v)}
            hideSpinnerWhenZero
          />
          {filled && (
            <span className="cgh-slot__rider-avatar">
              <CircularUserAvatar
                name={person.name}
                avatarSrc={person.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                heartRate={Number.isFinite(person.heartRate) ? person.heartRate : undefined}
                zoneId={person.zoneId || undefined}
                zoneColor={person.zoneColor || undefined}
                progress={Number.isFinite(person.progress) ? person.progress : undefined}
                size={48}
                showGauge={person.hasHR}
                showIndicator={false}
              />
            </span>
          )}
        </span>
        {!filled && (
          <span className="cgh-slot__add" aria-hidden="true">+ Add rider</span>
        )}
      </button>
    </div>
  );
}

BikeSlot.propTypes = {
  bike: PropTypes.object.isRequired,
  person: PropTypes.object,
  onPick: PropTypes.func,
  lane: PropTypes.number
};

export default BikeSlot;
