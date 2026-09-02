import { createTheme } from '@mantine/core';
import { DS_TOKENS } from './tokens.mjs';

const ramp = (hex) => Array(10).fill(hex);

/**
 * Build a Mantine theme from the base token contract + an app pack.
 * Semantic ramps read in SCSS as var(--mantine-color-surface-0) etc.
 * Component defaults adopted from mediaTheme's touch-target discipline.
 */
export function createAppTheme(pack) {
  const colors = { ...DS_TOKENS.colors, ...(pack?.colors || {}) };
  const base = {
    primaryColor: pack?.primaryColor || 'blue',
    colors: {
      background: ramp(colors.background),
      surface:    ramp(colors.surface),
      surfaceAlt: ramp(colors.surfaceAlt),
      border:     ramp(colors.border),
      textHigh:   ramp(colors.textHigh),
      textMid:    ramp(colors.textMid),
      textLow:    ramp(colors.textLow),
    },
    other: { ...DS_TOKENS.status, accent: pack?.accent || null },
    components: {
      Button: { defaultProps: { size: 'md' } },
      ActionIcon: { defaultProps: { size: 'lg', variant: 'subtle' } },
      Modal: { defaultProps: { centered: true, radius: 'md' } },
      Drawer: { defaultProps: { radius: 'md' } },
    },
  };
  // A pack may fully own its Mantine-native theme beyond the base contract's
  // 7 semantic roles — its own component defaults, font, breakpoints, extra
  // color ramps — for art direction that predates (or exceeds) the shared
  // contract. `themeExtras` is a top-level, NOT deep-merged, override: keys
  // it sets (colors/other/components/...) fully replace the base's, so an
  // app's own component defaults are never silently blended with the base's
  // generic ones. Additive: no existing pack sets this, so every other app's
  // theme is unchanged. See modules/Media/theme/mediaTheme.js (Phase 6).
  return createTheme(pack?.themeExtras ? { ...base, ...pack.themeExtras } : base);
}

export default createAppTheme;
