//
// The design-system token contract. The ONLY place base colors, status
// colors, motion durations, and breakpoints are defined as raw values.
// Everything else consumes them via Mantine theme vars or --ds-* CSS vars.
// Values adopted from HealthApp.theme.js / LifeApp.theme.js (identical ramps).

export const DS_TOKENS = Object.freeze({
  colors: Object.freeze({
    background: '#0f1419',
    surface:    '#1c2229',
    surfaceAlt: '#0a0e12',
    border:     '#2d3743',
    textHigh:   '#e8eef3',
    textMid:    '#94a3b8',
    textLow:    '#6b7785',
  }),
  status: Object.freeze({
    success: '#3fb950',
    warning: '#d29922',
    danger:  '#f85149',
    info:    '#58a6ff',
    live:    '#ff6b6b',
  }),
  // Placeholder block and its travelling highlight (Skeleton). Translucent white,
  // so the block reads on any of the app's dark panels.
  skeleton: Object.freeze({
    base:  'rgb(255 255 255 / 6%)',
    sheen: 'rgb(255 255 255 / 13%)',
  }),
  spacing: Object.freeze({ sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem', xxl: '1.5rem' }),
  type: Object.freeze({ caption: '0.7rem', label: '0.8125rem', detail: '0.85rem', heading: '1rem' }),
  controls: Object.freeze({
    'control-compact-height': '36px',
    'control-touch-target': '44px',
    'control-compact-radius': '9px',
    'focus-width': '3px',
  }),
  motion: Object.freeze({
    fast:   '120ms',
    base:   '200ms',
    reveal: '300ms',
    sweep:  '1600ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  // The accent a surface gets when no pack names one (kiosk screens, auth,
  // anything outside an AppThemeProvider). Packs override it.
  accent: '#4a7bf7',
  // Regenerate the Sass projection with node frontend/scripts/generate-browser-breakpoints.mjs.
  breakpoints: Object.freeze({ md: 768, lg: 1200 }),
});

/**
 * Emit the token set as --ds-* CSS custom properties, with pack overrides
 * applied. This is how non-Mantine SCSS consumes the same contract.
 * @param {Object} [pack] - a PACKS entry (may override colors, adds accent)
 * @returns {Object} style object of CSS custom properties
 */
export function dsCssVars(pack = null) {
  const colors = { ...DS_TOKENS.colors, ...(pack?.colors || {}) };
  const vars = {};
  for (const [role, hex] of Object.entries(colors)) {
    vars[`--ds-${role.replace(/([A-Z])/g, '-$1').toLowerCase()}`] = hex;
  }
  for (const [name, hex] of Object.entries({ ...DS_TOKENS.status, ...pack?.status })) {
    vars[`--ds-${name}`] = hex;
  }
  for (const [name, value] of Object.entries(DS_TOKENS.spacing)) vars[`--ds-space-${name}`] = value;
  for (const [name, value] of Object.entries(DS_TOKENS.type)) vars[`--ds-type-${name}`] = value;
  for (const [name, value] of Object.entries(DS_TOKENS.controls)) {
    vars[`--ds-${name}`] = value;
  }
  vars['--ds-motion-fast'] = DS_TOKENS.motion.fast;
  vars['--ds-motion-base'] = DS_TOKENS.motion.base;
  vars['--ds-motion-reveal'] = DS_TOKENS.motion.reveal;
  vars['--ds-motion-sweep'] = DS_TOKENS.motion.sweep;
  vars['--ds-motion-easing'] = DS_TOKENS.motion.easing;
  vars['--ds-skeleton-base'] = DS_TOKENS.skeleton.base;
  vars['--ds-skeleton-sheen'] = DS_TOKENS.skeleton.sheen;
  vars['--ds-accent'] = pack?.accent || DS_TOKENS.accent;
  if (pack?.fontFamily) vars['--ds-font-family'] = pack.fontFamily;
  if (pack?.fontFamilyMonospace) vars['--ds-font-family-monospace'] = pack.fontFamilyMonospace;
  return vars;
}

/**
 * The base contract as one `:root { … }` rule — what every page gets before
 * any app loads, so a component outside an AppThemeProvider (a kiosk screen,
 * the login form) still reads real values. A provider's `.ds-root` restates
 * them with its pack applied, and wins by nesting.
 * @returns {string}
 */
export function dsRootCss() {
  const body = Object.entries(dsCssVars()).map(([name, value]) => `${name}:${value};`).join('');
  return `:root{${body}}`;
}

export default DS_TOKENS;
