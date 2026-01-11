/**
 * Shared media memory path utilities
 * @module lib/mediaMemory
 * 
 * Provides consistent path resolution for household-scoped media memory storage.
 * Used by both the Plex library and media router.
 */

import path from 'path';
import fs from 'fs';
import { configService } from './config/index.mjs';
import { userDataService } from './config/UserDataService.mjs';
import { slugify } from './utils.mjs';

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

/**
 * Parse library ID and name from filename like "14_fitness.yml"
 * @param {string} filename - Filename to parse
 * @returns {{libraryId: number, libraryName: string}|null} Parsed components or null if legacy format
 */
export const parseLibraryFilename = (filename) => {
    const match = filename.match(/^(\d+)_(.+)\.ya?ml$/);
    if (!match) return null;
    return {
        libraryId: parseInt(match[1], 10),
        libraryName: match[2]
    };
};

/**
 * Build filename from library ID and name
 * @param {number} libraryId - Library section ID
 * @param {string} libraryName - Library name (will be slugified)
 * @returns {string} Filename like "14_fitness.yml"
 */
export const buildLibraryFilename = (libraryId, libraryName) => {
    const slug = slugify(libraryName);
    return `${libraryId}_${slug}.yml`;
};

/**
 * Get all media memory files in plex directory
 * @param {string|null} householdId - Optional household ID
 * @returns {Array<{path: string, filename: string, libraryId: number|null, libraryName: string}>} File info array
 */
export const getMediaMemoryFiles = (householdId = null) => {
    const plexDir = path.join(getMediaMemoryDir(householdId), 'plex');
    if (!fs.existsSync(plexDir)) return [];

    return fs.readdirSync(plexDir)
        .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
        .filter(f => !f.startsWith('_')) // Exclude _archive, _logs
        .map(f => {
            const parsed = parseLibraryFilename(f);
            return {
                path: path.join(plexDir, f),
                filename: f,
                libraryId: parsed?.libraryId || null,
                libraryName: parsed?.libraryName || f.replace(/\.ya?ml$/, '')
            };
        });
};
