import path from 'path';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const MAX_EVENTS = 200;

/**
 * Persists notification governance state in a single household file:
 *   { cooldowns: { "<username>|<dedupeKey>": <lastSentMs> }, events: [ ...bounded log ] }
 * The cooldown map drives dedupe; the events log feeds the Admin "recent activity" view.
 */
export class YamlNotificationLedgerStore {
  #basePath;
  constructor({ basePath }) { this.#basePath = basePath; }

  #file() { return path.join(this.#basePath, 'notification-ledger.yml'); }
  #key(username, dedupeKey) { return `${username || '-'}|${dedupeKey}`; }

  #load() {
    const d = loadYamlSafe(this.#file());
    return {
      cooldowns: (d && typeof d.cooldowns === 'object' && d.cooldowns) || {},
      events: (d && Array.isArray(d.events) && d.events) || [],
    };
  }
  #save(d) {
    if (d.events.length > MAX_EVENTS) d.events = d.events.slice(-MAX_EVENTS);
    saveYaml(this.#file(), d);
  }

  getLastSent(username, dedupeKey) {
    const v = this.#load().cooldowns[this.#key(username, dedupeKey)];
    return typeof v === 'number' ? v : null;
  }

  recordSent({ username, dedupeKey, category, atMs }) {
    const d = this.#load();
    d.cooldowns[this.#key(username, dedupeKey)] = atMs;
    d.events.push({ at: atMs, username: username || null, category, dedupeKey, delivered: true, suppressed: false, reason: 'ok' });
    this.#save(d);
  }

  recordSuppressed({ username, dedupeKey, category, reason, atMs }) {
    const d = this.#load();
    d.events.push({ at: atMs, username: username || null, category, dedupeKey, delivered: false, suppressed: true, reason });
    this.#save(d);
  }

  recentEvents(limit = 50) {
    const events = this.#load().events;
    return events.slice(-limit).reverse();
  }
}
