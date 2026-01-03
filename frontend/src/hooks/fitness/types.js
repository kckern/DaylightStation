/**
 * Participant Identifier
 * @typedef {string} ParticipantId
 * @description Stable participant identifier.
 * - Format: userId ("kckern", "milo")
 * - NOT a display name ("Alan", "KC Kern")
 * @example "kckern"
 */

/**
 * Timeline Series Key Format
 * @typedef {string} TimelineSeriesKey
 * @description All participant timeline series MUST use 3 segments: <scope>:<participantId>:<metric>
 * @example "user:kckern:coins_total"
 */

/**
 * Resolve the canonical userId to use as a key.
 * 
 * Strict identifier contract: all maps/sets keyed by participant identity MUST use userId.
 * 
 * @param {Object} entry
 * @param {string} [entry.id]
 * @param {string} [entry.profileId]
 * @returns {ParticipantId|null}
 */
export const resolveParticipantUserId = (entry) => {
  if (!entry) return null;
  return entry.id || entry.profileId || null;
};

/**
 * Build the list of active participant IDs for governance evaluation.
 * 
 * @param {Array<Object>} roster
 * @returns {ParticipantId[]}
 */
export const buildActiveParticipantIds = (roster = []) => {
  if (!Array.isArray(roster) || roster.length === 0) return [];
  return roster
    .filter((entry) => entry?.isActive !== false)
    .map((entry) => resolveParticipantUserId(entry))
    .filter(Boolean);
};

/**
 * Build a userZoneMap keyed by userId.
 * 
 * @param {Array<Object>} roster
 * @returns {Record<ParticipantId, ZoneId|null>}
 */
export const buildUserZoneMap = (roster = []) => {
  const map = {};
  if (!Array.isArray(roster) || roster.length === 0) return map;
  roster.forEach((entry) => {
    const userId = resolveParticipantUserId(entry);
    if (!userId) return;
    map[userId] = entry?.zoneId || null;
  });
  return map;
};

/**
 * Zone Identifier
 * @typedef {string} ZoneId
 * @description Heart rate zone ID (lowercase)
 * @example "cool", "active", "warm", "hot", "fire"
 */

/**
 * @deprecated Use user.id or entity.id directly instead of deriving IDs from names.
 * This function will be removed in a future version.
 * All users/devices/participants have explicit `id` fields that should be used.
 */
export const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

/**
 * Normalize a zone ID for lookups. Zone IDs are known, finite values like
 * 'cool', 'active', 'warm', 'hot', 'fire' from configuration.
 * This is ONLY for zone configuration matching, not for user identity.
 * 
 * @param {string} zoneId - The zone ID to normalize
 * @returns {string|null} - Normalized zone ID or null if invalid
 */
export const normalizeZoneId = (zoneId) => {
  if (!zoneId) return null;
  return String(zoneId).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
};

/**
 * Sanitize an ID for use in SVG clip-path or other HTML id attributes.
 * Only use this for DOM element IDs, not for data lookups.
 * 
 * @param {string} id - The ID to sanitize
 * @param {string} fallback - Fallback if id is empty
 * @returns {string} - Sanitized ID safe for DOM use
 */
export const sanitizeIdForDom = (id, fallback = 'element') => {
  if (!id) return fallback;
  const sanitized = String(id).replace(/[^a-zA-Z0-9-_]/g, '_');
  return sanitized || fallback;
};

export const resolveDisplayLabel = ({
  name,
  groupLabel,
  preferGroupLabel = false,
  fallback = 'Participant'
} = {}) => {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedGroup = typeof groupLabel === 'string' ? groupLabel.trim() : '';
  if (preferGroupLabel && normalizedGroup) {
    return normalizedGroup;
  }
  if (normalizedName) {
    return normalizedName;
  }
  if (normalizedGroup) {
    return normalizedGroup;
  }
  return fallback;
};

export const deepClone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
};

export const ensureSeriesCapacity = (arr, index) => {
  if (!Array.isArray(arr)) return;
  while (arr.length <= index) {
    arr.push(null);
  }
};

export const trimTrailingNulls = (series = []) => {
  let end = series.length;
  while (end > 0 && series[end - 1] == null) {
    end -= 1;
  }
  return series.slice(0, end);
};

