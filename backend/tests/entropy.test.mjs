/**
 * Entropy Module Test
 * 
 * Verifies entropy report loads from correct data sources
 */

import { jest } from '@jest/globals';
import path from 'path';

jest.setTimeout(30000);

describe('Entropy Report', () => {
    let getEntropyReport;
    let configService;
    
    beforeAll(async () => {
        // Ensure ConfigService is fully initialized with app configs
        const { configService: cs } = await import('../lib/config/ConfigService.mjs');
        configService = cs;
        
        // Initialize with config directory (mount path)
        const configDir = '/Volumes/mounts/DockerDrive/Docker/DaylightStation/config';
        configService.init(path.dirname(configDir));
        
        const entropyModule = await import('../lib/entropy.mjs');
        getEntropyReport = entropyModule.getEntropyReport;
    });
    
    test('generates entropy report from lifelog and current sources', async () => {
        const report = await getEntropyReport();
        
        console.log('\n📊 Entropy Report:');
        report.items.forEach(item => {
            const sourceType = ['gmail', 'todoist', 'clickup'].includes(item.id) ? 'current' : 'lifelog';
            console.log(`  ${item.icon} ${item.name}: ${item.label} [${item.status}] (${sourceType})`);
        });
        console.log('\nSummary:', report.summary);
        
        expect(report).toBeDefined();
        expect(report.items).toBeDefined();
        expect(report.summary).toBeDefined();
        
        // Should have items from config
        expect(report.items.length).toBeGreaterThan(0);
        
        // Verify structure
        report.items.forEach(item => {
            expect(item).toHaveProperty('id');
            expect(item).toHaveProperty('name');
            expect(item).toHaveProperty('status');
            expect(item).toHaveProperty('value');
            expect(item).toHaveProperty('label');
            expect(['green', 'yellow', 'red']).toContain(item.status);
        });
    });
    
    test('days_since metric uses lifelog data', async () => {
        const { userLoadFile } = await import('../lib/io.mjs');
        
        const username = configService.getHeadOfHousehold();
        const weightData = userLoadFile(username, 'weight');
        
        const report = await getEntropyReport();
        const weightItem = report.items.find(i => i.id === 'weight');
        
        if (weightData && Object.keys(weightData).length > 0) {
            console.log('\n⚖️ Weight data found in lifelog');
            expect(weightItem).toBeDefined();
            expect(weightItem.label).not.toBe('No data');
        } else {
            console.log('\n⚖️ No weight data in lifelog');
        }
    });
    
    test('count metric uses current data', async () => {
        const { userLoadCurrent } = await import('../lib/io.mjs');
        
        const username = configService.getHeadOfHousehold();
        
        // Check gmail current data
        const gmailCurrent = userLoadCurrent(username, 'gmail');
        console.log('\n📧 Gmail current data:', gmailCurrent ? `${gmailCurrent.unreadCount} unread` : 'not found');
        
        // Check todoist current data
        const todoistCurrent = userLoadCurrent(username, 'todoist');
        console.log('✅ Todoist current data:', todoistCurrent ? `${todoistCurrent.taskCount} tasks` : 'not found');
        
        // Check clickup current data
        const clickupCurrent = userLoadCurrent(username, 'clickup');
        console.log('🎫 ClickUp current data:', clickupCurrent ? `${clickupCurrent.taskCount} tasks` : 'not found');
        
        const report = await getEntropyReport();
        
        const gmailItem = report.items.find(i => i.id === 'gmail');
        const todoistItem = report.items.find(i => i.id === 'todoist');
        const clickupItem = report.items.find(i => i.id === 'clickup');
        
        // If current data exists, entropy should reflect it
        if (gmailCurrent && gmailItem) {
            expect(gmailItem.value).toBe(gmailCurrent.unreadCount);
        }
        if (todoistCurrent && todoistItem) {
            expect(todoistItem.value).toBe(todoistCurrent.taskCount);
        }
        if (clickupCurrent && clickupItem) {
            expect(clickupItem.value).toBe(clickupCurrent.taskCount);
        }
    });
});
