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
    const start = weekStart || this.#defaultWeekStart();
    const end = this.#addDays(start, 7);
    const bootstrapStart = Date.now();

    this.#logger.info?.('weekly-review.bootstrap', { week: start });

    // Build date list for the week
    const dates = [];
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) < end; d.setDate(d.getDate() + 1)) {
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
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
    }

    if (seq === meta.seq) {
      this.#logger.warn?.('weekly-review.chunk.duplicate', { sessionId, seq });
      return { ok: true, duplicate: true, bytesWritten: 0, totalBytes: meta.totalBytes, nextSeq: meta.seq + 1 };
    }
    if (seq !== meta.seq + 1) {
      throw new Error(`out-of-order chunk: expected ${meta.seq + 1}, got ${seq}`);
    }

    fs.appendFileSync(draftPath, buffer);
    meta.seq = seq;
    meta.totalBytes += buffer.length;
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    this.#logger.info?.('weekly-review.chunk.appended', {
      sessionId, seq, bytes: buffer.length, totalBytes: meta.totalBytes, week,
    });
    return { ok: true, bytesWritten: buffer.length, totalBytes: meta.totalBytes, nextSeq: seq + 1 };
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
    const now = new Date();
    const daysAgo = new Date(now);
    daysAgo.setDate(now.getDate() - 7);
    // Use locale-aware formatting to respect TZ env var
    const year = daysAgo.toLocaleString('en-CA', { year: 'numeric', timeZone: process.env.TZ || 'UTC' });
    const month = daysAgo.toLocaleString('en-CA', { month: '2-digit', timeZone: process.env.TZ || 'UTC' });
    const day = daysAgo.toLocaleString('en-CA', { day: '2-digit', timeZone: process.env.TZ || 'UTC' });
    return `${year}-${month}-${day}`;
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