export const serializeSeries = (series = []) => {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }
  return series
    .map((value) => {
      if (value == null) return '';
      return String(value);
    })
    .join('|');
};

export const formatSessionId = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
};

export const MIN_COOL_BASELINE = 60;
export const COOL_ZONE_PROGRESS_MARGIN = 40;

export const DEFAULT_ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: MIN_COOL_BASELINE, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'On Fire', min: 160, color: 'red' }
];

const DEFAULT_ZONE_LOOKUP = DEFAULT_ZONE_CONFIG.reduce((acc, zone) => {
  const key = String(zone.id || zone.name).toLowerCase();
  acc[key] = zone;
  return acc;
}, {});

const normalizeZoneOverrides = (overrides = {}) => {
  if (!overrides || typeof overrides !== 'object') return {};
  return Object.entries(overrides).reduce((acc, [key, value]) => {
    const normalizedKey = normalizeZoneId(key);
    const numeric = Number(value);
    if (normalizedKey && Number.isFinite(numeric)) {
      acc[normalizedKey] = numeric;
    }
    return acc;
  }, {});
};

export const buildZoneConfig = (globalZones, overrides) => {
  const source = Array.isArray(globalZones) && globalZones.length > 0
    ? globalZones
    : DEFAULT_ZONE_CONFIG;
  const normalizedOverrides = normalizeZoneOverrides(overrides);
  const normalized = source.map((zone, index) => {
    const rawId = zone?.id || zone?.name || `zone-${index}`;
    const zoneId = String(rawId).trim() || `zone-${index}`;
    const lookupId = zoneId.toLowerCase();
    const defaultZone = DEFAULT_ZONE_LOOKUP[lookupId] || DEFAULT_ZONE_CONFIG[index] || {};
    const fallbackColor = defaultZone?.color || null;
    const fallbackMin = Number.isFinite(defaultZone?.min) ? defaultZone.min : 0;
    const overrideMin = normalizedOverrides[lookupId];
    return {
      id: zoneId,
      name: zone?.name || defaultZone?.name || zoneId,
      color: zone?.color || fallbackColor,
      min: Number.isFinite(overrideMin)
        ? overrideMin
        : (Number.isFinite(zone?.min) ? zone.min : fallbackMin)
    };
  }).sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));

  if (normalized.length === 0) {
    return DEFAULT_ZONE_CONFIG.map((zone) => ({ ...zone }));
  }

  if (normalized[0]) {
    const referenceNext = normalized.find((zone, index) => index > 0 && Number.isFinite(zone?.min));
    const fallbackMin = Number.isFinite(normalized[0].min) ? normalized[0].min : MIN_COOL_BASELINE;
    const inferredMin = referenceNext && Number.isFinite(referenceNext.min)
      ? Math.max(0, referenceNext.min - COOL_ZONE_PROGRESS_MARGIN)
      : Math.max(MIN_COOL_BASELINE, fallbackMin);
    normalized[0] = { ...normalized[0], min: inferredMin };
  }

  return normalized;
};

export const ensureZoneList = (zoneConfig) => {
  if (Array.isArray(zoneConfig) && zoneConfig.length > 0) {
    return zoneConfig;
  }
  return DEFAULT_ZONE_CONFIG.map((zone) => ({ ...zone }));
};

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

export const getZoneMin = (zone, { isFirst = false } = {}) => {
  if (!zone) return null;
  const rawMin = Number(zone.min);
  if (!Number.isFinite(rawMin)) {
    return isFirst ? MIN_COOL_BASELINE : null;
  }
  return isFirst ? Math.max(MIN_COOL_BASELINE, rawMin) : rawMin;
};

