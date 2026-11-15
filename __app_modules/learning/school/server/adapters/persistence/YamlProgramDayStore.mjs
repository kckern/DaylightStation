import path from 'path';
import yaml from 'js-yaml';
import { IProgramDayStore } from '../../application/ports/IProgramDayStore.mjs';
import { fileExists, readFile, writeFileAtomic, saveYamlToPathAtomic, listFiles, readDirectoryAsync, readTextFromPathAsync } from '#system/utils/FileIO.mjs';


const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true };

export class YamlProgramDayStore extends IProgramDayStore {
  #rootDir; #corruptPolicy; #logPrefix; #logger; #clock; #strict; #validateEvents; #writeChain = Promise.resolve();

  constructor({ rootDir, strict = false, validateEvents = null, corruptPolicy = 'refuse', logPrefix = 'school.program', logger = {}, clock = () => new Date() } = {}) {
    super();
    if (!rootDir) throw new Error('Program store requires rootDir');
    this.#rootDir = rootDir; this.#corruptPolicy = corruptPolicy; this.#logPrefix = logPrefix;
    this.#strict = strict; this.#validateEvents = validateEvents;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dir(learnerId) { return path.join(this.#rootDir, learnerId); }
  #file(learnerId, day) { return path.join(this.#dir(learnerId), `${day}.yml`); }

  #check(learnerId, day) {
    if (!LEARNER_ID_RE.test(String(learnerId ?? ''))) throw new Error(`unsafe learnerId: ${learnerId}`);
    if (!STUDY_DAY_RE.test(String(day ?? '')) || !Number.isFinite(Date.parse(day + 'T12:00:00Z')) || new Date(day + 'T12:00:00Z').toISOString().slice(0,10) !== day) throw new Error(`bad studyDay: ${day}`);
  }

  async #load(learnerId, day) {
    const file = this.#file(learnerId, day);
    let text;
    if(this.#strict){
      try{text=await readTextFromPathAsync(file);}catch(error){return {status:error.code==='ENOENT'?'missing':'unreadable',events:[],file,text:null};}
    }else{
      if (!fileExists(file)) return { status: 'missing', events: [], file, text: null };
      text = readFile(file);
    }
    if (typeof text !== 'string') return { status: 'unreadable', events: [], file, text: null };
    if (!text.trim()) return { status: this.#strict?'corrupt':'missing', events: [], file, text, reason:'empty document' };
    try {
      const doc = yaml.load(text);
      if (!doc || !Array.isArray(doc.events)) return { status: 'corrupt', events: [], file, text, reason: 'no events[]' };
      if(this.#strict && (doc.learnerId!==learnerId || doc.studyDay!==day || !this.#validateEvents?.(doc.events,{learnerId,studyDay:day})))return {status:'corrupt',events:[],file,text,reason:'invalid identity or event chain'};
      return { status: 'ok', events: doc.events, file, text };
    } catch (err) {
      return { status: 'corrupt', events: [], file, text, reason: err.message };
    }
  }

  async read(learnerId, studyDay) {
    this.#check(learnerId, studyDay);
    const { status, events } = await this.#load(learnerId, studyDay);
    if (status === 'corrupt') this.#logger.warn?.(`${this.#logPrefix}.store.corrupt`, { learnerId, studyDay });
    return { status, events };
  }

  async append(learnerId, studyDay, event) {
    this.#check(learnerId, studyDay);
    // Read-modify-write: serialized so concurrent appends cannot lose an event.
    const queued = this.#writeChain.then(async () => {
      const loaded = await this.#load(learnerId, studyDay);
      if (loaded.status === 'unreadable') throw new Error(`debrief shard unreadable: ${learnerId}/${studyDay}`);
      if (loaded.status === 'corrupt') { this.#sideFile(learnerId, studyDay, loaded); if (this.#corruptPolicy === 'refuse') throw new Error('program shard corrupt'); }
      const events = [...(loaded.status === 'ok' ? loaded.events : []), event];
      if(this.#validateEvents && !this.#validateEvents(events,{learnerId,studyDay}))throw new Error('Invalid program evidence event chain');
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
    this.#logger.error?.(`${this.#logPrefix}.store.corrupt-side-filed`, { learnerId, studyDay, preservedAt: target, error: reason });
  }

  async listDays(learnerId, { from, to } = {}) {
    this.#check(learnerId, '2000-01-01');
    let names;
    if(this.#strict){try{names=await readDirectoryAsync(this.#dir(learnerId));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
    else names = listFiles(this.#dir(learnerId));
    return names
      .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.yml$/)?.[1])
      .filter(Boolean)
      .filter((d) => (!from || d >= from) && (!to || d <= to))
      .sort();
  }
}
export default YamlProgramDayStore;
