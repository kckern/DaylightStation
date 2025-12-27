/**
 * Live FitnessSyncer API Test
 * 
 * This test attempts to connect to the real FitnessSyncer API using credentials 
 * from your environment or config.secrets.yml.
 * 
 * Usage:
 * npm run test:fitsync:live
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import * as fitsync from '../lib/fitsync.mjs';
import configService from '../lib/config/ConfigService.mjs';
import { userLoadFile } from '../lib/io.mjs';

describe('FitnessSyncer Live API', () => {
    beforeAll(() => {
        // Load real configurations
        setupTestEnv();
    });

    test('Environment should have FitnessSyncer credentials', () => {
        const { FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET } = process.env;
        
        if (!FITSYNC_CLIENT_ID || !FITSYNC_CLIENT_SECRET) {
            console.warn('⚠️  Skipping FitnessSyncer live tests: Missing FITSYNC_CLIENT_ID or FITSYNC_CLIENT_SECRET');
            console.warn('   Make sure config.secrets.yml exists or env vars are set.');
        }
        
        expect(FITSYNC_CLIENT_ID).toBeDefined();
        expect(FITSYNC_CLIENT_SECRET).toBeDefined();
    });

    test('should authenticate and fetch activities', async () => {
        if (!process.env.FITSYNC_CLIENT_ID || !process.env.FITSYNC_CLIENT_SECRET) {
            console.warn('Skipping test due to missing credentials');
            return;
        }

        console.log('🔄 Attempting to fetch FitnessSyncer activities...');
        console.log('⚠️  Note: This will write fetched data to your data directory (just like the real app).');
        
        try {
            // Use harvestActivities (default export) to trigger saving to disk
            const result = await fitsync.default();

            if (result.success === false) {
                throw new Error(result.error || 'FitnessSyncer harvest failed');
            }

            // result is the reducedSaveMe object (date -> { steps, activities })
            const dates = Object.keys(result || {});
            console.log(`✅ Successfully harvested activities for ${dates.length} dates`);
            
            expect(result).toBeDefined();
            expect(dates.length).toBeGreaterThan(0);
            
            // Verify file on disk
            const head = configService.getHeadOfHousehold();
            const savedData = userLoadFile(head, 'fitness');
            
            console.log(`📂 Verifying data saved to disk for user: ${head}`);
            expect(savedData).toBeDefined();
            expect(Object.keys(savedData).length).toBeGreaterThan(0);
            
            // Check content of first date
            const firstDate = dates[0];
            const dataOnDate = result[firstDate];
            
            if (dataOnDate) {
                console.log('   Latest data:', {
                    date: firstDate,
                    steps: dataOnDate.steps?.steps_count,
                    activities: dataOnDate.activities?.length || 0
                });
                
                expect(dataOnDate).toHaveProperty('steps');
            }
        } catch (e) {
            console.error('\n❌ TEST FAILED: ' + e.message);
            if (e.message.includes('401') || e.message.includes('403') || e.message.includes('auth')) {
                console.log('\n🔐 AUTHENTICATION FAILED');
                console.log('Please check your FITSYNC_CLIENT_ID and FITSYNC_CLIENT_SECRET in config.secrets.yml');
                console.log('Also ensure you have a valid refresh token in data/users/{user}/auth/fitnesssyncer.yml');
            }
            throw e;
        }
    }, 60000); // 60s timeout
});
