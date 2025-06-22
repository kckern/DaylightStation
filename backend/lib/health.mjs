import { getNutriDaysBack, loadDailyNutrition } from "../journalist/lib/db.mjs";
import { compileDailyFoodReport } from "../journalist/lib/food.mjs";
import { loadFile, saveFile } from "./io.mjs";
import moment from "moment";
import crypto from "crypto";
import { load } from "js-yaml";

function md5(string) {
    string = string.toString(); 
  return crypto.createHash("md5").update(string).digest("hex");
}



const dailyHealth = async (jobId) => {
    const {nutribot_chat_id} = process.env;
    await compileDailyFoodReport(nutribot_chat_id);
    const weight = loadFile('lifelog/weight');
    const strava = loadFile('lifelog/strava');
    const dailyNutrition = getNutriDaysBack(nutribot_chat_id,30);
    const fitness = loadFile('lifelog/fitness');

    const past90Days = Array.from({length: 14}, (_, i) => 
        moment().subtract(i + 1, 'days').format('YYYY-MM-DD')
    );
    const dailyHealth = {};
    for(const day of past90Days) {
        const dayRawData = {
            date: day,
            weight: weight[day] || null,
            //"weight": { "time": 1750519077, "date": "2025-06-21", "lbs": 177.7, "fat_lbs": 46.1, "fat_percent": 25.9, "lean_lbs": 131.6, "measurement": 177.7, "lbs_average": 178.69, "lbs_adjusted_average": 179.92, "fat_percent_average": 24.33, "fat_percent_adjusted_average": 24.11, "lbs_adjusted_average_14day_trend": -2.34, "lbs_adjusted_average_7day_trend": -1.41, "lbs_adjusted_average_1day_trend": -0.2, "calorie_balance": -700 },
            strava: strava[day] || [],
            //"strava": [ { "title": "Morning Weight Training", "distance": 0, "minutes": 26.85, "startTime": "06:06 am", "suffer_score": 5, "avgHeartrate": 108.3, "maxHeartrate": 140, "heartRateOverTime": [] } ],
            nutrition: dailyNutrition[day] || null,
            //"nutrition": { "calories": 1533, "protein": 78, "carbs": 126, "fat": 75, "fiber": 12, "sodium": 1588, "sugar": 58, "cholesterol": 186, "food_items": [ "🟠 100g Falafel (333 cal)", "🟠 30g Gorgonzola (116 cal)", "🟠 30g Peppercorn Ranch (110 cal)", "🟠 20g Crispy Onions (90 cal)", "🟠 30g Balsamic Glaze (82 cal)", "🟠 15g Fun-Sized Chocolate Bar (80 cal)", "🟠 12g Focaccia (35 cal)", "🟡 100g Steak (204 cal)", "🟡 100g Chicken (165 cal)", "🟡 30g Honey Mustard Dressing (120 cal)", "🟡 50g Roasted Sweet Potato (45 cal)", "🟡 20g Greek Yogurt (12 cal)", "🟢 100g Grapes (69 cal)", "🟢 50g Roasted Broccoli (17 cal)", "🟢 50g Arugula (13 cal)", "🟢 50g Salad Greens (10 cal)", "🟢 50g Romaine (9 cal)", "🟢 20g Salsa (8 cal)", "🟢 20g Jalapeño (6 cal)", "🟢 20g Spicy Peppers (6 cal)", "🟢 5g Grape (3 cal)" ] },
            fitness: fitness[day] || []
            //"fitness": { "steps": { "steps_count": 2063, "bmr": 1531, "duration": 10.18, "calories": 0, "maxHeartRate": 150, "avgHeartRate": 70 }, "activities": [ { "title": "Strength Training", "calories": 176, "distance": 0, "minutes": 26.85, "startTime": "06:06 am", "endTime": "06:32 am", "avgHeartrate": 108 } ] }
        };

        const mergeWorkouts = (strava, activities) => {
            strava = strava || [];
            activities = activities || [];
            strava = strava.map(s => ({...s, uuid: md5(`${s.startTime}`)}));
            activities = activities.map(a => ({...a, uuid: md5(`${a.startTime}`)}));
            const all = [...strava, ...activities].map(a=>a.uuid);
            const unique = [...new Set(all)];
            const uniqueWorkouts = unique.map(uuid => {
                const fromStrava = strava.find(s => s.uuid === uuid);
                const fromActivities = activities.find(a => a.uuid === uuid);
                const merged = {
                    title: fromStrava?.title || fromActivities?.title,
                    distance: (fromStrava?.distance || 0) + (fromActivities?.distance || 0),
                    minutes: (fromStrava?.minutes || 0) + (fromActivities?.duration || 0),
                    startTime: fromStrava?.startTime || fromActivities?.startTime,
                    suffer_score: fromStrava?.suffer_score || fromActivities?.suffer_score,
                    avgHeartrate: fromStrava?.avgHeartrate || fromActivities?.avgHeartrate,
                    maxHeartrate: fromStrava?.maxHeartrate || fromActivities?.maxHeartrate,
                    calories: (fromStrava?.calories || 0) + (fromActivities?.calories || 0)
                };
                const stringParts = [
                    merged.startTime ? `[${merged.startTime.replace(/^0/,'')}]` : false,
                    merged.minutes ? `${parseInt(merged.minutes)}min` : false,
                    merged.title || false,
                    merged.calories ? `(${merged.calories} cal,` : false,
                    merged.avgHeartrate ? `Avg HR: ${merged.avgHeartrate}` : false,
                    merged.maxHeartrate ? `Max HR: ${merged.maxHeartrate}` : false,
                    merged.suffer_score ? `Suffer Score: ${merged.suffer_score}` : false
                ].filter(Boolean); // Remove empty parts
                const string = stringParts.join(' ') + ')';
                return string;
            });
            return uniqueWorkouts;

        };

        const dayData = {
            date: day,
            // weight
            lbs: dayRawData.weight.lbs_adjusted_average,
            fat_percent: dayRawData.weight.fat_percent_average,
            weekly_delta: dayRawData.weight.lbs_adjusted_average_7day_trend,
            calorie_balance: dayRawData.weight.calorie_balance,
            // nutrition
            ...dailyNutrition[day] || {},

            // activities
            steps: dayRawData.fitness.steps ? dayRawData.fitness.steps.steps_count : 0,
            workouts: mergeWorkouts(dayRawData.strava, dayRawData.fitness.activities)
        };
        //remove empty
        if(!dayData.steps) delete dayData.steps;
        if(!dayData.workouts.length) delete dayData.workouts;

        dailyHealth[day] = dayData;
    }
     const onFileDays = loadFile('lifelog/health');
    const saveMe = Object.keys({...onFileDays, ...dailyHealth})
        .sort().reverse()
        .reduce((acc, key) => {
            acc[key] = {...onFileDays, ...dailyHealth}[key];
            return acc;
        }, {});
    saveFile('lifelog/health', saveMe);
    return dailyHealth;
}


export default dailyHealth;