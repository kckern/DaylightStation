/**
 * VoiceTranscriptionService — the generic service and its profiles.
 *
 * The fitness path's behaviour is pinned separately in
 * `VoiceTranscriptionService.fitnessProfile.char.test.mjs`. This file covers
 * the parts that are the point of the generalisation: that a profile is
 * required, that the service uses the one it was given, and — most of all —
 * the two ways the language profile could silently destroy an assessment.
 *
 * Both of those failures produce a system that looks like it is working
 * perfectly while measuring nothing at all, and neither shows up in a green
 * suite unless somebody writes the test that names the danger. These are
 * those tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { VoiceTranscriptionService } from './VoiceTranscriptionService.mjs';
import { fitnessTranscriptionProfile } from './transcriptionProfiles/fitness.mjs';
import { languageTranscriptionProfile } from './transcriptionProfiles/language.mjs';

function makeAdapter({ transcript = 'the weather are nice today', clean = 'the weather are nice today' } = {}) {
  return {
    transcribe: vi.fn().mockResolvedValue(transcript),
    chat: vi.fn().mockResolvedValue(clean),
    isConfigured: vi.fn().mockReturnValue(true)
  };
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('language profile: it must not repair what it heard', () => {
  // THE TRAP. The fitness profile's cleanup pass exists to fix mishearings
  // ("thumbbells -> dumbbells"). Run that over a learner's spoken translation
  // and the model tidies a wrong answer into a right one — the evidence log
  // then records comprehension that never happened.
  it('the language profile never asks the model to correct what it heard', () => {
    const p = languageTranscriptionProfile.cleanupPrompt.toLowerCase();
    for (const banned of ['fix', 'correct', 'mistranscription']) {
      expect(p).not.toContain(banned);
    }
  });

  it('also refuses the neighbouring words for the same instruction', () => {
    const p = languageTranscriptionProfile.cleanupPrompt.toLowerCase();
    for (const banned of ['repair', 'improve', 'rephrase', 'proper english', 'should have said']) {
      expect(p).not.toContain(banned);
    }
  });

  it('tells the model to leave the wording alone and return what was heard when unsure', () => {
    const p = languageTranscriptionProfile.cleanupPrompt.toLowerCase();
    expect(p).toContain('as heard');
    expect(p).toContain('never add a word they did not say');
  });

  it('does not inherit the fitness cleanup prompt', () => {
    expect(languageTranscriptionProfile.cleanupPrompt)
      .not.toBe(fitnessTranscriptionProfile.cleanupPrompt);
    // The fitness prompt is the one that repairs; it must stay in fitness.
    expect(fitnessTranscriptionProfile.cleanupPrompt.toLowerCase()).toContain('mistranscription');
  });

  it('samples the cleanup deterministically so the pass cannot invent a better answer', () => {
    expect(languageTranscriptionProfile.cleanupOptions.temperature).toBe(0);
  });
});

describe('language profile: the expected answer must never reach Whisper', () => {
  // THE OTHER TRAP. A Whisper `prompt` biases recognition toward the words in
  // it. Put the expected English sentence there and Whisper HEARS that
  // sentence regardless of what the learner said.
  it('the language profile does not leak the expected answer into the whisper prompt', () => {
    const prompt = languageTranscriptionProfile.whisperPrompt({
      expected: 'The weather is nice today.'
    });
    expect(prompt).not.toContain('weather');
  });

  it('ignores every unrecognised context field, whatever it is called', () => {
    const prompt = languageTranscriptionProfile.whisperPrompt({
      expected: 'The weather is nice today.',
      expectedEnglish: 'The weather is nice today.',
      answer: 'The weather is nice today.',
      target: 'The weather is nice today.',
      sentence: 'The weather is nice today.',
      prompt: 'The weather is nice today.',
      hints: ['weather', 'nice'],
      korean: '오늘 날씨가 좋아요.'
    });
    expect(prompt.toLowerCase()).not.toContain('weather');
    expect(prompt.toLowerCase()).not.toContain('nice');
    expect(prompt).not.toContain('오늘');
  });

  it('takes the language name but refuses a sentence smuggled in as one', () => {
    expect(languageTranscriptionProfile.whisperPrompt({ spokenLanguage: 'English' }))
      .toContain('in English');

    // A value that is not a plain language name is discarded, not trusted.
    const smuggled = languageTranscriptionProfile.whisperPrompt({
      spokenLanguage: 'English. The expected answer is: the weather is nice today.'
    });
    expect(smuggled.toLowerCase()).not.toContain('weather');
    expect(smuggled).toContain('in English');
  });

  it('takes a register by key, never as free text', () => {
    expect(languageTranscriptionProfile.whisperPrompt({ register: 'classroom' }))
      .toContain('simple classroom sentences');

    const freeText = languageTranscriptionProfile.whisperPrompt({
      register: 'sentences like "the weather is nice today"'
    });
    expect(freeText.toLowerCase()).not.toContain('weather');
    // Falls back to the default register rather than echoing the caller.
    expect(freeText).toContain('everyday conversational sentences');
  });

  it('still tells Whisper the speaker may be ungrammatical, so it does not smooth them out', () => {
    const prompt = languageTranscriptionProfile.whisperPrompt();
    expect(prompt.toLowerCase()).toContain('exactly the words they said');
  });

  it('carries the whole prompt through to the adapter untouched', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: languageTranscriptionProfile,
      logger: silentLogger
    });

    await svc.transcribe({
      audioBuffer: Buffer.alloc(64),
      mimeType: 'audio/webm',
      context: { expected: 'The weather is nice today.', spokenLanguage: 'English' }
    });

    const [, options] = openaiAdapter.transcribe.mock.calls[0];
    expect(options.prompt).not.toContain('weather');
    expect(options.filename).toBe('voice-answer.webm');

    const [messages] = openaiAdapter.chat.mock.calls[0];
    expect(messages[0].content).toBe(languageTranscriptionProfile.cleanupPrompt);
    // The learner's wrong answer reaches the cleanup pass as the user turn and
    // nothing else does — the expected sentence is never in the conversation.
    expect(JSON.stringify(messages)).not.toContain('The weather is nice today.');
  });
});

describe('VoiceTranscriptionService', () => {
  it('refuses to run without a profile - there is no safe default', () => {
    expect(() => new VoiceTranscriptionService({ openaiAdapter: makeAdapter() }))
      .toThrow(/profile is required/);
  });

  it('refuses a profile that cannot build a whisper prompt', () => {
    expect(() => new VoiceTranscriptionService({
      openaiAdapter: makeAdapter(),
      profile: { slug: 'x', cleanupPrompt: 'y' }
    })).toThrow(/profile\.whisperPrompt must be a function/);
  });

  it('names its log events and upload filename after the profile slug', async () => {
    const openaiAdapter = makeAdapter();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: languageTranscriptionProfile,
      logger
    });

    await svc.transcribe({ audioBuffer: Buffer.alloc(32), mimeType: 'audio/ogg', sessionId: 's1' });

    expect(svc.profileName).toBe('voice-answer');
    expect(logger.debug).toHaveBeenCalledWith('voice-answer.transcribe.start', expect.anything());
    expect(logger.info).toHaveBeenCalledWith('voice-answer.whisper', expect.anything());
    expect(logger.info).toHaveBeenCalledWith('voice-answer.gpt-cleanup', expect.anything());
    expect(openaiAdapter.transcribe.mock.calls[0][1].filename).toBe('voice-answer.ogg');
  });

  it('logs lengths, never contents - the recording is a child speaking', async () => {
    const openaiAdapter = makeAdapter({
      transcript: 'the weather are nice today',
      clean: 'the weather are nice today'
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: languageTranscriptionProfile,
      logger
    });

    await svc.transcribe({ audioBuffer: Buffer.alloc(32), sessionId: 'test-learner-attempt-1' });

    const emitted = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls
    ]);
    expect(emitted).not.toContain('weather');
    expect(emitted).toContain('"transcriptLength":26');
  });

  it('flags the profile empty marker rather than a hardcoded one', async () => {
    const openaiAdapter = makeAdapter({ clean: '[No Answer]' });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: languageTranscriptionProfile,
      logger
    });

    await svc.transcribe({ audioBuffer: Buffer.alloc(32) });

    expect(logger.info).toHaveBeenCalledWith(
      'voice-answer.gpt-cleanup',
      expect.objectContaining({ isNoMemo: true })
    );
  });

  it('uses the profile cleanup options', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: languageTranscriptionProfile,
      logger: silentLogger
    });

    await svc.transcribe({ audioBuffer: Buffer.alloc(32) });

    expect(openaiAdapter.chat.mock.calls[0][1]).toEqual({ temperature: 0, maxTokens: 1000 });
  });

  it('keeps the transcribeVoiceMemo alias the fitness port still calls', async () => {
    const openaiAdapter = makeAdapter();
    const svc = new VoiceTranscriptionService({
      openaiAdapter,
      profile: fitnessTranscriptionProfile,
      logger: silentLogger
    });

    const result = await svc.transcribeVoiceMemo({ audioBuffer: Buffer.alloc(32) });

    expect(openaiAdapter.transcribe).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('transcriptClean');
  });
});
