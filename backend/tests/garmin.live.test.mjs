/**
 * Live Garmin Connect API Test
 * 
 * This test attempts to connect to the real Garmin Connect API using credentials 
 * from your environment or config.secrets.yml.
 * 
 * Usage:
 * npm run test:garmin:live
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import * as garmin from '../lib/garmin.mjs';
import configService from '../lib/config/ConfigService.mjs';
import { userLoadFile } from '../lib/io.mjs';

describe('Garmin Live API', () => {
    beforeAll(() => {
        // Load real configurations
        setupTestEnv();
    });

    test('Environment should have Garmin credentials', () => {
        const { GARMIN_USERNAME, GARMIN_PASSWORD } = process.env;
        
        if (!GARMIN_USERNAME || !GARMIN_PASSWORD) {
            console.warn('⚠️  Skipping Garmin live tests: Missing GARMIN_USERNAME or GARMIN_PASSWORD');
            console.warn('   Make sure config.secrets.yml exists or env vars are set.');
        }
        
        expect(GARMIN_USERNAME).toBeDefined();
        expect(GARMIN_PASSWORD).toBeDefined();
    });

    test('should authenticate and fetch activities', async () => {
        if (!process.env.GARMIN_USERNAME || !process.env.GARMIN_PASSWORD) {
            console.warn('Skipping test due to missing credentials');
            return;
        }

        console.log('🔄 Attempting to fetch Garmin activities...');
        console.log('⚠️  Note: This will write fetched data to your data directory (just like the real app).');
        
        try {
            // Use harvestActivities (default export) to trigger saving to disk
            const result = await garmin.default();

            // result is the saveMe object (date -> activities)
            const dates = Object.keys(result || {});
            console.log(`✅ Successfully harvested activities for ${dates.length} dates`);
            
            expect(result).toBeDefined();
            expect(dates.length).toBeGreaterThan(0);
            
            // Verify file on disk
            const head = configService.getHeadOfHousehold();
            const savedData = userLoadFile(head, 'garmin');
            
            console.log(`📂 Verifying data saved to disk for user: ${head}`);
            expect(savedData).toBeDefined();
            expect(Object.keys(savedData).length).toBeGreaterThan(0);
            
            // Check content of first activity
            const firstDate = dates[0];
            const activitiesOnDate = result[firstDate];
            
            if (activitiesOnDate && activitiesOnDate.length > 0) {
                const first = activitiesOnDate[0];
                console.log('   Latest activity:', {
                    name: first.activityName,
                    date: first.date,
                    distance: first.distance,
                    type: first.activityType
                });
                
                expect(first).toHaveProperty('activityId');
                expect(first).toHaveProperty('activityName');
                expect(first).toHaveProperty('distance');
            }
        } catch (e) {
            console.error('\n❌ TEST FAILED: ' + e.message);
            if (e.message.includes('401') || e.message.includes('403') || e.message.includes('auth')) {
                console.log('\n🔐 AUTHENTICATION FAILED');
                console.log('Please check your GARMIN_USERNAME and GARMIN_PASSWORD in config.secrets.yml');
                console.log('Note: Garmin sometimes requires MFA or captcha which this library might not handle gracefully.');
            }
            throw e;
        }
    }, 120000); // 120s timeout for network requests (Garmin login can be slow)
});
