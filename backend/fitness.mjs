import express from 'express';
import { loadFile, saveFile } from './lib/io.mjs';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { userService } from './lib/config/UserService.mjs';
import { configService } from './lib/config/ConfigService.mjs';
import { userDataService } from './lib/config/UserDataService.mjs';
import { activateScene } from './lib/homeassistant.mjs';
import { createLogger } from './lib/logging/logger.js';

const fitnessLogger = createLogger({ source: 'backend', app: 'fitness' });

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const trimTrailingNulls = (series = []) => {
    if (!Array.isArray(series)) return [];
    const copy = series.map((value) => (value === undefined ? null : value));
    let end = copy.length;
    while (end > 0 && copy[end - 1] == null) {
        end -= 1;
    }
    return copy.slice(0, end);
};

const normalizeNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeTimelineForPersistence = (timeline = {}) => {
    if (!isPlainObject(timeline)) return null;
    const normalizedSeries = {};
    const sourceSeries = timeline.series && isPlainObject(timeline.series) ? timeline.series : {};
    Object.entries(sourceSeries).forEach(([key, values]) => {
        if (!Array.isArray(values)) return;
        normalizedSeries[key] = trimTrailingNulls(values);
    });

    const normalizedEvents = Array.isArray(timeline.events)
        ? timeline.events
            .map((event) => {
                if (!isPlainObject(event)) return null;
                const type = typeof event.type === 'string' ? event.type.trim() : null;
                if (!type) return null;
                return {
                    timestamp: normalizeNumber(event.timestamp),
                    offsetMs: normalizeNumber(event.offsetMs),
                    tickIndex: Number.isFinite(event.tickIndex) ? event.tickIndex : null,
                    type,
                    source: typeof event.source === 'string' ? event.source : null,
                    data: isPlainObject(event.data) ? { ...event.data } : (event.data ?? null)
                };
            })
            .filter(Boolean)
        : [];

    const timebase = isPlainObject(timeline.timebase) ? { ...timeline.timebase } : {};
    if (!Number.isFinite(timebase.startTime)) {
        timebase.startTime = Date.now();
    }
    if (!(Number.isFinite(timebase.intervalMs) && timebase.intervalMs > 0)) {
        timebase.intervalMs = 5000;
    }
    if (!Number.isFinite(timebase.tickCount)) {
        const fallback = Object.values(normalizedSeries)[0]?.length ?? 0;
        timebase.tickCount = fallback;
    }

    const normalizedTimeline = {
        ...timeline,
        timebase,
        series: normalizedSeries,
        events: normalizedEvents
    };

    return normalizedTimeline;
};

export const prepareSessionForPersistence = (sessionData = {}) => {
    if (!isPlainObject(sessionData)) return sessionData;
    const prepared = { ...sessionData };
    if (prepared.timeline) {
        const normalizedTimeline = normalizeTimelineForPersistence(prepared.timeline);
        if (normalizedTimeline) {
            prepared.timeline = normalizedTimeline;
            prepared.timebase = normalizedTimeline.timebase;
            prepared.events = normalizedTimeline.events;
        }
    }
    return prepared;
};

const stringifyTimelineSeriesForFile = (sessionData = {}) => {
    if (!isPlainObject(sessionData)) return sessionData;
    if (!sessionData.timeline || !isPlainObject(sessionData.timeline)) return sessionData;
    const clone = { ...sessionData, timeline: { ...sessionData.timeline } };
    const sourceSeries = sessionData.timeline.series;
    if (!isPlainObject(sourceSeries)) return clone;
    const serializedSeries = {};
    Object.entries(sourceSeries).forEach(([key, values]) => {
        if (!Array.isArray(values) && typeof values !== 'string') return;
        if (typeof values === 'string') {
            serializedSeries[key] = values;
            return;
        }
        try {
            serializedSeries[key] = JSON.stringify(values);
        } catch (_) {
            serializedSeries[key] = '[]';
        }
    });
    clone.timeline.series = serializedSeries;
    return clone;
};

const deriveSessionDate = (sessionId) => {
    if (!sessionId || sessionId.length < 8) return null;
    return `${sessionId.slice(0, 4)}-${sessionId.slice(4, 6)}-${sessionId.slice(6, 8)}`;
};

