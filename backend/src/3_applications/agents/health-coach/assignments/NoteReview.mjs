// backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { coachingMessageSchema } from '../schemas/coachingMessage.mjs';

/**
 * NoteReview - Event-triggered assignment that fires after each food log accept.
 * The agent decides whether to speak; default is silence.
 *
 * Lifecycle:
 * 1. GATHER - load today's nutrition, goals, recent workouts, and alert budget from memory
 * 2. PROMPT - assemble data into a prompt that biases toward silence
 * 3. REASON - LLM produces a structured coaching message JSON
 * 4. VALIDATE - JSON Schema check via OutputValidator
 * 5. ACT - if should_send, increment alerts_sent_today counter in working memory
 *
 * Note: Message delivery (send_channel_message) is NOT done here.
 * It is handled by HealthCoachAgent.runAssignment() post-execute.
 */
export class NoteReview extends Assignment {
  static id = 'note-review';
  static description = 'Per-accept review — agent decides whether to speak';
  // No static schedule — event-triggered only

  /**
   * Gather phase — programmatic tool calls (no LLM).
   * Loads today's nutrition, user goals, recent workouts, and alert budget.
   */
  async gather({ tools, userId, memory, logger, context }) {
    const call = (name, params) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) {
        logger?.warn?.('gather.tool_not_found', { name });
        return Promise.resolve(null);
      }
      return tool.execute(params).catch(err => {
        logger?.warn?.('gather.tool_error', { name, error: err.message });
        return { error: err.message };
      });
    };

    const [todayNutrition, goals, workouts] = await Promise.all([
      call('get_today_nutrition', { userId }),
      call('get_user_goals', { userId }),
      call('get_recent_workouts', { userId, days: 1 }),
    ]);

    // Check alert budget from working memory
    const alertsSentToday = memory.get('alerts_sent_today') || { count: 0, topics: [] };
    const forceSpeak = context?.forceSpeak || false;

    logger?.info?.('gather.complete', {
      hasTodayNutrition: !!todayNutrition,
      hasGoals: !!goals,
      hasWorkouts: !!workouts,
      alertsSentToday: alertsSentToday.count,
      forceSpeak,
    });

    return { todayNutrition, goals, workouts, alertsSentToday, forceSpeak };
  }

  /**
   * Build a focused prompt that biases the LLM toward silence unless there is
   * genuinely new, actionable information the user doesn't already have.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Today's Nutrition\n${JSON.stringify(gathered.todayNutrition || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);
    sections.push(`\n## Recent Workouts (last 24h)\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Alert Budget\nAlerts sent today: ${gathered.alertsSentToday.count}\nTopics already covered: ${JSON.stringify(gathered.alertsSentToday.topics)}`);
    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    const isForced = gathered.forceSpeak;

    sections.push(`\n## Instructions
Produce a JSON object matching the coachingMessageSchema:
${isForced
    ? `- The user explicitly asked for coaching via /coach. should_send MUST be true. Ignore the alert budget.
- Respond with a concise, numbers-focused summary of current state.`
    : `- should_send: false UNLESS there is something the user doesn't already know
- A running total line is already shown on accept — do not restate calories
- Max 2 alerts per day. Already sent today: ${gathered.alertsSentToday.count}
- If alerts_sent_today.count >= 2, should_send: false`}
- Never say "great job", "keep it up", or similar. Numbers only.
- Never suggest specific foods. State the gap, not the solution.
- text: the message body (HTML formatted, under 100 words) — only set if should_send is true
- parse_mode: "HTML"

Return raw JSON only, no markdown code fences.`);

    return sections.join('\n');
  }

  /**
   * Returns the JSON Schema that the LLM output must conform to.
   */
  getOutputSchema() {
    return coachingMessageSchema;
  }

  /**
   * Validate LLM output against the coachingMessageSchema.
   * @param {Object} raw - { output: string, toolCalls: Array }
   * @param {Object} gathered - Data from gather phase
   * @param {Object} logger - Logger
   * @returns {Object} Validated and parsed coaching message object
   * @throws {Error} If output is not valid JSON or fails schema validation
   */
  async validate(raw, gathered, logger) {
    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('NoteReview output is not valid JSON');
    }

    const result = OutputValidator.validate(parsed, coachingMessageSchema);
    if (!result.valid) {
      logger?.warn?.('validate.schema_failure', { errors: result.errors });
      throw new Error(`NoteReview validation failed: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  /**
   * Act phase — if message is being sent, update alert tracking in working memory.
   * Message delivery is handled by HealthCoachAgent after execute() returns.
   */
  async act(validated, { memory, userId, logger }) {
    if (validated.should_send) {
      const current = memory.get('alerts_sent_today') || { count: 0, topics: [] };
      current.count += 1;
      current.topics.push(validated.text?.substring(0, 50));
      memory.set('alerts_sent_today', current, { ttl: 24 * 60 * 60 * 1000 });
    }

    logger?.info?.('act.complete', {
      userId,
      should_send: validated.should_send,
    });
  }
}
