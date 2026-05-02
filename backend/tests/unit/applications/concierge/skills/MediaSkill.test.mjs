import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MediaSkill, applyNameAlias } from '../../../../../src/3_applications/concierge/skills/MediaSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeContentQuery {
  constructor({ searchResult, resolveResult }) {
    this.searchResult = searchResult;
    this.resolveResult = resolveResult;
    this.calls = [];
  }
  async search(q) { this.calls.push({ search: q }); return this.searchResult; }
  async resolve(source, id) { this.calls.push({ resolve: { source, id } }); return this.resolveResult; }
}

class FakeGateway {
  constructor() { this.calls = []; }
  async callService(d, s, data) { this.calls.push({ d, s, data }); return { ok: true }; }
}

describe('MediaSkill', () => {
  it('plays the top match', async () => {
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:42', source: 'plex', localId: '42', title: 'Workout Mix' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ id: 'plex:42', mediaUrl: '/api/v1/stream/plex/42', metadata: { type: 'audio' } }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({
      contentQuery: cq, gateway: gw, logger: silentLogger,
      config: { default_volume: 30, ds_base_url: 'http://10.0.0.5:3111' },
    });
    const tool = skill.getTools()[0];
    const result = await tool.execute({ query: 'workout playlist' }, {
      satellite: { mediaPlayerEntity: 'media_player.living_room' },
    });
    assert.strictEqual(result.ok, true);
    assert.match(result.title, /Workout Mix/);
    assert.strictEqual(gw.calls[0].d, 'media_player');
    assert.strictEqual(gw.calls[0].s, 'play_media');
    assert.strictEqual(gw.calls[0].data.entity_id, 'media_player.living_room');
    assert.match(gw.calls[0].data.media_content_id, /^http:\/\/10\.0\.0\.5:3111\/api\/v1\/stream\/plex\/42$/);
  });

  it('returns no_match when nothing found', async () => {
    const cq = new FakeContentQuery({ searchResult: { items: [], total: 0, sources: [] }, resolveResult: { items: [] } });
    const gw = new FakeGateway();
    const skill = new MediaSkill({ contentQuery: cq, gateway: gw, logger: silentLogger, config: { ds_base_url: 'http://x' } });
    const result = await skill.getTools()[0].execute({ query: 'unobtainium' }, { satellite: { mediaPlayerEntity: 'm' } });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no_match');
  });

  it('returns no_media_player when satellite has no entity', async () => {
    const cq = new FakeContentQuery({ searchResult: { items: [], total: 0, sources: [] }, resolveResult: { items: [] } });
    const gw = new FakeGateway();
    const skill = new MediaSkill({ contentQuery: cq, gateway: gw, logger: silentLogger, config: { ds_base_url: 'http://x' } });
    const result = await skill.getTools()[0].execute({ query: 'x' }, { satellite: {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no_media_player');
  });

  it('passes-through absolute mediaUrl from resolve', async () => {
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:99', source: 'plex', localId: '99', title: 'X' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ mediaUrl: 'https://cdn.example.com/track.mp3', metadata: { type: 'audio' } }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({ contentQuery: cq, gateway: gw, logger: silentLogger, config: { ds_base_url: 'http://10.0.0.5:3111' } });
    await skill.getTools()[0].execute({ query: 'x' }, { satellite: { mediaPlayerEntity: 'm' } });
    assert.strictEqual(gw.calls[0].data.media_content_id, 'https://cdn.example.com/track.mp3');
  });

  it('applies media_class prefix when query lacks one', async () => {
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:1', source: 'plex', localId: '1', title: 'T' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ mediaUrl: '/x' }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({ contentQuery: cq, gateway: gw, logger: silentLogger, config: { ds_base_url: 'http://x' } });
    await skill.getTools()[0].execute({ query: 'rain', media_class: 'ambient' }, { satellite: { mediaPlayerEntity: 'm' } });
    const searchCall = cq.calls.find((c) => c.search);
    assert.strictEqual(searchCall.search.text, 'ambient:rain');
  });
});

describe('applyNameAlias', () => {
  it('substitutes a matching whole-string key (case-insensitive)', () => {
    const result = applyNameAlias('beyonce', { 'beyonce': 'Beyoncé' });
    assert.strictEqual(result, 'Beyoncé');
  });

  it('returns input unchanged when no key matches', () => {
    const result = applyNameAlias('something else', { 'beyonce': 'Beyoncé' });
    assert.strictEqual(result, 'something else');
  });

  it('matches case-insensitively but preserves the alias VALUE casing exactly', () => {
    const aliases = { 'beyonce': 'Beyoncé' };
    assert.strictEqual(applyNameAlias('beyonce', aliases), 'Beyoncé');
    assert.strictEqual(applyNameAlias('BEYONCE', aliases), 'Beyoncé');
    assert.strictEqual(applyNameAlias('BeYoncE', aliases), 'Beyoncé');
  });

  it('matches whole strings only — partial matches do NOT substitute', () => {
    const result = applyNameAlias('beyonce concert', { 'beyonce': 'Beyoncé' });
    assert.strictEqual(result, 'beyonce concert');
  });

  it('handles trimming — surrounding whitespace still matches the key', () => {
    const result = applyNameAlias('  beyonce  ', { 'beyonce': 'Beyoncé' });
    assert.strictEqual(result, 'Beyoncé');
  });

  it('handles empty/missing aliases map gracefully', () => {
    assert.strictEqual(applyNameAlias('beyonce', {}), 'beyonce');
    assert.strictEqual(applyNameAlias('beyonce', undefined), 'beyonce');
    assert.strictEqual(applyNameAlias('beyonce', null), 'beyonce');
  });
});

describe('MediaSkill name_aliases integration', () => {
  it('applies prefix from media_class first, then name alias substitution', async () => {
    // The prefix step would yield "music:beyonce" — that won't match the
    // whole-string alias key "beyonce", so the alias does NOT fire and the
    // prefixed string passes through. This confirms ordering: prefix runs
    // first, then alias sees the (possibly prefixed) string.
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:1', source: 'plex', localId: '1', title: 'T' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ mediaUrl: '/x' }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({
      contentQuery: cq, gateway: gw, logger: silentLogger,
      config: {
        ds_base_url: 'http://x',
        name_aliases: { 'beyonce': 'Beyoncé' },
      },
    });
    await skill.getTools()[0].execute(
      { query: 'beyonce', media_class: 'music' },
      { satellite: { mediaPlayerEntity: 'm' } },
    );
    const searchCall = cq.calls.find((c) => c.search);
    // prefix applied first → "music:beyonce" → alias does not match → unchanged
    assert.strictEqual(searchCall.search.text, 'music:beyonce');
  });

  it('applies name alias when no media_class is given', async () => {
    const cq = new FakeContentQuery({
      searchResult: { items: [{ id: 'plex:1', source: 'plex', localId: '1', title: 'T' }], total: 1, sources: ['plex'] },
      resolveResult: { items: [{ mediaUrl: '/x' }], strategy: {} },
    });
    const gw = new FakeGateway();
    const skill = new MediaSkill({
      contentQuery: cq, gateway: gw, logger: silentLogger,
      config: {
        ds_base_url: 'http://x',
        name_aliases: { 'ac dc': 'AC/DC' },
      },
    });
    await skill.getTools()[0].execute(
      { query: 'ac dc' },
      { satellite: { mediaPlayerEntity: 'm' } },
    );
    const searchCall = cq.calls.find((c) => c.search);
    assert.strictEqual(searchCall.search.text, 'AC/DC');
  });
});
