import fs from 'fs';
import yaml from 'js-yaml';
import {decode} from 'html-entities';
import smartquotes from 'smartquotes';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';

const ioLogger = createLogger({
    source: 'backend',
    app: 'io'
});

class FlowSequence extends Array {}

const FlowSequenceType = new yaml.Type('tag:yaml.org,2002:seq', {
    kind: 'sequence',
    instanceOf: FlowSequence,
    represent: (sequence) => sequence,
    defaultStyle: 'flow'
});

const CUSTOM_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([FlowSequenceType]);

// Per-path write queues to avoid concurrent save collisions
const SAVE_QUEUES = globalThis.__daylightSaveQueues || new Map();
globalThis.__daylightSaveQueues = SAVE_QUEUES;

const isNullOrInteger = (value) => value === null || (typeof value === 'number' && Number.isInteger(value));

const markFlowSequences = (value) => {
    if (Array.isArray(value)) {
        const processed = value.map((item) => markFlowSequences(item));
        const shouldFlow = processed.length > 0 && processed.every(isNullOrInteger);
        if (shouldFlow) {
            const flowSequence = new FlowSequence();
            processed.forEach((item) => flowSequence.push(item));
            return flowSequence;
        }
        return processed;
    }

    if (value && typeof value === 'object') {
        Object.keys(value).forEach((key) => {
            value[key] = markFlowSequences(value[key]);
        });
    }

    return value;
};


export const saveImage = async (url, folder, uid) => {
    if (!url) return false;
    const path = `${process.env.path.img}/${folder}/${uid}`;
    const pathWithoutFilename = path.split('/').slice(0, -1).join('/');

    // Ensure the folder exists
    if (!fs.existsSync(pathWithoutFilename)) {
        fs.mkdirSync(pathWithoutFilename, { recursive: true });
    }

    // Check if file already exists
    const alreadyExists = fs.existsSync(path + '.jpg');
    if (alreadyExists) {
        const stats = fs.statSync(path + '.jpg');
        const fileAgeInMs = Date.now() - stats.mtimeMs;
        const oneDayInMs = 24 * 60 * 60 * 1000;
        if (fileAgeInMs < oneDayInMs) {
            //console.log(`Image already exists and is less than 24 hours old: ${path}.jpg`);
            return true;
        }
    }

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });

        const filePath = `${path}.jpg`; // Assuming the image is a .jpg
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        ioLogger.error('io.saveImage.failed', { url, message: error?.shortMessage || error.message });
        return false;
    }
};

