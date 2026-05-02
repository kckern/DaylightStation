import { describe, it } from 'node:test';
import assert from 'node:assert';
import { YamlSatelliteRegistry } from '../../../../src/1_adapters/persistence/yaml/YamlSatelliteRegistry.mjs';

function makeFakeConfigService(yaml, secrets = {}) {
  return {
    reloadHouseholdAppConfig: () => yaml,
    getSecret: (key) => secrets[key] ?? null,
  };
}

describe('YamlSatelliteRegistry', () => {
  it('returns a Satellite for a valid token', async () => {
    const cfg = makeFakeConfigService(
      {
        satellites: [{
          id: 'kitchen',
          media_player_entity: 'media_player.kitchen',
          area: 'kitchen',
          allowed_skills: ['memory'],
          default_volume: 25,
          default_media_class: 'music',
          token_ref: 'ENV:DAYLIGHT_BRAIN_TOKEN_KITCHEN',
        }],
      },
      { DAYLIGHT_BRAIN_TOKEN_KITCHEN: 'kitchentok123' },
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('kitchentok123');
    assert.strictEqual(s.id, 'kitchen');
    assert.strictEqual(s.mediaPlayerEntity, 'media_player.kitchen');
  });

  it('returns null for unknown token', async () => {
    const cfg = makeFakeConfigService({ satellites: [] });
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const s = await registry.findByToken('unknown');
    assert.strictEqual(s, null);
  });

  it('skips satellite when token secret is missing', async () => {
    const cfg = makeFakeConfigService(
      {
        satellites: [{
          id: 'kitchen',
          media_player_entity: 'media_player.kitchen',
          area: 'kitchen',
          allowed_skills: ['memory'],
          token_ref: 'ENV:MISSING_TOKEN',
        }],
      },
      {},
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: { warn: () => {}, info: () => {} } });
    await registry.load();
    const list = await registry.list();
    assert.strictEqual(list.length, 0);
  });

  it('resolves token from process.env when ENV: ref present', async () => {
    process.env.__BRAIN_TEST_ENV_TOKEN = 'envtok';
    try {
      const cfg = makeFakeConfigService(
        {
          satellites: [{
            id: 'a',
            media_player_entity: 'media_player.a',
            allowed_skills: ['memory'],
            token_ref: 'ENV:__BRAIN_TEST_ENV_TOKEN',
          }],
        },
        {}, // no secrets — env var should win
      );
      const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
      await registry.load();
      const s = await registry.findByToken('envtok');
      assert.strictEqual(s?.id, 'a');
    } finally {
      delete process.env.__BRAIN_TEST_ENV_TOKEN;
    }
  });

  it('list returns a copy (defensive)', async () => {
    const cfg = makeFakeConfigService(
      {
        satellites: [{
          id: 'a',
          media_player_entity: 'media_player.a',
          allowed_skills: ['memory'],
          token_ref: 'ENV:T',
        }],
      },
      { T: 'tok' },
    );
    const registry = new YamlSatelliteRegistry({ configService: cfg, logger: console });
    await registry.load();
    const list = await registry.list();
    list.push('garbage');
    const list2 = await registry.list();
    assert.strictEqual(list2.length, 1);
  });
});
