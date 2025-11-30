import React, { useState, useEffect, useRef } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FlipMove from 'react-flip-move';
import MiniMonitor from './MiniMonitor.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import './SidebarFooter.scss';

const SidebarFooter = ({ onContentSelect }) => {
  const { 
    connected, 
    allDevices,
    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    deviceCount,
    deviceConfiguration,
    participantRoster,
    hrColorMap: contextHrColorMap,
    usersConfigRaw,
    userCurrentZones,
    zones
  } = useFitnessContext();
  
  // State for sorted devices
  const [sortedDevices, setSortedDevices] = useState([]);

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

  // Map deviceId -> user ID for avatars
  const userIdMap = React.useMemo(() => {
    const map = {};
    participantRoster.forEach((participant) => {
      if (participant?.hrDeviceId !== undefined && participant?.hrDeviceId !== null) {
        const key = String(participant.hrDeviceId);
        const profileId = participant.profileId || participant.userId || participant.name?.toLowerCase();
        map[key] = profileId || 'user';
      }
    });
    return map;
  }, [participantRoster]);

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
  const userObj = participantRoster.find((participant) => String(participant.hrDeviceId) === String(device.deviceId));
    if (!userObj) return 'no-zone';
    const zoneEntry = userCurrentZones?.[userObj.name];
    let color = zoneEntry && typeof zoneEntry === 'object' ? zoneEntry.color : zoneEntry;
    let zoneIdRaw = (zoneEntry && typeof zoneEntry === 'object' && zoneEntry.id) ? zoneEntry.id : null;
    if ((!color || !zoneIdRaw) && device.heartRate) {
      const derived = deriveZoneFromHR(device.heartRate, userObj.name);
      if (derived) {
        if (!zoneIdRaw) zoneIdRaw = derived.id;
        if (!color) color = derived.color;
      }
    }
    if (!color && !zoneIdRaw) return 'no-zone';
    const zoneId = (zoneIdRaw || (color ? colorToZoneId[String(color).toLowerCase()] : null) || (color ? String(color).toLowerCase() : null));
    const canonical = ['cool','active','warm','hot','fire'];
    if (zoneId && canonical.includes(zoneId)) return `zone-${zoneId}`;
    return 'no-zone';
  };

  // Helper: derive canonical zone id (cool..fire) for a heart rate device or null
  const canonicalZones = ['cool','active','warm','hot','fire'];
  const zoneRankMap = { cool:0, active:1, warm:2, hot:3, fire:4 };
  const getDeviceZoneId = (device) => {
    if (device.type !== 'heart_rate') return null;
  const userObj = participantRoster.find((participant) => String(participant.hrDeviceId) === String(device.deviceId));
    if (!userObj) return null;
    const entry = userCurrentZones?.[userObj.name];
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
      const derived = deriveZoneFromHR(device.heartRate, userObj.name);
      if (derived) zoneId = derived.id;
    }
    if (!zoneId) return null;
    zoneId = zoneId.toLowerCase();
    return canonicalZones.includes(zoneId) ? zoneId : null;
  };

  // Sort devices whenever HR devices or supporting data change
  useEffect(() => {
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
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      // Stable fallback by deviceId
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });
    
    // Only keep the single top performer to prevent growth
    const limitedHrDevices = hrDevices.length > 1 ? hrDevices.slice(0, 1) : hrDevices;

    // Update the sorted devices (no other device types shown)
    setSortedDevices(limitedHrDevices);
  }, [heartRateDevices, participantRoster, userCurrentZones, zones]);

  return (
    <div className="sidebar-footer">
      <FlipMove 
        className="device-container" 
        duration={300} 
        easing="ease-out"
        staggerDelayBy={20}
        enterAnimation="fade"
        leaveAnimation="fade"
        maintainContainerHeight={true}
      >
        {sortedDevices.map((device) => {
          const deviceId = String(device.deviceId);
          const ownerName = device.type === 'heart_rate' ? hrOwnerMap[deviceId] : null;
          const profileId = device.type === 'heart_rate' ? 
            (userIdMap[deviceId] || 'user') : 'user';
          const heartRate = device.type === 'heart_rate' && device.heartRate ? device.heartRate : null;
          
          return (
            <div
              key={deviceId}
              className={`device-card ${getZoneClass(device)} ${device.isActive ? 'active' : 'inactive'}`}
              onPointerDown={() => onContentSelect && onContentSelect('users')}
            >
              <div className="device-avatar-container">
                {device.type === 'heart_rate' ? (
                  <>
                    <img
                      src={DaylightMediaPath(`/media/img/users/${profileId}`)}
                      alt={`${ownerName || deviceId} profile`}
                      className="device-avatar"
                      onError={(e) => {
                        if (e.target.dataset.fallback) {
                          e.target.style.display = 'none';
                          return;
                        }
                        e.target.dataset.fallback = '1';
                        e.target.src = DaylightMediaPath(`/media/img/users/user.png`);
                      }}
                    />
                    {heartRate && (
                      <div className="bpm-overlay">{heartRate}</div>
                    )}
                  </>
                ) : (
                  <div className="device-icon-fallback">
                    {device.type === 'power' && '⚡'}
                    {device.type === 'cadence' && '⚙️'}
                    {device.type === 'speed' && '🚴'}
                    {!['power', 'cadence', 'speed'].includes(device.type) && '📡'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </FlipMove>
      
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