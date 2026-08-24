import { describe, expect, it, vi } from 'vitest';
import { GamingApplication } from './GamingApplication.mjs';

const mounted = {
  definition: {
    rule_module: { id: 'rules', version: 3 },
    experience: { id: 'experience', version: 2 },
  },
  hash: 'a'.repeat(64),
  artifacts: {},
};
const manifest = {
  id: 'experience', version: 2, native_surface_id: 'native-surface', hash: 'b'.repeat(64),
  presenters: { primary: 'primary-presenter' }, theme: { id: 'mounted-theme' },
};

function fixture({ resumedState = {}, manifestOverride = {}, groupPlayCatalog = null } = {}) {
  const coordinator = {
    create: vi.fn(async (request) => ({ header: { session_id: 'session:1', ruleset: request.ruleset }, definition: {} })),
    resume: vi.fn(async () => ({ state: resumedState })),
    dispatch: vi.fn(), close: vi.fn(),
  };
  const definitions = { getCurrent: vi.fn(async () => structuredClone(mounted)) };
  const resolvedManifest = { ...manifest, ...manifestOverride };
  const manifestStore = { get: vi.fn((id, version) => id === resolvedManifest.id && version === resolvedManifest.version ? resolvedManifest : null), list: () => [resolvedManifest] };
  const drawingCheckpoints = { get: vi.fn(async () => ({ strokes: [] })), put: vi.fn(async (_id, value) => value), delete: vi.fn(async () => true) };
  return { application: new GamingApplication({ coordinator, definitions, manifestStore, drawingCheckpoints, groupPlayCatalog }), coordinator, drawingCheckpoints };
}

describe('GamingApplication mounted launch authority', () => {
  it('returns a safe launch descriptor without authored rules or content', async () => {
    const { application } = fixture();
    await expect(application.getLaunchDescriptor('definition:one')).resolves.toEqual({
      definition_id: 'definition:one', definition_hash: mounted.hash,
      ruleset: { id: 'rules', version: 3 },
      experience: { id: 'experience', version: 2, native_surface_id: 'native-surface' },
      presenter_id: 'primary-presenter', theme: { id: 'mounted-theme' }, input_profile: null, renderer_embeddings: [],
    });
  });

  it('derives ruleset and experience from mounted artifacts instead of request claims', async () => {
    const { application, coordinator } = fixture();
    await application.createSession({
      definitionId: 'definition:one', ruleset: { id: 'spoofed', version: 99 },
      experience: { id: 'spoofed', version: 99, native_surface_id: 'spoofed' }, participants: [],
    });
    expect(coordinator.create).toHaveBeenCalledWith(expect.objectContaining({
      ruleset: { id: 'rules', version: 3 },
      experience: { id: 'experience', version: 2, native_surface_id: 'native-surface', manifest_hash: manifest.hash },
    }));
  });

  it('validates host policy and sources household candidates from the environment', async () => {
    const groupPlayCatalog = { getConfig: () => ({ household_members: [{ id: 'member-1' }] }) };
    const { application, coordinator } = fixture({
      groupPlayCatalog,
      manifestOverride: { setup: { kind: 'none', host_modes: ['computer'], verifier: 'opponent', candidate_source: 'household-members' } },
    });
    await expect(application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'ai-assisted' } } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await expect(application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'computer' } } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'computer' }, verifier_id: 'member-1', candidates: [{ id: 'spoofed' }] } });
    expect(coordinator.create).toHaveBeenLastCalledWith(expect.objectContaining({
      setup: expect.objectContaining({ candidates: [{ id: 'member-1' }] }),
    }));
  });

  it('fails closed when mounted setup requirements are not satisfied', async () => {
    const { application } = fixture({ manifestOverride: { setup: { kind: 'teams' } } });
    await expect(application.createSession({ definitionId: 'definition:one', seats: [] }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await expect(application.createSession({ definitionId: 'definition:one', seats: [{ id: 'same' }, { id: 'same' }] }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
  });

  it('limits drawing writes to the active drawing performer', async () => {
    const resumedState = {
      phase: 'performing', challenge: { activity: 'draw' }, performer_id: 'team-one',
      performers: [{ id: 'team-one', members: [{ id: 'artist' }] }],
    };
    const { application, drawingCheckpoints } = fixture({ resumedState });
    await application.putDrawingCheckpoint('session:1', { strokes: [] }, { role: 'participant', participant_id: 'artist' });
    expect(drawingCheckpoints.put).toHaveBeenCalledOnce();
    await expect(application.putDrawingCheckpoint('session:1', { strokes: [] }, { role: 'participant', participant_id: 'observer' })).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(application.putDrawingCheckpoint('session:1', { strokes: [] }, { role: 'host' })).resolves.toEqual({ strokes: [] });
  });
});
