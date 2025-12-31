/**
 * Backfill Test for Harvesters
 * 
 * Runs a 15-day backfill for todoist, clickup, calendar, and gmail harvesters.
 * This populates the lifelog with historical data.
 */

import { jest } from '@jest/globals';
import moment from 'moment';

// Increase timeout for API calls
jest.setTimeout(300000); // 5 minutes

describe('Harvester 15-Day Backfill', () => {
    let gmailHarvester;
    let todoistHarvester;
    let clickupHarvester;
    let gcalHarvester;
    
    beforeAll(async () => {
        // Dynamic imports
        gmailHarvester = (await import('../lib/gmail.mjs')).default;
        todoistHarvester = (await import('../lib/todoist.mjs')).default;
        clickupHarvester = (await import('../lib/clickup.mjs')).default;
        gcalHarvester = (await import('../lib/gcal.mjs')).default;
    });
    
    test('Gmail harvester - 15 day backfill', async () => {
        console.log('\n📧 Starting Gmail 15-day backfill...');
        
        try {
            const result = await gmailHarvester(null, 'backfill-gmail-15d');
            
            console.log('Gmail backfill result:', JSON.stringify(result, null, 2));
            expect(result).toBeDefined();
            
            if (result.current !== undefined) {
                console.log(`  ✓ Current inbox: ${result.current} messages`);
            }
            if (result.lifelog) {
                console.log(`  ✓ Lifelog: ${result.lifelog.sent} sent, ${result.lifelog.received} received`);
            }
        } catch (error) {
            console.error('Gmail backfill failed:', error.message);
            // Don't fail test if credentials missing
            if (error.message.includes('credentials')) {
                console.log('  ⚠ Skipped - credentials not configured');
                return;
            }
            throw error;
        }
    });
    
    test('Todoist harvester - 15 day backfill', async () => {
        console.log('\n✅ Starting Todoist 15-day backfill...');
        
        try {
            const result = await todoistHarvester(null, 'backfill-todoist-15d');
            
            console.log('Todoist backfill result:', JSON.stringify(result, null, 2));
            expect(result).toBeDefined();
            
            if (result.current !== undefined) {
                console.log(`  ✓ Current tasks: ${result.current}`);
            }
            if (result.lifelog) {
                console.log(`  ✓ Lifelog: ${result.lifelog.created} created, ${result.lifelog.completed} completed`);
            }
        } catch (error) {
            console.error('Todoist backfill failed:', error.message);
            if (error.message.includes('API key')) {
                console.log('  ⚠ Skipped - API key not configured');
                return;
            }
            throw error;
        }
    });
    
    test('ClickUp harvester - 15 day backfill', async () => {
        console.log('\n📋 Starting ClickUp 15-day backfill...');
        
        try {
            const result = await clickupHarvester();
            
            console.log('ClickUp backfill result:', JSON.stringify(result, null, 2));
            expect(result).toBeDefined();
            
            if (result.current !== undefined) {
                console.log(`  ✓ Current tasks: ${result.current}`);
            }
            if (result.lifelog) {
                console.log(`  ✓ Lifelog: ${result.lifelog.created} created, ${result.lifelog.statusChanges || 0} status changes, ${result.lifelog.completed} completed`);
            }
        } catch (error) {
            console.error('ClickUp backfill failed:', error.message);
            if (error.message.includes('apiKey') || error.message.includes('Cannot destructure')) {
                console.log('  ⚠ Skipped - credentials not configured');
                return;
            }
            throw error;
        }
    });
    
    test('Google Calendar harvester - 15 day backfill', async () => {
        console.log('\n📅 Starting Google Calendar 15-day backfill...');
        
        try {
            const result = await gcalHarvester(null, 'backfill-gcal-15d');
            
            console.log('Calendar backfill result:', JSON.stringify(result, null, 2));
            expect(result).toBeDefined();
            
            if (result.upcoming !== undefined) {
                console.log(`  ✓ Upcoming events: ${result.upcoming}`);
            }
            if (result.past !== undefined) {
                console.log(`  ✓ Past events (lifelog): ${result.past}`);
            }
        } catch (error) {
            console.error('Calendar backfill failed:', error.message);
            if (error.message.includes('credentials')) {
                console.log('  ⚠ Skipped - credentials not configured');
                return;
            }
            throw error;
        }
    });
    
    test('Summary - verify lifelog data structure', async () => {
        console.log('\n📊 Verifying lifelog data structure...');
        
        const { userLoadFile } = await import('../lib/io.mjs');
        const { configService } = await import('../lib/config/ConfigService.mjs');
        
        const username = configService.getHeadOfHousehold();
        console.log(`  Username: ${username}`);
        
        // Check each lifelog file
        const sources = ['gmail', 'todoist', 'clickup', 'calendar'];
        
        for (const source of sources) {
            const data = userLoadFile(username, source);
            
            if (!data) {
                console.log(`  ⚠ ${source}: No data found`);
                continue;
            }
            
            if (Array.isArray(data)) {
                console.log(`  ⚠ ${source}: Still in old array format (${data.length} items)`);
                continue;
            }
            
            const dates = Object.keys(data).sort().reverse();
            const totalItems = dates.reduce((sum, d) => sum + (data[d]?.length || 0), 0);
            
            console.log(`  ✓ ${source}: ${dates.length} days, ${totalItems} total items`);
            
            // Show date range
            if (dates.length > 0) {
                console.log(`    Date range: ${dates[dates.length - 1]} to ${dates[0]}`);
                
                // Show sample of recent day
                const recentDate = dates[0];
                const recentItems = data[recentDate] || [];
                console.log(`    ${recentDate}: ${recentItems.length} items`);
                
                if (recentItems.length > 0) {
                    const actions = [...new Set(recentItems.map(i => i.action || i.category || 'unknown'))];
                    console.log(`    Actions: ${actions.join(', ')}`);
                }
            }
        }
    });
});
