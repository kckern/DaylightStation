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
 * Sanitize string data to prevent YAML parsing issues
 * - Normalizes unicode to NFC form (combining diacritics -> precomposed)
 * - Removes control characters and problematic unicode
 * - Handles null/undefined gracefully
 * @param {string|null|undefined} str - String to sanitize
 * @returns {string} Sanitized string safe for YAML
 */
export const sanitizeForYAML = (str) => {
    if (str == null || typeof str !== 'string') return '';
    
    // Normalize unicode to NFC (precomposed form) to avoid combining diacritics issues
    let sanitized = str.normalize('NFC');
    
    // Remove control characters except newline/tab
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
    
    // Remove zero-width characters and other problematic unicode
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
    
    // Trim whitespace
    sanitized = sanitized.trim();
    
    return sanitized;
};

/**
 * Recursively sanitize all string values in an object for YAML safety
 * @param {Object} obj - Object to sanitize
 * @returns {Object} New object with sanitized strings
 */
export const sanitizeObjectForYAML = (obj) => {
    if (obj == null || typeof obj !== 'object') {
        return typeof obj === 'string' ? sanitizeForYAML(obj) : obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(sanitizeObjectForYAML);
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = sanitizeForYAML(key);
        sanitized[sanitizedKey] = typeof value === 'string' 
            ? sanitizeForYAML(value)
            : sanitizeObjectForYAML(value);
    }
    
    return sanitized;
};

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
