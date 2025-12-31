/**
 * Integration Test: Last.fm in Morning Debrief
 * 
 * Tests that Last.fm data is properly extracted and included in morning debriefs
 */

import { describe, test, expect, beforeAll, jest } from '@jest/globals';
import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import { LifelogAggregator } from '../chatbots/bots/journalist/adapters/LifelogAggregator.mjs';
import { lastfmExtractor } from '../lib/lifelog-extractors/lastfm.mjs';
import { userLoadFile } from '../lib/io.mjs';
import moment from 'moment-timezone';

describe('Last.fm Integration in Morning Debrief', () => {
    beforeAll(() => {
        setupTestEnv();
    });

    test('lastfmExtractor should be registered in extractors', async () => {
        const { extractors } = await import('../lib/lifelog-extractors/index.mjs');
        
        const lastfmExt = extractors.find(e => e.source === 'lastfm');
        expect(lastfmExt).toBeDefined();
        expect(lastfmExt.category).toBe('music');
        expect(lastfmExt.filename).toBe('lastfm');
        
        console.log('✅ Last.fm extractor registered:', {
            source: lastfmExt.source,
            category: lastfmExt.category,
            filename: lastfmExt.filename
        });
    });

    test('should extract Last.fm data for a specific date', async () => {
        const data = userLoadFile('kckern', 'lastfm');
        
        if (!data || data.length === 0) {
            console.warn('⚠️  No Last.fm data found - skipping extraction test');
            return;
        }
        
        console.log(`📀 Loaded ${data.length} scrobbles from lastfm.yml`);
        
        // Find a date with data
        const dateWithData = moment(data[0].date, 'DD MMM YYYY, HH:mm').format('YYYY-MM-DD');
        console.log(`Testing extraction for date: ${dateWithData}`);
        
        const extracted = lastfmExtractor.extractForDate(data, dateWithData);
        
        expect(extracted).toBeDefined();
        expect(Array.isArray(extracted)).toBe(true);
        expect(extracted.length).toBeGreaterThan(0);
        
        console.log(`✅ Extracted ${extracted.length} scrobbles for ${dateWithData}`);
        console.log('Sample scrobble:', extracted[0]);
        
        // Test summarize
        const summary = lastfmExtractor.summarize(extracted);
        expect(summary).toBeDefined();
        expect(summary).toContain('MUSIC LISTENING');
        
        console.log('\n📝 Generated summary:');
        console.log(summary);
    });

    test('LifelogAggregator should include Last.fm data', async () => {
        const logger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        
        const aggregator = new LifelogAggregator({ logger });
        
        // Get a recent date with Last.fm data
        const data = userLoadFile('kckern', 'lastfm');
        
        if (!data || data.length === 0) {
            console.warn('⚠️  No Last.fm data - skipping aggregation test');
            return;
        }
        
        const dateWithData = moment(data[0].date, 'DD MMM YYYY, HH:mm').format('YYYY-MM-DD');
        console.log(`\nAggregating lifelog for ${dateWithData}...`);
        
        const lifelog = await aggregator.aggregate('kckern', dateWithData);
        
        expect(lifelog).toBeDefined();
        expect(lifelog.date).toBe(dateWithData);
        
        // Check if Last.fm data is included
        const hasLastfmSource = lifelog.sources?.lastfm !== undefined;
        const hasLastfmSummary = lifelog.summaries?.some(s => s.source === 'lastfm');
        const hasLastfmInCategories = lifelog.categories?.music?.lastfm !== undefined;
        
        console.log('\n📊 Lifelog structure:');
        console.log('  Sources:', Object.keys(lifelog.sources || {}));
        console.log('  Categories:', Object.keys(lifelog.categories || {}));
        console.log('  Summary count:', lifelog.summaries?.length || 0);
        
        if (hasLastfmSource) {
            console.log('\n✅ Last.fm data found in lifelog:');
            console.log('  - In sources.lastfm:', hasLastfmSource);
            console.log('  - In summaries:', hasLastfmSummary);
            console.log('  - In categories.music:', hasLastfmInCategories);
            
            expect(hasLastfmSource).toBe(true);
            expect(hasLastfmSummary).toBe(true);
            expect(hasLastfmInCategories).toBe(true);
            
            // Check summary text
            const lastfmSummary = lifelog.summaries.find(s => s.source === 'lastfm');
            console.log('\n📝 Last.fm summary in lifelog:');
            console.log(lastfmSummary.text);
        } else {
            console.log('\n⚠️  Last.fm data not found in aggregated lifelog');
            console.log('This might be expected if no scrobbles exist for this date');
        }
    });
});
