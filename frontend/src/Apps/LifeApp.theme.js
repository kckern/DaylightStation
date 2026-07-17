import { createTheme } from '@mantine/core';

const fill10 = (hex) => Array(10).fill(hex);

/**
 * Mantine theme for the Life app — a deliberate dark surface matching HealthApp
 * and the household kiosks. Tokens are consumed as `var(--mantine-color-*)`;
 * component defaults normalize the previously ad-hoc cards/typography.
 */
export const lifeTheme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'md',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  colors: {
    background: fill10('#0f1015'),
    surface:    fill10('#191b22'),
    surfaceAlt: fill10('#0b0c10'),
    border:     fill10('#2a2d38'),
    textHigh:   fill10('#e9ecf3'),
    textMid:    fill10('#9aa2b1'),
    textLow:    fill10('#6b7385'),
  },
  headings: {
    sizes: {
      h2: { fontSize: '1.5rem', fontWeight: '650' },   // page titles
      h4: { fontSize: '0.95rem', fontWeight: '600' },  // app brand / section
      h5: { fontSize: '0.85rem', fontWeight: '600' },  // card headings
    },
  },
  components: {
    Paper: { defaultProps: { radius: 'md', withBorder: true, p: 'md', bg: 'surface.0' } },
  },
});

export default lifeTheme;
