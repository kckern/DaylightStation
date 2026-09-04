import React from 'react';
import { IconHeartFilled } from '@tabler/icons-react';
import { cssColorForStrap, hashColorForDevice } from '../lib/strapColors.js';
import './HeartIcon.scss';

/** Fixed SVG geometry, independent of browser emoji fonts and text baselines. */
export default function HeartIcon({ color, deviceId, label }) {
  const fill = cssColorForStrap(color)
    || (deviceId != null ? hashColorForDevice(deviceId) : cssColorForStrap('orange'));
  return (
    <span className="fitness-heart-icon" style={{ color: fill }}
      role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <IconHeartFilled size={18} aria-hidden="true" focusable="false" />
    </span>
  );
}
