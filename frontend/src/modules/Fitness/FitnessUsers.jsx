import React, { useState, useEffect } from 'react';
import { Group, Text, Badge, Stack } from '@mantine/core';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FlipMove from 'react-flip-move';
import './FitnessUsers.scss';
import { DaylightMediaPath } from '../../lib/api.mjs';

const FitnessUsers = () => {
  // Use the fitness context
  const fitnessContext = useFitnessContext();
  //console.log('Full Fitness Context:', fitnessContext);
  
  const { 
    connected, 
    allDevices,
    heartRateDevices, 
    speedDevices,
    cadenceDevices,
    powerDevices,
    unknownDevices,
    deviceCount, 
    latestData, 
    lastUpdate,
    deviceConfiguration,
    equipment,
    primaryUsers,
    secondaryUsers,
    hrColorMap: contextHrColorMap,
    usersConfigRaw,
    userCurrentZones,
    zones
  } = fitnessContext;

  // Diagnostic: log user arrays when they change
  React.useEffect(() => {
  }, [primaryUsers, secondaryUsers]);
  
  // State for sorted devices
  const [sortedDevices, setSortedDevices] = useState([]);

  // Build lookup maps for heart rate device colors and user assignments
  // Color mapping now comes solely from configuration (no hardcoded fallback)
  // hrColorMap now comes directly from context (already has stringified keys)
  // Provide a fallback reconstruction from deviceConfiguration.hr if the context map is empty
  const hrColorMap = React.useMemo(() => {
    const direct = contextHrColorMap || {};
    if (direct && Object.keys(direct).length > 0) return direct;
    const fallbackSrc = deviceConfiguration?.hr || {};
    const rebuilt = {};
    Object.keys(fallbackSrc).forEach(k => { rebuilt[String(k)] = fallbackSrc[k]; });
    console.warn('[FitnessUsers][WARN] Context hrColorMap empty; using fallback from deviceConfiguration.hr', rebuilt);
    return rebuilt;
  }, [contextHrColorMap, deviceConfiguration]);


  // Users are already available from the context

  // Map of deviceId -> user name (first match wins from primary then secondary)
  const hrOwnerMap = React.useMemo(() => {
    const map = {};
    const populated = [...primaryUsers, ...secondaryUsers];
    populated.forEach(u => {
      if (u?.hrDeviceId !== undefined && u?.hrDeviceId !== null) {
        map[String(u.hrDeviceId)] = u.name; // preliminary; name may be replaced later by group_label rule
      }
    });
    if (Object.keys(map).length === 0 && usersConfigRaw) {
      // Fallback: build from raw config (pre-User objects) using hr field
      const addFrom = (arr) => Array.isArray(arr) && arr.forEach(cfg => {
        if (cfg && (cfg.hr !== undefined && cfg.hr !== null)) {
          map[String(cfg.hr)] = cfg.name;
        }
      });
      addFrom(usersConfigRaw.primary);
      addFrom(usersConfigRaw.secondary);
      if (Object.keys(map).length > 0) {
        console.log('[FitnessUsers][FALLBACK] Built hrOwnerMap from raw config', map);
      }
    }
    return map;
  }, [primaryUsers, secondaryUsers, usersConfigRaw]);

  // Build a map of deviceId -> displayName applying group_label rule
  const hrDisplayNameMap = React.useMemo(() => {
    // Determine if multi-user session (more than one primary user active overall)
    const multi = primaryUsers.length > 1;
    if (!multi) return hrOwnerMap; // no change if single user
    // We need group_label info; get from raw config
    const labelLookup = {};
    const gather = (arr) => Array.isArray(arr) && arr.forEach(cfg => {
      if (cfg?.hr !== undefined && cfg?.hr !== null && cfg.group_label) {
        labelLookup[String(cfg.hr)] = cfg.group_label;
      }
    });
    gather(usersConfigRaw?.primary);
    gather(usersConfigRaw?.secondary);
    if (Object.keys(labelLookup).length === 0) return hrOwnerMap; // nothing to substitute
    const out = { ...hrOwnerMap };
    Object.keys(labelLookup).forEach(deviceId => {
      if (out[deviceId]) {
        out[deviceId] = labelLookup[deviceId];
      }
    });
    return out;
  }, [hrOwnerMap, primaryUsers.length, usersConfigRaw]);

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
    const sorted = [...zones].sort((a,b) => b.min - a.min); // highest min first
    for (const z of sorted) {
      const overrideMin = overrides[z.id];
      const min = (typeof overrideMin === 'number') ? overrideMin : z.min;
      if (hr >= min) return { id: z.id, color: z.color };
    }
    return null;
  }, [zones, usersConfigRaw]);

  const getZoneClass = (device) => {
    if (device.type !== 'heart_rate') return 'no-zone';
    const userObj = [...primaryUsers, ...secondaryUsers].find(u => String(u.hrDeviceId) === String(device.deviceId));
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

  // Return a human-readable current zone for a device (used in inline <code> block)
  // Handles multiple possible shapes of userCurrentZones values:
  //  - string color (e.g. 'yellow')
  //  - string id (e.g. 'warm')
  //  - object { id, color, coins? }
  const getCurrentZone = (device) => {
    try {
      if (!device || device.type !== 'heart_rate') return '';
      const userObj = [...primaryUsers, ...secondaryUsers]
        .find(u => String(u.hrDeviceId) === String(device.deviceId));
      if (!userObj) return '';
      const entry = userCurrentZones?.[userObj.name];
      let zoneId = null;
      let color = null;
      if (entry) {
        zoneId = (typeof entry === 'object') ? (entry.id || null) : null;
        color = (typeof entry === 'object') ? entry.color : entry;
        if (!zoneId && color) {
          zoneId = colorToZoneId[String(color).toLowerCase()] || String(color).toLowerCase();
        }
      }
      const canonical = ['cool','active','warm','hot','fire'];
      if ((!zoneId || !canonical.includes(zoneId)) && device.heartRate) {
        const derived = deriveZoneFromHR(device.heartRate, userObj.name);
        if (derived) zoneId = derived.id;
      }
      if (!zoneId || !canonical.includes(zoneId)) return '';
      return zoneId.charAt(0).toUpperCase() + zoneId.slice(1);
    } catch (e) {
      console.warn('[FitnessUsers][getCurrentZone] Failed to resolve zone', e);
      return '';
    }
  };
  
  // Map of deviceId -> user ID (for profile images)
  const userIdMap = React.useMemo(() => {
    const map = {};
    [...primaryUsers, ...secondaryUsers].forEach(u => {
      if (u?.hrDeviceId !== undefined && u?.hrDeviceId !== null) {
        map[String(u.hrDeviceId)] = u.id || u.name.toLowerCase();
      }
    });
    return map;
  }, [primaryUsers, secondaryUsers]);
  
  // Map of deviceId -> equipment name and ID
  const equipmentMap = React.useMemo(() => {
    const map = {};
    if (Array.isArray(equipment)) {
      equipment.forEach(e => {
        if (e?.cadence) {
          map[String(e.cadence)] = { name: e.name, id: e.id || e.name.toLowerCase() };
        }
        if (e?.speed) {
          map[String(e.speed)] = { name: e.name, id: e.id || e.name.toLowerCase() };
        }
      });
    }
    return map;
  }, [equipment]);

  const heartColorIcon = (deviceId) => {
    const deviceIdStr = String(deviceId);
    const colorKey = hrColorMap[deviceIdStr];
    if (!colorKey) {
      console.log('[FitnessUsers][DIAG] No color mapping for device', deviceIdStr, 'available keys', Object.keys(hrColorMap));
    }
    
    if (!colorKey) {
      return '🧡'; // Default to orange if not found
    }
    
    // Map color key to colored heart emojis
    const colorIcons = {
      red: '❤️',     // Red heart
      yellow: '💛',  // Yellow heart
      green: '💚',   // Green heart
      blue: '💙',    // Blue heart
      watch: '🤍',   // White heart (for watch)
      orange: '🧡'   // Explicit orange to allow config use
    };
    
    const icon = colorIcons[colorKey] || '🧡';
    return icon;
  };

  // Format time ago helper
  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((new Date() - timestamp) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const getDeviceIcon = (device) => {
    if (device.type === 'heart_rate') {
      return heartColorIcon(device.deviceId);
    }
    if (device.type === 'power') return '⚡';
    if (device.type === 'cadence') return '⚙️';
    if (device.type === 'speed') return '🚴';
    return '📡';
  };

  const getDeviceValue = (device) => {
    if (device.type === 'heart_rate' && device.heartRate) return `${device.heartRate}`;
    if (device.type === 'power' && device.power) return `${device.power}`;
    if (device.type === 'cadence' && device.cadence) return `${device.cadence}`;
    if (device.type === 'speed' && device.speedKmh) return `${device.speedKmh.toFixed(1)}`;
    return '--';
  };

  const getDeviceUnit = (device) => {
    if (device.type === 'heart_rate') return 'BPM';
    if (device.type === 'power') return 'W';
    if (device.type === 'cadence') return 'RPM';
    if (device.type === 'speed') return 'km/h';
    return '';
  };

  const getDeviceColor = (device) => {
    if (device.type === 'heart_rate') return 'heart-rate';
    if (device.type === 'power') return 'power';
    if (device.type === 'cadence') return 'cadence';
    if (device.type === 'speed') return 'speed';
    return 'unknown';
  };

  // Helper: derive canonical zone id (cool..fire) for a heart rate device or null
  const canonicalZones = ['cool','active','warm','hot','fire'];
  const zoneRankMap = { cool:0, active:1, warm:2, hot:3, fire:4 };
  const getDeviceZoneId = (device) => {
    if (device.type !== 'heart_rate') return null;
    const userObj = [...primaryUsers, ...secondaryUsers].find(u => String(u.hrDeviceId) === String(device.deviceId));
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
  
  // Sort devices whenever allDevices changes
  useEffect(() => {
    // First prioritize heart rate monitors
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
    const otherDevices = allDevices.filter(d => d.type !== 'heart_rate');
    
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
    
    // Sort other devices by type then value
    otherDevices.sort((a, b) => {
      // First by device type
      const typeOrder = { power: 1, cadence: 2, speed: 3, unknown: 4 };
      const typeA = typeOrder[a.type] || 4;
      const typeB = typeOrder[b.type] || 4;
      if (typeA !== typeB) return typeA - typeB;
      
      // Then by active status
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      // Then by value
      const valueA = a.power || a.cadence || (a.speedKmh || 0);
      const valueB = b.power || b.cadence || (b.speedKmh || 0);
      return valueB - valueA;
    });
    
    // Combine sorted arrays
    setSortedDevices([...hrDevices, ...otherDevices]);
  }, [allDevices]);

  return (
    <div className="fitness-devices-nav">
      {/* Connection Status Header */}
      <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
      
      {/* Fitness Devices as Nav Icons */}
      <div className="fitness-devices">
        {sortedDevices.length > 0 ? (
          <FlipMove 
            className="device-grid"
            duration={300}
            easing="ease-out"
            staggerDelayBy={20}
            enterAnimation="fade"
            leaveAnimation="fade"
            maintainContainerHeight={true}
          >
            {(() => {
              const seenZones = new Set();
              let noZoneShown = false;
              return sortedDevices.map((device) => {
              const ownerName = device.type === 'heart_rate' ? hrDisplayNameMap[String(device.deviceId)] : null;
              
              // Get equipment info for cadence/speed devices
              const equipmentInfo = equipmentMap[String(device.deviceId)];
              
              // Get name from equipment for cadence/speed, hardcoded map for HR devices, or device ID
              const deviceName = device.type === 'heart_rate' ? 
                (ownerName || String(device.deviceId)) :
                (device.type === 'cadence' && equipmentInfo?.name) ? equipmentInfo.name : String(device.deviceId);
                
              //console.log(`Device ${device.deviceId} (${device.type}) name: ${deviceName}`, equipmentInfo);
              
              // Get profile image ID for either user or equipment
              const profileId = device.type === 'heart_rate' ?
                (userIdMap[String(device.deviceId)] || 'user') :
                (equipmentInfo?.id || 'equipment');
              
             

              const zoneIdForGrouping = getDeviceZoneId(device) || (device.type === 'heart_rate' ? null : null);
              const readableZone = zoneIdForGrouping ? zoneIdForGrouping.charAt(0).toUpperCase() + zoneIdForGrouping.slice(1) : '';
              const showZoneBadge = device.type === 'heart_rate' && (
                (zoneIdForGrouping && !seenZones.has(zoneIdForGrouping)) || (!zoneIdForGrouping && !noZoneShown)
              );
              if (zoneIdForGrouping) seenZones.add(zoneIdForGrouping);
              if (!zoneIdForGrouping && device.type === 'heart_rate' && !noZoneShown) noZoneShown = true;

              return (
                <div className="device-wrapper" key={`device-${device.deviceId}`}>
                  <div className={`device-zone-info ${getZoneClass(device)}`}>
                    {showZoneBadge && (
                      <Badge 
                        variant="light" 
                        size="xs"
                        title={zoneIdForGrouping ? `Zone group: ${readableZone}` : 'No Zone'}
                      >
                        {zoneIdForGrouping ? `Zone: ${readableZone}` : 'No Zone'}
                      </Badge>
                    )}
                  </div>
                  <div 
                    className={`fitness-device card-horizontal ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'}`}
                    title={`Device: ${deviceName} (${device.deviceId}) - ${formatTimeAgo(device.lastSeen)}`}
                  >
                    <div className={`user-profile-img-container ${getZoneClass(device)}`}>
                      {device.type === 'cadence' && (
                        <div 
                          className="equipment-icon"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100%',
                            height: '100%',
                            fontSize: '2rem',
                            background: '#333',
                            borderRadius: '50%',
                            color: '#fff'
                          }}
                        >
                          ⚙️
                        </div>
                      )}
                      {device.type !== 'cadence' && (
                        <img
                          src={DaylightMediaPath(device.type === 'heart_rate'
                            ? `/media/img/users/${profileId}.png`
                            : `/media/img/equipment/${profileId}.png`
                          )}
                          alt={`${deviceName} profile`}
                          onError={(e) => {
                            // Prevent infinite error loops and hide broken image after fallback
                            if (e.target.dataset.fallback) {
                              e.target.style.display = 'none';
                              return;
                            }
                            e.target.dataset.fallback = '1';
                            e.target.src = DaylightMediaPath(device.type === 'heart_rate'
                              ? `/media/img/users/user.png`
                              : `/media/img/equipment/equipment.png`);
                          }}
                        />
                      )}
                    </div>
                    <div className="device-info">
                      <div className="device-name">
                        {deviceName} 
                      </div>
                      <div className="device-stats">
                        <span className="device-icon">{getDeviceIcon(device)}</span>
                        <span className="device-value">{getDeviceValue(device)}</span>
                        <span className="device-unit">{getDeviceUnit(device)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
              });
            })()}
          </FlipMove>
        ) : (
          <div className="nav-empty">
            <div className="empty-icon">📡</div>
            <Text size="xs" c="dimmed" ta="center">
              No devices
            </Text>
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessUsers;
