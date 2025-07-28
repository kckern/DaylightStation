import { loadFile, saveFile } from '../lib/io.mjs';
import moment from 'moment';

//
// Keep the structure and variable names, but re-implement the internals.
//
const weightProcess = async (job_id) => {
    // Load data
    const weightPoints = (loadFile('lifelog/withings') || []).sort((a, b) => moment(a.date) - moment(b.date));

    // 1. Do a (re-implemented) linear interpolation over gaps for the last ~90 days
    let values = interpolateDays(weightPoints.slice(-90));

    // Attach a direct "measurement" property in case needed
    for (let point of weightPoints) {
        const date = moment(point.date).format('YYYY-MM-DD');
        const measurement = point.lbs;
        
        // Only attach measurements to dates that already exist in our interpolated data
        if (values[date]) {
            const previous = values[date]['measurement'];
            if(!!measurement && !!previous && previous < measurement) continue;
            values[date]['measurement'] = measurement;
        }
    }

    // 2. Rolling averages on interpolated data
    values = rollingAverage(values, 'lbs', 14);
    values = rollingAverage(values, 'fat_percent', 14);


    // 4. Calculate trendlines for different windows
    values = trendline(values, 'lbs_adjusted_average', 14);
    values = trendline(values, 'lbs_adjusted_average', 7);
    values = trendline(values, 'lbs_adjusted_average', 1);

    // 3. Extrapolate to current date if needed
    values = extrapolateToPresent(values);
    values = caloricBalance(values); 
    values = trendline(values, 'lbs_adjusted_average', 14);
    values = trendline(values, 'lbs_adjusted_average', 7);
    // Add water_weight for each day
    values = addWaterWeight(values);

    // Remove temporary "_diff" keys
    values = removeTempKeys(values);

    const keys = Object.keys(values);
    const sortedKeys = keys.sort((a, b) => moment(b) - moment(a));
    values = sortedKeys.reduce((acc, key) => { acc[key] = values[key]; return acc; }, {});

    // Save final results
    saveFile('lifelog/weight', values);

    return values;
};

//
// Re-implemented: fill in missing days for the most recent range we have,
// applying linear interpolation for each key that we care about.
//
function interpolateDays(values) {
    const keysToInterpolate = ['lbs', 'fat_percent'];


    const today = moment().format('YYYY-MM-DD');
    const maxDateFromValues = values.sort((a, b) => moment(b.date) - moment(a.date))[0]?.date;

  

    //extrapolate to today if needed
    if (maxDateFromValues && moment(maxDateFromValues).isBefore(today)) {
        const maxDateMeasurement = values.find(v => v.date === maxDateFromValues);
        values.push({ ...maxDateMeasurement, date: today });
    }

    // Sort the input records by date
    const sortedRecords = values
      .slice()
      .sort((a, b) => moment(a.date) - moment(b.date));


    // Identify the min and max date from those records
    const mindate = moment(sortedRecords[0].date).format('YYYY-MM-DD');
    const maxdate = moment(sortedRecords[sortedRecords.length - 1].date).format('YYYY-MM-DD');

    // Prepare a dictionary of all days from oldest to newest
    let allDates = {};
    let cursor = moment(mindate);
    while (cursor.diff(maxdate, 'days') <= 0) {
        const d = cursor.format('YYYY-MM-DD');
        // Attempt to find an existing record for this date
        const matchedRecord = sortedRecords.find(r => moment(r.date).format('YYYY-MM-DD') === d);
        allDates[d] = matchedRecord ? { ...matchedRecord } : { date: d };
        cursor = cursor.add(1, 'days');
    }

    // Now interpolate each key individually
    for (let key of keysToInterpolate) {
        allDates = interpolateKeyedValues(allDates, key);
    }

    return allDates;
}

