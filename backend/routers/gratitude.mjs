import express from 'express';
import fs from 'fs';
import path from 'path';
import { loadFile, saveFile } from '../lib/io.mjs';
import { configService } from '../lib/config/index.mjs';
import { userDataService } from '../lib/config/UserDataService.mjs';
import { broadcastToWebsockets } from './websocket.mjs';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';
import { createLogger } from '../lib/logging/logger.js';

const gratitudeLogger = createLogger({ app: 'gratitude' });

/**
 * ============================================================================
 * GRATITUDE MODULE - Data File Schema Documentation
 * ============================================================================
 * 
 * All data files are stored in:
 *   data/households/{householdId}/shared/gratitude/
 * 
 * ============================================================================
 * FILE: options.gratitude.yml / options.hopes.yml
 * ============================================================================
 * Purpose: Queue of items available for selection (not yet selected or dismissed)
 * 
 * Schema: Array of items
 *   - id: string (UUID)
 *     text: string
 * 
 * Example:
 *   - id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     text: "Sunny weather"
 *   - id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *     text: "Family time"
 *   - id: "c3d4e5f6-a7b8-9012-cdef-123456789012"
 *     text: "Good health"
 * 
 * ============================================================================
 * FILE: selections.gratitude.yml / selections.hopes.yml
 * ============================================================================
 * Purpose: Items that have been selected by users (with attribution)
 * 
 * Schema: Array of selection entries
 *   - id: string (UUID - selection entry ID, used for DELETE)
 *     userId: string (username from household.yml)
 *     item:
 *       id: string (original item UUID)
 *       text: string
 *     datetime: string (ISO 8601 timestamp)
 * 
 * Example:
 *   - id: "sel-1234-5678-90ab-cdef12345678"
 *     userId: "{username}"
 *     item:
 *       id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       text: "Sunny weather"
 *     datetime: "2025-12-19T08:30:00.000Z"
 *   - id: "sel-2345-6789-01bc-def123456789"
 *     userId: "felix"
 *     item:
 *       id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *       text: "Family time"
 *     datetime: "2025-12-18T19:15:00.000Z"
 * 
 * ============================================================================
 * FILE: discarded.gratitude.yml / discarded.hopes.yml
 * ============================================================================
 * Purpose: Items dismissed from the queue (not selected, removed from rotation)
 * 
 * Schema: Array of items (same as options)
 *   - id: string (UUID)
 *     text: string
 * 
 * Example:
 *   - id: "d4e5f6a7-b8c9-0123-def0-234567890123"
 *     text: "Old item no longer relevant"
 *   - id: "e5f6a7b8-c9d0-1234-ef01-345678901234"
 *     text: "Duplicate entry"
 * 
 * ============================================================================
 * FILE: users.yml (LEGACY - prefer household.yml)
 * ============================================================================
 * Purpose: Legacy user list, now superseded by household.yml users
 * 
 * Schema: Array of user objects
 *   - id: string (username)
 *     name: string (display name)
 * 
 * Note: The bootstrap endpoint now reads users from household.yml via
 * configService.getHouseholdUsers() and enriches with profile data.
 * This file is only used as a fallback.
 * 
 * ============================================================================
 * API ENDPOINTS
 * ============================================================================
 * 
 * GET  /api/gratitude/bootstrap
 *      Returns: { users, options, selections, discarded, _household }
 * 
 * GET  /api/gratitude/options/:category
 *      Returns: { items: [...] }
 * 
 * GET  /api/gratitude/selections/:category
 *      Returns: { items: [...] }
 * 
 * POST /api/gratitude/selections/:category
 *      Body: { userId: string, item: { id, text } }
 *      Returns: { selection: { id, userId, item, datetime } }
 *      Side effect: Removes item from options (transfer semantics)
 * 
 * DELETE /api/gratitude/selections/:category/:selectionId
 *      Returns: { removed: { ... } }
 * 
 * POST /api/gratitude/discarded/:category
 *      Body: { item: { id, text } }
 *      Returns: { item: { ... } }
 *      Side effect: Removes item from options
 * 
 * ============================================================================
 */

const gratitudeRouter = express.Router();

// Helpers for externalized YAML-backed data
const CATEGORIES = ['gratitude', 'hopes'];
const isValidCategory = (c) => CATEGORIES.includes(String(c || '').toLowerCase());

/**
 * Get household ID from request or default
 */
const getHouseholdId = (req) => req.query.household || configService.getDefaultHouseholdId();

/**
 * Read array from household shared path
 */
