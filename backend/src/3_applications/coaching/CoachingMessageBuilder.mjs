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
    const consumedCal = Math.round(calories.consumed);
    const consumedProt = Math.round(protein.consumed);
    const calPct = calories.goal_max > 0 ? Math.round((calories.consumed / calories.goal_max) * 100) : 0;
    const protPct = protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0;

    return [
      `\u{1F525} <b>${consumedCal} / ${calories.goal_max} cal</b> (${calPct}%)`,
      `\u{1F4AA} <b>${consumedProt} / ${protein.goal}g protein</b> (${protPct}%)`,
    ].join('\n');
  }

  /**
   * @param {Object} data
   * @param {{calories, protein, status}} data.yesterday - status from dayCompleteness
   * @param {{calories, protein, trustedDays, totalDays}} data.weekAvg - averaged over trusted days only
   * @param {number} data.proteinGoal
   * @param {{current, trend7d}|null} data.weight - null when there is no weight data
   * @param {number} data.minCalories - completeness threshold
   * @returns {string} Telegram HTML
   */
  static buildMorningBriefBlock({ yesterday, weekAvg, proteinGoal, weight, minCalories }) {
    const lines = [...CoachingMessageBuilder.#yesterdayLines(yesterday, minCalories)];

    lines.push(weekAvg.trustedDays > 0
      ? `\u{1F4C9} <b>7-day avg:</b> ${weekAvg.calories} cal \u{00B7} ${weekAvg.protein}g protein (target: ${proteinGoal}g)${CoachingMessageBuilder.#coverage(weekAvg)}`
      : `\u{1F4C9} <b>7-day avg:</b> no fully logged days`);

    if (weight) {
      lines.push(`\u{2696}\u{FE0F} <b>Weight:</b> ${weight.current.toFixed(1)} lbs (${CoachingMessageBuilder.#signed(weight.trend7d)}/wk)`);
    }
    return lines.join('\n');
  }

  /**
   * @param {Object} data
   * @param {{calories, protein, trustedDays, totalDays}} data.thisWeek - trusted days only
   * @param {{calories, protein, trustedDays, totalDays}} data.longTermAvg - trusted days only
   * @param {{weekStart, weekEnd, trend7d}|null} data.weight
   * @returns {string} Telegram HTML
   */
  static buildWeeklyDigestBlock({ thisWeek, longTermAvg, weight }) {
    const lines = [thisWeek.trustedDays > 0
      ? `\u{1F4CA} <b>This week:</b> ${thisWeek.calories} avg cal \u{00B7} ${thisWeek.protein}g avg protein${CoachingMessageBuilder.#coverage(thisWeek)}`
      : `\u{1F4CA} <b>This week:</b> no fully logged days`];

    if (longTermAvg.trustedDays > 0) {
      lines.push(`\u{1F4C8} <b>vs 8-wk avg:</b> ${longTermAvg.calories} cal \u{00B7} ${longTermAvg.protein}g protein`);
    }
    if (weight) {
      lines.push(`\u{2696}\u{FE0F} <b>Weight trend:</b> ${CoachingMessageBuilder.#signed(weight.trend7d)} lbs this week \u{00B7} ${weight.weekStart.toFixed(1)} \u{2192} ${weight.weekEnd.toFixed(1)}`);
    }
    return lines.join('\n');
  }

  static #yesterdayLines(day, minCalories) {
    const totals = `${day.calories} cal \u{00B7} ${day.protein}g protein`;
    switch (day.status) {
      case 'fasting':
        return [`\u{1F4CA} <b>Yesterday:</b> fast \u{00B7} ${totals}`];
      case 'incomplete':
        return [
          `\u{1F4CA} <b>Yesterday:</b> ${totals} logged \u{2014} looks incomplete`,
          `\u{21B3} Under ${minCalories} cal. If that was everything, send /done yesterday (or /fast yesterday).`,
        ];
      case 'unlogged':
        return [`\u{1F4CA} <b>Yesterday:</b> nothing logged`];
      default:
        return [`\u{1F4CA} <b>Yesterday:</b> ${totals}`];
    }
  }

  static #coverage({ trustedDays, totalDays }) {
    return trustedDays < totalDays ? ` \u{00B7} ${trustedDays} of ${totalDays} days fully logged` : '';
  }

  static #signed(n) {
    return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
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
