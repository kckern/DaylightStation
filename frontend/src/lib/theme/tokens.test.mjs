import { describe, it, expect } from 'vitest';
import { DS_TOKENS, dsCssVars, dsRootCss } from './tokens.mjs';
import { installRootTokens } from './installRootTokens.js';
import { PACKS } from './packs.mjs';
import { createAppTheme } from './createAppTheme.js';

describe('DS token contract', () => {
  it('defines the seven semantic color roles', () => {
    for (const role of ['background','surface','surfaceAlt','border','textHigh','textMid','textLow']) {
      expect(DS_TOKENS.colors[role], role).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('defines reserved status colors and motion tokens', () => {
    for (const s of ['success','warning','danger','info','live']) {
      expect(DS_TOKENS.status[s], s).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(DS_TOKENS.motion.fast).toBe('120ms');
    expect(DS_TOKENS.motion.base).toBe('200ms');
    expect(DS_TOKENS.motion.reveal).toBe('300ms');
  });

  it('emits every token as a --ds-* CSS var', () => {
    const vars = dsCssVars();
    expect(vars['--ds-surface']).toBe(DS_TOKENS.colors.surface);
    expect(vars['--ds-danger']).toBe(DS_TOKENS.status.danger);
    expect(vars['--ds-motion-base']).toBe('200ms');
  });

  it('a surface with no pack still gets the base accent', () => {
    expect(dsCssVars()['--ds-accent']).toBe(DS_TOKENS.accent);
  });

  it('dsRootCss states the whole base contract on :root', () => {
    const css = dsRootCss();
    expect(css.startsWith(':root{')).toBe(true);
    for (const [name, value] of Object.entries(dsCssVars())) expect(css).toContain(`${name}:${value};`);
  });

  it('installRootTokens puts the contract FIRST in head, once, so app sheets can still override it', () => {
    const later = document.createElement('style');
    document.head.appendChild(later);
    installRootTokens();
    installRootTokens();
    const installed = document.querySelectorAll('#ds-root-tokens');
    expect(installed).toHaveLength(1);
    expect(document.head.firstChild).toBe(installed[0]);
    expect(installed[0].textContent).toBe(dsRootCss());
    expect(document.documentElement.getAttribute('style')).toBeNull();
    installed[0].remove(); later.remove();
  });

  it('pack color overrides flow into the CSS vars', () => {
    const vars = dsCssVars(PACKS.health);
    expect(vars['--ds-accent']).toBe(PACKS.health.accent);
  });

  it('every pack has name, character, primaryColor, accent', () => {
    for (const [key, pack] of Object.entries(PACKS)) {
      expect(pack.name, key).toBeTruthy();
      expect(pack.character.length, key).toBeGreaterThan(20);
      expect(pack.primaryColor, key).toBeTruthy();
      expect(pack.accent, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('createAppTheme builds a Mantine theme with semantic ramps', () => {
    const theme = createAppTheme(PACKS.health);
    expect(theme.primaryColor).toBe('blue');
    expect(theme.colors.surface).toHaveLength(10);
    expect(theme.other.success).toBe(DS_TOKENS.status.success);
  });
});
