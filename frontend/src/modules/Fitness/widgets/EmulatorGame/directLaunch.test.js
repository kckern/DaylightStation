import { describe, it, expect } from 'vitest';
import { slugKey, parseDirectLaunch, findDirectLaunchGame } from './directLaunch.js';

const GAMES = [
  { id: 'super-mario-land', system: 'gb', title: 'Super Mario Land' },
  { id: 'super-mario-land-2', system: 'gb', title: 'Super Mario Land 2: 6 Golden Coins' },
  { id: 'pokemon-crystal', system: 'gbc', title: 'Pokémon Crystal' },
  { id: 'sonic-the-hedgehog', system: 'genesis', title: 'Sonic the Hedgehog' },
];

describe('slugKey', () => {
  it('keeps lowercase alphanumerics only, folding accents', () => {
    expect(slugKey('Super Mario-Land 2!')).toBe('supermarioland2');
    expect(slugKey('Pokémon')).toBe('pokemon');
    expect(slugKey(null)).toBe('');
  });
});

describe('parseDirectLaunch', () => {
  it('splits system and game', () => {
    expect(parseDirectLaunch('gb/SuperMarioLand')).toEqual({ system: 'gb', game: 'SuperMarioLand' });
    expect(parseDirectLaunch('gbc/Pok%C3%A9mon%20Crystal')).toEqual({ system: 'gbc', game: 'Pokémon Crystal' });
  });

  it('allows a system alone, and nothing at all', () => {
    expect(parseDirectLaunch('gb')).toEqual({ system: 'gb', game: null });
    expect(parseDirectLaunch('')).toBeNull();
    expect(parseDirectLaunch(null)).toBeNull();
  });
});

describe('findDirectLaunchGame', () => {
  it('matches by id or title, loosely', () => {
    expect(findDirectLaunchGame(GAMES, { system: 'gb', game: 'SuperMarioLand' })?.id).toBe('super-mario-land');
    expect(findDirectLaunchGame(GAMES, { system: 'gb', game: 'super-mario-land-2' })?.id).toBe('super-mario-land-2');
    expect(findDirectLaunchGame(GAMES, { system: 'GBC', game: 'PokemonCrystal' })?.id).toBe('pokemon-crystal');
  });

  it('never crosses systems or guesses a near miss', () => {
    expect(findDirectLaunchGame(GAMES, { system: 'gbc', game: 'SuperMarioLand' })).toBeNull();
    expect(findDirectLaunchGame(GAMES, { system: 'gb', game: 'SuperMario' })).toBeNull();
    expect(findDirectLaunchGame(GAMES, { system: 'gb', game: null })).toBeNull();
  });
});
