/**
 * Live Last.fm API Test
 * 
 * This test attempts to connect to the real Last.fm API using credentials 
 * from your environment or config.secrets.yml.
 * 
 * Usage:
 * npm run test:lastfm:live
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import lastfm from '../lib/lastfm.mjs';
import { configService } from '../lib/config/ConfigService.mjs';
import { userLoadFile } from '../lib/io.mjs';

describe('Last.fm Live API', () => {
    beforeAll(() => {
        // Load real configurations
        setupTestEnv();
    });

    test('Environment should have Last.fm credentials', () => {
        const { LAST_FM_API_KEY, LAST_FM_USER } = process.env;
        
        if (!LAST_FM_API_KEY) {
            console.warn('⚠️  Skipping Last.fm live tests: Missing LAST_FM_API_KEY');
            console.warn('   Make sure config.secrets.yml exists or env vars are set.');
        }
        
        if (!LAST_FM_USER) {
            console.warn('⚠️  Skipping Last.fm live tests: Missing LAST_FM_USER');
            console.warn('   Make sure data/users/{username}/auth/lastfm.yml exists with username field.');
        }
        
        expect(LAST_FM_API_KEY).toBeDefined();
        expect(LAST_FM_USER).toBeDefined();
    });

    test('should authenticate and fetch scrobbles', async () => {
        console.log('🔄 Attempting to fetch Last.fm scrobbles...');
        console.log('⚠️  Note: This will write fetched data to your data directory (just like the real app).');
        
        try {
            const result = await lastfm('test-job');

            expect(Array.isArray(result)).toBe(true);
            console.log(`✅ Successfully harvested ${result.length} scrobbles`);
            
            expect(result.length).toBeGreaterThan(0);
            
            // Verify file on disk
            const head = configService.getHeadOfHousehold();
            const savedData = userLoadFile(head, 'lastfm');
            
            console.log(`📂 Verifying data saved to disk for user: ${head}`);
            expect(savedData).toBeDefined();
            expect(Array.isArray(savedData)).toBe(true);
            expect(savedData.length).toBeGreaterThan(0);
            
            // Check content of first scrobble
            const first = result[0];
            console.log('   Latest scrobble:', {
                artist: first.artist,
                title: first.title,
                album: first.album,
                date: first.date
            });
            
            expect(first).toHaveProperty('id');
            expect(first).toHaveProperty('artist');
            expect(first).toHaveProperty('title');
            expect(first).toHaveProperty('date');
            expect(first).toHaveProperty('timestamp');
            
            // Show stats
            const uniqueArtists = [...new Set(result.map(s => s.artist))].length;
            const uniqueAlbums = [...new Set(result.map(s => s.album).filter(Boolean))].length;
            const withImages = result.filter(s => s.image).length;
            
            console.log(`   📊 Stats: ${uniqueArtists} artists, ${uniqueAlbums} albums, ${withImages} with images`);
            
            // Show date range
            if (result.length > 1) {
                console.log(`   📅 Date range: ${result[result.length - 1].date} to ${result[0].date}`);
            }
            
        } catch (e) {
            console.error('\n❌ TEST FAILED: ' + e.message);
            
            if (e.message.includes('invalid')) {
                console.log('\n🔐 RE-AUTHENTICATION REQUIRED');
                console.log('Your Last.fm API key appears to be invalid.');
                console.log('To get a new API key:');
                console.log('1. Visit https://www.last.fm/api/account/create');
                console.log('2. Create an API application');
                console.log('3. Copy your API Key');
                console.log('4. Update config.secrets.yml with: LAST_FM_API_KEY: YOUR_API_KEY');
            }
            
            if (e.message.includes('not found')) {
                console.log('\n👤 USERNAME ISSUE');
                console.log('The Last.fm username appears to be invalid.');
                console.log('To fix:');
                console.log('1. Verify your Last.fm username at https://www.last.fm/user/YOUR_USERNAME');
                console.log('2. Update data/users/{username}/auth/lastfm.yml with: username: YOUR_LASTFM_USERNAME');
                console.log('   Or update config.secrets.yml with: LAST_FM_USER: YOUR_LASTFM_USERNAME');
            }
            
            throw e;
        }
    }, 60000); // 60s timeout for network requests
    
    test('should handle incremental sync mode', async () => {
        console.log('🔄 Testing incremental sync...');
        
        const req = {
            targetUsername: configService.getHeadOfHousehold(),
            query: { full: 'false' }
        };
        
        const result = await lastfm('test-job-incremental', req);
        
        expect(Array.isArray(result)).toBe(true);
        console.log(`✅ Incremental sync returned ${result.length} total scrobbles`);
        
        // Should have merged with existing data
        expect(result.length).toBeGreaterThan(0);
    }, 30000);
});
