/**
 * HomeAssistantRoutineFileSource — reads the household's Home Assistant
 * routine config, read-only, for the routine catalog
 * (#domains/media/routineCatalog.mjs).
 *
 * Layout (HA `configuration.yaml`):
 *   rest_command: !include_dir_merge_named rest_commands/   → merged map
 *   script:       !include_dir_named scripts/               → file name = script id
 *   automation:   !include_dir_list automations/            → one automation per file
 *                                                             (a file holding a list is accepted)
 *
 * Subdirectories are read too (HA's include_dir_* recurse); a script is still
 * named by its file name. HA's custom tags (`!secret`, `!include`, `!input`,
 * ...) are read as plain values — nothing here needs them. A file that fails
 * to parse is skipped and logged by file and line (never the parser message,
 * which quotes config); the rest still load.
 *
 * The directory is configured (system config `media-routines.yml`,
 * `homeAssistant.configDir`). Where it is not reachable (the container does
 * not mount it) the source reports unavailable and the catalog falls back to
 * the stored snapshot (see `cli/media-routines.cli.mjs`).
 */
import path from 'path';
import yaml from 'js-yaml';
import { dirExists, listFiles, listDirs, readTextFromPath } from '#system/utils/FileIO.mjs';

const HA_TAGS = ['secret', 'include', 'include_dir_list', 'include_dir_named', 'include_dir_merge_list',
  'include_dir_merge_named', 'input', 'env_var'];
const HA_SCHEMA = yaml.DEFAULT_SCHEMA.extend(HA_TAGS.flatMap((tag) => ['scalar', 'sequence', 'mapping']
  .map((kind) => new yaml.Type(`!${tag}`, { kind, construct: (data) => data }))));

const isYaml = (name) => /\.ya?ml$/i.test(name);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class HomeAssistantRoutineFileSource {
  #dir;
  #dirs;
  #logger;

  /**
   * @param {{configDir: string|null, restCommandsDir?: string, scriptsDir?: string, automationsDir?: string, logger?: Object}} config
   */
  constructor({ configDir, restCommandsDir = 'rest_commands', scriptsDir = 'scripts', automationsDir = 'automations', logger = console } = {}) {
    this.#dir = typeof configDir === 'string' && configDir ? configDir : null;
    this.#dirs = { restCommandsDir, scriptsDir, automationsDir };
    this.#logger = logger;
  }

  get name() { return 'home-assistant'; }

  available() {
    return Boolean(this.#dir) && dirExists(this.#dir);
  }

  #parse(file) {
    try {
      return yaml.load(readTextFromPath(file), { schema: HA_SCHEMA });
    } catch (error) {
      // Never the parser's message: js-yaml quotes the offending config line.
      this.#logger.warn?.('media.routines.ha_file_unreadable', {
        file, error: error?.name ?? 'Error', line: Number.isFinite(error?.mark?.line) ? error.mark.line + 1 : null,
      });
      return undefined;
    }
  }

  /** YAML files under `sub`, recursively, as HA's include_dir_* reads them. */
  #files(sub, depth = 0) {
    const dir = path.join(this.#dir, sub);
    const here = listFiles(dir).filter(isYaml).sort().map((name) => ({ name, file: path.join(dir, name) }));
    if (depth >= 8) return here;
    const nested = listDirs(dir).filter((d) => !d.startsWith('.')).sort()
      .flatMap((d) => this.#files(path.join(sub, d), depth + 1));
    return [...here, ...nested];
  }

  /**
   * @returns {Promise<{restCommands: Object, scripts: Object, automations: Object[]}|null>} null when unavailable
   */
  async read() {
    if (!this.available()) return null;
    const restCommands = {};
    for (const { file } of this.#files(this.#dirs.restCommandsDir)) {
      const data = this.#parse(file);
      if (isObject(data)) Object.assign(restCommands, data);
    }
    const scripts = {};
    for (const { name, file } of this.#files(this.#dirs.scriptsDir)) {
      const data = this.#parse(file);
      if (isObject(data)) scripts[name.replace(/\.ya?ml$/i, '')] = data;
    }
    const automations = [];
    for (const { file } of this.#files(this.#dirs.automationsDir)) {
      const data = this.#parse(file);
      if (Array.isArray(data)) automations.push(...data.filter(isObject));
      else if (isObject(data)) automations.push(data);
    }
    this.#logger.debug?.('media.routines.ha_read', {
      restCommands: Object.keys(restCommands).length, scripts: Object.keys(scripts).length, automations: automations.length,
    });
    return { restCommands, scripts, automations };
  }
}

export default HomeAssistantRoutineFileSource;
