//
// Per-app theme packs. A pack owns art direction (accent, primary, optional
// color overrides) and carries a direction statement so drift is a visible
// decision (spec: anti-slop Tier 3). The base contract owns everything else.

export const PACKS = Object.freeze({
  admin: Object.freeze({
    name: 'admin',
    character: 'Compact technical workspace with blue selection and elevated, bordered editors.',
    primaryColor: 'blue',
    accent: '#4A7BF7',
    colors: Object.freeze({
      background: '#0C0E14', surface: '#12141C', surfaceAlt: '#1A1D28', border: '#2A2E3D',
      textHigh: '#E8EAF0', textMid: '#8B90A0', textLow: '#555A6E',
    }),
    status: Object.freeze({ success: '#34D399', warning: '#FBBF24', danger: '#F87171', info: '#60A5FA' }),
  }),
  health: Object.freeze({
    name: 'health',
    character: 'Quiet clinical focus: the daily log is the screen; numbers '
      + 'are tabular and calm; the single blue accent marks the budget and '
      + 'primary actions, nothing else.',
    primaryColor: 'blue',
    accent: '#4dabf7',
  }),
  life: Object.freeze({
    name: 'life',
    character: 'Reflective planning space: violet accent for commitments and '
      + 'goals; generous whitespace; reads like a journal, not a dashboard.',
    primaryColor: 'violet',
    accent: '#9775fa',
  }),
  auto: Object.freeze({
    name: 'auto',
    character: 'Garage utility: condensed, dense, glanceable numbers; one '
      + 'amber-green accent for OK states; built for a phone held in one hand.',
    primaryColor: 'teal',
    accent: '#2dd4bf',
    fontFamily: '"Roboto Condensed", system-ui, sans-serif',
  }),
  home: Object.freeze({
    name: 'home',
    character: 'Ambient household glance: camera tiles and status, minimal '
      + 'chrome, nothing demands interaction.',
    primaryColor: 'gray',
    accent: '#94a3b8',
  }),
  feed: Object.freeze({
    name: 'feed',
    defaultColorScheme: 'light',
    character: 'A quiet dark frame for reading. Article surfaces follow the reader’s chosen theme.',
    primaryColor: 'blue',
    accent: '#4dabf7',
    colors: Object.freeze({
      background: '#0f1113', surface: '#17191c', surfaceAlt: '#1e2125',
      textHigh: '#f1f3f5', textMid: '#a9b1b9', textLow: '#71787f',
    }),
  }),
  media: Object.freeze({
    name: 'media',
    character: 'Amber-on-near-black theater chrome (product-owned; extends '
      + 'the base further in __app_modules/Media/theme/mediaTheme.js during Phase 6).',
    primaryColor: 'orange',
    accent: '#e5a00d', // AMBER[5] — was #f0a05a, drifted from the palette
  }),
  school: Object.freeze({
    name: 'school',
    character: 'A child\'s study desk on a kiosk: big centred type, one calm '
      + 'green accent for progress and primary actions, no chrome to hunt through.',
    primaryColor: 'green',
    accent: '#51cf66',
  }),
});

export default PACKS;
