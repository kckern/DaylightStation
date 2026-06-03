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

// Hedging/speculation words banned from the headline — a deduction must commit.
// Stateless (no /g flag) so .test() is safe to reuse.
const HEDGE_PATTERN =
  /\b(seems?|seemed|looks like|sounds like|appears?|apparently|probably|likely|maybe|perhaps|must have|i think|(?:it )?feels like)\b/i;

/**
 * Generate morning debrief for a user
 */
export class GenerateMorningDebrief {
  #lifelogAggregator;
  #aiGateway;
  #debriefRepository;
  #journalEntryRepository;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.lifelogAggregator - Lifelog aggregation service
   * @param {Object} deps.aiGateway - AI gateway for summaries
   * @param {Object} deps.debriefRepository - Repository to check for existing debriefs
   * @param {Object} [deps.journalEntryRepository] - Journal entry repo for conversation context
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    if (!deps.lifelogAggregator) throw new Error('lifelogAggregator is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#lifelogAggregator = deps.lifelogAggregator;
    this.#aiGateway = deps.aiGateway;
    this.#debriefRepository = deps.debriefRepository;
    this.#journalEntryRepository = deps.journalEntryRepository;
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
    const { username, date, conversationId } = input;
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

      // Step 2.5: Load recent conversation context (last 3 days of user messages)
      const conversationContext = await this.#loadConversationContext(conversationId);

      // Step 3: Generate AI summary (+ adaptive headline)
      const { summary, headline } = await this.#generateSummary(
        lifelog,
        username,
        conversationContext,
      );