const readHouseholdArray = (householdId, key) => {
    const data = userDataService.readHouseholdSharedData(householdId, `gratitude/${key}`);
    return Array.isArray(data) ? data : [];
};

/**
 * Write array to household shared path
 */
const writeHouseholdArray = (householdId, key, arr) => {
    const data = Array.isArray(arr) ? arr : [];
    userDataService.writeHouseholdSharedData(householdId, `gratitude/${key}`, data);
};

// Helper for loading legacy paths that don't need household context
const readArray = (key) => {
    const hid = configService.getDefaultHouseholdId();
    return readHouseholdArray(hid, key.replace('gratitude/', ''));
};

/**
 * Get users from household.yml instead of legacy users.yaml
 * Returns array of user objects with username, displayName, and group_label
 */
const getHouseholdUsers = (householdId) => {
  const hid = householdId || configService.getDefaultHouseholdId();
  const usernames = configService.getHouseholdUsers(hid);
  
  return usernames.map(username => {
    const profile = configService.getUserProfile(username);
    return {
      id: username,
      name: profile?.display_name || profile?.name || username.charAt(0).toUpperCase() + username.slice(1),
      group_label: profile?.group_label || null, // For display in group contexts
    };
  });
};

// Legacy getUsers still reads from gratitude/users.yaml for backwards compatibility
const getUsers = (hid) => readHouseholdArray(hid, 'users');
const setUsers = (hid, arr) => writeHouseholdArray(hid, 'users', arr);

const getOptions = (hid, category) => readHouseholdArray(hid, `options.${category}`);
const setOptions = (hid, category, arr) => writeHouseholdArray(hid, `options.${category}`, arr);

// Selections and discarded are now household-scoped too
const getSelections = (category, hid = null) => {
    const householdId = hid || configService.getDefaultHouseholdId();
    return readHouseholdArray(householdId, `selections.${category}`);
};
const setSelections = (category, arr, hid = null) => {
    const householdId = hid || configService.getDefaultHouseholdId();
    writeHouseholdArray(householdId, `selections.${category}`, Array.isArray(arr) ? arr : []);
};

const getDiscarded = (category, hid = null) => {
    const householdId = hid || configService.getDefaultHouseholdId();
    return readHouseholdArray(householdId, `discarded.${category}`);
};
const setDiscarded = (category, arr, hid = null) => {
    const householdId = hid || configService.getDefaultHouseholdId();
    writeHouseholdArray(householdId, `discarded.${category}`, Array.isArray(arr) ? arr : []);
};

/**
 * Fisher-Yates shuffle for randomizing arrays
 * @param {Array} array - Array to shuffle
 * @returns {Array} New shuffled array
 */
const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

// Users - now household-scoped
gratitudeRouter.get('/users', (req, res) => {
    const hid = getHouseholdId(req);
    res.json({ users: getUsers(hid), _household: hid });
});

// Options - now household-scoped (randomized)
gratitudeRouter.get('/options', (req, res) => {
    const hid = getHouseholdId(req);
    res.json({ 
        options: {
            gratitude: shuffleArray(getOptions(hid, 'gratitude')),
            hopes: shuffleArray(getOptions(hid, 'hopes'))
        },
        _household: hid
    });
});

gratitudeRouter.get('/options/:category', (req, res) => {
    const hid = getHouseholdId(req);
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: shuffleArray(getOptions(hid, category)), _household: hid });
});

// Selections (CRUD) - global but will filter/write by userId
// GET selections for a category
gratitudeRouter.get('/selections/:category', (req, res) => {
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: getSelections(category) });
});

// POST create selection: body { userId, item: { id, text } }
gratitudeRouter.post('/selections/:category', (req, res) => {
    const hid = getHouseholdId(req);
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    const { userId, item } = req.body || {};
    if (!userId || !item || typeof item.id === 'undefined') {
        return res.status(400).json({ error: 'Missing userId or item' });
    }

    const selections = getSelections(category);
    const already = selections.find((s) => s.item?.id === item.id && s.userId === userId);
    if (already) return res.status(409).json({ error: 'Item already selected for this user' });

    const entry = {
        id: uuidv4(), // selection entry id
        userId,
        item,
        datetime: moment().tz(configService.getHouseholdTimezone(hid)).toISOString(),
    };
    const updatedSelections = [entry, ...selections];
    setSelections(category, updatedSelections);

    // Remove from options if exists (transfer semantics) - household-scoped
    const opts = getOptions(hid, category);
    const newOpts = opts.filter((o) => o.id !== item.id);
    if (newOpts.length !== opts.length) setOptions(hid, category, newOpts);

    // Also remove from discarded if it was there (user changed their mind)
    const discarded = getDiscarded(category, hid);
    const newDiscarded = discarded.filter((d) => d.id !== item.id);
    if (newDiscarded.length !== discarded.length) setDiscarded(category, newDiscarded, hid);

    res.status(201).json({ selection: entry });
});

