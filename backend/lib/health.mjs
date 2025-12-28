
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
    const fitnessData = userLoadFile(username, 'fitness') || {}; // FitnessSyncer
    const nutritionData = userLoadFile(username, 'nutrition/nutriday') || {};

    const pastDays = Array.from({length: daysBack}, (_, i) => 
        moment().subtract(i, 'days').format('YYYY-MM-DD')
    );

    const metrics = pastDays.map(date => {
        const dayWeight = weightData[date];
        const dayStrava = stravaData[date] || [];
        const dayGarmin = garminData[date] || [];
        const dayFitness = fitnessData[date]; // FitnessSyncer data
        const dayNutrition = nutritionData[date];

        // Merge Workouts
        const mergedWorkouts = [];
        const usedGarminIds = new Set();
        const usedFitnessIds = new Set();
        const fitnessActivities = dayFitness?.activities || [];

        // Process Strava activities and try to match with Garmin or FitnessSyncer
        dayStrava.forEach(s => {
            if (Array.isArray(s.heartRateOverTime)) {
                s.heartRateOverTime = s.heartRateOverTime.join('|');
            }

            // Find match in Garmin first
            const garminMatch = dayGarmin.find(g => {
                if (usedGarminIds.has(g.activityId)) return false;
                const durationDiff = Math.abs((s.minutes || 0) - (g.duration || 0));
                return durationDiff < 5; // 5 minute tolerance
            });

            if (garminMatch) {
                usedGarminIds.add(garminMatch.activityId);
                mergedWorkouts.push({
                    source: 'strava+garmin',
                    title: s.title,
                    type: s.type || garminMatch.activityName,
                    duration: s.minutes,
                    calories: Math.max(s.calories || 0, garminMatch.calories || 0),
                    avgHr: s.avgHeartrate || garminMatch.averageHR,
                    maxHr: s.maxHeartrate || garminMatch.maxHR,
                    strava: s,
                    garmin: garminMatch
                });
            } else {
                // No Garmin match, try FitnessSyncer
                const fitnessMatch = fitnessActivities.find((f, idx) => {
                    if (usedFitnessIds.has(idx)) return false;
                    const durationDiff = Math.abs((s.minutes || 0) - (f.minutes || 0));
                    return durationDiff < 5;
                });

                if (fitnessMatch) {
                    const idx = fitnessActivities.indexOf(fitnessMatch);
                    usedFitnessIds.add(idx);
                    mergedWorkouts.push({
                        source: 'strava+fitness',
                        title: s.title || fitnessMatch.title,
                        type: s.type,
                        duration: s.minutes,
                        calories: Math.max(s.calories || 0, fitnessMatch.calories || 0),
                        avgHr: s.avgHeartrate || fitnessMatch.avgHeartrate,
                        maxHr: s.maxHeartrate,
                        strava: s,
                        fitness: fitnessMatch
                    });
                } else {
                    // No match, just Strava
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

        // Add remaining FitnessSyncer activities
        fitnessActivities.forEach((f, idx) => {
            if (!usedFitnessIds.has(idx)) {
                mergedWorkouts.push({
                    source: 'fitness',
                    title: f.title,
                    type: 'Activity',
                    duration: f.minutes,
                    calories: f.calories,
                    avgHr: f.avgHeartrate,
                    distance: f.distance,
                    startTime: f.startTime,
                    endTime: f.endTime,
                    fitness: f
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
            steps: dayFitness?.steps ? {
                count: dayFitness.steps.steps_count,
                bmr: dayFitness.steps.bmr,
                duration: dayFitness.steps.duration,
                calories: dayFitness.steps.calories,
                maxHr: dayFitness.steps.maxHeartRate,
                avgHr: dayFitness.steps.avgHeartRate
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