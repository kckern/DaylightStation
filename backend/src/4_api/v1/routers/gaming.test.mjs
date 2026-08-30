import { describe, expect, it, vi } from 'vitest';
import { createGamingRouter } from './gaming.mjs';

async function invoke(router, method, routePath, req = {}) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route.methods[method]);
  if (!layer) throw new Error(`route missing: ${method} ${routePath}`);
  const response = { statusCode: 200, body: null, headers: {} };
  const res = { status(code) { response.statusCode = code; return this; }, json(body) { response.body = body; return this; }, set(headers) { Object.assign(response.headers, headers); return this; }, end() { return this; }, type() { return this; }, sendFile(file) { response.body = { file }; return this; } };
  await layer.route.stack[0].handle({ body: {}, params: {}, query: {}, headers: {}, ...req }, res); return response;
}

describe('gaming API router', () => {
  it('exposes canonical definition, Party Games content, session, and command seams', async () => {
    const app = {
      getDefinition: vi.fn(async () => ({ hash: 'hash', definition: { id: 'x' } })), getEnvironmentProfile: vi.fn(() => ({ defaults: {} })),
      getLaunchDescriptor: vi.fn(async () => ({ definition_id: 'x', presenter_id: 'presenter' })), listPartyGamesCatalog: vi.fn(() => [{ definition_id: 'quiz:night' }]),
      listExperienceCatalog: vi.fn(() => []),
      listContent: vi.fn(() => [{ id: 'night' }]), getContent: vi.fn(() => ({ id: 'night', rounds: [] })),
      createSession: vi.fn(async () => ({ header: { session_id: 'game:1', revision: 0 } })), resumeSession: vi.fn(async () => ({ header: { session_id: 'game:1', revision: 0 } })),
      dispatch: vi.fn(async () => ({ header: { session_id: 'game:1', revision: 1 }, state: { phase: 'board', scores: {} } })), closeSession: vi.fn(async () => ({ header: { status: 'complete' } })),
    };
    const router = createGamingRouter({ gamingApplication: app });
    expect((await invoke(router, 'get', '/definitions/:definitionId', { roles: ['gaming-host'], params: { definitionId: 'x' } })).body.hash).toBe('hash');
    expect((await invoke(router, 'get', '/launch/:definitionId', { user: { sub: 'player' }, params: { definitionId: 'x' } })).body.presenter_id).toBe('presenter');
    expect((await invoke(router, 'get', '/environments/party-games/catalog', { roles: ['gaming-host'] })).body.entries).toHaveLength(1);
    expect((await invoke(router, 'get', '/experiences/:experienceId/content', { roles: ['gaming-host'], params: { experienceId: 'jeopardy' } })).body.content).toHaveLength(1);
    expect((await invoke(router, 'post', '/sessions', { roles: ['gaming-host'], body: { definition_id: 'jeopardy:night' } })).statusCode).toBe(201);
    expect(app.createSession).toHaveBeenCalledWith(expect.not.objectContaining({ ruleset: expect.anything(), experience: expect.anything() }));
    expect((await invoke(router, 'post', '/sessions/:sessionId/commands', { roles: ['gaming-host'], params: { sessionId: 'game:1' }, body: { command_id: 'cmd:1', actor_id: 'host', expected_revision: 0, logical_time: 1, command: { type: 'jeopardy.start.round' } } })).body.header.revision).toBe(1);
    expect(app.dispatch).toHaveBeenCalledOnce();
  });

  it('keeps raw artifacts host-only and prevents participants from seating other actors', async () => {
    const app = { getDefinition: vi.fn(), getLaunchDescriptor: vi.fn(async () => ({ presenter_id: 'safe' })), createSession: vi.fn() };
    const router = createGamingRouter({ gamingApplication: app });
    const raw = await invoke(router, 'get', '/definitions/:definitionId', { user: { sub: 'player' }, params: { definitionId: 'x' } });
    const launch = await invoke(router, 'get', '/launch/:definitionId', { user: { sub: 'player' }, params: { definitionId: 'x' } });
    const spoof = await invoke(router, 'post', '/sessions', { user: { sub: 'player' }, body: { definition_id: 'x', participants: [{ id: 'player' }], seats: [{ id: 'other' }] } });
    expect(raw.statusCode).toBe(403);
    expect(launch).toMatchObject({ statusCode: 200, body: { presenter_id: 'safe' } });
    expect(spoof).toMatchObject({ statusCode: 403, body: { error: 'authorization_denied' } });
    expect(app.getDefinition).not.toHaveBeenCalled();
    expect(app.createSession).not.toHaveBeenCalled();
  });

  it('broadcasts only an authenticated refetch invalidation after commit', async () => {
    const broadcastEvent = vi.fn();
    const app = { dispatch: vi.fn(async () => ({ header: { session_id: 'game:1', revision: 1, ruleset: { id: 'secret-game' } }, state: { secret: 'not-for-broadcast' } })) };
    const router = createGamingRouter({ gamingApplication: app, broadcastEvent });
    await invoke(router, 'post', '/sessions/:sessionId/commands', { roles: ['gaming-host'], params: { sessionId: 'game:1' }, body: { command_id: 'cmd:1' } });
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session-updated', sessionId: 'game:1', revision: 1 }));
    expect(broadcastEvent.mock.calls[0][0]).not.toHaveProperty('snapshot');
  });

  it('routes diagnostic sessions through the process-memory authority and exposes host-only controls', async () => {
    const app = { resumeSession: vi.fn() };
    const gamingDiagnostics = {
      createSession: vi.fn(async () => ({ header: { session_id: 'diagnostic:one', ruleset: { id: 'dice' }, revision: 0 } })),
      resumeSession: vi.fn(async () => ({ header: { session_id: 'diagnostic:one', revision: 0 } })),
      listSessions: vi.fn(() => [{ session_id: 'diagnostic:one' }]),
      inspect: vi.fn(() => ({ diagnostic: { ephemeral: true, history: [] } })),
      advance: vi.fn(() => ({ header: { session_id: 'diagnostic:one', ruleset: { id: 'dice' }, revision: 1 }, state: { roll_count: 1 } })),
      overrideState: vi.fn(() => ({ header: { session_id: 'diagnostic:one', ruleset: { id: 'dice' }, revision: 2 }, state: { phase: 'showcase' } })),
      deleteSession: vi.fn(() => ({ deleted: true })),
    };
    const broadcastEvent = vi.fn();
    const router = createGamingRouter({ gamingApplication: app, gamingDiagnostics, broadcastEvent });
    const auth = { roles: ['gaming-host'] };

    expect((await invoke(router, 'post', '/diagnostics/sessions', { ...auth, body: { definition_id: 'dice:test' } })).statusCode).toBe(201);
    expect((await invoke(router, 'get', '/sessions/:sessionId', { ...auth, params: { sessionId: 'diagnostic:one' } })).body.header.session_id).toBe('diagnostic:one');
    expect(app.resumeSession).not.toHaveBeenCalled();
    expect((await invoke(router, 'post', '/diagnostics/sessions/:sessionId/advance', { ...auth, params: { sessionId: 'diagnostic:one' }, body: { command: { type: 'dice.roll' } } })).body.state.roll_count).toBe(1);
    expect((await invoke(router, 'patch', '/diagnostics/sessions/:sessionId/state', { ...auth, params: { sessionId: 'diagnostic:one' }, body: { patch: { phase: 'showcase' } } })).body.state.phase).toBe('showcase');
    expect((await invoke(router, 'delete', '/diagnostics/sessions/:sessionId', { ...auth, params: { sessionId: 'diagnostic:one' } })).body.deleted).toBe(true);
    expect(broadcastEvent).toHaveBeenCalledTimes(2);

    const denied = await invoke(router, 'patch', '/diagnostics/sessions/:sessionId/state', { params: { sessionId: 'diagnostic:one' }, body: { patch: {} } });
    expect(denied).toMatchObject({ statusCode: 401, body: { error: 'authentication_required' } });
  });

  it('ignores body and query identity claims and fails closed without server-established identity', async () => {
    const app = { resumeSession: vi.fn(), dispatch: vi.fn() };
    const router = createGamingRouter({ gamingApplication: app });
    const resume = await invoke(router, 'get', '/sessions/:sessionId', { params: { sessionId: 'game:1' }, query: { role: 'host', participant_id: 'host' } });
    const command = await invoke(router, 'post', '/sessions/:sessionId/commands', {
      params: { sessionId: 'game:1' },
      body: { command_id: 'cmd:1', actor_id: 'host', expected_revision: 0, logical_time: 1, viewer_role: 'host', viewer_id: 'host', command: { type: 'session.close' } },
    });
    expect(resume).toMatchObject({ statusCode: 401, body: { error: 'authentication_required' } });
    expect(command).toMatchObject({ statusCode: 401, body: { error: 'authentication_required' } });
    expect(app.resumeSession).not.toHaveBeenCalled();
    expect(app.dispatch).not.toHaveBeenCalled();
  });

  it('exposes approved art separately from image bytes', async () => {
    const app = { getDefinition: vi.fn() }; const gamingMediaService = {
      getCatalog: vi.fn(() => ({ kind: 'found', value: { schemaVersion: 1, pack: { id: 'default' }, assets: { approved: { status: 'approved' } } } })),
      getAssetImage: vi.fn(() => ({ kind: 'found', value: { resource: {}, contentHash: 'a'.repeat(64) } })),
    };
    const router = createGamingRouter({ gamingApplication: app, gamingMediaService, sendFileResource: (_req, res) => res.sendFile('/tmp/a.png') });
    const catalog = await invoke(router, 'get', '/assets/:packId', { roles: ['gaming-host'], params: { packId: 'default' } }); expect(Object.keys(catalog.body.assets)).toEqual(['approved']); expect(catalog.body.assets.approved).not.toHaveProperty('source');
    const image = await invoke(router, 'get', '/assets/:packId/:assetId/image', { roles: ['gaming-host'], params: { packId: 'default', assetId: 'approved' } }); expect(image.body.file).toBe('/tmp/a.png');
  });
});
