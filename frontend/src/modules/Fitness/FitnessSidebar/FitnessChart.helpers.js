export const MIN_VISIBLE_TICKS = 30;

export const ZONE_COLOR_MAP = {
  cool: '#4fb1ff',
  active: '#4ade80',
  warm: '#facc15',
  hot: '#fb923c',
  fire: '#f87171',
  default: '#9ca3af'
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeId = (entry) => {
  if (!entry) return null;
  return entry.name || entry.profileId || entry.hrDeviceId || null;
};

const forwardFill = (arr = []) => {
  if (!Array.isArray(arr)) return arr;
  let last = null;
  return arr.map((v) => {
    if (Number.isFinite(v)) {
      last = v;
      return v;
    }
    return last;
  });
};

const forwardBackwardFill = (arr = []) => {
  if (!Array.isArray(arr)) return arr;
  const fwd = forwardFill(arr);
  // Back-fill leading nulls with first finite value if any
  let firstFinite = fwd.find((v) => Number.isFinite(v)) ?? null;
  return fwd.map((v) => (v == null ? firstFinite : v));
};

export const buildBeatsSeries = (rosterEntry, getSeries, timebase = {}) => {
  const targetId = normalizeId(rosterEntry);
  if (!targetId || typeof getSeries !== 'function') return { beats: [], zones: [] };

  const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
  const zones = getSeries(targetId, 'zone_id', { clone: true }) || [];

  // Primary source: coins_total from TreasureBox (single source of truth)
  const coinsRaw = getSeries(targetId, 'coins_total', { clone: true }) || null;
  if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
    // Apply Math.floor for consistency with TreasureBox accumulator
    const beats = forwardBackwardFill(coinsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)));
    return { beats, zones };
  }

  // Secondary source: pre-computed heart_beats if available
  const beatsRaw = getSeries(targetId, 'heart_beats', { clone: true }) || null;
  if (Array.isArray(beatsRaw) && beatsRaw.length > 0) {
    // Apply Math.floor for consistency
    const beats = beatsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null));
    return { beats, zones };
  }

  // Last resort fallback: compute from heart_rate (deprecated - should use TreasureBox)
  // This fallback is kept for backwards compatibility but should not be primary path
  const heartRate = getSeries(targetId, 'heart_rate', { clone: true }) || [];
  if (!Array.isArray(heartRate) || heartRate.length === 0) return { beats: [], zones };

  if (process.env.NODE_ENV === 'development') {
    console.warn(`[FitnessChart] Falling back to heart_rate calculation for ${targetId} - consider using TreasureBox coins_total`);
  }
  const beats = [];
  let total = 0;
  const intervalSeconds = intervalMs / 1000;
  heartRate.forEach((hr, idx) => {
    const hrVal = toNumber(hr);
    if (hrVal != null && hrVal > 0) {
      total += (hrVal / 60) * intervalSeconds;
    }
    // Apply Math.floor for consistency with TreasureBox
    beats[idx] = Math.floor(total);
  });
  return { beats, zones };
};

export const buildSegments = (beats = [], zones = []) => {
  const segments = [];
  let current = null;
  let lastZone = null;
  let lastPoint = null;

  const pushCurrent = () => {
    if (current && current.points.length > 0) {
      segments.push(current);
    }
    current = null;
  };

  for (let i = 0; i < beats.length; i += 1) {
    const value = toNumber(beats[i]);
    if (value == null) {
      pushCurrent();
      lastPoint = null;
      continue;
    }
    const zoneRaw = zones?.[i] ?? null;
    const zone = zoneRaw || lastZone || null;
    const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default;
    // Mark segments as gaps when zone is null (user absent/inactive)
    const isGap = zone === null;
    if (!current || current.zone !== zone) {
      pushCurrent();
      current = { zone, color, isGap, points: [] };
      // Include prior point to maintain continuity across color changes
      if (lastPoint) {
        current.points.push({ ...lastPoint });
      }
    }
    lastZone = zone;
    current.points.push({ i, v: value });
    lastPoint = { i, v: value };
  }
  pushCurrent();
  return segments;
};

export const createPaths = (segments = [], options = {}) => {
  const {
    width = 600,
    height = 240,
    minVisibleTicks = MIN_VISIBLE_TICKS,
    margin = { top: 0, right: 0, bottom: 0, left: 0 },
    effectiveTicks: effectiveTicksOverride,
    yScaleBase = 1,
    minValue = 0,
    bottomFraction = 1,
    topFraction = 0
  } = options;

  const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
  const innerHeight = Math.max(1, height - (margin.top || 0) - (margin.bottom || 0));

  const mergedSegments = (() => {
    const merged = [];
    segments.forEach((seg) => {
      if (!seg || !Array.isArray(seg.points) || seg.points.length === 0) return;
      const prev = merged[merged.length - 1];
      if (prev && prev.color === seg.color) {
        prev.points.push(...seg.points);
      } else {
        merged.push({ ...seg, points: [...seg.points] });
      }
    });
    return merged;
  })();

  let maxValue = options.maxValue || 0;
  let maxIndex = 0;
  mergedSegments.forEach((seg) => {
    seg.points.forEach(({ i, v }) => {
      if (v > maxValue) maxValue = v;
      if (i > maxIndex) maxIndex = i;
    });
  });
  if (segments.length === 0) return [];
  if (!(maxValue > 0)) {
    maxValue = 1; // ensure drawable domain even when all values are zero
  }

  const effectiveTicks = Math.max(minVisibleTicks, effectiveTicksOverride || maxIndex + 1, 1);
  const scaleX = (i) => {
    if (effectiveTicks <= 1) return 0;
    const clampedIndex = Math.max(0, i);
    return Math.max(0, (margin.left || 0) + (clampedIndex / (effectiveTicks - 1)) * innerWidth);
  };
  const domainMin = Math.min(minValue, maxValue);
  const domainSpan = Math.max(1, maxValue - domainMin);
  const topFrac = Math.max(0, Math.min(1, topFraction));
  const bottomFrac = Math.max(topFrac, Math.min(1, bottomFraction));

  const scaleY = (v) => {
    const clamped = Math.max(domainMin, Math.min(maxValue, v));
    const norm = (clamped - domainMin) / domainSpan;
    let mapped = norm;
    if (yScaleBase > 1) {
      mapped = 1 - Math.log(1 + (1 - norm) * (yScaleBase - 1)) / Math.log(yScaleBase);
    }
    const frac = bottomFrac + (topFrac - bottomFrac) * mapped;
    return (margin.top || 0) + frac * innerHeight;
  };

  return mergedSegments.map((seg) => {
    const points = seg.points.length === 1 ? [...seg.points, seg.points[0]] : seg.points;
    const path = points.reduce((acc, { i, v }, idx) => {
      const x = scaleX(i).toFixed(2);
      const y = scaleY(v).toFixed(2);
      return acc + `${idx === 0 ? 'M' : 'L'}${x},${y} `;
    }, '').trim();
    // Gap segments (absent users) get reduced opacity and dashed stroke
    const isGap = Boolean(seg.isGap);
    return {
      zone: seg.zone,
      color: seg.color,
      opacity: isGap ? 0.5 : (seg.color === ZONE_COLOR_MAP.default ? 0.1 : 1),
      isGap,
      d: path
    };
  });
};
