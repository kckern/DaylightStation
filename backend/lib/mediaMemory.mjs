/**
 * Shared media memory path utilities
 * @module lib/mediaMemory
 * 
 * Provides consistent path resolution for household-scoped media memory storage.
 * Used by both the Plex library and media router.
 */

import path from 'path';
import fs from 'fs';
import { configService } from './config/ConfigService.mjs';
import { userDataService } from './config/UserDataService.mjs';

/**
 * Get the relative path for media memory storage
 * @param {string} category - The category/subfolder (e.g., 'plex', 'plex/movies')
 * @param {string|null} householdId - Optional household ID, defaults to default household
 * @returns {string} Relative path for use with loadFile/saveFile
 */
export const getMediaMemoryPath = (category, householdId = null) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    const householdDir = userDataService.getHouseholdDir(hid);
    if (householdDir && fs.existsSync(path.join(householdDir, 'history', 'media_memory'))) {
        return `households/${hid}/history/media_memory/${category}`;
    }
    return `history/media_memory/${category}`;
};

/**
 * Get the absolute directory path for media memory storage
 * @param {string|null} householdId - Optional household ID, defaults to default household
 * @returns {string} Absolute path to media memory directory
 */
export const getMediaMemoryDir = (householdId = null) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    const householdDir = userDataService.getHouseholdDir(hid);
    if (householdDir) {
        const householdMemPath = path.join(householdDir, 'history', 'media_memory');
        if (fs.existsSync(householdMemPath)) {
            return householdMemPath;
        }
    }
    // Fall back to legacy path
    const legacyPath = path.join(process.env.path.data, 'history', 'media_memory');
    return legacyPath;
};
