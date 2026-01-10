/**
 * Archive Rotation Job
 * 
 * Daily cron job that rotates old entries from hot storage to yearly/monthly archives.
 * Called by cron.mjs in the cronDaily array.
 * 
 * For each archive-enabled service:
 * 1. Load hot storage
 * 2. Move entries older than retentionDays to archives
 * 3. Save trimmed hot storage
 * 
 * Safe to run multiple times - idempotent operation.
 * 
 * Supported services:
 * - Lifelog (ArchiveService): lastfm, goodreads, garmin, fitness
 * - NutriBot: nutrilog, nutrilist (custom repository methods)
 */

import { configService } from './config/index.mjs';
import ArchiveService from './ArchiveService.mjs';
import { createLogger } from './logging/logger.js';

// NutriBot imports - lazy loaded to avoid circular deps
let NutriBotConfig = null;
let NutriLogRepository = null;
let NutriListRepository = null;

const rotationLogger = createLogger({
    source: 'backend',
    app: 'archive-rotation'
});

/**
 * Load NutriBot dependencies lazily
 */
const loadNutriBotDeps = async () => {
    if (!NutriBotConfig) {
        const configModule = await import('../chatbots/bots/nutribot/config/NutriBotConfig.mjs');
        NutriBotConfig = configModule.NutriBotConfig;
        
        const logRepoModule = await import('../chatbots/bots/nutribot/repositories/NutriLogRepository.mjs');
        NutriLogRepository = logRepoModule.NutriLogRepository;
        
        const listRepoModule = await import('../chatbots/bots/nutribot/repositories/NutriListRepository.mjs');
        NutriListRepository = listRepoModule.NutriListRepository;
    }
};

/**
 * Rotate NutriBot archives for a user
 * @param {string} username
 * @returns {Object}
 */
const rotateNutriBotArchives = async (username) => {
    await loadNutriBotDeps();
    
    try {
        // Load NutriBot config
        const { loadConfig } = await import('../chatbots/_lib/config/ConfigLoader.mjs');
        const rawConfig = loadConfig('nutribot');
        const config = new NutriBotConfig(rawConfig);
        
        const logRepo = new NutriLogRepository({ config });
        const listRepo = new NutriListRepository({ config });
        
        // Archive old logs
        const logResult = await logRepo.archiveOldLogs(username);
        
        // Archive old list items
        const listResult = await listRepo.archiveOldItems(username);
        
        return {
            nutrilog: logResult,
            nutrilist: listResult
        };
    } catch (error) {
        rotationLogger.error('archive.rotation.nutribot.error', { username, error: error.message });
        return {
            nutrilog: { error: error.message },
            nutrilist: { error: error.message }
        };
    }
};

/**
 * Rotate all archive-enabled services for all users
 * @param {string} guidId - Request ID for logging
 * @returns {Object} Rotation results
 */
const rotateArchives = async (guidId = null) => {
    rotationLogger.info('archive.rotation.start', { guidId });
    
    // Get archive config
    const archiveConfig = configService.getAppConfig('archive');
    if (!archiveConfig?.services) {
        rotationLogger.warn('archive.rotation.noConfig');
        return { success: true, services: [], message: 'No archive configuration found' };
    }
    
    // Get enabled services
    const enabledServices = Object.entries(archiveConfig.services)
        .filter(([_, config]) => config?.enabled)
        .map(([service]) => service);
    
    if (enabledServices.length === 0) {
        rotationLogger.info('archive.rotation.noEnabledServices');
        return { success: true, services: [], message: 'No enabled services' };
    }
    
    // Get all users (for now, just head of household)
    // In the future, could iterate all users in data/users/
    const username = configService.getHeadOfHousehold();
    
    const results = [];
    let totalRotated = 0;
    
    for (const service of enabledServices) {
        try {
            const result = ArchiveService.rotateToArchive(username, service);
            
            results.push({
                service,
                username,
                ...result
            });
            
            totalRotated += result.rotated;
            
            if (result.rotated > 0) {
                rotationLogger.info('archive.rotation.service', {
                    service,
                    username,
                    rotated: result.rotated,
                    kept: result.kept,
                    yearsUpdated: result.yearsUpdated
                });
            }
        } catch (error) {
            rotationLogger.error('archive.rotation.error', {
                service,
                username,
                error: error.message
            });
            
            results.push({
                service,
                username,
                error: error.message
            });
        }
    }
    
    // Rotate NutriBot archives (handled separately via repository methods)
    try {
        const nutriResult = await rotateNutriBotArchives(username);
        
        if (nutriResult.nutrilog && !nutriResult.nutrilog.error) {
            results.push({
                service: 'nutrilog',
                username,
                rotated: nutriResult.nutrilog.archived,
                kept: nutriResult.nutrilog.kept,
                yearsUpdated: nutriResult.nutrilog.months
            });
            totalRotated += nutriResult.nutrilog.archived || 0;
        }
        
        if (nutriResult.nutrilist && !nutriResult.nutrilist.error) {
            results.push({
                service: 'nutrilist',
                username,
                rotated: nutriResult.nutrilist.archived,
                kept: nutriResult.nutrilist.kept,
                yearsUpdated: nutriResult.nutrilist.months
            });
            totalRotated += nutriResult.nutrilist.archived || 0;
        }
        
        if (nutriResult.nutrilog?.archived > 0 || nutriResult.nutrilist?.archived > 0) {
            rotationLogger.info('archive.rotation.nutribot', {
                username,
                nutrilog: nutriResult.nutrilog,
                nutrilist: nutriResult.nutrilist
            });
        }
    } catch (error) {
        rotationLogger.error('archive.rotation.nutribot.error', { username, error: error.message });
    }
    
    rotationLogger.info('archive.rotation.complete', {
        guidId,
        servicesProcessed: enabledServices.length,
        totalRotated,
        results: results.map(r => ({
            service: r.service,
            rotated: r.rotated || 0,
            error: r.error
        }))
    });
    
    return {
        success: true,
        username,
        servicesProcessed: enabledServices.length,
        totalRotated,
        results
    };
};

export default rotateArchives;
