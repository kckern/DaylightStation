/**
 * YAML persistence for the parent review queue (spec §7.3).
 *
 *   <dataDir>/household/apps/school/review/{sessionId}.yml   (a list of review items)
 *
 * One file per session, so a queue read for a session that has just been
 * submitted costs one read, and a corrupt file isolates to the one piece of work
 * it describes. Dumb storage: what belongs in the queue and what a verdict means
 * are the submission use case's business.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { IReviewQueue } from '#apps/school/ports/IReviewQueue.mjs';

const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const YAML_FILE_RE = /\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeSessionId = (id) => typeof id === 'string' && SESSION_ID_RE.test(id);

export class YamlReviewQueue extends IReviewQueue {
  #configService;
  #writeChain = Promise.resolve();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlReviewQueue: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/review'); }

  #fileFor(sessionId) { return path.join(this.#root(), `${sessionId}.yml`); }

  async #read(sessionId) {
    try {
      const raw = yaml.load(await fs.readFile(this.#fileFor(sessionId), 'utf8'));
      return Array.isArray(raw) ? raw.filter((i) => i && typeof i === 'object' && !Array.isArray(i)) : [];
    } catch {
      return [];
    }
  }

  async #write(sessionId, items) {
    await fs.mkdir(this.#root(), { recursive: true });
    await fs.writeFile(this.#fileFor(sessionId), dumpYaml(items), 'utf8');
    return items;
  }

  #enqueueWrite(run) {
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async enqueue(items) {
    const incoming = (Array.isArray(items) ? items : []).filter(
      (i) => i && typeof i === 'object' && isSafeSessionId(i.sessionId) && typeof i.itemId === 'string' && i.itemId,
    );
    if (!incoming.length) return [];
    const sessionId = incoming[0].sessionId;
    if (incoming.some((i) => i.sessionId !== sessionId)) {
      throw new Error('YamlReviewQueue: enqueue takes items from one session at a time');
    }
    return this.#enqueueWrite(async () => {
      const existing = await this.#read(sessionId);
      const merged = [...existing];
      incoming.forEach((item) => {
        const at = merged.findIndex((e) => e.itemId === item.itemId);
        if (at === -1) { merged.push({ verdict: null, gradedBy: null, gradedAt: null, note: null, ...item }); return; }
        // A re-submission must not un-mark what a grown-up already marked.
        if (merged[at].verdict) return;
        merged[at] = { ...merged[at], ...item };
      });
      return this.#write(sessionId, merged);
    });
  }

  /** @inheritdoc */
  async listForSession(sessionId) {
    if (!isSafeSessionId(sessionId)) return [];
    return this.#read(sessionId);
  }

  /** @inheritdoc */
  async resolve({ sessionId, itemId, verdict, gradedBy = null, note = null, at } = {}) {
    if (!isSafeSessionId(sessionId)) return null;
    if (verdict !== 'correct' && verdict !== 'incorrect') {
      throw new Error(`YamlReviewQueue: verdict must be correct|incorrect, got: ${verdict}`);
    }
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      throw new Error('YamlReviewQueue: resolve requires an ISO-8601 `at`');
    }
    return this.#enqueueWrite(async () => {
      const items = await this.#read(sessionId);
      const index = items.findIndex((i) => i.itemId === itemId);
      if (index === -1) return null;
      // A note is what the parent wants the child to read. Re-marking WITHOUT
      // one keeps whatever was written before: changing a verdict is not a
      // reason to throw away the sentence explaining the first one.
      const written = typeof note === 'string' && note.trim() ? note.trim() : null;
      const resolved = {
        ...items[index], verdict, gradedBy, gradedAt: at,
        note: written ?? items[index].note ?? null,
      };
      items[index] = resolved;
      await this.#write(sessionId, items);
      return resolved;
    });
  }

  /** @inheritdoc */
  async listPending() {
    let names;
    try {
      names = await fs.readdir(this.#root());
    } catch {
      return [];
    }
    const ids = names
      .filter((n) => YAML_FILE_RE.test(n))
      .map((n) => n.replace(YAML_FILE_RE, ''))
      .filter(isSafeSessionId)
      .sort();
    const perSession = await Promise.all(ids.map((id) => this.#read(id)));
    return perSession.flat().filter((i) => !i.verdict);
  }
}

export default YamlReviewQueue;
