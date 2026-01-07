/**
 * Layout Testing Utilities
 * Seeded PRNG, avatar generators, and anomaly detection for layout testing.
 */

/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Deterministic - same seed always produces same sequence.
 */
export function createPRNG(seed) {
  let state = seed;
  return {
    seed,
    random() {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    randomInt(min, max) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    },
    randomFloat(min, max) {
      return this.random() * (max - min) + min;
    },
    pick(arr) {
      return arr[this.randomInt(0, arr.length - 1)];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.randomInt(0, i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  };
}

/** Default chart constants (match FitnessChartApp) */
export const CHART_DEFAULTS = {
  width: 420,
  height: 390,
  margin: { top: 10, right: 90, bottom: 38, left: 4 },
  avatarRadius: 30,
  badgeRadius: 10
};

/**
 * Generate random avatar elements for testing.
 */
export function generateAvatars(prng, options = {}) {
  const {
    count = prng.randomInt(1, 6),
    width = CHART_DEFAULTS.width,
    height = CHART_DEFAULTS.height,
    margin = CHART_DEFAULTS.margin,
    xCluster = null,
    yCluster = null,
    tickCount = prng.randomInt(1, 50)
  } = options;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const avatars = [];

  for (let i = 0; i < count; i++) {
    let x, y;

    if (xCluster) {
      x = xCluster.center + prng.randomFloat(-xCluster.spread, xCluster.spread);
    } else {
      const tick = prng.randomInt(0, tickCount - 1);
      x = tickCount <= 1
        ? margin.left
        : margin.left + (tick / (tickCount - 1)) * innerWidth;
    }

    if (yCluster) {
      y = yCluster.center + prng.randomFloat(-yCluster.spread, yCluster.spread);
    } else {
      y = margin.top + prng.randomFloat(0.1, 0.9) * innerHeight;
    }

    avatars.push({
      type: 'avatar',
      id: `user-${i}`,
      x,
      y,
      name: `User ${i}`,
      color: '#4ade80',
      avatarUrl: `/img/user-${i}.png`,
      value: prng.randomInt(100, 5000)
    });
  }

  return avatars;
}

/**
 * Generate clustered avatars (common early-frame scenario).
 */
export function generateClusteredAvatars(prng, count, options = {}) {
  const { width = CHART_DEFAULTS.width, margin = CHART_DEFAULTS.margin } = options;
  const rightEdge = width - margin.right;

  return generateAvatars(prng, {
    count,
    xCluster: { center: rightEdge - 20, spread: 15 },
    yCluster: { center: 150, spread: 40 },
    tickCount: prng.randomInt(1, 6),
    ...options
  });
}

/**
 * Generate badges (dropout markers).
 */
export function generateBadges(prng, options = {}) {
  const {
    count = prng.randomInt(0, 3),
    width = CHART_DEFAULTS.width,
    height = CHART_DEFAULTS.height,
    margin = CHART_DEFAULTS.margin
  } = options;

  const innerWidth = width - margin.left - margin.right;
  const badges = [];

  for (let i = 0; i < count; i++) {
    const tick = prng.randomInt(0, 30);
    const x = margin.left + (tick / 30) * innerWidth;
    const y = margin.top + prng.randomFloat(0.2, 0.8) * (height - margin.top - margin.bottom);

    badges.push({
      type: 'badge',
      id: `badge-${i}`,
      participantId: `user-dropout-${i}`,
      x,
      y,
      tick,
      initial: String.fromCharCode(65 + i),
      name: `Dropout ${i}`
    });
  }

  return badges;
}

/**
 * Detect layout anomalies by comparing input to output.
 */
export function detectAnomalies(input, output, trace = []) {
  const anomalies = [];
  const DISPLACEMENT_THRESHOLD = 5;

  for (const outEl of output) {
    if (outEl.type !== 'avatar') continue;

    const inEl = input.find(i => i.id === outEl.id);
    if (!inEl) continue;

    const finalX = outEl.x + (outEl.offsetX || 0);
    const finalY = outEl.y + (outEl.offsetY || 0);
    const displacement = Math.hypot(finalX - inEl.x, finalY - inEl.y);

    if (displacement <= DISPLACEMENT_THRESHOLD) continue;

    const collisionTrace = trace.filter(t =>
      t.elementId === outEl.id && t.phase === 'collision_resolve'
    );

    const wasCollisionJustified = collisionTrace.some(t => t.reason);

    if (!wasCollisionJustified) {
      anomalies.push({
        type: 'unexplained_displacement',
        avatarId: outEl.id,
        inputPosition: { x: inEl.x, y: inEl.y },
        outputPosition: { x: finalX, y: finalY },
        displacement,
        trace: collisionTrace
      });
    }

    if (displacement > 100) {
      anomalies.push({
        type: 'excessive_displacement',
        avatarId: outEl.id,
        displacement,
        threshold: 100
      });
    }
  }

  // Check for out-of-bounds
  for (const outEl of output) {
    const finalX = outEl.x + (outEl.offsetX || 0);
    const finalY = outEl.y + (outEl.offsetY || 0);
    const radius = outEl.type === 'avatar' ? CHART_DEFAULTS.avatarRadius : CHART_DEFAULTS.badgeRadius;

    if (finalX - radius < 0 || finalX + radius > CHART_DEFAULTS.width ||
        finalY - radius < 0 || finalY + radius > CHART_DEFAULTS.height) {
      anomalies.push({
        type: 'out_of_bounds',
        elementId: outEl.id,
        position: { x: finalX, y: finalY },
        radius
      });
    }
  }

  return {
    hasAnomaly: anomalies.length > 0,
    anomalies
  };
}

/**
 * Generate a reproducible test scenario.
 */
export function generateScenario(seed) {
  const prng = createPRNG(seed);

  const scenario = {
    seed,
    userCount: prng.randomInt(1, 6),
    tickCount: prng.randomInt(1, 50),
    chartWidth: prng.randomInt(300, 600),
    chartHeight: prng.randomInt(250, 500),
    clustered: prng.random() < 0.3
  };

  const margin = { ...CHART_DEFAULTS.margin };

  let avatars;
  if (scenario.clustered) {
    avatars = generateClusteredAvatars(prng, scenario.userCount, {
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin,
      tickCount: scenario.tickCount
    });
  } else {
    avatars = generateAvatars(prng, {
      count: scenario.userCount,
      width: scenario.chartWidth,
      height: scenario.chartHeight,
      margin,
      tickCount: scenario.tickCount
    });
  }

  const badges = generateBadges(prng, {
    count: prng.randomInt(0, 2),
    width: scenario.chartWidth,
    height: scenario.chartHeight,
    margin
  });

  return {
    ...scenario,
    margin,
    elements: [...avatars, ...badges]
  };
}
