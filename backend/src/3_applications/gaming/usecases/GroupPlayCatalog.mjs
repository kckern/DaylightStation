/** Mounted group-play environment profile and catalog metadata. */
const GAME_NAME_RE = /^[a-z][a-z0-9-]*$/;

function catalogEntry(definitionId, loaded, manifest) {
  const content = loaded.parts?.content
    ? Object.fromEntries(Object.entries(loaded.parts.content).filter(([key]) => key !== 'artifact'))
    : {};
  const authored = content.catalog || {};
  const title = authored.title || content.title;
  if (typeof title !== 'string' || title.trim() === '') throw new Error('catalog title is required');
  const setup = manifest.setup?.kind || 'none';
  if (!['none', 'individuals', 'teams', 'individuals-or-teams'].includes(setup)) throw new Error(`invalid setup kind: ${setup}`);
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
    presenter_id: manifest.presenters.primary,
    valid: true,
  };
}

export class GroupPlayCatalog {
  constructor({ configService, userService, definitionStore, manifestStore, logger = null }) {
    if (!manifestStore) throw new Error('GroupPlayCatalog manifestStore is required');
    Object.assign(this, { configService, userService, definitionStore, manifestStore, logger });
  }

  #hydrateMember(username) {
    const profile = this.userService.getProfile(username);
    if (!profile) {
      this.logger?.warn?.('group-play.preset.unknown_user', { username });
      return { id: username, name: username, avatar: null };
    }
    const id = profile.username || username;
    return { id, name: profile.group_label || profile.display_name || id, avatar: `/api/v1/static/users/${id}` };
  }

  getConfig() {
    const raw = this.configService.getHouseholdAppConfig(null, 'group-play') || {};
    const presets = (raw.team_presets || []).map((preset) => ({
      id: preset.id,
      name: preset.name || preset.id,
      teams: (preset.teams || []).map((team, index) => ({
        name: team.name || `Team ${index + 1}`,
        color: team.color || null,
        members: (team.members || []).map((member) => this.#hydrateMember(String(member))),
      })),
    }));
    const householdMembers = (this.userService.getHouseholdRoster?.() || []).map((profile) => ({
      id: profile.id,
      name: profile.group_label || profile.name || profile.id,
      avatar: `/api/v1/static/users/${profile.id}`,
    }));
    return {
      buzzers: raw.buzzers || [],
      household_members: householdMembers,
      team_presets: presets,
      defaults: { timer_seconds: raw.defaults?.timer_seconds ?? 12, mute: raw.defaults?.mute ?? false },
      sounds: { pack: raw.sounds?.pack || 'classic' },
      ai: {
        commentary: raw.ai?.commentary !== false,
        advisory_judgment: raw.ai?.advisory_judgment !== false,
        timeout_ms: Number.isFinite(raw.ai?.timeout_ms) ? Math.max(100, Math.trunc(raw.ai.timeout_ms)) : 1500,
      },
      printing: {
        host: raw.printing?.host || null,
        port: raw.printing?.port || 631,
        auto_print_once_per_session: raw.printing?.auto_print_once_per_session === true,
      },
    };
  }

  listCatalog() {
    return this.definitionStore.listIds().flatMap((definitionId) => {
      try {
        const loaded = this.definitionStore.getCurrent(definitionId);
        const reference = loaded?.definition?.experience;
        const manifest = reference && this.manifestStore.get(reference.id, reference.version);
        if (!manifest || manifest.native_surface_id !== 'group-play') return [];
        return [catalogEntry(definitionId, loaded, manifest)];
      } catch (error) {
        this.logger?.warn?.('group-play.catalog.invalid', { definitionId, error: error.message });
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
