/**
 * Builds deterministic HTML status blocks for coaching messages.
 * No LLM involved — pure computation and formatting.
 */
export class CoachingMessageBuilder {

  /**
   * @param {{calories: {consumed, goal_min, goal_max}, protein: {consumed, goal}}} data
   * @returns {string} Telegram HTML
   */
  static buildPostReportBlock({ calories, protein }) {
    const calPct = calories.goal_max > 0 ? Math.round((calories.consumed / calories.goal_max) * 100) : 0;
    const protPct = protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0;

    return [
      `\u{1F525} <b>${calories.consumed} / ${calories.goal_max} cal</b> (${calPct}%)`,
      `\u{1F4AA} <b>${protein.consumed} / ${protein.goal}g protein</b> (${protPct}%)`,
    ].join('\n');
  }

  /**
   * @param {{yesterday: {calories, protein}, weekAvg: {calories, protein}, proteinGoal: number, weight: {current, trend7d}}} data
   * @returns {string} Telegram HTML
   */
  static buildMorningBriefBlock({ yesterday, weekAvg, proteinGoal, weight }) {
    const trend = weight.trend7d >= 0 ? `+${weight.trend7d.toFixed(2)}` : weight.trend7d.toFixed(2);

    return [
      `\u{1F4CA} <b>Yesterday:</b> ${yesterday.calories} cal \u{00B7} ${yesterday.protein}g protein`,
      `\u{1F4C9} <b>7-day avg:</b> ${weekAvg.calories} cal \u{00B7} ${weekAvg.protein}g protein (target: ${proteinGoal}g)`,
      `\u{2696}\u{FE0F} <b>Weight:</b> ${weight.current} lbs (${trend}/wk)`,
    ].join('\n');
  }

  /**
   * @param {{thisWeek: {avgCalories, avgProtein}, longTermAvg: {avgCalories, avgProtein}, weight: {weekStart, weekEnd, trend7d}}} data
   * @returns {string} Telegram HTML
   */
  static buildWeeklyDigestBlock({ thisWeek, longTermAvg, weight }) {
    const trend = weight.trend7d >= 0 ? `+${weight.trend7d.toFixed(2)}` : weight.trend7d.toFixed(2);

    return [
      `\u{1F4CA} <b>This week:</b> ${thisWeek.avgCalories} avg cal \u{00B7} ${thisWeek.avgProtein}g avg protein`,
      `\u{1F4C8} <b>vs 8-wk avg:</b> ${longTermAvg.avgCalories} cal \u{00B7} ${longTermAvg.avgProtein}g protein`,
      `\u{2696}\u{FE0F} <b>Weight trend:</b> ${trend} lbs this week \u{00B7} ${weight.weekStart} \u{2192} ${weight.weekEnd}`,
    ].join('\n');
  }

  /**
   * @param {{activity: {type, durationMin, caloriesBurned}, budgetImpact: number}} data
   * @returns {string} Telegram HTML
   */
  static buildExerciseReactionBlock({ activity, budgetImpact }) {
    return [
      `\u{1F3C3} <b>${activity.type}:</b> ${activity.durationMin} min \u{00B7} ${activity.caloriesBurned} cal burned`,
      `\u{1F525} <b>Budget update:</b> ~${budgetImpact} extra cal earned`,
    ].join('\n');
  }

  /**
   * Wrap commentary in blockquote if non-empty.
   * @param {string|null} commentary
   * @returns {string}
   */
  static wrapCommentary(commentary) {
    if (!commentary) return '';
    const trimmed = commentary.trim();
    if (!trimmed) return '';
    return `\n\n<blockquote>${trimmed}</blockquote>`;
  }
}
