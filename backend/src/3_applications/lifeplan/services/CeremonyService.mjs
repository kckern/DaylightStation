const CEREMONY_TYPES = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review', 'season_alignment', 'era_vision'];

const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit',
  unit_capture: 'unit',
  cycle_retro: 'cycle',
  phase_review: 'phase',
  season_alignment: 'season',
  era_vision: 'era',
};

export class CeremonyService {
  #lifePlanStore;
  #ceremonyRecordStore;
  #cadenceService;

  constructor({ lifePlanStore, ceremonyRecordStore, cadenceService }) {
    this.#lifePlanStore = lifePlanStore;
    this.#ceremonyRecordStore = ceremonyRecordStore;
    this.#cadenceService = cadenceService;
  }

  getCeremonyContent(type, username) {
    if (!CEREMONY_TYPES.includes(type)) return null;

    const plan = this.#lifePlanStore.load(username);
    if (!plan) return null;

    const cadencePosition = this.#cadenceService.resolve(plan.cadence || {}, new Date());

    const base = {
      type,
      username,
      cadencePosition,
      periodId: cadencePosition?.[CEREMONY_CADENCE_MAP[type]]?.periodId,
    };

    switch (type) {
      case 'unit_intention':
        return {
          ...base,
          activeGoals: (plan.getActiveGoals?.() || plan.goals?.filter(g => !['achieved', 'failed', 'abandoned'].includes(g.state)) || []),
          rules: this.#getAllRules(plan),
        };

      case 'unit_capture':
        return {
          ...base,
          activeGoals: (plan.getActiveGoals?.() || []),
        };

      case 'cycle_retro':
        return {
          ...base,
          goalProgress: (plan.goals || []).map(g => ({
            id: g.id, name: g.name, state: g.state,
            progress: g.progress ?? g.metrics?.reduce((sum, m) => sum + (m.target > 0 ? m.current / m.target : 0), 0) / (g.metrics?.length || 1) ?? 0,
          })),
          beliefEvidence: (plan.beliefs || []).map(b => ({
            id: b.id, confidence: b.confidence, state: b.state,
            recentEvidence: (b.evidence_history || []).slice(-3),
          })),
          valueDrift: (plan.values || []).map(v => ({
            id: v.id, name: v.name, alignment_state: v.alignment_state,
          })),
          ruleEffectiveness: this.#getAllRules(plan).map(r => ({
            trigger: r.trigger, action: r.action, effectiveness: r.effectiveness,
          })),
        };

      case 'phase_review':
      case 'season_alignment':
      case 'era_vision':
        return {
          ...base,
          plan: plan.toJSON?.() || plan,
        };

      default:
        return base;
    }
  }

  completeCeremony(type, username, responses) {
    if (!CEREMONY_TYPES.includes(type)) return false;

    const cadenceLevel = CEREMONY_CADENCE_MAP[type];
    const plan = this.#lifePlanStore.load(username);
    const cadencePosition = this.#cadenceService.resolve(plan?.cadence || {}, new Date());
    const periodId = cadencePosition?.[cadenceLevel]?.periodId || 'unknown';

    const record = {
      type,
      periodId,
      completedAt: new Date().toISOString(),
      responses,
    };

    this.#ceremonyRecordStore.saveRecord(username, record);
    return true;
  }

  #getAllRules(plan) {
    const rules = [];
    for (const q of (plan.qualities || [])) {
      for (const r of (q.rules || [])) {
        rules.push({ ...r, quality: q.name });
      }
    }
    return rules;
  }
}
