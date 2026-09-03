// backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Registers `log_food` — the coach's WRITE path into nutrition. It runs the
 * same text pipeline the web AddBar uses, so entries land IMMEDIATELY as
 * counted log entries marked unsettled (`settled: false`) — there is no
 * confirmation gate on any transport. The human reviews or undoes afterwards.
 */
export class NutritionActionToolFactory extends ToolFactory {
  static domain = 'health-coach';
  #nutritionInput;

  constructor({ nutritionInput }) {
    super({ nutritionInput });
    if (!nutritionInput) throw new Error('NutritionActionToolFactory: nutritionInput required');
    this.#nutritionInput = nutritionInput;
  }

  createTools() {
    const nutritionInput = this.#nutritionInput;
    return [
      createTool({
        name: 'log_food',
        description:
          'Log food the user described in conversation. Parses the description '
          + 'into itemized entries with estimated macros and logs them '
          + 'immediately — the entry counts toward the day right away and is '
          + 'marked unsettled so the user can review or undo it in the Health '
          + 'app. Use when the user asks you to log/record a meal. Returns '
          + '{ status: "logged", summary }.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            description: { type: 'string', description: 'The food in the user\'s words, e.g. "chipotle bowl, no rice"' },
          },
          required: ['userId', 'description'],
        },
        execute: async ({ userId, description }) => {
          try {
            if (!description || !description.trim()) {
              return { error: 'description is required' };
            }
            const result = await nutritionInput.process({
              type: 'text', content: description.trim(), userId,
            });
            const summary = result?.messages?.[0]?.text || 'Logged (unsettled — review or undo in the Health app)';
            return { status: 'logged', summary };
          } catch (err) {
            return { error: err?.message || String(err) };
          }
        },
      }),
    ];
  }
}

export default NutritionActionToolFactory;
