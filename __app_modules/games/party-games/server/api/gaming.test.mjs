import { describe, expect, it, vi } from 'vitest';
import { GamingSessionRestarts } from "../application/runtime/GamingSessionRestarts.mjs";
import { createGamingRouter as buildGamingRouter } from "./gaming.mjs";

const createGamingRouter = options => buildGamingRouter({ gamingSessionRestarts: new GamingSessionRestarts(), ...options });

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

 describe('Jeopardy restart', () => {
  it.each(['game:old','diagnostic:old'])('creates a fresh current-pack session without modifying completed source %s', async (id) => {
    const seats=[{id:'red',name:'Red',members:[]}];
    const old={header:{session_id:id,status:'complete',ruleset:{id:'jeopardy'},surface_id:'party-games',seats,participants:[],artifacts:{rules_definition:{id:'jeopardy:night'}}},state:{phase:'done',scores:{red:500}}};
    if(id.startsWith('diagnostic:')) old.diagnostic={definition_id:'jeopardy:night'};
    const fresh={header:{session_id:id.replace('old','new')},state:{phase:'round-intro',scores:{red:0},used:{},finalWagers:{}}};
    const selected={resumeSession:vi.fn(async()=>old),createSession:vi.fn(async()=>fresh)};
    const other={resumeSession:vi.fn(),createSession:vi.fn()}; const broadcastEvent=vi.fn();
    const router=createGamingRouter({gamingApplication:id.startsWith('diagnostic:')?other:selected,gamingDiagnostics:id.startsWith('diagnostic:')?selected:other,broadcastEvent});
    const response=await invoke(router,'post','/sessions/:sessionId/restart',{roles:['gaming-host'],params:{sessionId:id}});
    expect(response).toMatchObject({statusCode:201,body:fresh});
    expect(selected.createSession).toHaveBeenCalledWith({definitionId:'jeopardy:night',surfaceId:'party-games',seats,participants:[],setup:{teams:seats,seats},viewer:{role:'host',participant_id:null}});
    expect(other.createSession).not.toHaveBeenCalled(); expect(old.state.scores.red).toBe(500);
    expect(broadcastEvent).toHaveBeenCalledWith({topic:'gaming',kind:'session-restarted',sessionId:id,replacementSessionId:fresh.header.session_id});
  });
  it('denies anonymous/participant restart and other rulesets without creation or broadcasts',async()=>{
    const app={resumeSession:vi.fn(async()=>({header:{ruleset:{id:'dice'}}})),createSession:vi.fn()}; const broadcastEvent=vi.fn(); const router=createGamingRouter({gamingApplication:app,broadcastEvent});
    for(const [auth,status] of [[{},401],[{user:{sub:'child'}},403],[{roles:['gaming-host']},422]]) expect((await invoke(router,'post','/sessions/:sessionId/restart',{...auth,params:{sessionId:'game:one'}})).statusCode).toBe(status);
    expect(app.createSession).not.toHaveBeenCalled();expect(broadcastEvent).not.toHaveBeenCalled();
  });
 });
