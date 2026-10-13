/**
 * Detects shadow qualities manifesting in behavior patterns.
 * A "shadow" is the dysfunctional extreme of a quality.
 */
export class ShadowDetectionService {
  detectShadows(qualities, feedback) {
    const alerts = [];

    for (const quality of (qualities || [])) {
      if (!quality.shadow) continue;

      const indicators = quality.shadow.indicators || [];
      if (indicators.length === 0) continue;

      const shadowMatches = this.#matchFeedbackToIndicators(
        feedback || [],
        indicators
      );

      if (shadowMatches.length >= 2) {
        alerts.push({
          quality_id: quality.id,
          quality_name: quality.name,
          shadow_name: quality.shadow.name,
          shadow_description: quality.shadow.description,
          matchCount: shadowMatches.length,
          matches: shadowMatches,
          severity: shadowMatches.length >= 4 ? 'high' : shadowMatches.length >= 3 ? 'medium' : 'low',
        });
      }
    }

    return alerts;
  }

  #matchFeedbackToIndicators(feedback, indicators) {
    const matches = [];
    const indicatorLower = indicators.map(i => i.toLowerCase());

    for (const entry of feedback) {
      const text = (entry.text || '').toLowerCase();
      const tags = (entry.tags || []).map(t => t.toLowerCase());

      for (const indicator of indicatorLower) {
        if (text.includes(indicator) || tags.some(t => t.includes(indicator))) {
          matches.push({
            feedback_text: entry.text,
            indicator,
            timestamp: entry.timestamp,
          });
          break; // One match per feedback entry
        }
      }
    }

    return matches;
  }
}
