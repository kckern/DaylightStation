/**
 * YamlAcademicPeriodStore — the periods config→data promotion (teacher-console
 * plan W3-1): `<dataDir>/household/apps/school/periods.yml` holding
 * `{periods, history}`. Until the FIRST successful write the store serves the
 * injected fallback (the boot-validated `ConfiguredAcademicPeriodSource`)
 * verbatim — no silent migration; a household that never edits keeps its
 * config-era calendar untouched. Reads are sync (the consumers — GET /periods,
 * GetReportCard's period resolution — are sync over a tiny file).
 */
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { validateAcademicPeriod } from '#domains/school/progress/learningProgress.mjs';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

export function validatePeriodList(raw) {
  if (!Array.isArray(raw)) throw new Error('periods must be an array');
  const seen = new Set();
  return raw.map((entry, index) => {
    const candidate = { schema: 'school.academic-period/v1', ...entry };
    const result = validateAcademicPeriod(candidate, { path: `periods[${index}]` });
    if (result.errors.length) throw new Error(result.errors.join('; '));
    if (seen.has(result.period.periodId)) throw new Error(`periods[${index}]: duplicate periodId '${result.period.periodId}'`);
    seen.add(result.period.periodId);
    return result.period;
  });
}

export class YamlAcademicPeriodStore {
  #configService; #fallback; #logger; #writeChain = Promise.resolve();

  constructor({ configService, fallback = null, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlAcademicPeriodStore requires configService');
    this.#configService = configService;
    this.#fallback = fallback;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'periods.yml'); }

  #readFile() {
    try {
      const raw = yaml.load(fsSync.readFileSync(this.#file(), 'utf8'));
      return raw && typeof raw === 'object' && Array.isArray(raw.periods) ? raw : null;
    } catch { return null; }
  }

  listPeriods() {
    const stored = this.#readFile();
    if (stored) return structuredClone(stored.periods);
    return this.#fallback?.listPeriods?.() ?? [];
  }

  getPeriod(periodId) {
    return structuredClone(this.listPeriods().find((p) => p.periodId === periodId) ?? null);
  }

  async replacePeriods(periods, { editedBy = null, at = new Date().toISOString() } = {}) {
    const validated = validatePeriodList(periods);
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#readFile();
      const history = [...(current?.history ?? []), { at, editedBy, periods: validated }];
      await fs.mkdir(path.dirname(this.#file()), { recursive: true });
      await fs.writeFile(this.#file(), dumpYaml({ periods: validated, history }), 'utf8');
      this.#logger.info?.('school.periods.replaced', { editedBy, count: validated.length });
    });
    await this.#writeChain;
    return validated;
  }
}

export default YamlAcademicPeriodStore;
