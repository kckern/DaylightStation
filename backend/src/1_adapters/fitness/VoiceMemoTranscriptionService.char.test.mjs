/**
 * Characterisation test for the fitness voice-memo transcription path.
 *
 * Written BEFORE the service was generalised into
 * `1_adapters/ai/VoiceTranscriptionService.mjs` so that the move is provably
 * behaviour-preserving rather than hopefully so. It pins the three things a
 * refactor is most likely to drift on:
 *   1. the exact Whisper prompt (the fitness recognition bias),
 *   2. the filename extension chosen per MIME type,
 *   3. the exact shape of the returned memo object.
 *
 * It also pins the cleanup system prompt, because that prompt is what tells the
 * model to REPAIR the transcript ("thumbbells -> dumbbells"). That repair is
 * correct for a workout memo and catastrophic for a language assessment, so it
 * must stay attached to the fitness profile and travel nowhere else.
 */

import { describe, expect, it, vi } from 'vitest';
import { VoiceMemoTranscriptionService } from './VoiceMemoTranscriptionService.mjs';
import { buildTranscriptionContext } from './transcriptionContext.mjs';

function makeAdapter({ transcript = 'did twenty thumbbell curls', clean = 'did twenty dumbbell curls' } = {}) {
  return {
    transcribe: vi.fn().mockResolvedValue(transcript),
    chat: vi.fn().mockResolvedValue(clean),
    isConfigured: vi.fn().mockReturnValue(true)
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('VoiceMemoTranscriptionService (characterisation)', () => {
  it('requires an openaiAdapter', () => {
    expect(() => new VoiceMemoTranscriptionService({})).toThrow(/openaiAdapter is required/);
  });

  it('sends the fitness Whisper bias built from the session context', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const context = {
      currentShow: 'Nature Documentary',
      currentEpisode: 'Tide Pools',
      recentShows: ['Nature Documentary', 'Old Westerns'],
      householdMembers: ['test-learner'],
      activeUsers: ['test-learner']
    };

    await svc.transcribeVoiceMemo({
      audioBuffer: Buffer.alloc(8192, 1),
      mimeType: 'audio/ogg',
      sessionId: 'sess-1',
      context
    });

    const [buffer, options] = openaiAdapter.transcribe.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBe(8192);
    expect(options.prompt).toBe(buildTranscriptionContext(context));
    expect(options.prompt).toContain('Transcribe this description of a fitness workout');
    expect(options.prompt).toContain('Currently playing: Nature Documentary');
    expect(options.filename).toBe('voice-memo.ogg');
    expect(options.contentType).toBe('audio/ogg');
    expect(options.sessionId).toBe('sess-1');
  });

  it('sends the repairing cleanup prompt as the chat system message', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(100), mimeType: 'audio/ogg' });

    const [messages, opts] = openaiAdapter.chat.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(
      'You clean short voice memos recorded during fitness sessions. Remove duplicated words, filler like "uh", obvious transcription glitches. Keep numeric data and intent intact. Return ONLY the cleaned text - no commentary or additions. Fix obvious mistranscriptions (eg thumbbells -> dumbbells). ONLY respond with "[No Memo]" if the audio is literally silence, static noise, or completely unintelligible gibberish. If the person said actual words - even if unrelated to fitness - return those words cleaned up.'
    );
    expect(messages[1]).toEqual({ role: 'user', content: 'did twenty thumbbell curls' });
    expect(opts).toEqual({ temperature: 0.2, maxTokens: 1000 });
  });

  it.each([
    [undefined, 'ogg'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'mp4'],
    ['audio/m4a', 'mp4'],
    ['audio/mp3', 'mp3'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['application/octet-stream', 'ogg']
  ])('resolves %s to a .%s filename', async (mimeType, ext) => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10), mimeType });

    expect(openaiAdapter.transcribe.mock.calls[0][1].filename).toBe(`voice-memo.${ext}`);
    expect(openaiAdapter.transcribe.mock.calls[0][1].contentType).toBe(mimeType || 'audio/ogg');
  });

  it('accepts base64 audio, with or without a data URI prefix', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const raw = Buffer.from('hello-audio');
    await svc.transcribeVoiceMemo({ audioBase64: raw.toString('base64'), mimeType: 'audio/ogg' });
    await svc.transcribeVoiceMemo({
      audioBase64: `data:audio/ogg;base64,${raw.toString('base64')}`,
      mimeType: 'audio/ogg'
    });

    expect(openaiAdapter.transcribe.mock.calls[0][0].equals(raw)).toBe(true);
    expect(openaiAdapter.transcribe.mock.calls[1][0].equals(raw)).toBe(true);
  });

  it('returns the memo shape callers persist', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const result = await svc.transcribeVoiceMemo({
      audioBuffer: Buffer.alloc(4096 * 3),
      mimeType: 'audio/ogg',
      sessionId: 'sess-9',
      startedAt: 1000,
      endedAt: 5000
    });

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'durationSeconds',
      'endedAt',
      'sessionId',
      'startedAt',
      'transcriptClean',
      'transcriptRaw'
    ]);
    expect(result).toMatchObject({
      sessionId: 'sess-9',
      transcriptRaw: 'did twenty thumbbell curls',
      transcriptClean: 'did twenty dumbbell curls',
      startedAt: 1000,
      endedAt: 5000,
      durationSeconds: 3
    });
    expect(typeof result.createdAt).toBe('number');
  });

  it('nulls the optional fields and the duration when nothing is supplied', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const result = await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10) });

    expect(result.sessionId).toBeNull();
    expect(result.startedAt).toBeNull();
    expect(result.endedAt).toBeNull();
    // 10 bytes / 4096 rounds to 0, and `|| null` turns that into null.
    expect(result.durationSeconds).toBeNull();
  });

  it('falls back to the raw transcript when cleanup throws, and logs the error', async () => {
    const openaiAdapter = makeAdapter();
    openaiAdapter.chat.mockRejectedValue(new Error('gateway down'));
    const logger = makeLogger();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger });

    const result = await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10), sessionId: 's' });

    expect(result.transcriptClean).toBe('did twenty thumbbell curls');
    expect(logger.error).toHaveBeenCalledWith('voice-memo.gpt-cleanup-error', {
      sessionId: 's',
      error: 'gateway down'
    });
  });

  it('skips the cleanup call entirely when Whisper returned nothing', async () => {
    const openaiAdapter = makeAdapter({ transcript: '' });
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const result = await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10) });

    expect(openaiAdapter.chat).not.toHaveBeenCalled();
    expect(result.transcriptRaw).toBe('');
    expect(result.transcriptClean).toBe('');
  });

  it('keeps the raw transcript when cleanup returns only whitespace', async () => {
    const openaiAdapter = makeAdapter({ clean: '   ' });
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger: makeLogger() });

    const result = await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10) });

    expect(result.transcriptClean).toBe('did twenty thumbbell curls');
  });

  it('logs lengths, never contents - a transcript is somebody speaking out loud', async () => {
    const openaiAdapter = makeAdapter();
    const logger = makeLogger();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger });

    await svc.transcribeVoiceMemo({
      audioBuffer: Buffer.alloc(2048),
      mimeType: 'audio/webm',
      sessionId: 'sess-secret'
    });

    const emitted = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls
    ]);
    expect(emitted).not.toContain('thumbbell');
    expect(emitted).not.toContain('dumbbell');

    expect(logger.debug).toHaveBeenCalledWith('voice-memo.transcribe.start', {
      sessionId: 'sess-secret',
      audioSize: 2048,
      extension: 'webm'
    });
    expect(logger.info).toHaveBeenCalledWith('voice-memo.whisper', {
      sessionId: 'sess-secret',
      promptLength: expect.any(Number),
      transcriptLength: 26,
      audioSize: 2048
    });
    expect(logger.info).toHaveBeenCalledWith('voice-memo.gpt-cleanup', {
      sessionId: 'sess-secret',
      rawLength: 26,
      cleanLength: 25,
      isNoMemo: false
    });
  });

  it('flags the [No Memo] sentinel in the cleanup log', async () => {
    const openaiAdapter = makeAdapter({ clean: '[No Memo]' });
    const logger = makeLogger();
    const svc = new VoiceMemoTranscriptionService({ openaiAdapter, logger });

    await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(10) });

    expect(logger.info).toHaveBeenCalledWith(
      'voice-memo.gpt-cleanup',
      expect.objectContaining({ isNoMemo: true })
    );
  });

  it('reports configuration by delegating to the adapter', () => {
    const openaiAdapter = makeAdapter();
    openaiAdapter.isConfigured.mockReturnValue(false);
    expect(new VoiceMemoTranscriptionService({ openaiAdapter }).isConfigured()).toBe(false);

    // An adapter without the probe is treated as configured.
    expect(new VoiceMemoTranscriptionService({ openaiAdapter: { transcribe() {}, chat() {} } }).isConfigured()).toBe(true);
  });
});
