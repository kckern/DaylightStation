
import { describe, test, expect, beforeAll } from '@jest/globals';
import dailyHealth from '../lib/health.mjs';
import { createLogger } from '../lib/logging/logger.js';

// Mock logger to avoid cluttering output
const logger = createLogger({ source: 'test', app: 'health' });

describe('Health Lib Live Test', () => {
    beforeAll(() => {
        // Mock necessary environment variables
        process.env.nutribot_chat_id = 'test_chat_id';
    });

    test('dailyHealth generates metrics', async () => {
        console.log('Running dailyHealth...');
        const metrics = await dailyHealth();
        
        expect(metrics).toBeDefined();
        
        // Log the output for review
        console.log('Daily Health Metrics (Last 3 days):');
        const dates = Object.keys(metrics).sort().reverse().slice(0, 3);
        dates.forEach(date => {
            console.log(`\nDate: ${date}`);
            console.log(JSON.stringify(metrics[date], null, 2));
        });
    });
});
