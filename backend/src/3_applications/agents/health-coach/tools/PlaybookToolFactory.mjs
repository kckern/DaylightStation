// backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';

/**
 * Provides two tools for managing analytical playbooks in agent working memory:
 *
 *   - record_playbook   Add-or-replace a playbook by id in context.memory.playbooks
 *   - update_playbook   Merge last_verified / confidence / notes into an existing playbook
 *
 * Memory is accessed via ctx.memory (WorkingMemoryState) passed at execute time,
 * so this factory requires no constructor dependencies.
 */
export class PlaybookToolFactory extends ToolFactory {
  static domain = 'health-coach';

  constructor() {
    super({});
  }

  createTools() {
    return [
      {
        name: 'record_playbook',
        description:
          'Save (or replace by id) an analytical playbook to user memory. ' +
          'The library auto-renders into the prompt every turn.',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Stable slug; updates rewrite by this id.',
            },
            fact: {
              type: 'string',
              description: 'One declarative sentence describing the pattern.',
            },
            recipe: {
              type: 'string',
              description: 'Prose with worked example tool calls.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low', 'unverified'],
            },
            tags: { type: 'array', items: { type: 'string' } },
            related_playbooks: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['id', 'fact', 'recipe'],
        },
        execute: async (args, ctx) => {
          if (!ctx?.memory) return { error: 'no_memory_context: memory required in context' };
          if (!args?.id)    return { error: 'id required' };

          const list = ctx.memory.get('playbooks') ?? [];
          const playbook = {
            id: args.id,
            fact: args.fact,
            recipe: args.recipe,
            confidence: args.confidence ?? 'unverified',
            tags: args.tags ?? [],
            related_playbooks: args.related_playbooks ?? [],
            notes: args.notes ?? null,
          };

          const idx = list.findIndex(p => p.id === args.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...playbook };
          else list.push(playbook);

          ctx.memory.set('playbooks', list);
          return { ok: true, action: idx >= 0 ? 'replaced' : 'created' };
        },
      },
      {
        name: 'update_playbook',
        description:
          'Refresh the last_verified field (and optionally confidence/notes) on an existing ' +
          'playbook after running its recipe.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            last_verified: {
              type: 'object',
              properties: {
                at: { type: 'string' },
                period: {},
                result: { type: 'object' },
              },
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low', 'unverified'],
            },
            notes: { type: 'string' },
          },
          required: ['id'],
        },
        execute: async (args, ctx) => {
          if (!ctx?.memory) return { error: 'no_memory_context: memory required in context' };

          const list = ctx.memory.get('playbooks') ?? [];
          const idx = list.findIndex(p => p.id === args.id);
          if (idx < 0) return { error: `playbook "${args.id}" not found` };

          const merged = { ...list[idx] };
          if (args.last_verified !== undefined) merged.last_verified = args.last_verified;
          if (args.confidence !== undefined)    merged.confidence    = args.confidence;
          if (args.notes !== undefined)         merged.notes         = args.notes;
          list[idx] = merged;

          ctx.memory.set('playbooks', list);
          return { ok: true };
        },
      },
    ];
  }
}

export default PlaybookToolFactory;
