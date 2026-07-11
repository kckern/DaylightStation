/**
 * YamlPianoStudioDatastore — persistence for the piano kiosk bounded context.
 *
 * Absorbs every filesystem/path concern the piano router used to inline:
 *   - Per-user studio takes            data/users/{id}/apps/piano/studio/{takeId}.yml
 *   - Per-user preferences/progress    data/users/{id}/apps/piano/{preferences,progress}.yml
 *   - Household producer pool          <householdDataDir>/apps/piano/producer/{family}/{id}.yml
 *   - Lesson drills (read-only)        <mediaDir>/docs/piano-lessons/{collection}/{index,id}.yml
 *   - Always-on MIDI history (.mid)    <householdDataDir>/history/piano/{userId}/{date}/{takeId}.mid
 *   - Effect-audit clips + manifest    <mediaDir>/logs/piano/effect-audit/{runId}/…
 *   - Loop-library manifest            <mediaDir>/midi (walked + baked by getManifest)
 *   - Roster                           household piano config users.primary (hydrated)
 *
 * Path building is done from an injected `configService` (getUserDir/getMediaDir/
 * getHouseholdPath/getUserProfile/getHouseholdAppConfig) — the service is passed in,
 * never imported (adapters must not import the config singleton). FileIO and the two
 * pure piano helpers (encodeMidiFile, getManifest) are imported directly.
 *
 * The router owns HTTP-shaped input validation (safe segment / id regexes); this
 * datastore owns dir resolution + read/write. Methods that need a resolvable user
 * dir return `null` when the user is unknown so the router can map that to a 400.
 */
import path from 'path';
import {
  loadYaml,
  saveYaml,
  listYamlFiles,
  deleteYaml,
  ensureDir,
  writeBinary,
} from '#system/utils/FileIO.mjs';
import { encodeMidiFile } from '#apps/piano/midiFile.mjs';
import { getManifest } from '#apps/piano/loopManifest.mjs';

export class YamlPianoStudioDatastore {
  #configService;
  #userService;
  #logger;

  /**
   * @param {{ configService: object, userService?: object, logger?: object }} deps
   */
  constructor({ configService, userService = null, logger = console } = {}) {
    if (!configService) throw new Error('YamlPianoStudioDatastore: configService required');
    this.#configService = configService;
    this.#userService = userService;
    this.#logger = logger;
  }

  // ── validation / config helpers ────────────────────────────────────────────
  isSafeSegment(s) {
    return typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');
  }

  /** A userId must be a real, known user (guards arbitrary dir creation). */
  isKnownUser(userId) {
    return this.isSafeSegment(userId) && !!this.#configService.getUserProfile(userId);
  }

  getUserProfile(userId) {
    return this.#configService.getUserProfile(userId);
  }

  /** The household piano app config (users, videos, co_progress, …). */
  getPianoConfig() {
    return this.#configService.getHouseholdAppConfig(null, 'piano') || {};
  }

  #userPianoDir(userId, ...sub) {
    return this.isKnownUser(userId)
      ? path.join(this.#configService.getUserDir(userId), 'apps', 'piano', ...sub)
      : null;
  }

