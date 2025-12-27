/**
 * Live Strava API Test
 * 
 * This test attempts to connect to the real Strava API using credentials 
 * from your environment or config.secrets.yml.
 * 
 * Usage:
 * npm run test:strava:live
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import * as strava from '../lib/strava.mjs';
import configService from '../lib/config/ConfigService.mjs';
import { userLoadFile } from '../lib/io.mjs';

describe('Strava Live API', () => {
    beforeAll(() => {
        // Load real configurations
        setupTestEnv();
    });

    test('Environment should have Strava credentials', () => {
        const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
        
        if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
            console.warn('⚠️  Skipping Strava live tests: Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET');
            console.warn('   Make sure config.secrets.yml exists or env vars are set.');
        }
        
        expect(STRAVA_CLIENT_ID).toBeDefined();
        expect(STRAVA_CLIENT_SECRET).toBeDefined();
    });

    test('should authenticate and fetch activities', async () => {
        console.log('🔄 Attempting to fetch Strava activities...');
        console.log('⚠️  Note: This will write fetched data to your data directory (just like the real app).');
        
        // Create a logger that prints to console
        const logger = {
            info: (msg, data) => console.log(`ℹ️  ${msg}`, data ? JSON.stringify(data).substring(0, 100) + '...' : ''),
            error: (msg, data) => console.error(`❌ ${msg}`, data),
            warn: (msg, data) => console.warn(`⚠️  ${msg}`, data),
            debug: () => {},
            child: function() { return this; }
        };

        try {
            // Use harvestActivities (default export) to trigger saving to disk
            const result = await strava.default(logger, 'test-job');

            if (result.success === false) {
                throw new Error(result.error || 'Strava harvest failed');
            }
            
            // result is the reducedSaveMe object (date -> activities)
            const dates = Object.keys(result);
            console.log(`✅ Successfully harvested activities for ${dates.length} dates`);
            
            expect(dates.length).toBeGreaterThan(0);
            
            // Verify file on disk
            const head = configService.getHeadOfHousehold();
            const savedData = userLoadFile(head, 'strava');
            
            console.log(`📂 Verifying data saved to disk for user: ${head}`);
            expect(savedData).toBeDefined();
            expect(Object.keys(savedData).length).toBeGreaterThan(0);
            
            // Check content of first activity
            const firstDate = dates[0];
            const activitiesOnDate = result[firstDate];
            
            if (activitiesOnDate && activitiesOnDate.length > 0) {
                const first = activitiesOnDate[0];
                console.log('   Latest activity:', {
                    title: first.title,
                    date: firstDate,
                    distance: first.distance
                });
                
                expect(first).toHaveProperty('title');
                expect(first).toHaveProperty('distance');
                expect(first).toHaveProperty('minutes');
            }
        } catch (e) {
            console.error('\n❌ TEST FAILED: ' + e.message);
            
            // Generate re-auth URL
            const authInfo = await strava.reauthSequence();
            console.log('\n🔐 RE-AUTHENTICATION REQUIRED');
            console.log('It seems your Refresh Token is invalid or expired.');
            console.log('Please visit this URL to authorize the app and get a new code:');
            console.log('\n' + authInfo.url + '\n');
            console.log('After authorizing, you will be redirected to a URL like:');
            console.log('  http://localhost:3000/api/auth/strava/callback?code=YOUR_NEW_CODE&...');
            console.log('\nCopy the "code" parameter and run the following script to update your token:');
            console.log('  node scripts/update-strava-token.mjs YOUR_NEW_CODE');
            
            throw e;
        }
    }, 60000); // 60s timeout for network requests
});
