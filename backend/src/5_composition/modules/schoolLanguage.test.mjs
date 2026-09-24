// backend/src/5_composition/modules/schoolLanguage.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createLanguageStudyService } from './schoolLanguage.mjs';

const CORPUS = {
  id: 'contract-korean', label: 'Contract Korean', languages: { source: 'EN', target: 'KR' },
  audio_base: 'apps/school/language/contract-korean',
  sentences: [{ seq: 1, text: { EN: "The weather's nice today.", KR: '오늘 날씨가 좋아요.' } }],
};

function build({ decisionGateway, meaningJudgeConfig, logger = { info() {}, warn() {}, debug() {}, error() {} } } = {}) {
  const events = [];
  const now = Date.now();
  const chain = ['repetition', 'dictation', 'recording'];
  chain.forEach((rung, i) => events.push({
    at: new Date(now - (chain.length - i) * 86_400_000).toISOString(), day: i + 1, seq: 1, rung, attributedTo: 'learner',
  }));
  let progress = { corpus: CORPUS.id, day: 4, daily_limit: 5, last_activity: null };
  const datastore = {
    listCorpusIds: () => [CORPUS.id], readCorpus: (id) => (id === CORPUS.id ? CORPUS : null),
    readProgress: () => progress, writeProgress: (_u, _c, next) => { progress = next; return next; },
    appendEvent: (_u, _c, e) => { events.push(e); return e; }, readAllEvents: () => events,
    listRecordingKeys: () => new Set(), resolveAudioPath: (c, s, l) => `/m/${c}/${s}-${l}.mp3`,
  };
  const service = createLanguageStudyService({
    datastore, eventBus: { publish: vi.fn(), subscribe: vi.fn() }, timezone: 'UTC',
    decisionGateway, meaningJudgeConfig,
    logger,
  });
  return (given) => service.submitAttempt({
    userId: 'learner', corpusId: CORPUS.id, seq: 1, rung: 'interpretation', given,
    capabilities: { microphone: true, textInput: ['EN', 'KR'] },
  });
}

const jev = () => ({
  isConfigured: () => true,
  evaluate: vi.fn(async () => ({ model: 'jev-x', answers: { meaning: { type: 'score', score: 3, confidence: 0.9, probabilities: [] } } })),
});

describe('createLanguageStudyService — meaning judge wiring', () => {
  it('wires the judge when a decision gateway is configured', async () => {
    const gateway = jev();
    const event = await build({ decisionGateway: gateway })('today the weather is nice');
    expect(gateway.evaluate).toHaveBeenCalledTimes(1);
    expect(event.meaning).toMatchObject({ level: 3, score: 0.75, judge: 'model', model: 'jev-x' });
  });

  it('records the old row without a gateway, or when the school config turns it off', async () => {
    expect(await build({})('today the weather is nice')).not.toHaveProperty('meaning');
    const gateway = jev();
    const off = await build({ decisionGateway: gateway, meaningJudgeConfig: { enabled: false } })('today the weather is nice');
    expect(off).not.toHaveProperty('meaning');
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  it('passes a configured deadline through', async () => {
    const gateway = jev();
    await build({ decisionGateway: gateway, meaningJudgeConfig: { timeout_ms: 900 } })('today the weather is nice');
    expect(gateway.evaluate.mock.calls[0][2]).toEqual({ timeout: 900 });
  });

  it('clamps an out-of-range or non-numeric deadline to the default, with one warning', async () => {
    for (const timeout_ms of [50, 60_000, 'soon', -1, Infinity]) {
      const gateway = jev();
      const logger = { info() {}, warn: vi.fn(), debug() {}, error() {} };
      await build({ decisionGateway: gateway, meaningJudgeConfig: { timeout_ms }, logger })('today the weather is nice');
      expect(gateway.evaluate.mock.calls[0][2]).toEqual({ timeout: 1500 });
      const warns = logger.warn.mock.calls.filter(([event]) => event === 'school.language.meaning-judge.timeout-invalid');
      expect(warns).toEqual([['school.language.meaning-judge.timeout-invalid', { timeout_ms, min: 100, max: 5000, using: 1500 }]]);
    }
  });

  it('keeps an in-range deadline without warning', async () => {
    const gateway = jev();
    const logger = { info() {}, warn: vi.fn(), debug() {}, error() {} };
    await build({ decisionGateway: gateway, meaningJudgeConfig: { timeout_ms: 100 }, logger })('today the weather is nice');
    expect(gateway.evaluate.mock.calls[0][2]).toEqual({ timeout: 100 });
    expect(logger.warn).not.toHaveBeenCalledWith('school.language.meaning-judge.timeout-invalid', expect.anything());
  });
});
