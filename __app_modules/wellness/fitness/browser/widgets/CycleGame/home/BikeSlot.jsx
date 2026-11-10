import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from "../../../components/CircularUserAvatar.jsx";
import RpmDeviceAvatar from "../../../components/RpmDeviceAvatar.jsx";
import { EQUIPMENT_FALLBACK, FALLBACK_AVATAR } from "./constants.js";
import { SensorWarnIcon, ReadyTickIcon } from "./icons.jsx";
import "./BikeSlot.scss";

/**
 * A single bike slot in the starting grid. The equipment icon is always the
 * hero; an assigned rider's avatar overlaps the bottom-right quadrant as a
 * secondary circle. Clicking the slot (empty OR filled) opens the rider picker.
 */
export function BikeSlot({ bike, person, onPick, lane, disabled = false }) {
  const filled = !!person;
  const rpm = Number.isFinite(bike.rpm) ? bike.rpm : 0;
  const spinDuration = rpm > 0 ? `${(60 / rpm).toFixed(2)}s` : '0s';
  // sensorLive: true = reporting, false = silent, undefined = unknown (shows nothing).
  const noSignal = filled && bike.sensorLive === false;
  const ready = filled && bike.sensorLive === true;
  return (
    <div className={`cgh-slot${filled ? ' is-filled' : ''}${noSignal ? ' is-no-signal' : ''}`} data-testid={`bike-${bike.id}`}>
      <span className="cgh-slot__lane" aria-hidden="true">{lane}</span>
      <button
        type="button"
        className="cgh-slot__main"
        disabled={disabled}
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
        {filled && <span className="cgh-slot__name">{person.name}</span>}
      </button>
      {noSignal && (
        <span className="cgh-slot__signal cgh-slot__signal--none" data-testid={`bike-${bike.id}-no-signal`}>
          <SensorWarnIcon />No signal
        </span>
      )}
      {ready && (
        <span className="cgh-slot__signal cgh-slot__signal--ok">
          <ReadyTickIcon />Ready
        </span>
      )}
    </div>
  );
}

BikeSlot.propTypes = {
  bike: PropTypes.object.isRequired,
  person: PropTypes.object,
  onPick: PropTypes.func,
  disabled: PropTypes.bool,
  lane: PropTypes.number
};

export default BikeSlot;
