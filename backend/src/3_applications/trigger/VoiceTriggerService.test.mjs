import { describe, it, expect, vi } from 'vitest';
import { VoiceTriggerService } from './VoiceTriggerService.mjs';
import { TriggerDispatchService } from './TriggerDispatchService.mjs';

const kitchen = (mode = 'confirm', auth_token = null) => ({
  target: 'kitchen-display',
  auth_token,
  routing: { mode, confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.kitchen_off' },
  },
});
// garage is a second, valid voice location so a proposal made in the kitchen
// can be confirmed against the wrong (but real) location.
const configWith = (loc) => ({ voice: { locations: { kitchen: loc, garage: kitchen() } } });
const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const matcherReturning = (m) => ({ match: vi.fn(async () => m) });
const dispatcher = () => ({ handleTrigger: vi.fn(async (location, modality, value) => ({ ok: true, location, modality, value, action: 'play' })) });

function make({ loc = kitchen(), match = { command: 'play_jazz', via: 'jev', confidence: 0.8, reason: null }, now = { t: 1000 } } = {}) {
  const triggerDispatchService = dispatcher();
  const matcher = matcherReturning(match);
  const logger = silent();
  let n = 0;
  const service = new VoiceTriggerService({
    config: configWith(loc), matcher, triggerDispatchService, logger,
    createProposalId: () => `p${++n}`, clock: () => now.t,
  });
  return { service, matcher, triggerDispatchService, logger, now };
}

describe('VoiceTriggerService.handleTranscript', () => {
  it('rejects empty and oversized transcripts before anything else', async () => {
    const { service, matcher } = make();
    expect((await service.handleTranscript('kitchen', '   ')).code).toBe('INVALID_TRANSCRIPT');
    expect((await service.handleTranscript('kitchen', 'x'.repeat(501))).code).toBe('INVALID_TRANSCRIPT');
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it('unknown location and bad token never reach the model', async () => {
    const { service, matcher } = make({ loc: kitchen('confirm', 'secret') });
    expect((await service.handleTranscript('attic', 'jazz')).code).toBe('LOCATION_NOT_FOUND');
    expect((await service.handleTranscript('kitchen', 'jazz', { token: 'nope' })).code).toBe('AUTH_FAILED');
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it('an exact match dispatches in every mode, through handleTrigger', async () => {
    const { service, triggerDispatchService } = make({ match: { command: 'play_jazz', via: 'exact', confidence: null, reason: null } });
    const out = await service.handleTranscript('kitchen', 'play jazz', { token: 't' });
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: 't', dryRun: undefined });
    expect(out).toMatchObject({ ok: true, voice: { transcript: 'play jazz', command: 'play_jazz', via: 'exact' } });
  });

  it('confirm mode turns a model match into a proposal and dispatches nothing', async () => {
    const { service, triggerDispatchService, logger } = make();
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(triggerDispatchService.handleTrigger).not.toHaveBeenCalled();
    expect(out).toEqual({
      ok: true, confirm: true, location: 'kitchen',
      proposal: { id: 'p1', command: 'play_jazz', description: 'Play jazz music', confidence: 0.8, expiresInMs: 120000 },
    });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.proposed', expect.objectContaining({ proposalId: 'p1', location: 'kitchen', command: 'play_jazz', confidence: 0.8 }));
  });

  it('route mode dispatches a model match directly', async () => {
    const { service, triggerDispatchService } = make({ loc: kitchen('route') });
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: undefined, dryRun: undefined });
    expect(out.voice).toEqual({ transcript: 'put some jazz on', command: 'play_jazz', via: 'jev', confidence: 0.8 });
  });

  it('off mode asks the matcher for exact keywords only', async () => {
    const { service, matcher } = make({ loc: kitchen('off'), match: { command: null, via: null, confidence: null, reason: 'model-off' } });
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(matcher.match).toHaveBeenCalledWith(expect.objectContaining({ useModel: false }));
    expect(out).toMatchObject({ ok: false, code: 'VOICE_NO_MATCH', reason: 'model-off' });
  });

  it('no match answers VOICE_NO_MATCH with the reason', async () => {
    const { service, logger } = make({ match: { command: null, via: null, confidence: 0.3, reason: 'low-confidence', jevCommand: 'play_jazz' } });
    const out = await service.handleTranscript('kitchen', 'hmm');
    expect(out).toMatchObject({ ok: false, code: 'VOICE_NO_MATCH', reason: 'low-confidence', location: 'kitchen' });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.no_match', expect.objectContaining({ location: 'kitchen', reason: 'low-confidence' }));
  });
});

