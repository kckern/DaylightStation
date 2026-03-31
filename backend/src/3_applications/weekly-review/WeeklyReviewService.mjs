import path from 'path';
import fs from 'fs';
import { WeeklyReviewAggregator } from '../../2_domains/weekly-review/WeeklyReviewAggregator.mjs';

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
      for (const date of dates) {
        const snapshot = await this.#weatherStore.loadDate(date);
        if (snapshot) {
          result[date] = snapshot;
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
    const audioDir = path.join(this.#mediaPath, 'weekly-review', week);
    const audioPath = path.join(audioDir, `recording.${ext}`);

    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(audioPath, buffer);
    this.#logger.info?.('weekly-review.recording.audio-saved', { week, path: audioPath, bytes: buffer.length });

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
    return daysAgo.toISOString().slice(0, 10);
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
