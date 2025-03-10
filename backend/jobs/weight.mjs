
import { loadFile, saveFile } from '../lib/io.mjs';
import moment  from 'moment';
 const weightProcess = async(job_id) => {


    const weightPoints = loadFile('withings') || [];
    let values = interpolateDays(weightPoints.slice(0, 90));
    values = rollingAverage(values, 'lbs', 14);
    values = rollingAverage(values, 'fat_percent', 14);
    values = extrapolateToPresent(values);
    
    values = trendline(values, 'lbs_adjusted_average', 14);
    values = trendline(values, 'lbs_adjusted_average', 7);
    values = caloricBalance(values);
    values = trendline(values, 'lbs_adjusted_average', 1);
    values = removeTempKeys(values);
    saveFile('weight', values);
    return values;
}


function extrapolateToPresent(values) {
    const keysToExtrapolate = ['lbs_adjusted_average'];
    const allRecords = Object.keys(values).sort();
    const mostRecentRecord = allRecords[allRecords.length - 1];
    const presentDate = moment().format('YYYY-MM-DD');
    const daysSinceLastRecord = moment(presentDate).diff(mostRecentRecord, 'days');
    if (daysSinceLastRecord < 1) return values;
    for (let key of keysToExtrapolate) {
        const lastValue = values[mostRecentRecord][key];
        const dailyChange = values[mostRecentRecord][`${key}_1day_trend`] || 0;
        for (let i = 1; i <= daysSinceLastRecord; i++) {
            const date = moment(mostRecentRecord).add(i, 'days').format('YYYY-MM-DD');
            values[date] = values[date] || { date };
            values[date][key] = Math.round((lastValue + dailyChange * i) * 10) / 10;
        }
    }
    const sortedKeys = Object.keys(values).sort().reverse();
    //reconstitue the dictionary with the sorted keys
    const newValues = {};
    for (let key of sortedKeys) newValues[key] = values[key];
    return newValues;
}


function removeTempKeys(values) {
    const keysToRemove = [/diff/];
    for (let key of keysToRemove) {
        for (let date of Object.keys(values)) {
            for (let k of Object.keys(values[date])) {
                if (key.test(k)) delete values[date][k];
            }
        }
    }
    return values;
}

function interpolateDays(values) {
    const keysToInterpolate = ['lbs', 'fat_percent'];
    const allRecords = values.map(v => v.date).sort();
    const mindate = moment(allRecords[0]).format('YYYY-MM-DD');
    const maxdate = moment(allRecords[allRecords.length - 1]).format('YYYY-MM-DD');
    let allDates = {};
    for(let cursorDate = maxdate; cursorDate >= mindate; cursorDate = moment(cursorDate).subtract(1, 'days').format('YYYY-MM-DD')) {
        allDates[cursorDate] = values.find(v => v.date === cursorDate) || {};
    }
    for (let key of keysToInterpolate) allDates = interpolateKeyedValues(allDates, key);
    return allDates;
}

function caloricBalance(values) {
    const dates = Object.keys(values).sort();
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const trend = values[date].lbs_adjusted_average_7day_trend;
        const deficit = Math.round( (trend * 3500) / 7);
        values[date].caloric_balance = deficit;
    }
    return values;
}




function trendline(values, key, n) {
    const dates = Object.keys(values).sort();
    for (let i = 0; i < dates.length; i++) {
        const thisValue = values[dates[i]][key];
        const valueNtimesAgo = values[dates[Math.max(0, i - n)]][key];
        const diff = thisValue - valueNtimesAgo;
        values[dates[i]][`${key}_${n}day_trend`] = Math.round(diff * 10) / 10;
    }
    return values;
}



function rollingAverage(items, key, windowSize) {
    const averages = [];
    let sum = 0;
    const dates = Object.keys(items).sort();
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        if (i >= windowSize) sum -= items[dates[i - windowSize]][key] || 0;
        sum += items[date][key] || 0;
        const start = Math.max(0, i - windowSize + 1);
        const average = sum / (i - start + 1);
        averages.push(average);
        items[date][`${key}_average`] = Math.round(average * 10) / 10;
    }
    //calculate diff
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        items[date][`${key}_diff`] = items[date][key] - items[date][`${key}_average`];
    }

    //now get rolling average of the diff
    const diffAverages = [];
    sum = 0;
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        if (i >= windowSize) sum -= items[dates[i - windowSize]][`${key}_diff`] || 0;
        sum += items[date][`${key}_diff`] || 0;
        const start = Math.max(0, i - windowSize + 1);
        const average = Math.round(sum / (i - start + 1))
        diffAverages.push(Math.round(average * 10) / 10);
        items[date][`${key}_diff_average`] = Math.round(average * 10) / 10;
    }
    //now subtract the diff average from the rolling average to get adjusted average
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        items[date][`${key}_adjusted_average`] = items[date][`${key}_average`] - items[date][`${key}_diff_average`];
    }



    return items;
}



function interpolateKeyedValues(allDates, key) {
    const dateArray = Object.keys(allDates).sort();
    const values = dateArray.map(date => allDates[date][key] ?? null);
  
    // Find runs of missing values as "segments"
    let j = -1;
    const missingSegments = [];
    for (let i = 0; i < values.length; i++) {
      const currentValue = values[i];
      const prevValue = i > 0 ? values[i - 1] : null;
      const nextValue = i < values.length - 1 ? values[i + 1] : null;
  
      if (prevValue !== null && currentValue === null) {
        if (j < 0 || missingSegments[j].endDate) {
          j++;
          missingSegments[j] = {};
          // Start date is the last known date
          missingSegments[j].startDate = dateArray[i - 1];
          missingSegments[j].startValue = prevValue;
        }
      }
     if (currentValue === null && nextValue !== null && missingSegments[j] && !missingSegments[j].endDate) {
        missingSegments[j].endDate = dateArray[i + 1];
        missingSegments[j].endValue = nextValue;
        missingSegments[j].missingDayCount = 
          moment(missingSegments[j].endDate).diff(moment(missingSegments[j].startDate), 'days') - 1;
      }
    }
  
    // Interpolate each missing segment
    for (const segment of missingSegments) {
      const { startDate, startValue, endDate, endValue, missingDayCount } = segment;
      if (!missingDayCount || missingDayCount <= 0)  continue;
      const sDate = moment(startDate);
      const diff = endValue - startValue;
      const dailyDiff = diff / (missingDayCount + 1);
  
      for (let dayIndex = 1; dayIndex <= missingDayCount; dayIndex++) {
        const interpolatedDate = sDate.add(1, 'days').format('YYYY-MM-DD');
        const interpolatedValue = startValue + dayIndex * dailyDiff;
        allDates[interpolatedDate] = allDates[interpolatedDate] || { date: interpolatedDate };
        allDates[interpolatedDate]['date'] = interpolatedDate
        allDates[interpolatedDate][key] = Math.round(interpolatedValue * 10) / 10;
      }
    }
  
    return allDates;
  }




export default weightProcess;