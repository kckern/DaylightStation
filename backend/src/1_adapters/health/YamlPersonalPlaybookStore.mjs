import path from 'node:path';
import yaml from 'js-yaml';
import { IPersonalPlaybookStore } from '#apps/health/ports/IPersonalPlaybookStore.mjs';
import { readTextFromPathAsync } from '#system/utils/FileIO.mjs';

export class YamlPersonalPlaybookStore extends IPersonalPlaybookStore {
  #usersRoot; #logger;
  constructor({ usersRoot, logger = console }) { super(); this.#usersRoot = usersRoot; this.#logger = logger; }
  async load(userId) {
    const locator = path.join(this.#usersRoot, userId, 'lifelog/archives/playbook/playbook.yml');
    try { return yaml.load(await readTextFromPathAsync(locator)) || null; }
    catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.warn?.('personal_context.read_failed', { path: locator, error: error?.message || String(error) });
      return null;
    }
  }
}
