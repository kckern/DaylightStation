/**
 * YamlSchoolCalendarStore — the teacher console's write path into
 * `school.yml → calendar` and `school.yml → dayOffTiers`.
 *
 * `school.yml` is a hand-authored, heavily commented policy file read at boot
 * by js-yaml (YAML 1.1). So this store:
 *   - replaces ONLY the lines of those two top-level nodes (a node runs from
 *     its key line to the next line that starts at column 0 — a key or a
 *     comment, which belongs to what follows it); every other line stays
 *     byte-identical. Comments inside the two nodes are lost on the first
 *     console save; the backup keeps them;
 *   - renders every string double-quoted, so a date is never read back as a
 *     YAML 1.1 timestamp;
 *   - re-parses the result with js-yaml before writing and refuses
 *     (`ROUNDTRIP_FAILED`) unless the two nodes read back exactly as intended
 *     and every other top-level key reads back unchanged.
 *
 * Every write also re-reads the file and refuses (`STALE_SAVE`) when its
 * revision — the sha256 of the text — is not the one the editor loaded, so a
 * hand edit made since is never overwritten; copies the current text to
 * `<backupDir>/school.yml.<stamp>` (never pruned: the data tree is never
 * deleted from); writes atomically; then appends a history row.
 */
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'path';
import jsyaml from 'js-yaml';
import { readTextFromPath, writeFileAtomic, fileExists } from '#system/utils/FileIO.mjs';

export const revisionOf = (text) => crypto.createHash('sha256').update(String(text ?? '')).digest('hex');

const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const coded = (message, code) => Object.assign(new Error(message), { code });

// --- rendering ---------------------------------------------------------------
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const scalar = (value) => {
  if (typeof value === 'string') return JSON.stringify(value); // valid YAML double-quoted
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  throw new Error(`cannot render ${typeof value}`);
};
const keyOf = (key) => (PLAIN_KEY.test(key) ? key : JSON.stringify(key));
const flowMap = (obj) => `{ ${Object.entries(obj).map(([k, v]) => `${keyOf(k)}: ${scalar(v)}`).join(', ')} }`;

function renderBlock(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}[]`];
    return value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) return `${pad}- ${flowMap(item)}`;
      return `${pad}- ${scalar(item)}`;
    });
  }
  return Object.entries(value).flatMap(([k, v]) => {
    if (v && typeof v === 'object') {
      if (Array.isArray(v) && !v.length) return [`${pad}${keyOf(k)}: []`];
      return [`${pad}${keyOf(k)}:`, ...renderBlock(v, indent + 2)];
    }
    return [`${pad}${keyOf(k)}: ${scalar(v)}`];
  });
}

/** One top-level key as YAML lines (no trailing newline). */
export function renderTopLevel(key, value) {
  if (value && typeof value === 'object') return [`${key}:`, ...renderBlock(value, 2)].join('\n');
  return `${key}: ${scalar(value)}`;
}

/**
 * Replace (or add, or remove) ONE top-level key by lines. The node is its key
 * line plus every following line that is blank or indented, up to the next
 * column-0 line; trailing blank lines stay outside it, so the separation
 * before the next block is kept.
 */
export function spliceTopLevel(text, key, value) {
  const lines = String(text ?? '').split('\n');
  const keyLine = new RegExp(`^${key.replace(/[-]/g, '\\-')}:(\\s|$)`);
  const start = lines.findIndex((line) => keyLine.test(line));
  const fragment = value == null ? null : renderTopLevel(key, value);
  if (start === -1) {
    if (fragment == null) return text;
    const body = String(text ?? '').replace(/\n*$/, '');
    return `${body}${body ? '\n\n' : ''}${fragment}\n`;
  }
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1;
  while (end - 1 > start && lines[end - 1] === '') end -= 1;
  const replacement = fragment == null ? [] : fragment.split('\n');
  let before = lines.slice(0, start);
  const after = lines.slice(end);
  if (fragment == null) {
    // Removing a node: drop one now-doubled blank line between its neighbours.
    while (before.length && before[before.length - 1] === '' && after[0] === '') before = before.slice(0, -1);
  }
  return [...before, ...replacement, ...after].join('\n');
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
    // Parsed as BOOT parses it (js-yaml), so the editor sees what the app sees.
    const config = jsyaml.load(text) ?? {};
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
      let before;
      try { before = jsyaml.load(text) ?? {}; } catch (error) {
        throw coded(`school.yml does not parse: ${error.message}`, 'ROUNDTRIP_FAILED');
      }
      // A node that reads back unchanged is left as written, comments and all.
      let next = text;
      if (!isDeepStrictEqual(before.calendar, calendar ?? undefined)) next = spliceTopLevel(next, 'calendar', calendar);
      if (!isDeepStrictEqual(before.dayOffTiers, dayOffTiers ?? undefined)) next = spliceTopLevel(next, 'dayOffTiers', dayOffTiers);
      // Read the result back the way BOOT will, before anything is written.
      let after;
      try { after = jsyaml.load(next) ?? {}; } catch (error) {
        throw coded(`the edited school.yml would not parse: ${error.message}`, 'ROUNDTRIP_FAILED');
      }
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) {
        const intended = key === 'calendar' ? (calendar ?? undefined)
          : key === 'dayOffTiers' ? (dayOffTiers ?? undefined) : before[key];
        if (!isDeepStrictEqual(after[key], intended)) {
          throw coded(`the edited school.yml would read back differently at '${key}'`, 'ROUNDTRIP_FAILED');
        }
      }

      const at = this.#clock().toISOString();
      writeFileAtomic(path.join(this.#backupDir, `${path.basename(this.#filePath)}.${stampOf(at)}`), text);
      writeFileAtomic(this.#filePath, next);
      const history = this.#historyStrict();
      history.push({ at, editedBy, ...summary });
      writeFileAtomic(this.#historyPath, jsyaml.dump({ history }, { lineWidth: -1, noRefs: true }));
      return { revision: revisionOf(next), at };
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  // A corrupt history file must never be silently replaced by a one-row one.
  #historyStrict() {
    if (!fileExists(this.#historyPath)) return [];
    const raw = jsyaml.load(readTextFromPath(this.#historyPath));
    if (raw != null && !Array.isArray(raw?.history)) throw new Error(`calendar history ${this.#historyPath} cannot be read — refusing to overwrite it`);
    return raw?.history ?? [];
  }

  /** History rows, oldest first; an unreadable file reads as empty. */
  history() {
    try {
      const raw = fileExists(this.#historyPath) ? jsyaml.load(readTextFromPath(this.#historyPath)) : null;
      return Array.isArray(raw?.history) ? raw.history : [];
    } catch {
      return [];
    }
  }
}

export default YamlSchoolCalendarStore;
