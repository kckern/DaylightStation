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
  motion: Object.freeze({
    fast:   '120ms',
    base:   '200ms',
    reveal: '300ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  // Mirrors frontend/src/styles/_breakpoints.scss — change both together.
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
  for (const [name, hex] of Object.entries(DS_TOKENS.status)) {
    vars[`--ds-${name}`] = hex;
  }
  vars['--ds-motion-fast'] = DS_TOKENS.motion.fast;
  vars['--ds-motion-base'] = DS_TOKENS.motion.base;
  vars['--ds-motion-reveal'] = DS_TOKENS.motion.reveal;
  vars['--ds-motion-easing'] = DS_TOKENS.motion.easing;
  if (pack?.accent) vars['--ds-accent'] = pack.accent;
  return vars;
}

export default DS_TOKENS;
