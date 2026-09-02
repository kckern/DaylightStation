// frontend/src/modules/Media/theme/mediaTheme.js
// The Media App's Mantine theme — re-parented (Phase 6 of the DS migration)
// onto the shared design-system base pack (../../../lib/theme/createAppTheme.js
// + ../../../lib/theme/packs.mjs `media` entry). The old app's hand-rolled
// CSS-variable palette (Plex-style amber on near-black) maps onto Mantine's
// `dark` ramp so every Mantine component — INCLUDING portaled surfaces
// (Popover, Modal, Drawer, Menu, Notifications) — picks up the palette with
// no `.media-app` scoping. That is the structural fix for the historical
// unstyled-portal bug.
//
// Composition: `MEDIA_PACK.colors` carries Media's own neutrals so the DS
// contract's semantic roles (background/surface/surfaceAlt/border/textHigh/
// textMid/textLow — what --ds-* and any future DS-aware component would
// read) resolve to amber-on-near-black instead of the base contract's
// blue-gray defaults. `MEDIA_PACK.themeExtras` then layers Media's own,
// already-tuned Mantine-native theme on top (full amber/dark ramps, Inter,
// breakpoints, component defaultProps, state colors) as a top-level, NOT
// deep-merged, override (see createAppTheme.js) — so Media's own component
// defaults are the sole authority, never a silent blend with the base
// contract's generic Button/Modal/Drawer defaults.
//
// Ramp decision (documented here, used everywhere):
//   dark[7] = #101113  → body / canvas background (Mantine uses dark.7 as body)
//   dark[6] = #17181b  → panels, inputs, default Paper
//   dark[5] = #1c1d20  → cards, elevated surfaces
//   dark[4] = #24252a  → hover states, default borders
//   dark[3] = #2d2e33  → active/pressed
//   dark[2..0]         → dimmed → full foreground text
import { rem } from '@mantine/core';
import { createAppTheme } from '../../../lib/theme/createAppTheme.js';
import { PACKS } from '../../../lib/theme/packs.mjs';

const AMBER = [
  '#fdf3dc', '#f9e3ae', '#f4d27e', '#efc14e', '#f2b431',
  '#e5a00d', // [5] — the brand accent, primaryShade
  '#cf9009', '#a67407', '#7d5805', '#553c03',
];

const DARK = [
  '#e9ebef', // [0] fg
  '#a9acb3', // [1] fg-2
  '#70747c', // [2] dimmed
  '#4a4d54', // [3] fg-dim / pressed
  '#24252a', // [4] hover / borders
  '#1c1d20', // [5] cards
  '#17181b', // [6] panels / inputs
  '#101113', // [7] body
  '#0b0c0e', // [8]
  '#060708', // [9]
];

const ramp = (hex) => Array(10).fill(hex);

// The DS contract's 7 semantic roles, mapped onto Media's own neutrals per
// the ramp decision above (dark[7] body, dark[5] elevated cards, dark[8] a
// recess deeper than body, dark[4] borders, dark[0..2] fg/dimmed).
const MEDIA_NEUTRALS = {
  background: DARK[7],
  surface:    DARK[5],
  surfaceAlt: DARK[8],
  border:     DARK[4],
  textHigh:   DARK[0],
  textMid:    DARK[1],
  textLow:    DARK[2],
};

// The shared `media` pack (packs.mjs), extended with Media's actual neutrals
// + its full Mantine-native theme. Exported so MediaApp.jsx can hand this
// straight to AppThemeProvider (`pack={MEDIA_PACK}`) and get byte-identical
// output to `mediaTheme` below — both are `createAppTheme(MEDIA_PACK)`.
export const MEDIA_PACK = {
  ...PACKS.media,
  colors: MEDIA_NEUTRALS,
  themeExtras: {
    primaryColor: 'amber',
    primaryShade: 5,
    colors: {
      background: ramp(MEDIA_NEUTRALS.background),
      surface:    ramp(MEDIA_NEUTRALS.surface),
      surfaceAlt: ramp(MEDIA_NEUTRALS.surfaceAlt),
      border:     ramp(MEDIA_NEUTRALS.border),
      textHigh:   ramp(MEDIA_NEUTRALS.textHigh),
      textMid:    ramp(MEDIA_NEUTRALS.textMid),
      textLow:    ramp(MEDIA_NEUTRALS.textLow),
      amber: AMBER,
      dark: DARK,
    },
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    defaultRadius: 'sm',
    breakpoints: { xs: '24em', sm: '48em', md: '62em', lg: '75em', xl: '88em' },
    headings: {
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontWeight: '600',
      sizes: {
        h1: { fontSize: rem(22), lineHeight: '1.3' },
        h2: { fontSize: rem(18), lineHeight: '1.35' },
        h3: { fontSize: rem(15), lineHeight: '1.4' },
      },
    },
    components: {
      ActionIcon: {
        // 44px default — phone-first touch target floor
        defaultProps: { variant: 'subtle', size: 'xl', color: 'gray' },
      },
      Button: {
        defaultProps: { radius: 'sm' },
      },
      Badge: {
        defaultProps: { radius: 'sm', variant: 'light' },
      },
      Slider: {
        defaultProps: { color: 'amber', size: 'sm' },
        styles: { thumb: { borderWidth: rem(2) } },
      },
      Modal: {
        styles: { content: { border: '1px solid rgba(255,255,255,0.07)' } },
      },
      Drawer: {
        styles: { content: { border: '1px solid rgba(255,255,255,0.07)' } },
      },
      Popover: {
        defaultProps: { shadow: 'md' },
        styles: { dropdown: { border: '1px solid rgba(255,255,255,0.1)' } },
      },
      Menu: {
        defaultProps: { shadow: 'md' },
      },
      Skeleton: {
        defaultProps: { animate: true },
      },
    },
    other: {
      success: '#5cbf5c',
      danger: '#e35d5d',
      info: '#4ea1d3',
      live: '#e35d5d',
    },
  },
};

export const mediaTheme = createAppTheme(MEDIA_PACK);

/** Session/device state → indicator color. The ONE source of state colors
 *  (fleet dots, mini player, fleet tab badge) so status can never lie in one
 *  place and tell the truth in another. */
export function stateColor(state, { offline = false } = {}) {
  if (offline) return 'transparent';
  switch (state) {
    case 'playing':
    case 'buffering':
      return mediaTheme.other.success;
    case 'paused':
      return AMBER[5];
    case 'stalled':
    case 'error':
      return mediaTheme.other.danger;
    default:
      return DARK[3];
  }
}

export default mediaTheme;
