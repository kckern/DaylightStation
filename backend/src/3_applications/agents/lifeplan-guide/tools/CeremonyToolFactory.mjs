import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';
import { DEFAULT_ENABLED } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';

const CEREMONY_TYPES = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review', 'season_alignment', 'era_vision'];
const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit',
  cycle_retro: 'cycle', phase_review: 'phase',
  season_alignment: 'season', era_vision: 'era',
};
// Ceremony type → CadenceService timing string (mirrors CEREMONY_TIMING in
// 3_applications/lifeplan/services/CeremonyScheduler.mjs)
const CEREMONY_TIMING_MAP = {
  unit_intention: 'start_of_unit', unit_capture: 'end_of_unit',
  cycle_retro: 'end_of_cycle', phase_review: 'end_of_phase',
  season_alignment: 'end_of_season', era_vision: 'end_of_era',
};

export class CeremonyToolFactory extends ToolFactory {
  static domain = 'ceremony';

  createTools() {
    const { ceremonyService, ceremonyRecordStore, cadenceService, lifePlanStore } = this.deps;

    return [
      createTool({
        name: 'get_ceremony_content',
        description: 'Load ceremony context (goals, drift, evidence) for conducting a ceremony conversation.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Ceremony type' },
            userId: { type: 'string' },
          },
          required: ['type', 'userId'],
        },
        execute: async ({ type, userId }) => {
          try {
            return await ceremonyService.getCeremonyContent(type, userId);
          } catch (err) {
            return { error: err.message };
          }
        },
      }),

      createTool({
        name: 'complete_ceremony',
        description: 'Record ceremony completion with user responses.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            userId: { type: 'string' },
            responses: { type: 'object', description: 'User responses from the ceremony conversation' },
          },
          required: ['type', 'userId', 'responses'],
        },
        execute: async ({ type, userId, responses }) => {
          await ceremonyService.completeCeremony(type, userId, responses);
          return { completed: true, type, userId };
        },
      }),

      createTool({
        name: 'check_ceremony_status',
        description: 'Check which ceremonies are due, overdue, or completed for the current cadence position.',
        parameters: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          const plan = lifePlanStore.load(userId);
          if (!plan) return { ceremonies: [], error: 'No plan found' };

          const now = new Date();
          const position = cadenceService.resolve(plan.cadence || {}, now);
          const ceremonies = [];

          for (const type of CEREMONY_TYPES) {
            const config = plan.ceremonies?.[type];
            const enabled = config?.enabled ?? DEFAULT_ENABLED.includes(type);
            if (!enabled) continue;

            const level = CEREMONY_CADENCE_MAP[type];
            const periodId = position?.[level]?.periodId;
            const isDue = cadenceService.isCeremonyDue(CEREMONY_TIMING_MAP[type], plan.cadence || {}, now, null);
            const isCompleted = periodId ? ceremonyRecordStore.hasRecord(userId, type, periodId) : false;

            ceremonies.push({
              type,
              level,
              periodId,
              isDue,
              isCompleted,
              isOverdue: isDue && !isCompleted,
            });
          }

          return { ceremonies };
        },
      }),

      createTool({
        name: 'get_ceremony_history',
        description: 'Get past ceremony completion records.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            type: { type: 'string', description: 'Filter by ceremony type (optional)' },
          },
          required: ['userId'],
        },
        execute: async ({ userId, type }) => {
          const records = ceremonyRecordStore.getRecords?.(userId) || [];
          const filtered = type ? records.filter(r => r.type === type) : records;
          return { records: filtered };
        },
      }),
    ];
  }
}