  #producerDir(family) {
    return this.#configService.getHouseholdPath(path.join('apps', 'piano', 'producer', family));
  }

  // ── Roster ──────────────────────────────────────────────────────────────────
  getRoster() {
    const cfg = this.getPianoConfig();
    const primary = Array.isArray(cfg.users?.primary) ? cfg.users.primary : [];
    const hydrated = this.#userService
      ? this.#userService.hydrateUsers(primary)
      : primary
          .map((id) => { const p = this.#configService.getUserProfile(id); return p ? { id, name: p.display_name || p.username || id, group_label: p.group_label } : { id, name: id }; });
    return hydrated.map((u) => ({ id: u.id, name: u.name, group_label: u.group_label || null }));
  }

  // ── Studio takes (per-user) ───────────────────────────────────────────────────
  listStudioTakes(userId) {
    const dir = this.#userPianoDir(userId, 'studio');
    if (!dir) return null;
    return listYamlFiles(dir).map((id) => {
      const data = loadYaml(path.join(dir, id)) || {};
      return {
        id,
        title: data.title || id,
        created: data.created || null,
        durationMs: data.durationMs || 0,
        eventCount: Array.isArray(data.events) ? data.events.length : 0,
        favorite: !!data.favorite,
      };
    });
  }

  getStudioTake(userId, id) {
    const dir = this.#userPianoDir(userId, 'studio');
    if (!dir) return null;
    return loadYaml(path.join(dir, id)) || null;
  }

  saveStudioTake(userId, id, data) {
    const dir = this.#userPianoDir(userId, 'studio');
    if (!dir) return false;
    saveYaml(path.join(dir, id), data);
    return true;
  }

  deleteStudioTake(userId, id) {
    const dir = this.#userPianoDir(userId, 'studio');
    if (!dir) return false;
    return deleteYaml(path.join(dir, id));
  }

  // ── Producer (household pool) ─────────────────────────────────────────────────
  /** Returns [{ id, data }] for a family — router applies its light projection. */
  listProducer(family) {
    const dir = this.#producerDir(family);
    return listYamlFiles(dir).map((id) => ({ id, data: loadYaml(path.join(dir, id)) || {} }));
  }

  getProducer(family, id) {
    return loadYaml(path.join(this.#producerDir(family), id)) || null;
  }

  saveProducer(family, id, data) {
    saveYaml(path.join(this.#producerDir(family), id), data);
  }

  deleteProducer(family, id) {
    return deleteYaml(path.join(this.#producerDir(family), id));
  }

  // ── Preferences (per-user opaque blob) ───────────────────────────────────────
  getPreferences(userId) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return null;
    return loadYaml(path.join(dir, 'preferences')) || {};
  }

  savePreferences(userId, prefs) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return false;
    saveYaml(path.join(dir, 'preferences'), prefs);
    return true;
  }

  // ── Sound preset (per-user opaque blob: { default, favorites }) ─────────────
  getPreset(userId) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return null;
    return loadYaml(path.join(dir, 'preset')) || {};
  }

  savePreset(userId, data) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return false;
    saveYaml(path.join(dir, 'preset'), data);
    return true;
  }

  // ── Lesson progress / history (per-user) ─────────────────────────────────────
  getProgress(userId) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return null;
    return loadYaml(path.join(dir, 'progress')) || { collections: {} };
  }

  saveProgress(userId, progress) {
    const dir = this.#userPianoDir(userId);
    if (!dir) return false;
    saveYaml(path.join(dir, 'progress'), progress);
    return true;
  }

  // ── Lesson drills (content, read-only) ───────────────────────────────────────
  #lessonDir(collection) {
    if (!this.isSafeSegment(collection)) return null;
    const root = path.join(this.#configService.getMediaDir(), 'docs', 'piano-lessons');
    const dir = path.join(root, collection);
    return dir.startsWith(root + path.sep) ? dir : null;
  }

  getLessonIndex(collection) {
    const dir = this.#lessonDir(collection);
    if (!dir) return null;
    return loadYaml(path.join(dir, 'index')) || null;
  }

  getLessonDrill(collection, id) {
    const dir = this.#lessonDir(collection);
    if (!dir) return null;
    return loadYaml(path.join(dir, id)) || null;
  }

  // ── Always-on MIDI history (.mid per user/date) ──────────────────────────────
  writeHistoryMidi(userId, date, takeId, events) {
    const dir = this.#configService.getHouseholdPath(path.join('history', 'piano', userId, date));
    ensureDir(dir);
    const buf = encodeMidiFile(events);
    const file = path.join(dir, `${takeId}.mid`);
    writeBinary(file, buf);
    return { bytes: buf.length, path: file };
  }

  // ── Effect audit ─────────────────────────────────────────────────────────────
  #auditDir(runId) {
    return path.join(this.#configService.getMediaDir(), 'logs', 'piano', 'effect-audit', runId);
  }

  writeEffectAuditClip(runId, label, buffer) {
    const dir = this.#auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, `${label}.webm`);
    writeBinary(file, buffer);
    return { bytes: buffer.length, path: file };
  }

  writeEffectAuditManifest(runId, manifest) {
    const dir = this.#auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, 'manifest.json');
    writeBinary(file, Buffer.from(JSON.stringify(manifest, null, 2)));
    return { clips: manifest.clips.length, path: file };
  }

  // ── Loop-library manifest ────────────────────────────────────────────────────
  getLoopManifest({ refresh = false } = {}) {
    const midiDir = path.join(this.#configService.getMediaDir(), 'midi');
    return getManifest(midiDir, { refresh });
  }
}

export default YamlPianoStudioDatastore;
