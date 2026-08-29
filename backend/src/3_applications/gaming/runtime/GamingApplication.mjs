import { GamingKernelError } from '#shared/gaming/kernel/index.mjs';
import { gamingResult } from '#shared/gaming/experience/index.mjs';

function completedResult(view, { abandoned = false } = {}) {
  if (view?.header?.status !== 'complete' || !view.header.experience?.id) return null;
  const winner = view.state?.winner_id || view.state?.winnerId || view.state?.winner || null;
  const scores = Object.entries(view.state?.scores || {}).filter(([, value]) => Number.isFinite(value))
    .map(([subject_id, value]) => ({ subject_id, value }));
  return gamingResult({
    sessionId: view.header.session_id,
    experienceId: view.header.experience.id,
    status: abandoned ? 'abandoned' : 'completed',
    outcome: abandoned ? { kind: 'abandoned' } : winner ? { kind: 'win', winner_ids: [String(winner)] } : { kind: 'completed' },
    scores,
    durationMs: 0,
    evidence: { revision: view.header.revision },
  });
}

export class GamingApplication {
  constructor({ coordinator, definitions, partyGamesCatalog = null, effects = null, manifestStore, drawingCheckpoints = null }) {
    if (!manifestStore) throw new Error('GamingApplication manifestStore is required');
    Object.assign(this, { coordinator, definitions, partyGamesCatalog, effects, manifestStore, drawingCheckpoints });
  }

