// backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs

/**
 * Build a Mastra-shaped input processor that filters messages older than
 * config.time_window_hours. Messages without a parseable createdAt timestamp
 * are kept (we don't know how old they are, so we don't drop them).
 *
 * Intended to compose with Mastra's lastMessages count window — together they
 * give a "last N messages OR last X hours, whichever is more restrictive"
 * recency rule.
 *
 * Mastra processor interface: objects satisfying the Processor<TId> interface
 * with a required `id` field and optional `processInput(args)` method.
 * See @mastra/core/dist/processors/index.d.ts for the full shape.
 *
 * @param {object|null} config — { time_window_hours: number | null }
 * @param {object} [opts] — { now?: () => epochMs }
 * @returns {object|null} — null when disabled; otherwise a Mastra Processor object
 */
export function buildTimeWindowProcessor(config, { now = () => Date.now() } = {}) {
  if (!config?.time_window_hours || config.time_window_hours <= 0) return null;
  const windowMs = config.time_window_hours * 60 * 60 * 1000;

  const filter = (messages) => {
    if (!Array.isArray(messages)) return messages;
    const cutoff = now() - windowMs;
    return messages.filter(m => {
      const raw = m?.createdAt;
      if (!raw) return true;                  // no timestamp → keep
      const t = new Date(raw).getTime();
      if (Number.isNaN(t)) return true;        // unparseable → keep
      return t >= cutoff;
    });
  };

  return {
    id: 'time-window',
    name: 'TimeWindow',

    /**
     * Mastra input processor entry. Receives full ProcessInputArgs;
     * we filter messages by recency and return the subset.
     * Per the interface, returning MastraDBMessage[] is a valid shorthand
     * for "use these messages, keep systemMessages unchanged".
     */
    async processInput({ messages } = {}) {
      return filter(messages);
    },
  };
}

export default buildTimeWindowProcessor;
