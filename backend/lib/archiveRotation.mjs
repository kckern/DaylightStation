/**
 * Archive Rotation Job
 * 
 * Daily cron job that rotates old entries from hot storage to yearly archives.
 * Called by cron.mjs in the cronDaily array.
 * 
 * For each archive-enabled service:
 * 1. Load hot storage
 * 2. Move entries older than retentionDays to yearly archives
 * 3. Save trimmed hot storage
 * 
 * Safe to run multiple times - idempotent operation.
 */

import { configService } from './config/ConfigService.mjs';
import ArchiveService from './ArchiveService.mjs';
import { createLogger } from './logging/logger.js';

const rotationLogger = createLogger({
    source: 'backend',
    app: 'archive-rotation'
});

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
