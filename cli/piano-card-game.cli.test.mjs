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
      maxTurns: 12,
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

  it('certifies the authored Scale Stadium Pokémon contract', async () => {
    const definition = YAML.parse(await readFile('shared/gaming/definitions/card-game.yml', 'utf8'));
    const result = inspectDefinitionPayload({
      game_id: 'card-game',
      definition_hash: 'fixture-hash',
      definition,
    });
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.combatants.map((entry) => entry.pokemon.name)).toEqual(['Pikachu', 'Squirtle']);
  });

  it('fails stale Riff Raiders deployments before browser automation', () => {
    const result = inspectDefinitionPayload({
      game_id: 'card-game',
      definition_hash: 'stale',
      definition: { game_id: 'card-game', title: 'Riff Raiders' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('live title must be Scale Stadium');
    expect(result.errors).toContain('live theme must be pokemon-tcg');
  });

  it('chooses piano moves with damage, weakness, and announced intent in mind', () => {
    const cards = [
      { id: 'charge', title: 'Charge', type: 'focus', cost: 1, effect: 5, moveType: 'electric' },
      { id: 'spark', title: 'Spark', type: 'attack', cost: 2, effect: 10, moveType: 'electric' },
      { id: 'tail', title: 'Iron Tail', type: 'attack', cost: 3, effect: 17, moveType: 'steel' },
      { id: 'screen', title: 'Light Screen', type: 'guard', cost: 2, effect: 12, moveType: 'psychic' },
    ];
    expect(selectMove(cards, { energy: 3, intentKind: 'attack' }).title).toBe('Charge');
    expect(selectMove(cards.filter((card) => card.type !== 'focus'), { energy: 2, intentKind: 'attack' }).title).toBe('Spark');
    expect(selectMove(cards.filter((card) => card.type === 'guard'), { energy: 2, intentKind: 'attack' }).title).toBe('Light Screen');
    expect(selectMove(cards.filter((card) => card.type === 'guard'), { energy: 2, intentKind: 'defend' })).toBeNull();
  });
});
