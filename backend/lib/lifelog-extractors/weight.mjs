/**
 * Weight Lifelog Extractor
 * 
 * Extracts weight metrics from weight.yml
 * Structure: Date-keyed object with detailed weight and trend data
 */

export const weightExtractor = {
  source: 'weight',
  category: 'health',
  filename: 'weight',
  
  /**
   * Extract weight data for a specific date
   * @param {Object} data - Full weight.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted data or null
   */
  extractForDate(data, date) {
    const day = data?.[date];
    if (!day) return null;
    return {
      lbs: day.lbs,
      fatPercent: day.fat_percent,
      fatLbs: day.fat_lbs,
      leanLbs: day.lean_lbs,
      waterWeight: day.water_weight,
      average: day.lbs_average,
      adjustedAverage: day.lbs_adjusted_average,
      trend1day: day.lbs_adjusted_average_1day_trend,
      trend7day: day.lbs_adjusted_average_7day_trend,
      trend14day: day.lbs_adjusted_average_14day_trend,
      calorieBalance: day.calorie_balance
    };
  },

  /**
   * Format extracted data as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry) return null;
    
    const formatTrend = (val) => {
      if (val === undefined || val === null) return 'N/A';
      return val >= 0 ? `+${val}` : `${val}`;
    };
    
    const lines = [
      'WEIGHT METRICS:',
      `  Current: ${entry.lbs}lbs`,
    ];
    
    if (entry.fatPercent) lines.push(`  Body fat: ${entry.fatPercent}%`);
    if (entry.leanLbs) lines.push(`  Lean mass: ${entry.leanLbs}lbs`);
    if (entry.waterWeight) lines.push(`  Water weight: ${entry.waterWeight}lbs`);
    if (entry.trend7day !== undefined) lines.push(`  7-day trend: ${formatTrend(entry.trend7day)}lbs`);
    if (entry.trend14day !== undefined) lines.push(`  14-day trend: ${formatTrend(entry.trend14day)}lbs`);
    if (entry.calorieBalance !== undefined) lines.push(`  Calorie balance: ${entry.calorieBalance} calories`);
    
    return lines.join('\n');
  }
};

export default weightExtractor;