export const deriveZoneProgressSnapshot = ({
  zoneConfig,
  heartRate,
  coolZoneMargin = COOL_ZONE_PROGRESS_MARGIN
} = {}) => {
  const zones = ensureZoneList(zoneConfig);
  if (!zones.length) {
    return null;
  }
  const hrValue = Number.isFinite(heartRate) ? Math.max(0, heartRate) : 0;
  const sortedZones = zones.slice().sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));
  const zoneSequence = sortedZones.map((zone, index) => {
    const rawId = zone?.id || zone?.name || `zone-${index}`;
    const zoneId = normalizeZoneId(rawId) || `zone-${index}`;
    const threshold = getZoneMin(zone, { isFirst: index === 0 });
    return {
      id: zoneId,
      name: zone?.name || zone?.id || `Zone ${index + 1}`,
      color: zone?.color || null,
      threshold: Number.isFinite(threshold) ? threshold : null,
      index
    };
  });

  let currentZoneIndex = -1;
  for (let i = 0; i < sortedZones.length; i += 1) {
    const threshold = getZoneMin(sortedZones[i], { isFirst: i === 0 }) ?? MIN_COOL_BASELINE;
    if (hrValue >= threshold) {
      currentZoneIndex = i;
    } else {
      break;
    }
  }
  if (currentZoneIndex === -1) {
    currentZoneIndex = 0;
  }

  const currentZone = sortedZones[currentZoneIndex] || null;
  const nextZone = sortedZones[currentZoneIndex + 1] || null;
  const currentZoneMeta = zoneSequence[currentZoneIndex] || null;
  const nextZoneMeta = zoneSequence[currentZoneIndex + 1] || null;
  const currentZoneId = currentZoneMeta?.id || currentZone?.id || (currentZone?.name ? normalizeZoneId(currentZone.name) : null);
  const currentZoneName = currentZone?.name || currentZoneId;
  const currentZoneColor = currentZone?.color || null;
  const currentThreshold = Number.isFinite(currentZoneMeta?.threshold)
    ? currentZoneMeta.threshold
    : (getZoneMin(currentZone, { isFirst: currentZoneIndex === 0 }) ?? MIN_COOL_BASELINE);
  const nextThreshold = Number.isFinite(nextZoneMeta?.threshold)
    ? nextZoneMeta.threshold
    : (nextZone ? getZoneMin(nextZone, { isFirst: currentZoneIndex + 1 === 0 }) : null);

  let rangeMin = null;
  let rangeMax = null;
  let progress = 0;
  let showBar = false;

  const margin = Number.isFinite(coolZoneMargin) ? Math.max(5, coolZoneMargin) : COOL_ZONE_PROGRESS_MARGIN;
  if (nextZone && Number.isFinite(nextThreshold)) {
    if (currentZoneIndex === 0) {
      rangeMax = nextThreshold;
      rangeMin = Math.max(0, nextThreshold - margin);
    } else if (Number.isFinite(currentThreshold)) {
      rangeMin = currentThreshold;
      rangeMax = nextThreshold;
    }
    if (rangeMax != null && rangeMin != null && rangeMax > rangeMin) {
      progress = clamp01((hrValue - rangeMin) / (rangeMax - rangeMin));
      showBar = true;
    } else {
      showBar = false;
      progress = 0;
    }
  } else {
    // Max zone (e.g., On Fire) or missing next threshold: no progress bar
    rangeMin = Number.isFinite(currentThreshold) ? currentThreshold : null;
    rangeMax = null;
    progress = 0;
    showBar = false;
  }

  return {
    currentHR: hrValue,
    currentZoneId: currentZoneId || null,
    currentZoneName: currentZoneName || null,
    currentZoneColor,
    nextZoneId: nextZone?.id || null,
    nextZoneName: nextZone?.name || null,
    nextZoneColor: nextZone?.color || null,
    rangeMin: Number.isFinite(rangeMin) ? rangeMin : null,
    rangeMax: Number.isFinite(rangeMax) ? rangeMax : null,
    progress,
    showBar,
    targetHeartRate: Number.isFinite(nextThreshold)
      ? nextThreshold
      : null,
    isMaxZone: !nextZone,
    zoneIndex: currentZoneIndex,
    currentZoneThreshold: Number.isFinite(currentThreshold) ? currentThreshold : null,
    nextZoneThreshold: Number.isFinite(nextThreshold) ? nextThreshold : null,
    zoneSequence
  };
};

