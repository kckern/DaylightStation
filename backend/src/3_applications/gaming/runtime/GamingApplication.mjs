import { GamingKernelError } from '#shared/gaming/kernel/index.mjs';

export class GamingApplication {
  constructor({ coordinator, definitions, groupPlayCatalog = null, effects = null, manifestStore, drawingCheckpoints = null }) {
    if (!manifestStore) throw new Error('GamingApplication manifestStore is required');
    Object.assign(this, { coordinator, definitions, groupPlayCatalog, effects, manifestStore, drawingCheckpoints });
  }

  async getDefinition(definitionId) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    return { definition: structuredClone(loaded.definition), hash: loaded.hash, artifacts: structuredClone(loaded.artifacts || {}) };
  }

  async getLaunchDescriptor(definitionId) {
    const loaded = await this.definitions.getCurrent(definitionId);
    if (!loaded) throw new GamingKernelError('definition_not_found', `Definition ${definitionId} was not found`);
    const ruleset = loaded.definition?.rule_module;
    const experienceReference = loaded.definition?.experience;
    if (!ruleset?.id || !Number.isInteger(ruleset.version) || !experienceReference?.id || !Number.isInteger(experienceReference.version)) {
      throw new GamingKernelError('invalid_definition', 'Mounted rules must declare rule_module and experience references');
    }
    const manifest = this.manifestStore.get(experienceReference.id, experienceReference.version);
    if (!manifest) throw new GamingKernelError('experience_manifest_invalid', 'The version-pinned experience manifest is unavailable');
    return {
      definition_id: definitionId,
      definition_hash: loaded.hash,
      ruleset: structuredClone(ruleset),
      experience: { id: manifest.id, version: manifest.version, native_surface_id: manifest.native_surface_id },
      presenter_id: manifest.presenters.primary,
      theme: structuredClone(manifest.theme || null),
      input_profile: structuredClone(manifest.input_profile || null),
      renderer_embeddings: structuredClone(manifest.renderer_embeddings || []),
    };
  }

  async createSession(request) {
    const launch = await this.getLaunchDescriptor(request.definitionId);
    const manifest = this.manifestStore.get(launch.experience.id, launch.experience.version);
    const setup = structuredClone(request.setup || {});
    const setupKind = manifest.setup?.kind || 'none';
    const participants = request.participants || [];
    const seats = request.seats || [];
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
      if (!this.groupPlayCatalog) throw new GamingKernelError('invalid_session_setup', 'Household candidates require a group-play environment');
      setup.candidates = this.groupPlayCatalog.getConfig().household_members;
    }
    const result = await this.coordinator.create({
      ...request,
      setup,
      ruleset: launch.ruleset,
      experience: {
        id: manifest.id,
        version: manifest.version,
        native_surface_id: manifest.native_surface_id,
        manifest_hash: manifest.hash,
      },
    });
    this.#launchEffect('after-create', this.effects?.afterCreate({ session: result, definition: result.definition }), { sessionId: result.header.session_id });
    return result;
  }
  resumeSession(sessionId, viewer) { return this.coordinator.resume(sessionId, viewer); }
  async dispatch(sessionId, envelope, viewer) {
    const result = await this.coordinator.dispatch(sessionId, envelope, viewer);
    this.#launchEffect('after-commit', this.effects?.afterCommit({ sessionId, result, command: envelope, viewer }), { sessionId, revision: result.header.revision });
    return result;
  }
  closeSession(sessionId, options) { return this.coordinator.close(sessionId, options); }

  getEnvironmentProfile() {
    if (!this.groupPlayCatalog) throw new GamingKernelError('group_play_unavailable', 'Group-play environment is unavailable');
    return this.groupPlayCatalog.getConfig();
  }
  listGroupPlayCatalog() {
    if (!this.groupPlayCatalog) throw new GamingKernelError('group_play_unavailable', 'Group-play environment is unavailable');
    return this.groupPlayCatalog.listCatalog();
  }
  listContent(experienceId) {
    if (!this.groupPlayCatalog) throw new GamingKernelError('group_play_unavailable', 'Group-play environment is unavailable');
    return this.groupPlayCatalog.listSets(experienceId);
  }
  getContent(experienceId, contentId) {
    if (!this.groupPlayCatalog) throw new GamingKernelError('group_play_unavailable', 'Group-play environment is unavailable');
    return this.groupPlayCatalog.getSet(experienceId, contentId);
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
