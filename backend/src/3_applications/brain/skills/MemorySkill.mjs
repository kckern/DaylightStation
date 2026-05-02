export class MemorySkill {
  static name = 'memory';

  #memory;
  #logger;
  #config;

  constructor({ memory, logger = console, config = {} }) {
    if (!memory) throw new Error('MemorySkill: memory required');
    this.#memory = memory;
    this.#logger = logger;
    this.#config = { maxNotes: 200, ...config };
  }

  get name() { return MemorySkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_satellite) {
    return `## Memory
You may use \`remember_note\` to store a short fact about the household for future conversations
(preferences, allergies, schedules, plans). Use \`recall_note\` to read the most recent notes.
Do not use this for transient context; the messages array already carries the active turn.`;
  }

  getTools() {
    const memory = this.#memory;
    const cap = this.#config.maxNotes;

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
        async execute({ content }) {
          const trimmed = String(content ?? '').slice(0, 280);
          if (!trimmed) return { ok: false, reason: 'empty_note' };
          const notes = (await memory.get('notes')) ?? [];
          notes.push({ content: trimmed, t: new Date().toISOString() });
          while (notes.length > cap) notes.shift();
          await memory.set('notes', notes);
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
        async execute({ limit = 5 }) {
          const notes = (await memory.get('notes')) ?? [];
          return { notes: notes.slice(-Math.max(1, Math.min(50, limit))) };
        },
      },
    ];
  }
}

export default MemorySkill;
