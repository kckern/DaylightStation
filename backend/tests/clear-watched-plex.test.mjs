/**
 * Test for clearWatchedItems with plex library files
 * Verifies the fix for playlist reset bug
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock dependencies before importing the module under test
const mockLoadFile = jest.fn();
const mockSaveFile = jest.fn();
const mockConfigService = { getDefaultHouseholdId: jest.fn(() => 'default') };
const mockUserDataService = { getHouseholdDir: jest.fn(() => null) };

jest.unstable_mockModule('../lib/io.mjs', () => ({
    loadFile: mockLoadFile,
    saveFile: mockSaveFile,
    loadRandom: jest.fn()
}));

jest.unstable_mockModule('../lib/config/ConfigService.mjs', () => ({
    configService: mockConfigService
}));

jest.unstable_mockModule('../lib/config/UserDataService.mjs', () => ({
    userDataService: mockUserDataService
}));

// Mock process.env.path.data
process.env.path = { data: '/test/data' };

describe('clearWatchedItems - Plex Library Fix', () => {
    let clearWatchedItems;
    let mockReaddirSync;
    let mockExistsSync;
    
    beforeAll(async () => {
        // Import after mocks are set up
        const fetchModule = await import('../routers/fetch.mjs');
        clearWatchedItems = fetchModule.clearWatchedItems;
    });
    
    beforeEach(() => {
        jest.clearAllMocks();
        mockLoadFile.mockReturnValue({});
        mockSaveFile.mockReturnValue(true);
        
        // Mock fs functions
        mockReaddirSync = jest.spyOn(fs, 'readdirSync');
        mockExistsSync = jest.spyOn(fs, 'existsSync');
    });
    
    afterEach(() => {
        mockReaddirSync.mockRestore();
        mockExistsSync.mockRestore();
    });
    
    test('should clear from multiple plex library files', () => {
        const keysToRemove = ['598488', '598489', '598490'];
        
        // Setup: plex directory exists with fitness.yml and movies.yml
        mockExistsSync.mockReturnValue(true);
        mockReaddirSync.mockReturnValue(['fitness.yml', 'movies.yml', 'music.yml']);
        
        // fitness.yml has episodes 598488 and 598489
        // movies.yml has episode 598490
        // music.yml has none of them
        mockLoadFile
            .mockReturnValueOnce({ 
                '598488': { percent: 95, seconds: 600 },
                '598489': { percent: 92, seconds: 550 },
                '999999': { percent: 80, seconds: 400 } // unrelated item
            })
            .mockReturnValueOnce({ 
                '598490': { percent: 98, seconds: 700 },
                '888888': { percent: 75, seconds: 350 } // unrelated item
            })
            .mockReturnValueOnce({ 
                '777777': { percent: 60, seconds: 200 } // no target items
            });
        
        const result = clearWatchedItems(keysToRemove, 'plex');
        
        // Should have scanned the plex directory
        expect(mockReaddirSync).toHaveBeenCalledWith(expect.stringContaining('plex'));
        
        // Should have loaded 3 library files
        expect(mockLoadFile).toHaveBeenCalledTimes(3);
        
        // Should have saved 2 files (fitness and movies, not music since it had no matches)
        expect(mockSaveFile).toHaveBeenCalledTimes(2);
        
        // Verify fitness.yml was saved without 598488 and 598489 but kept 999999
        const fitnessCall = mockSaveFile.mock.calls.find(call => 
            call[0].includes('plex/fitness')
        );
        expect(fitnessCall).toBeTruthy();
        expect(fitnessCall[1]).toEqual({ '999999': { percent: 80, seconds: 400 } });
        
        // Verify movies.yml was saved without 598490 but kept 888888
        const moviesCall = mockSaveFile.mock.calls.find(call => 
            call[0].includes('plex/movies')
        );
        expect(moviesCall).toBeTruthy();
        expect(moviesCall[1]).toEqual({ '888888': { percent: 75, seconds: 350 } });
        
        // Result should indicate items were cleared
        expect(result.cleared).toBe(3);
    });
    
    test('should handle non-plex categories normally', () => {
        const keysToRemove = ['media123', 'media456'];
        
        mockLoadFile.mockReturnValue({
            'media123': { percent: 90, seconds: 500 },
            'media456': { percent: 85, seconds: 450 },
            'media789': { percent: 70, seconds: 300 }
        });
        
        clearWatchedItems(keysToRemove, 'media');
        
        // Should NOT scan directory for non-plex categories
        expect(mockReaddirSync).not.toHaveBeenCalled();
        
        // Should load and save single file
        expect(mockLoadFile).toHaveBeenCalledTimes(1);
        expect(mockSaveFile).toHaveBeenCalledTimes(1);
        
        // Should have removed target items but kept media789
        expect(mockSaveFile).toHaveBeenCalledWith(
            expect.any(String),
            { 'media789': { percent: 70, seconds: 300 } }
        );
    });
    
    test('should handle missing plex directory gracefully', () => {
        const keysToRemove = ['598488'];
        
        mockExistsSync.mockReturnValue(false);
        
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        
        const result = clearWatchedItems(keysToRemove, 'plex');
        
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Plex history directory not found'),
            expect.any(String)
        );
        expect(result).toEqual({});
        
        consoleSpy.mockRestore();
    });
});
