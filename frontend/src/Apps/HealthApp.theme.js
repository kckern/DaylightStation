import { createTheme } from '@mantine/core';

/**
 * Mantine theme override for HealthApp's dark dashboard aesthetic.
 * Tokens used by the cards and chrome via `var(--mantine-color-*)`.
 */
export const healthTheme = createTheme({
  primaryColor: 'blue',
  colors: {
    background: ['#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419','#0f1419'],
    surface:    ['#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229','#1c2229'],
    surfaceAlt: ['#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12','#0a0e12'],
    border:     ['#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743','#2d3743'],
    textHigh:   ['#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3','#e8eef3'],
    textMid:    ['#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8'],
    textLow:    ['#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785','#6b7785'],
  },
});

export default healthTheme;