// DELETE a selection by selection id (not item id)
gratitudeRouter.delete('/selections/:category/:selectionId', (req, res) => {
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    const { selectionId } = req.params;
    const selections = getSelections(category);
    const index = selections.findIndex((s) => s.id === selectionId);
    if (index === -1) return res.status(404).json({ error: 'Selection not found' });
    const [removed] = selections.splice(index, 1);
    setSelections(category, selections);
    res.json({ removed });
});

// Discarded
gratitudeRouter.get('/discarded/:category', (req, res) => {
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: getDiscarded(category) });
});

// POST discard an option item: body { item: { id, text } }
gratitudeRouter.post('/discarded/:category', (req, res) => {
    const hid = getHouseholdId(req);
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    const { item } = req.body || {};
    if (!item || typeof item.id === 'undefined') {
        return res.status(400).json({ error: 'Missing item' });
    }
    const discarded = getDiscarded(category);
    const exists = discarded.find((d) => d.id === item.id);
    if (!exists) {
        discarded.unshift(item);
        setDiscarded(category, discarded);
    }
    // Remove from options if exists - household-scoped
    const opts = getOptions(hid, category);
    const newOpts = opts.filter((o) => o.id !== item.id);
    if (newOpts.length !== opts.length) setOptions(hid, category, newOpts);
    res.status(201).json({ item });
});

// Bootstrap endpoint to fetch everything at once - now household-aware
gratitudeRouter.get('/bootstrap', (req, res) => {
    const hid = getHouseholdId(req);
    
    // Use household.yml users, fall back to legacy users.yaml if empty
    let users = getHouseholdUsers(hid);
    if (!users || users.length === 0) {
        users = getUsers(hid);
    }
    
    res.json({
        users,
        options: {
            gratitude: shuffleArray(getOptions(hid, 'gratitude')),
            hopes: shuffleArray(getOptions(hid, 'hopes')),
        },
        selections: {
            gratitude: getSelections('gratitude'),
            hopes: getSelections('hopes'),
        },
        discarded: {
            gratitude: getDiscarded('gratitude'),
            hopes: getDiscarded('hopes'),
        },
        _household: hid,
    });
});

// Snapshot utilities - now household-scoped
const getSnapshotDir = (householdId) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    return userDataService.getHouseholdSharedPath(hid, 'gratitude/snapshots');
};

const ensureSnapshotDir = (householdId) => {
    const dir = getSnapshotDir(householdId);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};

const makeSnapshotPayload = (householdId) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    return {
        id: uuidv4(),
        householdId: hid,
        createdAt: new Date().toISOString(),
        users: getUsers(hid),
        options: {
            gratitude: getOptions(hid, 'gratitude'),
            hopes: getOptions(hid, 'hopes'),
        },
        selections: {
            gratitude: getSelections('gratitude'),
            hopes: getSelections('hopes'),
        },
        discarded: {
            gratitude: getDiscarded('gratitude'),
            hopes: getDiscarded('hopes'),
        },
    };
};

// POST /snapshot/save -> save snapshot file (household-scoped)
gratitudeRouter.post('/snapshot/save', (req, res) => {
    try {
        const hid = getHouseholdId(req);
        const snapshotDir = ensureSnapshotDir(hid);
        if (!snapshotDir) {
            return res.status(500).json({ error: 'Failed to resolve snapshot directory' });
        }
        const snap = makeSnapshotPayload(hid);
        const stamp = moment().format('YYYYMMDD_HHmmss');
        const filename = `${stamp}_${snap.id}.yml`;
        const filePath = path.join(snapshotDir, filename);
        fs.writeFileSync(filePath, require('js-yaml').dump(snap), 'utf8');
        res.status(201).json({ id: snap.id, createdAt: snap.createdAt, file: filename, _household: hid });
    } catch (e) {
        console.error('Failed to save snapshot:', e);
        res.status(500).json({ error: 'Failed to save snapshot' });
    }
});

