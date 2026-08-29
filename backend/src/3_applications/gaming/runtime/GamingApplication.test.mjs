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
  schema_version: 2, id: 'experience', version: 2, hash: 'b'.repeat(64),
  surfaces: [{ id: 'piano', presenter: 'primary-presenter', authority_modes: ['remote'], inputs: ['midi'] }],
  theme: { id: 'mounted-theme' }, result_schema: 'gaming-result/v1',
};

function fixture({ resumedState = {}, manifestOverride = {}, partyGamesCatalog = null } = {}) {
  const coordinator = {
    create: vi.fn(async (request) => ({ header: { session_id: 'session:1', ruleset: request.ruleset }, definition: {} })),
    resume: vi.fn(async () => ({ state: resumedState })),
    dispatch: vi.fn(), close: vi.fn(async () => ({
      header: { session_id: 'session:1', status: 'complete', revision: 3, experience: { id: 'experience' } },
      state: { winner_id: 'red', scores: { red: 10, blue: 5 } },
    })),
  };
  const definitions = { getCurrent: vi.fn(async () => structuredClone(mounted)) };
  const resolvedManifest = { ...manifest, ...manifestOverride };
  const manifestStore = { get: vi.fn((id, version) => id === resolvedManifest.id && version === resolvedManifest.version ? resolvedManifest : null), list: () => [resolvedManifest] };
  const drawingCheckpoints = { get: vi.fn(async () => ({ strokes: [] })), put: vi.fn(async (_id, value) => value), delete: vi.fn(async () => true) };
  return { application: new GamingApplication({ coordinator, definitions, manifestStore, drawingCheckpoints, partyGamesCatalog }), coordinator, drawingCheckpoints };
}

describe('GamingApplication mounted launch authority', () => {
  it('returns a safe launch descriptor without authored rules or content', async () => {
    const { application } = fixture();
    await expect(application.getLaunchDescriptor('definition:one')).resolves.toEqual({
      definition_id: 'definition:one', definition_hash: mounted.hash,
      ruleset: { id: 'rules', version: 3 },
      experience: { id: 'experience', version: 2 },
      surface: manifest.surfaces[0], authority_mode: 'remote', presenter_id: 'primary-presenter',
      theme: { id: 'mounted-theme' }, input_profile: null, lifecycle_capabilities: [], renderer_embeddings: [], result_schema: 'gaming-result/v1',
    });
  });

  it('derives ruleset and experience from mounted artifacts instead of request claims', async () => {
    const { application, coordinator } = fixture();
    await application.createSession({
      definitionId: 'definition:one', ruleset: { id: 'spoofed', version: 99 },
      experience: { id: 'spoofed', version: 99 }, participants: [], viewer: { role: 'host' }, surfaceId: 'piano',
    });
    expect(coordinator.create).toHaveBeenCalledWith(expect.objectContaining({
      ruleset: { id: 'rules', version: 3 },
      experience: { id: 'experience', version: 2, manifest_hash: manifest.hash },
      launch: { surface_id: 'piano', authority_mode: 'remote' },
    }));
  });

  it('requires a surface for portable experiences and enforces its authority policy', async () => {
    const surfaces = [
      ...manifest.surfaces,
      { id: 'school', presenter: 'lesson-presenter', authority_modes: ['checkpointed-local'], inputs: ['keyboard'] },
    ];
    const { application } = fixture({ manifestOverride: { surfaces } });
    await expect(application.getLaunchDescriptor('definition:one')).rejects.toMatchObject({ code: 'surface_required' });
    await expect(application.getLaunchDescriptor('definition:one', { surfaceId: 'living-room' })).rejects.toMatchObject({ code: 'surface_incompatible' });
    await expect(application.getLaunchDescriptor('definition:one', { surfaceId: 'school', authorityMode: 'remote' })).rejects.toMatchObject({ code: 'authority_incompatible' });
    await expect(application.getLaunchDescriptor('definition:one', { surfaceId: 'school' })).resolves.toMatchObject({ authority_mode: 'checkpointed-local', presenter_id: 'lesson-presenter' });
  });

  it('validates host policy and sources household candidates from the environment', async () => {
    const partyGamesCatalog = { getConfig: () => ({ household_members: [{ id: 'member-1' }] }) };
    const { application, coordinator } = fixture({
      partyGamesCatalog,
      manifestOverride: { setup: { kind: 'none', host_modes: ['computer'], verifier: 'opponent', candidate_source: 'household-members' } },
    });
    await expect(application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'ai-assisted' } }, viewer: { role: 'host' } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await expect(application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'computer' } }, viewer: { role: 'host' } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await application.createSession({ definitionId: 'definition:one', setup: { host: { mode: 'computer' }, verifier_id: 'member-1', candidates: [{ id: 'spoofed' }] }, viewer: { role: 'host' } });
    expect(coordinator.create).toHaveBeenLastCalledWith(expect.objectContaining({
      setup: expect.objectContaining({ candidates: [{ id: 'member-1' }] }),
    }));
  });

  it('fails closed when mounted setup requirements are not satisfied', async () => {
    const { application } = fixture({ manifestOverride: { setup: { kind: 'teams' } } });
    await expect(application.createSession({ definitionId: 'definition:one', seats: [], viewer: { role: 'host' } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
    await expect(application.createSession({ definitionId: 'definition:one', seats: [{ id: 'same' }, { id: 'same' }], viewer: { role: 'host' } }))
      .rejects.toMatchObject({ code: 'invalid_session_setup' });
  });

  it('enforces participant self-only session creation outside HTTP', async () => {
    const { application } = fixture();
    await expect(application.createSession({ definitionId: 'definition:one', participants: [] }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(application.createSession({
      definitionId: 'definition:one', participants: [{ id: 'other' }],
      viewer: { role: 'participant', participant_id: 'self' },
    })).rejects.toMatchObject({ code: 'authorization_denied' });
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

  it('returns the normalized cross-surface result envelope when a session closes', async () => {
    const { application } = fixture();
    await expect(application.closeSession('session:1', { reason: 'experience_complete' })).resolves.toMatchObject({
      result: {
        schema: 'gaming-result/v1', experience_id: 'experience', status: 'completed',
        outcome: { kind: 'win', winner_ids: ['red'] },
        scores: [{ subject_id: 'red', value: 10 }, { subject_id: 'blue', value: 5 }],
      },
    });
  });
});
