/**
 * Generate Morning Debrief Use Case
 * @module journalist/usecases/GenerateMorningDebrief
 *
 * Orchestrates the daily debrief process:
 * 1. Aggregate yesterday's lifelog data
 * 2. Generate AI summary
 * 3. Generate category-specific questions
 * 4. Return structured debrief ready to send
 */

import moment from 'moment-timezone';

/**
 * Generate morning debrief for a user
 */
export class GenerateMorningDebrief {
  #lifelogAggregator;
  #aiGateway;
  #debriefRepository;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.lifelogAggregator - Lifelog aggregation service
   * @param {Object} deps.aiGateway - AI gateway for summaries
   * @param {Object} deps.debriefRepository - Repository to check for existing debriefs
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    if (!deps.lifelogAggregator) throw new Error('lifelogAggregator is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#lifelogAggregator = deps.lifelogAggregator;
    this.#aiGateway = deps.aiGateway;
    this.#debriefRepository = deps.debriefRepository;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the morning debrief generation
   *
   * @param {Object} input
   * @param {string} input.username - System username
   * @param {string} [input.date] - Target date (defaults to yesterday)
   * @returns {Object} Generated debrief with summary and questions
   */
  async execute(input) {
    const { username, date } = input;
    const startTime = Date.now();

    this.#logger.info?.('debrief.generate.start', { username, date });

    try {
      // Step 1: Aggregate lifelog data
      const lifelog = await this.#lifelogAggregator.aggregate(username, date);

      // Step 1.5: Check if debrief already exists for this date
      if (this.#debriefRepository) {
        const existingDebrief = await this.#debriefRepository.getDebriefByDate(lifelog._meta.date);
        if (existingDebrief) {
          this.#logger.info?.('debrief.found-existing', {
            username,
            date: lifelog._meta.date,
          });

          return {
            success: true,
            date: existingDebrief.date,
            summary: existingDebrief.summary,
            lifelog: {
              _meta: {
                date: existingDebrief.date,
                sources: existingDebrief.summaries?.map((s) => s.source) || [],
                hasEnoughData: true,
              },
              summaries: existingDebrief.summaries || [],
            },
          };
        }
      }

      // Step 2: Check if we have enough data
      if (!lifelog._meta.hasEnoughData) {
        this.#logger.info?.('debrief.insufficient-data', {
          username,
          date: lifelog._meta.date,
          availableSources: lifelog._meta.availableSourceCount,
        });