const resolveMediaRoot = () => {
    if (process.env.path && process.env.path.media) {
        return process.env.path.media;
    }
    return path.join(process.cwd(), 'media');
};

const getSessionStoragePaths = (sessionId) => {
    if (!sessionId) return null;
    const sessionDate = deriveSessionDate(sessionId);
    if (!sessionDate) return null;
    const dataRoot = resolveDataRoot();
    const mediaRoot = resolveMediaRoot();
    const hid = configService.getDefaultHouseholdId();
    
    // Data path: single YML file per session - data/households/{hid}/apps/fitness/sessions/YYYY-MM-DD/{sessionId}.yml
    const sessionsDir = `households/${hid}/apps/fitness/sessions/${sessionDate}`;
    const sessionsDirFs = path.join(dataRoot, 'households', hid, 'apps', 'fitness', 'sessions', sessionDate);
    
    // Media paths (screenshots) - media/households/{hid}/fitness/sessions/YYYY-MM-DD/{sessionId}/screenshots/
    const mediaRelativeBase = `households/${hid}/fitness/sessions/${sessionDate}/${sessionId}`;
    const screenshotsDirFs = path.join(mediaRoot, 'households', hid, 'fitness', 'sessions', sessionDate, sessionId, 'screenshots');
    
    return {
        sessionDate,
        sessionsDirFs,
        screenshotsDirFs,
        sessionFileRelative: `${sessionsDir}/${sessionId}`,  // Will become {sessionId}.yml
        screenshotsRelativeBase: `${mediaRelativeBase}/screenshots`
    };
};

const ensureDirectory = (dirPath) => {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Lazy init OpenAI (will throw if key missing on first use only)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const fitnessRouter = express.Router();

/**
 * Load fitness config from household-scoped path with legacy fallback
 * @param {string} householdId - Household ID (defaults to system default)
 * @returns {object|null} Fitness config
 */
const loadFitnessConfig = (householdId) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    
    // Try household-scoped path first
    const householdConfig = userDataService.readHouseholdAppData(hid, 'fitness', 'config');
    if (householdConfig) {
        // Log ambient_led config status
        const ambientLed = householdConfig?.ambient_led;
        if (ambientLed?.scenes) {
            const sceneKeys = Object.keys(ambientLed.scenes);
            fitnessLogger.info('fitness.config.ambient_led', {
                enabled: true,
                householdId: hid,
                scenes: sceneKeys,
                throttleMs: ambientLed.throttle_ms || 2000,
                hasOffScene: !!ambientLed.scenes.off
            });
        } else {
            fitnessLogger.debug('fitness.config.ambient_led', {
                enabled: false,
                householdId: hid,
                reason: ambientLed ? 'no scenes configured' : 'ambient_led section missing'
            });
        }
        return householdConfig;
    }
    
    // Fall back to legacy global path
    console.warn(`[fitness] Household config not found for '${hid}', falling back to legacy fitness/config`);
    return loadFile('fitness/config');
};

// Fitness config endpoint - hydrates primary users from profiles
// Supports ?household=<id> query param for household selection
fitnessRouter.get('/', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const fitnessData = loadFitnessConfig(householdId);
    if(!fitnessData) return res.status(404).json({ error: 'Fitness configuration not found' });
    
    // Hydrate users: primary users are resolved from profile files
    const hydratedData = userService.hydrateFitnessConfig(fitnessData, householdId);
    
    // Include household info in response
    hydratedData._household = householdId;
    
    res.json(hydratedData);
});


