
import harvestStrava from '../lib/strava.mjs';
import { createLogger } from '../lib/logging/logger.js';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import { userSaveFile, userLoadFile } from '../lib/io.mjs';
import { configService } from '../lib/config/v2/index.mjs';

// Initialize environment
setupTestEnv({ loadConfigs: true });

const logger = createLogger({ source: 'script', app: 'reharvest-strava' });

const runReharvest = async () => {
    console.log('Starting Strava re-harvest from scratch...');
    
    const username = configService.getHeadOfHousehold();
    
    // Explicitly clear the strava summary file to ensure a clean slate
    console.log(`Clearing existing strava.yml for ${username}...`);
    userSaveFile(username, 'strava', {});

    // Backfill from 2011 (approx 15 years)
    const daysBack = 15 * 365; 
    
    let success = false;
    while (!success) {
        try {
            console.log(`Harvesting Strava for the last ${daysBack} days...`);
            // This will now save individual files and a lightweight summary
            await harvestStrava(logger, 'reharvest-strava', daysBack);
            console.log('Strava re-harvest complete.');
            success = true;
            
        } catch (error) {
            if (error.response && error.response.status === 429) {
                logger.warn('strava.reharvest.rate_limit_exceeded', { wait_minutes: 16 });
                await new Promise(resolve => setTimeout(resolve, 16 * 60 * 1000));
                console.log('Resuming harvest...');
            } else {
                console.error('Re-harvest failed:', error);
                process.exit(1);
            }
        }
    }
};

runReharvest();
