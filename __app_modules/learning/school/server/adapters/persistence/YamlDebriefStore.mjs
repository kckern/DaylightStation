/**
 * YAML persistence for the School debrief event log.
 *
 *   <household>/school/records/debriefs/{learnerId}/{studyDay}.yml
 *   document: { learnerId, studyDay, events: [...] }
 *
 * Append-only per study day. Missing and corrupt are kept apart on the write
 * path: a corrupt shard is copied aside to `<studyDay>.yml.corrupt-<stamp>`
 * before a fresh shard starts, and an unreadable shard THROWS rather than being
 * overwritten. read() never throws for missing or corrupt.
 *
 * All I/O goes through `#system/utils/FileIO.mjs`; writes are serialized per store.
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFileAtomic, saveYamlToPathAtomic, listFiles } from '#system/utils/FileIO.mjs';
import { IDebriefStore } from "../../application/ports/IDebriefStore.mjs";

const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true };

export class YamlDebriefStore extends IDebriefStore {
  #configService; #logger; #clock; #writeChain = Promise.resolve();

  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    super();
    if (typeof configService?.getHouseholdPath !== 'function') throw new Error('YamlDebriefStore requires configService.getHouseholdPath');
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dir(learnerId) { return path.join(this.#configService.getHouseholdPath('school/records/debriefs'), learnerId); }
  #file(learnerId, day) { return path.join(this.#dir(learnerId), `${day}.yml`); }

  #check(learnerId, day) {
    if (!LEARNER_ID_RE.test(String(learnerId ?? ''))) throw new Error(`unsafe learnerId: ${learnerId}`);
    if (!STUDY_DAY_RE.test(String(day ?? ''))) throw new Error(`bad studyDay: ${day}`);
  }

  #load(learnerId, day) {
    const file = this.#file(learnerId, day);
    if (!fileExists(file)) return { status: 'missing', events: [], file, text: null };
    const text = readFile(file);
    if (typeof text !== 'string') return { status: 'unreadable', events: [], file, text: null };
    if (!text.trim()) return { status: 'missing', events: [], file, text };
    try {
      const doc = yaml.load(text);
      if (!doc || !Array.isArray(doc.events)) return { status: 'corrupt', events: [], file, text, reason: 'no events[]' };
      return { status: 'ok', events: doc.events, file, text };
    } catch (err) {
      return { status: 'corrupt', events: [], file, text, reason: err.message };
    }
  }

  async read(learnerId, studyDay) {
    this.#check(learnerId, studyDay);
    const { status, events } = this.#load(learnerId, studyDay);
    if (status === 'corrupt') this.#logger.warn?.('school.debrief.store.corrupt', { learnerId, studyDay });
    return { status, events };
  }

  async append(learnerId, studyDay, event) {
    this.#check(learnerId, studyDay);
    // Read-modify-write: serialized so concurrent appends cannot lose an event.
    const queued = this.#writeChain.then(async () => {
      const loaded = this.#load(learnerId, studyDay);
      if (loaded.status === 'unreadable') throw new Error(`debrief shard unreadable: ${learnerId}/${studyDay}`);
      if (loaded.status === 'corrupt') this.#sideFile(learnerId, studyDay, loaded);
      const events = [...(loaded.status === 'ok' ? loaded.events : []), event];
      saveYamlToPathAtomic(loaded.file, { learnerId, studyDay, events }, DUMP_OPTIONS);
      return events;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  #sideFile(learnerId, studyDay, { file, text, reason }) {
    const stamp = this.#clock().toISOString().replace(/[:.]/g, '-');
    let target = `${file}.corrupt-${stamp}`;
    for (let n = 2; fileExists(target); n += 1) target = `${file}.corrupt-${stamp}-${n}`;
    writeFileAtomic(target, text);
    this.#logger.error?.('school.debrief.store.corrupt-side-filed', { learnerId, studyDay, preservedAt: target, error: reason });
  }

  async listDays(learnerId, { from, to } = {}) {
    this.#check(learnerId, '2000-01-01');
    const names = listFiles(this.#dir(learnerId)); // [] for a missing dir
    return names
      .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.yml$/)?.[1])
      .filter(Boolean)
      .filter((d) => (!from || d >= from) && (!to || d <= to))
      .sort();
  }
}
export default YamlDebriefStore;
