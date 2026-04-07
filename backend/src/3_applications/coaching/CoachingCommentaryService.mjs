const SYSTEM_PROMPT = `You are a nutrition coach providing brief commentary on a user's daily tracking data.

RULES:
- One sentence only. Max 30 words.
- Output raw text, no HTML tags (the caller wraps it in <blockquote>).
- Conversational, direct. Talk like a friend who happens to know your numbers.
- Reference specific foods or items from the data when relevant.
- NEVER repeat an observation from recent_coaching. Find something new or say nothing.
- NEVER use phrases like "great job", "keep it up", "you've got this", "stay consistent".
- NEVER give generic advice like "focus on protein-rich foods" or "ensure consistent tracking".
- If there is genuinely nothing interesting to say, return an empty string.
- Time awareness: if time_of_day is "morning", don't warn about low intake — the day just started.
- The user does not eat breakfast. Do not mention missing breakfast or morning meals.

ASSIGNMENT CONTEXT:
- post-report: Comment on what was just logged. What stands out? Budget status?
- morning-brief: Comment on yesterday or recent trend. What's the story of the past few days?
- weekly-digest: What's the narrative arc of the week? What changed vs prior weeks?
- exercise-reaction: Frame the burned calories as budget. What does it buy?`;

/**
 * Generates a single commentary sentence via Mastra generate().
 * If the LLM fails or returns nothing, returns empty string.
 */
export class CoachingCommentaryService {
  #agentFactory;
  #logger;

  /**
   * @param {Object} deps
   * @param {Function} deps.agentFactory - () => Mastra Agent instance (allows lazy creation and test injection)
   * @param {Object} [deps.logger]
   */
  constructor({ agentFactory, logger }) {
    this.#agentFactory = agentFactory;
    this.#logger = logger || console;
  }

  /**
   * @param {Object} snapshot - Pre-computed data snapshot
   * @returns {Promise<string>} Commentary sentence or empty string
   */
  async generate(snapshot) {
    try {
      const agent = this.#agentFactory();
      const response = await agent.generate(JSON.stringify(snapshot));
      const raw = response?.text?.trim() || '';

      // Strip any HTML tags the LLM might have included despite instructions
      const cleaned = raw.replace(/<[^>]*>/g, '').trim();

      this.#logger.debug?.('coaching.commentary.generated', {
        type: snapshot.type,
        length: cleaned.length,
        text: cleaned.slice(0, 100),
      });

      return cleaned;
    } catch (err) {
      this.#logger.warn?.('coaching.commentary.failed', { type: snapshot.type, error: err.message });
      return '';
    }
  }

  /** Expose system prompt for testing/inspection */
  static get SYSTEM_PROMPT() {
    return SYSTEM_PROMPT;
  }
}
