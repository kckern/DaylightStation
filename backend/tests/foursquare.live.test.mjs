/**
 * Live Foursquare/Swarm API Test
 * 
 * This test attempts to connect to the real Foursquare API using credentials 
 * from your environment or config.secrets.yml.
 * 
 * Usage:
 * npm run test:foursquare:live
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import foursquare from '../lib/foursquare.mjs';
import configService from '../lib/config/ConfigService.mjs';
import { userLoadFile } from '../lib/io.mjs';

describe('Foursquare Live API', () => {
    beforeAll(() => {
        // Load real configurations
        setupTestEnv();
    });

    test('Environment should have Foursquare credentials', () => {
        const { FOURSQUARE_TOKEN } = process.env;
        
        if (!FOURSQUARE_TOKEN) {
            console.warn('⚠️  Skipping Foursquare live tests: Missing FOURSQUARE_TOKEN');
            console.warn('   Make sure config.secrets.yml exists or env vars are set.');
        }
        
        expect(FOURSQUARE_TOKEN).toBeDefined();
    });

    test('should authenticate and fetch check-ins', async () => {
        console.log('🔄 Attempting to fetch Foursquare check-ins...');
        console.log('⚠️  Note: This will write fetched data to your data directory (just like the real app).');
        
        try {
            const result = await foursquare('test-job');

            expect(Array.isArray(result)).toBe(true);
            console.log(`✅ Successfully harvested ${result.length} check-ins`);
            
            expect(result.length).toBeGreaterThan(0);
            
            // Verify file on disk
            const head = configService.getHeadOfHousehold();
            const savedData = userLoadFile(head, 'checkins');
            
            console.log(`📂 Verifying data saved to disk for user: ${head}`);
            expect(savedData).toBeDefined();
            expect(Array.isArray(savedData)).toBe(true);
            expect(savedData.length).toBeGreaterThan(0);
            
            // Check content of first check-in
            const first = result[0];
            console.log('   Latest check-in:', {
                venue: first.venue?.name,
                date: first.date,
                category: first.venue?.category,
                location: first.location?.city
            });
            
            expect(first).toHaveProperty('id');
            expect(first).toHaveProperty('venue');
            expect(first).toHaveProperty('date');
            expect(first).toHaveProperty('timestamp');
            expect(first.venue).toHaveProperty('name');
            
            // Show stats
            const uniqueVenues = [...new Set(result.map(c => c.venue?.id))].length;
            const uniqueCities = [...new Set(result.map(c => c.location?.city).filter(Boolean))].length;
            const withPhotos = result.filter(c => c.photos?.length > 0).length;
            
            console.log(`   📊 Stats: ${uniqueVenues} venues, ${uniqueCities} cities, ${withPhotos} with photos`);
            
        } catch (e) {
            console.error('\n❌ TEST FAILED: ' + e.message);
            
            if (e.message.includes('invalid') || e.message.includes('expired')) {
                console.log('\n🔐 RE-AUTHENTICATION REQUIRED');
                console.log('Your Foursquare OAuth token appears to be invalid or expired.');
                console.log('To get a new token:');
                console.log('1. Visit https://foursquare.com/developers/apps');
                console.log('2. Create or select your app');
                console.log('3. Generate a new OAuth token');
                console.log('4. Update data/users/{username}/auth/foursquare.yml with: token: YOUR_NEW_TOKEN');
            }
            
            throw e;
        }
    }, 60000); // 60s timeout for network requests
});
