/**
 * Append-only per-device day log: `<root>/<deviceId>/<YYYY-MM-DD>.yml`.
 *
 * WHY THIS EXISTS. Five hardware relays — omr, food scale, barcade, pressure
 * mat, automotive — each carried a private `appendRecord()` that was the same
 * twenty lines: mkdir, read the day file, parse a YAML list, push, dump it
 * back. Five copies of a read-modify-write, and five reasons for
 * `3_applications` to import `fs`, which Decision D5 bans outright ("Data
 * operations go through datastore ports").
 *
 * The relays keep what is genuinely theirs — which topic to listen on, what a
 * record looks like, how to dedupe — and hand the record here.
 *
 * BUCKETED BY LOCAL DAY, not UTC. The day comes from the record's own local
 * `ts` prefix so an evening-local reading does not spill into the next UTC
 * day's file; only if a record somehow lacks a parseable `ts` does it fall
 * back to today in the household's zone. That rule was already duplicated
 * across all five relays and is preserved exactly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { getDateInTimezone } from '#domains/core/utils/time.mjs';

const DAY_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;
/** Device ids reach the filesystem, so keep them to a safe alphabet. */
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

export class YamlDayLogDatastore {
  #root; #timezone; #logger; #eventPrefix;

  /**
   * @param {object}  deps
   * @param {string}  deps.root        absolute history root, resolved by the composition root
   * @param {string}  deps.timezone    household zone, for the no-ts fallback only
   * @param {string} [deps.eventPrefix] log-event namespace, e.g. 'omr'
   * @param {object} [deps.logger]
   */
  constructor({ root, timezone, eventPrefix = 'day-log', logger = console } = {}) {
    if (!root) throw new Error('YamlDayLogDatastore requires root');
    this.#root = root;
    this.#timezone = timezone;
    this.#eventPrefix = eventPrefix;
    this.#logger = logger;
  }

  /** The local day a record belongs to. */
  #dayFor(record) {
    return (typeof record?.ts === 'string' && DAY_PREFIX_RE.test(record.ts))
      ? record.ts.slice(0, 10)
      : getDateInTimezone(new Date(), this.#timezone);
  }

  /** Absolute path of the file a record lands in — exposed for logging and tests. */
  fileFor(deviceId, record) {
    return path.join(this.#root, sanitize(deviceId), `${this.#dayFor(record)}.yml`);
  }

  /**
   * Append one record. A missing file is the normal first-write case; anything
   * else that stops the read is warned about and treated as an empty list
   * rather than losing the write.
   */
  async append(deviceId, record) {
    const file = this.fileFor(deviceId, record);
    await fs.mkdir(path.dirname(file), { recursive: true });

    let list = [];
    try {
      const existing = yaml.load(await fs.readFile(file, 'utf8'));
      if (Array.isArray(existing)) list = existing;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.#logger.warn?.(`${this.#eventPrefix}.persist.read_failed`, { file, error: err.message });
      }
    }

    list.push(record);
    await fs.writeFile(file, yaml.dump(list, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
    return file;
  }

  /**
   * Append keyed by an explicit epoch instead of the record's own `ts`.
   *
   * The automotive relay files a drive under the day it was actually driven,
   * which is not always the day the record was assembled, and it omits the
   * device id from the stored row because the directory already carries it.
   */
  async appendAt(deviceId, atEpoch, record, { omitKeys = [] } = {}) {
    const day = getDateInTimezone(new Date(atEpoch), this.#timezone);
    const file = path.join(this.#root, sanitize(deviceId), `${day}.yml`);
    await fs.mkdir(path.dirname(file), { recursive: true });

    let list = [];
    try {
      const existing = yaml.load(await fs.readFile(file, 'utf8'));
      if (Array.isArray(existing)) list = existing;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.#logger.warn?.(`${this.#eventPrefix}.persist.read_failed`, { file, error: err.message });
      }
    }

    const row = { ...record };
    for (const k of omitKeys) delete row[k];
    list.push(row);
    await fs.writeFile(file, yaml.dump(list, { noRefs: true, lineWidth: -1 }), 'utf8');
    return file;
  }

  /**
   * Write one already-serialised document beneath a device, at a caller-chosen
   * relative path (`trips/2026-08/<id>.yml`). The caller owns the shape and the
   * dump; this owns only where it lands and that the directory exists.
   */
  async writeDocument(deviceId, relPath, contents) {
    const file = path.join(this.#root, sanitize(deviceId), relPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents, 'utf8');
    return relPath;
  }

  /** True when a durable document already exists (used for retry-safe ACKs). */
  async documentExists(deviceId, relPath) {
    const file = path.join(this.#root, sanitize(deviceId), relPath);
    try {
      await fs.access(file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }
}

export default YamlDayLogDatastore;
