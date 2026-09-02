//
// Per-app theme packs. A pack owns art direction (accent, primary, optional
// color overrides) and carries a direction statement so drift is a visible
// decision (spec: anti-slop Tier 3). The base contract owns everything else.

export const PACKS = Object.freeze({
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
  }),
  home: Object.freeze({
    name: 'home',
    character: 'Ambient household glance: camera tiles and status, minimal '
      + 'chrome, nothing demands interaction.',
    primaryColor: 'gray',
    accent: '#94a3b8',
  }),
  media: Object.freeze({
    name: 'media',
    character: 'Amber-on-near-black theater chrome (product-owned; extends '
      + 'the base further in modules/Media/theme/mediaTheme.js during Phase 6).',
    primaryColor: 'orange',
    accent: '#f0a05a',
  }),
});

export default PACKS;
