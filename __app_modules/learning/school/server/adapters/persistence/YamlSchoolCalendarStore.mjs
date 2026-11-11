/**
 * YamlSchoolCalendarStore — the teacher console's write path into
 * `school.yml → calendar` and `school.yml → dayOffTiers`.
 *
 * `school.yml` is a hand-authored, heavily commented policy file, so this
 * store edits it as a `yaml` Document: only the `calendar` and `dayOffTiers`
 * nodes are replaced (each break as a one-line flow map); every other key and
 * comment is left as it was. Comments that lived INSIDE those two nodes are
 * lost on the first console save; the backup keeps them.
 *
 * Every write:
 *   1. re-reads the file and refuses (`STALE_SAVE`) when its revision — the
 *      sha256 of the text — is not the one the editor loaded, so a hand edit
 *      made since is never overwritten;
 *   2. copies the current text to `<backupDir>/school.yml.<stamp>` (never
 *      pruned: the data tree is never deleted from);
 *   3. writes atomically, then appends a history row.
 */
import crypto from 'node:crypto';
import path from 'path';
import YAML from 'yaml';
import { readTextFromPath, writeFileAtomic, fileExists } from '#system/utils/FileIO.mjs';

export const revisionOf = (text) => crypto.createHash('sha256').update(String(text ?? '')).digest('hex');

const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** One top-level key rendered alone; breaks become one-line flow maps. */
function renderFragment(key, value) {
  const doc = new YAML.Document({ [key]: value });
  const block = doc.get(key, true);
  for (const listKey of ['except', 'also']) {
    block?.get?.(listKey, true)?.items?.forEach((item) => { item.flow = true; });
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Replace (or add, or remove) ONE top-level key by splicing its byte range,
 * so nothing outside that node is re-rendered: every other line of a
 * hand-authored file, its spacing and its comments, stays byte-identical.
 */
export function spliceTopLevel(text, key, value) {
  const doc = YAML.parseDocument(text);
  const pair = doc.contents?.items?.find((item) => item.key?.value === key) ?? null;
  const fragment = value == null ? '' : renderFragment(key, value);
  if (!pair) {
    if (value == null) return text;
    const body = text.replace(/\n*$/, '');
    return `${body}${body ? '\n\n' : ''}${fragment}`;
  }
  const start = pair.key.range[0];
  const end = pair.value?.range?.[1] ?? pair.key.range[1];
  const tail = text.slice(end).replace(/^[^\n]*/, (rest) => (rest.trim().startsWith('#') ? rest : ''));
  if (value == null) return text.slice(0, start) + tail.replace(/^\n/, '');
  return text.slice(0, start) + fragment.replace(/\n$/, '') + tail;
}

export class YamlSchoolCalendarStore {
  #filePath; #backupDir; #historyPath; #clock; #writeChain = Promise.resolve();

  constructor({ filePath, backupDir, historyPath, clock = () => new Date() } = {}) {
    if (!filePath || !backupDir || !historyPath) {
      throw new Error('YamlSchoolCalendarStore requires filePath, backupDir and historyPath');
    }
    this.#filePath = filePath;
    this.#backupDir = backupDir;
    this.#historyPath = historyPath;
    this.#clock = clock;
  }

  /** @returns {{text: string, revision: string, config: object}} */
  read() {
    const text = fileExists(this.#filePath) ? readTextFromPath(this.#filePath) : '';
    const config = YAML.parse(text) ?? {};
    return { text, revision: revisionOf(text), config };
  }

  /**
   * @param {{calendar: object|null, dayOffTiers: object|null, baseRevision: string,
   *   editedBy: string|null, summary?: object}} args
   * @returns {Promise<{revision: string, at: string}>}
   */
  write({ calendar, dayOffTiers, baseRevision, editedBy = null, summary = {} }) {
    const queued = this.#writeChain.then(() => {
      const { text, revision } = this.read();
      if (revision !== baseRevision) {
        // A plain coded error: the use case owns the semantic (409) mapping.
        throw Object.assign(new Error('school.yml changed since it was loaded'), { code: 'STALE_SAVE' });
      }
      const next = spliceTopLevel(spliceTopLevel(text, 'calendar', calendar), 'dayOffTiers', dayOffTiers);

      const at = this.#clock().toISOString();
      writeFileAtomic(path.join(this.#backupDir, `${path.basename(this.#filePath)}.${stampOf(at)}`), text);
      writeFileAtomic(this.#filePath, next);
      const history = this.#historyStrict();
      history.push({ at, editedBy, ...summary });
      writeFileAtomic(this.#historyPath, YAML.stringify({ history }));
      return { revision: revisionOf(next), at };
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  // A corrupt history file must never be silently replaced by a one-row one.
  #historyStrict() {
    if (!fileExists(this.#historyPath)) return [];
    const raw = YAML.parse(readTextFromPath(this.#historyPath));
    if (raw != null && !Array.isArray(raw?.history)) throw new Error(`calendar history ${this.#historyPath} cannot be read — refusing to overwrite it`);
    return raw?.history ?? [];
  }

  /** History rows, oldest first; an unreadable file reads as empty. */
  history() {
    try {
      const raw = fileExists(this.#historyPath) ? YAML.parse(readTextFromPath(this.#historyPath)) : null;
      return Array.isArray(raw?.history) ? raw.history : [];
    } catch {
      return [];
    }
  }
}

export default YamlSchoolCalendarStore;