it('does not announce restart when fresh creation fails',async()=>{const broadcastEvent=vi.fn();const app={resumeSession:vi.fn(async()=>({header:{ruleset:{id:'jeopardy'},artifacts:{rules_definition:{id:'jeopardy:night'}}}})),createSession:vi.fn(async()=>{throw new Error('failed')})};const result=await invoke(createGamingRouter({gamingApplication:app,broadcastEvent}),'post','/sessions/:sessionId/restart',{roles:['gaming-host'],params:{sessionId:'game:old'}});expect(result.statusCode).toBe(500);expect(broadcastEvent).not.toHaveBeenCalled();});
it('restarts a completed real diagnostic from current content with empty gameplay state', async () => {
  const { GameRuntime, SessionActorAuthorization } = await import('../../../../../__capabilities/gaming/portable/kernel/index.mjs');
  const { jeopardyRuleModule } = await import('../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
  const { GamingDiagnosticSessions } = await import('../application/runtime/GamingDiagnosticSessions.mjs');
  let definition = {rule_module:{id:'jeopardy',version:1},experience:{id:'jeopardy',version:1},title:'Before edit',rounds:[{name:'Round',mode:'turns',categories:[{name:'Creation',clues:[{value:100,clue:'Old question',answer:'Answer'}]}]}],final:{category:'Final',clue:'Final question',answer:'Answer'}};
  const pin = vi.fn(() => { throw new Error('diagnostics must never pin artifacts'); });
  let sequence=0;
  const diagnostics = new GamingDiagnosticSessions({
    runtime:new GameRuntime({rulesets:[jeopardyRuleModule]}), authorization:new SessionActorAuthorization(),
    definitions:{getCurrent:async()=>({definition,hash:'a'.repeat(64),artifacts:{}}),pin},
    manifestStore:{get:()=>({id:'jeopardy',version:1,hash:'b'.repeat(64),setup:{kind:'teams'},surfaces:[{id:'party-games',presenter:'jeopardy'}]})},
    ids:{session:()=>`game:${++sequence}`,command:()=>`cmd:${++sequence}`,seed:()=>7},
  });
  const viewer={role:'host',participant_id:null};
  const seats=[{id:'red',name:'Red',members:[]},{id:'blue',name:'Blue',members:[]}];
  const original=await diagnostics.createSession({definitionId:'jeopardy:night',surfaceId:'party-games',seats,viewer});
  const oldId=original.header.session_id;
  diagnostics.overrideState(oldId,{scores:{red:900,blue:500},used:{'0:0:0':true},finalWagers:{red:100}},viewer);
  diagnostics.closeSession(oldId,{reason:'experience_complete'},viewer);
  const preserved=diagnostics.resumeSession(oldId,viewer);
  definition={...definition,title:'After edit'};
  const result=await invoke(createGamingRouter({gamingApplication:{},gamingDiagnostics:diagnostics}),'post','/sessions/:sessionId/restart',{roles:['gaming-host'],params:{sessionId:oldId}});
  expect(result.statusCode).toBe(201);
  expect(result.body.header.session_id).not.toBe(oldId);
  expect(result.body.header).toMatchObject({status:'active',seats,launch:{authority_mode:'ephemeral'}});
  expect(result.body.state).toMatchObject({phase:'round-intro',scores:{red:0,blue:0},used:{},finalWagers:{},set:{title:'After edit'}});
  expect(diagnostics.resumeSession(oldId,viewer)).toEqual(preserved);
  expect(pin).not.toHaveBeenCalled();
});

it('GET exposes committed replacement and restart retries return it without new creation', async () => {
  const old = { header: { session_id: 'game:old', ruleset: { id: 'jeopardy' }, artifacts: { rules_definition: { id: 'jeopardy:night' } } } };
  const fresh = { header: { session_id: 'game:new' } };
  const application = { resumeSession: vi.fn(async id => id === 'game:old' ? old : fresh), createSession: vi.fn(async () => fresh) };
  const router = createGamingRouter({ gamingApplication: application });
  const request = { roles: ['gaming-host'], params: { sessionId: 'game:old' } };
  await invoke(router, 'post', '/sessions/:sessionId/restart', request);
  expect((await invoke(router, 'get', '/sessions/:sessionId', request)).body).toEqual({ ...old, replacementSessionId: 'game:new' });
  expect((await invoke(router, 'post', '/sessions/:sessionId/restart', request)).body).toEqual(fresh);
  expect(application.createSession).toHaveBeenCalledTimes(1);
});

it('enforces readiness through the actual command route and authenticated coordinator', async () => {
  const { GameRuntime, GameSessionCoordinator, SessionActorAuthorization } = await import('../../../../../__capabilities/gaming/portable/kernel/index.mjs');
  const { MemorySessionJournal, MemorySnapshotRepository } = await import('../../../../../__capabilities/gaming/portable/testing/memoryPorts.mjs');
  const { jeopardyRuleModule } = await import('../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
  const definition = { rounds: [{ mode: 'turns', categories: [{ clues: [{ value: 100, clue: 'Question', answer: 'Answer' }] }] }] };
  let now = 1000;
  const coordinator = new GameSessionCoordinator({
    runtime: new GameRuntime({ rulesets: [jeopardyRuleModule] }), snapshots: new MemorySnapshotRepository(), journal: new MemorySessionJournal(),
    definitions: { getCurrent: async () => ({ definition, hash: 'a'.repeat(64) }), pin: async () => ({ definition, hash: 'a'.repeat(64) }), getPinned: async () => definition },
    ids: { session: () => 'game:readiness', seed: () => 1 }, clock: { now: () => new Date(now) }, authorization: new SessionActorAuthorization(),
  });
  const created = await coordinator.create({ ruleset: { id: 'jeopardy', version: 1 }, definitionId: 'ready', seats: [{ id: 'red' }], participants: [{ id: 'player' }] });
  let revision = created.header.revision; let id = 0;
  const router = createGamingRouter({ gamingApplication: coordinator });
  const request = async (command, auth = { roles: ['gaming-host'] }, actorId = 'host') => {
    const result = await invoke(router, 'post', '/sessions/:sessionId/commands', { ...auth, params: { sessionId: 'game:readiness' }, body: { command_id: `cmd:${id++}`, actor_id: actorId, expected_revision: revision, logical_time: 1000, command } });
    if (result.statusCode === 200) revision = result.body.header.revision;
    return result;
  };
  const migrated = await request({ type: 'CONFIGURE_COMPETITIVE' });
  expect(migrated).toMatchObject({ statusCode: 200, body: { header: { session_id: 'game:readiness' }, state: { scores: { red: 0 }, teamIds: ['red'] } } });
  expect(migrated.body.state.set.rounds[0].mode).toBe('hosted');
  expect(await request({ type: 'START_ROUND' })).toMatchObject({ statusCode: 422, body: { error: 'buzzers_not_ready' } });
  expect(await request({ type: 'BUZZER_SETUP', epoch: 'forged' }, { user: { sub: 'player' } })).toMatchObject({ statusCode: 403 });
  expect(await request({ type: 'BUZZER_SETUP', epoch: 'forged' }, { user: { sub: 'player' } }, 'player')).toMatchObject({ statusCode: 403 });
  await request({ type: 'BUZZER_SETUP', epoch: 'tv' });
  await request({ type: 'BUZZER_REPORT', kind: 'assign', epoch: 'tv', teamId: 'red', generation: 0, slot: 'gamepad:0:Pad' });
  expect(await request({ type: 'START_ROUND' })).toMatchObject({ statusCode: 422 });
  await request({ type: 'BUZZER_REPORT', kind: 'test', epoch: 'tv', teamId: 'red', generation: 0, slot: 'gamepad:0:Pad' });
  now = 30000; // Client still sends the old timestamp; the server clock expires the lease.
  expect(await request({ type: 'START_ROUND' })).toMatchObject({ statusCode: 422 });
  await request({ type: 'BUZZER_PRESENCE', epoch: 'tv' });
  expect(await request({ type: 'START_ROUND' })).toMatchObject({ statusCode: 200, body: { state: { phase: 'board' } } });
});
