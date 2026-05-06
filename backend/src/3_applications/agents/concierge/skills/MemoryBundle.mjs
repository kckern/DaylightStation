import { ToolBundle } from '../../framework/ToolBundle.mjs';

/**
 * MemoryBundle — replaces MemorySkill.
 *
 * Tools operate on context.memory (a WorkingMemoryState already loaded by
 * BaseAgent.run). No per-tool YAML round-trips. BaseAgent saves automatically
 * at turn end.
 *
 * Preserves the same tool names, parameter schemas, and note shape
 * ({ content, t }) as the original MemorySkill so migration is invisible
 * to the model.
 */
export class MemoryBundle extends ToolBundle {
  static bundleName = 'memory';

  #maxNotes;

  constructor({ config = {} } = {}) {
    super();
    this.#maxNotes = config.maxNotes ?? 200;
  }

  getConfig() { return { maxNotes: this.#maxNotes }; }

  getPromptFragment(_context) {
    return `## Memory
You may use \`remember_note\` to store a short fact about the household for future conversations
(preferences, allergies, schedules, plans). Use \`recall_note\` to read the most recent notes.
Do not use this for transient context; the messages array already carries the active turn.`;
  }

  createTools() {
    const maxNotes = this.#maxNotes;

    return [
      {
        name: 'remember_note',
        description: 'Save a short note about the household for long-term memory.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The note text (under 280 chars).' },
          },
          required: ['content'],
        },
        async execute({ content }, context) {
          const trimmed = String(content ?? '').slice(0, 280);
          if (!trimmed) return { ok: false, reason: 'empty_note' };
          const memory = context?.memory;
          if (!memory) return { ok: false, reason: 'no_memory_context' };
          const notes = (memory.get('notes')) ?? [];
          notes.push({ content: trimmed, t: new Date().toISOString() });
          while (notes.length > maxNotes) notes.shift();
          memory.set('notes', notes);
          return { ok: true, count: notes.length };
        },
      },
      {
        name: 'recall_note',
        description: 'Read the most recent notes about the household.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of notes to return (default 5).' },
          },
        },
        async execute({ limit = 5 }, context) {
          const memory = context?.memory;
          if (!memory) return { notes: [] };
          const notes = (memory.get('notes')) ?? [];
          return { notes: notes.slice(-Math.max(1, Math.min(50, limit))) };
        },
      },
    ];
  }
}

export default MemoryBundle;
