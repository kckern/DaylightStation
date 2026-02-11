/**
 * Fitness Receipt Theme
 * @module 1_adapters/fitness/rendering/fitnessReceiptTheme
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
  },

  leaderboard: {
    histogramHeight: 70,
    histogramBuckets: 10,
    rowHeight: 230,
  },
};

export default fitnessReceiptTheme;