// GET /snapshot/list -> return list of available snapshots (household-scoped)
gratitudeRouter.get('/snapshot/list', (req, res) => {
    try {
        const hid = getHouseholdId(req);
        const snapshotDir = ensureSnapshotDir(hid);
        if (!snapshotDir || !fs.existsSync(snapshotDir)) {
            return res.json({ snapshots: [], _household: hid });
        }
        const files = fs.readdirSync(snapshotDir).filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('._'));
        const yaml = require('js-yaml');
        const snapshots = files.map(f => {
            try {
                const raw = fs.readFileSync(path.join(snapshotDir, f), 'utf8');
                const data = yaml.load(raw) || {};
                return {
                    file: f,
                    id: data.id || f.split('_').slice(1).join('_').replace(/\.(yml|yaml)$/, ''),
                    createdAt: data.createdAt || null,
                    name: f.replace(/\.(yml|yaml)$/, ''),
                };
            } catch {
                return { file: f, id: null, createdAt: null, name: f.replace(/\.(yml|yaml)$/, '') };
            }
        }).sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first by filename stamp
        res.json({ snapshots, _household: hid });
    } catch (e) {
        console.error('Failed to list snapshots:', e);
        res.status(500).json({ error: 'Failed to list snapshots' });
    }
});

// POST /snapshot/restore -> restore a snapshot by id or latest (household-scoped)
// body: { id?: string, name?: string }
gratitudeRouter.post('/snapshot/restore', (req, res) => {
    try {
        const hid = getHouseholdId(req);
        const snapshotDir = ensureSnapshotDir(hid);
        if (!snapshotDir || !fs.existsSync(snapshotDir)) {
            return res.status(404).json({ error: 'No snapshots available' });
        }
        const files = fs.readdirSync(snapshotDir).filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('._'));
        if (files.length === 0) return res.status(404).json({ error: 'No snapshots available' });

        let file = null;
        const { id, name } = req.body || {};
        if (name && files.includes(name)) {
            file = name;
        } else if (id) {
            file = files.find(f => f.includes(id));
        }
        // default to latest (sorted by filename timestamp desc)
        if (!file) file = files.sort().reverse()[0];

        const yaml = require('js-yaml');
        const raw = fs.readFileSync(path.join(snapshotDir, file), 'utf8');
        const snap = yaml.load(raw);
        if (!snap) return res.status(400).json({ error: 'Invalid snapshot file' });

        // Restore all data - options to household, selections/discarded globally
        setUsers(hid, snap.users || []);
        setOptions(hid, 'gratitude', snap.options?.gratitude || []);
        setOptions(hid, 'hopes', snap.options?.hopes || []);
        setSelections('gratitude', snap.selections?.gratitude || []);
        setSelections('hopes', snap.selections?.hopes || []);
        setDiscarded('gratitude', snap.discarded?.gratitude || []);
        setDiscarded('hopes', snap.discarded?.hopes || []);

        res.json({ restored: file, id: snap.id || null, createdAt: snap.createdAt || null, _household: hid });
    } catch (e) {
        console.error('Failed to restore snapshot:', e);
        res.status(500).json({ error: 'Failed to restore snapshot' });
    }
});

