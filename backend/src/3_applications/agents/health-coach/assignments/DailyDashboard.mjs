// backend/src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs

import { Assignment } from '../../framework/Assignment.mjs';
import { OutputValidator } from '../../framework/OutputValidator.mjs';
import { dashboardSchema } from '../schemas/dashboard.mjs';

/**
 * DailyDashboard - Scheduled assignment that prepares the daily fitness dashboard.
 *
 * Lifecycle:
 * 1. GATHER - programmatically call tools for health data, content, program state
 * 2. PROMPT - assemble gathered data + memory into focused LLM input
 * 3. REASON - LLM produces structured dashboard JSON
 * 4. VALIDATE - JSON Schema + domain checks (content IDs exist)
 * 5. ACT - update working memory with recommendations and coaching state
 *
 * Note: Dashboard persistence (writing YAML) is handled by HealthCoachAgent
 * after execute() returns, since the base Assignment.act() receives only
 * { memory, userId, logger } — not tools.
 */
export class DailyDashboard extends Assignment {
  static id = 'daily-dashboard';
  static description = "Prepare today's fitness dashboard";
  static schedule = '0 4 * * *';

  /**
   * Gather phase - programmatic tool calls (no LLM involved).
   * Calls health, nutrition, workout, program, and content tools in parallel.
   */
  async gather({ tools, userId, memory, logger }) {
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

    const [weight, nutrition, nutritionHistory, workouts, fitnessSessions, recentlyWatched, programState, goals] =
      await Promise.all([
        call('get_weight_trend', { userId, days: 7 }),
        call('get_today_nutrition', { userId }),
        call('get_nutrition_history', { userId, days: 7 }),
        call('get_recent_workouts', { userId, days: 7 }),
        call('get_recent_fitness_sessions', { days: 7 }),
        call('get_recently_watched_fitness', { days: 7 }),
        call('get_program_state', { userId }),
        call('get_user_goals', { userId }),
      ]);

    // Get fitness content — if active program, get that show's episodes;
    // otherwise browse the full catalog so the LLM can recommend from real content
    const showId = programState?.program?.content_source?.replace('plex:', '') || null;
    let content = null;
    let catalog = null;

    if (showId) {
      content = await call('get_fitness_content', { showId });
    } else {
      catalog = await call('browse_fitness_catalog', {});
    }

    logger?.info?.('gather.complete', {
      hasWeight: !!weight?.current,
      hasNutrition: !!nutrition?.logged,
      stravaWorkouts: workouts?.totalThisWeek || 0,
      fitnessSessions: fitnessSessions?.total || 0,
      recentlyWatched: recentlyWatched?.total || 0,
      hasContent: !!content,
      catalogShows: catalog?.total || 0,
      hasGoals: !!goals,
    });

    return { weight, nutrition, nutritionHistory, workouts, fitnessSessions, recentlyWatched, content, catalog, programState, goals };
  }

  /**
   * Build a focused prompt from gathered data and working memory.
   * The LLM uses this to produce the structured dashboard JSON.
   */
  buildPrompt(gathered, memory) {
    const today = new Date().toISOString().split('T')[0];
    const sections = [`## Date: ${today}`];

    sections.push(`\n## Health Data\n${JSON.stringify(gathered.weight || {}, null, 2)}`);
    sections.push(`\n## Nutrition Today\n${JSON.stringify(gathered.nutrition || {}, null, 2)}`);
    sections.push(`\n## Nutrition History (7 days)\n${JSON.stringify(gathered.nutritionHistory || {}, null, 2)}`);
    sections.push(`\n## Recent Workouts (Strava)\n${JSON.stringify(gathered.workouts || {}, null, 2)}`);
    sections.push(`\n## Recent Fitness Sessions (Home Gym)\n${JSON.stringify(gathered.fitnessSessions || {}, null, 2)}`);
    sections.push(`\n## Recently Watched Fitness Videos\n${JSON.stringify(gathered.recentlyWatched || {}, null, 2)}`);
    sections.push(`\n## Program State\n${JSON.stringify(gathered.programState || {}, null, 2)}`);
    sections.push(`\n## User Goals\n${JSON.stringify(gathered.goals || {}, null, 2)}`);

    if (gathered.content) {
      sections.push(`\n## Available Fitness Content (Active Program)\n${JSON.stringify(gathered.content, null, 2)}`);
    } else if (gathered.catalog) {
      sections.push(`\n## Fitness Content Catalog (No Active Program)\nThese shows are available in the fitness library. Use their IDs (prefixed with "plex:") as content_ids.\n${JSON.stringify(gathered.catalog, null, 2)}`);
    }

    sections.push(`\n## Working Memory\n${memory.serialize()}`);

    sections.push(`\n## Instructions
Produce a JSON object matching the dashboard schema.
- Select content_ids ONLY from the Available Fitness Content section above.
- Set generated_at to the current ISO timestamp.
- Reference real numbers from the health data. Do not invent values.
- If no active program, suggest content based on variety.
- Return raw JSON only, no markdown code fences.`);

    return sections.join('\n');
  }

  /**
   * Returns the JSON Schema that the LLM output must conform to.
   */
  getOutputSchema() {
    return dashboardSchema;
  }

  /**
   * Validate LLM output against the dashboard schema and domain rules.
   * @param {Object} raw - { output: string, toolCalls: Array }
   * @param {Object} gathered - Data from gather phase
   * @param {Object} logger - Logger
   * @returns {Object} Validated and parsed dashboard object
   * @throws {Error} If validation fails
   */
  async validate(raw, gathered, logger) {
    // Parse the LLM output
    let parsed;
    try {
      parsed = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
    } catch {
      throw new Error('Dashboard output is not valid JSON');
    }

    // Schema validation via OutputValidator
    const result = OutputValidator.validate(parsed, dashboardSchema);
    if (!result.valid) {
      throw new Error(`Dashboard validation failed: ${JSON.stringify(result.errors)}`);
    }

    // Domain validation: check content IDs exist in gathered data
    const primary = result.data.curated.up_next.primary;
    if (gathered.content?.episodes) {
      const knownIds = new Set(gathered.content.episodes.map(e => e.id));
      if (!knownIds.has(primary.content_id)) {
        logger?.warn?.('validate.unknown_content_id', { id: primary.content_id });
      }
    } else if (gathered.catalog?.shows) {
      const knownIds = new Set(gathered.catalog.shows.map(s => `plex:${s.id}`));
      if (!knownIds.has(primary.content_id)) {
        logger?.warn?.('validate.unknown_content_id', { id: primary.content_id });
      }
    }

    return result.data;
  }

  /**
   * Act phase - update working memory with recommendation tracking.
   * Dashboard persistence is handled by HealthCoachAgent after execute() returns,
   * since act() does not receive tools.
   */
  async act(validated, { memory, userId, logger }) {
    const today = new Date().toISOString().split('T')[0];

    // Track what we recommended for dedup
    const primaryId = validated.curated?.up_next?.primary?.content_id;
    if (primaryId) {
      memory.set('last_recommendation', primaryId, { ttl: 24 * 60 * 60 * 1000 }); // 24h
    }

    // Track coaching observations for dedup
    const ctas = validated.coach?.cta || [];
    for (const cta of ctas) {
      memory.set(`cta_${cta.type}_${today}`, cta.message, { ttl: 48 * 60 * 60 * 1000 }); // 48h
    }
  }
}
