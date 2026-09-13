import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { addressingPolicyFor } from './addressingPolicy.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), 'utf8');

describe('the addressing policy a host hands a board game', () => {
  it('carries the three facts the ladder is resolved from', () => {
    expect(addressingPolicyFor({ config: { ladder: {} }, learnerId: 'someone', completedGames: 3 }))
      .toEqual({ config: { ladder: {} }, learnerId: 'someone', completedGames: 3 });
  });

  it('answers a full shape for a player with no standing, rather than a hole', () => {
    // A guest, or nobody picked yet. The games read this as the bottom of the
    // ladder, which is a true answer; `undefined` would be read as "no policy"
    // and drop through to a game's built-in default instead.
    expect(addressingPolicyFor()).toEqual({ config: null, learnerId: null, completedGames: 0 });
  });

  it('refuses a non-integer day count rather than passing it on', () => {
    expect(addressingPolicyFor({ completedGames: undefined }).completedGames).toBe(0);
    expect(addressingPolicyFor({ completedGames: 2.5 }).completedGames).toBe(0);
  });
});

/**
 * BOTH HOSTS, OR IT IS NOT A POLICY.
 *
 * This is a source check rather than a render, and deliberately: the bug it
 * guards was a host that never passed the prop at all, which no test of the
 * games themselves can see — they all default it to null and carry on. A child
 * reading staff cards at the piano met chord symbols on the office screen for
 * exactly as long as that went unnoticed.
 */
describe('every host that mounts a board game hands one down', () => {
  const HOSTS = [
    ['the piano kiosk', '../../PianoKiosk/modes/Games/Games.jsx'],
    ['the office screen', '../../PianoVisualizer.jsx'],
  ];

  it.each(HOSTS)('%s passes addressingPolicy, built by the shared builder', (_label, path) => {
    const source = read(path);
    expect(source).toMatch(/addressingPolicy=\{/);
    expect(source).toContain('addressingPolicyFor');
  });
});
