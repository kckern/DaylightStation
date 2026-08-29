/** Mounted party-games environment profile and catalog metadata. */
const GAME_NAME_RE = /^[a-z][a-z0-9-]*$/;
const userAvatarRef = (userId) => ({ kind: 'user-avatar', userId });

export function normalizePartyGamesSettings(raw = {}) {
  return {
    buzzers: raw.buzzers || [],
    presets: raw.team_presets || [],
    defaults: { timerSeconds: raw.defaults?.timer_seconds ?? 12, mute: raw.defaults?.mute ?? false },
    sounds: { pack: raw.sounds?.pack || 'classic' },
    ai: {
      commentary: raw.ai?.commentary !== false,
      advisoryJudgment: raw.ai?.advisory_judgment !== false,
      timeoutMs: Number.isFinite(raw.ai?.timeout_ms) ? Math.max(100, Math.trunc(raw.ai.timeout_ms)) : 1500,
    },
    printing: {
      host: raw.printing?.host || null,
      port: raw.printing?.port || 631,
      autoPrintOncePerSession: raw.printing?.auto_print_once_per_session === true,
    },
  };
}

function catalogEntry(definitionId, loaded, manifest) {
  const content = loaded.parts?.content
    ? Object.fromEntries(Object.entries(loaded.parts.content).filter(([key]) => key !== 'artifact'))
    : {};
  const authored = content.catalog || {};
  const title = authored.title || content.title;
  if (typeof title !== 'string' || title.trim() === '') throw new Error('catalog title is required');
  const setup = manifest.setup?.kind || 'none';
  if (!['none', 'individuals', 'teams', 'individuals-or-teams'].includes(setup)) throw new Error(`invalid setup kind: ${setup}`);
  const surface = manifest.surfaces.find((candidate) => candidate.id === 'party-games');
  if (!surface) throw new Error('Party Games surface is required');
  return {
    id: definitionId,
    definition_id: definitionId,
    content_id: definitionId.includes(':') ? definitionId.slice(definitionId.indexOf(':') + 1) : definitionId,
    experience_id: manifest.id,
    title: title.trim(),
    description: typeof authored.description === 'string' ? authored.description : String(content.description || ''),
    setup,
    setup_profile: structuredClone(manifest.setup || { kind: 'none' }),
    ...(Number.isInteger(authored.round_count) ? { round_count: authored.round_count } : {}),
    presenter_id: surface.presenter,
    valid: true,
  };
}

export class PartyGamesCatalog {
  constructor({ configProjection, userService, definitionStore, manifestStore, resourcePresenter, logger = null }) {
    if (!manifestStore) throw new Error('PartyGamesCatalog manifestStore is required');
    if (!configProjection?.raw) throw new Error('PartyGamesCatalog configProjection is required');
    if (!resourcePresenter) throw new Error('PartyGamesCatalog resourcePresenter is required');
    Object.assign(this, {
      configProjection,
      userService,
      definitionStore,
      manifestStore,
      resourcePresenter,
      logger,
    });
  }

  #hydrateMember(username, semanticResources) {
    const profile = this.userService.getProfile(username);
    if (!profile) {
      this.logger?.warn?.('party-games.preset.unknown_user', { username });
      return { id: username, name: username, avatar: null };
    }
    const id = profile.username || username;
    const avatar = userAvatarRef(id);
    return { id, name: profile.group_label || profile.display_name || id,
      avatar: semanticResources ? avatar : this.resourcePresenter(avatar) };
  }

  getConfig({ semanticResources = false } = {}) {
    const raw = this.configProjection.raw() || {};
    const settings = normalizePartyGamesSettings(raw);
    const presets = settings.presets.map((preset) => ({
      id: preset.id,
      name: preset.name || preset.id,
      teams: (preset.teams || []).map((team, index) => ({
        name: team.name || `Team ${index + 1}`,
        color: team.color || null,
        members: (team.members || []).map((member) => this.#hydrateMember(String(member), semanticResources)),
      })),
    }));
    const householdMembers = (this.userService.getHouseholdRoster?.() || []).map((profile) => ({
      id: profile.id,
      name: profile.group_label || profile.name || profile.id,
      avatar: semanticResources ? userAvatarRef(profile.id) : this.resourcePresenter(userAvatarRef(profile.id)),
    }));
    return {
      buzzers: settings.buzzers,
      household_members: householdMembers,
      team_presets: presets,
      defaults: { timer_seconds: settings.defaults.timerSeconds, mute: settings.defaults.mute },
      sounds: { pack: settings.sounds.pack },
      ai: {
        commentary: settings.ai.commentary,
        advisory_judgment: settings.ai.advisoryJudgment,
        timeout_ms: settings.ai.timeoutMs,
      },
      printing: {
        host: settings.printing.host,
        port: settings.printing.port,
        auto_print_once_per_session: settings.printing.autoPrintOncePerSession,
      },
    };
  }

  getResourceConfig() { return this.getConfig({ semanticResources: true }); }

  listCatalog() {
    return this.definitionStore.listIds().flatMap((definitionId) => {
      try {
        const loaded = this.definitionStore.getCurrent(definitionId);
        const reference = loaded?.definition?.experience;
        const manifest = reference && this.manifestStore.get(reference.id, reference.version);
        if (!manifest?.surfaces.some((surface) => surface.id === 'party-games')) return [];
        return [catalogEntry(definitionId, loaded, manifest)];
      } catch (error) {
        this.logger?.warn?.('party-games.catalog.invalid', { definitionId, error: error.message });
        const loaded = this.definitionStore.getCurrent(definitionId);
        return [{ id: definitionId, definition_id: definitionId, experience_id: loaded?.definition?.experience?.id || null, title: definitionId, description: '', setup: 'none', valid: false, error: error.message }];
      }
    });
  }

  listSets(experienceId) {
    if (!GAME_NAME_RE.test(String(experienceId))) throw new Error(`invalid experience id: ${experienceId}`);
    return this.listCatalog().filter((entry) => entry.experience_id === experienceId);
  }

  getSet(experienceId, contentId) {
    if (!GAME_NAME_RE.test(String(experienceId)) || !GAME_NAME_RE.test(String(contentId))) throw new Error('invalid content reference');
    const entry = this.listCatalog().find((candidate) => candidate.experience_id === experienceId && candidate.content_id === contentId && candidate.valid);
    if (!entry) throw new Error(`content not found: ${contentId}`);
    return this.definitionStore.getContent(entry.definition_id);
  }
}