export const loadRandom = (folder) => {
    const path = `${process.env.path.data}/${folder}`;
    if (!fs.existsSync(path)) {
        ioLogger.error('io.loadRandom.folderMissing', { path });
        return false;
    }

    const files = fs.readdirSync(path).filter(file => 
        (file.endsWith('.yml') || file.endsWith('.yaml')) && !file.startsWith('._')
    );
    if (files.length === 0) {
        ioLogger.warn('io.loadRandom.noYamlFiles', { path });
        return false;
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = `${path}/${randomFile}`;
    const fileData = fs.readFileSync(filePath, 'utf8').toString().trim();

    try {
        const object = yaml.load(fileData);
        return object;
    } catch (e) {
        ioLogger.error('io.loadRandom.parseError', { filePath, message: e?.message || e });
        return false;
    }
};

// Track deprecation warnings to avoid spam
const deprecationWarnings = new Set();

// Paths that should be migrated to user-namespaced locations
const LEGACY_USER_PATHS = [
    'lifelog/',        // Now at users/{username}/lifelog/
];

// Paths that should be migrated to household-scoped locations
const LEGACY_HOUSEHOLD_PATHS = [
    { pattern: 'fitness/config', suggestion: 'households/{household}/apps/fitness/config' },
    { pattern: 'gratitude/options', suggestion: 'households/{household}/shared/gratitude/options.*' },
    { pattern: 'gratitude/users', suggestion: 'households/{household}/shared/gratitude/users' },
    { pattern: 'gratitude/bank', suggestion: 'households/{household}/shared/gratitude/bank' },
    { pattern: 'gratitude/snapshots', suggestion: 'households/{household}/shared/gratitude/snapshots/' },
    { pattern: 'history/media_memory', suggestion: 'households/{household}/history/media_memory/' },
    { pattern: 'history/menu_memory', suggestion: 'households/{household}/history/menu_memory' },
];

const loadFile = (path) => {
    path = path.replace(process.env.path.data, '').replace(/^[.\/]+/, '').replace(/\.(yaml|yml)$/, '');
    
    // Skip macOS resource fork files
    const filename = path.split('/').pop();
    if (filename && filename.startsWith('._')) {
       // console.warn(`Skipping macOS resource fork file: ${path}`);
        return null;
    }

    // Check for legacy user-data paths and log deprecation warning (once per path)
    const isLegacyUserPath = LEGACY_USER_PATHS.some(prefix => path.startsWith(prefix));
    if (isLegacyUserPath && !deprecationWarnings.has(path)) {
        deprecationWarnings.add(path);
        // Parse username from legacy path like "lifelog/{username}/service" -> "{username}"
        const pathParts = path.split('/');
        const username = pathParts[1] || '{username}';
        const service = pathParts.slice(2).join('/') || '{service}';
        ioLogger.warn('io.loadFile.deprecatedPath', {
            path,
            message: `Legacy path "${path}" should be migrated to user-namespaced location`,
            suggestedPath: `users/${username}/lifelog/${service}`,
            migration: 'Run: node scripts/migrate-user-data.mjs'
        });
    }

    // Check for legacy household paths and log deprecation warning (once per path)
    const householdMatch = LEGACY_HOUSEHOLD_PATHS.find(h => path.startsWith(h.pattern));
    if (householdMatch && !deprecationWarnings.has(path)) {
        deprecationWarnings.add(path);
        ioLogger.warn('io.loadFile.deprecatedHouseholdPath', {
            path,
            message: `Legacy path "${path}" should be migrated to household-scoped location`,
            suggestedPath: householdMatch.suggestion,
            migration: 'Use configService/userDataService household methods instead'
        });
    }
    
    // Try .yml first, then .yaml as fallback (legacy)
    const ymlPath = `${process.env.path.data}/${path}.yml`;
    const yamlPath = `${process.env.path.data}/${path}.yaml`;
    let fileToLoad = null;

    if (fs.existsSync(ymlPath)) {
        fileToLoad = ymlPath;
    } else if (fs.existsSync(yamlPath)) {
        fileToLoad = yamlPath;
    } else {
        // File doesn't exist - just return null, don't create empty files
        return null;
    }
    let fileData = fs.readFileSync(fileToLoad, 'utf8').toString().trim();
    // Remove null bytes and other problematic characters
    fileData = fileData.replace(/\u0000/g, '');

    try {
        const object = yaml.load(fileData);
        //if {} then return null
        if (object && Object.keys(object).length === 0) return null;
        return object || null;
    } catch (e) {
        ioLogger.error('io.loadFile.parseError', { fileToLoad, message: e?.message || e });
        return fileData || null;
    }
}

function removeCircularReferences(data){
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(data, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    }));
}

const mkDirIfNotExists= (path) =>{
    const pathWithoutFilename = path.split('/').slice(0,-1).join('/');
    const dirs = pathWithoutFilename.split('/');
    let currentPath = process.env.path.data;
    dirs.forEach(dir => {
        currentPath = `${currentPath}/${dir}`;
        if (!fs.existsSync(currentPath)) {
            fs.mkdirSync(currentPath);
        }
    });
}

const getQueue = (key) => {
    if (!SAVE_QUEUES.has(key)) {
        SAVE_QUEUES.set(key, { writing: false, pending: [] });
    }
    return SAVE_QUEUES.get(key);
};

