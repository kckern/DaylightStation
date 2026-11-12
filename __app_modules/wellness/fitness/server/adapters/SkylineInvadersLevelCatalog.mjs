import path from 'path';
import { listYamlFiles, loadYamlFromPath } from '#system/utils/FileIO.mjs';

// Levels are household data: fitness/skyline-invaders/levels/*.yml, ordered by
// fitness/skyline-invaders/world.yml. Nothing is bundled with the app, so an
// empty or missing folder is a real state (no levels installed). Each file is
// read on every request, so an edit needs no restart. This is the structural
// check only; the browser validates fully, including reachability.
const SCHEMA = 'skyline-invaders-level/v1';
const ID = /^[a-z][a-z0-9-]+$/;

const structurallyValid = (level) => level?.schema === SCHEMA && ID.test(level?.id || '')
  && typeof level?.name === 'string' && level.duration_s > 0
  && Number.isInteger(level?.pass?.kills) && Array.isArray(level?.waves) && level.waves.length > 0;

function readDir(dir) {
  return listYamlFiles(dir, { stripExtension: false }).sort().map((name) => ({ name, value: loadYamlFromPath(path.join(dir, name)) }));
}

export class SkylineInvadersLevelCatalog {
  constructor({ configService, logger = console } = {}) {
    if (!configService) throw new Error('SkylineInvadersLevelCatalog requires configService');
    this.configService = configService;
    this.logger = logger;
  }

  #path(relative, householdId) {
    return this.configService.getHouseholdPath(`fitness/skyline-invaders/${relative}`, householdId);
  }

  /** Valid levels in world order: world.yml first, then the rest by id. */
  list(householdId) {
    const levels = new Map();
    for (const { name, value } of readDir(this.#path('levels', householdId))) {
      if (structurallyValid(value)) levels.set(value.id, value);
      else this.logger.warn?.('fitness.skyline_invaders.level.invalid', { file: name, id: value?.id ?? null });
    }
    const world = loadYamlFromPath(this.#path('world.yml', householdId));
    const listed = [...new Set(Array.isArray(world?.levels) ? world.levels : [])].filter((id) => levels.has(id));
    const rest = [...levels.keys()].filter((id) => !listed.includes(id)).sort();
    return [...listed, ...rest].map((id) => levels.get(id));
  }

  /** The progression list: { levels: [{ id, name }] }. */
  world(householdId) {
    return { levels: this.list(householdId).map(({ id, name }) => ({ id, name })) };
  }
}
