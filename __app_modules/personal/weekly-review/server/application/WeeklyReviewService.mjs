import { WeeklyReviewAggregator } from "../domain/WeeklyReviewAggregator.mjs";
import { curateSchoolWork } from "../domain/schoolWorkPolicy.mjs";
import { buildShowcases } from "../domain/schoolShowcasePolicy.mjs";
import { studyWindowInstants, hasWeekWins } from "../domain/learnerWinsPolicy.mjs";

export class WeeklyReviewService {
  #immichAdapter;
  #calendarData;
  #sessionService;
  #weatherStore;
  #schoolWork;
  #schoolShowcase;
  #schoolTimeoutMs;
  #learnerWins;
  #learners;
  #winsTimeoutMs;
  #setTimer;
  #clearTimer;
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
    this.#schoolWork = deps.schoolWork || null;
    this.#schoolShowcase = deps.schoolShowcase && typeof deps.schoolShowcase.execute === 'function' ? deps.schoolShowcase : null;
    // Injected timers (apps-no-global-timers); the defaults are the real ones.
    this.#setTimer = deps.setTimer || setTimeout;
    this.#clearTimer = deps.clearTimer || clearTimeout;
    this.#schoolTimeoutMs = Number.isFinite(deps.schoolTimeoutMs) && deps.schoolTimeoutMs > 0 ? deps.schoolTimeoutMs : 8000;
    // Each child's wins (silver, gems, rings) on their own showcase slide.
    this.#learnerWins = deps.learnerWins && typeof deps.learnerWins.execute === 'function' ? deps.learnerWins : null;
    this.#learners = typeof deps.learners === 'function' ? deps.learners : null;
    this.#winsTimeoutMs = Number.isFinite(deps.winsTimeoutMs) && deps.winsTimeoutMs > 0 ? deps.winsTimeoutMs : 6000;
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

    const dates = this.#windowDates(start);
    const winsRun = this.#startWins(start, dates);

    let photoDays, calendarDays, fitnessByDate, weatherByDate, schoolItems;
    try {
      [photoDays, calendarDays, fitnessByDate, weatherByDate, schoolItems] = await Promise.all([
        this.#immichAdapter.getPhotosForDateRange(start, end),
        this.#calendarData.getEventsForDateRange(start, end),
        this.#fetchFitnessSessions(dates),
        this.#fetchWeatherHistory(dates),
        this.#fetchSchoolItems(start, dates),
      ]);
    } catch (err) {
      winsRun?.cancel();
      throw err;
    }
    const schoolByDate = this.#curateSchool(start, dates, schoolItems);
    // The instant (plain) per-child showcase; AI bullets come from getSchoolShowcase.
    const schoolShowcase = await this.#withWins(start, this.#plainShowcase(start, dates, schoolItems), winsRun);

    const { days } = WeeklyReviewAggregator.aggregate(photoDays, calendarDays, fitnessByDate, weatherByDate, schoolByDate);
    const recording = this.#getRecordingStatus(start);

