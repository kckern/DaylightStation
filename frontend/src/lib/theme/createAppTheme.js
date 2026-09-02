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
  return createTheme({
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
  });
}

export default createAppTheme;
