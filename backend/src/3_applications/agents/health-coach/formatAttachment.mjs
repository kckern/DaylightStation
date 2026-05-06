// backend/src/3_applications/agents/health-coach/formatAttachment.mjs

/**
 * Render a health-coach attachment to a system-prompt line, resolving
 * period bounds inline and pointing the model at the right tool.
 *
 * @param {object} attachment
 * @param {object} ctx - { userId, periodResolver }
 * @returns {Promise<string>}
 */
export async function formatHealthAttachment(attachment, { userId, periodResolver } = {}) {
  const label = attachment?.label || '(unlabeled)';
  const type = attachment?.type;

  if (type === 'period' && attachment.value && periodResolver) {
    try {
      const r = await periodResolver.resolve(attachment.value, { userId });
      const subSource = r.subSource ? ` ${r.subSource}` : '';
      return `\`${label}\` → period (${r.source}${subSource}): ${r.from} to ${r.to}`;
    } catch (err) {
      return `\`${label}\` → period (unresolvable: ${err.message})`;
    }
  }

  if (type === 'day' && attachment.date) {
    return `\`${label}\` → day ${attachment.date}. ` +
           `Use get_health_summary, query_historical_workouts, or query_historical_nutrition for that date.`;
  }

  if (type === 'workout' && attachment.date) {
    return `\`${label}\` → workout on ${attachment.date}. ` +
           `Use query_historical_workouts with from=${attachment.date}, to=${attachment.date}.`;
  }

  if (type === 'nutrition' && attachment.date) {
    return `\`${label}\` → nutrition log on ${attachment.date}. ` +
           `Use query_historical_nutrition with from=${attachment.date}, to=${attachment.date}.`;
  }

  if (type === 'weight' && attachment.date) {
    return `\`${label}\` → weight reading on ${attachment.date}. ` +
           `Use query_historical_weight with from=${attachment.date}, to=${attachment.date}.`;
  }

  if (type === 'metric_snapshot' && attachment.metric && attachment.period && periodResolver) {
    try {
      const r = await periodResolver.resolve(attachment.period, { userId });
      return `\`${label}\` → metric_snapshot for ${attachment.metric} over ${r.from} to ${r.to}. ` +
             `Use aggregate_metric or metric_snapshot.`;
    } catch (err) {
      return `\`${label}\` → metric_snapshot for ${attachment.metric} (period unresolvable: ${err.message})`;
    }
  }

  return `\`${label}\` (${type ?? 'unknown'})`;
}

export default formatHealthAttachment;