    this.#logger.info?.('weekly-review.bootstrap.complete', {
      week: start,
      durationMs: Date.now() - bootstrapStart,
      dayCount: days.length,
      totalPhotos: photoDays.reduce((s, d) => s + (d.photoCount || 0), 0),
    });

    return { week: start, days, recording, schoolShowcase };
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

  /**
   * A course or activity picture for a school work card, or null.
   * @param {string} ref `course:<id>` or `activity:<issuanceId>`
   */
  async getSchoolImage(ref) {
    if (!this.#schoolWork) return null;
    const img = await this.#schoolWork.getImage(ref);
    if (!img?.bytes || typeof img.contentType !== 'string' || !/^image\//.test(img.contentType)) return null;
    return img;
  }

  /**
   * The per-child school showcase for a window, with AI-drafted bullets where
   * the gateway gives acceptable ones and plain bullets otherwise.
   * @param {string} week YYYY-MM-DD window start
   * @returns {Promise<{ learnerId: string, learnerName: string, bullets: string[], images: string[], source: 'ai'|'plain' }[]>}
   */
  async getSchoolShowcase(week) {
    if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
    const dates = this.#windowDates(week);
    const winsRun = this.#startWins(week, dates);
    let settled;
    try {
      const items = await this.#fetchSchoolItems(week, dates);
      const plain = buildShowcases(items || [], dates);
      settled = this.#schoolShowcase && plain.length > 0
        ? await this.#schoolShowcase.execute(week, plain)
        : plain;
    } catch (err) {
      winsRun?.cancel();
      throw err;
    }
    const trimmed = settled.map(({ learnerId, learnerName, bullets, images, source }) => ({ learnerId, learnerName, bullets, images, source }));
    return this.#withWins(week, trimmed, winsRun);
  }

  /**
   * Start the roster's wins while the rest of the window loads, under ONE
   * deadline (`winsTimeoutMs`) that covers the roster read, the roster's wins
   * and any second fetch for a child with work who is not on the roster. Past
   * it, whatever has not answered is left out. Null without a wins source.
   * `first` never rejects: it resolves `{ roster, wins }`, `{ timedOut }` or
   * `{ error }`. The caller must `cancel()` when done.
   */
  #startWins(week, dates) {
    if (!this.#learnerWins) return null;
    const ms = this.#winsTimeoutMs;
    const TIMED_OUT = Symbol('timeout');
    let timer;
    const deadline = new Promise(resolve => { timer = this.#setTimer(() => resolve(TIMED_OUT), ms); });
    const window = studyWindowInstants(dates, this.#timezone);
    const fetch = (learnerIds) => (learnerIds.length === 0 || !window
      ? Promise.resolve({})
      : Promise.resolve(this.#learnerWins.execute({ learnerIds, dates, windowStartMs: window.startMs, windowEndMs: window.endMs }))
        .then(w => (w && typeof w === 'object' ? w : {})));
    const race = (promise) => Promise.race([promise, deadline]).then(
      v => (v === TIMED_OUT ? { timedOut: true } : { value: v }),
      error => ({ error }),
    );
    const first = race((async () => {
      const roster = await this.#roster();
      return { roster, wins: await fetch(roster.map(l => l.id)) };
    })());
    return {
      first,
      more: (learnerIds) => race(fetch(learnerIds)),
      timedOut: () => this.#logger.warn?.('weekly-review.wins.timeout', { week, ms }),
      cancel: () => this.#clearTimer(timer),
    };
  }

  /** `[{id, name}]` from the injected roster; empty (with a warning) when it fails. */
  async #roster() {
    if (!this.#learners) return [];
    try {
      const list = await this.#learners();
      return (Array.isArray(list) ? list : [])
        .filter(l => l && typeof l.id === 'string' && l.id)
        .map(l => ({ id: l.id, name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : l.id }));
    } catch (err) {
      this.#logger.warn?.('weekly-review.wins.roster-failed', { error: err.message });
      return [];
    }
  }

  /**
   * Put each child's own wins on their own showcase, and add a wins-only
   * showcase for a child with something earned this week but no school work.
   * Without wins (no source, failure, timeout) the showcases come back as
   * they were. Never throws.
   */
  async #withWins(week, showcases, run) {
    if (!run) return showcases;
    try {
      const first = await run.first;
      if (first.timedOut) { run.timedOut(); return showcases; }
      if (first.error) { this.#logger.warn?.('weekly-review.wins.error', { week, error: first.error.message }); return showcases; }
      const { roster } = first.value;
      const wins = { ...first.value.wins };
      const missing = showcases.map(s => s.learnerId).filter(id => !(id in wins));
      if (missing.length > 0) {
        const more = await run.more(missing);
        if (more.timedOut) run.timedOut();
        else if (more.error) this.#logger.warn?.('weekly-review.wins.error', { week, error: more.error.message });
        else Object.assign(wins, more.value);
      }

      const names = new Map(roster.map(l => [l.id, l.name]));
      const shown = new Set(showcases.map(s => s.learnerId));
      const out = showcases.map(s => (wins[s.learnerId] ? { ...s, wins: wins[s.learnerId] } : s));
      for (const [learnerId, learnerWins] of Object.entries(wins)) {
        if (shown.has(learnerId) || !hasWeekWins(learnerWins)) continue;
        out.push({ learnerId, learnerName: names.get(learnerId) || learnerId, bullets: [], images: [], source: 'plain', wins: learnerWins });
      }
      return out.sort((a, b) => a.learnerName.localeCompare(b.learnerName) || a.learnerId.localeCompare(b.learnerId));
    } catch (err) {
      this.#logger.warn?.('weekly-review.wins.error', { week, error: err.message });
      return showcases;
    } finally {
      run.cancel();
    }
  }

  /**
   * The window's raw school WorkItems, or null when there is no school source
   * or it failed. School's range end is exclusive, so it is asked for up to
   * the day after the last date shown. Never throws and never holds the
   * review up past the timeout.
   */
  async #fetchSchoolItems(week, dates) {
    if (!this.#schoolWork || dates.length === 0) return null;
    const from = dates[0];
    const to = this.#addDays(dates[dates.length - 1], 1);
    const ms = this.#schoolTimeoutMs;
    const TIMED_OUT = Symbol('timeout');
    let timer;
    try {
      const items = await Promise.race([
        this.#schoolWork.getWorkForDateRange(from, to),
        new Promise(resolve => { timer = this.#setTimer(() => resolve(TIMED_OUT), ms); }),
      ]);
      if (items === TIMED_OUT) {
        this.#logger.warn?.('weekly-review.school.timeout', { week, ms });
        return null;
      }
      return Array.isArray(items) ? items : [];
    } catch (err) {
      this.#logger.warn?.('weekly-review.school.error', { error: err.message });
      return null;
    } finally {
      this.#clearTimer(timer);
    }
  }

  /** Plain showcases for bootstrap, without the AI-only fields. A bad item never fails the review. */
  #plainShowcase(week, dates, list) {
    try {
      return buildShowcases(list || [], dates).map(({ items: _items, itemsHash: _hash, ...rest }) => rest);
    } catch (err) {
      this.#logger.warn?.('weekly-review.showcase.plain-failed', { week, error: err.message });
      return [];
    }
  }

  /** School work curated onto days; empty when the school source was absent or failed. */
  #curateSchool(week, dates, list) {
    if (list === null) return {};
    let byDate;
    try {
      byDate = curateSchoolWork(list, dates);
    } catch (err) {
      this.#logger.warn?.('weekly-review.school.error', { error: err.message });
      return {};
    }
    const inWindow = new Set(dates);
    const kept = list.filter(i => i && inWindow.has(i.studyDay));
    const byKind = {};
    for (const item of list) {
      if (!item) continue;
      byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    }
    this.#logger.info?.('weekly-review.school.loaded', {
      week,
      learners: new Set(kept.map(i => i.learnerId)).size,
      items: list.length,
      shown: Object.values(byDate).reduce((n, d) => n + d.school.length, 0),
      byKind,
    });
    return byDate;
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

  /** The window's days, `start` through `start + 7` inclusive (8 days, matching the adapter). */
  #windowDates(start) {
    const dates = [];
    for (let i = 0; i <= 7; i++) dates.push(this.#addDays(start, i));
    return dates;
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