      const duration = Date.now() - startTime;
      this.#logger.info?.('debrief.generate.complete', {
        username,
        date: lifelog._meta.date,
        duration,
        hasConversationContext: conversationContext.length > 0,
        hasHeadline: !!headline,
      });

      return {
        success: true,
        date: lifelog._meta.date,
        summary,
        headline,
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
   * Load recent user messages from journalist conversation for context.
   * Extracts only user messages (not bot) from the last 3 days.
   * @param {string} conversationId
   * @returns {Promise<Array<{content: string, timestamp: string}>>}
   */
  async #loadConversationContext(conversationId) {
    if (!this.#journalEntryRepository || !conversationId) return [];

    try {
      const recent = await this.#journalEntryRepository.findRecent(conversationId, 3);
      // Only user messages — these are the insights the debrief should absorb
      const userMessages = recent
        .filter(msg => msg.senderId !== 'bot' && msg.role !== 'assistant')
        .map(msg => ({
          content: msg.content || msg.text,
          timestamp: msg.timestamp,
        }))
        .filter(msg => msg.content && msg.content.length > 10); // Skip button taps / short callbacks

      this.#logger.debug?.('debrief.conversation-context', {
        conversationId,
        totalRecent: recent.length,
        userMessages: userMessages.length,
      });

      return userMessages;
    } catch (err) {
      this.#logger.warn?.('debrief.conversation-context.failed', { error: err.message });
      return [];
    }
  }

  /**
   * Generate natural language summary using AI
   */
  async #generateSummary(lifelog, username, conversationContext = []) {
    const systemPrompt = `You produce a compact morning data roundup from yesterday's logged data. Telegram message — no markdown headers.

FORMAT — a one-line hook, then three sections, separated by blank lines:

SECTION 0: HOOK
A single opening line that makes the message worth opening. It is the bot venturing a read on the day.
DEFAULT to a confident STATEMENT — an assumption or deduction inferred from the data and what the user told you. Pitch it so that:
  • if it's off-base, the user will want to correct it ("no, actually…"), and
  • if it's right, it invites them to add detail or color ("yeah, and…").
A deduction is a NON-OBVIOUS inference, not a recap. Name the specific thread and take a position on it. Keep it PUNCHY — one crisp clause. Do NOT pad with stacked "but…"/"and…" clauses, em-dash tails, or a list of the day's activities.
State it FLATLY, as fact — committed, not hedged. A confident wrong guess is better than a mushy safe one; that's what earns a correction.
NEVER use hedging or speculation words: seem/seems/seemed, looks like, appears, apparently, probably, likely, maybe, perhaps, "must have", "I think", "sounds like", "it feels like".
  GOOD: "Church leadership swallowed your morning before you got any real focus time."
  GOOD: "The assessor in the house threw off more than just your coding."
  BAD (hedged — never do this): "Church leadership seemed to swallow your morning." / "Looks like it was a full day."
  BAD (lame/generic — never do this): "Seems like you've been busy." / "Sounds like a full day." / "Lots going on."
When a sharp, specific question is in reach, REACH for it — on its own, or appended to the deduction ("Deduction. Pointed question?"). A pointed question that opens a real thread beats a flat statement; use them freely. Just never manufacture a limp one.
NEVER use a generic, templated journaling question. BANNED: "What prompted you to…?", "What was it like to…?", "How did that make you feel?", "How was your day?", "Any thoughts on…?". If your question fits that mold, drop it and just state the deduction.
Either way: specific to THIS day, never generic, and TIGHT. Keep the WHOLE hook on ONE line. No emoji, no "Yesterday", no date. At most two short sentences — shorter is better.
Output it as the VERY FIRST line, prefixed exactly with "HOOK: ".

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

CONVERSATION CONTEXT:
You may also receive recent messages the user sent in the last few days. This is context the user has ALREADY shared with you. Use it to:
- ENRICH facts: if the user explained why they went somewhere or what an event was about, weave that context into the fact bullet (e.g., "• 3:31p 📍 Topgolf — work team outing" not just "• 3:31p 📍 Topgolf")
- INFORM commentary: reference what they told you, not just raw data (e.g., "Dashboard Confessional was a nostalgia trip — your BYU roommate used to play it")
- DEEPEN questions: don't ask things they already answered. If they said Topgolf was a work outing, don't ask "What prompted the Topgolf visit?" — ask something that builds on it ("How's the team dynamic outside the office?")
- You should appear to ALREADY KNOW what they told you. Never ask a question they've already answered.

RULES:
- The HOOK line ("HOOK: ...") comes FIRST, on its own line, before the facts.
- NO markdown headers (no #, ##, **bold headers**). Use emoji + text for section breaks.
- NO "Yesterday" or date at the start — the message already has a date header.
- NO flowery language. Dense, specific, terse.
- Second person throughout.
- Keep the ENTIRE message under 1500 characters if possible.`;

    const dataPrompt = this.#buildDataPrompt(lifelog);

    // Build conversation context section
    let contextSection = '';
    if (conversationContext.length > 0) {
      const contextLines = conversationContext.map(msg => {
        const ts = msg.timestamp ? ` (${msg.timestamp.split('T')[0]})` : '';
        return `- ${msg.content}${ts}`;
      });
      contextSection = `\n\nRECENT USER MESSAGES (context they've already shared):\n${contextLines.join('\n')}`;
    }

    try {
      const response = await this.#aiGateway.chat(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Here's the data from ${lifelog._meta.date}:\n\n${dataPrompt}${contextSection}\n\nProduce the morning roundup: HOOK line first, then facts, commentary, questions.`,
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

      const parsed = GenerateMorningDebrief.parseHeadline(response);

      // Hedge guard: a deduction must commit. If the model slipped a hedge word
      // into the headline, attempt one focused rewrite; if that still hedges,
      // drop the headline so the send layer falls back to the date header.
      if (parsed.headline && GenerateMorningDebrief.containsHedge(parsed.headline)) {
        parsed.headline = await this.#deHedgeHeadline(parsed.headline);
      }

      return parsed;
    } catch (error) {
      this.#logger.error?.('debrief.ai-summary-failed', {
        username,
        error: error.message,
      });

      // Fallback to template summary (no headline — send layer falls back to date header)
      return { summary: this.#generateFallbackSummary(lifelog), headline: null };
    }
  }

  /**
   * True if the text contains a banned hedging/speculation word.
   * @param {string} text
   * @returns {boolean}
   */
  static containsHedge(text) {
    return HEDGE_PATTERN.test(text || '');
  }

  /**
   * Rewrite a hedged headline into a flat, committed line via a small focused AI
   * call. Returns the de-hedged line, or null if the rewrite still hedges, comes
   * back empty, or errors (caller then falls back to the legacy date header).
   * @param {string} headline
   * @returns {Promise<string|null>}
   */
  async #deHedgeHeadline(headline) {
    try {
      const rewritten = await this.#aiGateway.chat(
        [
          {
            role: 'system',
            content:
              'Rewrite the line as a flat, committed assertion with ZERO hedging. Remove any of: seems, seemed, looks like, sounds like, appears, apparently, probably, likely, maybe, perhaps, must have, I think, feels like. Keep it specific and tight, one line. If it is a question, keep it a question. Return ONLY the rewritten line — no quotes, no preamble.',
          },
          { role: 'user', content: headline },
        ],
        { temperature: 0.3, maxTokens: 60 },
      );

      const cleaned = (rewritten || '').trim().replace(/^["']+|["']+$/g, '').split('\n')[0].trim();

      if (!cleaned || GenerateMorningDebrief.containsHedge(cleaned)) {
        this.#logger.warn?.('debrief.headline.hedge-unresolved', { headline });
        return null;
      }

      this.#logger.info?.('debrief.headline.de-hedged', { before: headline, after: cleaned });
      return cleaned;
    } catch (err) {
      this.#logger.warn?.('debrief.headline.de-hedge-failed', { error: err.message });
      return null;
    }
  }

  /**
   * Split a leading "HOOK: ..." line off the AI response into a separate headline.
   * The headline is an ephemeral send-time hook; the returned summary stays clean
   * (facts/commentary/questions only) so persistence and styling are unaffected.
   *
   * @param {string} response - Raw AI response
   * @returns {{summary: string, headline: string|null}}
   */
  static parseHeadline(response) {
    const text = response || '';
    const lines = text.split('\n');

    // Locate the first non-empty line.
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;

    const match = lines[i]?.match(/^HOOK:\s*(.*)$/i);
    if (!match) {
      return { summary: text, headline: null };
    }

    const headline = match[1].trim();

    // Drop the hook line and any blank lines that followed it.
    lines.splice(0, i + 1);
    while (lines.length && lines[0].trim() === '') lines.shift();

    return { summary: lines.join('\n'), headline: headline || null };
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
