/**
 * Gratitude Card Theme
 * @module 1_rendering/gratitude/gratitudeCardTheme
 *
 * Presentation factors for gratitude card rendering.
 * Contains all sizes, fonts, colors, and layout constants.
 */

export const gratitudeCardTheme = {
  // Canvas dimensions
  canvas: {
    width: 580,
    height: 600,
  },

  // Layout
  layout: {
    margin: 25,
    borderWidth: 3,
    borderOffset: 10,
    lineHeight: 42,
    headerYOffset: 5,
    headerHeight: 85,
    timestampHeight: 35,
    dividerHeight: 2,
    sectionGap: 15,
    sectionHeaderHeight: 65,
    sectionTitlePadding: 10,
    dividerGapBefore: 10,
    dividerGapAfter: 20,
    bulletIndent: 15,
  },

  // Fonts
  fonts: {
    family: 'Roboto Condensed',
    fontPath: 'roboto-condensed/RobotoCondensed-Regular.ttf',
    header: 'bold 72px "Roboto Condensed"',
    timestamp: '24px "Roboto Condensed"',
    sectionHeader: 'bold 48px "Roboto Condensed"',
    item: '36px "Roboto Condensed"',
    attribution: '24px "Roboto Condensed"',
  },

  // Colors
  colors: {
    background: '#FFFFFF',
    text: '#000000',
    border: '#000000',
  },

  // Selection settings
  selection: {
    gratitudeCount: 2,
    hopesCount: 2,
  },
};

export default gratitudeCardTheme;
