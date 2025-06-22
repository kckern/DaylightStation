import { getNutriDaysBack, loadDailyNutrition } from "../journalist/lib/db.mjs";
import { compileDailyFoodReport } from "../journalist/lib/food.mjs";
import { loadFile, saveFile } from "./io.mjs";
import moment from "moment";
import crypto from "crypto";
import { load } from "js-yaml";
import { generateCoachingMessageForDailyHealth } from "../journalist/lib/gpt_food.mjs";

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

    const past90Days = Array.from({length: 30}, (_, i) => 
        moment().subtract(i + 1, 'days').format('YYYY-MM-DD')
    );
    const dailyHealth = {};
    for(const day of past90Days) {
        const dayRawData = {
            date: day,
            weight: weight[day] || null,
            strava: strava[day] || [],
            nutrition: dailyNutrition[day] || null,
            fitness: fitness[day] || []
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
    await generateCoachingMessageForDailyHealth();

    const healthCoaching = loadFile('lifelog/health_coaching');
    for(const day of Object.keys(healthCoaching).sort().reverse()) {
        if(dailyHealth[day]) {
            dailyHealth[day].coaching = healthCoaching[day];
        }
    }

    return dailyHealth;
}





export default dailyHealth;