describe('VoiceTriggerService.confirm', () => {
  it('dispatches the stored command once and logs the confirmation', async () => {
    const { service, triggerDispatchService, logger, now } = make();
    await service.handleTranscript('kitchen', 'put some jazz on');
    now.t += 5000;
    const out = await service.confirm('kitchen', 'p1', { token: 't' });
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: 't' });
    expect(out).toMatchObject({ ok: true, voice: { command: 'play_jazz', via: 'jev', confidence: 0.8, proposalId: 'p1' } });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.confirmed', expect.objectContaining({ proposalId: 'p1', command: 'play_jazz', latencyMs: 5000, ok: true }));
    expect((await service.confirm('kitchen', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
  });

  it('refuses expired, unknown and wrong-location proposals', async () => {
    const { service, now } = make();
    await service.handleTranscript('kitchen', 'jazz');
    expect((await service.confirm('garage', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
    expect((await service.confirm('attic', 'p1')).code).toBe('LOCATION_NOT_FOUND');
    now.t += 120001;
    expect((await service.confirm('kitchen', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
    expect((await service.confirm('kitchen', 'nope')).code).toBe('PROPOSAL_NOT_FOUND');
  });

  it('checks the token before consuming the proposal', async () => {
    const { service, triggerDispatchService } = make({ loc: kitchen('confirm', 'secret') });
    await service.handleTranscript('kitchen', 'jazz', { token: 'secret' });
    expect((await service.confirm('kitchen', 'p1', { token: 'bad' })).code).toBe('AUTH_FAILED');
    expect((await service.confirm('kitchen', 'p1', { token: 'secret' })).ok).toBe(true);
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledTimes(1);
  });
});

describe('voice through the real dispatch pipeline', () => {
  it('a routed transcript activates the configured scene and broadcasts on trigger:kitchen:voice', async () => {
    const activateScene = vi.fn(async () => ({ ok: true }));
    const actuationGateway = {
      clearDevice: vi.fn(), openDevice: vi.fn(), activateScene, invokeHomeAction: vi.fn(),
      sendTransport: vi.fn(() => ({ handled: false })), sendNotification: vi.fn(),
      disableAutomation: vi.fn(), enableAutomation: vi.fn(),
    };
    const broadcast = vi.fn();
    const config = configWith(kitchen('route'));
    const triggerDispatchService = new TriggerDispatchService({
      config, contentIdResolver: { resolve: () => null }, wakeAndLoadService: { execute: vi.fn() },
      actuationGateway, broadcast, logger: silent(),
      createDispatchId: () => 'd1', scheduler: { after: () => () => {} },
    });
    const service = new VoiceTriggerService({
      config, triggerDispatchService, logger: silent(), createProposalId: () => 'p1',
      matcher: matcherReturning({ command: 'lights_off', via: 'jev', confidence: 0.9, reason: null }),
    });

    const out = await service.handleTranscript('kitchen', 'kill the lights in here');

    expect(out.ok).toBe(true);
    expect(activateScene).toHaveBeenCalledWith('scene.kitchen_off');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ topic: 'trigger:kitchen:voice', value: 'lights_off', ok: true }));
  });
});

describe('prototype keys through the real matcher', () => {
  it.each(['constructor', '__proto__', 'toString'])('%s answers VOICE_NO_MATCH and dispatches nothing', async (word) => {
    const { VoiceCommandMatcher } = await import('./VoiceCommandMatcher.mjs');
    const triggerDispatchService = dispatcher();
    const service = new VoiceTriggerService({
      config: configWith(kitchen('route')), triggerDispatchService, logger: silent(), createProposalId: () => 'p1',
      matcher: new VoiceCommandMatcher({ decisionGateway: null, logger: silent() }),
    });
    expect((await service.handleTranscript('kitchen', word)).code).toBe('VOICE_NO_MATCH');
    expect(triggerDispatchService.handleTrigger).not.toHaveBeenCalled();
  });
});

describe('dryRun in confirm mode', () => {
  it('returns the would-be proposal marked dryRun and stores nothing', async () => {
    const { service, triggerDispatchService, logger } = make();
    const out = await service.handleTranscript('kitchen', 'put some jazz on', { dryRun: true });
    expect(out).toEqual({
      ok: true, confirm: true, dryRun: true, location: 'kitchen',
      proposal: { id: null, command: 'play_jazz', description: 'Play jazz music', confidence: 0.8, expiresInMs: 120000 },
    });
    expect(logger.info).not.toHaveBeenCalledWith('trigger.voice.proposed', expect.anything());
    // Nothing was stored: the id a real proposal would have taken is unused.
    expect((await service.confirm('kitchen', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
    expect(triggerDispatchService.handleTrigger).not.toHaveBeenCalled();
  });
});

describe('voice values share one debounce key', () => {
  it('GET "lights off" and a transcript "Lights Off" debounce as the same trigger', async () => {
    const actuationGateway = {
      clearDevice: vi.fn(), openDevice: vi.fn(), activateScene: vi.fn(async () => ({ ok: true })), invokeHomeAction: vi.fn(),
      sendTransport: vi.fn(() => ({ handled: false })), sendNotification: vi.fn(),
      disableAutomation: vi.fn(), enableAutomation: vi.fn(),
    };
    const broadcast = vi.fn();
    const config = configWith(kitchen('route'));
    const triggerDispatchService = new TriggerDispatchService({
      config, contentIdResolver: { resolve: () => null }, wakeAndLoadService: { execute: vi.fn() },
      actuationGateway, broadcast, logger: silent(),
      createDispatchId: () => 'd1', scheduler: { after: () => () => {} },
    });
    const { VoiceCommandMatcher } = await import('./VoiceCommandMatcher.mjs');
    const service = new VoiceTriggerService({
      config, triggerDispatchService, logger: silent(), createProposalId: () => 'p1',
      matcher: new VoiceCommandMatcher({ decisionGateway: null, logger: silent() }),
    });

    const first = await triggerDispatchService.handleTrigger('kitchen', 'voice', 'lights off');
    expect(first).toMatchObject({ ok: true, value: 'lights_off' });
    const second = await service.handleTranscript('kitchen', 'Lights Off');
    expect(second).toMatchObject({ ok: true, debounced: true, value: 'lights_off' });
    expect(actuationGateway.activateScene).toHaveBeenCalledTimes(1);
  });
});
