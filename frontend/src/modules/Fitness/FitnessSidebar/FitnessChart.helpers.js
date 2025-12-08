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

export const buildBeatsSeries = (rosterEntry, getSeries, timebase = {}) => {
  const targetId = normalizeId(rosterEntry);
  if (!targetId || typeof getSeries !== 'function') return { beats: [], zones: [] };

  const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
  const beatsRaw = getSeries(targetId, 'heart_beats', { clone: true }) || null;
  const zones = getSeries(targetId, 'zone_id', { clone: true }) || [];

  if (Array.isArray(beatsRaw) && beatsRaw.length > 0) {
    const beats = beatsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? v : null));
    return { beats, zones };
  }

  const heartRate = getSeries(targetId, 'heart_rate', { clone: true }) || [];
  if (!Array.isArray(heartRate) || heartRate.length === 0) return { beats: [], zones };

  const beats = [];
  let total = 0;
  const intervalSeconds = intervalMs / 1000;
  heartRate.forEach((hr, idx) => {
    const hrVal = toNumber(hr);
    if (hrVal != null && hrVal > 0) {
      total += (hrVal / 60) * intervalSeconds;
    }
    beats[idx] = total;
  });
  return { beats, zones };
};

export const buildSegments = (beats = [], zones = []) => {
  const segments = [];
  let current = null;

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
      continue;
    }
    const zone = zones?.[i] || null;
    const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default;
    if (!current || current.zone !== zone) {
      pushCurrent();
      current = { zone, color, points: [] };
    }
    current.points.push({ i, v: value });
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
    effectiveTicks: effectiveTicksOverride
  } = options;

  const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
  const innerHeight = Math.max(1, height - (margin.top || 0) - (margin.bottom || 0));

  let maxValue = options.maxValue || 0;
  let maxIndex = 0;
  segments.forEach((seg) => {
    seg.points.forEach(({ i, v }) => {
      if (v > maxValue) maxValue = v;
      if (i > maxIndex) maxIndex = i;
    });
  });
  if (!(maxValue > 0) || segments.length === 0) return [];

  const effectiveTicks = Math.max(minVisibleTicks, effectiveTicksOverride || maxIndex + 1, 1);
  const scaleX = (i) => {
    if (effectiveTicks <= 1) return 0;
    return (margin.left || 0) + (i / (effectiveTicks - 1)) * innerWidth;
  };
  const scaleY = (v) => (margin.top || 0) + innerHeight - (v / maxValue) * innerHeight;

  return segments.map((seg) => {
    const points = seg.points.length === 1 ? [...seg.points, seg.points[0]] : seg.points;
    const path = points.reduce((acc, { i, v }, idx) => {
      const x = scaleX(i).toFixed(2);
      const y = scaleY(v).toFixed(2);
      return acc + `${idx === 0 ? 'M' : 'L'}${x},${y} `;
    }, '').trim();
    return {
      zone: seg.zone,
      color: seg.color,
      d: path
    };
  });
};
