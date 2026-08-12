import { describe, expect, it, vi } from 'vitest';
import { createGamingRouter } from './gaming.mjs';

function invoke(router, method, routePath, req = {}) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route.methods[method]);
  if (!layer) throw new Error(`route missing: ${method} ${routePath}`);
  const response = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; },
    set(headers) { Object.assign(response.headers, headers); return this; },
    end() { return this; },
    type() { return this; },
    sendFile(file) { response.body = { file }; return this; },
  };
  layer.route.stack[0].handle({ body: {}, params: {}, query: {}, ...req }, res);
  return response;
}

describe('gaming API router', () => {
  it('exposes definition, progress, leaderboard, create, resume, and command seams', async () => {
    const service = {
      getDefinition: vi.fn(() => ({ hash: 'hash', definition: { game_id: 'scale-clash' } })),
      getProgress: vi.fn(() => ({ user_id: 'kid-1', personal_best: { score: 9000 } })),
      getActiveSession: vi.fn(() => ({ user_id: 'kid-1', active_session: { session_id: 'game_12345678' } })),
      getLeaderboard: vi.fn(() => ({ standings: [{ user_id: 'kid-1', score: 9000 }] })),
      createSession: vi.fn(() => ({ session_id: 'game_12345678', revision: 0 })),
      getSession: vi.fn(() => ({ session_id: 'game_12345678', revision: 0 })),
      applyCommand: vi.fn(() => ({ session_id: 'game_12345678', revision: 1 })),
    };
    const router = createGamingRouter({ gamingService: service });
    expect(invoke(router, 'get', '/definitions/:gameId', { params: { gameId: 'scale-clash' } }).statusCode).toBe(200);
    expect(invoke(router, 'get', '/games/:gameId/progress', {
      params: { gameId: 'card-game' }, query: { user_id: 'kid-1' },
    }).body).toMatchObject({ user_id: 'kid-1' });
    expect(invoke(router, 'get', '/games/:gameId/active-session', {
      params: { gameId: 'card-game' }, query: { user_id: 'kid-1' },
    }).body).toMatchObject({ active_session: { session_id: 'game_12345678' } });
    expect(invoke(router, 'get', '/games/:gameId/leaderboard', {
      params: { gameId: 'card-game' }, query: { user_id: 'kid-1', week: '2026-W33' },
    }).body).toMatchObject({ standings: [{ user_id: 'kid-1', score: 9000 }] });
    expect(invoke(router, 'post', '/sessions', { body: { game_id: 'scale-clash', participants: [] } }).statusCode).toBe(201);
    expect(invoke(router, 'get', '/sessions/:sessionId', { params: { sessionId: 'game_12345678' } }).statusCode).toBe(200);
    expect(invoke(router, 'put', '/sessions/:sessionId', {
      params: { sessionId: 'game_12345678' },
      body: { command: { command_id: 'command-1', session_revision: 0, type: 'choose_action', payload: {} } },
    }).statusCode).toBe(200);
    expect(service.applyCommand).toHaveBeenCalledOnce();
    expect(service.getProgress).toHaveBeenCalledWith('card-game', 'kid-1');
    expect(service.getActiveSession).toHaveBeenCalledWith('card-game', 'kid-1');
    expect(service.getLeaderboard).toHaveBeenCalledWith('card-game', 'kid-1', '2026-W33');
  });

  it('exposes only approved art and a separate image endpoint', () => {
    const service = { getDefinition: vi.fn() };
    const assetCatalog = {
      get: vi.fn(() => ({ schema_version: 1, pack: { id: 'default' }, assets: {
        'npc.farmer-bob': { status: 'approved', source: 'assets/default/farmer.png' },
        'npc.unreviewed': { status: 'candidate' },
      } })),
      getAsset: vi.fn(() => ({ file: '/tmp/farmer.png', source_sha256: 'a'.repeat(64) })),
    };
    const router = createGamingRouter({ gamingService: service, assetCatalog });
    const catalog = invoke(router, 'get', '/assets/:packId', { params: { packId: 'default' } });
    expect(catalog.body.assets).toEqual({
      'npc.farmer-bob': expect.objectContaining({ image_url: '/api/v1/gaming/assets/default/npc.farmer-bob/image' }),
    });
    expect(catalog.body.assets['npc.farmer-bob']).not.toHaveProperty('source');
    const image = invoke(router, 'get', '/assets/:packId/:assetId/image', { params: { packId: 'default', assetId: 'npc.farmer-bob' } });
    expect(image.body).toEqual({ file: '/tmp/farmer.png' });
    expect(image.headers).toMatchObject({ ETag: `"${'a'.repeat(64)}"`, 'Cache-Control': 'private, max-age=31536000, immutable' });
    expect(invoke(router, 'get', '/assets/:packId/:assetId/image', {
      params: { packId: 'default', assetId: 'npc.farmer-bob' }, headers: { 'if-none-match': `"${'a'.repeat(64)}"` },
    }).statusCode).toBe(304);
  });
});
