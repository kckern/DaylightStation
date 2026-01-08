import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import CircularUserAvatar from '../components/CircularUserAvatar.jsx';
import RpmDeviceAvatar from '../FitnessSidebar/RealtimeCards/RpmDeviceAvatar.jsx';
import { calculateRpmProgress, getRpmZoneColor } from '../FitnessSidebar/RealtimeCards/rpmUtils.mjs';
import './FullscreenVitalsOverlay.scss';

const RPM_COLOR_MAP = {
  red: '#ff6b6b',
  orange: '#ff922b',
  yellow: '#f0c836',
  green: '#51cf66',
  blue: '#6ab8ff'
};

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

const FullscreenVitalsOverlay = ({ visible = false }) => {
  const fitnessCtx = useFitnessContext();
  const [anchor, setAnchor] = useState('right');
  const {
    heartRateDevices = [],
    cadenceDevices = [],
    jumpropeDevices = [],
    getUserByDevice,
    userCurrentZones,
    zones,
    users: allUsers = [],
    usersConfigRaw = {},
    equipment = [],
    deviceConfiguration,
    userZoneProgress
  } = fitnessCtx || {};

  const equipmentMap = useMemo(() => {
    const map = {};
    if (Array.isArray(equipment)) {
      equipment.forEach((item) => {
        if (!item) return;
        // Use explicit ID from equipment config
        const equipmentId = item.id || String(item.cadence || item.speed || item.ble || '');
        const entry = {
          name: item.name || String(item.cadence || item.speed || item.ble),
          id: equipmentId,
          rpm: item.rpm,
          showRevolutions: item.showRevolutions ?? (item.type === 'jumprope')
        };
        if (item.cadence != null) {
          map[String(item.cadence)] = entry;
        }
        if (item.speed != null) {
          map[String(item.speed)] = entry;
        }
        if (item.ble != null) {
          map[String(item.ble)] = entry;
        }
      });
    }
    return map;
  }, [equipment]);

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
        const progressEntry = user?.name && userZoneProgress instanceof Map
          ? userZoneProgress.get(user.name)
          : (userZoneProgress && typeof userZoneProgress === 'object'
            ? userZoneProgress[user?.name]
            : null);
        const progressValue = typeof progressEntry?.progress === 'number'
          ? Math.max(0, Math.min(1, progressEntry.progress))
          : null;
        const effectiveZoneColor = zoneInfo.color || 'rgba(128, 128, 128, 0.6)';
        const isInactive = device.inactiveSince || device.connectionState !== 'connected';
        
        return {
          deviceId: device.deviceId,
          name: user?.name || String(device.deviceId),
          avatarSrc,
          zoneId: zoneInfo.id,
          zoneColor: effectiveZoneColor,
          heartRate: Number.isFinite(device?.heartRate) ? Math.round(device.heartRate) : null,
          isInactive,
          progressValue
        };
      });
  }, [allUsers, getUserByDevice, heartRateDevices, userCurrentZones, usersConfigRaw, zones]);

  const rpmItems = useMemo(() => {
    const cadenceConfig = deviceConfiguration?.cadence || {};
    const allRpmDevices = [
      ...(Array.isArray(cadenceDevices) ? cadenceDevices : []),
      ...(Array.isArray(jumpropeDevices) ? jumpropeDevices : [])
    ].filter((device) => device && device.deviceId != null);

    return allRpmDevices.map((device) => {
      const isJumprope = Array.isArray(jumpropeDevices)
        ? jumpropeDevices.some((j) => j.deviceId === device.deviceId)
        : false;
      const equipmentConfig = isJumprope
        ? (equipment.find((e) => e.ble === device.deviceId) || equipmentMap[String(device.deviceId)])
        : equipmentMap[String(device.deviceId)];
      const equipmentId = equipmentConfig?.id || String(device.deviceId);
      const rpmThresholds = equipmentConfig?.rpm || { min: 30, med: 60, high: 80, max: 100 };
      const rpm = Math.max(0, Math.round(device.cadence || 0));
      const zoneColor = getRpmZoneColor(rpm, rpmThresholds);
      const colorKey = cadenceConfig[String(device.deviceId)];
      const resolvedRingColor = colorKey ? (RPM_COLOR_MAP[colorKey] || colorKey) : zoneColor;

      return {
        deviceId: device.deviceId,
        rpm,
        equipmentId,
        rpmThresholds,
        deviceSubtype: isJumprope ? 'jumprope' : 'cycle',
        revolutionCount: device.revolutionCount ?? 0,
        zoneColor: resolvedRingColor
      };
    }).sort((a, b) => {
      const aProgress = calculateRpmProgress(a.rpm, a.rpmThresholds);
      const bProgress = calculateRpmProgress(b.rpm, b.rpmThresholds);
      return bProgress - aProgress;
    });
  }, [cadenceDevices, jumpropeDevices, equipmentMap, equipment, deviceConfiguration?.cadence]);

  const handleToggleAnchor = useCallback((event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setAnchor((prev) => (prev === 'right' ? 'left' : 'right'));
  }, []);

  if (!visible || (!hrItems.length && !rpmItems.length)) {
    return null;
  }

  const overlayClassName = `fullscreen-vitals-overlay anchor-${anchor}`;

  return (
    <div
      className={overlayClassName}
      aria-hidden={!visible}
      onClick={handleToggleAnchor}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          handleToggleAnchor(event);
        }
      }}
    >
      {hrItems.length > 0 && (
        <div className={`fullscreen-vitals-group hr-group count-${hrItems.length}`}>
          {hrItems.map((item) => (
            <CircularUserAvatar
              key={`hr-${item.deviceId}`}
              name={item.name}
              avatarSrc={item.avatarSrc}
              fallbackSrc={DaylightMediaPath('/media/img/users/user')}
              heartRate={item.heartRate}
              zoneId={item.zoneId}
              zoneColor={item.zoneColor}
              progress={item.progressValue}
              className={item.isInactive ? 'inactive' : ''}
              showIndicator={item.progressValue !== null}
            />
          ))}
        </div>
      )}
      {rpmItems.length > 0 && (
        <div className={`fullscreen-vitals-group rpm-group count-${rpmItems.length}`}>
          {rpmItems.map((item) => (
            <div key={`rpm-${item.deviceId}`} className="fullscreen-rpm-item">
              <RpmDeviceAvatar
                equipmentId={item.equipmentId}
                equipmentName=""
                rpm={item.rpm}
                revolutionCount={item.revolutionCount}
                rpmThresholds={item.rpmThresholds}
                deviceSubtype={item.deviceSubtype}
                size={68}
              />
              <div className="rpm-value-overlay" style={{ color: item.zoneColor }}>
                <span className="rpm-value">{item.rpm}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

FullscreenVitalsOverlay.propTypes = {
  visible: PropTypes.bool
};

export default FullscreenVitalsOverlay;
