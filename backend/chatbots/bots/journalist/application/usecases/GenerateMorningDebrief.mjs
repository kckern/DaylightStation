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
    this.#lifelogAggregator = deps.lifelogAggregator;
    this.#aiGateway = deps.aiGateway;
    this.#debriefRepository = deps.debriefRepository;
    this.#logger = deps.logger;
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

    this.#logger.info('debrief.generate.start', { username, date });

    try {
      // Step 1: Aggregate lifelog data
      const lifelog = await this.#lifelogAggregator.aggregate(username, date);
      
      // Step 1.5: Check if debrief already exists for this date
      if (this.#debriefRepository) {
        const existingDebrief = await this.#debriefRepository.getDebriefByDate(lifelog._meta.date);
        if (existingDebrief) {
          this.#logger.info('debrief.found-existing', { 
            username, 
            date: lifelog._meta.date 
          });

          return {
            success: true,
            date: existingDebrief.date,
            summary: existingDebrief.summary,
            lifelog: {
              _meta: { 
                date: existingDebrief.date,
                sources: existingDebrief.summaries?.map(s => s.source) || [],
                hasEnoughData: true
              },
              summaries: existingDebrief.summaries || []
            }
          };
        }
      }

      // Step 2: Check if we have enough data
      if (!lifelog._meta.hasEnoughData) {
        this.#logger.info('debrief.insufficient-data', {
          username,
          date: lifelog._meta.date,
          availableSources: lifelog._meta.availableSourceCount
        });
        
        return {
          success: false,
          reason: 'insufficient_data',
          fallbackPrompt: "Good morning! I don't have much data from yesterday. How was your day? What stood out to you?",
          availableSources: lifelog._meta.availableSourceCount
        };
      }

      // Step 3: Generate AI summary
      const summary = await this.#generateSummary(lifelog, username);

      const duration = Date.now() - startTime;
      this.#logger.info('debrief.generate.complete', {
        username,
        date: lifelog._meta.date,
        duration
      });

      return {
        success: true,
        date: lifelog._meta.date,
        summary,
        lifelog // Include for reference
      };

    } catch (error) {
      this.#logger.error('debrief.generate.failed', {
        username,
        date,
        error: error.message,
        stack: error.stack
      });

      // Fallback to generic prompt on error
      return {
        success: false,
        reason: 'error',
        error: error.message,
        fallbackPrompt: "Good morning! How was yesterday? Anything interesting happen?"
      };
    }
  }

  /**
   * Generate natural language summary using AI
   */
  async #generateSummary(lifelog, username) {
    const systemPrompt = `You are a personal life recorder reconstructing yesterday from data. Be matter-of-fact and concise - no fluff or filler phrases.

Style guidelines:
- Write like a terse journal entry, not a formal report
- Use natural time references: "around lunchtime", "in the morning", "late evening"
- For workouts: "lifted weights around lunchtime (12:36pm) for about 45 mins (255 cal, 99 avg HR)" - stats in parentheses, not elaborated
- For code work: estimate time spans, describe WHAT was worked on thematically, not commit counts
- Weave calendar events naturally into the narrative
- No phrases like "served as your primary", "engaged in", "transitioned into" - just say what happened
- Second person ("you") throughout
- DO NOT include the date or "Yesterday" at the start - that's already in the header
- Jump right into the activities
- 3-4 sentences max, dense with information`;

    const dataPrompt = this.#buildDataPrompt(lifelog);
    
    try {
      const response = await this.#aiGateway.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here's the data from ${lifelog._meta.date}:\n\n${dataPrompt}\n\nReconstruct this day concisely. Put stats in parentheses. No filler phrases.` }
      ], {
        temperature: 0.5,
        maxTokens: 250
      });

      this.#logger.info('debrief.summary-generated', {
        username,
        date: lifelog._meta.date,
        length: response.length
      });

      return response;
    } catch (error) {
      this.#logger.error('debrief.ai-summary-failed', {
        username,
        error: error.message
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
      parts.push(`had ${lifelog.events.length} calendar event${lifelog.events.length > 1 ? 's' : ''}`);
    }
    
    if (lifelog.fitness?.activities?.length > 0) {
      parts.push(`worked out ${lifelog.fitness.activities.length} time${lifelog.fitness.activities.length > 1 ? 's' : ''}`);
    }
    
    if (lifelog.media?.movies?.length > 0) {
      parts.push(`watched ${lifelog.media.movies.length} movie${lifelog.media.movies.length > 1 ? 's' : ''}`);
    }

    const summary = parts.length > 0
      ? `Good morning! Yesterday you ${parts.join(', ')}.`
      : `Good morning! How was your day yesterday?`;

    return summary;
  }

  /**
   * Generate fallback questions (no AI)
   */
  #generateFallbackQuestions(categories) {
    const questions = {};

    categories.forEach(cat => {
      switch (cat.key) {
        case 'events':
          questions.events = [
            "Who did you connect with most?",
            "What was the most valuable conversation?",
            "Any plans emerge for future gatherings?"
          ];
          break;
        case 'health':
          questions.health = [
            "How did your body feel during exercise?",
            "Did you notice any energy patterns?",
            "What motivated you to move today?"
          ];
          break;
        case 'media':
          questions.media = [
            "What resonated with you most?",
            "Any ideas or emotions sparked?",
            "Would you recommend what you experienced?"
          ];
          break;
        case 'tasks':
          questions.tasks = [
            "What felt most productive?",
            "Any tasks that were particularly satisfying?",
            "What's still on your mind?"
          ];
          break;
        case 'thoughts':
          questions.thoughts = [
            "What's been on your mind lately?",
            "Any insights or realizations?",
            "How are you feeling overall?"
          ];
          break;
        case 'freewrite':
          questions.freewrite = [
            "What would you like to write about?",
            "Anything else from yesterday?",
            "What's on your heart?"
          ];
          break;
      }
    });

    return questions;
  }
}
