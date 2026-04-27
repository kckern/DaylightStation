import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WeeklyReviewAggregator } from '../../2_domains/weekly-review/WeeklyReviewAggregator.mjs';

const execFileAsync = promisify(execFile);

export class WeeklyReviewService {
  #dataPath;
  #mediaPath;
  #immichAdapter;
  #calendarData;
  #sessionService;
  #weatherStore;
  #householdId;
  #transcriptionService;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#dataPath = config.dataPath;
    this.#mediaPath = config.mediaPath;
    this.#householdId = config.householdId;
    this.#immichAdapter = deps.immichAdapter;
    this.#calendarData = deps.calendarData;
    this.#sessionService = deps.sessionService;
    this.#weatherStore = deps.weatherStore;
    this.#transcriptionService = deps.transcriptionService;
    this.#logger = deps.logger || console;
  }

  async bootstrap(weekStart) {
    this.sweepStaleDrafts().catch(err => this.#logger.warn?.('weekly-review.sweep.failed', { error: err.message }));
    const start = weekStart || this.#defaultWeekStart();
    // end is INCLUSIVE here — the Immich adapter returns days `start..end` inclusive.
    // For an 8-day window starting at `start` (= today-8), end is `today-1` (yesterday).
    const end = this.#addDays(start, 7);
    const bootstrapStart = Date.now();

    this.#logger.info?.('weekly-review.bootstrap', { week: start });

    // Build date list for the week (inclusive of `end` to match the adapter).
    const dates = [];
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const [photoDays, calendarDays, fitnessByDate, weatherByDate] = await Promise.all([
      this.#immichAdapter.getPhotosForDateRange(start, end),
      this.#calendarData.getEventsForDateRange(start, end),
      this.#fetchFitnessSessions(dates),
      this.#fetchWeatherHistory(dates),
    ]);

    const { days } = WeeklyReviewAggregator.aggregate(photoDays, calendarDays, fitnessByDate, weatherByDate);
    const recording = this.#getRecordingStatus(start);

    this.#logger.info?.('weekly-review.bootstrap.complete', {
      week: start,
      durationMs: Date.now() - bootstrapStart,
      dayCount: days.length,
      totalPhotos: photoDays.reduce((s, d) => s + (d.photoCount || 0), 0),
    });

    return { week: start, days, recording };
  }

  async #fetchFitnessSessions(dates) {
    if (!this.#sessionService) return {};
    const result = {};
    try {
      for (const date of dates) {
        const sessions = await this.#sessionService.listSessionsByDate(date, this.#householdId);
        if (sessions?.length > 0) {
          result[date] = sessions.map(s => ({
            sessionId: s.sessionId,
            startTime: s.startTime,
            durationMs: s.durationMs,
            participants: s.participants,
            media: s.media,
            totalCoins: s.totalCoins,
          }));
        }
      }
    } catch (err) {
      this.#logger.warn?.('weekly-review.fitness.error', { error: err.message });
    }
    return result;
  }

  async #fetchWeatherHistory(dates) {
    if (!this.#weatherStore) return {};
    const result = {};
    try {
      // First try history files
      for (const date of dates) {
        const snapshot = await this.#weatherStore.loadDate(date);
        if (snapshot) {
          result[date] = snapshot;
        }
      }

      // For dates without history, derive from current hourly forecast data
      const missingDates = dates.filter(d => !result[d]);
      if (missingDates.length > 0) {
        const current = await this.#weatherStore.load();
        if (current?.hourly?.length > 0) {
          for (const date of missingDates) {
            const dayHours = current.hourly.filter(h => h.time?.startsWith(date));
            if (dayHours.length > 0) {
              const temps = dayHours.map(h => h.temp);
              // Pick the mid-day code (noon-ish) or first available
              const midday = dayHours.find(h => h.time?.includes(' 12:')) || dayHours[Math.floor(dayHours.length / 2)];
              result[date] = {
                date,
                temp: midday.temp,
                feel: midday.feel,
                code: midday.code,
                cloud: midday.cloud,
                precip: Math.max(...dayHours.map(h => h.precip || 0)),
                high: Math.max(...temps),
                low: Math.min(...temps),
              };
            }
          }
        }
      }
    } catch (err) {
      this.#logger.warn?.('weekly-review.weather.error', { error: err.message });
    }
    return result;
  }

  async saveRecording({ audioBase64, mimeType, week, duration }) {
    if (!audioBase64) throw new Error('audioBase64 required');

    this.#logger.info?.('weekly-review.recording.start', { week, duration });

    const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Save audio to media volume
    const ext = mimeType === 'audio/ogg' ? 'ogg' : 'webm';
    this.#logger.debug?.('weekly-review.recording.file', { week, bytes: buffer.length, ext });
    const now = new Date();
    const localDate = now.toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'UTC' });
    const localTime = now.toLocaleTimeString('en-GB', { timeZone: process.env.TZ || 'UTC', hour12: false }).replace(/:/g, '-');
    const audioDir = path.join(this.#mediaPath, 'weekly-review', localDate);
    const audioPath = path.join(audioDir, `recording-${localDate}-${localTime}.${ext}`);

    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(audioPath, buffer);
    this.#logger.info?.('weekly-review.recording.audio-saved', { week, path: audioPath, bytes: buffer.length });

    // Convert to mp3
    const mp3Path = audioPath.replace(/\.\w+$/, '.mp3');
    try {
      const convertStart = Date.now();
      await execFileAsync('ffmpeg', ['-i', audioPath, '-y', '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path]);
      const mp3Size = fs.statSync(mp3Path).size;
      this.#logger.info?.('weekly-review.recording.mp3-converted', {
        week, mp3Path, mp3SizeKb: Math.round(mp3Size / 1024), durationMs: Date.now() - convertStart,
      });
    } catch (err) {
      this.#logger.error?.('weekly-review.recording.mp3-failed', { error: err.message });
    }

    // Transcribe
    const transcribeStart = Date.now();
    const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
      mimeType: mimeType || 'audio/webm',
      prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
    });
    this.#logger.info?.('weekly-review.transcription.complete', {
      week,
      durationMs: Date.now() - transcribeStart,
      rawLength: transcriptRaw?.length,
      cleanLength: transcriptClean?.length,
    });

    // Save transcript
    const transcriptData = {
      week,
      recordedAt: new Date().toISOString(),
      duration,
      transcriptRaw,
      transcriptClean,
    };
    const transcriptDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week);
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, 'transcript.yml'),
      JSON.stringify(transcriptData, null, 2)
    );

    this.#logger.info?.('weekly-review.recording.transcript-saved', { week, path: path.join(transcriptDir, 'transcript.yml') });

    // Save manifest
    fs.writeFileSync(
      path.join(transcriptDir, 'manifest.yml'),
      JSON.stringify({ week, generatedAt: new Date().toISOString(), duration }, null, 2)
    );
    this.#logger.info?.('weekly-review.recording.manifest-saved', { week });

    this.#logger.info?.('weekly-review.recording.saved', { week, duration, transcriptLength: transcriptClean?.length });

    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  async appendChunk({ sessionId, seq, week, buffer }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    if (typeof seq !== 'number' || seq < 0 || !Number.isInteger(seq)) throw new Error(`invalid seq: ${seq}`);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('buffer required');

    const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
    const draftPath = path.join(draftDir, `${sessionId}.webm`);
    const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
    fs.mkdirSync(draftDir, { recursive: true });

    let meta = { sessionId, week, seq: -1, totalBytes: 0, startedAt: new Date().toISOString() };
    const metaExists = fs.existsSync(metaPath);
    if (metaExists) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (err) {
        this.#logger.error?.('weekly-review.chunk.meta-corrupt', { sessionId, metaPath, error: err.message });
        if (fs.existsSync(draftPath) && fs.statSync(draftPath).size > 0) {
          throw new Error('draft present but meta unreadable — refusing to proceed');
        }
      }
    }

    // C1: reconcile draft file size against meta.totalBytes — heals desync from prior partial writes
    if (fs.existsSync(draftPath)) {
      const actualSize = fs.statSync(draftPath).size;
      if (actualSize !== meta.totalBytes) {
        this.#logger.warn?.('weekly-review.chunk.desync-recovery', {
          sessionId, seq, metaTotalBytes: meta.totalBytes, actualDraftBytes: actualSize,
        });
        fs.truncateSync(draftPath, meta.totalBytes);
      }
    }

    if (seq === meta.seq) {
      this.#logger.warn?.('weekly-review.chunk.duplicate', { sessionId, seq });
      return { ok: true, duplicate: true, bytesWritten: 0, totalBytes: meta.totalBytes, nextSeq: meta.seq + 1 };
    }
    if (seq !== meta.seq + 1) {
      throw new Error(`out-of-order chunk: expected ${meta.seq + 1}, got ${seq}`);
    }

    // I2: seq=0 with no prior meta — truncate any stale draft from a previous broken session
    if (seq === 0 && !metaExists) {
      fs.writeFileSync(draftPath, buffer);
    } else {
      fs.appendFileSync(draftPath, buffer);
    }

    meta.seq = seq;
    meta.totalBytes += buffer.length;
    meta.updatedAt = new Date().toISOString();

    // C1: atomic meta update — write to .tmp then rename (POSIX rename is atomic)
    const metaTmpPath = `${metaPath}.tmp`;
    fs.writeFileSync(metaTmpPath, JSON.stringify(meta));
    fs.renameSync(metaTmpPath, metaPath);

    this.#logger.info?.('weekly-review.chunk.appended', {
      sessionId, seq, bytes: buffer.length, totalBytes: meta.totalBytes, week,
    });
    return { ok: true, bytesWritten: buffer.length, totalBytes: meta.totalBytes, nextSeq: seq + 1 };
  }

  async listDrafts(week) {
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
    if (!fs.existsSync(draftDir)) return [];

    const entries = fs.readdirSync(draftDir);
    const metaFiles = entries.filter(n => n.endsWith('.meta.json'));
    const drafts = [];
    for (const name of metaFiles) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(draftDir, name), 'utf-8'));
        drafts.push({
          sessionId: meta.sessionId,
          week: meta.week,
          seq: meta.seq,
          totalBytes: meta.totalBytes,
          startedAt: meta.startedAt,
          updatedAt: meta.updatedAt,
        });
      } catch (err) {
        this.#logger.warn?.('weekly-review.listDrafts.meta-parse-failed', { name, error: err.message });
      }
    }
    return drafts;
  }

  async finalizeDraft({ sessionId, week, duration }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);

    const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
    const draftPath = path.join(draftDir, `${sessionId}.webm`);
    const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
    if (!fs.existsSync(draftPath)) throw new Error(`draft not found: ${sessionId}`);

    // Atomically rename so concurrent chunk-writes hit a fresh draft.
    // This makes repeat-finalize calls within the same session safe — each call
    // processes the bytes accumulated since the previous finalize.
    const stamp = Date.now();
    const processingPath = path.join(draftDir, `${sessionId}.processing-${stamp}.webm`);
    fs.renameSync(draftPath, processingPath);

    this.#logger.info?.('weekly-review.finalize.start', { sessionId, week, duration, processingPath });
    const buffer = fs.readFileSync(processingPath);

    // Move audio to final media location
    const now = new Date();
    const localDate = now.toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'UTC' });
    const localTime = now.toLocaleTimeString('en-GB', { timeZone: process.env.TZ || 'UTC', hour12: false }).replace(/:/g, '-');
    const audioDir = path.join(this.#mediaPath, 'weekly-review', localDate);
    const audioPath = path.join(audioDir, `recording-${localDate}-${localTime}.webm`);
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(audioPath, buffer);
    this.#logger.info?.('weekly-review.finalize.audio-saved', { sessionId, path: audioPath, bytes: buffer.length });

    // Convert to mp3 (best-effort, matches saveRecording behavior)
    const mp3Path = audioPath.replace(/\.\w+$/, '.mp3');
    try {
      await execFileAsync('ffmpeg', ['-i', audioPath, '-y', '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path]);
      this.#logger.info?.('weekly-review.finalize.mp3-converted', { mp3Path });
    } catch (err) {
      this.#logger.error?.('weekly-review.finalize.mp3-failed', { error: err.message });
    }

    // Transcribe
    const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
      mimeType: 'audio/webm',
      prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
    });

    // Save transcript + manifest (same format as saveRecording)
    const transcriptDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week);
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, 'transcript.yml'),
      JSON.stringify({ week, recordedAt: new Date().toISOString(), duration, transcriptRaw, transcriptClean }, null, 2)
    );
    fs.writeFileSync(
      path.join(transcriptDir, 'manifest.yml'),
      JSON.stringify({ week, generatedAt: new Date().toISOString(), duration }, null, 2)
    );

    // Delete the processing snapshot. The metadata file may be re-created by
    // concurrent chunk writes — leave it alone; the next finalize will manage it.
    fs.unlinkSync(processingPath);
    if (fs.existsSync(metaPath) && !fs.existsSync(draftPath)) fs.unlinkSync(metaPath);

    this.#logger.info?.('weekly-review.finalize.complete', { sessionId, week, duration });
    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  async sweepStaleDrafts({ maxAgeDays = 30 } = {}) {
    const baseDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review');
    if (!fs.existsSync(baseDir)) return { deleted: [] };
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const deleted = [];
    for (const week of fs.readdirSync(baseDir)) {
      const draftDir = path.join(baseDir, week, '.drafts');
      if (!fs.existsSync(draftDir)) continue;
      for (const name of fs.readdirSync(draftDir)) {
        if (!name.endsWith('.meta.json')) continue;
        const metaPath = path.join(draftDir, name);
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          const ts = Date.parse(meta.updatedAt || meta.startedAt);
          if (Number.isFinite(ts) && ts < cutoff) {
            const draftPath = path.join(draftDir, `${meta.sessionId}.webm`);
            if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
            fs.unlinkSync(metaPath);
            deleted.push(meta.sessionId);
          }
        } catch (err) {
          this.#logger.warn?.('weekly-review.sweep.meta-parse-failed', { name, error: err.message });
        }
      }
    }
    if (deleted.length > 0) this.#logger.info?.('weekly-review.sweep.deleted', { count: deleted.length, sessionIds: deleted });
    return { deleted };
  }

  async discardDraft({ sessionId, week }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
    const draftPath = path.join(draftDir, `${sessionId}.webm`);
    const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
    let existed = false;
    if (fs.existsSync(draftPath)) { fs.unlinkSync(draftPath); existed = true; }
    if (fs.existsSync(metaPath)) { fs.unlinkSync(metaPath); existed = true; }
    this.#logger.info?.('weekly-review.draft.discarded', { sessionId, week, existed });
    return { ok: true, existed };
  }

  #isValidSessionId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
  }

  #isValidWeek(week) {
    return typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week);
  }

  #getRecordingStatus(week) {
    try {
      const transcriptPath = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, 'transcript.yml');
      if (fs.existsSync(transcriptPath)) {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const data = JSON.parse(content);
        this.#logger.debug?.('weekly-review.recording-status.found', { week, recordedAt: data.recordedAt, duration: data.duration });
        return { exists: true, recordedAt: data.recordedAt, duration: data.duration };
      }
      this.#logger.debug?.('weekly-review.recording-status.none', { week });
    } catch (err) {
      this.#logger.warn?.('weekly-review.recording-status.error', { week, error: err.message });
    }
    return { exists: false };
  }

  #defaultWeekStart() {
    // Past 8 days, excluding today. Window = [today-8, today-1].
    const tz = process.env.TZ || 'UTC';
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 8);
    const year = start.toLocaleString('en-CA', { year: 'numeric', timeZone: tz });
    const month = start.toLocaleString('en-CA', { month: '2-digit', timeZone: tz });
    const day = start.toLocaleString('en-CA', { day: '2-digit', timeZone: tz });
    return `${year}-${month}-${day}`;
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
