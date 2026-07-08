/**
 * Fitness Receipt Theme
 * @module 1_rendering/fitness/fitnessReceiptTheme
 *
 * Presentation constants for fitness receipt rendering.
 * Black-and-white only (thermal printer).
 */

export const fitnessReceiptTheme = {
  canvas: {
    width: 580,
  },

  layout: {
    margin: 25,
    borderWidth: 3,
    borderOffset: 10,
    sectionGap: 20,
    lineHeight: 32,
    dividerHeight: 2,
    dividerGapBefore: 10,
    dividerGapAfter: 15,
  },

  fonts: {
    family: 'Roboto Condensed',
    fontPath: 'roboto-condensed/RobotoCondensed-Regular.ttf',
    title: 'bold 48px "Roboto Condensed"',
    subtitle: '24px "Roboto Condensed"',
    sectionHeader: 'bold 32px "Roboto Condensed"',
    label: 'bold 20px "Roboto Condensed"',
    body: '20px "Roboto Condensed"',
    value: 'bold 28px "Roboto Condensed"',
    coinTotal: 'bold 64px "Roboto Condensed"',
    memo: '18px "Roboto Condensed"',
    chartHeader: 'bold 16px "Roboto Condensed"',
    chartTime: '14px "Roboto Condensed"',
    eventLabel: '14px "Roboto Condensed"',
    histLabel: '11px "Roboto Condensed"',
  },

  // Header section vertical advances. Shared by the height pre-calculation AND
  // the draw pass so the two can't desync.
  header: {
    topPad: 10,
    titleAdvance: 55,
    dateAdvance: 30,
    durationAdvance: 30,
    namesAdvance: 30,
    gap: 10,
  },

  colors: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#000000',
    gray: '#888888',
  },

  chart: {
    zoneWidths: { cool: 2, active: 6, warm: 12, hot: 18, fire: 24 },
    zoneSymbolMap: { c: 'cool', a: 'active', w: 'warm', h: 'hot', fire: 'fire' },
    headerHeight: 25,
    downsampleTarget: 300,
    columnGap: 8,
    rowHeight: 3,
    dotRadius: 1,
    dotSpacing: 6,
    timeMarginWidth: 50,
    eventSymbols: { challenge: '\u2605', media: '\u266B', voice_memo: '\uD83C\uDFA4' },
    timeLabelIntervalMinutes: 5,
  },

  treasureBox: {
    barHeight: 24,
    barMargin: 40,
    coinAdvance: 70,
  },

  leaderboard: {
    headerHeight: 40,
    histogramHeight: 70,
    histogramBuckets: 10,
    rowHeight: 230,
    // Thermal is 1-bit: zones render as scanline fill density (line every N px;
    // 0 = solid). Higher intensity -> denser fill.
    zoneDensity: { cool: 6, active: 4, warm: 3, hot: 2, fire: 0 },
    zoneLabels: { cool: 'Cool', active: 'Active', warm: 'Warm', hot: 'Hot', fire: 'Fire' },
  },
};

export default fitnessReceiptTheme;
