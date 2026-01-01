import React, { useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../../../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import { slugifyId } from '../../../../../hooks/useFitnessSession.js';
import CircularUserAvatar from '../../../components/CircularUserAvatar.jsx';
import RpmDeviceAvatar from '../../../components/RpmDeviceAvatar.jsx';
import './FullscreenVitalsOverlay.scss';

const RPM_COLOR_MAP = {
  red: '#ff6b6b',
  orange: '#ff922b',
  yellow: '#f0c836',
  green: '#51cf66',
  blue: '#6ab8ff'
};

const withAlpha = (hexColor, alpha = 0.9) => {
  if (!hexColor || typeof hexColor !== 'string') {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const normalized = hexColor.trim();
  if (!normalized.startsWith('#') || (normalized.length !== 7 && normalized.length !== 4)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const expand = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;
  const r = parseInt(expand.slice(1, 3), 16);
  const g = parseInt(expand.slice(3, 5), 16);
  const b = parseInt(expand.slice(5, 7), 16);
  if ([r, g, b].some(Number.isNaN)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

/**
 * FullscreenVitalsOverlay - Shows heart rate and RPM avatars in fullscreen mode
 * 
 * @param {boolean} visible - Whether the overlay should be visible
 */
const FullscreenVitalsOverlay = ({ visible = false }) => {
  const fitnessCtx = useFitnessContext();
  const [anchor, setAnchor] = useState('right');
  const {
    heartRateDevices = [],
    cadenceDevices = [],
    getUserByDevice,
    userCurrentZones,
    zones,
    users: allUsers = [],
    usersConfigRaw = {},
    equipment = [],
    deviceConfiguration,
    userZoneProgress,
    getDeviceAssignment,
    deviceAssignments = []
  } = fitnessCtx || {};

  const equipmentMap = useMemo(() => {
    const map = {};
    if (Array.isArray(equipment)) {
      equipment.forEach((item) => {
        if (!item) return;
        const slugSource = item.id || item.name || null;
        const equipmentSlug = slugSource ? slugifyId(slugSource, 'equipment') : null;
        if (item.cadence != null) {
          map[String(item.cadence)] = {
            name: item.name || String(item.cadence),
            slug: equipmentSlug || String(item.cadence)
          };
        }
        if (item.speed != null) {
          map[String(item.speed)] = {
            name: item.name || String(item.speed),
            slug: equipmentSlug || String(item.speed)
          };
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
  }, [allUsers, getUserByDevice, heartRateDevices, userCurrentZones, usersConfigRaw, zones, userZoneProgress]);

  const rpmItems = useMemo(() => {
    if (!Array.isArray(cadenceDevices)) return [];
    const cadenceConfig = deviceConfiguration?.cadence || {};
    return cadenceDevices
      .filter((device) => device && device.deviceId != null)
      .map((device) => {
        const assignment = typeof getDeviceAssignment === 'function'
          ? getDeviceAssignment(device.deviceId)
          : deviceAssignments.find((entry) => String(entry.deviceId) === String(device.deviceId));
        const baseUser = typeof getUserByDevice === 'function'
          ? getUserByDevice(device.deviceId)
          : allUsers.find((u) => String(u.cadenceDeviceId) === String(device.deviceId));
        const equipmentInfo = equipmentMap[String(device.deviceId)] || {};
        const equipmentSlug = equipmentInfo.slug
          || (assignment?.metadata?.equipmentId ? slugifyId(assignment.metadata.equipmentId, 'equipment') : null)
          || slugifyId(assignment?.occupantName || assignment?.metadata?.name || baseUser?.name || device.deviceId, 'equipment');
        const avatarSrc = DaylightMediaPath(`/media/img/equipment/${equipmentSlug}`);
        const rpm = Math.max(0, Math.round(device.cadence || 0));
        const animationDuration = rpm > 0 ? `${270 / rpm}s` : '0s';
        const colorKey = cadenceConfig[String(device.deviceId)];
        const resolvedRingColor = colorKey
          ? (RPM_COLOR_MAP[colorKey] || colorKey)
          : RPM_COLOR_MAP.orange;
        const overlayBg = withAlpha(resolvedRingColor, 0.9);
        return {
          deviceId: device.deviceId,
          rpm,
          avatarSrc,
          animationDuration,
          ringColor: resolvedRingColor,
          overlayBg
        };
      });
  }, [cadenceDevices, equipmentMap, deviceConfiguration?.cadence, getUserByDevice, allUsers, getDeviceAssignment, deviceAssignments]);

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
            <RpmDeviceAvatar
              key={`rpm-${item.deviceId}`}
              baseClassName={null}
              className="vital-rpm"
              rpm={item.rpm}
              animationDuration={item.animationDuration}
              avatarSrc={item.avatarSrc}
              avatarAlt=""
              style={{
                '--rpm-ring-color': item.ringColor,
                '--rpm-overlay-bg': item.overlayBg
              }}
              fallbackSrc={DaylightMediaPath('/media/img/equipment/equipment')}
              renderValue={(value) => (Number.isFinite(value) ? value : 0)}
            />
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
