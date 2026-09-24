import { describe, it, expect, vi } from 'vitest';
import { VoiceCommandMatcher } from './VoiceCommandMatcher.mjs';

const kitchen = {
  target: 'kitchen-display',
  routing: { mode: 'confirm', confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.k' },
  },
};

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gatewayAnswering = (choice, confidence) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async () => ({ model: 'jev-test', answers: { command: { type: 'choice', choice, confidence, probabilities: {} } }, usage: {} })),
});

describe('VoiceCommandMatcher', () => {
  it('an exact keyword wins without calling the model', async () => {
    const gw = gatewayAnswering('lights_off', 0.99);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    expect(await m.match({ location: 'kitchen', transcript: 'Play jazz', locationConfig: kitchen }))
      .toMatchObject({ command: 'play_jazz', via: 'exact', reason: null });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });

  it('asks one choice over the commands plus none, with the transcript as state and a tight timeout', async () => {
    const gw = gatewayAnswering('play_jazz', 0.83);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    const out = await m.match({ location: 'kitchen', transcript: 'put some jazz on', locationConfig: kitchen });
    expect(out).toMatchObject({ command: 'play_jazz', via: 'jev', confidence: 0.83, reason: null });
    const [state, questions, options] = gw.evaluate.mock.calls[0];
    expect(state).toEqual({ said: 'put some jazz on' });
    expect(questions.command.type).toBe('choice');
    expect(Object.keys(questions.command.options)).toEqual(['play_jazz', 'lights_off', 'none']);
    expect(questions.command.options.play_jazz).toBe('Play jazz music');
    expect(options).toEqual({ timeout: 1500 });
  });

  it('below the floor is no match, logged as a near miss', async () => {
    const log = logger();
    const m = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('play_jazz', 0.4), logger: log });
    const out = await m.match({ location: 'kitchen', transcript: 'music maybe', locationConfig: kitchen });
    expect(out).toMatchObject({ command: null, reason: 'low-confidence', jevCommand: 'play_jazz' });
    expect(log.info).toHaveBeenCalledWith('trigger.voice.near_miss', expect.objectContaining({ location: 'kitchen', jevCommand: 'play_jazz', confidence: 0.4, floor: 0.6 }));
  });

  it('the per-location floor overrides the default', async () => {
    const m = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('play_jazz', 0.55), logger: logger() });
    const cfg = { ...kitchen, routing: { mode: 'confirm', confidenceFloor: 0.5 } };
    expect((await m.match({ location: 'kitchen', transcript: 'jazz?', locationConfig: cfg })).command).toBe('play_jazz');
  });

  it('none and out-of-set answers are no match', async () => {
    const none = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('none', 0.95), logger: logger() });
    expect(await none.match({ location: 'kitchen', transcript: 'what time is it', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'none' });
    const odd = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('toString', 0.95), logger: logger() });
    expect(await odd.match({ location: 'kitchen', transcript: 'x', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'outside-options' });
  });

  it('a failing or absent model is no match and never throws', async () => {
    const log = logger();
    const failing = { isConfigured: () => true, evaluate: vi.fn(async () => { throw new Error('timeout of 1500ms exceeded'); }) };
    const m = new VoiceCommandMatcher({ decisionGateway: failing, logger: log });
    expect(await m.match({ location: 'kitchen', transcript: 'jazz', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'decision-failed' });
    expect(log.warn).toHaveBeenCalledWith('trigger.voice.decision_failed', expect.objectContaining({ location: 'kitchen' }));

    const noop = new VoiceCommandMatcher({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() }, logger: logger() });
    expect(await noop.match({ location: 'kitchen', transcript: 'jazz', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'no-decision-model' });
  });

  it('useModel:false skips the model', async () => {
    const gw = gatewayAnswering('play_jazz', 0.99);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    expect(await m.match({ location: 'kitchen', transcript: 'jazz please', locationConfig: kitchen, useModel: false }))
      .toMatchObject({ command: null, reason: 'model-off' });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });
});

describe('VoiceCommandMatcher prototype keys', () => {
  it.each(['constructor', 'Constructor', '__proto__', 'toString'])('%s is not an exact match', async (word) => {
    const m = new VoiceCommandMatcher({ decisionGateway: null, logger: logger() });
    expect(await m.match({ location: 'kitchen', transcript: word, locationConfig: kitchen }))
      .toMatchObject({ command: null, via: null });
  });
});