// Route to send a new gratitude/desire item via WebSocket
// Usage: GET /api/gratitude/new?text=My custom gratitude item
gratitudeRouter.get('/new', (req, res) => {
    try {
        const { text } = req.query;
        
        if (!text) {
            return res.status(400).json({ 
                error: 'Missing required parameter: text' 
            });
        }

        // Create item object with unique ID and user input text
        const itemData = {
            id: Date.now(), // Use timestamp as unique ID
            text: text.trim()
        };

        // Create WebSocket payload
        const payload = {
            topic: 'gratitude',
            item: itemData,
            timestamp: new Date().toISOString(),
            type: 'gratitude_item',
            isCustom: true // Flag to indicate this is a custom user input
        };

        // Broadcast to WebSocket clients
        broadcastToWebsockets(payload);

        res.json({ 
            status: 'success',
            message: 'Custom item sent to gratitude selector',
            item: itemData,
            payload
        });
    } catch (error) {
        console.error('Error sending gratitude item:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

/**
 * Resolve display name for a user
 * Priority: group_label > display_name > name > capitalized username
 * @param {string} userId - Username to resolve
 * @returns {string} Display name
 */
function resolveDisplayName(userId) {
    if (!userId) return 'Unknown';
    const profile = configService.getUserProfile(userId);
    return profile?.group_label 
        || profile?.display_name 
        || profile?.name 
        || userId.charAt(0).toUpperCase() + userId.slice(1);
}

/**
 * Get selections formatted for printing with user display names
 * Returns enriched selection objects with displayName and printCount
 * @returns {{ gratitude: SelectionForPrint[], hopes: SelectionForPrint[] }}
 */
export function getSelectionsForPrint() {
    const categories = ['gratitude', 'hopes'];
    const result = {};
    
    for (const category of categories) {
        const selections = getSelections(category);
        
        result[category] = selections.map(selection => ({
            id: selection.id,
            userId: selection.userId,
            displayName: resolveDisplayName(selection.userId),
            item: selection.item,
            datetime: selection.datetime,
            printCount: Array.isArray(selection.printed) ? selection.printed.length : 0
        }));
    }
    
    return result;
}

/**
 * Mark selections as printed by appending timestamp to their printed array
 * @param {string} category - 'gratitude' or 'hopes'
 * @param {string[]} selectionIds - Array of selection entry IDs to mark
 */
export function markSelectionsAsPrinted(category, selectionIds) {
    if (!['gratitude', 'hopes'].includes(category)) {
        gratitudeLogger.warn('gratitude.mark_printed.invalid_category', { category });
        return;
    }
    
    if (!Array.isArray(selectionIds) || selectionIds.length === 0) {
        return;
    }
    
    const selections = getSelections(category);
    const timestamp = new Date().toISOString();
    let modified = false;
    
    for (const selection of selections) {
        if (selectionIds.includes(selection.id)) {
            if (!Array.isArray(selection.printed)) {
                selection.printed = [];
            }
            selection.printed.push(timestamp);
            modified = true;
        }
    }
    
    if (modified) {
        setSelections(category, selections);
    }
}

/**
 * Generate Prayer Card canvas image (preview only - never marks items)
 * GET /api/gratitude/card - Returns PNG image
 * Query params:
 *   - upsidedown: 'true' to flip for mounted printer
 */
gratitudeRouter.get('/card', async (req, res) => {
    try {
        // Dynamically import canvas function to avoid circular dependency
        const { createCanvasTypographyDemo } = await import('./printer.mjs');
        
        const upsidedown = req.query.upsidedown === 'true';
        const { canvas } = await createCanvasTypographyDemo(upsidedown);
        
        // Convert to PNG buffer
        const buffer = canvas.toBuffer('image/png');
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', 'inline; filename="prayer-card.png"');
        res.send(buffer);
        
    } catch (error) {
        console.error('Prayer card generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate Prayer Card and print to thermal printer
 * Only marks items as printed if print succeeds
 * GET /api/gratitude/card/print
 * Query params:
 *   - upsidedown: 'true' to flip for mounted printer (default: true for print)
 */
gratitudeRouter.get('/card/print', async (req, res) => {
    try {
        const { createCanvasTypographyDemo } = await import('./printer.mjs');
        const { thermalPrint, createImagePrint } = await import('../lib/thermalprint.mjs');
        const fs = await import('fs');
        
        // 1. Generate canvas (default upside down for printer)
        const upsidedown = req.query.upsidedown !== 'false'; // default true
        const { canvas, width, height, selectedIds } = await createCanvasTypographyDemo(upsidedown);
        
        // 2. Save to temp file
        const buffer = canvas.toBuffer('image/png');
        const tempPath = `/tmp/prayer_card_${Date.now()}.png`;
        fs.writeFileSync(tempPath, buffer);
        
        // 3. Create print job
        const printJob = createImagePrint(tempPath, {
            width,
            height,
            align: 'left',
            threshold: 128
        });
        
        // 4. Send to printer and wait for result
        const success = await thermalPrint(printJob);
        
        // 5. Clean up temp file
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        
        // 6. Only mark as printed if print succeeded
        const printed = { gratitude: [], hopes: [] };
        
        if (success && selectedIds) {
            if (selectedIds.gratitude?.length > 0) {
                markSelectionsAsPrinted('gratitude', selectedIds.gratitude);
                printed.gratitude = selectedIds.gratitude;
            }
            if (selectedIds.hopes?.length > 0) {
                markSelectionsAsPrinted('hopes', selectedIds.hopes);
                printed.hopes = selectedIds.hopes;
            }
        }
        
        // 7. Return result
        res.json({
            success,
            message: success ? 'Prayer card printed successfully' : 'Print failed',
            printed,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Prayer card print error:', error);
        res.status(500).json({
            success: false,
            message: 'Print error',
            error: error.message,
            printed: { gratitude: [], hopes: [] }
        });
    }
});

export default gratitudeRouter;
