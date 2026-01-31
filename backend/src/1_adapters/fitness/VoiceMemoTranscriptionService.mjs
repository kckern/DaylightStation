/**
 * VoiceMemoTranscriptionService
 *
 * Wraps OpenAIAdapter to provide fitness-specific voice memo transcription.
 * Uses Whisper for transcription with fitness-biased prompts, then GPT-4o for cleanup.
 */

import { buildTranscriptionContext } from './transcriptionContext.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const CLEANUP_SYSTEM_PROMPT = 'You clean short voice memos recorded during fitness sessions. Remove duplicated words, filler like "uh", obvious transcription glitches. Keep numeric data and intent intact. Return ONLY the cleaned text - no commentary or additions. Fix obvious mistranscriptions (eg thumbbells -> dumbbells). ONLY respond with "[No Memo]" if the audio is literally silence, static noise, or completely unintelligible gibberish. If the person said actual words - even if unrelated to fitness - return those words cleaned up.';

export class VoiceMemoTranscriptionService {
  #openaiAdapter;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.openaiAdapter - OpenAIAdapter instance
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config?.openaiAdapter) {
      throw new InfrastructureError('openaiAdapter is required', {
        code: 'MISSING_CONFIG',
        field: 'openaiAdapter'
      });
    }
    this.#openaiAdapter = config.openaiAdapter;
    this.#logger = config.logger || console;
  }

  /**
   * Transcribe a voice memo with fitness-specific processing
   *
   * @param {Object} params
   * @param {string} params.audioBase64 - Base64-encoded audio data
   * @param {string} [params.mimeType] - Audio MIME type
   * @param {string} [params.sessionId] - Session ID for logging
   * @param {number} [params.startedAt] - Recording start timestamp
   * @param {number} [params.endedAt] - Recording end timestamp
   * @param {Object} [params.context] - Session context for transcription hints
   * @returns {Promise<Object>} Memo object with transcription
   */
  async transcribeVoiceMemo({
    audioBase64,
    mimeType,
    sessionId,
    startedAt,
    endedAt,
    context = {}
  }) {
    // Decode base64 (strip data URI prefix if present)
    const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine file extension
    const ext = this.#resolveExtension(mimeType);

    // Build Whisper prompt with fitness context
    const whisperPrompt = buildTranscriptionContext(context);

    this.#logger.debug?.('voice-memo.transcribe.start', {
      sessionId,
      audioSize: buffer.length,
      extension: ext
    });

    // 1. Transcribe with Whisper
    const transcriptRaw = await this.#openaiAdapter.transcribe(buffer, {
      filename: `voice-memo.${ext}`,
      contentType: mimeType || 'audio/ogg',
      prompt: whisperPrompt
    });

    this.#logger.info?.('voice-memo.whisper', {
      sessionId,
      whisperPrompt,
      transcriptRaw,
      audioSize: buffer.length
    });

    // 2. Clean transcript with GPT-4o
    let transcriptClean = transcriptRaw;
    if (transcriptRaw) {
      try {
        transcriptClean = await this.#openaiAdapter.chat(
          [
            { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
            { role: 'user', content: transcriptRaw }
          ],
          {
            model: 'gpt-4o',
            temperature: 0.2,
            maxTokens: 1000
          }
        );

        // Trim whitespace
        transcriptClean = transcriptClean?.trim() || transcriptRaw;

        this.#logger.info?.('voice-memo.gpt-cleanup', {
          sessionId,
          transcriptRaw,
          transcriptClean,
          isNoMemo: transcriptClean.toLowerCase().includes('no memo')
        });
      } catch (cleanErr) {
        this.#logger.error?.('voice-memo.gpt-cleanup-error', {
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

export default VoiceMemoTranscriptionService;
