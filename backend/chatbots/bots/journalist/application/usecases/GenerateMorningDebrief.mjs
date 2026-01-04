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
    const systemPrompt = `You are a personal life recorder reconstructing a day from data. Write a detailed, narrative account of the day's activities.

PRIORITY DATA:
- JOURNAL ENTRIES are the MOST IMPORTANT source - these are the user's own words about their day
- Weave journal content prominently into the narrative - quote or paraphrase specific details they mentioned
- If journal entries mention people, conversations, feelings, or events - these take precedence over inferred activities
- Use journal entries to add context and meaning to other data points

Style guidelines:
- Write like a detailed journal entry with natural flow between activities
- Use specific time references and create a chronological narrative
- For workouts: describe the session with full context - "hit the gym at 12:36pm for a 45-minute weight training session, burning 255 calories with an average heart rate of 99 and peaking at 156"
- For code work: describe WHAT was worked on thematically, mention significant features or areas (2-3 examples), note the volume of work
- For music: weave listening habits naturally - mention top artists, total tracks, describe the musical arc of the day
- For food: describe meals naturally with some detail - "breakfast included Greek yogurt and buttered toast", note calorie totals and macro balance
- For calendar events: integrate naturally with full context and timing
- For location check-ins: weave into the narrative with context
- For weight/fitness metrics: include current status and trends naturally
- Second person ("you") throughout
- DO NOT include the date or "Yesterday" at the start
- Jump right into the day's flow
- Aim for 8-12 sentences with rich detail
- Connect activities logically (e.g., "After the morning workout, you..." or "While working on code...")
- No corporate speak or filler phrases like "served as", "engaged in", "transitioned into"`;

    const dataPrompt = this.#buildDataPrompt(lifelog);
    
    try {
      const response = await this.#aiGateway.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here's the data from ${lifelog._meta.date}:\n\n${dataPrompt}\n\nReconstruct this day with detail and natural flow. Create a cohesive daily debrief that captures the full scope of the day, and asks what may not be clear from the data.` }
      ], {
        temperature: 0.6,
        maxTokens: 800
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
