import express from 'express';
import fs from 'fs';
import path from 'path';
import { loadFile, saveFile } from './lib/io.mjs';
import { configService } from './lib/config/ConfigService.mjs';
import { userDataService } from './lib/config/UserDataService.mjs';
import { broadcastToWebsockets } from './websocket.js';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';

const gratitudeRouter = express.Router();

// Helpers for externalized YAML-backed data
const CATEGORIES = ['gratitude', 'hopes'];
const isValidCategory = (c) => CATEGORIES.includes(String(c || '').toLowerCase());

/**
 * Get household ID from request or default
 */
const getHouseholdId = (req) => req.query.household || configService.getDefaultHouseholdId();

/**
 * Read array from household shared path with legacy fallback
 */
const readHouseholdArray = (householdId, key) => {
    // Try household path first
    const data = userDataService.readHouseholdSharedData(householdId, `gratitude/${key}`);
    if (data !== null) {
        return Array.isArray(data) ? data : [];
    }
    // Fallback to legacy
    const legacyData = loadFile(`gratitude/${key}`);
    return Array.isArray(legacyData) ? legacyData : [];
};

/**
 * Write array to household shared path (also writes to legacy for now)
 */
const writeHouseholdArray = (householdId, key, arr) => {
    const data = Array.isArray(arr) ? arr : [];
    // Write to household path
    userDataService.writeHouseholdSharedData(householdId, `gratitude/${key}`, data);
    // Also write to legacy path during migration
    saveFile(`gratitude/${key}`, data);
};

// Legacy helpers (for backwards compatibility during migration)
const readArray = (key) => {
    const data = loadFile(key);
    return Array.isArray(data) ? data : [];
};

const getUsers = (hid) => readHouseholdArray(hid, 'users');
const setUsers = (hid, arr) => writeHouseholdArray(hid, 'users', arr);

const getOptions = (hid, category) => readHouseholdArray(hid, `options.${category}`);
const setOptions = (hid, category, arr) => writeHouseholdArray(hid, `options.${category}`, arr);

// Selections and discarded stay global for now (contain userId field)
const getSelections = (category) => readArray(`gratitude/selections.${category}`);
const setSelections = (category, arr) => saveFile(`gratitude/selections.${category}`, Array.isArray(arr) ? arr : []);

const getDiscarded = (category) => readArray(`gratitude/discarded.${category}`);
const setDiscarded = (category, arr) => saveFile(`gratitude/discarded.${category}`, Array.isArray(arr) ? arr : []);

// Users - now household-scoped
gratitudeRouter.get('/users', (req, res) => {
    const hid = getHouseholdId(req);
    res.json({ users: getUsers(hid), _household: hid });
});

// Options - now household-scoped
gratitudeRouter.get('/options', (req, res) => {
    const hid = getHouseholdId(req);
    res.json({ 
        options: {
            gratitude: getOptions(hid, 'gratitude'),
            hopes: getOptions(hid, 'hopes')
        },
        _household: hid
    });
});

gratitudeRouter.get('/options/:category', (req, res) => {
    const hid = getHouseholdId(req);
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: getOptions(hid, category), _household: hid });
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
        datetime: new Date().toISOString(),
    };
    const updatedSelections = [entry, ...selections];
    setSelections(category, updatedSelections);

    // Remove from options if exists (transfer semantics) - household-scoped
    const opts = getOptions(hid, category);
    const newOpts = opts.filter((o) => o.id !== item.id);
    if (newOpts.length !== opts.length) setOptions(hid, category, newOpts);

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
    res.json({
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
        const filename = `${stamp}_${snap.id}.yaml`;
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
        const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.yaml') && !f.startsWith('._'));
        const yaml = require('js-yaml');
        const snapshots = files.map(f => {
            try {
                const raw = fs.readFileSync(path.join(snapshotDir, f), 'utf8');
                const data = yaml.load(raw) || {};
                return {
                    file: f,
                    id: data.id || f.split('_').slice(1).join('_').replace(/\.yaml$/, ''),
                    createdAt: data.createdAt || null,
                    name: f.replace(/\.yaml$/, ''),
                };
            } catch {
                return { file: f, id: null, createdAt: null, name: f.replace(/\.yaml$/, '') };
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
        const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.yaml') && !f.startsWith('._'));
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

// Placeholder function for printer integration
export function getSelectionsForPrint() {
    // This function is referenced by printer.mjs
    // Return empty selections for now - can be implemented later
    return {
        gratitude: [],
        hopes: []
    };
}

export default gratitudeRouter;
