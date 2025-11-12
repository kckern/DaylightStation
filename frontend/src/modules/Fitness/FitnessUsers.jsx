import React, { useState, useEffect } from 'react';
import { Group, Text, Badge, Stack } from '@mantine/core';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FlipMove from 'react-flip-move';
import './FitnessUsers.scss';
import { DaylightMediaPath } from '../../lib/api.mjs';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

// Lightweight treasure box summary component
const FitnessTreasureBox = ({ box, session }) => {
  const [tick, setTick] = useState(Date.now());
  // Update every second while active
  // Start ticking when either treasure box start or session start is present
  const startTime = box?.sessionStartTime || session?.startedAt || null;
  useEffect(() => {
    if (!startTime) return; // wait until we have a start
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (!box) return null;
  // Recompute elapsed locally so we aren't dependent on a stale snapshot object
  const elapsed = startTime
    ? Math.floor((Date.now() - startTime) / 1000)
    : (box.sessionElapsedSeconds || session?.durationSeconds || 0);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const totalCoins = box.totalCoinsAllColors ?? box.totalCoins ?? 0;
  const colorCoins = box.colorCoins || box.buckets || {};
  // Rank colors by zone intensity: fire (red) > hot (orange) > warm (yellow) > active (green) > cool (blue)
  const colorRank = (cRaw) => {
    if (!cRaw) return 0;
    const c = String(cRaw).toLowerCase();
    // Support both named colors and hex/rgba via substring signatures
    if (c.includes('ff6b6b') || c === 'red') return 500;      // fire
    if (c.includes('ff922b') || c === 'orange') return 400;   // hot
    if (c.includes('ffd43b') || c === 'yellow') return 300;   // warm
    if (c.includes('51cf66') || c === 'green') return 200;    // active
    if (c.includes('6ab8ff') || c === 'blue') return 100;     // cool
    return 0; // unknown / leftover
  };
  const colors = Object.keys(colorCoins)
    .filter(c => (colorCoins[c] || 0) > 0)
    .sort((a,b) => colorRank(b) - colorRank(a));
  const hasCoins = colors.length > 0;

  // Consistent hex mapping for semantic color names (match zone styling palette)
  const colorHexMap = {
    red: '#ff6b6b',      // fire
    orange: '#ff922b',   // hot
    yellow: '#ffd43b',   // warm
    green: '#51cf66',    // active
    blue: '#6ab8ff'      // cool
  };

  return (
    <div className="treasure-box-panel">
        <h3>Treasure Box</h3>
      <div className="tb-row tb-row-head">
        {/* Completely flattened - icon, total, coins, timer all as direct siblings */}
        <span className="tb-icon" role="img" aria-label="coins">💰</span>
        <span className="tb-total">{totalCoins}</span>
        {hasCoins && colors.map(c => {
          const hex = colorHexMap[c] || c;
          return (
            <React.Fragment key={c}>
              <span className="tb-swatch" style={{ background: hex }} title={`${c}: ${colorCoins[c]} coins`} />
              <span className="tb-count">{colorCoins[c]}</span>
            </React.Fragment>
          );
        })}
        <span className="tb-timer" title={`Started: ${startTime ? new Date(startTime).toLocaleTimeString() : 'N/A'}`}>{mm}:{ss}</span>
      </div>
    </div>
  );
};

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
    participantRoster,
    participantsByDevice,
    hrColorMap: contextHrColorMap,
    usersConfigRaw,
    userCurrentZones,
    zones,
    treasureBox,
    fitnessSession
  } = fitnessContext;
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
  // hrColorMap empty fallback (warning suppressed)
    return rebuilt;
  }, [contextHrColorMap, deviceConfiguration]);

  // Build cadence color map from device configuration
  const cadenceColorMap = React.useMemo(() => {
    const map = {};
    const cadenceSrc = deviceConfiguration?.cadence || {};
    Object.keys(cadenceSrc).forEach(k => { map[String(k)] = cadenceSrc[k]; });
    return map;
  }, [deviceConfiguration]);

  const participantByDevice = React.useMemo(() => {
    const map = new Map();
    (participantRoster || []).forEach((participant) => {
      if (participant?.hrDeviceId === undefined || participant.hrDeviceId === null) return;
      map.set(String(participant.hrDeviceId), participant);
    });
    if (participantsByDevice && typeof participantsByDevice.forEach === 'function') {
      participantsByDevice.forEach((participant, key) => {
        if (!participant) return;
        const deviceId = participant.hrDeviceId != null ? participant.hrDeviceId : key;
        if (deviceId == null) return;
        const normalizedKey = String(deviceId);
        if (!map.has(normalizedKey)) {
          map.set(normalizedKey, participant);
        }
      });
    }
    return map;
  }, [participantRoster, participantsByDevice]);

  // Users are already available from the context

  // Map of deviceId -> user name (first match wins from primary then secondary)
  const hrOwnerMap = React.useMemo(() => {
    const map = {};
    participantByDevice.forEach((participant, key) => {
      if (!participant) return;
      map[String(key)] = participant.name;
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
  // built hrOwnerMap (debug removed)
      }
    }
    return map;
  }, [participantByDevice, usersConfigRaw]);

  // Build a map of deviceId -> displayName applying group_label rule
  const hrDisplayNameMap = React.useMemo(() => {
    const baseMap = { ...hrOwnerMap };
    const activeHrDeviceIds = allDevices
      .filter(d => d.type === 'heart_rate')
      .map(d => String(d.deviceId))
      .filter((id) => baseMap[id]);

    if (activeHrDeviceIds.length <= 1) return baseMap;

    const labelLookup = {};
    const gather = (arr) => Array.isArray(arr) && arr.forEach(cfg => {
      if (cfg?.hr !== undefined && cfg?.hr !== null && cfg.group_label) {
        labelLookup[String(cfg.hr)] = cfg.group_label;
      }
    });
    gather(usersConfigRaw?.primary);
    gather(usersConfigRaw?.secondary);
    if (Object.keys(labelLookup).length === 0) return baseMap;

    const out = { ...baseMap };
    Object.keys(labelLookup).forEach((deviceId) => {
      const participant = participantByDevice.get(String(deviceId));
      if (participant?.isGuest) return;
      if (out[deviceId]) {
        out[deviceId] = labelLookup[deviceId];
      }
    });
    return out;
  }, [hrOwnerMap, allDevices, usersConfigRaw, participantByDevice]);

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

  // Map zone id -> color for styling badges
  const zoneColorMap = React.useMemo(() => {
    const map = {};
    (zones || []).forEach(z => {
      if (z?.id && z?.color) map[String(z.id).toLowerCase()] = z.color;
    });
    return map;
  }, [zones]);

  // Fallback zone derivation using configured zones + per-user overrides
  const deriveZoneFromHR = React.useCallback((hr, userName, fallbackName = null) => {
    if (!hr || hr <= 0 || !Array.isArray(zones) || zones.length === 0) return null;
    const resolveConfig = (name) => {
      if (!name) return null;
      return usersConfigRaw?.primary?.find(u => u.name === name)
        || usersConfigRaw?.secondary?.find(u => u.name === name)
        || null;
    };
    const cfg = resolveConfig(userName) || resolveConfig(fallbackName);
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
    const participant = participantByDevice.get(String(device.deviceId));
    if (!participant) return 'no-zone';
    const zoneEntry = userCurrentZones?.[participant.name];
    let color = zoneEntry && typeof zoneEntry === 'object' ? zoneEntry.color : zoneEntry;
    let zoneIdRaw = (zoneEntry && typeof zoneEntry === 'object' && zoneEntry.id) ? zoneEntry.id : null;
    if ((!color || !zoneIdRaw) && device.heartRate) {
      const derived = deriveZoneFromHR(device.heartRate, participant.name, participant.baseUserName);
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
      const participant = participantByDevice.get(String(device.deviceId));
      if (!participant) return '';
      const entry = userCurrentZones?.[participant.name];
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
        const derived = deriveZoneFromHR(device.heartRate, participant.name, participant.baseUserName);
        if (derived) zoneId = derived.id;
      }
      if (!zoneId || !canonical.includes(zoneId)) return '';
      return zoneId.charAt(0).toUpperCase() + zoneId.slice(1);
    } catch (e) {
  // zone resolution failure (warning suppressed)
      return '';
    }
  };
  
  // Map of deviceId -> user ID (for profile images)
  const userIdMap = React.useMemo(() => {
    const map = {};
    (participantRoster || []).forEach((participant) => {
      if (participant?.hrDeviceId === undefined || participant.hrDeviceId === null) return;
      const normalizedKey = String(participant.hrDeviceId);
      const resolvedId = participant.profileId || participant.userId || slugifyId(participant.name, 'user');
      map[normalizedKey] = resolvedId;
    });
    if (Object.keys(map).length === 0 && usersConfigRaw) {
      const gather = (arr) => Array.isArray(arr) && arr.forEach((cfg) => {
        if (cfg?.hr === undefined || cfg.hr === null) return;
        const normalizedKey = String(cfg.hr);
        const resolvedId = cfg.id || slugifyId(cfg.name, 'user');
        map[normalizedKey] = resolvedId;
      });
      gather(usersConfigRaw.primary);
      gather(usersConfigRaw.secondary);
    }
    return map;
  }, [participantRoster, usersConfigRaw]);
  
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
  // missing color mapping (debug removed)
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
    const participant = participantByDevice.get(String(device.deviceId));
    if (!participant) return null;
    const entry = userCurrentZones?.[participant.name];
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
      const derived = deriveZoneFromHR(device.heartRate, participant.name, participant.baseUserName);
      if (derived) zoneId = derived.id;
    }
    if (!zoneId) return null;
    zoneId = zoneId.toLowerCase();
    return canonicalZones.includes(zoneId) ? zoneId : null;
  };

  // Simple contrast text color chooser
  const pickTextColor = (bg) => {
    if (!bg) return '#222';
    // Normalize hex like #ff0000 or named css color; attempt to parse
    const ctx = document.createElement ? document.createElement('canvas') : null; // guard SSR
    let hex = bg;
    if (/^[a-zA-Z]+$/.test(bg) && ctx) {
      const c = ctx.getContext('2d');
      if (c) {
        c.fillStyle = bg;
        hex = c.fillStyle; // browser resolves named color to rgb(...)
      }
    }
    // Convert rgb(...) to components
    let r,g,b;
    if (hex.startsWith('rgb')) {
      const m = hex.match(/rgb[a]?\(([^)]+)\)/);
      if (m) {
        [r,g,b] = m[1].split(',').map(x => parseFloat(x));
      }
    } else if (hex[0] === '#') {
      const clean = hex.replace('#','');
      if (clean.length === 3) {
        r = parseInt(clean[0]+clean[0],16);
        g = parseInt(clean[1]+clean[1],16);
        b = parseInt(clean[2]+clean[2],16);
      } else if (clean.length >= 6) {
        r = parseInt(clean.slice(0,2),16);
        g = parseInt(clean.slice(2,4),16);
        b = parseInt(clean.slice(4,6),16);
      }
    }
    if ([r,g,b].some(v => v === undefined)) return '#222';
    // Luminance
    const luminance = (0.299*r + 0.587*g + 0.114*b)/255;
    return luminance > 0.6 ? '#222' : '#fff';
  };
  
  // Sort devices whenever allDevices changes
  useEffect(() => {
    // First prioritize heart rate monitors
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');
    const cadenceDevicesOnly = allDevices.filter(d => d.type === 'cadence');
    const otherDevices = allDevices.filter(d => d.type !== 'heart_rate' && d.type !== 'cadence');
    
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
    
    // Sort cadence devices by value
    cadenceDevicesOnly.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return (b.cadence || 0) - (a.cadence || 0);
    });
    
    // Sort other devices by type then value
    otherDevices.sort((a, b) => {
      // First by device type
      const typeOrder = { power: 1, speed: 2, unknown: 3 };
      const typeA = typeOrder[a.type] || 3;
      const typeB = typeOrder[b.type] || 3;
      if (typeA !== typeB) return typeA - typeB;
      
      // Then by active status
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      
      // Then by value
      const valueA = a.power || (a.speedKmh || 0);
      const valueB = b.power || (b.speedKmh || 0);
      return valueB - valueA;
    });
    
    // Combine sorted arrays with cadence devices grouped as a single item
    const combined = [...hrDevices];
    if (cadenceDevicesOnly.length > 0) {
      combined.push({ type: 'rpm-group', devices: cadenceDevicesOnly });
    }
    combined.push(...otherDevices);
    setSortedDevices(combined);
  }, [allDevices, participantRoster, userCurrentZones, zones]);

  return (
    <div className="fitness-devices-nav">
  <FitnessTreasureBox box={treasureBox} session={fitnessSession} />
      {/* Connection Status Header */}
      <div className="nav-header">
        <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
        <button
          type="button"
          className="refresh-btn"
          onClick={() => window.location.reload()}
          title="Refresh page"
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            padding: '6px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          }}
        >
          🔄 Refresh
        </button>
      </div>
      
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
              // Handle RPM group separately
              if (device.type === 'rpm-group') {
                const rpmDevices = device.devices;
                const isMultiDevice = true; rpmDevices.length > 1;
                
                return (
                  <div key="rpm-group" className={`rpm-group-container ${isMultiDevice ? 'multi-device' : 'single-device'}`}>
                    <div className="rpm-devices">
                      {rpmDevices.map(rpmDevice => {
                        const equipmentInfo = equipmentMap[String(rpmDevice.deviceId)];
                        const deviceName = equipmentInfo?.name || String(rpmDevice.deviceId);
                        const equipmentId = equipmentInfo?.id || String(rpmDevice.deviceId);
                        const rpm = rpmDevice.cadence || 0;
                        const isZero = rpm === 0;
                        
                        // Calculate animation duration based on RPM (120s / RPM = seconds per revolution at half speed)
                        const animationDuration = rpm > 0 ? `${270 / rpm}s` : '0s';
                        
                        // Get the device color from cadenceColorMap
                        const deviceColor = cadenceColorMap[String(rpmDevice.deviceId)];
                        const colorMap = {
                          red: '#ff6b6b',
                          orange: '#ff922b',
                          yellow: '#f0c836ff',
                          green: '#51cf66',
                          blue: '#6ab8ff'
                        };
                        const borderColor = deviceColor ? colorMap[deviceColor] || deviceColor : '#51cf66';
                        
                        return (
                          <div key={`rpm-${rpmDevice.deviceId}`} className="rpm-device-avatar">
                            <div className="rpm-avatar-wrapper">
                              {!isZero && (
                                <div 
                                  className="rpm-spinning-border"
                                  style={{
                                    '--spin-duration': animationDuration,
                                    borderColor: borderColor
                                  }}
                                />
                              )}
                              <div className="rpm-avatar-content">
                                <img
                                  src={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
                                  alt={deviceName}
                                  className="rpm-device-image"
                                  onError={(e) => {
                                    if (e.target.dataset.fallback) {
                                      e.target.style.display = 'none';
                                      return;
                                    }
                                    e.target.dataset.fallback = '1';
                                  e.target.src = DaylightMediaPath('/media/img/equipment/equipment');
                                }}
                              />
                                <div 
                                  className={`rpm-value-overlay ${isZero ? 'rpm-zero' : ''}`}
                                  style={{
                                    background: "#00000088"
                                  }}
                                >
                                  {rpm}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              
              // Regular device rendering
              const ownerName = device.type === 'heart_rate' ? hrDisplayNameMap[String(device.deviceId)] : null;
              
              // Get equipment info for speed devices
              const equipmentInfo = equipmentMap[String(device.deviceId)];
              
              // Get name from equipment for speed, hardcoded map for HR devices, or device ID
              const deviceName = device.type === 'heart_rate' ? 
                (ownerName || String(device.deviceId)) : String(device.deviceId);
              
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
                      (() => {
                        const zid = zoneIdForGrouping;
                        const zoneColor = zid ? zoneColorMap[zid] : null;
                        const bg = zoneColor || '#555';
                        const text = pickTextColor(bg);
                        const style = { 
                          backgroundColor: bg,
                          color: text,
                          border: `1px solid ${bg}`,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        };
                        return (
                          <Badge 
                            variant="filled" 
                            size="xs"
                            style={style}
                            title={zid ? `Zone group: ${readableZone}` : 'No Zone'}
                          >
                            {zid ? readableZone : 'No Zone'}
                          </Badge>
                        );
                      })()
                    )}
                  </div>
                  <div 
                    className={`fitness-device card-horizontal ${getDeviceColor(device)} ${device.isActive ? 'active' : 'inactive'} ${getZoneClass(device)}`}
                    title={`Device: ${deviceName} (${device.deviceId}) - ${formatTimeAgo(device.lastSeen)}`}
                  >
                    <div className={`user-profile-img-container ${getZoneClass(device)}`}>
                      <img
                        src={DaylightMediaPath(device.type === 'heart_rate'
                          ? `/media/img/users/${profileId}`
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
                            ? `/media/img/users/user`
                            : `/media/img/equipment/equipment`);
                        }}
                      />
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
            <div className="empty-icon">📶</div>
            <div
              className="live-status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '12px',
                opacity: 0.95,
                marginBottom: 6
              }}
            >
              <span
                aria-label={connected ? 'Connected' : 'Disconnected'}
                title={connected ? 'Connected' : 'Disconnected'}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: connected ? '#51cf66' : '#ff6b6b',
                  boxShadow: `0 0 6px ${connected ? '#51cf66' : '#ff6b6b'}, 0 0 12px ${connected ? '#51cf66aa' : '#ff6b6baa'}`
                }}
              />
              <span>{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            {!connected && (
              <button
                type="button"
                className="ws-reconnect-btn"
                onClick={() => fitnessContext?.reconnectFitnessWebSocket?.()}
                style={{
                  background: '#222',
                  color: '#ffd43b',
                  border: '1px solid #444',
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Reconnect
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessUsers;
