
const compileDailyFoodReport = async () => {};
import { loadFile, saveFile, userLoadFile, userSaveFile } from "./io.mjs";
import { userDataService } from "./config/UserDataService.mjs";
import { configService } from "./config/ConfigService.mjs";
import moment from "moment";
import crypto from "crypto";
import { load } from "js-yaml";
const generateCoachingMessageForDailyHealth = async () => {};
import { createLogger } from "./logging/logger.js";

const healthLogger = createLogger({ source: 'backend', app: 'health' });

const getDefaultUsername = () => {
  // Use head of household from config (never hardcode usernames)
  return configService.getHeadOfHousehold();
};

function md5(string) {
    string = string.toString(); 
  return crypto.createHash("md5").update(string).digest("hex");
}

const dailyHealth = async (jobId, daysBack = 15) => {
    const {nutribot_chat_id} = process.env;
    
    if (!nutribot_chat_id) {
        healthLogger.error('health.config.missing', { key: 'nutribot_chat_id' });
        return null;
    }
    
    await compileDailyFoodReport(nutribot_chat_id);
    
    // Load from user-namespaced paths
    const username = getDefaultUsername();
    const weightData = userLoadFile(username, 'weight') || {};
    const stravaData = userLoadFile(username, 'strava') || {};
    const garminData = userLoadFile(username, 'garmin') || {};
    const nutritionData = userLoadFile(username, 'nutrition/nutriday') || {};

    const pastDays = Array.from({length: daysBack}, (_, i) => 
        moment().subtract(i, 'days').format('YYYY-MM-DD')
    );

    const metrics = pastDays.map(date => {
        const dayWeight = weightData[date];
        const dayStrava = stravaData[date] || [];
        const dayGarmin = garminData[date] || [];
        const dayNutrition = nutritionData[date];

        // Merge Workouts
        const mergedWorkouts = [];
        const usedGarminIds = new Set();

        // Process Strava activities and try to match with Garmin
        dayStrava.forEach(s => {
            if (Array.isArray(s.heartRateOverTime)) {
                s.heartRateOverTime = s.heartRateOverTime.join('|');
            }

            // Find match in Garmin
            // Match criteria: Similar duration (+/- 5 mins)
            const match = dayGarmin.find(g => {
                if (usedGarminIds.has(g.activityId)) return false;
                const durationDiff = Math.abs((s.minutes || 0) - (g.duration || 0));
                return durationDiff < 5; // 5 minute tolerance
            });

            if (match) {
                usedGarminIds.add(match.activityId);
                mergedWorkouts.push({
                    source: 'merged',
                    title: s.title,
                    type: s.type || match.activityName,
                    duration: s.minutes,
                    calories: Math.max(s.calories || 0, match.calories || 0),
                    avgHr: s.avgHeartrate || match.averageHR,
                    maxHr: s.maxHeartrate || match.maxHR,
                    strava: s,
                    garmin: match
                });
            } else {
                mergedWorkouts.push({
                    source: 'strava',
                    title: s.title,
                    type: s.type,
                    duration: s.minutes,
                    calories: s.calories,
                    avgHr: s.avgHeartrate,
                    maxHr: s.maxHeartrate,
                    strava: s
                });
            }
        });

        // Add remaining Garmin activities
        dayGarmin.forEach(g => {
            if (!usedGarminIds.has(g.activityId)) {
                mergedWorkouts.push({
                    source: 'garmin',
                    title: g.activityName,
                    type: g.activityName,
                    duration: g.duration,
                    calories: g.calories,
                    avgHr: g.averageHR,
                    maxHr: g.maxHR,
                    garmin: g
                });
            }
        });

        return {
            date,
            weight: dayWeight ? {
                lbs: dayWeight.lbs,
                fat_percent: dayWeight.fat_percent,
                lean_lbs: dayWeight.lean_lbs,
                water_weight: dayWeight.water_weight,
                trend: dayWeight.lbs_adjusted_average_7day_trend
            } : null,
            nutrition: dayNutrition ? {
                calories: dayNutrition.calories,
                protein: dayNutrition.protein,
                carbs: dayNutrition.carbs,
                fat: dayNutrition.fat,
                food_count: dayNutrition.food_items ? dayNutrition.food_items.length : 0
            } : null,
            workouts: mergedWorkouts,
            summary: {
                total_workout_calories: mergedWorkouts.reduce((sum, w) => sum + (w.calories || 0), 0),
                total_workout_duration: mergedWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0)
            }
        };
    });

    // Convert array to object keyed by date for saving/merging
    const newDailyHealth = {};
    metrics.forEach(m => {
        newDailyHealth[m.date] = m;
    });

    // Load existing health data
    const onFileDays = userLoadFile(username, 'health') || {};
    
    // Merge and Sort
    const saveMe = Object.keys({...onFileDays, ...newDailyHealth})
        .sort().reverse()
        .reduce((acc, key) => {
            acc[key] = {...onFileDays, ...newDailyHealth}[key];
            return acc;
        }, {});

    // Save
    userSaveFile(username, 'health', saveMe);
    
    await generateCoachingMessageForDailyHealth();

    // Load coaching
    const healthCoaching = userLoadFile(username, 'health_coaching') || {};
    
    const result = {};
    metrics.forEach(m => {
        result[m.date] = m;
        if (healthCoaching[m.date]) {
            result[m.date].coaching = healthCoaching[m.date];
        }
    });

    return result;
};

export default dailyHealth;