        return {
          success: false,
          reason: 'insufficient_data',
          fallbackPrompt:
            "Good morning! I don't have much data from yesterday. How was your day? What stood out to you?",
          availableSources: lifelog._meta.availableSourceCount,
        };
      }

      // Step 3: Generate AI summary
      const summary = await this.#generateSummary(lifelog, username);

      const duration = Date.now() - startTime;
      this.#logger.info?.('debrief.generate.complete', {
        username,
        date: lifelog._meta.date,
        duration,
      });

      return {
        success: true,
        date: lifelog._meta.date,
        summary,
        lifelog, // Include for reference
      };
    } catch (error) {
      this.#logger.error?.('debrief.generate.failed', {
        username,
        date,
        error: error.message,
        stack: error.stack,
      });

      // Fallback to generic prompt on error
      return {
        success: false,
        reason: 'error',
        error: error.message,
        fallbackPrompt: 'Good morning! How was yesterday? Anything interesting happen?',
      };
    }
  }

  /**
   * Generate natural language summary using AI
   */
  async #generateSummary(lifelog, username) {
    const systemPrompt = `You produce a compact morning data roundup from yesterday's logged data. Telegram message — no markdown headers.

FORMAT — three sections, separated by blank lines:

SECTION 1: FACTS
Group by time of day using these headers (only include sections that have data):
🌅 Morning
☀️ Midday
🌆 Afternoon
🌙 Evening
📌 Other

Under each header, one line per fact. Use • for bullets. Keep each bullet SHORT — one line, not a paragraph.
- Times inline: "• 5:33a P90X3 Dynamix, 31min ❤️84avg"
- Locations: "• 8:22a 📍 King Street Station"
- Music: "• 🎵 Dashboard Confessional, Jimmy Eat World" (just artists, not every track)
- Code: "• 💻 DaylightStation — health-coach coaching fix"
- Email sent: summarize what YOU said, not the subject line. "• 2:15p ✉️ Emailed Darwin — chapel cleaning Saturday" not "Sent 1 email to Darwin Powell: 'Re: Reminder...'"
- Email received: only mention if notable/personal/actionable. Skip newsletters/spam/receipts.
- Weight: "• ⚖️ 169.8 lbs (+0.5 7d)"
- Journal entries: brief paraphrase, not full quote
- 📌 Other: items without timestamps (weight, daily totals, etc.)

DO NOT include:
- Nutrition/food/calorie details (handled by a separate nutrition bot)
- Calorie balance, macros, protein counts
- Sodium, fiber, or any dietary metrics

SECTION 2: COMMENTARY (2-3 sentences)
Brief observations about patterns, gaps, or notable things. Matter-of-fact, no cheerleading.
DO NOT comment on food intake, calories, protein, or nutrition — that domain belongs to a different bot.
Focus on: activity patterns, productivity, social, mood signals, unusual gaps.

SECTION 3: QUESTIONS (2-3 bullets)
Short prompts for journaling. Use • bullets.
- Ask about context/feelings behind events
- Ask about gaps the data doesn't explain
- Ask about people mentioned

RULES:
- NO markdown headers (no #, ##, **bold headers**). Use emoji + text for section breaks.
- NO "Yesterday" or date at the start — the message already has a date header.
- NO flowery language. Dense, specific, terse.
- Second person throughout.
- Keep the ENTIRE message under 1500 characters if possible.`;

    const dataPrompt = this.#buildDataPrompt(lifelog);

    try {
      const response = await this.#aiGateway.chat(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Here's the data from ${lifelog._meta.date}:\n\n${dataPrompt}\n\nProduce the morning roundup: facts, commentary, questions.`,
          },
        ],
        {
          temperature: 0.6,
          maxTokens: 800,
        },
      );

      this.#logger.info?.('debrief.summary-generated', {
        username,
        date: lifelog._meta.date,
        length: response.length,
      });

      return response;
    } catch (error) {
      this.#logger.error?.('debrief.ai-summary-failed', {
        username,
        error: error.message,
      });

      // Fallback to template summary
      return this.#generateFallbackSummary(lifelog);
    }
  }

  /**
   * Build data prompt from lifelog
   * Uses the pre-generated summaryText from extractors
   */
  #buildDataPrompt(lifelog) {
    // Use the pre-built summary text from extractors
    if (lifelog.summaryText && lifelog.summaryText.trim()) {
      return lifelog.summaryText;
    }

    // Fallback to basic info if no summary text available
    return `Date: ${lifelog._meta?.date || 'unknown'}
Available sources: ${lifelog._meta?.sources?.join(', ') || 'none'}
Categories: ${lifelog._meta?.categories?.join(', ') || 'none'}`;
  }

  /**
   * Generate fallback summary (no AI)
   */
  #generateFallbackSummary(lifelog) {
    const parts = [];

    if (lifelog.events?.length > 0) {
      parts.push(
        `had ${lifelog.events.length} calendar event${lifelog.events.length > 1 ? 's' : ''}`,
      );
    }

    if (lifelog.fitness?.activities?.length > 0) {
      parts.push(
        `worked out ${lifelog.fitness.activities.length} time${lifelog.fitness.activities.length > 1 ? 's' : ''}`,
      );
    }

    if (lifelog.media?.movies?.length > 0) {
      parts.push(
        `watched ${lifelog.media.movies.length} movie${lifelog.media.movies.length > 1 ? 's' : ''}`,
      );
    }

    const summary =
      parts.length > 0
        ? `Good morning! Yesterday you ${parts.join(', ')}.`
        : `Good morning! How was your day yesterday?`;

    return summary;
  }
}

export default GenerateMorningDebrief;
