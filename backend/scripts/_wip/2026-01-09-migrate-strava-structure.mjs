
import { userLoadFile, userSaveFile } from '../lib/io.mjs';
import { configService } from '../lib/config/index.mjs';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import moment from 'moment-timezone';

// Initialize environment
setupTestEnv({ loadConfigs: true });

const timezone = process.env.TZ || 'America/Los_Angeles';

const migrateStrava = () => {
    const username = configService.getHeadOfHousehold();
    console.log(`Migrating Strava data for user: ${username}`);

    // Load existing FULL data
    const stravaLong = userLoadFile(username, 'archives/strava_long');
    
    if (!stravaLong) {
        console.error('No strava_long data found.');
        return;
    }

    const newStravaSummary = {};

    Object.keys(stravaLong).forEach(date => {
        const activities = Object.values(stravaLong[date]);
        
        const dailySummaries = activities.map(activity => {
            // 1. Save individual activity file
            // Ensure ID exists
            if (!activity.id) return null;
            
            // Save full data to strava/{id}.yml
            userSaveFile(username, `strava/${activity.id}`, activity);

            // 2. Create lightweight summary
            const summary = {
                id: activity.id,
                title: activity.data.name || '',
                type: activity.type,
                startTime: activity.data.start_date ? moment(activity.data.start_date).tz(timezone).format('hh:mm a') : '',
                
                // Metrics
                distance: parseFloat((activity.data.distance || 0).toFixed(2)),
                minutes: parseFloat((activity.data.moving_time / 60 || 0).toFixed(2)),
                calories: activity.data.calories || activity.data.kilojoules || 0,
                
                // Heart Rate
                avgHeartrate: parseFloat((activity.data.average_heartrate || 0).toFixed(2)),
                maxHeartrate: parseFloat((activity.data.max_heartrate || 0).toFixed(2)),
                suffer_score: parseFloat((activity.data.suffer_score || 0).toFixed(2)),
                
                // Device
                device_name: activity.data.device_name || ''
            };

            // Remove zero/empty values
            Object.keys(summary).forEach(key => {
                if (summary[key] === 0 || summary[key] === '' || summary[key] === null) {
                    delete summary[key];
                }
            });

            return summary;
        }).filter(Boolean);

        if (dailySummaries.length > 0) {
            newStravaSummary[date] = dailySummaries;
        }
    });

    // Save the new lightweight summary file
    userSaveFile(username, 'strava', newStravaSummary);
    console.log('Migration complete.');
};

migrateStrava();
