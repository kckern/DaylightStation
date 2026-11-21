/**
 * The intro scene must paint BELOW the loading/recovery layer: a broken or slow
 * stream never sits behind the scene with its recovery UI hidden. jsdom does
 * not apply SCSS, so this reads the stylesheet's own layer order.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Player.scss'), 'utf8');

function ruleBody(selector) {
  const at = scss.indexOf(`${selector} {`) >= 0 ? scss.indexOf(`${selector} {`) : scss.indexOf(`${selector}{`);
  expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return scss.slice(at, scss.indexOf('}', at));
}

function zIndex(selector) {
  const m = ruleBody(selector).match(/z-index:\s*var\(--[\w-]+,\s*(\d+)\)/);
  expect(m, `${selector} z-index`).not.toBeNull();
  return Number(m[1]);
}

describe('Player.scss — intro layer', () => {
  it('stacks the intro layer below the loading overlay', () => {
    expect(zIndex('.player-intro-layer')).toBeLessThan(zIndex('.loading-overlay'));
  });

  it('fills the player and never takes input', () => {
    const body = ruleBody('.player-intro-layer');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });
});
