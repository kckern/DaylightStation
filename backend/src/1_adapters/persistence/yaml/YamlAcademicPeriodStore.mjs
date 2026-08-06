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

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}


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
  }).map((period, _i, all) => {
    // Runtime-writable now (the editor makes periodId free text), so a
    // dangling parent is a real hazard the boot path never had to face.
    if (period.parentPeriodId && !all.some((p) => p.periodId === period.parentPeriodId)) {
      throw new Error(`period '${period.periodId}' names missing parent '${period.parentPeriodId}'`);
    }
    // Same-KIND overlap refusal (admin advocacy #15): two semesters sharing
    // an instant makes narrowest-wins a coin flip and double-counts the
    // boundary. Different kinds nest by design (a semester inside a year).
    for (const other of all) {
      if (other === period || other.kind !== period.kind) continue;
      if (period.startsAt < other.endsAt && other.startsAt < period.endsAt) {
        throw new Error(`period '${period.periodId}' overlaps '${other.periodId}' (both kind '${period.kind}')`);
      }
    }
    return period;
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

  /**
   * Missing and corrupt are DIFFERENT answers (M3 review): a missing file is
   * the pre-promotion normal (serve the fallback); an existing-but-unreadable
   * file must never silently revert the calendar to the config era, and must
   * refuse writes so history cannot be rebuilt from null over real data.
   */
  #readState() {
    let text;
    try {
      text = fsSync.readFileSync(this.#file(), 'utf8');
    } catch { return { state: 'missing' }; }
    try {
      const raw = yaml.load(text);
      if (raw && typeof raw === 'object' && Array.isArray(raw.periods)) return { state: 'ok', raw };
      return { state: 'corrupt' };
    } catch { return { state: 'corrupt' }; }
  }

  listPeriods() {
    const read = this.#readState();
    if (read.state === 'ok') return structuredClone(read.raw.periods);
    if (read.state === 'corrupt') {
      this.#logger.error?.('school.periods.file-corrupt', { file: this.#file() });
      return this.#fallback?.listPeriods?.() ?? [];
    }
    return this.#fallback?.listPeriods?.() ?? [];
  }

  historyLength() {
    const read = this.#readState();
    return read.state === 'ok' ? (read.raw.history ?? []).length : 0;
  }

  getPeriod(periodId) {
    return structuredClone(this.listPeriods().find((p) => p.periodId === periodId) ?? null);
  }

  async replacePeriods(periods, { editedBy = null, at = new Date().toISOString() } = {}) {
    const validated = validatePeriodList(periods);
    this.#writeChain = this.#writeChain.then(async () => {
      const read = this.#readState();
      if (read.state === 'corrupt') {
        throw new Error(`periods.yml exists but cannot be read — fix or move it before editing (${this.#file()})`);
      }
      const history = [...(read.raw?.history ?? []), { at, editedBy, periods: validated }];
      await atomicWrite(this.#file(), dumpYaml({ periods: validated, history }));
      this.#logger.info?.('school.periods.replaced', { editedBy, count: validated.length });
    });
    await this.#writeChain;
    return validated;
  }
}

export default YamlAcademicPeriodStore;
