import path from 'path';
import fs from 'fs';
import { WeeklyReviewAggregator } from '../../2_domains/weekly-review/WeeklyReviewAggregator.mjs';

export class WeeklyReviewService {
  #dataPath;
  #mediaPath;
  #immichAdapter;
  #calendarData;
  #transcriptionService;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#dataPath = config.dataPath;
    this.#mediaPath = config.mediaPath;
    this.#immichAdapter = deps.immichAdapter;
    this.#calendarData = deps.calendarData;
    this.#transcriptionService = deps.transcriptionService;
    this.#logger = deps.logger || console;
  }

  async bootstrap(weekStart) {
    const start = weekStart || this.#defaultWeekStart();
    const end = this.#addDays(start, 7);

    this.#logger.info?.('weekly-review.bootstrap', { week: start });

    const [photoDays, calendarDays] = await Promise.all([
      this.#immichAdapter.getPhotosForDateRange(start, end),
      this.#calendarData.getEventsForDateRange(start, end),
    ]);

    const { days } = WeeklyReviewAggregator.aggregate(photoDays, calendarDays);
    const recording = this.#getRecordingStatus(start);

    return { week: start, days, recording };
  }

  async saveRecording({ audioBase64, mimeType, week, duration }) {
    if (!audioBase64) throw new Error('audioBase64 required');

    this.#logger.info?.('weekly-review.recording.start', { week, duration });

    const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Save audio to media volume
    const ext = mimeType === 'audio/ogg' ? 'ogg' : 'webm';
    const audioDir = path.join(this.#mediaPath, 'weekly-review', week);
    const audioPath = path.join(audioDir, `recording.${ext}`);

    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(audioPath, buffer);

    // Transcribe
    const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
      mimeType: mimeType || 'audio/webm',
      prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
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

    // Save manifest
    fs.writeFileSync(
      path.join(transcriptDir, 'manifest.yml'),
      JSON.stringify({ week, generatedAt: new Date().toISOString(), duration }, null, 2)
    );

    this.#logger.info?.('weekly-review.recording.saved', { week, duration, transcriptLength: transcriptClean?.length });

    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  #getRecordingStatus(week) {
    try {
      const transcriptPath = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, 'transcript.yml');
      if (fs.existsSync(transcriptPath)) {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        const data = JSON.parse(content);
        return { exists: true, recordedAt: data.recordedAt, duration: data.duration };
      }
    } catch {
      // No recording yet
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
