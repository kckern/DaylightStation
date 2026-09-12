/**
 * YAML persistence for play sessions.
 *
 * Layout under the household `gaming/play-sessions/` tree:
 *   current/{deviceId}.yml     — the latest session for a device (open or ended)
 *   history/{YYYY-MM-DD}.yml   — append-only list of ended sessions
 *
 * `current/` holds one file per device so "what is this device playing?" is a
 * single read. Nothing is ever deleted: an ended session stays in `current/` as
 * the device's last-known state, which is what startup reconciliation reads to
 * decide whether an overlay was left armed. `findOpenForDevice` simply declines
 * to return a session that has ended.
 *
 * History is append-only because played time is money and an overwritten record
 * is an unauditable one. Re-saving the same session replaces its own row rather
 * than appending a second, so a retried write cannot double-bill.
 *
 * Dumb storage: no time arithmetic, no policy. The domain owns both.
 */
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir, listEntries } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IPlaySessionRepository } from '#apps/gaming/ports/IPlaySessionRepository.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';

export class YamlPlaySessionDatastore extends IPlaySessionRepository {
  #configService; #logger;

  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService) {
      throw new InfrastructureError('YamlPlaySessionDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = configService;
    this.#logger = logger;
  }

  #root(householdId) { return this.#configService.getHouseholdPath('gaming/play-sessions', householdId); }
  #currentPath(deviceId, householdId) { return path.join(this.#root(householdId), 'current', String(deviceId)); }
  #historyPath(isoDate, householdId) { return path.join(this.#root(householdId), 'history', String(isoDate).slice(0, 10)); }

  async save(session, { householdId = null } = {}) {
    const snapshot = session.toSnapshot();
    const currentFile = this.#currentPath(snapshot.deviceId, householdId);
    ensureDir(path.dirname(currentFile));
    saveYaml(currentFile, snapshot, { noRefs: true });

    if (session.isEnded()) {
      const day = (snapshot.endedAt || new Date().toISOString()).slice(0, 10);
      const historyFile = this.#historyPath(day, householdId);
      ensureDir(path.dirname(historyFile));
      const list = loadYamlSafe(historyFile) || [];
      const existing = list.findIndex((row) => row?.id === snapshot.id);
      if (existing >= 0) list[existing] = snapshot; else list.push(snapshot);
      saveYaml(historyFile, list, { noRefs: true });
    }
    return session;
  }

  async findOpenForDevice(deviceId, { householdId = null } = {}) {
    const session = await this.findCurrentForDevice(deviceId, { householdId });
    return session && !session.isEnded() ? session : null;
  }

  /** Latest session for a device, open or ended. Input to reconciliation. */
  async findCurrentForDevice(deviceId, { householdId = null } = {}) {
    const snapshot = loadYamlSafe(this.#currentPath(deviceId, householdId));
    if (!snapshot || typeof snapshot !== 'object') return null;
    try {
      return PlaySession.fromSnapshot(snapshot);
    } catch (error) {
      // A corrupt file must not wedge every future session on this device.
      this.#logger.warn?.('play.session.current_unreadable', { deviceId, error: error.message });
      return null;
    }
  }

  async findById(sessionId, { householdId = null, on = null } = {}) {
    const day = (on || new Date().toISOString()).slice(0, 10);
    const list = loadYamlSafe(this.#historyPath(day, householdId)) || [];
    const row = list.find((entry) => entry?.id === sessionId);
    return row ? PlaySession.fromSnapshot(row) : null;
  }

  /**
   * Sessions on a device that started at or after `sinceIso`, ended ones from
   * the dated history plus the current one if it qualifies. Walks only the day
   * files the window actually spans.
   */
  async listForDeviceSince(deviceId, sinceIso, { householdId = null } = {}) {
    const since = Date.parse(sinceIso);
    if (!Number.isFinite(since)) return [];
    const out = [];
    const seen = new Set();

    const day = 24 * 60 * 60 * 1000;
    for (let t = since; t <= Date.now() + day; t += day) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const rows = loadYamlSafe(this.#historyPath(iso, householdId)) || [];
      for (const row of rows) {
        if (row?.deviceId !== deviceId || seen.has(row?.id)) continue;
        if (Date.parse(row.startedAt || row.endedAt || 0) < since) continue;
        seen.add(row.id);
        try { out.push(PlaySession.fromSnapshot(row)); } catch { /* skip unreadable row */ }
      }
    }

    const current = await this.findCurrentForDevice(deviceId, { householdId });
    if (current && !seen.has(current.id) && Date.parse(current.startedAt || 0) >= since) out.push(current);

    return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  }

  /**
   * Every recorded session in a window, across all devices — the usage ledger.
   *
   * Reads only the day files the window spans, so a month-wide question costs
   * thirty small reads rather than a scan. Sessions still open are included:
   * "what happened today" that silently omits the game running right now would
   * be a strange kind of record.
   */
  async listSince(sinceIso, untilIso = null, { householdId = null } = {}) {
    const since = Date.parse(sinceIso);
    if (!Number.isFinite(since)) return [];
    const until = Number.isFinite(Date.parse(untilIso)) ? Date.parse(untilIso) : Date.now();

    const out = [];
    const seen = new Set();
    const day = 24 * 60 * 60 * 1000;
    for (let t = since; t <= until + day; t += day) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const rows = loadYamlSafe(this.#historyPath(iso, householdId)) || [];
      for (const row of rows) {
        if (!row?.id || seen.has(row.id)) continue;
        const at = Date.parse(row.startedAt || row.endedAt || 0);
        if (!Number.isFinite(at) || at < since || at > until) continue;
        seen.add(row.id);
        try { out.push(PlaySession.fromSnapshot(row)); } catch { /* skip unreadable row */ }
      }
    }

    // Include anything still open, so today's record is not missing the game
    // currently on screen.
    for (const deviceId of await this.listTrackedDeviceIds({ householdId })) {
      const current = await this.findCurrentForDevice(deviceId, { householdId });
      if (!current || seen.has(current.id)) continue;
      const at = Date.parse(current.startedAt || 0);
      if (Number.isFinite(at) && at >= since && at <= until) out.push(current);
    }

    return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  }

  /** Every device we have ever tracked — the input to startup reconciliation. */
  async listTrackedDeviceIds({ householdId = null } = {}) {
    const entries = listEntries(path.join(this.#root(householdId), 'current')) || [];
    return entries
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter((name) => typeof name === 'string' && name.endsWith('.yml'))
      .map((name) => name.replace(/\.yml$/, ''));
  }
}

export default YamlPlaySessionDatastore;
