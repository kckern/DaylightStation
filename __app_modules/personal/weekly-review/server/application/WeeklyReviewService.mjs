import { WeeklyReviewAggregator } from "../domain/WeeklyReviewAggregator.mjs";

export class WeeklyReviewService {
  #immichAdapter;
  #calendarData;
  #sessionService;
  #weatherStore;
  #householdId;
  #transcriptionService;
  #logger;
  #reviewStore;
  #runCommand;
  #timezone;

  constructor(config = {}, deps = {}) {
    this.#householdId = config.householdId;
    this.#immichAdapter = deps.immichAdapter;
    this.#calendarData = deps.calendarData;
    this.#sessionService = deps.sessionService;
    this.#weatherStore = deps.weatherStore;
    this.#transcriptionService = deps.transcriptionService;
    this.#logger = deps.logger || console;
    if (!deps.reviewStore) throw new Error('WeeklyReviewService requires a reviewStore dependency');
    if (typeof deps.runCommand !== 'function') throw new Error('WeeklyReviewService requires a runCommand dependency');
    this.#reviewStore = deps.reviewStore;
    this.#runCommand = deps.runCommand;
    this.#timezone = config.timezone || 'UTC';
  }

  /**
   * Draft chunks are raw in-progress audio — heavy, transient, never diffed.
   * They belong beside the FINAL recording in media, which saveRecording and
   * finalizeDraft already write to. Keeping drafts under the household dir while
   * finals went to media is the asymmetry that let a 26MB orphan hide in the
   * tree that is supposed to zip small.
   */
  async bootstrap(weekStart) {
    this.sweepStaleDrafts().catch(err => this.#logger.warn?.('weekly-review.sweep.failed', { error: err.message }));
    const start = weekStart || this.#defaultWeekStart();
    // end is INCLUSIVE here — the Immich adapter returns days `start..end` inclusive.
    // For the default 8-day window starting at `start` (= today-7), end is today.
    const end = this.#addDays(start, 7);
    const bootstrapStart = Date.now();

    this.#logger.info?.('weekly-review.bootstrap', { week: start });

    // Build date list for the week (inclusive of `end` to match the adapter).
    const dates = [];
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
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

  /**
   * How far back there is still something to review, so the client can jump
   * straight to the start of a trip instead of paging a window at a time.
   *
   * Probes `[before - lookbackDays, before)` — strictly older than the window
   * the caller is on. Never throws on a probe failure: this backs a convenience
   * key inside a live recording session, and the client's fallback is ordinary
   * one-window-at-a-time paging.
   */
  async getContentExtent({ before, lookbackDays = 120 } = {}) {
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      throw new Error('before must be a YYYY-MM-DD date');
    }
    const startDate = this.#addDays(before, -lookbackDays);
    const endDate = this.#addDays(before, -1);

    try {
      const oldestContentDate = await this.#immichAdapter.searchOldest({ startDate, endDate });
      this.#logger.info?.('weekly-review.extent', { before, lookbackDays, oldestContentDate });
      return { oldestContentDate: oldestContentDate || null, hasOlder: !!oldestContentDate };
    } catch (err) {
      this.#logger.warn?.('weekly-review.extent.failed', { before, error: err.message });
      return { oldestContentDate: null, hasOlder: false };
    }
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
            totalRings: s.totalRings,
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
    const localDate = now.toLocaleDateString('en-CA', { timeZone: this.#timezone });
    const localTime = now.toLocaleTimeString('en-GB', { timeZone: this.#timezone, hour12: false }).replace(/:/g, '-');
    const audioArtifact = this.#reviewStore.saveRecordingAudio({ localDate, localTime, extension: ext, buffer });
    this.#logger.info?.('weekly-review.recording.audio-saved', { week, bytes: buffer.length });

    // Convert to mp3
    try {
      const convertStart = Date.now();
      const { size: mp3Size = 0 } = await this.#reviewStore.convertRecordingToMp3(audioArtifact, this.#runCommand);
      this.#logger.info?.('weekly-review.recording.mp3-converted', {
        week, mp3SizeKb: Math.round(mp3Size / 1024), durationMs: Date.now() - convertStart,
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
    this.#reviewStore.saveTranscript(
      week,
      transcriptData,
      { week, generatedAt: new Date().toISOString(), duration },
    );

    this.#logger.info?.('weekly-review.recording.transcript-saved', { week });
    this.#logger.info?.('weekly-review.recording.manifest-saved', { week });

    this.#logger.info?.('weekly-review.recording.saved', { week, duration, transcriptLength: transcriptClean?.length });

    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  async appendChunk({ sessionId, seq, week, buffer }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    if (typeof seq !== 'number' || seq < 0 || !Number.isInteger(seq)) throw new Error(`invalid seq: ${seq}`);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('buffer required');

    const result = this.#reviewStore.appendDraftChunk({
      sessionId,
      week,
      seq,
      buffer,
      nowIso: new Date().toISOString(),
    });

    this.#logger.info?.('weekly-review.chunk.appended', {
      sessionId, seq, bytes: buffer.length, totalBytes: result.totalBytes, week,
    });
    return result;
  }

  async appendEncodedChunk({ sessionId, seq, week, chunkBase64 }) {
    if (typeof chunkBase64 !== 'string' || chunkBase64.length === 0) throw new Error('chunkBase64 required');
    const buffer = Buffer.from(chunkBase64, 'base64');
    return { result: await this.appendChunk({ sessionId, seq, week, buffer }), byteLength: buffer.length };
  }

  async listDrafts(week) {
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    return this.#reviewStore.listDrafts(week);
  }

  async finalizeDraft({ sessionId, week, duration }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);

    const finalization = this.#reviewStore.beginFinalization(sessionId, week);
    const { buffer } = finalization;

    this.#logger.info?.('weekly-review.finalize.start', { sessionId, week, duration });

    // Move audio to final media location
    const now = new Date();
    const localDate = now.toLocaleDateString('en-CA', { timeZone: this.#timezone });
    const localTime = now.toLocaleTimeString('en-GB', { timeZone: this.#timezone, hour12: false }).replace(/:/g, '-');
    const audioArtifact = this.#reviewStore.saveRecordingAudio({ localDate, localTime, extension: 'webm', buffer });
    this.#logger.info?.('weekly-review.finalize.audio-saved', { sessionId, bytes: buffer.length });

    // Convert to mp3 (best-effort, matches saveRecording behavior)
    try {
      await this.#reviewStore.convertRecordingToMp3(audioArtifact, this.#runCommand);
      this.#logger.info?.('weekly-review.finalize.mp3-converted', { sessionId });
    } catch (err) {
      this.#logger.error?.('weekly-review.finalize.mp3-failed', { error: err.message });
    }

    // Transcribe
    const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
      mimeType: 'audio/webm',
      prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
    });

    // Save transcript + manifest (same format as saveRecording)
    this.#reviewStore.saveTranscript(
      week,
      { week, recordedAt: new Date().toISOString(), duration, transcriptRaw, transcriptClean },
      { week, generatedAt: new Date().toISOString(), duration },
    );

    // Delete the processing snapshot. The metadata file may be re-created by
    // concurrent chunk writes — leave it alone; the next finalize will manage it.
    this.#reviewStore.completeFinalization(finalization);

    this.#logger.info?.('weekly-review.finalize.complete', { sessionId, week, duration });
    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  async sweepStaleDrafts({ maxAgeDays = 30 } = {}) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const deleted = this.#reviewStore.sweepStaleDrafts(cutoff);
    if (deleted.length > 0) this.#logger.info?.('weekly-review.sweep.deleted', { count: deleted.length, sessionIds: deleted });
    return { deleted };
  }

  async discardDraft({ sessionId, week }) {
    if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    const existed = this.#reviewStore.discardDraft(sessionId, week);
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
      let status = this.#reviewStore.getRecordingStatus(week);
      // Until 2026-11-08 the default window was [today-8, today-1], so a review
      // recorded on the same day is keyed one day before today's window start.
      // Keep showing it rather than calling this week unrecorded.
      if (!status.exists) {
        const legacy = this.#reviewStore.getRecordingStatus(this.#addDays(week, -1));
        if (legacy.exists) status = { ...legacy, legacyWeek: this.#addDays(week, -1) };
      }
      if (status.exists) this.#logger.debug?.('weekly-review.recording-status.found', { week, recordedAt: status.recordedAt, duration: status.duration });
      else this.#logger.debug?.('weekly-review.recording-status.none', { week });
      return status;
    } catch (err) {
      this.#logger.warn?.('weekly-review.recording-status.error', { week, error: err.message });
    }
    return { exists: false };
  }

  #defaultWeekStart() {
    // The last 8 days INCLUDING today: [today-7, today]. The review is done on
    // the evening of the day it ends (Sunday), so today's photos belong in it.
    // (Before 2026-11-08 it was [today-8, today-1] and today never showed.)
    // 8 days, not 9: the client pages and lays out the grid in 8-day windows.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: this.#timezone });
    return this.#addDays(today, -7);
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
