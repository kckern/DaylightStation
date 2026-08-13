import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  DEFAULT_URL,
  inspectDefinitionPayload,
  parseArgs,
  selectMove,
} from './piano-card-game.cli.mjs';

describe('piano-card-game readiness CLI', () => {
  it('uses the DaylightLocal game route and parses automation options', () => {
    expect(parseArgs([])).toMatchObject({
      url: DEFAULT_URL,
      user: 'guest',
      timeoutMs: 30_000,
      maxTurns: 30,
      headed: false,
      json: false,
    });
    expect(parseArgs([
      '--url', 'http://localhost:3111/piano/games/card-game',
      '--timeout', '45',
      '--max-turns', '8',
      '--headed',
      '--json',
    ])).toMatchObject({
      url: 'http://localhost:3111/piano/games/card-game',
      timeoutMs: 45_000,
      maxTurns: 8,
      headed: true,
      json: true,
    });
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown argument/);
  });

  it('certifies the authored Card Game Pokémon contract', async () => {
    const definition = YAML.parse(await readFile('shared/gaming/definitions/card-game.yml', 'utf8'));
    const result = inspectDefinitionPayload({
      game_id: 'card-game',
      definition_hash: 'fixture-hash',
      definition,
    });
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.combatants.map((entry) => entry.pokemon.name)).toEqual(expect.arrayContaining([
      'Bulbasaur', 'Charmander', 'Squirtle', 'Pidgey', 'Meowth', 'Snorlax', 'Geodude', 'Onix',
    ]));
    expect(result.combatants).toHaveLength(17);
  });

  it('fails stale Riff Raiders deployments before browser automation', () => {
    const result = inspectDefinitionPayload({
      game_id: 'card-game',
      definition_hash: 'stale',
      definition: { game_id: 'card-game', title: 'Riff Raiders' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('live title must be Card Game');
    expect(result.errors).toContain('live theme must be pokemon-stadium');
  });

  it('covers unseen piano skills before repeating the strongest move', () => {
    const moves = [
      { id: 'scale', title: 'Vine Whip', kind: 'scale', damage: 44 },
      { id: 'chord', title: 'Growl', kind: 'chord', damage: 28 },
      { id: 'arp', title: 'Growth', kind: 'arpeggio', damage: 32 },
      { id: 'rhythm', title: 'Razor Leaf', kind: 'timed-pattern', damage: 58 },
    ];
    expect(selectMove(moves, { usedKinds: new Set(['scale', 'chord']) }).title).toBe('Razor Leaf');
    expect(selectMove(moves, { usedKinds: new Set(['scale', 'chord', 'arpeggio', 'timed-pattern']) }).title).toBe('Razor Leaf');
    expect(selectMove([], { usedKinds: new Set() })).toBeNull();
  });
});