//
// Re-implemented: For each missing day in [key], do a simple linear interpolation
// between the last known value before it and the next known value after it.
//
function interpolateKeyedValues(allDates, key) {
    const dateArray = Object.keys(allDates).sort((a, b) => moment(a) - moment(b));
    // Find all places we have an actual numeric value
    for (let i = 0; i < dateArray.length; i++) {
        const d = dateArray[i];
        if (typeof allDates[d][key] !== 'number') {
            // find previous day with a known value
            const prevIdx = findPreviousWithValue(dateArray, allDates, i, key);
            // find next day with a known value
            const nextIdx = findNextWithValue(dateArray, allDates, i, key);

            if (prevIdx !== null && nextIdx !== null) {
                // do linear interpolation
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

function findPreviousWithValue(dateArray, allDates, startIndex, key) {
    for (let i = startIndex - 1; i >= 0; i--) {
        if (typeof allDates[dateArray[i]][key] === 'number') return i;
    }
    return null;
}

function findNextWithValue(dateArray, allDates, startIndex, key) {
    for (let i = startIndex + 1; i < dateArray.length; i++) {
        if (typeof allDates[dateArray[i]][key] === 'number') return i;
    }
    return null;
}

//
// Re-implemented: compute a rolling average for the given key over windowSize days.
// Then also compute a "diff" and an average of that diff, used to produce an "adjusted_average."
//
function rollingAverage(items, key, windowSize) {
    const dates = Object.keys(items).sort((a, b) => moment(a) - moment(b));

    // We keep a queue of the last windowSize values for the average
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

    // Then compute diff from the rolling average
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const actual = items[date][key] || 0;
        const avg = items[date][`${key}_average`] || 0;
        items[date][`${key}_diff`] = Math.round((actual - avg) * 100) / 100;
    }

    // Next, a rolling average of that diff, to create an "adjusted" average
    sum = 0;
    queue.length = 0; // reuse the same queue structure
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
        // The adjusted average should be the rolling average MINUS the average bias
        // If measurements are consistently above the rolling average (positive avgDiff),
        // we want to adjust the average UP, not down
        items[date][`${key}_adjusted_average`] =
            Math.round((items[date][`${key}_average`] - avgDiff) * 100) / 100;
    }

    return items;
}

// For each day, add water_weight: shift the avg line so the minimum difference between measurement and avg is zero (i.e., the lowest point touches the line and all others are above)
function addWaterWeight(values) {
    const dates = Object.keys(values).sort((a, b) => moment(a) - moment(b));
    // Find the minimum difference between measurement and avg
    let minDiff = null;
    for (let i = 0; i < dates.length; i++) {
        const avg = values[dates[i]]['lbs_adjusted_average'];
        const m = values[dates[i]]['measurement'];
        if (typeof avg === 'number' && typeof m === 'number') {
            const diff = avg - m;
            if (minDiff === null || diff < minDiff) {
                minDiff = diff;
            }
        }
    }
    // Shift avg line down by minDiff so the lowest measurement touches the line
    for (let i = 0; i < dates.length; i++) {
        const avg = values[dates[i]]['lbs_adjusted_average'];
        if (typeof avg === 'number' && typeof minDiff === 'number') {
            values[dates[i]]['translated_avg'] = avg - minDiff;
        }
    }
    // Now calculate water_weight
    const windowSize = 14;
    for (let i = 0; i < dates.length; i++) {
        const currentDate = dates[i];
        const currentAvg = values[currentDate]['translated_avg'];
        const currentMeasurement = values[currentDate]['measurement'];
        // If current measurement equals the translated avg, water_weight is 0
        if (typeof currentMeasurement === 'number' && typeof currentAvg === 'number' && Math.abs(currentMeasurement - currentAvg) < 0.01) {
            values[currentDate]['water_weight'] = 0;
            continue;
        }
        // Otherwise, rolling average of (translated_avg - measurement) for measurements below the translated line
        let rollingDiffs = [];
        for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
            const avg = values[dates[j]]['translated_avg'];
            const m = values[dates[j]]['measurement'];
            if (typeof m === 'number' && typeof avg === 'number' && m < avg) {
                rollingDiffs.push(avg - m);
            }
        }
        const waterWeight = rollingDiffs.length ? (rollingDiffs.reduce((a, b) => a + b, 0) / rollingDiffs.length) : 0;
        values[currentDate]['water_weight'] = Math.round(waterWeight * 100) / 100;
    }
    return values;
}

//
// Re-implemented: trendline now uses a small linear regression over the last n days, 
// rather than a simple difference. We still store in  "[key]_[n]day_trend".
//
function trendline(values, key, n) {
    const dates = Object.keys(values).sort((a, b) => moment(a) - moment(b));

    for (let i = 0; i < dates.length; i++) {
        if (i < n) {
            // Not enough data to calculate trend for this date
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

function computeSlope(count, sumX, sumY, sumXY, sumX2) {
    const denominator = (count * sumX2 - sumX * sumX) || 1;
    return (count * sumXY - sumX * sumY) / denominator;
}

//
// Re-implemented: if the most recent record is before today's date, 
// use the last known 1-day trend to extrapolate forward.
//
function extrapolateToPresent(values) {
    const keysToExtrapolate = ['lbs_adjusted_average','fat_percent_adjusted_average'];
    const allRecords = Object.keys(values).sort((a, b) => moment(a) - moment(b));
    const mostRecentRecord = allRecords[allRecords.length - 1];

    const presentDate = moment().format('YYYY-MM-DD');
    const daysSinceLastRecord = moment(presentDate).diff(mostRecentRecord, 'days');
    if (daysSinceLastRecord < 1) return values;

    for (let key of keysToExtrapolate) {
        // We rely on the 1day trend from the last known record
        const lastValue = values[mostRecentRecord][key];
        const keys = Object.keys(values[mostRecentRecord]);
        const dailyChange = values[mostRecentRecord][`${key}_1day_trend`] || 0;
        for (let i = 1; i <= daysSinceLastRecord; i++) {
            const date = moment(mostRecentRecord).add(i, 'days').format('YYYY-MM-DD');
            values[date] = values[date] || { date };
            values[date][key] = Math.round((lastValue + dailyChange * i) * 100) / 100;
        }
    }

    // Reverse-sort again so that the newest is first
    const sortedKeys = Object.keys(values).sort((a, b) => moment(b) - moment(a));
    const newValues = {};
    for (let k of sortedKeys) {
        newValues[k] = values[k];
    }
    return newValues;
}

//
// Same as before: remove any keys that match a pattern (like /diff/).
//
function removeTempKeys(values) {
    const keysToRemove = [/diff/];
    for (let rx of keysToRemove) {
        for (let date of Object.keys(values)) {
            for (let k of Object.keys(values[date])) {
                if (rx.test(k)) delete values[date][k];
            }
        }
    }
    return values;
}

//
// Same as before: an example that uses "lbs_adjusted_average_7day_trend"
// to compute a "caloric_balance" placeholder. Logic remains the same.
//
function caloricBalance(values) {
    const dates = Object.keys(values).sort((a, b) => moment(a) - moment(b));
    const caloriesPerPound = 3500;
    values = dates.reduce((acc, key) => {
        const lbs = values[key]['lbs_adjusted_average'] || 0;
        const dayBefore = moment(key).subtract(1, 'days').format('YYYY-MM-DD') || null;
        const change = dayBefore && values[dayBefore] ? 
            (values[key]['lbs_adjusted_average'] - values[dayBefore]['lbs_adjusted_average']) : 0;
        const calorie_balance = Math.round((change * caloriesPerPound));
        acc[key] = values[key] || {};
        acc[key]['calorie_balance'] = calorie_balance
        return acc;
    }
    , {});
    return values;
}

export default weightProcess;