  async getDefinition(definitionId) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    return { definition: structuredClone(loaded.definition), hash: loaded.hash, artifacts: structuredClone(loaded.artifacts || {}) };
  }

  async getLaunchDescriptor(definitionId, { surfaceId = null, authorityMode = null } = {}) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    const ruleset = loaded.definition?.rule_module;
    const experienceReference = loaded.definition?.experience;
    if (!ruleset?.id || !Number.isInteger(ruleset.version) || !experienceReference?.id || !Number.isInteger(experienceReference.version)) {
      throw new GamingKernelError('invalid_definition', 'Mounted rules must declare rule_module and experience references');
    }
    const manifest = this.manifestStore.get(experienceReference.id, experienceReference.version);
    if (!manifest) throw new GamingKernelError('experience_manifest_invalid', 'The version-pinned experience manifest is unavailable');
    const compatible = surfaceId
      ? manifest.surfaces.filter((surface) => surface.id === surfaceId)
      : manifest.surfaces;
    if (compatible.length === 0) throw new GamingKernelError('surface_incompatible', `Experience ${manifest.id} does not support surface ${surfaceId}`);
    if (!surfaceId && compatible.length > 1) throw new GamingKernelError('surface_required', `Experience ${manifest.id} requires an explicit launch surface`);
    const surface = compatible[0];
    const selectedAuthority = authorityMode || (surface.authority_modes.includes('remote') ? 'remote' : surface.authority_modes[0]);
    if (!surface.authority_modes.includes(selectedAuthority)) throw new GamingKernelError('authority_incompatible', `Experience ${manifest.id} does not support ${selectedAuthority} authority on ${surface.id}`);
    return {
      definition_id: definitionId,
      definition_hash: loaded.hash,
      ruleset: structuredClone(ruleset),
      experience: { id: manifest.id, version: manifest.version },
      surface: structuredClone(surface),
      authority_mode: selectedAuthority,
      presenter_id: surface.presenter,
      theme: structuredClone(manifest.theme || null),
      input_profile: structuredClone(manifest.input_profile || null),
      lifecycle_capabilities: structuredClone(manifest.lifecycle_capabilities || []),
      renderer_embeddings: structuredClone(surface.renderer_embeddings || []),
      result_schema: manifest.result_schema,
    };
  }

  async createSession(request) {
    const participants = request.participants || [];
    const seats = request.seats || [];
    const viewer = request.viewer;
    if (!viewer) throw new GamingKernelError('authorization_denied', 'A session creator identity is required');
    if (viewer.role !== 'host' && (participants.length === 0
      || participants.some((participant) => String(participant.id || participant.user_id || '') !== viewer.participant_id)
      || seats.length > 0)) {
      throw new GamingKernelError('authorization_denied', 'Participants may create only an unseated session for themselves');
    }
    const launch = await this.getLaunchDescriptor(request.definitionId, { surfaceId: request.surfaceId, authorityMode: 'remote' });
    const manifest = this.manifestStore.get(launch.experience.id, launch.experience.version);
    const setup = structuredClone(request.setup || {});
    const setupKind = manifest.setup?.kind || 'none';
    if (setupKind === 'individuals' && participants.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires participants');
    if (setupKind === 'teams' && seats.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires team seats');
    if (setupKind === 'individuals-or-teams' && participants.length === 0 && seats.length === 0) throw new GamingKernelError('invalid_session_setup', 'This experience requires participants or team seats');
    const seatIds = seats.map((seat) => seat?.id).filter(Boolean).map(String);
    if (seatIds.length !== seats.length || new Set(seatIds).size !== seatIds.length) throw new GamingKernelError('invalid_session_setup', 'Session seats require unique IDs');
    const allowedHostModes = manifest.setup?.host_modes || [];
    if (setup.host?.mode && !allowedHostModes.includes(setup.host.mode)) {
      throw new GamingKernelError('invalid_session_setup', `Host mode ${setup.host.mode} is not allowed by the experience manifest`);
    }
    if (manifest.setup?.verifier === 'opponent' && setup.host?.mode && setup.host.mode !== 'human' && !setup.verifier_id) {
      throw new GamingKernelError('invalid_session_setup', 'This host mode requires an opponent verifier');
    }
    if (manifest.setup?.candidate_source === 'household-members') {
      if (!this.partyGamesCatalog) throw new GamingKernelError('invalid_session_setup', 'Household candidates require the Party Games environment');
      setup.candidates = this.partyGamesCatalog.getConfig().household_members;
    }
    const result = await this.coordinator.create({
      ...request,
      setup,
      ruleset: launch.ruleset,
      experience: {
        id: manifest.id,
        version: manifest.version,
        manifest_hash: manifest.hash,
      },
      launch: { surface_id: launch.surface.id, authority_mode: launch.authority_mode },
    });
    this.#launchEffect('after-create', this.effects?.afterCreate({ session: result, definition: result.definition }), { sessionId: result.header.session_id });
    return result;
  }
  resumeSession(sessionId, viewer) { return this.coordinator.resume(sessionId, viewer); }
  async dispatch(sessionId, envelope, viewer) {
    const result = await this.coordinator.dispatch(sessionId, envelope, viewer);
    this.#launchEffect('after-commit', this.effects?.afterCommit({ sessionId, result, command: envelope, viewer }), { sessionId, revision: result.header.revision });
    const normalized = completedResult(result);
    return normalized ? { ...result, result: normalized } : result;
  }
  async closeSession(sessionId, options = {}) {
    const view = await this.coordinator.close(sessionId, options);
    const normalized = completedResult(view, { abandoned: options.reason !== 'experience_complete' });
    return normalized ? { ...view, result: normalized } : view;
  }

  getEnvironmentProfile() {
    if (!this.partyGamesCatalog) throw new GamingKernelError('party_games_unavailable', 'Party Games environment is unavailable');
    return this.partyGamesCatalog.getConfig();
  }
  listPartyGamesCatalog() {
    if (!this.partyGamesCatalog) throw new GamingKernelError('party_games_unavailable', 'Party Games environment is unavailable');
    return this.partyGamesCatalog.listCatalog();
  }
  listContent(experienceId) {
    if (!this.partyGamesCatalog) throw new GamingKernelError('party_games_unavailable', 'Party Games environment is unavailable');
    return this.partyGamesCatalog.listSets(experienceId);
  }
  getContent(experienceId, contentId) {
    if (!this.partyGamesCatalog) throw new GamingKernelError('party_games_unavailable', 'Party Games environment is unavailable');
    return this.partyGamesCatalog.getSet(experienceId, contentId);
  }

  async printHostPacket(sessionId, { explicit = true } = {}) {
    const session = await this.coordinator.resume(sessionId, { role: 'host' });
    return this.effects?.printHostPacket({ sessionId, session, definition: session.definition, explicit }) || { status: 'printing-unavailable' };
  }
  listEffects(sessionId) { return this.effects?.list(sessionId) || []; }
  async getDrawingCheckpoint(sessionId, viewer) { await this.#authorizeDrawing(sessionId, viewer, 'read'); return this.drawingCheckpoints?.get(sessionId) || { strokes: [] }; }
  async putDrawingCheckpoint(sessionId, checkpoint, viewer) { await this.#authorizeDrawing(sessionId, viewer, 'write'); if (!this.drawingCheckpoints) throw new GamingKernelError('drawing_unavailable', 'Drawing checkpoints are unavailable'); return this.drawingCheckpoints.put(sessionId, checkpoint); }
  async deleteDrawingCheckpoint(sessionId, viewer) { await this.#authorizeDrawing(sessionId, viewer, 'delete'); return { deleted: await this.drawingCheckpoints?.delete(sessionId) || false }; }
  listExperienceManifests() { return this.manifestStore.list().map((manifest) => structuredClone(manifest)); }
  listExperienceCatalog(surfaceId) {
    return this.manifestStore.list()
      .filter((manifest) => !surfaceId || manifest.surfaces.some((surface) => surface.id === surfaceId))
      .map((manifest) => structuredClone(manifest));
  }
  getExperienceManifest(id) { const manifest = this.manifestStore.get(id); if (!manifest) throw new GamingKernelError('experience_not_found', `Experience ${id} was not found`); return structuredClone(manifest); }

  #launchEffect(stage, operation, fields) {
    if (!operation || typeof operation.catch !== 'function') return;
    operation.catch((error) => this.effects?.reportFailure?.(stage, error, fields));
  }

  async #authorizeDrawing(sessionId, viewer, operation) {
    const session = await this.coordinator.resume(sessionId, viewer);
    if (viewer?.role === 'host' || viewer?.role === 'system') return session;
    const state = session.state || {};
    const performer = (state.performers || []).find((entry) => String(entry.id) === String(state.performer_id));
    const ids = new Set([performer?.id, performer?.participant_id, ...(performer?.members || []).flatMap((member) => [member?.id, member?.user_id, member?.participant_id, member])].filter(Boolean).map(String));
    const activeDrawing = state.challenge?.activity === 'draw' && ['challenge-ready', 'performing', 'adjudication', 'verification'].includes(state.phase);
    const mayWrite = state.phase === 'performing';
    if (!activeDrawing || !ids.has(String(viewer?.participant_id || '')) || (operation === 'write' && !mayWrite)) {
      throw new GamingKernelError('authorization_denied', `Viewer is not authorized to ${operation} this drawing checkpoint`);
    }
    return session;
  }
}
