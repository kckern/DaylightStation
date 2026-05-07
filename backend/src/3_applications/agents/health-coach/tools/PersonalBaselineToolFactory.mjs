// backend/src/3_applications/agents/health-coach/tools/PersonalBaselineToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Registers the `personal_baselines` tool, which returns rolling baselines
 * (fitness, nutrition, weight) for the user via PersonalBaselineService.
 *
 * The agent calls this tool when it wants an explicit re-query of the
 * user model mid-conversation.  The system-prompt copy (via UserModelService)
 * is the primary path; this tool handles follow-up drill-ins.
 */
export class PersonalBaselineToolFactory extends ToolFactory {
  static domain = 'health-coach';
  #baselineService;

  constructor({ baselineService }) {
    super({ baselineService });
    if (!baselineService) throw new Error('PersonalBaselineToolFactory: baselineService required');
    this.#baselineService = baselineService;
  }

  createTools() {
    const baselineService = this.#baselineService;

    return [
      createTool({
        name: 'personal_baselines',
        description:
          'Rolling baselines for this user (workouts/wk by kind, typical run profile, ' +
          'kcal_avg, protein_g_avg, weight trim mean + slope). Use these as the canonical ' +
          'answer to "what is typical for this user?". Returns object with shape ' +
          '{ fitness, nutrition, weight, computed_at }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
        },
        execute: async ({ userId }) => {
          try {
            return await baselineService.getBaselines({ userId });
          } catch (err) {
            return { error: err?.message || String(err) };
          }
        },
      }),
    ];
  }
}

export default PersonalBaselineToolFactory;
