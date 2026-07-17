export const CEREMONY_TIMING = {
  unit_intention: 'start_of_unit',
  unit_capture: 'end_of_unit',
  cycle_retro: 'end_of_cycle',
  phase_review: 'end_of_phase',
  season_alignment: 'end_of_season',
  era_vision: 'end_of_era',
};

export const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit', cycle_retro: 'cycle',
  phase_review: 'phase', season_alignment: 'season', era_vision: 'era',
};

export const DEFAULT_ENABLED = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review'];

export const CEREMONY_TITLES = {
  unit_intention: 'Set your intention',
  unit_capture: 'Capture your day',
  cycle_retro: 'Weekly retro',
  phase_review: 'Phase review',
  season_alignment: 'Season alignment',
  era_vision: 'Era vision',
};

/**
 * Resolves which ceremonies are due *today* for a plan — the SSOT shared by the
 * dashboard (AlignmentService, no time-of-day gate) and the nudge sender
 * (CeremonyScheduler, which additionally hour-gates).
 */
export class CeremonyDueResolver {
  #cadenceService;
  constructor({ cadenceService }) { this.#cadenceService = cadenceService; }

  listDue({ plan, cadencePosition, cadenceConfig, today, hasRecord }) {
    const due = [];
    for (const [type, timing] of Object.entries(CEREMONY_TIMING)) {
      const cfg = plan?.ceremonies?.[type];
      const enabled = cfg?.enabled ?? DEFAULT_ENABLED.includes(type);
      if (!enabled) continue;
      const periodId = cadencePosition?.[CEREMONY_CADENCE_MAP[type]]?.periodId;
      if (!periodId) continue;
      if (hasRecord(type, periodId)) continue;
      if (!this.#cadenceService.isCeremonyDue(timing, cadenceConfig, today, null)) continue;
      due.push({ type, timing, periodId, title: CEREMONY_TITLES[type] || type });
    }
    return due;
  }
}