fitnessRouter.post('/save_session', (req, res) => {
    const { sessionData } = req.body;
    if(!sessionData) return res.status(400).json({ error: 'Session data is required' });
    const sanitizedSessionId = sanitizeSessionId(sessionData.sessionId);
    if (!sanitizedSessionId || sanitizedSessionId.length !== 14) {
        return res.status(400).json({ error: 'Valid sessionId is required' });
    }

    // Ensure the session data reflects the sanitized identifier
    const preparedSession = prepareSessionForPersistence({ ...sessionData, sessionId: sanitizedSessionId });
    preparedSession.sessionId = sanitizedSessionId;
    const filePayload = stringifyTimelineSeriesForFile(preparedSession);

    const storagePaths = getSessionStoragePaths(sanitizedSessionId);
    if (!storagePaths) {
        return res.status(500).json({ error: 'Failed to resolve session storage path' });
    }
    ensureDirectory(storagePaths.sessionsDirFs);
    ensureDirectory(storagePaths.screenshotsDirFs);
    
    // Merge with existing file to preserve snapshots
    const existingData = loadFile(storagePaths.sessionFileRelative) || {};
    const mergedPayload = { ...existingData, ...filePayload };
    if (existingData.snapshots) {
        mergedPayload.snapshots = existingData.snapshots;
    }
    
    saveFile(storagePaths.sessionFileRelative, mergedPayload);
    const filename = `${storagePaths.sessionFileRelative}.yml`;
    //trigger printer (TODO)

    res.json({ message: 'Session data saved successfully', filename, sessionData: preparedSession });
});

const resolveDataRoot = () => {
    if (process.env.path && process.env.path.data) {
        return process.env.path.data;
    }
    return path.join(process.cwd(), 'data');
};

function sanitizeSessionId(value) {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits || null;
}

fitnessRouter.post('/save_screenshot', (req, res) => {
    try {
        const { sessionId, imageBase64, mimeType, index, timestamp } = req.body || {};
        if (!sessionId || !imageBase64) {
            return res.status(400).json({ ok: false, error: 'sessionId and imageBase64 are required' });
        }

        const safeSessionId = sanitizeSessionId(sessionId);
        if (!safeSessionId) {
            return res.status(400).json({ ok: false, error: 'Invalid sessionId' });
        }

        const trimmed = imageBase64.replace(/^data:[^;]+;base64,/, '');
        if (!trimmed) {
            return res.status(400).json({ ok: false, error: 'Invalid base64 payload' });
        }

        const buffer = Buffer.from(trimmed, 'base64');
        if (!buffer.length) {
            return res.status(400).json({ ok: false, error: 'Failed to decode image data' });
        }

        const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
        const extension = normalizedMime.includes('png') ? 'png'
            : normalizedMime.includes('webp') ? 'webp'
            : normalizedMime.includes('jpeg') || normalizedMime.includes('jpg') ? 'jpg'
            : 'jpg';

        const indexValue = Number.isFinite(index) ? Number(index) : null;
        const indexFragment = indexValue != null ? String(indexValue).padStart(4, '0') : Date.now().toString(36);
        const filename = `${safeSessionId}_${indexFragment}.${extension}`;
        const storagePaths = getSessionStoragePaths(safeSessionId);
        if (!storagePaths) {
            return res.status(500).json({ ok: false, error: 'Failed to resolve session directories' });
        }
        ensureDirectory(storagePaths.sessionsDirFs);
        ensureDirectory(storagePaths.screenshotsDirFs);
        const filePath = path.join(storagePaths.screenshotsDirFs, filename);
        fs.writeFileSync(filePath, buffer);

        const relativePath = `${storagePaths.screenshotsRelativeBase}/${filename}`.split(path.sep).join('/');
        const captureInfo = {
            ok: true,
            sessionId: safeSessionId,
            filename,
            path: relativePath,
            size: buffer.length,
            mimeType: normalizedMime || 'image/jpeg',
            index: indexValue,
            timestamp: timestamp || Date.now()
        };

        // Update snapshots within the session file
        try {
            const sessionFilePath = storagePaths.sessionFileRelative;
            const sessionData = loadFile(sessionFilePath) || { sessionId: safeSessionId };
            
            if (!sessionData.snapshots) {
                sessionData.snapshots = { captures: [] };
            }
            if (!Array.isArray(sessionData.snapshots.captures)) {
                sessionData.snapshots.captures = [];
            }
            
            sessionData.snapshots.updatedAt = Date.now();
            sessionData.snapshots.captures = sessionData.snapshots.captures.filter((entry) => entry?.filename !== filename);
            sessionData.snapshots.captures.push({
                index: indexValue,
                filename,
                path: relativePath,
                timestamp: captureInfo.timestamp,
                size: buffer.length
            });
            
            saveFile(sessionFilePath, sessionData);
        } catch (snapshotsErr) {
            console.warn('save_screenshot snapshots update failed', snapshotsErr?.message || snapshotsErr);
        }

        return res.json(captureInfo);
    } catch (error) {
        console.error('save_screenshot error', error);
        return res.status(500).json({ ok: false, error: 'Failed to save screenshot' });
    }
});

