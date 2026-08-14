/**
 * YAML persistence for the parent review queue (spec §7.3).
 *
 *   <dataDir>/household/apps/school/review/{sessionId}.yml            (live — has unresolved items)
 *   <dataDir>/household/apps/school/review/{sessionId}.settled.yml    (every item resolved)
 *
 * One file per session, so a queue read for a session that has just been
 * submitted costs one read, and a corrupt file isolates to the one piece of work
 * it describes. Dumb storage: what belongs in the queue and what a verdict means
 * are the submission use case's business.
 *
 * A session's items live under EXACTLY ONE of the two names at a time.
 * `resolve` renames live -> settled the moment zero items remain unresolved,
 * so `listPending`'s household-wide scan never has to open a file that
 * cannot possibly contribute a pending row. `enqueue` renames settled -> live
 * when new, unresolved items land on an already-settled session (the scan
 * bridge can re-open one: a re-fed card can surface a fresh ambiguous row on
 * a session that was previously fully cleared). `listForSession` and
 * `resolve` both check live first, then settled, so neither cares which name
 * currently holds the data.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { IReviewQueue } from '#apps/school/ports/IReviewQueue.mjs';

const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const YAML_FILE_RE = /\.(yml|yaml)$/;
const SETTLED_FILE_RE = /\.settled\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeSessionId = (id) => typeof id === 'string' && SESSION_ID_RE.test(id);

export class YamlReviewQueue extends IReviewQueue {
  #configService;
  #logger;
  #writeChain = Promise.resolve();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlReviewQueue: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/review'); }

  #liveFile(sessionId) { return path.join(this.#root(), `${sessionId}.yml`); }

  #settledFile(sessionId) { return path.join(this.#root(), `${sessionId}.settled.yml`); }

  async #readFile(file) {
    // `null` means "no queue file here", which callers treat as nothing pending.
    // A corrupt file answering the same way would hide work waiting on a
    // grown-up, so absent stays quiet and unreadable is reported.
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        this.#logger.warn?.('school.review-queue.unreadable', { file, error: err?.message });
      }
      return null;
    }
    try {
      const raw = yaml.load(text);
      return Array.isArray(raw) ? raw.filter((i) => i && typeof i === 'object' && !Array.isArray(i)) : [];
    } catch (err) {
      this.#logger.warn?.('school.review-queue.corrupt', { file, error: err?.message });
      return null;
    }
  }

  /** Live file first, then settled — the caller never needs to know which name currently holds the session. */
  async #read(sessionId) {
    const live = await this.#readFile(this.#liveFile(sessionId));
    if (live !== null) return live;
    const settled = await this.#readFile(this.#settledFile(sessionId));
    return settled ?? [];
  }

  /**
   * Write `items` to whichever name matches their state (any unresolved
   * item -> live, all resolved -> settled), and remove the other name so a
   * session's data never lives under both at once.
   */
  async #write(sessionId, items) {
    await fs.mkdir(this.#root(), { recursive: true });
    const settled = items.length > 0 && items.every((i) => i.verdict);
    const target = settled ? this.#settledFile(sessionId) : this.#liveFile(sessionId);
    const stale = settled ? this.#liveFile(sessionId) : this.#settledFile(sessionId);
    await fs.writeFile(target, dumpYaml(items), 'utf8');
    try {
      await fs.unlink(stale);
    } catch {
      // Nothing under the other name — the common case.
    }
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

  /**
   * @inheritdoc
   *
   * A learner's own review files are not day-bucketed the way work sessions
   * are (`YamlWorkSessionDatastore`'s `{YYYY-MM-DD}/{sessionId}/` layout) —
   * this store is flat, one file per session, forever. So "windowed to the
   * last 60 days" is expressed against each FILE's own mtime rather than a
   * day-directory listing: a session's review file stops being written the
   * moment every item on it is resolved, so its mtime IS the date of the
   * last verdict recorded against it. A file untouched in the window is
   * skipped WITHOUT opening it — the whole point of bounding this scan, since
   * the review directory only ever grows across a household's lifetime.
   */
  async listForLearner(learnerId, { limit = 20, maxAgeDays = 60 } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) return [];
    let entries;
    try {
      entries = await fs.readdir(this.#root(), { withFileTypes: true });
    } catch {
      return [];
    }
    const sessionIds = new Set();
    entries.forEach((entry) => {
      if (!entry.isFile() || !YAML_FILE_RE.test(entry.name)) return;
      const sessionId = entry.name.replace(SETTLED_FILE_RE, '').replace(YAML_FILE_RE, '');
      if (isSafeSessionId(sessionId)) sessionIds.add(sessionId);
    });

    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const collected = [];
    await Promise.all([...sessionIds].map(async (sessionId) => {
      const mtimes = (await Promise.all([
        fs.stat(this.#liveFile(sessionId)).catch(() => null),
        fs.stat(this.#settledFile(sessionId)).catch(() => null),
      ])).filter(Boolean).map((s) => s.mtimeMs);
      // Neither name stat-able (raced with a delete) or genuinely stale:
      // nothing here can contribute a row within the window.
      if (mtimes.length && !mtimes.some((mtime) => mtime >= cutoffMs)) return;

      // `#read` already checks live-then-settled — the same "both names"
      // handling every other reader on this store gets for free.
      const items = await this.#read(sessionId);
      items
        .filter((item) => item && item.learnerId === learnerId
          && (item.verdict === 'correct' || item.verdict === 'incorrect'))
        .forEach((item) => collected.push(item));
    }));

    return collected
      .sort((a, b) => String(b.gradedAt ?? '').localeCompare(String(a.gradedAt ?? '')))
      .slice(0, limit);
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
      // A `.settled.yml` file has zero unresolved items by construction (see
      // `#write`) — skip it without opening it, so a household's backlog of
      // long-cleared sessions never costs a read here.
      .filter((n) => YAML_FILE_RE.test(n) && !SETTLED_FILE_RE.test(n))
      .map((n) => n.replace(YAML_FILE_RE, ''))
      .filter(isSafeSessionId)
      .sort();
    const perSession = await Promise.all(ids.map((id) => this.#readFile(this.#liveFile(id))));
    return perSession.flat().filter((i) => i && !i.verdict);
  }
}

export default YamlReviewQueue;
