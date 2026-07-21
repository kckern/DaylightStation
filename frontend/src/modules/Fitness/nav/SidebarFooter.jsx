import React from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import CircularUserAvatar from '../components/CircularUserAvatar.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './SidebarFooter.scss';

import getLogger from '@/lib/logging/Logger.js';
import useLongPress from '../lib/useLongPress.js';
import hardReload from '../lib/hardReload.js';
import { lookupZoneProgress } from '@/modules/Fitness/domain/zoneProgressIndex.js';

// Note: slugifyId has been removed - we now use explicit IDs from config

// Stable identity so a missing index doesn't churn the memos that read it.
const EMPTY_ZONE_PROGRESS_INDEX = new Map();

const SidebarFooter = ({ onContentSelect, onAvatarClick }) => {
  const { 
    connected, 
    heartRateDevices, 
    activeHeartRateParticipants, // Phase 1 SSOT: Canonical participant list
    deviceConfiguration,
    participantRoster,
    participantsByDevice,
    hrColorMap: contextHrColorMap,
    usersConfigRaw,
    userCurrentZones,
    zones,
    zoneProgressIndex,
    getUserByDevice,
    fitnessPlayQueue
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
        const profileId = cfg.profileId || cfg.id;
        if (!profileId) return; // Skip if no valid profile ID
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
    if (!device) return false;    // Prefer explicit active state if available (from Roster/ActivityMonitor)
    if (device.hrInactive) return false;
    if (device.isActive !== undefined) return device.isActive;
    
    // Fallback to timestamp check    const lastSeen = Number(device.lastSeen ?? device.timestamp);
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
      // Support multiple HR device IDs per user
      const deviceIds = participant?.hrDeviceIds || (participant?.hrDeviceId != null ? [participant.hrDeviceId] : []);
      for (const devId of deviceIds) {
        map[String(devId)] = participant.name;
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
        if (cfg) {
          const ids = cfg.hr_device_ids || (cfg.hr != null ? [cfg.hr] : []);
          for (const id of ids) map[String(id)] = cfg.name;
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
        || participant.id
        || getConfiguredProfileId(participant?.name);
      // Support multiple HR device IDs per user
      const deviceIds = participant?.hrDeviceIds || (participant?.hrDeviceId != null ? [participant.hrDeviceId] : []);
      for (const devId of deviceIds) {
        const normalized = String(devId);
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
            || participant.id
            || getConfiguredProfileId(participant?.name);
          map[normalized] = profileId || 'user';
        }
      });
    }
    if (usersConfigRaw) {
      const addFrom = (arr) => Array.isArray(arr) && arr.forEach((cfg) => {
        if (cfg?.hr === undefined || cfg.hr === null) return;
        const normalized = String(cfg.hr);
        if (!map[normalized]) {
          const profileId = cfg.profileId || cfg.id;
          map[normalized] = profileId || 'user';
        }
      });
      addFrom(usersConfigRaw.primary);
      addFrom(usersConfigRaw.secondary);
    }
    return { userIdMap: map, participantByHrId: participantMap };
  }, [participantRoster, participantsByDevice, usersConfigRaw, getConfiguredProfileId]);

  // `zoneProgressIndex` from context is already a Map aliased by profileId,
  // deviceId(s), name and displayLabel — no local normalization needed. Resolve
  // through lookupZoneProgress() with a stable ID first wherever one is on hand.
  const zoneProgressMap = zoneProgressIndex || EMPTY_ZONE_PROGRESS_INDEX;

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
    // activeHeartRateParticipants is PRE-SORTED by sortByZoneRank in FitnessContext
    // (the sorting SSOT). Do not re-sort — a second comparator is exactly what
    // desynced order from card display in the 2026-07-21 bug. The comparator that
    // used to live here also ranked on the COMMITTED (hysteresis-smoothed) zone via
    // getDeviceZoneId, so it actively disagreed with the SSOT's live-zone order.
    // The top performer is simply the first entry.
    const hrDevices = activeHeartRateParticipants || [];
    return hrDevices.length > 1 ? hrDevices.slice(0, 1) : [...hrDevices];
  }, [activeHeartRateParticipants]);

  const isVideoPlaying = Array.isArray(fitnessPlayQueue) && fitnessPlayQueue.length > 0;

  const handleContainerClick = React.useCallback(() => {
    console.log('[SidebarFooter] device-container clicked', { 
      hasOnAvatarClick: Boolean(onAvatarClick), 
      hasOnContentSelect: Boolean(onContentSelect),
      deviceCount: sortedDevices.length,
      isVideoPlaying
    });
    if (onAvatarClick) {
      // Pass first device info if available
      const device = sortedDevices[0];
      if (device) {
        const deviceKey = resolveDeviceKey(device);
        const ownerName = hrOwnerMap[deviceKey] || null;
        const profileId = userIdMap[deviceKey] || 'user';
        onAvatarClick({ deviceKey, ownerName, profileId });
      }
    } else if (onContentSelect && !isVideoPlaying) {
      // Only navigate when NOT in video playback mode.
      // During playback, FitnessPlayer already shows FitnessSidebar with users.
      // Navigating to 'users' view would cause duplicate sidebars.
      console.log('[SidebarFooter] navigating to users view (fitness_session module)');
      onContentSelect('view_direct', { view: 'users' });
    }
  }, [onAvatarClick, onContentSelect, sortedDevices, resolveDeviceKey, hrOwnerMap, userIdMap, isVideoPlaying]);

  // Long-press (2s) anywhere on the footer card hard-reloads the kiosk — the
  // only touch path to a cache-bypassing refresh once an avatar has replaced
  // the 🔄 card. A short tap falls through to the normal click behavior.
  const { holding, handlers: longPressHandlers } = useLongPress({
    onTap: handleContainerClick,
    onLongPress: () => hardReload('footer-longpress'),
    holdMs: 2000
  });

  return (
    <div className="sidebar-footer">
      <div
        className={`device-container${holding ? ' is-hold-reloading' : ''}`}
        {...longPressHandlers}
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
      >
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
          if (device.type === 'heart_rate' && (!ownerName || profileId === 'user')) {
            getLogger().warn('fitness.sidebar.avatar.missing_data', {
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
          const progressEntry = lookupZoneProgress(zoneProgressMap, {
            profileId: device.profileId,
            id: device.id,
            name: ownerName,
            displayLabel: device.displayLabel,
            deviceId: deviceKey
          });
          const progressValue = typeof progressEntry?.progress === 'number'
            ? Math.max(0, Math.min(1, progressEntry.progress))
            : null;
          const cardZoneClass = getZoneClass(device);
          const isActive = computeDeviceActive(device);
          const cardClasses = ['device-card', cardZoneClass, isActive ? 'active' : 'inactive']
            .filter(Boolean)
            .join(' ');
          
          return (
            <div
              key={deviceKey}
              className={cardClasses}
            >
              {device.type === 'heart_rate' ? (
                <CircularUserAvatar
                  name={ownerName || deviceKey}
                  avatarSrc={DaylightMediaPath(`/static/img/users/${profileId}`)}
                  fallbackSrc={DaylightMediaPath('/static/img/users/user')}
                  heartRate={heartRate}
                  zoneId={zoneId}
                  zoneColor={zoneColor}
                  progress={progressValue}
                  opacity={isActive ? 1 : 0.6}
                  size="100%"
                  ringWidth={8}
                  showIndicator={false}
                  ariaLabel={ownerName ? `${ownerName} heart rate` : undefined}
                />
              ) : (
                <div className="device-icon-fallback">
                  {device.type === 'power' && '⚡'}
                  {device.type === 'cadence' && '⚙️'}
                  {device.type === 'speed' && '🚴'}
                  {device.type === 'jumprope' && '🦘'}
                  {!['power', 'cadence', 'speed', 'jumprope'].includes(device.type) && '📡'}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {sortedDevices.length === 0 && (
        <div
          className={`device-card fitness-monitor ${connected ? 'connected' : 'disconnected'}`}
          onPointerDown={() => hardReload('footer-tap')}
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