/**
 * Timelapse Frame Theme
 * @module 1_rendering/fitness/timelapseFrameTheme
 *
 * Presentation constants for the recap time-lapse frame compositor.
 * Zone colors are NOT here — they come from the domain canonical palette
 * (2_domains/fitness/entities/Zone.mjs ZONE_COLORS) so the recap stays in
 * sync with the live/UI zone colors.
 */

export const timelapseFrameTheme = {
  colors: {
    text: '#ffffff',
    textDim: 'rgba(255,255,255,0.62)',
    coin: '#ffd24a',
    coinRim: '#c8961f',
    heart: '#ff5167',
    cardBorder: 'rgba(255,255,255,0.9)',
    bgFallback: '#0d0d0d',
  },

  // Named layout fractions of the (supersampled) frame dimensions.
  layout: {
    marginRatio: 0.022,    // of width — outer text margin in the bands
    seamRatio: 0.004,      // of width — gap between content panels
    headerHRatio: 0.085,   // of height — top band
    footerHRatio: 0.185,   // of height — bottom stat band
    titleFontRatio: 0.04,  // of height — header title font size
  },
};

export default timelapseFrameTheme;
