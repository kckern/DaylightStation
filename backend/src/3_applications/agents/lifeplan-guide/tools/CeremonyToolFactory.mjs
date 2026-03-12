import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

const CEREMONY_TYPES = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review', 'season_alignment', 'era_vision'];
const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit',
  cycle_retro: 'cycle', phase_review: 'phase',
  season_alignment: 'season', era_vision: 'era',
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
            username: { type: 'string' },
          },
          required: ['type', 'username'],
        },
        execute: async ({ type, username }) => {
          try {
            return await ceremonyService.getCeremonyContent(type, username);
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
            username: { type: 'string' },
            responses: { type: 'object', description: 'User responses from the ceremony conversation' },
          },
          required: ['type', 'username', 'responses'],
        },
        execute: async ({ type, username, responses }) => {
          await ceremonyService.completeCeremony(type, username, responses);
          return { completed: true, type, username };
        },
      }),

      createTool({
        name: 'check_ceremony_status',
        description: 'Check which ceremonies are due, overdue, or completed for the current cadence position.',
        parameters: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
        execute: async ({ username }) => {
          const plan = lifePlanStore.load(username);
          if (!plan) return { ceremonies: [], error: 'No plan found' };

          const position = cadenceService.resolve(plan.cadence || {}, new Date());
          const ceremonies = [];

          for (const type of CEREMONY_TYPES) {
            const config = plan.ceremonies?.[type];
            if (!config?.enabled) continue;

            const level = CEREMONY_CADENCE_MAP[type];
            const periodId = position?.[level]?.periodId;
            const isDue = cadenceService.isCeremonyDue(type, position);
            const isCompleted = periodId ? ceremonyRecordStore.hasRecord(username, type, periodId) : false;

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
            username: { type: 'string' },
            type: { type: 'string', description: 'Filter by ceremony type (optional)' },
          },
          required: ['username'],
        },
        execute: async ({ username, type }) => {
          const records = ceremonyRecordStore.getRecords?.(username) || [];
          const filtered = type ? records.filter(r => r.type === type) : records;
          return { records: filtered };
        },
      }),
    ];
  }
}
