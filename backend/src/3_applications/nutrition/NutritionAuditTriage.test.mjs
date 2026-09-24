import { describe, it, expect, vi } from 'vitest';
import { NutritionAuditTriage } from './NutritionAuditTriage.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn() });
const decision = flags => ({ isConfigured: () => true, evaluate: vi.fn(async () => ({ model: 'jev-1.13.0',
  answers: Object.fromEntries(Object.entries(flags).map(([id, p]) => [id, { type: 'yesNo', probability: p }])) })) });
const CLEAN = { badName: 0.02, implausibleNutrition: 0.1, wrongIcon: 0.05, ungroupedDish: 0.01, duplicateEntry: 0.03 };
const snapshot = (over = {}) => ({ fingerprint: 'fp', pending: [], rows: [
  { id: 'r1', uuid: 'r1', name: 'Greek Yogurt', calories: 100, grams: 170, icon: 'plain-yogurt',
    nutrientProvenance: { calories: 'label' }, captureEvidence: { big: 'blob' } },
], ...over });

describe('NutritionAuditTriage', () => {
  it('is inactive without a decision model or when off', async () => {
    expect(new NutritionAuditTriage({}).active).toBe(false);
    const off = new NutritionAuditTriage({ decisionGateway: decision(CLEAN), mode: 'off' });
    expect(off.active).toBe(false);
    expect(await off.assess(snapshot())).toBeNull();
  });

  it('defaults to shadow mode, which never gates', () => {
    const triage = new NutritionAuditTriage({ decisionGateway: decision(CLEAN), mode: 'nonsense' });
    expect(triage.mode).toBe('shadow');
    expect(triage.gating).toBe(false);
  });

  it('sends compact rows and reports a clean verdict below the threshold', async () => {
    const gateway = decision(CLEAN);
    const triage = new NutritionAuditTriage({ decisionGateway: gateway, threshold: 0.3, logger: logger() });
    const verdict = await triage.assess(snapshot());
    expect(verdict).toMatchObject({ needsAudit: false, reason: 'clean', score: 0.1, model: 'jev-1.13.0' });
    const [state, questions] = gateway.evaluate.mock.calls[0];
    expect(state.rows[0]).toEqual({ id: 'r1', uuid: 'r1', name: 'Greek Yogurt', calories: 100, grams: 170, icon: 'plain-yogurt' });
    expect(Object.values(questions).every(q => q.type === 'yesNo')).toBe(true);
  });

  it('flags the snapshot by its strongest question', async () => {
    const triage = new NutritionAuditTriage({ decisionGateway: decision({ ...CLEAN, implausibleNutrition: 0.7 }), logger: logger() });
    expect(await triage.assess(snapshot())).toMatchObject({ needsAudit: true, reason: 'implausibleNutrition', score: 0.7 });
  });

  it('sends pending captures to the audit without asking the model', async () => {
    const gateway = decision(CLEAN);
    const triage = new NutritionAuditTriage({ decisionGateway: gateway, logger: logger() });
    expect(await triage.assess(snapshot({ pending: [{ id: 'log1' }] }))).toMatchObject({ needsAudit: true, reason: 'pending-capture' });
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  it('returns null on failure so the audit runs as before', async () => {
    const log = logger();
    const triage = new NutritionAuditTriage({ decisionGateway: { isConfigured: () => true, evaluate: vi.fn(async () => { throw new Error('timeout'); }) }, logger: log });
    expect(await triage.assess(snapshot())).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('nutrition.triage.failed', expect.objectContaining({ error: 'timeout' }));
  });
});
