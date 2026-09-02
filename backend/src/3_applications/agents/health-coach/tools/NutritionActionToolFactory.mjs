// backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

/**
 * Registers `log_food` — the coach's WRITE path into nutrition. It runs the
 * same text pipeline the web AddBar uses, so entries land as PENDING and the
 * human confirms them in the UI. The coach can never auto-accept a meal.
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
          + 'into itemized entries with estimated macros and creates a PENDING '
          + 'log the user must confirm in the Health app — you cannot accept it '
          + 'for them. Use when the user asks you to log/record a meal. Returns '
          + '{ status: "pending_confirmation", summary }.',
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
            const summary = result?.messages?.[0]?.text || 'Logged (pending confirmation)';
            return { status: 'pending_confirmation', summary };
          } catch (err) {
            return { error: err?.message || String(err) };
          }
        },
      }),
    ];
  }
}

export default NutritionActionToolFactory;
