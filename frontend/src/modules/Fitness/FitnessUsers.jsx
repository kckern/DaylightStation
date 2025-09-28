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

  const getZoneClass = (device) => {
    if (device.type !== 'heart_rate') return 'no-zone';
    const userObj = [...primaryUsers, ...secondaryUsers].find(u => String(u.hrDeviceId) === String(device.deviceId));
    if (!userObj) return 'no-zone';
    const color = userCurrentZones?.[userObj.name];
    if (!color) return 'no-zone';
    const zoneId = colorToZoneId[String(color).toLowerCase()] || String(color).toLowerCase();
    const canonical = ['cool','active','warm','hot','fire'];
    if (canonical.includes(zoneId)) return `zone-${zoneId}`;
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
      const raw = userCurrentZones?.[userObj.name];
      if (!raw) return '';

      let zoneId; let zoneColor;
      if (typeof raw === 'object') {
        zoneId = raw.id || undefined;
        zoneColor = raw.color || undefined;
      } else {
        // raw is a string (either color or id)
        zoneColor = raw;
      }

      // If we only have a color, map to id
      if (!zoneId && zoneColor) {
        zoneId = colorToZoneId[String(zoneColor).toLowerCase()] || String(zoneColor).toLowerCase();
      }

      // Normalize to canonical list
      const canonical = ['cool','active','warm','hot','fire'];
      if (!zoneId || !canonical.includes(zoneId)) return '';

      // Pretty label (capitalize first letter)
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
    console.log('Equipment config:', equipment);
    if (Array.isArray(equipment)) {
      equipment.forEach(e => {
        console.log('Processing equipment:', e);
        if (e?.cadence) {
          map[String(e.cadence)] = { name: e.name, id: e.id || e.name.toLowerCase() };
          console.log(`Mapped cadence ${e.cadence} to ${e.name}`);
        }
        if (e?.speed) {
          map[String(e.speed)] = { name: e.name, id: e.id || e.name.toLowerCase() };
          console.log(`Mapped speed ${e.speed} to ${e.name}`);
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
  
  // Sort devices whenever allDevices changes
  useEffect(() => {
    // First prioritize heart rate monitors
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
    const otherDevices = allDevices.filter(d => d.type !== 'heart_rate');
    
    // Sort heart rate devices by value
    hrDevices.sort((a, b) => {
      // First by active status
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      // Then by heart rate value (higher first)
      return (b.heartRate || 0) - (a.heartRate || 0);
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
            {sortedDevices.map((device) => {
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
                
              return (
                <div 
                  key={`device-${device.deviceId}`} 
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
                        <code>
                          Current Zone: {getCurrentZone(device)}
                        </code>
                    </div>
                    <div className="device-stats">
                      <span className="device-icon">{getDeviceIcon(device)}</span>
                      <span className="device-value">{getDeviceValue(device)}</span>
                      <span className="device-unit">{getDeviceUnit(device)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
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
