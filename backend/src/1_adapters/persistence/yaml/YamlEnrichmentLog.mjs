/**
 * YamlEnrichmentLog — out-of-band learning entries (plan W3-4, spec B6):
 * `apps/school/enrichment.yml` `{entries: [...]}`, APPEND-ONLY — an
 * attributed evidence kind (recordedBy, learnerIds, date range, subjects),
 * a cousin of attestation: parent-recorded, never merged into graded
 * evidence, never inflating mastery.
 */
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

export class YamlEnrichmentLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlEnrichmentLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'enrichment.yml'); }

  #read() {
    try {
      const raw = yaml.load(fsSync.readFileSync(this.#file(), 'utf8'));
      return Array.isArray(raw?.entries) ? raw.entries : [];
    } catch { return []; }
  }

  list({ learnerId = null } = {}) {
    const entries = this.#read();
    return learnerId ? entries.filter((e) => (e.learnerIds ?? []).includes(learnerId)) : entries;
  }

  async append(entry) {
    this.#writeChain = this.#writeChain.then(async () => {
      const entries = [...this.#read(), entry];
      await fs.mkdir(path.dirname(this.#file()), { recursive: true });
      await fs.writeFile(this.#file(), dumpYaml({ entries }), 'utf8');
      this.#logger.info?.('school.enrichment.recorded', { id: entry.id, recordedBy: entry.recordedBy });
    });
    await this.#writeChain;
    return entry;
  }
}

export default YamlEnrichmentLog;