export const calculateZoneProgressTowardsTarget = ({
  snapshot,
  targetZoneId,
  coolZoneMargin = COOL_ZONE_PROGRESS_MARGIN
} = {}) => {
  if (!snapshot) {
    return {
      progress: null,
      rangeMin: null,
      rangeMax: null,
      targetIndex: null
    };
  }

  const zoneSequence = Array.isArray(snapshot.zoneSequence)
    ? snapshot.zoneSequence
    : Array.isArray(snapshot.orderedZones)
      ? snapshot.orderedZones
      : null;
  const currentZoneIndex = Number.isFinite(snapshot.currentZoneIndex)
    ? snapshot.currentZoneIndex
    : Number.isFinite(snapshot.zoneIndex)
      ? snapshot.zoneIndex
      : null;
  if (!zoneSequence || zoneSequence.length === 0 || currentZoneIndex == null) {
    return {
      progress: Number.isFinite(snapshot.progress) ? snapshot.progress : null,
      rangeMin: snapshot.rangeMin ?? null,
      rangeMax: snapshot.rangeMax ?? null,
      targetIndex: null
    };
  }

  const normalizedTarget = targetZoneId ? normalizeZoneId(targetZoneId) : null;
  let targetIndex = null;
  if (normalizedTarget) {
    targetIndex = zoneSequence.findIndex((zone) => normalizeZoneId(zone.id) === normalizedTarget);
  }
  if (targetIndex == null || targetIndex === -1) {
    targetIndex = Math.min(currentZoneIndex + 1, zoneSequence.length - 1);
  }

  if (targetIndex <= currentZoneIndex) {
    return {
      progress: 1,
      rangeMin: snapshot.rangeMin ?? zoneSequence[targetIndex]?.threshold ?? null,
      rangeMax: snapshot.rangeMax ?? zoneSequence[targetIndex]?.threshold ?? null,
      targetIndex
    };
  }

  const margin = Number.isFinite(coolZoneMargin) ? Math.max(5, coolZoneMargin) : COOL_ZONE_PROGRESS_MARGIN;
  const hrValue = Number.isFinite(snapshot.currentHR)
    ? snapshot.currentHR
    : (Number.isFinite(snapshot.heartRate) ? snapshot.heartRate : 0);

  let rangeMin = null;
  if (currentZoneIndex <= 0) {
    const anchorZone = zoneSequence[currentZoneIndex + 1] || zoneSequence[targetIndex];
    const anchorThreshold = anchorZone?.threshold
      ?? snapshot.nextZoneThreshold
      ?? snapshot.targetHeartRate
      ?? snapshot.rangeMax
      ?? null;
    if (Number.isFinite(anchorThreshold)) {
      rangeMin = Math.max(0, anchorThreshold - margin);
    }
  } else {
    rangeMin = Number.isFinite(zoneSequence[currentZoneIndex]?.threshold)
      ? zoneSequence[currentZoneIndex].threshold
      : (Number.isFinite(snapshot.currentZoneThreshold)
        ? snapshot.currentZoneThreshold
        : snapshot.rangeMin ?? null);
  }

  if (rangeMin == null && Number.isFinite(snapshot.rangeMin)) {
    rangeMin = snapshot.rangeMin;
  }

  let rangeMax = Number.isFinite(zoneSequence[targetIndex]?.threshold)
    ? zoneSequence[targetIndex].threshold
    : (Number.isFinite(snapshot.targetHeartRate)
      ? snapshot.targetHeartRate
      : snapshot.rangeMax ?? null);

  if (rangeMax == null) {
    return {
      progress: null,
      rangeMin,
      rangeMax: null,
      targetIndex
    };
  }

  const span = rangeMax - (rangeMin ?? 0);
  if (!Number.isFinite(rangeMin) || span <= 0) {
    const progress = hrValue >= rangeMax ? 1 : 0;
    return {
      progress,
      rangeMin,
      rangeMax,
      targetIndex
    };
  }

  return {
    progress: clamp01((hrValue - rangeMin) / span),
    rangeMin,
    rangeMax,
    targetIndex
  };
};

export const resolveZoneThreshold = (zoneConfig, zoneId) => {
  if (!zoneId) return null;
  const zones = ensureZoneList(zoneConfig);
  if (!zones.length) return null;
  const normalizedId = normalizeZoneId(zoneId);
  const found = zones.find((zone) => normalizeZoneId(zone.id || zone.name) === normalizedId);
  if (!found) return null;
  const index = zones.findIndex((zone) => zone === found);
  const minValue = getZoneMin(found, { isFirst: index === 0 });
  return Number.isFinite(minValue) ? minValue : null;
};
