import { describe, it, expect, vi } from 'vitest';
import { CoachingCommentaryService } from '../../../__app_modules/wellness/health/server/application/coaching/CoachingCommentaryService.mjs';
import { renderObservation } from '../../../__app_modules/wellness/health/server/application/coaching/observationText.mjs';

const candidate = (id, priority) => ({ id, kind: 'protein_gap', date: '2026-10-24', evidenceDates: ['2026-10-24'], priority, fingerprint: id, facts: { protein: 105, proteinGoal: 150, proteinGap: 45 } });
const high = candidate('protein_gap:day:2026-10-24', 90);
const low = candidate('protein_gap:other:2026-10-24', 20);
const snapshot = (extra = {}) => ({ userId: 'user-1', type: 'morning-brief', date: '2026-10-25', observations: [low, high], recent_coaching: [], ...extra });
const setup = response => {
  const runtime = { execute: vi.fn().mockResolvedValue({ output: response }) };
  const service = new CoachingCommentaryService({ runtime, logger: { debug: vi.fn(), warn: vi.fn() } });
  return { service, runtime };
};

describe('supported commentary selection', () => {
  it('returns only the offered selected observation, including authoritative facts', async () => {
    const { service, runtime } = setup(JSON.stringify({ observationId: low.id }));
    expect(await service.generate(snapshot())).toEqual(low);
    expect(runtime.execute.mock.calls[0][0].context.userId).toBe('user-1');
  });
  it.each(['not json', '{"observationId":"unknown"}', '{"observationId":123}', '{"observationId":"protein_gap:other:2026-10-24","text":"999g protein target met"}', '999g protein target met', '[]', '{}'])('falls back from malformed or unsupported selection: %s', async output => {
    const { service } = setup(output);
    const selected = await service.generate(snapshot());
    expect(selected).toEqual(high);
    expect(renderObservation(selected)).toContain('45g below your 150g target');
    expect(renderObservation(selected)).not.toMatch(/999|target met/);
  });
  it('allows explicit null to choose silence', async () => {
    const { service } = setup('{"observationId":null}');
    expect(await service.generate(snapshot())).toBeNull();
  });
  it('uses unseen eligible fallback when a provider times out', async () => {
    const { service, runtime } = setup('');
    runtime.execute.mockRejectedValue(new Error('timeout'));
    expect(await service.generate(snapshot())).toEqual(high);
  });
  it('rejects repeated valid IDs even if passed again among candidates', async () => {
    const { service } = setup(JSON.stringify({ observationId: high.id }));
    const recent_coaching = [{ observationFingerprint: high.fingerprint, text: 'old'.repeat(200) }];
    expect(await service.generate(snapshot({ recent_coaching }))).toEqual(low);
    expect(await service.generate(snapshot({ recent_coaching: [...recent_coaching, { observationFingerprint: low.fingerprint }] }))).toBeNull();
  });
  it('does not call the provider or deliver prose when no eligible candidate exists', async () => {
    const { service, runtime } = setup('stale text with 999 calories');
    expect(await service.generate(snapshot({ observations: [] }))).toBeNull();
    expect(runtime.execute).not.toHaveBeenCalled();
  });
  it('separates offered evidence from historical prose and omits raw stale snapshot totals', async () => {
    const { service, runtime } = setup('{"observationId":null}');
    await service.generate(snapshot({ calories: { consumed: 9999 }, recent_coaching: [{ text: 'old 999 calories' }] }));
    const input = JSON.parse(runtime.execute.mock.calls[0][0].input);
    expect(input.current_evidence.observations).toEqual([high, low]);
    expect(input.historical_context.recent_coaching[0].text).toBe('old 999 calories');
    expect(runtime.execute.mock.calls[0][0].input).not.toContain('9999');
  });
  it('supports the legacy provider seam with the same strict selection', async () => {
    const service = new CoachingCommentaryService({ agentFactory: () => ({ generate: async () => ({ text: JSON.stringify({ observationId: low.id }) }) }), logger: {} });
    expect(await service.generate(snapshot())).toEqual(low);
  });
});
