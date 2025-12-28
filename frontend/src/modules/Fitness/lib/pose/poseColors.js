/**
 * Color schemes for skeleton rendering
 */

/**
 * Rainbow color scheme - different colors for different body parts
 */
export const RAINBOW_COLORS = {
  face: '#ff6b6b',      // coral red
  shoulder: '#ffa94d',  // orange
  torso: '#ffd43b',     // yellow
  arm: '#69db7c',       // green
  hand: '#38d9a9',      // teal
  hip: '#4dabf7',       // light blue
  leg: '#748ffc',       // indigo
  foot: '#da77f2',      // purple
};

/**
 * Solid color schemes
 */
export const SOLID_COLORS = {
  green: {
    line: '#00ff00',
    point: '#00cc00',
    text: '#ffffff',
  },
  white: {
    line: '#ffffff',
    point: '#ffffff',
    text: '#ffffff',
  },
  cyan: {
    line: '#00ffff',
    point: '#00cccc',
    text: '#ffffff',
  },
  magenta: {
    line: '#ff00ff',
    point: '#cc00cc',
    text: '#ffffff',
  },
};

/**
 * Heatmap colors based on confidence
 */
export const HEATMAP_GRADIENT = [
  { threshold: 0.0, color: '#0000ff' },  // blue (low)
  { threshold: 0.3, color: '#00ffff' },  // cyan
  { threshold: 0.5, color: '#00ff00' },  // green
  { threshold: 0.7, color: '#ffff00' },  // yellow
  { threshold: 0.9, color: '#ff0000' },  // red (high)
];

/**
 * Left/Right side colors for easy distinction
 */
export const SIDE_COLORS = {
  left: '#4dabf7',   // blue
  right: '#ffa94d',  // orange
  center: '#ffffff', // white
};

/**
 * Get color for a body part in rainbow scheme
 */
export const getRainbowColor = (bodyPart) => {
  return RAINBOW_COLORS[bodyPart] || '#ffffff';
};

/**
 * Get color based on confidence score (heatmap)
 */
export const getHeatmapColor = (confidence) => {
  for (let i = HEATMAP_GRADIENT.length - 1; i >= 0; i--) {
    if (confidence >= HEATMAP_GRADIENT[i].threshold) {
      return HEATMAP_GRADIENT[i].color;
    }
  }
  return HEATMAP_GRADIENT[0].color;
};

/**
 * Get color based on side (left/right)
 */
export const getSideColor = (isLeft, isRight) => {
  if (isLeft) return SIDE_COLORS.left;
  if (isRight) return SIDE_COLORS.right;
  return SIDE_COLORS.center;
};

/**
 * Interpolate between two colors
 */
export const interpolateColor = (color1, color2, factor) => {
  const hex = (x) => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  return `#${hex(r)}${hex(g)}${hex(b)}`;
};

/**
 * Color scheme configurations
 */
export const COLOR_SCHEMES = {
  rainbow: {
    id: 'rainbow',
    name: 'Rainbow',
    getLineColor: (bodyPart, confidence, isLeft, isRight) => getRainbowColor(bodyPart),
    getPointColor: (bodyPart, confidence, isLeft, isRight) => getRainbowColor(bodyPart),
  },
  'solid-green': {
    id: 'solid-green',
    name: 'Solid Green',
    getLineColor: () => SOLID_COLORS.green.line,
    getPointColor: () => SOLID_COLORS.green.point,
  },
  'solid-white': {
    id: 'solid-white',
    name: 'Solid White',
    getLineColor: () => SOLID_COLORS.white.line,
    getPointColor: () => SOLID_COLORS.white.point,
  },
  'solid-cyan': {
    id: 'solid-cyan',
    name: 'Solid Cyan',
    getLineColor: () => SOLID_COLORS.cyan.line,
    getPointColor: () => SOLID_COLORS.cyan.point,
  },
  heatmap: {
    id: 'heatmap',
    name: 'Heatmap',
    getLineColor: (bodyPart, confidence) => getHeatmapColor(confidence),
    getPointColor: (bodyPart, confidence) => getHeatmapColor(confidence),
  },
  sides: {
    id: 'sides',
    name: 'Left/Right',
    getLineColor: (bodyPart, confidence, isLeft, isRight) => getSideColor(isLeft, isRight),
    getPointColor: (bodyPart, confidence, isLeft, isRight) => getSideColor(isLeft, isRight),
  },
};

/**
 * Get a color scheme by ID
 */
export const getColorScheme = (schemeId) => {
  return COLOR_SCHEMES[schemeId] || COLOR_SCHEMES.rainbow;
};

/**
 * Get list of available color scheme IDs
 */
export const getAvailableSchemes = () => Object.keys(COLOR_SCHEMES);

export default {
  RAINBOW_COLORS,
  SOLID_COLORS,
  HEATMAP_GRADIENT,
  SIDE_COLORS,
  COLOR_SCHEMES,
  getRainbowColor,
  getHeatmapColor,
  getSideColor,
  getColorScheme,
  getAvailableSchemes,
};