const processQueue = (key) => {
    const queue = SAVE_QUEUES.get(key);
    if (!queue || queue.writing) return;
    const job = queue.pending.shift();
    if (!job) {
        SAVE_QUEUES.delete(key);
        return;
    }

    queue.writing = true;
    try {
        mkDirIfNotExists(job.normalizedPath);
        const processed = markFlowSequences(job.data);
        const dst = `${process.env.path.data}/${job.yamlFile}`;
        const yamlString = yaml.dump(processed, {
            schema: CUSTOM_YAML_SCHEMA,
            lineWidth: -1
        });
        fs.writeFileSync(dst, yamlString, 'utf8');
    } catch (err) {
        ioLogger.error('io.saveFile.queueWriteFailed', { yamlFile: job.yamlFile, message: err?.message || err });
    } finally {
        queue.writing = false;
        if (queue.pending.length === 0) {
            SAVE_QUEUES.delete(key);
        } else {
            processQueue(key);
        }
    }
};

const saveFile = (path, data) => {
    if (typeof path !== 'string') return false;
    const normalizedPath = path?.replace(process.env.path.data, '').replace(/^[.\/]+/, '').replace(/\.(yaml|yml)$/, '');
    const yamlFile = `${normalizedPath}.yml`;

    // Check for legacy user-data paths and log deprecation warning (once per path)
    const isLegacyUserPath = LEGACY_USER_PATHS.some(prefix => normalizedPath.startsWith(prefix));
    if (isLegacyUserPath && !deprecationWarnings.has(`save:${normalizedPath}`)) {
        deprecationWarnings.add(`save:${normalizedPath}`);
        // Parse username from legacy path like "lifelog/{username}/service" -> "{username}"
        const pathParts = normalizedPath.split('/');
        const username = pathParts[1] || '{username}';
        const service = pathParts.slice(2).join('/') || '{service}';
        ioLogger.warn('io.saveFile.deprecatedPath', {
            path: normalizedPath,
            message: `Legacy path "${normalizedPath}" should be migrated to user-namespaced location`,
            suggestedPath: `users/${username}/lifelog/${service}`
        });
    }

    // Check for legacy household paths and log deprecation warning (once per path)
    const householdMatch = LEGACY_HOUSEHOLD_PATHS.find(h => normalizedPath.startsWith(h.pattern));
    if (householdMatch && !deprecationWarnings.has(`save:${normalizedPath}`)) {
        deprecationWarnings.add(`save:${normalizedPath}`);
        ioLogger.warn('io.saveFile.deprecatedHouseholdPath', {
            path: normalizedPath,
            message: `Legacy path "${normalizedPath}" should be migrated to household-scoped location`,
            suggestedPath: householdMatch.suggestion
        });
    }

    const queue = getQueue(yamlFile);
    // Clone eagerly so callers can mutate after queuing without affecting the write
    const cloned = JSON.parse(JSON.stringify(removeCircularReferences(data)));

    queue.pending.push({ normalizedPath, yamlFile, data: cloned });
    processQueue(yamlFile);
    return true;
}

