import { Satellite } from '../../../2_domains/brain/Satellite.mjs';

export class YamlSatelliteRegistry {
  #configService;
  #logger;
  #householdId;
  #byToken = new Map();
  #all = [];

  constructor({ configService, logger = console, householdId = null }) {
    if (!configService) throw new Error('YamlSatelliteRegistry: configService is required');
    this.#configService = configService;
    this.#logger = logger;
    this.#householdId = householdId;
  }

  async load() {
    const yaml = this.#configService.reloadHouseholdAppConfig?.(this.#householdId, 'brain');
    const entries = Array.isArray(yaml?.satellites) ? yaml.satellites : [];
    this.#byToken.clear();
    this.#all = [];

    for (const entry of entries) {
      const tokenRef = entry.token_ref ?? '';
      const token = this.#resolveTokenRef(tokenRef);
      if (!token) {
        this.#logger.warn?.('brain.satellite.missing_token', { id: entry.id, token_ref: tokenRef });
        continue;
      }

      try {
        const satellite = new Satellite({
          id: entry.id,
          mediaPlayerEntity: entry.media_player_entity,
          area: entry.area ?? null,
          allowedSkills: entry.allowed_skills ?? [],
          defaultVolume: entry.default_volume ?? null,
          defaultMediaClass: entry.default_media_class ?? null,
        });
        this.#byToken.set(token, satellite);
        this.#all.push(satellite);
      } catch (err) {
        this.#logger.warn?.('brain.satellite.invalid', { id: entry.id, error: err.message });
      }
    }

    this.#logger.info?.('brain.satellite.config_reload', { count: this.#all.length });
  }

  #resolveTokenRef(ref) {
    if (typeof ref !== 'string' || !ref.startsWith('ENV:')) return null;
    const key = ref.slice(4);
    // ENV: prefix means an environment variable. Check process.env first so
    // operators can rotate tokens without editing data/system/secrets.yml,
    // then fall back to the secrets store for compatibility.
    return process.env[key] ?? this.#configService.getSecret?.(key) ?? null;
  }

  async findByToken(token) {
    if (!token) return null;
    return this.#byToken.get(token) ?? null;
  }

  async list() {
    return [...this.#all];
  }
}

export default YamlSatelliteRegistry;
