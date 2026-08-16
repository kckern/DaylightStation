import path from 'path';
import fs from 'fs';
import { loadYaml, saveYaml, listYamlFiles, deleteYaml } from '#system/utils/FileIO.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

/**
 * FeedbackService — app-wide voice-feedback capture.
 *
 * A user records a spoken note (a bug, a layout quirk, an idea) from inside any
 * app. We persist the audio, snapshot whatever app logs were captured at the
 * moment (so they aren't lost), and transcribe the audio in the background. Each
 * feedback item is one timestamped YAML file, scoped to the originating app, so
 * the collection doubles as a triage inbox.
 *
 *   audio  → media/audio/feedback/{app}/{id}.{ext}
 *   item   → data/household/feedback/{app}/{id}.yml
 */

const EXT_BY_MIME = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
const safeApp = (s) => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s);
const safeId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s);

const TRANSCRIBE_PROMPT = 'A short spoken software-feedback note: a bug report, UX/layout quirk, or feature idea about an app the user was just using.';

export class FeedbackService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService
   * @param {Object} [deps.transcriptionService]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.notificationService] - optional; when wired, each
   *   arriving item raises an alert (see #notifyArrival). Optional because
   *   capture must work whether or not anyone is listening.
   */
  constructor({ configService, transcriptionService = null, logger = console, notificationService = null }) {
    this.config = configService;
    this.transcription = transcriptionService;
    this.logger = logger;
    this.notifications = notificationService;
    this.audioRoot = path.join(configService.getMediaDir(), 'audio', 'feedback');
    this.itemsRoot = configService.getHouseholdPath('feedback');
  }

  _itemsDir(app) { return safeApp(app) ? path.join(this.itemsRoot, app) : null; }
  _audioDir(app) { return safeApp(app) ? path.join(this.audioRoot, app) : null; }

  /**
   * Create a feedback item: save audio, write the item, kick off background
   * transcription. Returns the item (transcript fills in asynchronously).
   */
  async create({ app, audioBuffer = null, mimeType = 'audio/webm', durationMs = 0, context = {}, logs = null }) {
    if (!safeApp(app)) throw new Error('invalid app');
    const itemsDir = this._itemsDir(app);
    const audioDir = this._audioDir(app);
    fs.mkdirSync(itemsDir, { recursive: true });

    const created = new Date();
    const stamp = created.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDhhmmss
    const id = `${stamp}_${shortId(6)}`;
    const hasAudio = !!(audioBuffer && audioBuffer.length);
    const ext = EXT_BY_MIME[mimeType] || 'webm';
    let audioRel = null;
    if (hasAudio) {
      fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, `${id}.${ext}`), audioBuffer);
      audioRel = path.posix.join('audio', 'feedback', app, `${id}.${ext}`); // relative to mediaDir
    }

    const canTranscribe = hasAudio && !!this.transcription;
    const item = {
      id,
      app,
      created: created.toISOString(),
      status: 'new', // new | triaged | done
      durationMs: Number(durationMs) || 0,
      audio: audioRel,
      transcript: null,
      transcriptStatus: canTranscribe ? 'pending' : 'unavailable',
      context: context && typeof context === 'object' ? context : {},
      logs: logs || null,
    };
    saveYaml(path.join(itemsDir, id), item);
    this.logger.info?.('feedback.created', { app, id, durationMs: item.durationMs, hasAudio, willTranscribe: canTranscribe });

    this._notifyArrival(item);
    if (canTranscribe) this._transcribeInBackground(app, id, audioBuffer);
    return item;
  }

  /**
   * Tell somebody an item arrived.
   *
   * A machine report and a person's recording want different urgency. A child
   * recording a complaint is a direct request for a human, and app-only routing
   * would leave it unread — that is the whole reason the inbox went unwatched.
   * A machine report is the paper trail for an incident the stall detector has
   * already paged about, so it stays an in-app card; paging twice for one event
   * teaches people to ignore both.
   *
   * Fire-and-forget and fail-soft. Capture is the valuable part, and a dead
   * Telegram must never cost us the report it was announcing.
   */
  _notifyArrival(item) {
    if (!this.notifications?.send) return;
    const auto = item.context?.auto === true;
    const reason = typeof item.context?.reason === 'string' ? item.context.reason : null;
    const seconds = Math.round((item.durationMs || 0) / 1000);

    try {
      this.notifications.send({
        title: auto ? 'A screen filed a report' : 'New feedback recording',
        body: auto
          ? `${item.app} filed itself a report (${reason || 'no reason given'}). `
            + 'The last 150 client log events are attached to the item.'
          : `Somebody recorded ${seconds ? `${seconds}s of ` : ''}feedback about ${item.app}.`,
        category: 'system',
        urgency: auto ? 'normal' : 'high',
        // There is no admin UI route for the inbox yet, so this links the API
        // endpoint, which is complete and returns the whole item — transcript,
        // context and the attached log ring. A JSON page beats a 404; point this
        // at the UI the day one exists.
        actions: [{ label: 'Read the report', action: 'open', data: { url: `/api/v1/feedback/${item.app}/${item.id}` } }],
        metadata: { app: item.app, id: item.id, auto },
        // Machine reports of one reason collapse into the category cooldown; a
        // jank episode that recurs all evening is one nudge. Every human
        // recording is its own ask and keys uniquely.
        dedupeKey: auto
          ? `feedback-auto:${item.app}:${reason || 'unknown'}`
          : `feedback:${item.app}:${item.id}`,
      })?.catch?.((err) => this.logger.warn?.('feedback.notify-failed', { app: item.app, id: item.id, error: err.message }));
    } catch (err) {
      this.logger.warn?.('feedback.notify-failed', { app: item.app, id: item.id, error: err.message });
    }
  }

  _transcribeInBackground(app, id, audioBuffer) {
    Promise.resolve()
      .then(() => this.transcription.transcribe(audioBuffer, { prompt: TRANSCRIBE_PROMPT }))
      .then((result) => {
        const text = (typeof result === 'string' ? result : result?.text || '').trim();
        const file = path.join(this._itemsDir(app), id);
        const item = loadYaml(file);
        if (!item) return;
        item.transcript = text;
        item.transcriptStatus = 'done';
        saveYaml(file, item);
        this.logger.info?.('feedback.transcribed', { app, id, chars: text.length });
      })
      .catch((err) => {
        const file = path.join(this._itemsDir(app), id);
        const item = loadYaml(file);
        if (item) { item.transcriptStatus = 'failed'; item.transcriptError = err.message; saveYaml(file, item); }
        this.logger.error?.('feedback.transcribe-failed', { app, id, error: err.message });
      });
  }

  _allApps() {
    try {
      return fs.readdirSync(this.itemsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { return []; }
  }

  /** Inbox listing — summaries across all apps (or one app), newest first. */
  list({ app = null } = {}) {
    const apps = app ? (safeApp(app) ? [app] : []) : this._allApps();
    const items = [];
    for (const a of apps) {
      const dir = this._itemsDir(a);
      if (!dir) continue;
      for (const id of listYamlFiles(dir)) {
        const d = loadYaml(path.join(dir, id)) || {};
        const t = d.transcript || null;
        items.push({
          id, app: a,
          created: d.created || null,
          status: d.status || 'new',
          durationMs: d.durationMs || 0,
          transcriptStatus: d.transcriptStatus || null,
          transcript: t && t.length > 240 ? `${t.slice(0, 240)}…` : t,
          route: d.context?.route || null,
          hasAudio: !!d.audio,
        });
      }
    }
    items.sort((a, b) => String(b.created || b.id).localeCompare(String(a.created || a.id)));
    return items;
  }

  get(app, id) {
    if (!safeApp(app) || !safeId(id)) return null;
    return loadYaml(path.join(this._itemsDir(app), id));
  }

  update(app, id, patch = {}) {
    const item = this.get(app, id);
    if (!item) return null;
    if (typeof patch.status === 'string') item.status = patch.status;
    if (typeof patch.notes === 'string') item.notes = patch.notes;
    saveYaml(path.join(this._itemsDir(app), id), item);
    return item;
  }

  remove(app, id) {
    if (!safeApp(app) || !safeId(id)) return false;
    const item = this.get(app, id);
    if (item?.audio) {
      try { fs.unlinkSync(path.join(this.config.getMediaDir(), item.audio)); } catch { /* already gone */ }
    }
    return deleteYaml(path.join(this._itemsDir(app), id));
  }

  audioFilePath(app, id) {
    const item = this.get(app, id);
    if (!item?.audio) return null;
    const p = path.join(this.config.getMediaDir(), item.audio);
    return fs.existsSync(p) ? p : null;
  }
}

export default FeedbackService;
