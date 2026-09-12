/**
 * VoiceTranscriptionService
 *
 * Whisper transcription plus an optional tidy-up pass, for any caller who has
 * audio of a person speaking.
 *
 * This started life as `1_adapters/fitness/VoiceMemoTranscriptionService.mjs`.
 * Only two things in it were ever fitness-specific: the Whisper bias prompt and
 * the cleanup system prompt. Everything else — buffer/base64 handling, the
 * extension resolved from the MIME type, the Whisper call, the cleanup pass,
 * the duration estimate, and the lengths-never-contents logging — is generic,
 * so those two prompts moved out into a *profile* and the rest stayed here.
 *
 * WHY THE PROFILE IS NOT A DETAIL. The fitness profile's cleanup pass exists to
 * REPAIR a transcript ("thumbbells -> dumbbells"), which is right for a memo
 * shouted mid-workout. Run that same repair over a language learner's spoken
 * translation and the model tidies a wrong answer into a right one: the
 * evidence log then records comprehension that never happened and the
 * assessment measures nothing. Each caller must pick a profile deliberately;
 * there is no default.
 *
 * @see ./transcriptionProfiles/fitness.mjs
 * @see ./transcriptionProfiles/language.mjs
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';

const DEFAULT_SLUG = 'voice-transcription';
const DEFAULT_CLEANUP_OPTIONS = { temperature: 0.2, maxTokens: 1000 };

export class VoiceTranscriptionService {
  #openaiAdapter;
  #profile;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.openaiAdapter - OpenAIAdapter instance
   * @param {Object} config.profile - Transcription profile: `{ slug, whisperPrompt(context),
   *   cleanupPrompt, cleanupOptions?, emptyMarker? }`. Required — see the class
   *   comment for why a default would be dangerous.
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config?.openaiAdapter) {
      throw new InfrastructureError('openaiAdapter is required', {
        code: 'MISSING_CONFIG',
        field: 'openaiAdapter'
      });
    }
    if (!config?.profile) {
      throw new InfrastructureError('profile is required', {
        code: 'MISSING_CONFIG',
        field: 'profile'
      });
    }
    if (typeof config.profile.whisperPrompt !== 'function') {
      throw new InfrastructureError('profile.whisperPrompt must be a function', {
        code: 'INVALID_CONFIG',
        field: 'profile.whisperPrompt'
      });
    }
    this.#openaiAdapter = config.openaiAdapter;
    this.#profile = config.profile;
    this.#logger = config.logger || console;
  }

  /** The profile this instance was bound to. Handy for assertions and logs. */
  get profileName() {
    return this.#profile.slug || DEFAULT_SLUG;
  }

  /**
   * Transcribe a spoken recording.
   *
   * @param {Object} params
   * @param {Buffer} [params.audioBuffer] - Raw audio bytes. Preferred: the
   *   durable capture path already holds a Buffer and re-encoding it to base64
   *   only to decode it again doubles the memory for no gain.
   * @param {string} [params.audioBase64] - Base64-encoded audio data
   * @param {string} [params.mimeType] - Audio MIME type
   * @param {string} [params.sessionId] - Session ID for logging
   * @param {number} [params.startedAt] - Recording start timestamp
   * @param {number} [params.endedAt] - Recording end timestamp
   * @param {Object} [params.context] - Context the PROFILE turns into a Whisper
   *   bias prompt. The service never reads it: what a profile is willing to
   *   whisper to the recogniser is the profile's decision, and the language
   *   profile deliberately ignores everything but a language name and a
   *   register so that an expected answer cannot be smuggled through.
   * @returns {Promise<Object>} Transcript record
   */
  async transcribe({
    audioBuffer,
    audioBase64,
    mimeType,
    sessionId,
    startedAt,
    endedAt,
    context = {}
  }) {
    const buffer = Buffer.isBuffer(audioBuffer)
      ? audioBuffer
      // Strip the data URI prefix if present.
      : Buffer.from(String(audioBase64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');

    // Determine file extension
    const ext = this.#resolveExtension(mimeType);

    const slug = this.profileName;

    // Build the Whisper bias prompt from the bound profile.
    const whisperPrompt = this.#profile.whisperPrompt(context);

    this.#logger.debug?.(`${slug}.transcribe.start`, {
      sessionId,
      audioSize: buffer.length,
      extension: ext
    });

    // 1. Transcribe with Whisper
    const transcriptRaw = await this.#openaiAdapter.transcribe(buffer, {
      sessionId,
      filename: `${slug}.${ext}`,
      contentType: mimeType || 'audio/ogg',
      prompt: whisperPrompt
    });

    // Lengths, never contents. A transcript is what somebody said out loud —
    // a workout memo, or a child's voice answering a question. Shipping it to
    // the log store would put personal speech in a searchable index that
    // outlives the recording itself.
    this.#logger.info?.(`${slug}.whisper`, {
      sessionId,
      promptLength: whisperPrompt?.length ?? 0,
      transcriptLength: transcriptRaw?.length ?? 0,
      audioSize: buffer.length
    });

    // 2. Clean transcript with AI
    let transcriptClean = transcriptRaw;
    if (transcriptRaw) {
      try {
        transcriptClean = await this.#openaiAdapter.chat(
          [
            { role: 'system', content: this.#profile.cleanupPrompt },
            { role: 'user', content: transcriptRaw }
          ],
          this.#profile.cleanupOptions || DEFAULT_CLEANUP_OPTIONS
        );

        // Trim whitespace
        transcriptClean = transcriptClean?.trim() || transcriptRaw;

        this.#logger.info?.(`${slug}.gpt-cleanup`, {
          sessionId,
          rawLength: transcriptRaw?.length ?? 0,
          cleanLength: transcriptClean?.length ?? 0,
          isNoMemo: this.#isEmptyMarker(transcriptClean)
        });
      } catch (cleanErr) {
        this.#logger.error?.(`${slug}.gpt-cleanup-error`, {
          sessionId,
          error: cleanErr.message || String(cleanErr)
        });
      }
    }

    // Rough duration estimate via size (assuming ~32kbps opus -> 4KB/sec)
    const durationSeconds = Math.round(buffer.length / 4096) || null;

    return {
      sessionId: sessionId || null,
      transcriptRaw,
      transcriptClean,
      createdAt: Date.now(),
      startedAt: startedAt || null,
      endedAt: endedAt || null,
      durationSeconds
    };
  }

  /**
   * Legacy alias for {@link transcribe}.
   *
   * The fitness application layer calls its transcription port
   * `transcribeVoiceMemo` (FitnessVoiceMemoService, VoiceMemoRetryWorker and
   * every test double for them). Renaming that port is a wide, unrelated
   * change, and this task's contract is that nothing in fitness changes
   * behaviour — so the old name stays reachable until the port itself is
   * renamed.
   */
  transcribeVoiceMemo(params) {
    return this.transcribe(params);
  }

  /**
   * Does the cleaned text carry the profile's "there was nothing here" marker?
   * @private
   */
  #isEmptyMarker(text) {
    const marker = this.#profile.emptyMarker;
    if (!marker) return false;
    return String(text || '').toLowerCase().includes(marker.toLowerCase());
  }

  /**
   * Resolve file extension from MIME type
   * @private
   */
  #resolveExtension(mimeType) {
    if (!mimeType) return 'ogg';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'mp4';
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    return 'ogg';
  }

  /**
   * Check if service is configured
   */
  isConfigured() {
    return this.#openaiAdapter?.isConfigured?.() ?? true;
  }
}

export default VoiceTranscriptionService;
