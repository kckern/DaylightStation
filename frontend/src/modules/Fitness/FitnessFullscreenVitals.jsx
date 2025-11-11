import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';

const canonicalZones = ['cool', 'active', 'warm', 'hot', 'fire'];

const resolveUserZone = (userName, device, context) => {
  if (!userName) return { id: null, color: null };
  const { userCurrentZones, zones = [], usersConfigRaw } = context;
  const entry = userCurrentZones?.[userName];
  let zoneId = null;
  let color = null;

  if (entry) {
    if (typeof entry === 'object') {
      zoneId = entry.id || null;
      color = entry.color || null;
    } else if (typeof entry === 'string') {
      color = entry;
    }
  }

  if (color && !zoneId) {
    const normalizedColor = String(color).toLowerCase();
    zoneId = zones.find((z) => String(z.color).toLowerCase() === normalizedColor)?.id || normalizedColor;
  }

  if ((!zoneId || !canonicalZones.includes(zoneId)) && device?.heartRate) {
    const cfg = usersConfigRaw?.primary?.find((u) => u.name === userName)
      || usersConfigRaw?.secondary?.find((u) => u.name === userName);
    const overrides = cfg?.zones || {};
    const sorted = [...zones].sort((a, b) => b.min - a.min);
    for (const z of sorted) {
      const min = typeof overrides[z.id] === 'number' ? overrides[z.id] : z.min;
      if (device.heartRate >= min) {
        zoneId = z.id;
        color = z.color;
        break;
      }
    }
  }

  return {
    id: zoneId && canonicalZones.includes(zoneId) ? zoneId : null,
    color: color || null
  };
};

const getProfileSlug = (user) => {
  if (!user) return 'user';
  if (user.id) return user.id;
  if (user.name) {
    return user.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'user';
  }
  return 'user';
};

const FitnessFullscreenVitals = ({ visible = false }) => {
  const fitnessCtx = useFitnessContext();
  const {
    heartRateDevices = [],
    cadenceDevices = [],
    getUserByDevice,
    userCurrentZones,
    zones,
    users: allUsers = [],
    usersConfigRaw = {}
  } = fitnessCtx || {};

  const hrItems = useMemo(() => {
    if (!Array.isArray(heartRateDevices)) return [];
    return heartRateDevices
      .filter((device) => device && device.deviceId != null)
      .map((device) => {
        const user = typeof getUserByDevice === 'function'
          ? getUserByDevice(device.deviceId)
          : allUsers.find((u) => String(u.hrDeviceId) === String(device.deviceId));
        const zoneInfo = resolveUserZone(user?.name, device, { userCurrentZones, zones, usersConfigRaw });
        const profileSlug = getProfileSlug(user);
        const avatarSrc = DaylightMediaPath(`/media/img/users/${profileSlug}`);
        return {
          deviceId: device.deviceId,
          name: user?.name || String(device.deviceId),
          avatarSrc,
          zoneId: zoneInfo.id,
          zoneColor: zoneInfo.color
        };
      });
  }, [allUsers, getUserByDevice, heartRateDevices, userCurrentZones, usersConfigRaw, zones]);

  const rpmItems = useMemo(() => {
    if (!Array.isArray(cadenceDevices)) return [];
    return cadenceDevices
      .filter((device) => device && device.deviceId != null)
      .map((device) => ({
        deviceId: device.deviceId,
        rpm: Math.max(0, Math.round(device.cadence || 0))
      }));
  }, [cadenceDevices]);

  if (!visible || (!hrItems.length && !rpmItems.length)) {
    return null;
  }

  return (
    <div className="fullscreen-vitals-overlay" aria-hidden={!visible}>
      {hrItems.length > 0 && (
        <div className={`fullscreen-vitals-group hr-group count-${hrItems.length}`}>
          {hrItems.map((item) => (
            <div
              key={`hr-${item.deviceId}`}
              className={`vital-avatar zone-${item.zoneId || 'neutral'}`}
              style={item.zoneColor ? { '--vital-ring-color': item.zoneColor } : undefined}
            >
              <img
                src={item.avatarSrc}
                alt=""
                onError={(event) => {
                  const img = event.currentTarget;
                  if (img.dataset.fallback) {
                    img.style.display = 'none';
                    return;
                  }
                  img.dataset.fallback = '1';
                  img.src = DaylightMediaPath('/media/img/users/user');
                }}
              />
            </div>
          ))}
        </div>
      )}
      {rpmItems.length > 0 && (
        <div className={`fullscreen-vitals-group rpm-group count-${rpmItems.length}`}>
          {rpmItems.map((item) => (
            <div key={`rpm-${item.deviceId}`} className="vital-rpm">
              <span className="vital-rpm-value">{item.rpm}</span>
              <span className="vital-rpm-label">RPM</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

FitnessFullscreenVitals.propTypes = {
  visible: PropTypes.bool
};

export default FitnessFullscreenVitals;
