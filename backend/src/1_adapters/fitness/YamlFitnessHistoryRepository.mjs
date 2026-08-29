import path from 'node:path';
import { IFitnessHistoryRepository } from '#apps/fitness/ports/IFitnessHistoryRepository.mjs';
import { deleteFile, dirExists, ensureDir, listYamlFiles, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const ID = /^\d{14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function decodeSeries(series = {}) {
  const decoded = {};
  for (const [key, stored] of Object.entries(series || {})) {
    let entries = stored;
    if (typeof stored === 'string') {
      try { entries = JSON.parse(stored); } catch { continue; }
    }
    if (!Array.isArray(entries)) continue;
    const values = [];
    for (const entry of entries) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const count = Number.isFinite(entry[1]) && entry[1] > 0 ? entry[1] : 0;
        for (let i = 0; i < count; i++) values.push(entry[0] === undefined ? null : entry[0]);
      } else values.push(entry === undefined ? null : entry);
    }
    if (values.length && !values.every(value => value == null)) decoded[key] = values;
  }
  return decoded;
}

function encodeSeries(series = {}) {
  const encoded = {};
  for (const [key, values] of Object.entries(series || {})) {
    if (typeof values === 'string' && values.startsWith('[')) { encoded[key] = values; continue; }
    if (!Array.isArray(values) || !values.length || values.every(value => value == null)) continue;
    const entries = [];
    for (let i = 0; i < values.length;) {
      let count = 1;
      while (i + count < values.length && values[i + count] === values[i]) count++;
      entries.push(count === 1 ? values[i] : [values[i], count]);
      i += count;
    }
    encoded[key] = JSON.stringify(entries);
  }
  return encoded;
}

export function hydrateFitnessSessionRecord(data) {
  if (!data?.timeline) return data;
  return { ...data, timeline: { ...data.timeline, series: decodeSeries(data.timeline.series) } };
}

export function dehydrateFitnessSessionRecord(data) {
  if (!data?.timeline) return data;
  return { ...data, timeline: { ...data.timeline, series: encodeSeries(data.timeline.series) } };
}
export class YamlFitnessHistoryRepository extends IFitnessHistoryRepository {
  #root;
  constructor({ root }) { super(); this.#root = root; }
  isAvailable() { return dirExists(this.#root); }
  list(date) {
    if (!DATE.test(date)) return [];
    const directory = path.join(this.#root, date);
    if (!dirExists(directory)) return [];
    return listYamlFiles(directory).map(id => ({ id, data: hydrateFitnessSessionRecord(loadYamlSafe(path.join(directory, id))) })).filter(r => r.data);
  }
  find(sessionId) {
    if (!ID.test(sessionId)) return null;
    const date = `${sessionId.slice(0,4)}-${sessionId.slice(4,6)}-${sessionId.slice(6,8)}`;
    const data = loadYamlSafe(path.join(this.#root, date, sessionId));
    return data ? { id: sessionId, data: hydrateFitnessSessionRecord(data) } : null;
  }
  save(sessionId, session) {
    if (!ID.test(sessionId)) throw new Error('invalid fitness session id');
    const date = `${sessionId.slice(0,4)}-${sessionId.slice(4,6)}-${sessionId.slice(6,8)}`;
    ensureDir(path.join(this.#root, date));
    const locator = path.join(this.#root, date, `${sessionId}.yml`);
    saveYaml(locator, dehydrateFitnessSessionRecord(session));
    return { locator };
  }
  remove(sessionId) {
    if (!ID.test(sessionId)) return false;
    const date = `${sessionId.slice(0,4)}-${sessionId.slice(4,6)}-${sessionId.slice(6,8)}`;
    return deleteFile(path.join(this.#root, date, `${sessionId}.yml`));
  }
}
