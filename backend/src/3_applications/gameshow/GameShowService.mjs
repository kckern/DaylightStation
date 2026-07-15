/**
 * GameShowService - config + content for the game-show shell.
 *
 * - getConfig(): household gameshow.yml merged with defaults; team-preset
 *   members hydrated to { id, name, avatar } via UserService.
 * - listSets(game)/getSet(game, id): game-set YAML files from
 *   <dataDir>/content/games/<game>/, validated via the gameshow domain.
 */
import path from 'path';
import { loadYamlSafe, listYamlFiles } from '#system/utils/index.mjs';
import { validateGameSet } from '#domains/gameshow/gameSetValidation.mjs';

const GAME_NAME_RE = /^[a-z0-9-]+$/;

export class GameShowService {
  constructor({ configService, userService, logger = console }) {
    this.configService = configService;
    this.userService = userService;
    this.logger = logger;
  }

  #hydrateMember(username) {
    const profile = this.userService.getProfile(username);
    if (!profile) {
      this.logger.warn?.('gameshow.preset.unknown_user', { username });
      return { id: username, name: username, avatar: null };
    }
    const id = profile.username || username;
    return {
      id,
      name: profile.display_name || id,
      avatar: `/api/v1/static/users/${id}`,
    };
  }

  getConfig() {
    const raw = this.configService.getHouseholdAppConfig(null, 'gameshow') || {};
    const presets = (raw.team_presets || []).map((preset) => ({
      id: preset.id,
      name: preset.name || preset.id,
      teams: (preset.teams || []).map((team, i) => ({
        name: team.name || `Team ${i + 1}`,
        color: team.color || null,
        members: (team.members || []).map((m) => this.#hydrateMember(String(m))),
      })),
    }));
    return {
      buzzers: raw.buzzers || [],
      team_presets: presets,
      defaults: {
        timer_seconds: raw.defaults?.timer_seconds ?? 12,
        mute: raw.defaults?.mute ?? false,
      },
      sounds: { pack: raw.sounds?.pack || 'classic' },
    };
  }

  #setsDir(game) {
    if (!GAME_NAME_RE.test(String(game))) throw new Error(`invalid game name: ${game}`);
    return path.join(this.configService.getDataDir(), 'content', 'games', String(game));
  }

  listSets(game) {
    const dir = this.#setsDir(game);
    const names = listYamlFiles(dir) || [];
    return names.map((name) => {
      const raw = loadYamlSafe(path.join(dir, name));
      const { valid, errors, set } = validateGameSet(raw);
      return valid
        ? { id: set.id, title: set.title, description: set.description, roundCount: set.rounds.length, valid: true, error: null }
        : { id: name, title: name, description: '', roundCount: 0, valid: false, error: errors[0] || 'invalid' };
    });
  }

  getSet(game, setId) {
    const dir = this.#setsDir(game);
    if (!GAME_NAME_RE.test(String(setId))) throw new Error(`set not found: ${setId}`);
    const raw = loadYamlSafe(path.join(dir, String(setId)));
    if (!raw) throw new Error(`set not found: ${setId}`);
    const { valid, errors, set } = validateGameSet(raw);
    if (!valid) throw new Error(`invalid set ${setId}: ${errors[0]}`);
    return set;
  }
}
