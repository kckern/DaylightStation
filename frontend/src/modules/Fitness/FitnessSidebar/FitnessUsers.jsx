import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Badge } from '@mantine/core';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import getLogger from '../../../lib/logging/Logger.js';
import FlipMove from 'react-flip-move';
import '../FitnessSidebar.scss';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import RpmDeviceAvatar from '../components/RpmDeviceAvatar.jsx';
import { useZoneProfiles } from '../../../hooks/useZoneProfiles.js';

// Note: slugifyId has been removed - we now use explicit IDs from config

// Config-driven constants (single source of truth for UI & heuristics)
const CONFIG = {
  uiLabels: {
    RPM_GROUP_TITLE: 'RPM Devices',
    NO_ZONE_BADGE: 'No Zone',
    ZONE_BADGE_TOOLTIP_PREFIX: 'Zone group:',
    NO_ZONE_TOOLTIP: 'No Zone',
    EMPTY_DEVICES_ICON: '📶',
    CONNECTED_STATUS: 'Ready for Users',
    DISCONNECTED_STATUS: 'Disconnected',
    RECONNECT_BUTTON: 'Reconnect',
    DEVICE_TOOLTIP_PREFIX: 'Device:',
    TIME_JUST_NOW: 'Just now',
    TIME_NEVER: 'Never',
    TIME_SECONDS_SUFFIX: 's ago',
    TIME_MINUTES_SUFFIX: 'm ago',
    TIME_HOURS_SUFFIX: 'h ago'
  },
  devices: {
    heart_rate: { unit: 'BPM', colorClass: 'heart-rate', icon: '❤️' }, // HR icon overridden per-device color
    power: { unit: 'W', colorClass: 'power', icon: '⚡' },
    cadence: { unit: 'RPM', colorClass: 'cadence', icon: '⚙️' },
    speed: { unit: 'km/h', colorClass: 'speed', icon: '🚴' },
    jumprope: { unit: 'jumps', colorClass: 'jumprope', icon: '🦘' },
    default: { unit: '', colorClass: 'unknown', icon: '📡' }
  },
  sorting: {
    otherTypeOrder: { power: 1, speed: 2, unknown: 3 }
  },
  zone: {
    canonical: ['cool','active','warm','hot','fire'],
    rankMap: { cool:0, active:1, warm:2, hot:3, fire:4 }
  },
  layout: {
    // Layout decision logic (when vertical is allowed)
    decision: {
      verticalUserMax: 2 // consider vertical if 0 < users <= 2 (same as threshold < 3)
    },
    // Card dimensions and classes per layout mode
    cards: {
      horizontal: { height: 78, cardClass: 'card-horizontal' },
      vertical: { height: 176, cardClass: 'card-vertical' }
    },
    // Grid and spacing
    grid: { gap: 10 },
    margin: { safety: 8 },
    // Auto scaling limits
    scale: { min: 0.4, max: 1.0, safetyFactor: 0.98 },
    // Horizontal density scaling rules
    horizontalScaleRules: [
      { exactUsers: 3, className: 'horiz-scale-150' },
      { exactUsers: 4, className: 'horiz-scale-130' }
      // Threshold examples supported: { maxUsers: 4, className: 'horiz-scale-130' }
    ]
  },
  rpm: {
    animationBase: 270, // used to compute spin speed
    scale: { min: 0.4, overflowFactor: 0.8 },
    colorMap: {
      red: '#ff6b6b',
      orange: '#ff922b',
      yellow: '#f0c836ff',
      green: '#51cf66',
      blue: '#6ab8ff'
    },
    overlayBg: '#00000088'
  },
  heartRate: {
    colorIcons: {
      red: '❤️',
      yellow: '💛',
      green: '💚',
      blue: '💙',
      watch: '🤍',
      orange: '🧡'
    },
    fallbackIcon: '🧡'
  },
  color: {
    luminanceThreshold: 0.6,
    fallbackTextDark: '#222',
    fallbackTextLight: '#fff',
    zoneBadgeDefaultBg: '#555'
  },
  statusColors: {
    connected: '#51cf66',
    disconnected: '#ff6b6b',
    connectedGlow: '#51cf66aa',
    disconnectedGlow: '#ff6b6baa'
  },
  animation: {
    flipMove: { duration: 300, easing: 'ease-out', staggerDelayBy: 20, enter: 'fade', leave: 'fade' }
  },
  time: {
    justNowThresholdSec: 10
  }
};

// Backward-compat constant for existing references
const UI_LABELS = CONFIG.uiLabels;