// Voice memo ingestion & transcription
// Expects: { audioBase64, mimeType?, sessionId?, startedAt?, endedAt? }
// Returns: { ok, memo: { transcriptRaw, transcriptClean, createdAt, sessionId, durationSeconds } }
fitnessRouter.post('/voice_memo', async (req, res) => {
    try {
        if(!openai) return res.status(500).json({ ok:false, error: 'OPENAI_API_KEY not configured' });
        const { audioBase64, mimeType, sessionId, startedAt, endedAt } = req.body || {};
        if(!audioBase64 || typeof audioBase64 !== 'string') {
            return res.status(400).json({ ok:false, error: 'audioBase64 required' });
        }
        // Decode base64 (strip data URI prefix if present)
        const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tmpDir = '/tmp';
        const ext = (mimeType && mimeType.includes('webm')) ? 'webm' : (mimeType && mimeType.includes('ogg') ? 'ogg' : 'mp4');
        const fileName = `voice-memo-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = path.join(tmpDir, fileName);
        fs.writeFileSync(filePath, buffer);

        // 1. Transcribe with Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: 'whisper-1'
        });
        const transcriptRaw = transcription?.text || '';

        // 2. Clean transcript with GPT-4o (remove obvious filler / mis-heard artifacts, keep intent)
        let transcriptClean = transcriptRaw;
        if (transcriptRaw) {
            try {
                const cleanResp = await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'You clean short workout voice memos. Remove duplicated words, filler like "uh", obvious transcription glitches, keep numeric data and intent. Return ONLY the cleaned text.' },
                        { role: 'user', content: transcriptRaw }
                    ],
                    temperature: 0.2,
                    max_tokens: 400
                });
                transcriptClean = cleanResp?.choices?.[0]?.message?.content?.trim() || transcriptRaw;
            } catch(cleanErr) {
                console.error('Clean transcript error:', cleanErr);
            }
        }

        // (Optional) Rough duration estimate via size (assuming ~32kbps opus -> 4KB/sec). Only if not provided.
        const durationSeconds = Math.round(buffer.length / 4096) || null;

        const memo = {
            sessionId: sessionId || null,
            transcriptRaw,
            transcriptClean,
            createdAt: Date.now(),
            startedAt: startedAt || null,
            endedAt: endedAt || null,
            durationSeconds
        };

        // (Optional future) Persist raw audio or memo to disk if desired.
        return res.json({ ok:true, memo });
    } catch (e) {
        console.error('voice_memo error', e);
        return res.status(500).json({ ok:false, error: e.message || 'voice memo failure' });
    }
});


// =============================================================================
// Ambient LED Zone Sync (Home Assistant Integration)
// =============================================================================

// Rate limiting, circuit breaker, and metrics state (module-scoped singleton)
const zoneLedState = {
    // Rate limiting
    lastScene: null,
    lastActivatedAt: 0,
    
    // Circuit breaker
    failureCount: 0,
    maxFailures: 5,
    backoffUntil: 0,
    
    // Metrics (for observability)
    metrics: {
        totalRequests: 0,
        activatedCount: 0,
        skippedDuplicate: 0,
        skippedRateLimited: 0,
        skippedBackoff: 0,
        skippedDisabled: 0,
        failureCount: 0,
        lastActivatedScene: null,
        lastActivatedTime: null,
        sceneHistogram: {},  // scene -> activation count
        sessionStartCount: 0,
        sessionEndCount: 0,
        uptimeStart: Date.now()
    }
};

// Zone priority defines ordering (lower = cooler)
const ZONE_PRIORITY = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];

/**
 * Normalize zone ID to canonical form
 * @param {string} zoneId - Raw zone ID
 * @returns {string|null} Normalized zone ID or null if invalid
 */
function normalizeZoneId(zoneId) {
    if (!zoneId) return null;
    const lower = String(zoneId).toLowerCase().trim();
    return ZONE_ORDER.includes(lower) ? lower : null;
}

/**
 * Check if ambient LED feature is enabled based on config
 * @param {object} fitnessConfig - The full fitness config
 * @returns {boolean}
 */
function isAmbientLedEnabled(fitnessConfig) {
    const ambientLed = fitnessConfig?.ambient_led;
    if (!ambientLed) return false;
    
    const scenes = ambientLed.scenes;
    if (!scenes || typeof scenes !== 'object') return false;
    if (!scenes.off) return false; // 'off' scene is required
    
    return true;
}

/**
 * Resolve the target HA scene name from config with fallback chain
 * @param {object} sceneConfig - The ambient_led.scenes config object
 * @param {string} zoneKey - Zone key: 'off', 'cool', 'active', 'warm', 'hot', 'fire', 'fire_all'
 * @returns {string|null} Scene name or null if not configured
 */
function resolveSceneFromConfig(sceneConfig, zoneKey) {
    if (!sceneConfig || typeof sceneConfig !== 'object') return null;
    
    // Direct lookup
    if (sceneConfig[zoneKey]) return sceneConfig[zoneKey];
    
    // Fallback chain for missing zone scenes
    if (zoneKey === 'fire_all') return sceneConfig.fire || sceneConfig.off || null;
    
    const zoneIndex = ZONE_ORDER.indexOf(zoneKey);
    if (zoneIndex > 0) {
        // Fall back to next lower zone
        for (let i = zoneIndex - 1; i >= 0; i--) {
            if (sceneConfig[ZONE_ORDER[i]]) return sceneConfig[ZONE_ORDER[i]];
        }
    }
    
    return sceneConfig.off || null;
}

/**
 * Resolve target scene based on active zones
 * @param {Array<{zoneId: string, isActive: boolean}>} zones - Zone data for all participants
 * @param {boolean} sessionEnded - Whether session has ended
 * @param {object} sceneConfig - The ambient_led.scenes config object
 * @returns {string|null} Scene name to activate or null
 */
function resolveTargetScene(zones, sessionEnded, sceneConfig) {
    if (!sceneConfig) return null;
    
    if (sessionEnded) return resolveSceneFromConfig(sceneConfig, 'off');
    
    const activeZones = zones
        .filter(z => z && z.isActive !== false)
        .map(z => normalizeZoneId(z.zoneId))
        .filter(Boolean);
    
    if (activeZones.length === 0) return resolveSceneFromConfig(sceneConfig, 'off');
    
    const maxZone = activeZones.reduce((max, zone) =>
        ZONE_PRIORITY[zone] > ZONE_PRIORITY[max] ? zone : max
    , 'cool');
    
    // Special case: ALL users in fire zone → breathing effect
    if (maxZone === 'fire' && activeZones.every(z => z === 'fire')) {
        return resolveSceneFromConfig(sceneConfig, 'fire_all');
    }
    
    return resolveSceneFromConfig(sceneConfig, maxZone);
}

/**
 * POST /fitness/zone_led
 * Sync ambient LED scene with current fitness zone state
 * Body: { zones: [{zoneId, isActive}], sessionEnded: boolean, householdId?: string }
 */
fitnessRouter.post('/zone_led', async (req, res) => {
    zoneLedState.metrics.totalRequests++;
    
    try {
        const { zones = [], sessionEnded = false, householdId } = req.body;
        const now = Date.now();
        
        // Track session events
        if (sessionEnded) {
            zoneLedState.metrics.sessionEndCount++;
        }
        
        // Load fitness config for this household
        const fitnessConfig = loadFitnessConfig(householdId);
        
        // Check if feature is enabled
        if (!isAmbientLedEnabled(fitnessConfig)) {
            zoneLedState.metrics.skippedDisabled++;
            fitnessLogger.debug('fitness.zone_led.skipped', {
                reason: 'feature_disabled',
                householdId
            });
            return res.json({ 
                ok: true, 
                skipped: true, 
                reason: 'feature_disabled',
                message: 'ambient_led not configured or missing required scenes'
            });
        }
        
        const sceneConfig = fitnessConfig.ambient_led.scenes;
        const throttleMs = fitnessConfig.ambient_led.throttle_ms || 2000;
        
        // Circuit breaker: if too many failures, wait before retrying
        if (zoneLedState.backoffUntil > now) {
            zoneLedState.metrics.skippedBackoff++;
            fitnessLogger.warn('fitness.zone_led.backoff', {
                remainingMs: zoneLedState.backoffUntil - now,
                failureCount: zoneLedState.failureCount
            });
            return res.json({ 
                ok: true, 
                skipped: true, 
                reason: 'backoff',
                scene: zoneLedState.lastScene 
            });
        }
        
        const targetScene = resolveTargetScene(zones, sessionEnded, sceneConfig);
        
        if (!targetScene) {
            fitnessLogger.debug('fitness.zone_led.skipped', {
                reason: 'no_scene_configured',
                zones: zones.map(z => z.zoneId)
            });
            return res.json({ 
                ok: true, 
                skipped: true, 
                reason: 'no_scene_configured',
                message: 'No scene configured for resolved zone'
            });
        }
        
        // Deduplication: skip if same scene (unless session ended - always send off)
        if (targetScene === zoneLedState.lastScene && !sessionEnded) {
            zoneLedState.metrics.skippedDuplicate++;
            fitnessLogger.debug('fitness.zone_led.skipped', {
                reason: 'duplicate',
                scene: targetScene
            });
            return res.json({ 
                ok: true, 
                skipped: true, 
                reason: 'duplicate',
                scene: targetScene 
            });
        }
        
        // Rate limiting: minimum interval between calls (session-end bypasses throttle)
        const elapsed = now - zoneLedState.lastActivatedAt;
        if (elapsed < throttleMs && !sessionEnded) {
            zoneLedState.metrics.skippedRateLimited++;
            fitnessLogger.debug('fitness.zone_led.skipped', {
                reason: 'rate_limited',
                elapsed,
                throttleMs
            });
            return res.json({ 
                ok: true, 
                skipped: true, 
                reason: 'rate_limited',
                scene: zoneLedState.lastScene 
            });
        }
        
        // Activate scene via Home Assistant
        const activationStart = Date.now();
        const result = await activateScene(targetScene);
        const activationDuration = Date.now() - activationStart;
        
        if (result.ok) {
            // Update state
            const previousScene = zoneLedState.lastScene;
            zoneLedState.lastScene = targetScene;
            zoneLedState.lastActivatedAt = now;
            zoneLedState.failureCount = 0;
            
            // Update metrics
            zoneLedState.metrics.activatedCount++;
            zoneLedState.metrics.lastActivatedScene = targetScene;
            zoneLedState.metrics.lastActivatedTime = new Date().toISOString();
            zoneLedState.metrics.sceneHistogram[targetScene] = 
                (zoneLedState.metrics.sceneHistogram[targetScene] || 0) + 1;
            
            // Track session start (first non-off activation)
            if (!previousScene && targetScene !== sceneConfig.off) {
                zoneLedState.metrics.sessionStartCount++;
            }
            
            fitnessLogger.info('fitness.zone_led.activated', {
                scene: targetScene,
                previousScene,
                activeCount: zones.filter(z => z && z.isActive !== false).length,
                sessionEnded,
                durationMs: activationDuration,
                householdId
            });
            
            return res.json({ ok: true, scene: targetScene });
        } else {
            throw new Error(result.error || 'HA activation failed');
        }
        
    } catch (error) {
        zoneLedState.failureCount++;
        zoneLedState.metrics.failureCount++;
        
        // Exponential backoff after repeated failures
        if (zoneLedState.failureCount >= zoneLedState.maxFailures) {
            const backoffMs = Math.min(60000, 1000 * Math.pow(2, zoneLedState.failureCount - zoneLedState.maxFailures));
            zoneLedState.backoffUntil = Date.now() + backoffMs;
            
            fitnessLogger.error('fitness.zone_led.circuit_open', {
                failureCount: zoneLedState.failureCount,
                backoffMs,
                error: error.message
            });
        } else {
            fitnessLogger.error('fitness.zone_led.failed', {
                error: error.message,
                failureCount: zoneLedState.failureCount,
                totalFailures: zoneLedState.metrics.failureCount
            });
        }
        
        return res.status(500).json({ 
            ok: false, 
            error: error.message,
            failureCount: zoneLedState.failureCount 
        });
    }
});

/**
 * GET /fitness/zone_led/status
 * Get current ambient LED state (for debugging)
 */
fitnessRouter.get('/zone_led/status', (req, res) => {
    const { householdId } = req.query;
    const fitnessConfig = loadFitnessConfig(householdId);
    const enabled = isAmbientLedEnabled(fitnessConfig);
    
    res.json({
        enabled,
        scenes: enabled ? fitnessConfig.ambient_led.scenes : null,
        throttleMs: enabled ? (fitnessConfig.ambient_led.throttle_ms || 2000) : null,
        state: {
            lastScene: zoneLedState.lastScene,
            lastActivatedAt: zoneLedState.lastActivatedAt,
            failureCount: zoneLedState.failureCount,
            backoffUntil: zoneLedState.backoffUntil,
            isInBackoff: zoneLedState.backoffUntil > Date.now()
        }
    });
});

/**
 * GET /fitness/zone_led/metrics
 * Get detailed metrics for observability
 */
fitnessRouter.get('/zone_led/metrics', (req, res) => {
    const now = Date.now();
    const uptimeMs = now - zoneLedState.metrics.uptimeStart;
    const metrics = zoneLedState.metrics;
    
    res.json({
        uptime: {
            ms: uptimeMs,
            formatted: formatDuration(uptimeMs),
            startedAt: new Date(metrics.uptimeStart).toISOString()
        },
        totals: {
            requests: metrics.totalRequests,
            activated: metrics.activatedCount,
            failures: metrics.failureCount,
            sessionStarts: metrics.sessionStartCount,
            sessionEnds: metrics.sessionEndCount
        },
        skipped: {
            duplicate: metrics.skippedDuplicate,
            rateLimited: metrics.skippedRateLimited,
            backoff: metrics.skippedBackoff,
            disabled: metrics.skippedDisabled
        },
        rates: {
            successRate: metrics.totalRequests > 0 
                ? ((metrics.activatedCount / metrics.totalRequests) * 100).toFixed(2) + '%'
                : 'N/A',
            skipRate: metrics.totalRequests > 0
                ? (((metrics.skippedDuplicate + metrics.skippedRateLimited) / metrics.totalRequests) * 100).toFixed(2) + '%'
                : 'N/A',
            requestsPerMinute: uptimeMs > 60000
                ? (metrics.totalRequests / (uptimeMs / 60000)).toFixed(2)
                : 'N/A (uptime < 1min)'
        },
        sceneHistogram: metrics.sceneHistogram,
        lastActivation: {
            scene: metrics.lastActivatedScene,
            time: metrics.lastActivatedTime
        },
        circuitBreaker: {
            failureCount: zoneLedState.failureCount,
            maxFailures: zoneLedState.maxFailures,
            isOpen: zoneLedState.backoffUntil > now,
            backoffRemaining: zoneLedState.backoffUntil > now 
                ? zoneLedState.backoffUntil - now 
                : 0
        }
    });
});

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * POST /fitness/zone_led/reset
 * Reset circuit breaker state (for recovery after HA comes back online)
 */
fitnessRouter.post('/zone_led/reset', (req, res) => {
    const previousState = {
        failureCount: zoneLedState.failureCount,
        backoffUntil: zoneLedState.backoffUntil,
        lastScene: zoneLedState.lastScene
    };
    
    zoneLedState.failureCount = 0;
    zoneLedState.backoffUntil = 0;
    zoneLedState.lastScene = null;
    zoneLedState.lastActivatedAt = 0;
    
    fitnessLogger.info('fitness.zone_led.reset', {
        previousState,
        resetBy: req.ip || 'unknown'
    });
    
    res.json({ ok: true, message: 'Zone LED state reset', previousState });
});


export default fitnessRouter;
