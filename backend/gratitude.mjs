import express from 'express';
import fs from 'fs';
import { loadFile, saveFile } from './lib/io.mjs';
import { broadcastToWebsockets } from './websocket.js';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';

const gratitudeRouter = express.Router();

// Helpers for externalized YAML-backed data
const CATEGORIES = ['gratitude', 'hopes'];
const isValidCategory = (c) => CATEGORIES.includes(String(c || '').toLowerCase());

const readArray = (key) => {
    const data = loadFile(key);
    return Array.isArray(data) ? data : [];
};

const getUsers = () => readArray('gratitude/users');
const setUsers = (arr) => saveFile('gratitude/users', Array.isArray(arr) ? arr : []);

const getOptions = (category) => readArray(`gratitude/options.${category}`);
const setOptions = (category, arr) => saveFile(`gratitude/options.${category}`, Array.isArray(arr) ? arr : []);

const getSelections = (category) => readArray(`gratitude/selections.${category}`);
const setSelections = (category, arr) => saveFile(`gratitude/selections.${category}`, Array.isArray(arr) ? arr : []);

const getDiscarded = (category) => readArray(`gratitude/discarded.${category}`);
const setDiscarded = (category, arr) => saveFile(`gratitude/discarded.${category}`, Array.isArray(arr) ? arr : []);

// Users
gratitudeRouter.get('/users', (req, res) => {
    res.json({ users: getUsers() });
});

// Options
gratitudeRouter.get('/options', (req, res) => {
    res.json({ options: {
        gratitude: getOptions('gratitude'),
        hopes: getOptions('hopes')
    }});
});

gratitudeRouter.get('/options/:category', (req, res) => {
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: getOptions(category) });
});

// Selections (CRUD)
// GET selections for a category
gratitudeRouter.get('/selections/:category', (req, res) => {
    const category = String(req.params.category || '').toLowerCase();
    if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    res.json({ items: getSelections(category) });
});

// POST create selection: body { userId, item: { id, text } }
gratitudeRouter.post('/selections/:category', (req, res) => {
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

    // Remove from options if exists (transfer semantics)
    const opts = getOptions(category);
    const newOpts = opts.filter((o) => o.id !== item.id);
    if (newOpts.length !== opts.length) setOptions(category, newOpts);

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
    // Remove from options if exists
    const opts = getOptions(category);
    const newOpts = opts.filter((o) => o.id !== item.id);
    if (newOpts.length !== opts.length) setOptions(category, newOpts);
    res.status(201).json({ item });
});

// Bootstrap endpoint to fetch everything at once
gratitudeRouter.get('/bootstrap', (req, res) => {
    res.json({
        users: getUsers(),
        options: {
            gratitude: getOptions('gratitude'),
            hopes: getOptions('hopes'),
        },
        selections: {
            gratitude: getSelections('gratitude'),
            hopes: getSelections('hopes'),
        },
        discarded: {
            gratitude: getDiscarded('gratitude'),
            hopes: getDiscarded('hopes'),
        },
    });
});

// Snapshot utilities
const SNAPSHOT_DIR = 'gratitude/snapshots';
const ensureSnapshotDir = () => {
    const abs = `${process.env.path.data}/${SNAPSHOT_DIR}`;
    if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
};

const makeSnapshotPayload = () => ({
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    users: getUsers(),
    options: {
        gratitude: getOptions('gratitude'),
        hopes: getOptions('hopes'),
    },
    selections: {
        gratitude: getSelections('gratitude'),
        hopes: getSelections('hopes'),
    },
    discarded: {
        gratitude: getDiscarded('gratitude'),
        hopes: getDiscarded('hopes'),
    },
});

// POST /snapshot/save -> save snapshot file
gratitudeRouter.post('/snapshot/save', (req, res) => {
    try {
        ensureSnapshotDir();
        const snap = makeSnapshotPayload();
        const stamp = moment().format('YYYYMMDD_HHmmss');
        const fileKey = `${SNAPSHOT_DIR}/${stamp}_${snap.id}`; // no .yaml for saveFile (it adds)
        saveFile(fileKey, snap);
        res.status(201).json({ id: snap.id, createdAt: snap.createdAt, file: `${fileKey}.yaml` });
    } catch (e) {
        console.error('Failed to save snapshot:', e);
        res.status(500).json({ error: 'Failed to save snapshot' });
    }
});

// GET /snapshot/list -> return list of available snapshots
gratitudeRouter.get('/snapshot/list', (req, res) => {
    try {
        ensureSnapshotDir();
        const dir = `${process.env.path.data}/${SNAPSHOT_DIR}`;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') && !f.startsWith('._'));
        const snapshots = files.map(f => {
            // Try to read createdAt, id from file; fallback to filename
            const data = loadFile(`${SNAPSHOT_DIR}/${f.replace(/\.yaml$/, '')}`) || {};
            return {
                file: f,
                id: data.id || f.split('_').slice(1).join('_').replace(/\.yaml$/, ''),
                createdAt: data.createdAt || null,
                name: f.replace(/\.yaml$/, ''),
            };
        }).sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first by filename stamp
        res.json({ snapshots });
    } catch (e) {
        console.error('Failed to list snapshots:', e);
        res.status(500).json({ error: 'Failed to list snapshots' });
    }
});

// POST /snapshot/restore -> restore a snapshot by id or latest
// body: { id?: string, name?: string }
gratitudeRouter.post('/snapshot/restore', (req, res) => {
    try {
        ensureSnapshotDir();
        const dir = `${process.env.path.data}/${SNAPSHOT_DIR}`;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') && !f.startsWith('._'));
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

        const snap = loadFile(`${SNAPSHOT_DIR}/${file.replace(/\.yaml$/, '')}`);
        if (!snap) return res.status(400).json({ error: 'Invalid snapshot file' });

        // Restore all data
        setUsers(snap.users || []);
        setOptions('gratitude', snap.options?.gratitude || []);
        setOptions('hopes', snap.options?.hopes || []);
        setSelections('gratitude', snap.selections?.gratitude || []);
        setSelections('hopes', snap.selections?.hopes || []);
        setDiscarded('gratitude', snap.discarded?.gratitude || []);
        setDiscarded('hopes', snap.discarded?.hopes || []);

        res.json({ restored: file, id: snap.id || null, createdAt: snap.createdAt || null });
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