const FitnessUsersList = ({ onRequestGuestAssignment }) => {
  // Use the fitness context
  const fitnessContext = useFitnessContext();
  
  const {
    connected,
    fitnessDevices,
    allDevices: contextAllDevices,
    activeHeartRateParticipants, // Phase 1 SSOT: Use this instead of filtering devices
    rpmDevices: contextRpmDevices, // Phase 2 SSOT: Centralized RPM selector
    equipmentDevices: contextEquipmentDevices, // Phase 2 SSOT: Centralized equipment selector
    deviceConfiguration,
    equipment,
    users,
    hrColorMap: contextHrColorMap,
    zones,
    deviceAssignments = [],
    getDeviceAssignment,
    userZoneProgress,
    getUserVitals,
    participantsByDevice: participantsByDeviceMap,
    participantRoster,
    getUserByDevice,
    userCollections,
    fitnessConfiguration, // Household config SSOT for user display labels
    deviceOwnership,
    getDisplayName, // Phase 4 SSOT: Use this instead of hrDisplayNameMap
  } = fitnessContext;

  // Use context-provided arrays if available, fallback to derivation for backward compat
  const allDevices = React.useMemo(() => {
    if (contextAllDevices) return contextAllDevices;
    return fitnessDevices ? Array.from(fitnessDevices.values()) : [];
  }, [fitnessDevices, contextAllDevices]);

  // Phase 1 SSOT: Use canonical participant list from context
  const heartRateDevices = activeHeartRateParticipants || [];
  
  // Phase 2 SSOT: Use domain selectors from context
  const rpmDevices = contextRpmDevices || [];
  const equipmentDevices = contextEquipmentDevices || [];

  const zoneProfiles = useZoneProfiles();

  const normalizedCollections = userCollections || {};
  const configuredUsers = normalizedCollections.all || [];

  const registeredUsers = React.useMemo(() => {
    if (users instanceof Map) {
      return Array.from(users.values());
    }
    if (Array.isArray(users)) {
      return users;
    }
    if (users && typeof users === 'object') {
      return Object.values(users);
    }
    return [];
  }, [users]);

  const assignmentMap = React.useMemo(() => {
    const map = new Map();
    deviceAssignments.forEach((entry) => {
      if (!entry || entry.deviceId == null) return;
      map.set(String(entry.deviceId), entry);
    });
    return map;
  }, [deviceAssignments]);

  const guestAssignmentEntries = React.useMemo(() => Array.from(assignmentMap.entries()), [assignmentMap]);

  const getGuestAssignment = React.useCallback((deviceId) => {
    if (deviceId == null) return null;
    const fromMap = assignmentMap.get(String(deviceId)) || null;
    if (fromMap) return fromMap;
    if (typeof getDeviceAssignment === 'function') {
      return getDeviceAssignment(deviceId);
    }
    return null;
  }, [assignmentMap, getDeviceAssignment]);

  const userProfileIdMap = React.useMemo(() => {
    const map = new Map();
    const addEntry = (descriptor) => {
      if (!descriptor?.name) return;
      // Use profileId or id directly - never slugify the display name
      const profileId = descriptor.profileId || descriptor.id;
      if (!profileId) {
        getLogger().warn('fitness_users.user_missing_id', { name: descriptor.name });
        return;
      }
      const addKey = (value) => {
        if (!value) return;
        const normalized = String(value).trim().toLowerCase();
        if (normalized) {
          map.set(normalized, profileId);
        }
      };
      addKey(descriptor.name);
      addKey(descriptor.slug);
      addKey(descriptor.groupLabel);
      addKey(descriptor.id); // Also map the id itself
    };
    configuredUsers.forEach(addEntry);
    return map;
  }, [configuredUsers]);

  const getConfiguredProfileId = React.useCallback((name) => {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    if (!key) return null;
    return userProfileIdMap.get(key) || null;
  }, [userProfileIdMap]);

  const heartRateOwners = React.useMemo(() => {
    const ownership = deviceOwnership?.heartRate;
    if (ownership instanceof Map) return ownership;
    if (ownership && typeof ownership === 'object') {
      const map = new Map();
      Object.entries(ownership).forEach(([deviceId, descriptor]) => {
        map.set(String(deviceId), descriptor);
      });
      return map;
    }
    return new Map();
  }, [deviceOwnership]);

  const zoneProfileLookup = React.useMemo(() => {
    const map = new Map();
    zoneProfiles.forEach((profile) => {
      // Use profile.id as primary key
      const profileId = profile?.id || profile?.profileId;
      if (!profileId) return;
      map.set(profileId, profile);
      // Also set by name for backward compatibility
      if (profile.name) {
        map.set(profile.name, profile);
      }
    });
    return map;
  }, [zoneProfiles]);

  const resolveZoneProfile = React.useCallback((idOrName) => {
    if (!idOrName) return null;
    // Direct lookup
    return zoneProfileLookup.get(idOrName) || null;
  }, [zoneProfileLookup]);

  const deriveZoneFromProfile = React.useCallback((profile, heartRate) => {
    if (!profile || !Number.isFinite(heartRate)) return null;
    const sequence = Array.isArray(profile.zoneSnapshot?.zoneSequence)
      ? profile.zoneSnapshot.zoneSequence
      : profile.zoneSequence;
    if (!Array.isArray(sequence) || sequence.length === 0) return null;
    const sorted = sequence.slice().sort((a, b) => (a?.threshold ?? 0) - (b?.threshold ?? 0));
    let resolved = sorted[0]?.id || null;
    sorted.forEach((zone, index) => {
      const threshold = Number.isFinite(zone?.threshold)
        ? zone.threshold
        : (index === 0 ? 0 : null);
      if (threshold == null) return;
      if (heartRate >= threshold) {
        resolved = zone.id || resolved;
      }
    });
    return resolved;
  }, []);

  const participantsByDevice = React.useMemo(() => {
    if (participantsByDeviceMap instanceof Map) return participantsByDeviceMap;
    if (participantsByDeviceMap && typeof participantsByDeviceMap === 'object') {
      const map = new Map();
      Object.entries(participantsByDeviceMap).forEach(([key, value]) => {
        map.set(String(key), value);
      });
      return map;
    }
    return new Map();
  }, [participantsByDeviceMap]);

  const { userIdMap, participantByHrId } = React.useMemo(() => {
    const participantMap = new Map();
    const map = {};

    const assignProfile = (deviceId, profileId) => {
      if (deviceId == null || !profileId) return;
      map[String(deviceId)] = profileId;
    };

    const registerParticipant = (deviceId, participant) => {
      if (deviceId == null || !participant) return;
      const normalized = String(deviceId);
      if (!participantMap.has(normalized)) {
        participantMap.set(normalized, participant);
      }
      if (!map[normalized]) {
        const profileId = participant.profileId
          || participant.id
          || getConfiguredProfileId(participant.name);
        if (profileId) map[normalized] = profileId;
      }
    };

    if (Array.isArray(participantRoster)) {
      participantRoster.forEach((participant) => {
        registerParticipant(participant?.hrDeviceId, participant);
      });
    }

    participantsByDevice.forEach((participant, key) => {
      registerParticipant(key, participant);
    });

    heartRateOwners.forEach((descriptor, deviceId) => {
      const profileId = descriptor?.profileId || descriptor?.id;
      if (profileId) assignProfile(deviceId, profileId);
    });

    guestAssignmentEntries.forEach(([deviceId, assignment]) => {
      if (!assignment) return;
      const profileId = assignment.metadata?.profileId
        || assignment.metadata?.candidateId
        || assignment.occupantId;
      if (profileId) assignProfile(deviceId, profileId);
    });

    registeredUsers.forEach((user) => {
      if (user?.hrDeviceId !== undefined && user?.hrDeviceId !== null && user?.id) {
        assignProfile(user.hrDeviceId, user.id);
      }
    });

    return { userIdMap: map, participantByHrId: participantMap };
  }, [participantRoster, participantsByDevice, guestAssignmentEntries, registeredUsers, getConfiguredProfileId, heartRateOwners]);

  const zoneProgressMap = React.useMemo(() => {
    const map = new Map();
    if (!userZoneProgress) return map;
    const addEntry = (key, value) => {
      if (!key || !value) return;
      map.set(key, value);
      // Also set by name for backward compatibility
      if (value?.name) {
        const nameKey = String(value.name).trim();
        if (nameKey && nameKey !== key) {
          map.set(nameKey, value);
        }
      }
    };
    if (userZoneProgress instanceof Map) {
      userZoneProgress.forEach((value, key) => addEntry(key, value));
      return map;
    }
    if (typeof userZoneProgress === 'object') {
      Object.entries(userZoneProgress).forEach(([key, value]) => addEntry(key, value));
    }
    return map;
  }, [userZoneProgress]);

  const lookupZoneProgress = React.useCallback((idOrName) => {
    if (!idOrName) return null;
    return zoneProgressMap.get(idOrName) || null;
  }, [zoneProgressMap]);

  // State for sorted devices
  const [sortedDevices, setSortedDevices] = useState([]);
  const [scale, setScale] = useState(1);
  const [rpmScale, setRpmScale] = useState(1);
  const [layoutMode, setLayoutMode] = useState('horiz'); // 'horiz' | 'vert' for heart-rate user cards
  const hrCounts = React.useMemo(() => {
    if (!allDevices) return { all: 0, active: 0, candidate: 0 };
    const hrAll = allDevices.filter(d => d.type === 'heart_rate');
    const hrActive = hrAll.filter(d => d.isActive);
    const candidate = (hrActive.length > 0 ? hrActive.length : hrAll.length);
    return { all: hrAll.length, active: hrActive.length, candidate };
  }, [allDevices]);
  const containerRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const measureRef = React.useRef(null); // Hidden ref for measurement
  const rpmGroupRef = React.useRef(null);

  // Build lookup maps for heart rate device colors and user assignments
  const hrColorMap = React.useMemo(() => {
    const direct = contextHrColorMap || {};
    if (direct && Object.keys(direct).length > 0) return direct;
    const fallbackSrc = deviceConfiguration?.hr || {};
    const rebuilt = {};
    Object.keys(fallbackSrc).forEach(k => { rebuilt[String(k)] = fallbackSrc[k]; });
    return rebuilt;
  }, [contextHrColorMap, deviceConfiguration]);

  const cadenceColorMap = React.useMemo(() => {
    const map = {};
    const cadenceSrc = deviceConfiguration?.cadence || {};
    Object.keys(cadenceSrc).forEach(k => { map[String(k)] = cadenceSrc[k]; });
    return map;
  }, [deviceConfiguration]);

  // Map of deviceId -> user name (config + roster fallbacks)
  const hrOwnerBaseMap = React.useMemo(() => {
    const map = {};
    participantByHrId.forEach((participant, key) => {
      if (!participant?.name) return;
      map[String(key)] = participant.name;
    });
    heartRateOwners.forEach((descriptor, deviceId) => {
      if (descriptor?.name) {
        map[String(deviceId)] = descriptor.name;
      }
    });
    registeredUsers.forEach((user) => {
      if (user?.hrDeviceId !== undefined && user?.hrDeviceId !== null && user?.name) {
        map[String(user.hrDeviceId)] = user.name;
      }
    });
    return map;
  }, [participantByHrId, heartRateOwners, registeredUsers]);

  const hrOwnerMap = React.useMemo(() => {
    const map = { ...hrOwnerBaseMap };
    guestAssignmentEntries.forEach(([deviceId, assignment]) => {
      const occupantName = assignment?.occupantName || assignment?.metadata?.name;
      if (occupantName) {
        map[String(deviceId)] = occupantName;
      }
    });
    return map;
  }, [hrOwnerBaseMap, guestAssignmentEntries]);

  // Build a map of deviceId -> displayName applying group_label rule
  const hrDisplayNameMap = React.useMemo(() => {
    const logger = getLogger();

    if (!allDevices) {
      logger.debug('fitness_users.hr_display_name_map.no_devices');
      return hrOwnerMap;
    }

    const activeHrDeviceIds = allDevices
      .filter(d => d.type === 'heart_rate')
      .map(d => String(d.deviceId));

    logger.debug('fitness_users.hr_display_name_map.recompute', {
      activeHrCount: activeHrDeviceIds.length,
      activeHrDeviceIds
    });

    if (activeHrDeviceIds.length <= 1) {
      logger.debug('fitness_users.hr_display_name_map.single_device_no_override', {
        count: activeHrDeviceIds.length
      });
      return hrOwnerMap;
    }

    // Multi-device mode: apply groupLabel overrides
    const labelLookup = {};
    heartRateOwners.forEach((descriptor, deviceId) => {
      if (descriptor?.groupLabel) {
        labelLookup[String(deviceId)] = descriptor.groupLabel;
      }
    });

    if (Object.keys(labelLookup).length === 0) {
      logger.debug('fitness_users.hr_display_name_map.no_group_labels_configured');
      return hrOwnerMap;
    }

    const out = { ...hrOwnerMap };
    const appliedOverrides = [];
    const skippedGuests = [];

    Object.keys(labelLookup).forEach(deviceId => {
      // Only skip group_label for actual guests, not for device owners/members
      const assignment = getGuestAssignment(deviceId);
      if (assignment?.occupantType === 'guest') {
        skippedGuests.push({ deviceId, reason: 'guest_assigned', occupantType: assignment.occupantType });
        return;
      }
      if (out[deviceId]) {
        appliedOverrides.push({
          deviceId,
          from: out[deviceId],
          to: labelLookup[deviceId]
        });
        out[deviceId] = labelLookup[deviceId];
      }
    });

    logger.info('fitness_users.hr_display_name_map.group_label_override', {
      activeHrCount: activeHrDeviceIds.length,
      appliedOverrides,
      skippedGuests,
      availableGroupLabels: labelLookup
    });

    return out;
  }, [hrOwnerMap, allDevices, heartRateOwners, getGuestAssignment]);

  const resolveCanonicalUserName = React.useCallback((deviceId, fallbackName = null) => {
    if (deviceId == null) return fallbackName;
    const key = String(deviceId);
    if (hrOwnerMap[key]) return hrOwnerMap[key];
    const guest = getGuestAssignment(key);
    if (guest?.occupantName || guest?.metadata?.name) return guest.occupantName || guest.metadata.name;
    if (hrOwnerBaseMap[key]) return hrOwnerBaseMap[key];
    return fallbackName;
  }, [hrOwnerMap, getGuestAssignment, hrOwnerBaseMap]);

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

  // Map of deviceId -> equipment name and ID
  const equipmentMap = React.useMemo(() => {
    const map = {};
    if (Array.isArray(equipment)) {
      equipment.forEach(e => {
        const entry = {
          name: e.name,
          id: e.id || e.name.toLowerCase(),
          type: e.type,
          showRevolutions: e.showRevolutions ?? (e.type === 'jumprope')
        };
        if (e?.rpm) {
          entry.rpm = e.rpm;
        }
        if (e?.cadence) {
          map[String(e.cadence)] = entry;
        }
        if (e?.speed) {
          map[String(e.speed)] = entry;
        }
        if (e?.ble) {
          map[String(e.ble)] = entry;
        }
      });
    }
    return map;
  }, [equipment]);

  const heartColorIcon = (deviceId) => {
    const deviceIdStr = String(deviceId);
    const colorKey = hrColorMap[deviceIdStr];
    if (!colorKey) return CONFIG.heartRate.fallbackIcon;
    return CONFIG.heartRate.colorIcons[colorKey] || CONFIG.heartRate.fallbackIcon;
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return UI_LABELS.TIME_NEVER;
    const seconds = Math.floor((new Date() - timestamp) / 1000);
    if (seconds < CONFIG.time.justNowThresholdSec) return UI_LABELS.TIME_JUST_NOW;
    if (seconds < 60) return `${seconds}${UI_LABELS.TIME_SECONDS_SUFFIX}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${UI_LABELS.TIME_MINUTES_SUFFIX}`;
    const hours = Math.floor(minutes / 60);
    return `${hours}${UI_LABELS.TIME_HOURS_SUFFIX}`;
  };

  const getDeviceIcon = (device) => {
    if (device.type === 'heart_rate') return heartColorIcon(device.deviceId);
    return (CONFIG.devices[device.type] || CONFIG.devices.default).icon;
  };

  const getDeviceValue = (device, { canonicalUserName, vitals } = {}) => {
    if (device.type === 'heart_rate') {
      const resolvedName = canonicalUserName || resolveCanonicalUserName(device.deviceId);
      const resolvedVitals = vitals
        || (resolvedName && typeof getUserVitals === 'function' ? getUserVitals(resolvedName) : null);
      const hrValue = Number.isFinite(resolvedVitals?.heartRate)
        ? resolvedVitals.heartRate
        : (Number.isFinite(device.heartRate) ? device.heartRate : null);
      return Number.isFinite(hrValue) && hrValue > 0 ? `${Math.round(hrValue)}` : '--';
    }
    if (device.type === 'power' && device.power) return `${device.power}`;
    if (device.type === 'cadence' && device.cadence) return `${device.cadence}`;
    if (device.type === 'speed' && device.speedKmh) return `${device.speedKmh.toFixed(1)}`;
    if (device.type === 'jumprope') {
      // Show total jumps and RPM for jumprope: "150 @ 120"
      const jumps = device.revolutionCount ?? null;
      const rpm = device.cadence ?? null;
      if (Number.isFinite(jumps) && Number.isFinite(rpm) && rpm > 0) {
        return `${Math.round(jumps)} @ ${Math.round(rpm)}`;
      }
      if (Number.isFinite(jumps)) {
        return `${Math.round(jumps)}`;
      }
      return '--';
    }
    return '--';
  };

  const getDeviceUnit = (device) => (CONFIG.devices[device.type] || CONFIG.devices.default).unit;
  const getDeviceColor = (device) => (CONFIG.devices[device.type] || CONFIG.devices.default).colorClass;

  const handleAvatarClick = React.useCallback((device) => {
    if (!device || device.type !== 'heart_rate') return;
    const deviceId = String(device.deviceId);
    const defaultName = hrOwnerBaseMap[deviceId] || null;
    onRequestGuestAssignment?.({ deviceId, defaultName });
  }, [onRequestGuestAssignment, hrOwnerBaseMap]);

  const canonicalZones = CONFIG.zone.canonical;
  const zoneRankMap = CONFIG.zone.rankMap;
  const getDeviceZoneId = (device) => {
    if (device.type !== 'heart_rate') return null;
    const deviceKey = String(device.deviceId);
    const participantEntry = participantByHrId.get(deviceKey) || participantsByDevice.get(deviceKey) || null;
    const userObj = typeof getUserByDevice === 'function'
      ? getUserByDevice(deviceKey)
      : registeredUsers.find(u => String(u.hrDeviceId) === deviceKey);
    const canonicalName = resolveCanonicalUserName(device.deviceId, participantEntry?.name || userObj?.name);
    const vitals = canonicalName && typeof getUserVitals === 'function' ? getUserVitals(canonicalName) : null;
    let zoneId = vitals?.zoneId ? String(vitals.zoneId).toLowerCase() : null;

    if (!zoneId && vitals?.zoneColor) {
      const mapped = colorToZoneId[String(vitals.zoneColor).toLowerCase()] || null;
      if (mapped) {
        zoneId = String(mapped).toLowerCase();
      }
    }

    if (!zoneId && participantEntry?.zoneId) {
      zoneId = String(participantEntry.zoneId).toLowerCase();
    }

    if (!zoneId || !canonicalZones.includes(zoneId)) {
      const profileName = canonicalName || participantEntry?.name || userObj?.name;
      const zoneProfile = resolveZoneProfile(profileName);
      if (zoneProfile?.currentZoneId) {
        zoneId = String(zoneProfile.currentZoneId).toLowerCase();
      } else if (zoneProfile?.zoneSnapshot?.currentZoneId) {
        zoneId = String(zoneProfile.zoneSnapshot.currentZoneId).toLowerCase();
      } else if (zoneProfile) {
        const hrValue = Number(device?.heartRate);
        if (Number.isFinite(hrValue) && hrValue > 0) {
          const derivedId = deriveZoneFromProfile(zoneProfile, hrValue);
          if (derivedId) {
            zoneId = String(derivedId).toLowerCase();
          }
        }
      }
    }

    if (!zoneId) return null;
    return canonicalZones.includes(zoneId) ? zoneId : null;
  };

  const pickTextColor = (bg) => {
    if (!bg) return CONFIG.color.fallbackTextDark;
    const ctx = document.createElement ? document.createElement('canvas') : null;
    let hex = bg;
    if (/^[a-zA-Z]+$/.test(bg) && ctx) {
      const c = ctx.getContext('2d');
      if (c) {
        c.fillStyle = bg;
        hex = c.fillStyle;
      }
    }
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
    if ([r,g,b].some(v => v === undefined)) return CONFIG.color.fallbackTextDark;
    const luminance = (0.299*r + 0.587*g + 0.114*b)/255;
    return luminance > CONFIG.color.luminanceThreshold ? CONFIG.color.fallbackTextDark : CONFIG.color.fallbackTextLight;
  };

  useEffect(() => {
    // Phase 1 SSOT: Use activeHeartRateParticipants directly from context
    // No more inline roster-to-device derivation - that logic now lives in FitnessContext
    const hrDevices = [...(activeHeartRateParticipants || [])];

    // Phase 2 SSOT: Use domain selectors from context instead of filtering allDevices
    const rpmDevicesCopy = [...rpmDevices];
    const otherDevices = [...equipmentDevices];

    // HR: Sort by zone rank, then by zone progress (not raw HR)
    hrDevices.sort((a, b) => {
      const aZone = getDeviceZoneId(a);
      const bZone = getDeviceZoneId(b);
      const aRank = aZone ? zoneRankMap[aZone] : -1;
      const bRank = bZone ? zoneRankMap[bZone] : -1;
      if (bRank !== aRank) return bRank - aRank;

      // Secondary sort: zone progress (normalized within zone)
      const aName = resolveCanonicalUserName(a.deviceId);
      const bName = resolveCanonicalUserName(b.deviceId);
      const aProgress = lookupZoneProgress(aName)?.progress ?? 0;
      const bProgress = lookupZoneProgress(bName)?.progress ?? 0;
      if (bProgress !== aProgress) return bProgress - aProgress;

      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });

    // RPM: Sort by appearance time (stable deviceId order), active devices first
    rpmDevicesCopy.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;

      // Stable sort by deviceId to preserve appearance order
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });

    otherDevices.sort((a, b) => {
      const typeOrder = CONFIG.sorting.otherTypeOrder;
      const fallback = typeOrder.unknown || 3;
      const typeA = typeOrder[a.type] || fallback;
      const typeB = typeOrder[b.type] || fallback;
      if (typeA !== typeB) return typeA - typeB;
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      const valueA = a.power || (a.speedKmh || 0);
      const valueB = b.power || (b.speedKmh || 0);
      return valueB - valueA;
    });

    const combined = [...hrDevices];
    // Single unified RPM group
    if (rpmDevicesCopy.length > 0) {
      combined.push({ type: 'rpm-group', devices: rpmDevicesCopy });
    }
    combined.push(...otherDevices);
    setSortedDevices(combined);
  }, [equipmentMap, resolveCanonicalUserName, lookupZoneProgress, activeHeartRateParticipants, rpmDevices, equipmentDevices]);

  // Decide vertical vs horizontal layout for user (heart_rate) cards
  useLayoutEffect(() => {
    if (!containerRef.current || !allDevices) return;
    // Count heart_rate users that are active; fallback to all heart_rate when none marked active
    // Phase 1 SSOT: Use activeHeartRateParticipants for HR count
    const hrAll = activeHeartRateParticipants || [];
    const hrActive = hrAll.filter(d => d.isActive);
    const hrCountCandidate = (hrActive.length > 0 ? hrActive.length : hrAll.length);

    if (hrCountCandidate > 0 && hrCountCandidate <= 2) {
      setLayoutMode('vert');
      return;
    }

    // Heuristic gate: only consider vertical when fewer than 3 users
  const allowVerticalByCount = hrCountCandidate > 0 && hrCountCandidate <= CONFIG.layout.decision.verticalUserMax;
    if (!allowVerticalByCount) {
      setLayoutMode('horiz');
      return;
    }

    // Estimate total height without scaling if we render HR cards vertically
    const containerHeight = containerRef.current.clientHeight || 0;

  // Empirical per-card heights (sidebar styles) from CONFIG:
  const HORIZ_CARD_H = CONFIG.layout.cards.horizontal.height;
  const VERT_CARD_H = CONFIG.layout.cards.vertical.height;
  const GRID_GAP = CONFIG.layout.grid.gap;

    let count = 0;
    let total = 0;
    sortedDevices.forEach(d => {
      const isHR = d.type === 'heart_rate';
      const h = (isHR ? VERT_CARD_H : HORIZ_CARD_H);
      total += h;
      count += 1;
    });
    // add gaps between cards
    if (count > 1) total += (count - 1) * GRID_GAP;
  // small safety margin
  total += CONFIG.layout.margin.safety;

    if (total <= containerHeight) {
      setLayoutMode('vert');
    } else {
      setLayoutMode('horiz');
    }
  }, [sortedDevices, allDevices]);

  // Auto-scale content to fit container
  useEffect(() => {
    if (!containerRef.current || !contentRef.current) return;
    
    // Don't scale if showing empty state (no devices)
    if (sortedDevices.length === 0) {
      setScale(1);
      return;
    }
    
    const containerHeight = containerRef.current.clientHeight;
    const naturalContentHeight = contentRef.current.scrollHeight;
    
    // Calculate ideal scale to fill container
  const idealScale = containerHeight / naturalContentHeight;
  const { min, max, safetyFactor } = CONFIG.layout.scale;
  // Do not upscale above max so a single user matches multi-user sizing
  const newScale = Math.max(min, Math.min(max, idealScale * safetyFactor));
    
    setScale(newScale);
  }, [sortedDevices]); // Only recalculate when devices change, not on scale changes

  // Auto-scale RPM group to fit width
  useEffect(() => {
    if (!rpmGroupRef.current || !containerRef.current) return;

    const rpmContainer = rpmGroupRef.current;
    const containerWidth = containerRef.current.clientWidth || 0;
    const scrollWidth = rpmContainer.scrollWidth;

    if (scrollWidth > containerWidth && containerWidth > 0) {
      const idealRpmScale = containerWidth / scrollWidth;
      const { min, overflowFactor } = CONFIG.rpm.scale;
      setRpmScale(Math.max(min, idealRpmScale * overflowFactor));
    } else {
      setRpmScale(1);
    }
  }, [sortedDevices]);

  return (
    <>
      <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
      
      <div className="fitness-devices" ref={containerRef}>
        <div 
          ref={contentRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
            margin: '0 auto',
            width: '100%'
          }}
        >
        {sortedDevices.length > 0 ? (
          <FlipMove 
            className={`device-grid ${layoutMode === 'vert' ? 'layout-vert' : 'layout-horiz'} ${layoutMode === 'horiz' ? (CONFIG.layout.horizontalScaleRules.find(r => (r.exactUsers && r.exactUsers === hrCounts.candidate) || (r.maxUsers && hrCounts.candidate <= r.maxUsers))?.className || '') : ''}`}
            duration={CONFIG.animation.flipMove.duration}
            easing={CONFIG.animation.flipMove.easing}
            staggerDelayBy={CONFIG.animation.flipMove.staggerDelayBy}
            enterAnimation={CONFIG.animation.flipMove.enter}
            leaveAnimation={CONFIG.animation.flipMove.leave}
            maintainContainerHeight={true}
          >
            {(() => {
              const seenZones = new Set();
              let noZoneShown = false;
              return sortedDevices.map((device) => {
              if (device.type === 'rpm-group') {
                const rpmDevices = device.devices;
                const isMultiDevice = rpmDevices.length > 1;
                
                return (
                  <div 
                    key="rpm-group" 
                    ref={rpmGroupRef}
                    className={`rpm-group-container ${isMultiDevice ? 'multi-device' : 'single-device'}`}
                    style={{
                      transform: `scale(${rpmScale})`,
                      transformOrigin: 'left center'
                    }}
                  >
                    <div className={`rpm-devices devicecount_${rpmDevices.length}`}>
                      {rpmDevices.map(rpmDevice => {
                        const equipmentInfo = equipmentMap[String(rpmDevice.deviceId)];
                        const deviceName = equipmentInfo?.name || String(rpmDevice.deviceId);
                        const equipmentId = equipmentInfo?.id || String(rpmDevice.deviceId);
                        const rpmValue = Number.isFinite(rpmDevice.cadence)
                          ? Math.max(0, Math.round(rpmDevice.cadence))
                          : 0;
                        const animationDuration = rpmValue > 0
                          ? `${CONFIG.rpm.animationBase / Math.max(rpmValue, 1)}s`
                          : '0s';
                        const deviceColor = cadenceColorMap[String(rpmDevice.deviceId)];
                        const colorMap = CONFIG.rpm.colorMap;
                        const borderColor = deviceColor ? (colorMap[deviceColor] || deviceColor) : colorMap.green;

                        return (
                          <RpmDeviceAvatar
                            key={`rpm-${rpmDevice.deviceId}`}
                            rpm={rpmValue}
                            animationDuration={animationDuration}
                            avatarSrc={DaylightMediaPath(`/static/img/equipment/${equipmentId}`)}
                            avatarAlt={deviceName}
                            imageClassName="rpm-device-image"
                            spinnerStyle={{ borderColor }}
                            valueStyle={{ background: CONFIG.rpm.overlayBg }}
                            fallbackSrc={DaylightMediaPath('/static/img/equipment/equipment')}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              }
              
              const deviceIdStr = String(device.deviceId);
              const isHeartRate = device.type === 'heart_rate';
              const guestAssignment = isHeartRate ? getGuestAssignment(deviceIdStr) : null;
              const ownerName = isHeartRate ? hrDisplayNameMap[deviceIdStr] : null;
              const equipmentInfo = equipmentMap[String(device.deviceId)];
              const participantEntry = isHeartRate
                ? (participantByHrId.get(deviceIdStr) || participantsByDevice.get(deviceIdStr) || null)
                : null;
              const resolvedUser = isHeartRate
                ? (typeof getUserByDevice === 'function'
                    ? getUserByDevice(deviceIdStr)
                    : registeredUsers.find(u => String(u.hrDeviceId) === deviceIdStr))
                : null;
              const canonicalUserName = isHeartRate
                ? resolveCanonicalUserName(deviceIdStr, guestAssignment?.occupantName || guestAssignment?.metadata?.name || participantEntry?.name || resolvedUser?.name || null)
                : null;
              const userVitalsEntry = isHeartRate && canonicalUserName && typeof getUserVitals === 'function'
                ? getUserVitals(canonicalUserName)
                : null;
              const displayLabel = userVitalsEntry?.displayLabel || participantEntry?.displayLabel || null;
              const profileId = isHeartRate
                ? (guestAssignment?.metadata?.profileId
                    || guestAssignment?.metadata?.candidateId
                    || guestAssignment?.occupantSlug
                    || participantEntry?.profileId
                    || participantEntry?.id
                    || userIdMap[deviceIdStr]
                    || getConfiguredProfileId(guestAssignment?.occupantName || guestAssignment?.metadata?.name)
                    || getConfiguredProfileId(participantEntry?.name)
                    || getConfiguredProfileId(ownerName)
                    || resolvedUser?.id
                    || 'user') // Fallback to generic avatar instead of slugifying
                : (equipmentInfo?.id || 'equipment');
              const progressInfo = isHeartRate
                ? (lookupZoneProgress(participantEntry?.name)
                    || lookupZoneProgress(ownerName)
                    || lookupZoneProgress(canonicalUserName)
                    || (participantEntry?.displayLabel ? lookupZoneProgress(participantEntry.displayLabel) : null)
                    || (participantEntry?.id ? lookupZoneProgress(participantEntry.id) : null)
                    || (userVitalsEntry
                      ? {
                          progress: userVitalsEntry.progress ?? null,
                          showBar: userVitalsEntry.showBar ?? false,
                          zoneColor: userVitalsEntry.zoneColor ?? null
                        }
                      : null))
                : null;
              const normalizedProgress = (typeof progressInfo?.progress === 'number')
                ? Math.max(0, Math.min(1, progressInfo.progress))
                : null;
              const shouldShowProgressBar = Boolean(progressInfo && (progressInfo.showBar || normalizedProgress !== null));
              const resolvedHeartRate = Number.isFinite(userVitalsEntry?.heartRate)
                ? userVitalsEntry.heartRate
                : (Number.isFinite(participantEntry?.heartRate)
                  ? participantEntry.heartRate
                  : (Number.isFinite(device.heartRate) ? device.heartRate : null));
              // Resolve deviceName with source tracking for diagnostics
              // Priority for guests: guestAssignment > ownerName
              // Priority for members: ownerName (hrDisplayNameMap - has group_label awareness) > displayLabel > participantEntry
              let deviceName;
              let deviceNameSource;
              if (isHeartRate) {
                // Only use guestAssignment for actual guests, not for members/owners
                const isActualGuest = guestAssignment?.occupantType === 'guest';
                if (isActualGuest && guestAssignment?.occupantName) {
                  deviceName = guestAssignment.occupantName;
                  deviceNameSource = 'guestAssignment.occupantName';
                } else if (isActualGuest && guestAssignment?.metadata?.name) {
                  deviceName = guestAssignment.metadata.name;
                  deviceNameSource = 'guestAssignment.metadata.name';
                } else if (ownerName) {
                  // ownerName from hrDisplayNameMap takes precedence - it has group_label awareness
                  deviceName = ownerName;
                  deviceNameSource = 'ownerName (hrDisplayNameMap)';
                } else if (displayLabel) {
                  deviceName = displayLabel;
                  deviceNameSource = 'displayLabel';
                } else if (participantEntry?.name) {
                  deviceName = participantEntry.name;
                  deviceNameSource = 'participantEntry.name';
                } else {
                  deviceName = deviceIdStr;
                  deviceNameSource = 'deviceIdStr (fallback)';
                }
              } else {
                deviceName = device.name || String(device.deviceId);
                deviceNameSource = device.name ? 'device.name' : 'device.deviceId';
              }

              // Log deviceName resolution for HR devices
              if (isHeartRate) {
                getLogger().debug('fitness_users.device_name_resolved', {
                  deviceId: deviceIdStr,
                  deviceName,
                  deviceNameSource,
                  ownerName,
                  displayLabel,
                  hasGuestAssignment: !!guestAssignment
                });
              }
              const zoneIdForGrouping = isHeartRate ? getDeviceZoneId(device) : null;
              const zoneClass = zoneIdForGrouping ? `zone-${zoneIdForGrouping}` : 'no-zone';
              const zoneBadgeColor = zoneIdForGrouping
                ? (userVitalsEntry?.zoneColor || participantEntry?.zoneColor || progressInfo?.zoneColor || zoneColorMap[zoneIdForGrouping] || null)
                : null;
              const readableZone = zoneIdForGrouping
                ? zoneIdForGrouping.charAt(0).toUpperCase() + zoneIdForGrouping.slice(1)
                : '';
              const showZoneBadge = isHeartRate && (
                (zoneIdForGrouping && !seenZones.has(zoneIdForGrouping)) || (!zoneIdForGrouping && !noZoneShown)
              );
              const deviceValue = getDeviceValue(device, { canonicalUserName, vitals: userVitalsEntry });
              if (zoneIdForGrouping) seenZones.add(zoneIdForGrouping);
              if (!zoneIdForGrouping && device.type === 'heart_rate' && !noZoneShown) noZoneShown = true;

              const removalCountdown = device.removalCountdown;
              const isCountdownActive = Number.isFinite(removalCountdown);
              const countdownWidth = isCountdownActive ? Math.round(removalCountdown * 100) : 0;
              // Robust check for inactivity: handle both class instance (getter) and serialized object (property)
              const isInactive = device.isActive === false || !!device.inactiveSince;

              return (
                <div className="device-wrapper" key={`device-${device.deviceId}`}>
                  <div className={`device-zone-info ${zoneClass} ${device.type === 'heart_rate' && layoutMode === 'vert' ? 'for-vert' : ''}`}>
                    {showZoneBadge && (
                      (() => {
                        const zid = zoneIdForGrouping;
                        const bg = (zid ? zoneBadgeColor : null) || CONFIG.color.zoneBadgeDefaultBg;
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
                            title={zid ? `${UI_LABELS.ZONE_BADGE_TOOLTIP_PREFIX} ${readableZone}` : UI_LABELS.NO_ZONE_TOOLTIP}
                          >
                            {zid ? readableZone : UI_LABELS.NO_ZONE_BADGE}
                          </Badge>
                        );
                      })()
                    )}
                  </div>
                  <div 
                    className={`fitness-device ${isHeartRate ? 'clickable' : ''} ${isHeartRate && layoutMode === 'vert' ? CONFIG.layout.cards.vertical.cardClass : CONFIG.layout.cards.horizontal.cardClass} ${getDeviceColor(device)} ${isInactive ? 'inactive' : 'active'} ${isCountdownActive ? 'countdown-active' : ''} ${zoneClass}`}
                    title={`${UI_LABELS.DEVICE_TOOLTIP_PREFIX} ${deviceName} (${device.deviceId}) - ${formatTimeAgo(device.lastSeen)}`}
                    role={isHeartRate ? 'button' : undefined}
                    tabIndex={isHeartRate ? 0 : undefined}
                    onClick={isHeartRate ? () => handleAvatarClick(device) : undefined}
                    onKeyDown={isHeartRate ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault();
                        handleAvatarClick(device);
                      }
                    } : undefined}
                    aria-label={isHeartRate ? `Reassign ${deviceName}` : undefined}
                  >
                    {isCountdownActive && (
                      <div className="device-timeout-bar" aria-label="Removal countdown" role="presentation">
                        <div
                          className="device-timeout-fill"
                          style={{ width: `${Math.max(0, Math.min(100, countdownWidth))}%` }}
                        />
                      </div>
                    )}
                    <div
                      className={`card-avatar ${zoneClass}`}
                    >
                      {isHeartRate ? (
                        <img
                          src={DaylightMediaPath(`/static/img/users/${profileId}`)}
                          alt={`${deviceName} profile`}
                          className="user-profile-img"
                          onError={(e) => {
                            if (e.currentTarget.dataset.fallback) {
                              e.currentTarget.style.display = 'none';
                              return;
                            }
                            e.currentTarget.dataset.fallback = '1';
                            e.currentTarget.src = DaylightMediaPath('/static/img/users/user');
                          }}
                        />
                      ) : (
                        <img
                          src={DaylightMediaPath(`/static/img/equipment/${profileId}.png`)}
                          alt={`${deviceName} profile`}
                          onError={(e) => {
                            if (e.target.dataset.fallback) {
                              e.target.style.display = 'none';
                              return;
                            }
                            e.target.dataset.fallback = '1';
                            e.target.src = DaylightMediaPath('/static/img/equipment/equipment');
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
                        <span className="device-value">{deviceValue}</span>
                        <span className="device-unit">{getDeviceUnit(device)}</span>
                      </div>
                    </div>
                    {isHeartRate && shouldShowProgressBar && (
                      <div className="zone-progress-bar" aria-label="Zone progress" role="presentation">
                        <div
                          className="zone-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, Math.round((normalizedProgress ?? 0) * 100)))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
              });
            })()}
          </FlipMove>
        ) : (
          <div className="nav-empty">
            <div className="empty-icon">{UI_LABELS.EMPTY_DEVICES_ICON}</div>
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
                aria-label={connected ? UI_LABELS.CONNECTED_STATUS : UI_LABELS.DISCONNECTED_STATUS}
                title={connected ? UI_LABELS.CONNECTED_STATUS : UI_LABELS.DISCONNECTED_STATUS}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: connected ? '#51cf66' : '#ff6b6b',
                  boxShadow: `0 0 6px ${connected ? '#51cf66' : '#ff6b6b'}, 0 0 12px ${connected ? '#51cf66aa' : '#ff6b6baa'}`
                }}
              />
              <span>{connected ? UI_LABELS.CONNECTED_STATUS : UI_LABELS.DISCONNECTED_STATUS}</span>
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
                {UI_LABELS.RECONNECT_BUTTON}
              </button>
            )}
          </div>
        )}
        </div>
      </div>
    </>
  );
};

export default FitnessUsersList;
