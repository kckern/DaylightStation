// backend/src/3_applications/agents/health-coach/services/UserModelService.mjs

/**
 * UserModelService — T9 of the health-coach reflective architecture.
 *
 * Composes a markdown block that summarises the user's profile + rolling
 * baselines and appends it to the agent's system prompt every turn.  The
 * model can therefore reason against actual user data instead of hallucinating
 * baseline values.
 */
export class UserModelService {
  #personalConstantsService;
  #baselineService;
  #now;

  constructor({ personalConstantsService, baselineService, now = () => new Date() }) {
    this.#personalConstantsService = personalConstantsService;
    this.#baselineService = baselineService;
    this.#now = now;
  }

  /**
   * Compose a markdown block for the given user.  Never throws — errors from
   * either dependency are caught and produce a degraded-but-valid output.
   *
   * @param {{ userId: string }} opts
   * @returns {Promise<string>}
   */
  async composeContext({ userId }) {
    const [profile, baselines] = await Promise.all([
      Promise.resolve()
        .then(() => this.#personalConstantsService?.get?.(userId))
        .catch(() => ({})),
      Promise.resolve()
        .then(() => this.#baselineService?.getBaselines?.({ userId }))
        .catch(() => null),
    ]);

    const lines = [];
    lines.push('## Your model of this user (auto-loaded each turn)');
    lines.push('');

    // --- Today ---
    const today = this.#now();
    const dateStr = today.toISOString().slice(0, 10);
    const weekday = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    lines.push('### Today');
    lines.push(`- Date: ${dateStr} (${weekday})`);
    lines.push('- Use this date as ground truth when the user references relative days ("Saturday", "yesterday", "last week"). Do not guess years.');
    lines.push('');

    // --- Profile ---
    const p = profile || {};
    const profileLines = [];
    if (p.weight_lbs)  profileLines.push(`- Weight: ${p.weight_lbs} lbs`);
    if (p.height_cm)   profileLines.push(`- Height: ${p.height_cm} cm`);
    if (p.age)         profileLines.push(`- Age: ${p.age}`);
    if (p.sex)         profileLines.push(`- Sex: ${p.sex}`);
    if (profileLines.length) {
      lines.push('### Profile');
      lines.push(...profileLines);
      lines.push('');
    }

    // --- Baselines ---
    lines.push('### Baselines (rolling)');
    if (!baselines) {
      lines.push('- No baselines available yet (insufficient history).');
    } else {
      let hasAnyData = false;

      const f = baselines.fitness;
      if (f && f.n > 0 && f.workouts_per_week_total != null) {
        hasAnyData = true;
        const byKind = Object.entries(f.workouts_per_week_by_kind || {})
          .map(([k, v]) => `${v} ${k}`).join(', ');
        const byKindStr = byKind ? ` (${byKind})` : '';
        lines.push(`- Workouts: ${f.workouts_per_week_total}/wk total${byKindStr}`);
        if (f.run) {
          const parts = [`${f.run.median_duration_min} min`];
          if (f.run.median_hr_avg) parts.push(`${f.run.median_hr_avg} avg HR`);
          if (f.run.median_hr_max) parts.push(`${f.run.median_hr_max} max HR`);
          lines.push(`- Typical run: ${parts.join(' @ ')}`);
        }
        if (f.strength) {
          lines.push(`- Typical strength: ${f.strength.median_duration_min} min`);
        }
      }

      const n = baselines.nutrition;
      if (n && n.kcal_avg != null) {
        hasAnyData = true;
        const parts = [`${n.kcal_avg}/d avg`];
        if (n.protein_g_avg != null) parts.push(`protein ${n.protein_g_avg}g/d`);
        lines.push(`- Calories: ${parts.join(', ')}`);
      }

      const w = baselines.weight;
      if (w && w.trim_mean != null) {
        hasAnyData = true;
        const slope = w.slope_lbs_per_30d ?? 0;
        const slopeStr = slope > 0 ? `+${slope}` : `${slope}`;
        lines.push(`- Weight: ${w.trim_mean} lbs (trend: ${slopeStr} lbs/30d)`);
      }

      if (!hasAnyData) {
        lines.push('- No baselines available yet (insufficient history).');
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}

export default UserModelService;