const sanitize = (string) => {

    string = smartquotes(decode(string));
    const allowedChars = /[a-zA-Z0-9\s\-_\uAC00-\uD7A3\(\)\[\]\{\}\'\"\&”“‘’<@>.,;!?]/;
    string = string.replace(/\s+/g, ' ').trim();
    return string.split('').filter(char => char.match(allowedChars)).join('');


}

// ============================================================
// USER-AWARE HELPERS (Phase 1 of lifelog restructure)
// ============================================================

/**
 * Load lifelog data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'fitness', 'strava', 'nutrition/nutriday')
 * @returns {object|null} The loaded data or null if not found
 */
const userLoadFile = (username, service) => {
    if (!username) {
        ioLogger.warn('io.userLoadFile.noUsername', { service });
        return null;
    }
    // Try new path first: users/{username}/lifelog/{service}
    const newPath = `users/${username}/lifelog/${service}`;
    const newData = loadFile(newPath);
    if (newData !== null) return newData;
    
    // Fall back to legacy path: lifelog/{username}/{service}
    const legacyPath = `lifelog/${username}/${service}`;
    const legacyData = loadFile(legacyPath);
    if (legacyData !== null && !deprecationWarnings.has(`userLoad:${legacyPath}`)) {
        deprecationWarnings.add(`userLoad:${legacyPath}`);
        ioLogger.warn('io.userLoadFile.legacyPath', {
            legacyPath,
            newPath,
            message: `Migrate lifelog data: lifelog/${username}/ → users/${username}/lifelog/`
        });
    }
    return legacyData;
};

/**
 * Save lifelog data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'fitness', 'strava', 'nutrition/nutriday')
 * @param {object} data - The data to save
 * @returns {boolean} True if saved successfully
 */
const userSaveFile = (username, service, data) => {
    if (!username) {
        ioLogger.warn('io.userSaveFile.noUsername', { service });
        return false;
    }
    // Write to new path: users/{username}/lifelog/{service}
    const newPath = `users/${username}/lifelog/${service}`;
    const result = saveFile(newPath, data);
    
    return result;
};

/**
 * Load auth token for a specific user
 * @param {string} username - The username
 * @param {string} service - The auth service name (e.g., 'strava', 'withings')
 * @returns {object|null} The loaded auth data or null if not found
 */
const userLoadAuth = (username, service) => {
    if (!username) {
        ioLogger.warn('io.userLoadAuth.noUsername', { service });
        return null;
    }
    // Try new path first, then fall back to legacy
    const newPath = `users/${username}/auth/${service}`;
    const newData = loadFile(newPath);
    if (newData) return newData;
    
    // Fall back to legacy path (will log deprecation warning)
    return loadFile(`auth/${service}`);
};

/**
 * Save auth token for a specific user
 * @param {string} username - The username
 * @param {string} service - The auth service name (e.g., 'strava', 'withings')
 * @param {object} data - The auth data to save
 * @returns {boolean} True if saved successfully
 */
const userSaveAuth = (username, service, data) => {
    if (!username) {
        ioLogger.warn('io.userSaveAuth.noUsername', { service });
        return false;
    }
    const path = `users/${username}/auth/${service}`;
    return saveFile(path, data);
};

/**
 * Load user profile
 * @param {string} username - The username
 * @returns {object|null} The user profile or null if not found
 */
const userLoadProfile = (username) => {
    if (!username) {
        ioLogger.warn('io.userLoadProfile.noUsername', {});
        return null;
    }
    return loadFile(`users/${username}/profile`);
};

// ============================================================
// USER CURRENT DATA HELPERS (ephemeral/active state)
// ============================================================

/**
 * Load current (ephemeral) data for a specific user
 * Current data represents active/pending state (inbox, open tasks, upcoming events)
 * as opposed to lifelog which is historical/completed data
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist', 'calendar')
 * @returns {object|null} The loaded data or null if not found
 */
const userLoadCurrent = (username, service) => {
    if (!username) {
        ioLogger.warn('io.userLoadCurrent.noUsername', { service });
        return null;
    }
    return loadFile(`users/${username}/current/${service}`);
};

/**
 * Save current (ephemeral) data for a specific user
 * Current data represents active/pending state (inbox, open tasks, upcoming events)
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist', 'calendar')
 * @param {object} data - The data to save
 * @returns {boolean} True if saved successfully
 */
const userSaveCurrent = (username, service, data) => {
    if (!username) {
        ioLogger.warn('io.userSaveCurrent.noUsername', { service });
        return false;
    }
    return saveFile(`users/${username}/current/${service}`, data);
};

// ============================================================
// HOUSEHOLD-AWARE HELPERS (Phase 0 of three-tier architecture)
// ============================================================

/**
 * Get current household ID from environment or default
 * @returns {string} The current household ID
 */
const getCurrentHouseholdId = () => {
    return process.env.HOUSEHOLD_ID || process.env.household_id || 'default';
};

/**
 * Load data file for a specific household
 * @param {string} householdId - The household ID (e.g., 'default')
 * @param {string} path - The relative path within the household (e.g., 'shared/calendar', 'apps/fitness/config')
 * @returns {object|null} The loaded data or null if not found
 */
const householdLoadFile = (householdId, filePath) => {
    if (!householdId) {
        ioLogger.warn('io.householdLoadFile.noHouseholdId', { path: filePath });
        return null;
    }
    if (!filePath) {
        ioLogger.warn('io.householdLoadFile.noPath', { householdId });
        return null;
    }
    const fullPath = `households/${householdId}/${filePath}`;
    return loadFile(fullPath);
};

/**
 * Save data file for a specific household
 * @param {string} householdId - The household ID (e.g., 'default')
 * @param {string} path - The relative path within the household (e.g., 'shared/calendar', 'apps/fitness/config')
 * @param {object} data - The data to save
 * @returns {boolean} True if saved successfully
 */
const householdSaveFile = (householdId, filePath, data) => {
    if (!householdId) {
        ioLogger.warn('io.householdSaveFile.noHouseholdId', { path: filePath });
        return false;
    }
    if (!filePath) {
        ioLogger.warn('io.householdSaveFile.noPath', { householdId });
        return false;
    }
    const fullPath = `households/${householdId}/${filePath}`;
    return saveFile(fullPath, data);
};

/**
 * Load auth credentials for a specific household
 * @param {string} householdId - The household ID (e.g., 'default')
 * @param {string} service - The service name (e.g., 'plex', 'home_assistant', 'clickup')
 * @returns {object|null} The auth data or null if not found
 */
const householdLoadAuth = (householdId, service) => {
    if (!householdId) {
        ioLogger.warn('io.householdLoadAuth.noHouseholdId', { service });
        return null;
    }
    if (!service) {
        ioLogger.warn('io.householdLoadAuth.noService', { householdId });
        return null;
    }
    const authPath = `households/${householdId}/auth/${service}`;
    const data = loadFile(authPath);
    
    // Fallback to env var during migration period
    if (!data) {
        const envKey = service.toUpperCase().replace(/-/g, '_');
        const envToken = process.env[`${envKey}_TOKEN`] || process.env[`${envKey}_PK`] || process.env[envKey];
        if (envToken) {
            ioLogger.debug('io.householdLoadAuth.envFallback', { 
                service, 
                householdId,
                message: `Using env fallback for ${service}, migrate to households/${householdId}/auth/${service}.yml`
            });
            return { token: envToken };
        }
    }
    
    return data;
};

/**
 * Save auth credentials for a specific household
 * @param {string} householdId - The household ID (e.g., 'default')
 * @param {string} service - The service name (e.g., 'plex', 'home_assistant', 'clickup')
 * @param {object} data - The auth data to save
 * @returns {boolean} True if saved successfully
 */
const householdSaveAuth = (householdId, service, data) => {
    if (!householdId) {
        ioLogger.warn('io.householdSaveAuth.noHouseholdId', { service });
        return false;
    }
    if (!service) {
        ioLogger.warn('io.householdSaveAuth.noService', { householdId });
        return false;
    }
    const authPath = `households/${householdId}/auth/${service}`;
    return saveFile(authPath, data);
};

/**
 * Load household configuration (household.yml)
 * @param {string} householdId - The household ID (e.g., 'default')
 * @returns {object|null} The household config or null if not found
 */
const householdLoadConfig = (householdId) => {
    if (!householdId) {
        ioLogger.warn('io.householdLoadConfig.noHouseholdId', {});
        return null;
    }
    return loadFile(`households/${householdId}/household`);
};

/**
 * Get default username (head of household)
 * Uses household config or falls back to env
 * @param {string} [householdId] - Optional household ID
 * @returns {string|null} The default username
 */
const getDefaultUsername = (householdId = null) => {
    const hid = householdId || getCurrentHouseholdId();
    const config = householdLoadConfig(hid);
    if (config?.head) return config.head;
    
    // Fallback to env
    return process.env.default_username || process.env.DEFAULT_USERNAME || null;
};


export { 
    loadFile, 
    saveFile, 
    sanitize, 
    // User-level helpers
    userLoadFile, 
    userSaveFile, 
    userLoadAuth, 
    userSaveAuth,
    userLoadProfile,
    userLoadCurrent,
    userSaveCurrent,
    getDefaultUsername,
    // Household-level helpers
    householdLoadFile,
    householdSaveFile,
    householdLoadAuth,
    householdSaveAuth,
    householdLoadConfig,
    getCurrentHouseholdId
};