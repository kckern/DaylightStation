/**
 * The Shakespeare guard, and the idempotence contract.
 *
 * The single most dangerous thing this migration could do is match the English
 * word "coin". Half of the 6,215 data files containing that string are
 * children's literature quizzes. These tests assert prose survives byte-for-byte.
 */
import { describe, it, expect } from 'vitest';
import { migrateText, ALLOWED_ROOTS } from './rings-migration.mjs';

describe('key shapes are rewritten', () => {
  it('rewrites the flat per-participant series key', () => {
    const { text } = migrateText("    kckern:coins: '[[0,9],1,2]'\n");
    expect(text).toBe("    kckern:rings: '[[0,9],1,2]'\n");
  });

  it('rewrites the global series key without losing its namespace', () => {
    expect(migrateText('    global:coins: \'[1]\'\n').text).toBe('    global:rings: \'[1]\'\n');
  });

  it('rewrites a bare key, with or without an inline value', () => {
    expect(migrateText('      coins: 280\n').text).toBe('      coins: 280\n'.replace('coins', 'rings'));
    expect(migrateText('  coins:\n').text).toBe('  rings:\n');
  });

  it('rewrites the camelCase total in YAML and JSON alike', () => {
    expect(migrateText('  totalCoins: 280\n').text).toBe('  totalRings: 280\n');
    expect(migrateText('"totalCoins":280').text).toBe('"totalRings":280');
  });

  it('rewrites the v2 namespaced cumulative metric', () => {
    expect(migrateText('user:user_4:coins_total').text).toBe('user:user_4:rings_total');
  });

  it('rewrites JSON key forms', () => {
    expect(migrateText('{"kckern:coins":"[1]"}').text).toBe('{"kckern:rings":"[1]"}');
    expect(migrateText('{"coins": 4}').text).toBe('{"rings": 4}');
  });
});

describe('THE SHAKESPEARE GUARD — prose is never touched', () => {
  // Verbatim-shaped lines from data/content/_staging/school/shakespeare-tales.
  const prose = [
    'Bassanio needs money, so Antonio agrees to a risky bond for three thousand ducats.',
    'She hid the coin in her sleeve and said nothing.',
    'Which casket holds the coins?',
    'He paid three coins for the ring.',
    '- text: "The merchant lost his coins at sea."',
    'answer: coins',
    'A coin-purse, a coinage, a coincidence.',
  ].join('\n');

  it('leaves every prose line byte-identical', () => {
    const { text, changed } = migrateText(prose);
    expect(changed).toBe(false);
    expect(text).toBe(prose);
  });

  it('does not touch the word even when a quiz answer IS "coins"', () => {
    // `answer: coins` is a VALUE, not a key — the bare-key rule anchors on the
    // colon following the word, so this must survive.
    expect(migrateText('answer: coins\n').text).toBe('answer: coins\n');
  });

  it('does not mangle "coincidence"', () => {
    expect(migrateText('It was a coincidence.').text).toBe('It was a coincidence.');
  });
});

describe('idempotence', () => {
  it('a second pass changes nothing', () => {
    const once = migrateText("    user_4:coins: '[1]'\n  totalCoins: 5\n");
    expect(once.changed).toBe(true);
    const twice = migrateText(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });
});

describe('scope guard', () => {
  it('whitelists only the fitness log roots', () => {
    expect(ALLOWED_ROOTS).toContain('data/household/fitness/log');
    expect(ALLOWED_ROOTS.some((r) => r.includes('content'))).toBe(false);
    expect(ALLOWED_ROOTS.some((r) => r.includes('school'))).toBe(false);
  });
});

describe('the ring award interval', () => {
  it('renames treasureBox.coinTimeUnitMs', () => {
    expect(migrateText('  coinTimeUnitMs: 60000\n').text).toBe('  ringTimeUnitMs: 60000\n');
    expect(migrateText('"coinTimeUnitMs":5000').text).toBe('"ringTimeUnitMs":5000');
  });

  it('still leaves prose alone with the new rule in place', () => {
    const prose = 'She paid three coins for the ring, coincidentally.';
    expect(migrateText(prose).changed).toBe(false);
  });
});
