/**
 * WeightProcessor - Computes weight analytics from raw Withings measurements
 *
 * Transforms raw withings.yml data into weight.yml with:
 * - Rolling averages (7-day, 14-day windows)
 * - Trend analysis (daily, weekly, bi-weekly)
 * - Water weight estimation
 * - Calorie balance estimation
 * - Interpolation for missing days
 *
 * @module 2_domains/health/services/WeightProcessor
 */

import moment from 'moment-timezone';

export class WeightProcessor {
  #lifelogStore;
  #logger;
  #timezone;

  /**
   * @param {Object} config
   * @param {Object} config.lifelogStore - Store for reading/writing lifelog YAML
   * @param {string} [config.timezone='America/Los_Angeles'] - Timezone for date parsing
   * @param {Object} [config.logger=console] - Logger instance
   */
  constructor({ lifelogStore, timezone = 'America/Los_Angeles', logger = console }) {
    if (!lifelogStore) {
      throw new Error('WeightProcessor requires lifelogStore');
    }

    this.#lifelogStore = lifelogStore;
    this.#timezone = timezone;
    this.#logger = logger;
  }

  /**
   * Process weight data for a user
   * Reads withings.yml, computes analytics, writes to weight.yml
   *
   * @param {string} username - Target user
   * @returns {Promise<{ status: string, datesProcessed: number }>}
   */
  async process(username) {
    try {
      this.#logger.info?.('weight.process.start', { username });

      // Load raw withings data
      const withingsData = await this.#lifelogStore.load(username, 'withings');
      if (!withingsData || !Array.isArray(withingsData) || withingsData.length === 0) {
        this.#logger.info?.('weight.process.no_data', { username });
        return { status: 'success', datesProcessed: 0 };
      }

      // Sort by date and take last 5 months (~150 days)
      const last5Months = withingsData
        .sort((a, b) => moment(a.date).valueOf() - moment(b.date).valueOf())
        .slice(-150);

      // Convert array to date-keyed object with all measurements per date
      const measurementsByDate = this.#groupByDate(last5Months);

      // Interpolate missing days
      let weightData = this.#interpolateDays(measurementsByDate);

      // Attach direct measurements
      for (const m of last5Months) {
        const date = moment(m.date).format('YYYY-MM-DD');
        if (weightData[date]) {
          const previous = weightData[date]['measurement'];
          // Keep smaller measurement if multiple exist
          if (!m.lbs || (previous && previous < m.lbs)) continue;
          weightData[date]['measurement'] = m.lbs;
        }
      }

      // Calculate rolling averages (two-stage smoothing)
      weightData = this.#rollingAverage(weightData, 'lbs', 14);
      weightData = this.#rollingAverage(weightData, 'fat_percent', 14);

      // Calculate trends
      weightData = this.#trendline(weightData, 'lbs_adjusted_average', 14);
      weightData = this.#trendline(weightData, 'lbs_adjusted_average', 7);
      weightData = this.#trendline(weightData, 'lbs_adjusted_average', 1);

      // Extrapolate to present
      weightData = this.#extrapolateToPresent(weightData);

      // Calculate caloric balance
      weightData = this.#caloricBalance(weightData);

      // Recalculate trends after extrapolation
      weightData = this.#trendline(weightData, 'lbs_adjusted_average', 14);
      weightData = this.#trendline(weightData, 'lbs_adjusted_average', 7);

      // Calculate water weight
      weightData = this.#addWaterWeight(weightData);

      // Remove temporary _diff keys
      weightData = this.#removeTempKeys(weightData);

      // Sort by date (oldest first)
      const dates = Object.keys(weightData).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());
      const finalWeightData = {};
      for (const date of dates) {
        finalWeightData[date] = weightData[date];
      }

      // Save processed weight data
      await this.#lifelogStore.save(username, 'weight', finalWeightData);

      this.#logger.info?.('weight.process.complete', {
        username,
        datesProcessed: dates.length,
      });

      return { status: 'success', datesProcessed: dates.length };
    } catch (error) {
      this.#logger.error?.('weight.process.error', {
        username,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Group measurements by date
   * @private
   */
  #groupByDate(measurements) {
    const byDate = {};

    for (const m of measurements) {
      if (!m.date || !m.lbs) continue;

      if (!byDate[m.date]) {
        byDate[m.date] = [];
      }
      byDate[m.date].push(m);
    }

    return byDate;
  }

  /**
   * Interpolate missing days using linear interpolation
   * @private
   */
  #interpolateDays(measurementsByDate) {
    const keysToInterpolate = ['lbs', 'fat_percent'];

    // Get all measurements as array, sorted by date
    const sortedRecords = [];
    for (const [date, measurements] of Object.entries(measurementsByDate)) {
      const latest = measurements.reduce((a, b) => (a.time > b.time ? a : b));
      sortedRecords.push({
        date: moment(date).format('YYYY-MM-DD'),
        lbs: latest.lbs,
        fat_percent: latest.fat_percent,
        time: latest.time,
      });
    }
    sortedRecords.sort((a, b) => moment(a.date).valueOf() - moment(b.date).valueOf());

    // Extrapolate to today if needed
    const today = moment().format('YYYY-MM-DD');
    const maxDateFromValues = sortedRecords[sortedRecords.length - 1]?.date;
    if (maxDateFromValues && moment(maxDateFromValues).isBefore(today)) {
      const maxDateMeasurement = sortedRecords[sortedRecords.length - 1];
      sortedRecords.push({ ...maxDateMeasurement, date: today });
    }

    // Identify min and max dates
    const mindate = sortedRecords[0].date;
    const maxdate = sortedRecords[sortedRecords.length - 1].date;

    // Create dictionary of all days from oldest to newest
    let allDates = {};
    let cursor = moment(mindate);
    while (cursor.diff(maxdate, 'days') <= 0) {
      const d = cursor.format('YYYY-MM-DD');
      const matchedRecord = sortedRecords.find((r) => r.date === d);
      allDates[d] = matchedRecord ? { ...matchedRecord } : { date: d };
      cursor = cursor.add(1, 'days');
    }

    // Interpolate each key
    for (const key of keysToInterpolate) {
      allDates = this.#interpolateKeyedValues(allDates, key);
    }

    return allDates;
  }

  /**
   * Interpolate a specific key across all dates
   * @private
   */
  #interpolateKeyedValues(allDates, key) {
    const dateArray = Object.keys(allDates).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());

    for (let i = 0; i < dateArray.length; i++) {
      const d = dateArray[i];
      if (typeof allDates[d][key] !== 'number') {
        // Find previous and next days with known values
        const prevIdx = this.#findPreviousWithValue(dateArray, allDates, i, key);
        const nextIdx = this.#findNextWithValue(dateArray, allDates, i, key);

        if (prevIdx !== null && nextIdx !== null) {
          // Linear interpolation
          const prevVal = allDates[dateArray[prevIdx]][key];
          const nextVal = allDates[dateArray[nextIdx]][key];

          const totalDays = nextIdx - prevIdx;
          const daysFromPrev = i - prevIdx;
          if (totalDays > 0) {
            const ratio = daysFromPrev / totalDays;
            const newVal = prevVal + ratio * (nextVal - prevVal);
            allDates[d][key] = Math.round(newVal * 100) / 100;
          }
        }
      }
    }
    return allDates;
  }

  /**
   * Find previous date with a value for key
   * @private
   */
  #findPreviousWithValue(dateArray, allDates, startIndex, key) {
    for (let i = startIndex - 1; i >= 0; i--) {
      if (typeof allDates[dateArray[i]][key] === 'number') return i;
    }
    return null;
  }

  /**
   * Find next date with a value for key
   * @private
   */
  #findNextWithValue(dateArray, allDates, startIndex, key) {
    for (let i = startIndex + 1; i < dateArray.length; i++) {
      if (typeof allDates[dateArray[i]][key] === 'number') return i;
    }
    return null;
  }

  /**
   * Calculate rolling average with two-stage smoothing
   * Creates: key_average, key_diff, key_diff_average, key_adjusted_average
   * @private
   */
  #rollingAverage(items, key, windowSize) {
    const dates = Object.keys(items).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());

    // Stage 1: Rolling average of raw values
    let sum = 0;
    const queue = [];
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const val = items[date][key] || 0;
      sum += val;
      queue.push(val);

      if (queue.length > windowSize) {
        sum -= queue.shift();
      }

      const avg = queue.length ? sum / queue.length : 0;
      items[date][`${key}_average`] = Math.round(avg * 100) / 100;
    }

    // Stage 2: Compute diff from rolling average
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const actual = items[date][key] || 0;
      const avg = items[date][`${key}_average`] || 0;
      items[date][`${key}_diff`] = Math.round((actual - avg) * 100) / 100;
    }

    // Stage 3: Rolling average of diff
    sum = 0;
    queue.length = 0;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const val = items[date][`${key}_diff`] || 0;
      sum += val;
      queue.push(val);

      if (queue.length > windowSize) {
        sum -= queue.shift();
      }

      const avgDiff = queue.length ? sum / queue.length : 0;
      items[date][`${key}_diff_average`] = Math.round(avgDiff * 100) / 100;

      // Stage 4: Adjusted average = average - avgDiff
      // If measurements are consistently above rolling avg (positive avgDiff),
      // we adjust the average UP by subtracting negative bias
      items[date][`${key}_adjusted_average`] =
        Math.round((items[date][`${key}_average`] - avgDiff) * 100) / 100;
    }

    return items;
  }

  /**
   * Calculate trendline (difference over n days)
   * @private
   */
  #trendline(values, key, n) {
    const dates = Object.keys(values).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());

    for (let i = 0; i < dates.length; i++) {
      if (i < n) {
        values[dates[i]][`${key}_${n}day_trend`] = null;
        continue;
      }

      const todayValue = values[dates[i]][key];
      const nDaysAgoValue = values[dates[i - n]][key];

      if (todayValue !== undefined && nDaysAgoValue !== undefined) {
        const diff = todayValue - nDaysAgoValue;
        values[dates[i]][`${key}_${n}day_trend`] = Math.round(diff * 100) / 100;
      } else {
        values[dates[i]][`${key}_${n}day_trend`] = null;
      }
    }

    return values;
  }

  /**
   * Extrapolate to present date if most recent data is old
   * @private
   */
  #extrapolateToPresent(values) {
    const keysToExtrapolate = ['lbs_adjusted_average', 'fat_percent_adjusted_average'];
    const allRecords = Object.keys(values).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());
    const mostRecentRecord = allRecords[allRecords.length - 1];

    const presentDate = moment().format('YYYY-MM-DD');
    const daysSinceLastRecord = moment(presentDate).diff(mostRecentRecord, 'days');

    if (daysSinceLastRecord < 1) return values;

    for (const key of keysToExtrapolate) {
      const lastValue = values[mostRecentRecord][key];
      const dailyChange = values[mostRecentRecord][`${key}_1day_trend`] || 0;

      for (let i = 1; i <= daysSinceLastRecord; i++) {
        const date = moment(mostRecentRecord).add(i, 'days').format('YYYY-MM-DD');
        values[date] = values[date] || { date };
        values[date][key] = Math.round((lastValue + dailyChange * i) * 100) / 100;
      }
    }

    return values;
  }

  /**
   * Calculate caloric balance from daily weight changes
   * @private
   */
  #caloricBalance(values) {
    const dates = Object.keys(values).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());
    const caloriesPerPound = 3500;

    for (const date of dates) {
      const dayBefore = moment(date).subtract(1, 'days').format('YYYY-MM-DD');
      const change =
        dayBefore && values[dayBefore]
          ? values[date]['lbs_adjusted_average'] - values[dayBefore]['lbs_adjusted_average']
          : 0;
      values[date]['calorie_balance'] = Math.round(change * caloriesPerPound);
    }

    return values;
  }

  /**
   * Calculate water weight using translated_avg approach
   * Shifts avg line so lowest measurement touches it
   * @private
   */
  #addWaterWeight(values) {
    const dates = Object.keys(values).sort((a, b) => moment(a).valueOf() - moment(b).valueOf());

    // Find minimum difference between measurement and avg
    let minDiff = null;
    for (const date of dates) {
      const avg = values[date]['lbs_adjusted_average'];
      const m = values[date]['measurement'];
      if (typeof avg === 'number' && typeof m === 'number') {
        const diff = avg - m;
        if (minDiff === null || diff < minDiff) {
          minDiff = diff;
        }
      }
    }

    // Shift avg line down by minDiff (translated_avg)
    for (const date of dates) {
      const avg = values[date]['lbs_adjusted_average'];
      if (typeof avg === 'number' && typeof minDiff === 'number') {
        values[date]['translated_avg'] = avg - minDiff;
      }
    }

    // Calculate water weight
    const windowSize = 14;
    for (let i = 0; i < dates.length; i++) {
      const currentDate = dates[i];
      const currentAvg = values[currentDate]['translated_avg'];
      const currentMeasurement = values[currentDate]['measurement'];

      // If measurement equals translated avg, water_weight is 0
      if (
        typeof currentMeasurement === 'number' &&
        typeof currentAvg === 'number' &&
        Math.abs(currentMeasurement - currentAvg) < 0.01
      ) {
        values[currentDate]['water_weight'] = 0;
        continue;
      }

      // Rolling average of (translated_avg - measurement) for measurements below line
      const rollingDiffs = [];
      for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
        const avg = values[dates[j]]['translated_avg'];
        const m = values[dates[j]]['measurement'];
        if (typeof m === 'number' && typeof avg === 'number' && m < avg) {
          rollingDiffs.push(avg - m);
        }
      }

      const waterWeight = rollingDiffs.length
        ? rollingDiffs.reduce((a, b) => a + b, 0) / rollingDiffs.length
        : 0;
      values[currentDate]['water_weight'] = Math.round(waterWeight * 100) / 100;
    }

    return values;
  }

  /**
   * Remove temporary keys like _diff
   * @private
   */
  #removeTempKeys(values) {
    const keysToRemove = [/diff/];
    for (const rx of keysToRemove) {
      for (const date of Object.keys(values)) {
        for (const k of Object.keys(values[date])) {
          if (rx.test(k)) delete values[date][k];
        }
      }
    }
    return values;
  }
}

export default WeightProcessor;
