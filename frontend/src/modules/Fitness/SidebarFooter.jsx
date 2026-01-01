import React from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import CircularUserAvatar from './components/CircularUserAvatar.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import './SidebarFooter.scss';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

const SidebarFooter = ({ onContentSelect, onAvatarClick }) => {
  const { 
    connected, 
    heartRateDevices, 
    deviceConfiguration,
    participantRoster,
    participantsByDevice,
    hrColorMap: contextHrColorMap,
    usersConfigRaw,
    userCurrentZones,
    zones,
    userZoneProgress,
    getUserByDevice,
    launchApp
  } = useFitnessContext();
  const inactiveTimeout = deviceConfiguration?.timeout?.inactive ?? 60000;

  const userProfileIdMap = React.useMemo(() => {
    const map = new Map();
    const addKey = (label, profileId) => {
      if (!label || !profileId) return;
      const key = String(label).trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, profileId);
      }
    };
    const addFrom = (arr) => {
      if (!Array.isArray(arr)) return;
      arr.forEach((cfg) => {
        if (!cfg?.name) return;
        const profileId = cfg.id || slugifyId(cfg.name);
        addKey(cfg.name, profileId);
        if (cfg.group_label) {
          addKey(cfg.group_label, profileId);
        }
      });
    };
    addFrom(usersConfigRaw?.primary);
    addFrom(usersConfigRaw?.secondary);
    addFrom(usersConfigRaw?.family);
    addFrom(usersConfigRaw?.friends);
    return map;
  }, [usersConfigRaw]);

  const getConfiguredProfileId = React.useCallback((name) => {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    if (!key) return null;
    return userProfileIdMap.get(key) || null;
  }, [userProfileIdMap]);

  const computeDeviceActive = React.useCallback((device) => {
    if (!device) return false;
    const lastSeen = Number(device.lastSeen ?? device.timestamp);
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) return true;
    return (Date.now() - lastSeen) <= inactiveTimeout;
  }, [inactiveTimeout]);
  
  // Build color map from context
  const hrColorMap = React.useMemo(() => {
    const direct = contextHrColorMap || {};
    if (direct && Object.keys(direct).length > 0) return direct;
    const fallbackSrc = deviceConfiguration?.hr || {};
    const rebuilt = {};
    Object.keys(fallbackSrc).forEach(k => { rebuilt[String(k)] = fallbackSrc[k]; });
    return rebuilt;
  }, [contextHrColorMap, deviceConfiguration]);

  // Map deviceId -> user name
  const hrOwnerMap = React.useMemo(() => {
    const map = {};
    participantRoster.forEach((participant) => {
      if (participant?.hrDeviceId !== undefined && participant?.hrDeviceId !== null) {
        map[String(participant.hrDeviceId)] = participant.name;
      }
    });
    if (participantsByDevice && typeof participantsByDevice.forEach === 'function') {
      participantsByDevice.forEach((participant, key) => {
        if (!participant || key == null) return;
        if (!map[String(key)] && participant.name) {
          map[String(key)] = participant.name;
        }
      });
    }
    if (Object.keys(map).length === 0 && usersConfigRaw) {
      const addFrom = (arr) => Array.isArray(arr) && arr.forEach(cfg => {
        if (cfg && (cfg.hr !== undefined && cfg.hr !== null)) {
          map[String(cfg.hr)] = cfg.name;
        }
      });
      addFrom(usersConfigRaw.primary);
      addFrom(usersConfigRaw.secondary);
    }
    return map;
  }, [participantRoster, usersConfigRaw]);

  // Map deviceId -> user ID for avatars, plus participant lookup convenience
  const { userIdMap, participantByHrId } = React.useMemo(() => {
    const participantMap = new Map();
    const map = {};
    participantRoster.forEach((participant) => {
      const profileId = participant.profileId
        || getConfiguredProfileId(participant?.name)
        || (participant?.name ? slugifyId(participant.name) : null);
      if (participant?.hrDeviceId !== undefined && participant?.hrDeviceId !== null) {
        const normalized = String(participant.hrDeviceId);
        map[normalized] = profileId || 'user';
        participantMap.set(normalized, participant);
      }
    });
    if (participantsByDevice && typeof participantsByDevice.forEach === 'function') {
      participantsByDevice.forEach((participant, key) => {
        if (!participant || key == null) return;
        const normalized = String(key);
        if (!participantMap.has(normalized)) {
          participantMap.set(normalized, participant);
        }
        if (!map[normalized]) {
          const profileId = participant.profileId
            || getConfiguredProfileId(participant?.name)
            || (participant?.name ? slugifyId(participant.name) : null);
          map[normalized] = profileId || 'user';
        }
      });
    }
    if (usersConfigRaw) {
      const addFrom = (arr) => Array.isArray(arr) && arr.forEach((cfg) => {
        if (cfg?.hr === undefined || cfg.hr === null) return;
        const normalized = String(cfg.hr);
        if (!map[normalized]) {
          const profileId = cfg.id || slugifyId(cfg.name);
          map[normalized] = profileId || 'user';
        }
      });
      addFrom(usersConfigRaw.primary);
      addFrom(usersConfigRaw.secondary);
    }
    return { userIdMap: map, participantByHrId: participantMap };
  }, [participantRoster, participantsByDevice, usersConfigRaw, getConfiguredProfileId]);

  const zoneProgressMap = React.useMemo(() => {
    if (!userZoneProgress) return new Map();
    if (userZoneProgress instanceof Map) return userZoneProgress;
    const entries = Object.entries(userZoneProgress);
    return new Map(entries);
  }, [userZoneProgress]);

  // Build color -> zoneId map from zones config
  const colorToZoneId = React.useMemo(() => {
    const map = {};
    (zones || []).forEach(z => {
      if (z?.color && z?.id) {
        map[String(z.color).toLowerCase()] = String(z.id).toLowerCase();
      }
    });
    return map;
  }, [zones]);

  // Fallback zone derivation using configured zones + per-user overrides
  const deriveZoneFromHR = React.useCallback((hr, userName) => {
    if (!hr || hr <= 0 || !Array.isArray(zones) || zones.length === 0) return null;
    const cfg = usersConfigRaw?.primary?.find(u => u.name === userName) 
      || usersConfigRaw?.secondary?.find(u => u.name === userName);
    const overrides = cfg?.zones || {};
    const sorted = [...zones].sort((a,b) => b.min - a.min);
    for (const z of sorted) {
      const overrideMin = overrides[z.id];
      const min = (typeof overrideMin === 'number') ? overrideMin : z.min;
      if (hr >= min) return { id: z.id, color: z.color };
    }
    return null;
  }, [zones, usersConfigRaw]);

  const getZoneClass = (device) => {
    if (device.type !== 'heart_rate') return 'no-zone';
    const zoneId = getDeviceZoneId(device);
    return zoneId ? `zone-${zoneId}` : 'no-zone';
  };

  // Helper: derive canonical zone id (cool..fire) for a heart rate device or null
  const canonicalZones = ['cool','active','warm','hot','fire'];
  const zoneRankMap = { cool:0, active:1, warm:2, hot:3, fire:4 };
  const resolveDeviceKey = React.useCallback((device) => {
    if (!device) return null;
    const candidates = [device.deviceId, device.id, device.device_id, device.hrDeviceId];
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null) {
        return String(candidate);
      }
    }
    return null;
  }, []);
  const resolveDeviceParticipant = React.useCallback((device) => {
    const key = resolveDeviceKey(device);
    if (!key) {
      return { key: null, userName: null };
    }
    let participant = participantByHrId.get(key) || null;
    if (!participant && typeof getUserByDevice === 'function') {
      const fallback = getUserByDevice(key);
      if (fallback?.name) {
        participant = fallback;
      }
    }
    const userName = participant?.name || null;
    return { key, userName };
  }, [participantByHrId, getUserByDevice, resolveDeviceKey]);

  const getDeviceZoneId = React.useCallback((device) => {
    if (device.type !== 'heart_rate') return null;
    const { key, userName } = resolveDeviceParticipant(device);
    if (!key || !userName) return null;
    const entry = userCurrentZones?.[userName];
    let zoneId = null;
    let color = null;
    if (entry) {
      zoneId = (typeof entry === 'object') ? entry.id : null;
      color = (typeof entry === 'object') ? entry.color : entry;
      if (!zoneId && color) {
        zoneId = colorToZoneId[String(color).toLowerCase()] || String(color).toLowerCase();
      }
    }
    if ((!zoneId || !canonicalZones.includes(zoneId)) && device.heartRate) {
      const derived = deriveZoneFromHR(device.heartRate, userName);
      if (derived) {
        zoneId = derived.id;
      }
    }
    if (!zoneId) {
      return null;
    }
    zoneId = zoneId.toLowerCase();
    return canonicalZones.includes(zoneId) ? zoneId : null;
  }, [resolveDeviceParticipant, userCurrentZones, colorToZoneId, deriveZoneFromHR]);

  const getDeviceZoneColor = React.useCallback((device) => {
    if (device.type !== 'heart_rate') return null;
    const { key, userName } = resolveDeviceParticipant(device);
    if (!key || !userName) return null;
    const entry = userCurrentZones?.[userName];
    if (entry) {
      if (typeof entry === 'object' && entry.color) {
        return entry.color;
      }
      if (typeof entry === 'string') {
        return entry;
      }
    }
    if (device.heartRate) {
      const derived = deriveZoneFromHR(device.heartRate, userName);
      if (derived?.color) {
        return derived.color;
      }
    }
    return null;
  }, [resolveDeviceParticipant, userCurrentZones, deriveZoneFromHR]);

  const sortedDevices = React.useMemo(() => {
    const hrDevices = heartRateDevices ? [...heartRateDevices] : [];

    // Sort heart rate devices: zone rank DESC (fire top, cool bottom), then HR DESC, then active status as tertiary
    hrDevices.sort((a, b) => {
      const aZone = getDeviceZoneId(a);
      const bZone = getDeviceZoneId(b);
      const aRank = aZone ? zoneRankMap[aZone] : -1; // unknown below cool
      const bRank = bZone ? zoneRankMap[bZone] : -1;
      if (bRank !== aRank) return bRank - aRank; // higher rank first
      // Within same zone: heart rate descending
      const hrDelta = (b.heartRate || 0) - (a.heartRate || 0);
      if (hrDelta !== 0) return hrDelta;
      // Tertiary: active devices first
      const aActive = computeDeviceActive(a);
      const bActive = computeDeviceActive(b);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      // Stable fallback by deviceId
      const aKey = resolveDeviceKey(a) || '';
      const bKey = resolveDeviceKey(b) || '';
      return aKey.localeCompare(bKey);
    });

    // Only keep the single top performer to prevent growth
    return hrDevices.length > 1 ? hrDevices.slice(0, 1) : hrDevices;
  }, [heartRateDevices, getDeviceZoneId, zoneRankMap, resolveDeviceKey, computeDeviceActive]);

  return (
    <div className="sidebar-footer">
      <div className="device-container">
        {sortedDevices.map((device, index) => {
          const deviceKey = resolveDeviceKey(device) || `device-${index}`;
          let ownerName = device.type === 'heart_rate' ? hrOwnerMap[deviceKey] : null;
          if (!ownerName && typeof getUserByDevice === 'function') {
            const user = getUserByDevice(deviceKey);
            ownerName = user?.name || ownerName;
          }
          let profileId = device.type === 'heart_rate' 
            ? (userIdMap[deviceKey] || getConfiguredProfileId(ownerName) || 'user')
            : 'user';
          if (device.type === 'heart_rate' && profileId === 'user' && ownerName) {
            profileId = getConfiguredProfileId(ownerName) || slugifyId(ownerName, 'user');
          }
          if (device.type === 'heart_rate' && (!ownerName || profileId === 'user')) {
            console.warn('[SidebarFooter] Missing avatar data', {
              deviceKey,
              ownerName,
              profileId,
              participantRosterSize: participantRoster?.length || 0,
              heartRate: device.heartRate
            });
          }
          const heartRate = device.type === 'heart_rate' && device.heartRate ? device.heartRate : null;
          const zoneId = getDeviceZoneId(device);
          const zoneColor = getDeviceZoneColor(device) || null;
          const progressEntry = ownerName ? zoneProgressMap.get(ownerName) : null;
          const progressValue = typeof progressEntry?.progress === 'number'
            ? Math.max(0, Math.min(1, progressEntry.progress))
            : null;
          const cardZoneClass = getZoneClass(device);
          const isActive = computeDeviceActive(device);
          const cardClasses = ['device-card', cardZoneClass, isActive ? 'active' : 'inactive']
            .filter(Boolean)
            .join(' ');

          const handleAvatarClick = (e) => {
            e.stopPropagation();
            if (onAvatarClick) {
              onAvatarClick({ deviceKey, ownerName, profileId });
            } else {
              // Default: launch fitness_cam plugin
              launchApp?.('fitness_cam', { mode: 'standalone' });
            }
          };
          
          return (
            <div
              key={deviceKey}
              className={cardClasses}
              onPointerDown={() => onContentSelect && onContentSelect('users')}
            >
              {device.type === 'heart_rate' ? (
                <CircularUserAvatar
                  name={ownerName || deviceKey}
                  avatarSrc={DaylightMediaPath(`/media/img/users/${profileId}`)}
                  fallbackSrc={DaylightMediaPath('/media/img/users/user')}
                  heartRate={heartRate}
                  zoneId={zoneId}
                  zoneColor={zoneColor}
                  progress={progressValue}
                  opacity={isActive ? 1 : 0.6}
                  size="100%"
                  ringWidth={8}
                  showIndicator={false}
                  ariaLabel={ownerName ? `${ownerName} heart rate` : undefined}
                  onClick={handleAvatarClick}
                  role="button"
                />
              ) : (
                <div className="device-icon-fallback">
                  {device.type === 'power' && '⚡'}
                  {device.type === 'cadence' && '⚙️'}
                  {device.type === 'speed' && '🚴'}
                  {!['power', 'cadence', 'speed'].includes(device.type) && '📡'}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {sortedDevices.length === 0 && (
        <div
          className={`device-card fitness-monitor ${connected ? 'connected' : 'disconnected'}`}
          onPointerDown={() => window.location.reload()}
          style={{ cursor: 'pointer' }}
          title="Refresh page"
        >
          <div className="device-icon">🔄</div>
          <div className="connection-status">
            <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SidebarFooter;