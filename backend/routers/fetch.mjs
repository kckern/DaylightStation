import express from 'express';
const apiRouter = express.Router();
import Infinity from '../lib/infinity.mjs';
import { loadFile, loadRandom, saveFile } from '../lib/io.mjs';
import { readFileSync, readdirSync } from 'fs';
import test from '../jobs/weight.mjs';
import yaml, { load } from 'js-yaml';
import moment from 'moment-timezone';
import fs from 'fs';
import { parseFile } from 'music-metadata';
import { findFileFromMediaKey, handleDevImage } from './media.mjs';
import { processListItem } from '../jobs/nav.mjs';
import {lookupReference, generateReference} from 'scripture-guide';
import { Plex } from '../lib/plex.mjs';
import { parse } from 'path';
import path from 'path';
import { isWatched, getEffectivePercent } from '../lib/utils.mjs';
import { configService } from '../lib/config/ConfigService.mjs';
import { userDataService } from '../lib/config/UserDataService.mjs';
import { createLogger } from '../lib/logging/logger.js';

const fetchLogger = createLogger({ app: 'fetch' });
const dataPath = `${process.env.path.data}`;
const mediaPath = `${process.env.path.media}`;

// Helper for household-scoped media memory paths
const getMediaMemoryPath = (category, householdId = null) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    // Try household path first, fall back to legacy
    const householdPath = userDataService.getHouseholdDir(hid);
    if (householdPath && fs.existsSync(path.join(householdPath, 'history', 'media_memory'))) {
        return `households/${hid}/history/media_memory/${category}`;
    }
    return `history/media_memory/${category}`;
};

// Helper for household-scoped menu memory path
const getMenuMemoryPath = (householdId = null) => {
    const hid = householdId || configService.getDefaultHouseholdId();
    const householdPath = userDataService.getHouseholdDir(hid);
    if (householdPath && fs.existsSync(path.join(householdPath, 'history'))) {
        return `households/${hid}/history/menu_memory`;
    }
    return `history/menu_memory`;
};

//usejson
apiRouter.use(express.json());

// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

export const findUnwatchedItems = (media_keys, category = "media", shuffle = false) => {
    const memoryPath = getMediaMemoryPath(category);
    const media_memory = loadFile(memoryPath) || {};
    const unwatchedItems = media_keys.filter(key => {
        const watchedItem = media_memory[key];
        return !isWatched(watchedItem);
    });


    // If all items are filtered out, return the whole list
    const result = unwatchedItems.length > 0 ? unwatchedItems : media_keys;

    if(unwatchedItems.length === 0) {
        clearWatchedItems(media_keys, category);
    }

    // If shuffle is true, shuffle the array
    return result.sort(() => (shuffle ? Math.random() - 0.5 : 0));
};

export const clearWatchedItems = (media_keys, category = "media") => {
    // Special handling for "plex" category - need to clear from library-specific files
    if (category === "plex") {
        return clearWatchedItemsFromPlexLibraries(media_keys);
    }
    
    // Standard behavior for non-plex categories
    const memoryPath = getMediaMemoryPath(category);
    const media_memory = loadFile(memoryPath) || {};
    for (const key of media_keys) {
        if (media_memory[key]) {
            delete media_memory[key];
        }
    }
    saveFile(memoryPath, media_memory);
    return media_memory;
}

/**
 * Clear watched items from all Plex library-specific files
 * Handles the fact that plex history is stored in subdirectories like plex/fitness, plex/movies, etc.
 * @param {Array<string>} media_keys - Array of plex IDs to clear
 * @returns {Object} Combined result of all cleared items
 */
const clearWatchedItemsFromPlexLibraries = (media_keys) => {
    const hid = configService.getDefaultHouseholdId();
    const householdDir = userDataService.getHouseholdDir(hid);
    
    // Determine the base directory for plex history files
    let plexDir;
    if (householdDir && fs.existsSync(path.join(householdDir, 'history', 'media_memory', 'plex'))) {
        plexDir = path.join(householdDir, 'history', 'media_memory', 'plex');
    } else {
        plexDir = path.join(dataPath, 'history', 'media_memory', 'plex');
    }
    
    if (!fs.existsSync(plexDir)) {
        fetchLogger.warn('fetch.plex.history_dir_not_found', { plexDir });
        return {};
    }
    
    let clearedCount = 0;
    const files = fs.readdirSync(plexDir);
    
    // Iterate through all .yml/.yaml files in the plex directory
    for (const file of files) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) {
            continue;
        }
        
        const libraryName = file.replace(/\.ya?ml$/, '');
        const memoryPath = getMediaMemoryPath(`plex/${libraryName}`);
        const media_memory = loadFile(memoryPath) || {};
        
        let modified = false;
        for (const key of media_keys) {
            if (media_memory[key]) {
                delete media_memory[key];
                modified = true;
                clearedCount++;
            }
        }
        
        // Only save if we actually modified this file
        if (modified) {
            saveFile(memoryPath, media_memory);
            console.log(`Cleared ${media_keys.length} items from plex/${libraryName}`);
        }
    }
    
    console.log(`Total cleared: ${clearedCount} items from plex libraries`);
    return { cleared: clearedCount, keys: media_keys };
}
apiRouter.get('/img/*', async (req, res, next) => {
    try {
        const imgPath = `${dataPath}/img/${req.params[0]}`;
        if (!fs.existsSync(imgPath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Determine content type based on file extension
        const ext = path.extname(imgPath).toLowerCase();
        let contentType = 'image/jpeg'; // default
        switch (ext) {
            case '.svg':
                contentType = 'image/svg+xml';
                break;
            case '.png':
                contentType = 'image/png';
                break;
            case '.gif':
                contentType = 'image/gif';
                break;
            case '.webp':
                contentType = 'image/webp';
                break;
            case '.jpg':
            case '.jpeg':
                contentType = 'image/jpeg';
                break;
        }
        
        const imgStream = fs.createReadStream(imgPath);
        res.setHeader('Content-Type', contentType);
        imgStream.pipe(res);
    } catch (err) {
        next(err);
    }
});

// Serve static images from content/img (icons, etc.)
// MOVED TO media.mjs
// apiRouter.get('/content/img/*', async (req, res, next) => { ... });

apiRouter.get('/infinity/harvest/:table_id?',  async (req, res, next) => {
    try {
        let table_id = req.params.table_id || process.env.infinity.default_table || false;
        let table_alias = table_id+"";
        table_id = process.env.infinity.tables[table_id] || table_id;
        if(!table_id) return res.status(400).json({error: 'No table_id provided'});
        let table_data = await Infinity.loadTable(table_id);
        if(!table_data) return res.status(500).send('Failed to load data from Infinity');
        res.json(table_data);
        saveFile(`infinity/${table_alias}.json`, table_data);
    } catch (err) {
        next(err);
    }
});


//talk
apiRouter.get('/talk/:talk_folder?/:talk_id?', async (req, res, next) => {

    const host = process.env.host || "";
    const { talk_folder, talk_id } = req.params;
    const filesInFolder = readdirSync(`${dataPath}/content/talks/${talk_folder || ''}`).filter(file => file.endsWith('.yaml')).map(file => file.replace('.yaml', ''));
    const [selectedFile] = findUnwatchedItems(filesInFolder, 'talk', true);
    const filePath = `${dataPath}/content/talks/${talk_folder || ''}/${talk_id || selectedFile}.yaml`;
    const talkData = yaml.load(readFileSync(filePath, 'utf8'));
    const mediaFilePath = `${mediaPath}/video/talks/${talk_folder || ''}/${talk_id || selectedFile}.mp4`;
    const mediaExists = fs.existsSync(mediaFilePath);
    const mediaUrl = mediaExists ? `${host}/media/video/talks/${talk_folder || ''}/${talk_id || selectedFile}` : null;
    delete talkData.mediaUrl;
    return res.json({
        input: talk_id || selectedFile,
        media_key: `video/talks/${talk_folder || ''}/${talk_id || selectedFile}`,
        mediaExists,
        mediaFilePath,
        mediaUrl,
        ...talkData
    });

});






//scritpures
apiRouter.get('/scripture/:first_term?/:second_term?', async (req, res, next) => {

    const volumes = {
        ot: 1,
        nt: 23146,
        bom: 31103,
        dc: 37707,
        pgp: 41361,
        lof: 41996
    }

    //Helper functions 
    const getVolume = (verse_id) => {
        const keys = Object.keys(volumes);
        const values = Object.values(volumes);

        for (let i = 0; i < values.length; i++) {
            const start = values[i];
            const end = i === values.length - 1 ? Infinity : values[i + 1] - 1;
            if (verse_id >= start && verse_id <= end) {
                return keys[i];
            }
        }
        return null;
    };

    const getVerseId = (input) => {
        const isNumber = /^\d+$/.test(input);
        const ref = isNumber ? generateReference(input) : (lookupReference(input).reference || null);
        const {verse_ids:[verse_id]} = lookupReference(input);
        return ref ? parseInt(input) : verse_id || null;
    }

    const getVersion = (volume) => {
        //list of versions in volumne folder
        const versions = readdirSync(`${dataPath}/content/scripture/${volume}`)
                            .filter(folder => fs.statSync(`${dataPath}/content/scripture/${volume}/${folder}`).isDirectory());
        return versions.length > 0 ? versions[0] : null;
    }

    const getVerseIdFromVolume = (volume, version) => {
        const chapters = readdirSync(`${dataPath}/content/scripture/${volume}/${version}`)
            .filter(file => file.endsWith('.yaml'))
            .map(file => file.replace('.yaml', ''));
        const keys = chapters.map(chapter => `${volume}/${version}/${chapter}`);
        const unseenChapters = findUnwatchedItems(keys, 'scriptures');
        const [nextUp] = unseenChapters.map(key => key.match(/(\d+)$/)[1]) || [chapters[0]] || [null];
        return nextUp;
    };


    const loadScriptureWatchlist = (watchListFolder) => {
        const watchListItems = loadFile('state/watchlist') || [];
        const filteredItems = watchListItems.filter(w => w.folder === watchListFolder);
        console.log({watchListFolder,filteredItems,watchListFolder});
        const {items:[item]} = getChildrenFromWatchlist(filteredItems);
        const [volume,version,verse_id] = (item?.plex || item?.media_key || "").split('/').filter(Boolean);
        if(!volume || !version || !verse_id) return {volume: 0, version: 0, verse_id: 0};
        return {volume, version, verse_id};
    }

    const deduceFromInput = (first_term, second_term) => {
        let volume = null;
        let version = null;
        let verse_id = null;
        const watchListKeys = Object.keys(process.env.scripture || {}) || [];
        if (first_term && second_term) {
            // Option 3: /scripture/msg/nt
            if (volumes[first_term]) {
                volume = first_term;
                version = second_term;
                verse_id = getVerseIdFromVolume(volume, version);
            } else if (volumes[second_term]) {
                // Option 4: /scripture/nt/msg
                volume = second_term;
                version = first_term;
                verse_id = getVerseIdFromVolume(volume, version);
            } else {
                // Option 5: /scripture/37707/redc
                verse_id = getVerseId(first_term) || getVerseId(second_term);
                volume = getVolume(verse_id);
                version = volumes[second_term] ? second_term : getVersion(volume);
            }
        } else if (watchListKeys.includes(first_term)) {
            const  {scripture : map} = process.env || {};
            const watchListFolder = map[first_term];
            if(!watchListFolder) return {volume: 0, version: 0, verse_id: 0};
            return loadScriptureWatchlist(watchListFolder);
        } else if (first_term) {
            verse_id = getVerseId(first_term);
            volume = volumes[first_term] ? first_term : getVolume(verse_id);
            version = getVersion(volume) || null;
            verse_id = verse_id || getVerseIdFromVolume(volume, version);
        }

        return {volume, version, verse_id};
    }

    try {
        const { first_term, second_term } = req.params;

    
        const {volume, version, verse_id} = deduceFromInput(first_term, second_term);

        if (!volume || !version || !verse_id) {
            return res.status(400).json({
            error: 'Invalid scripture reference', 
            first_term, second_term, volume, version, verse_id
            });
        }

        const filePath = `${dataPath}/content/scripture/${volume}/${version}/${verse_id}.yaml`;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
            error: 'Scripture file not found', 
            first_term, second_term, volume, version, verse_id,
            filePath
            });
        }
        const reference = generateReference(verse_id).replace(/:1$/, '');
        const host = process.env.host || "";
        const mediaFilePath = `${mediaPath}/audio/scripture/${volume}/${version}/${verse_id}.mp3`;
        const mediaExists = fs.existsSync(mediaFilePath);
        const mediaUrl = mediaExists ? `${host}/media/audio/scripture/${volume}/${version}/${verse_id}` : null;

        const data = yaml.load(readFileSync(`${dataPath}/content/scripture/${volume}/${version}/${verse_id}.yaml`, 'utf8'));
        res.json({
            input: !!first_term && !!second_term ? `${first_term}/${second_term}` : `${first_term || second_term}`,
            reference,
            volume,
            version,
            verse_id,
            mediaUrl,
            media_key: `${volume}/${version}/${verse_id}`,
            verses: data,
        });
    } catch (err) {
        next(err);
    }
});

// Unified endpoint for /hymn/:hymn_num? and /primary/:hymn_num?
apiRouter.get('/:songType(hymn|primary)/:hymn_num?', async (req, res, next) => {
    try {
        const { songType, hymn_num } = req.params;
        const preferences = ["_ldsgc", ""];
        const basePath = `content/songs/${songType}`;
        const hymnData = hymn_num ? loadFile(`${basePath}/${hymn_num}`) : loadRandom(basePath);
        const hymnNumStr = String(hymn_num || hymnData?.hymn_num || '').padStart(3, '0');
        const { mediaFilePath, mediaUrl } = preferences.reduce((result, prf) => {
            if (result) return result;
            prf = prf ? `${prf}/` : '';
            const mediaFilePath = `${mediaPath}/audio/songs/${songType}/${prf}${hymnNumStr}.mp3`;
            const host = process.env.host || "";
            try {
                if (fs.existsSync(mediaFilePath)) {
                    return {
                        mediaUrl: `${host}/media/audio/songs/${songType}/${prf}${hymnNumStr}`,
                        mediaFilePath
                    };
                }else{
                    fetchLogger.warn('fetch.song.file_not_found', { mediaFilePath });
                    return null;
                }
            } catch (err) {
                console.error(`Error checking file path: ${mediaFilePath}`, err.message);
            }
            return null;
        }, null) || {};

        if (!mediaFilePath || !mediaUrl) {
            return res.status(200).json({ ...hymnData, mediaUrl: null, duration: 0 });
        }

        const metadata = await parseFile(mediaFilePath, { native: true });
        const duration = parseInt(metadata?.format?.duration) || 0;

        res.json({ ...hymnData, mediaUrl, duration });
    } catch (err) {
        next(err);
    }
});

apiRouter.get('/budget',  async (req, res, next) => {
    try {
        const finances = yaml.load(readFileSync(`${dataPath}/households/default/apps/finances/finances.yml`, 'utf8'));
        res.json(finances);
    } catch (err) {
        next(err);
    }
});
apiRouter.get('/budget/daytoday',  async (req, res, next) => {
    try {
        const {budgets} = yaml.load(readFileSync(`${dataPath}/households/default/apps/finances/finances.yml`, 'utf8'));
        const dates = Object.keys(budgets);
        const latestDate = dates.sort((a, b) => moment(b).diff(moment(a)))[0];
        const {dayToDayBudget} = budgets[latestDate];
        const months = Object.keys(dayToDayBudget);
        const thisMonth = moment().format('YYYY-MM');
        const latestMonth = months.sort((a, b) => moment(b).diff(moment(a))).filter(m => m <= thisMonth)[0];
        //console.log({dayToDayBudget,latestDate,latestMonth});
        const budgetData = dayToDayBudget[latestMonth];
        delete budgetData.transactions;
        res.json(budgetData);
    } catch (err) {
        next(err);
    }
});



apiRouter.post('/menu_log', async (req, res) => {
    const postData = req.body;
    const { media_key } = postData;
    const menuPath = getMenuMemoryPath();
    const menu_log = loadFile(menuPath) || {};
    const nowUnix = moment().unix();
    menu_log[media_key] = nowUnix;
    saveFile(menuPath, menu_log);
    res.json({[media_key]: nowUnix} );
});

export const loadMetadataFromFile = async ({media_key}) => {
    if(!media_key) return null;
    media_key = media_key.replace(/\.[^/.]+$/, ""); // Remove the file extension
    const keepTags = ['title', 'artist', 'album', 'year', 'track', 'genre'];
    const {path} = findFileFromMediaKey(media_key);
    let tags = {};
    try {
        tags = (await parseFile(path, { native: true })).common || {};
    } catch (err) {
        console.error(`Error parsing file metadata for ${path}:`, err.message);
        return {media_key};
    }
    const fileTags = keepTags.reduce((acc, tag) => {
        if (tags[tag] && typeof tags[tag] === 'object' && 'no' in tags[tag]) {
            acc[tag] = tags[tag].no;
        } else if (tags[tag]) {
            acc[tag] = Array.isArray(tags[tag]) ? tags[tag].join(', ') : tags[tag];
        }
        if (!acc[tag]) delete acc[tag];
        return acc;
    }, {});
    const host = process.env.host || "";
    const media_url = `${host}/media/${media_key}`;
    const ext = path.split('.').pop();
    const media_type = ["mp3", "m4a"].includes(ext) ? "audio" : "video";
    const defaultTags = {
        label: media_key,
        play: { media: media_key },
    };
    const result = {  media_key, ...defaultTags,...fileTags, media_type,media_url };
    if (tags.picture) {
        result.image = `${host}/media/img/${media_key}`;
    }

    return result;
}

const loadMetadataFromConfig =  (item, keys=[]) => {
    const {media_key} = item || {};
    if(!media_key) return item;
    const config = loadMetadataFromMediaKey(media_key);
    if(keys?.length > 0) {
        let keyed = {};
        for (const key of keys) {
            if (item[key] !== undefined) {
                keyed[key] = item[key];
            }
        }
        return {...item, ...keyed};
    }
    return {...item, ...config};
}

export const loadMetadataFromMediaKey = (media_key, keys = []) => {
    const mediaConfig = loadFile(`state/media_config`);
    const config = mediaConfig.find(c => c.media_key === media_key) || {};

    if (keys.length > 0) {
        let filteredConfig = {};
        for (const key of keys) {
            if (config[key] !== undefined) {
                filteredConfig[key] = config[key];
            }
        }
        return filteredConfig;
    }
    config.label = config.label || config.title || media_key;
    return config;
};

const applyParentTags = (items, parent) => {

    const inheritableTags = ['volume', 'shuffle', 'continuous', 'image', 'rate', 'playbackrate'];
    for (const tag of inheritableTags) {
        for(const item of items) {
            if (item[tag] === undefined && parent[tag] !== undefined) {
                item[tag] = parent[tag];
            }
        }
    }
    return items;

}

const sortListByMenuMemory = (items, config) => {
    const sortByMenu = /recent_on_top/i.test(config);
    if (!sortByMenu) return items;
    const menuLog = loadFile(getMenuMemoryPath()) || {};
    items.sort((a, b) => {
        const aKey = (() => {
            const mediaKey = a?.play || a?.queue || a?.list || a?.open;
            if (!mediaKey) return null;
            return Array.isArray(mediaKey) ? mediaKey[0] : Object.values(mediaKey)?.length ? Object.values(mediaKey)[0] : null;
        })();

        const bKey = (() => {
            const mediaKey = b?.play || b?.queue || b?.list || b?.open;
            if (!mediaKey) return null;
            return Array.isArray(mediaKey) ? mediaKey[0] : Object.values(mediaKey)?.length ? Object.values(mediaKey)[0] : null;
        })();

        const aTime = menuLog[aKey] || 0;
        const bTime = menuLog[bKey] || 0;
        return bTime - aTime; // Sort by most recent first
    });
    return items;
}

export const getChildrenFromWatchlist =  (watchListItems, ignoreSkips=false, ignoreWatchStatus=false, ignoreWait=false) => {
    let candidates = { normal: {}, urgent: {}, in_progress: {} };
    for (let item of watchListItems) {
        let {media_key, src, percent: itemProgress, watched, hold, skip_after, wait_until, title, program} = item;
        const memoryPath = getMediaMemoryPath(src);
        const log = loadFile(memoryPath) || {};
        const percent = log[media_key]?.percent || itemProgress || 0;
        const seconds = log[media_key]?.seconds || 0;

        const usepercent = getEffectivePercent(percent);
        if (isWatched(usepercent) && !ignoreWatchStatus) continue; // Skip if watched more than 90%
        if (item.watched && !ignoreWatchStatus) continue; // Skip if marked as watched
        if (item.hold) continue; // Skip if on hold
        if (!ignoreSkips && item.skip_after && moment(item.skip_after).isBefore(moment())) continue; // Skip if past the skip_after date
        if (!ignoreWait && item.wait_until && moment(item.wait_until).isAfter(moment().add(2, 'days'))) continue; // Skip if wait_until is more than 2 days away

        let priority = item.priority || "medium"; // Default to normal priority
        if (item.skip_after) {
            let skipAfter = new Date(item.skip_after);
            let eightDays = new Date();
            eightDays.setDate(eightDays.getDate() + 8);
            if (!ignoreSkips && skipAfter <= eightDays) priority = "urgent"; // Mark as urgent if skip_after is within 8 days
        }
        if (percent > 0) priority = "in_progress"; // Mark as in_progress if partially watched
        candidates[priority] ||= {};
        candidates[priority][program] ||= [];
        candidates[priority][program].push([media_key, title, program, percent, seconds]);
    }

    const items = Object.entries(candidates).reduce((acc, [key, value]) => {
        const items = Object.entries(value).reduce((acc, [program, items]) => {
            const itemList = Object.entries(items).map(([index, [media_key, title, program, percent, seconds]]) => {
                const result = { plex: media_key, title, program };
                if (percent > 0) {
                    result.percent = percent;
                    result.seconds = seconds;
                }
                result.priority = key; // Add priority to the result
                return result;
            });
            return [...acc, ...itemList];
        }, []);
        return [...acc, ...items];
    }, []);

    const count = items.length;
    if (count === 0 && !ignoreSkips) return getChildrenFromWatchlist(watchListItems, true);
    if (count === 0 && ignoreSkips && !ignoreWatchStatus) return getChildrenFromWatchlist(watchListItems, true, true);
    if (count === 0 && ignoreSkips && ignoreWatchStatus && !ignoreWait) return getChildrenFromWatchlist(watchListItems, true, true, true);

    const sortedItems = items.sort((a, b) => {
        // Sort by wait_until, later dates first
        const aWaitUntil = watchListItems.find(w => w.media_key === a.plex)?.wait_until || null;
        const bWaitUntil = watchListItems.find(w => w.media_key === b.plex)?.wait_until || null;
        if (aWaitUntil && bWaitUntil) {
            return moment(bWaitUntil).diff(moment(aWaitUntil));
        }
        return 0;
    }).sort((a, b) => {
        const priorityOrder = ['in_progress', 'urgent', 'high', 'medium', 'low'];
        const priorityA = priorityOrder.indexOf((a.priority || '').toLowerCase());
        const priorityB = priorityOrder.indexOf((b.priority || '').toLowerCase());

        if (priorityA !== priorityB) {
            return priorityA - priorityB; // Sort by priority
        }

        if (a.priority?.toLowerCase() === 'in_progress' && b.priority?.toLowerCase() === 'in_progress') {
            return b.percent - a.percent; // Sort by percent for in_progress
        }

        return 0; // Keep original order for items with the same priority
    });

    return { items:sortedItems };
};


export const watchListFromMediaKey = (media_key) => {

    const normalizeKey = key => key?.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const watchListItems = (loadFile('state/watchlist')||[]).filter(w => normalizeKey(w.folder) === normalizeKey(media_key));
    if (!watchListItems?.length) return null;
    return watchListItems;
}


// Helper function to get children from a parent media_key
export const getChildrenFromMediaKey = async ({media_key, config, req}) => {
    const validExtensions = ['.mp3', '.mp4', '.m4a'];

    const mustBePlayable = /playable/.test(config);
    const shuffle = /shuffle/.test(config);
    const watchListItems = watchListFromMediaKey(media_key);
    if(watchListItems?.length) return  getChildrenFromWatchlist(watchListItems);

    // Check if the media_key exists in the lists first
    const listItems = await Promise.all(loadFile(`state/lists`).map(processListItem));
    const filterFn = item => item?.folder?.toLowerCase() === media_key?.toLowerCase();
    const itemsFromList = listItems.filter(filterFn) || [];
    const noSort = itemsFromList.some(item => item?.folder_color);  // Color is used as an indicator for no sorting, since folders have no other attributes besides title
    if (!!itemsFromList.length) return { items: applyParamsToItems(noSort ? itemsFromList : sortListByMenuMemory(itemsFromList,config)) };

    // If no list items, check if it's a Plex key
    const isPlex = /^\d+$/.test(media_key);
    if (isPlex) {
        const PLEX = new Plex();
        const plexResponse = await PLEX.loadChildrenFromKey(media_key, mustBePlayable);
        const plexList = plexResponse?.list.map(({ plex, title, type, image }) => {
            let action = "play";
            if (["show", "season"].includes(type)) action = "list";
            if (["album"].includes(type)) action = "queue";
            return {
                label: title,
                image: handleDevImage(req, image),
                type,
                [action]: { plex }
            };
        }).sort(() => shuffle ? Math.random() - 0.5 : 0);
        delete plexResponse.list;
        if (plexList) return { meta: plexResponse, items: applyParamsToItems(plexList) };
    }

    // If no list or Plex items, check the mediaPath
    const folderExists = fs.existsSync(`${mediaPath}/${media_key}`);
    if (folderExists) {
        const getFiles = (basePath) => {
            const folderPath = `${basePath}/${media_key}`;
            if (!fs.existsSync(folderPath)) return [];
            return fs.readdirSync(folderPath).map(file => {
                const isFolder = fs.statSync(`${folderPath}/${file}`).isDirectory();
                if (mustBePlayable && isFolder) return null; // Skip folders if mustBePlayable is true
                if (isFolder) return { folder: file };
                const ext = file.split('.').pop();
                if (validExtensions.includes(`.${ext}`)) { return { file }; }
                return null;
            }).filter(Boolean)
                .map(({ file, folder }) => {
                    if (folder) return { folder };
                    const fileWithoutExt = file.replace(/\.[^/.]+$/, ""); // Remove the file extension
                    return fs.existsSync(`${folderPath}/${file}`) ? { media_key: `${media_key}/${fileWithoutExt}` } : null;
                }).filter(Boolean);
        };

        const items = (await Promise.all(getFiles(mediaPath) // Get files from media path
            .map(loadMetadataFromFile)))
            .map(loadMetadataFromConfig)
            .filter(Boolean);

        // Load metadata for the parent and apply parent tags to children
        const parentMetadata = loadMetadataFromMediaKey(media_key);
        let items_full = sortListByMenuMemory(applyParentTags(items, parentMetadata));

        if (shuffle) items_full = items_full.sort(() => Math.random() - 0.5);

        return { items: applyParamsToItems(items_full), parentMetadata };
    }

    // If no folder exists, return an empty result
    return { items: [] };
};

// Normalize parameter structure for queue items
export const applyParamsToItems = (items) => {

    const dayFilter = ({days}) => {
        if(!days || days.length === 0) return true; 
        const weekdayInt = moment().isoWeekday();
        const daysMap = {
            "Monday": [1],
            "Tuesday": [2],
            "Wednesday": [3],
            "Thursday": [4],
            "Friday": [5],
            "Saturday": [6],
            "Sunday": [7],
            //compounds
            "Weekdays": [1, 2, 3, 4, 5],
            "Weekend": [6, 7],
            "M•W•F": [1, 3, 5],
            "T•Th": [2, 4],
            "M•W": [1, 3]
        };
        const dayArray = daysMap[days];
        if(!dayArray) {
            fetchLogger.warn('fetch.applyParams.unknown_days', { days });
            return true; // If unknown, don't filter out
        }
        return dayArray.includes(weekdayInt);
    };


    return items.map(item => {
        // Convert legacy parameter names
        if (item.playbackrate) {
            item.playbackRate = item.playbackrate;
            delete item.playbackrate;
        }
        
        const keysToMove = ['playbackRate', 'volume', 'loop', 'shader'];
        

        const allKeys = Object.keys(item);
        const mediaKey = allKeys.find(key => {
            const value = item[key];
            // Look for objects that aren't null and could reasonably contain media configuration
            return typeof value === 'object' && 
                   value !== null && 
                   !Array.isArray(value) &&
                   // Exclude objects that are clearly metadata (have primitive-like structure)
                   !keysToMove.includes(key);
        });
        
        if (mediaKey) {
            for (const key of keysToMove) {
                if (item[key] !== undefined) {
                    item[mediaKey] = item[mediaKey] || {};
                    item[mediaKey][key] = item[key];
                    delete item[key];
                }
            }
        }
        
        return item;
    }).filter(item => item?.active !== false).filter(dayFilter);
};

apiRouter.get('/list/*', async (req, res, next) => {


    try {
        const [media_key, config] = req.params[0].split('/');
        const {meta,items} = await getChildrenFromMediaKey({media_key,  config, req});

        // Add metadata from a config
        const metadata = loadMetadataFromMediaKey(media_key);
        metadata.label = metadata.title || media_key;
        return res.json({ media_key,...meta, ...metadata, items });
    } catch (err) {
        next(err);
    }
});
apiRouter.get('/keyboard/:keyboard_id?', async (req, res) => {
    const { keyboard_id } = req.params;
    //get keyboard data from dataPath/keyboard
    const keyboardData = loadFile(`state/keyboard`).filter(k => 
        k.folder?.replace(/\s+/g, '').toLowerCase() === keyboard_id?.replace(/\s+/g, '').toLowerCase()
    );
    if(!keyboardData?.length) return res.status(404).json({error: 'Keyboard not found'});
    const result = keyboardData.reduce((acc, k) => {
        const { key, label, function: func, params, secondary } = k;
        if (key && !!func) {
            acc[key] = { label, function: func, params, secondary };
        }
        return acc;
    }, {});
    return res.json(result);
});



// Recursively list *.yaml files in the data path
const listYamlFiles = (dir) => {
    let results = [];
    const files = readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(listYamlFiles(filePath));
        } else if (file.endsWith('.yaml')) {
            results.push(filePath.replace(`${dataPath}/`, '').replace('.yaml', ''));
        }
    }
    return results;
};

apiRouter.get('/list', async (req, res, next) => {
    try {
        const dataFiles = listYamlFiles(dataPath);
        res.json({ dataPath, dataFiles });
    } catch (err) {
        next(err);
    }
});

apiRouter.get('/test',  async (req, res, next) => {
    try {
        const result = await test();
        res.json({test: result});
    } catch (err) {
        next(err);
    }
});

// Unified endpoint to fetch data from YAML files with flexible parameters
apiRouter.get('/*', async (req, res, next) => {
    try {
        const fullPath = req.params[0];
        const parts = fullPath.split('/');
        const key = parts.pop();
        const parentPath = parts.join('/');

        // 1. Check parent path (try content/ first, then root)
        if (parentPath) {
            const contentParentData = loadFile(`content/${parentPath}`);
            if (contentParentData && contentParentData[key] !== undefined) {
                return res.json(contentParentData[key]);
            }

            const parentData = loadFile(parentPath);
            if (parentData && parentData[key] !== undefined) {
                return res.json(parentData[key]);
            }
        }

        // 2. Check file path (try content/ first, then root)
        let data = loadFile(`content/${fullPath}`);
        if (!data) {
            data = loadFile(fullPath);
        }
        
        if (!data) {
            return res.status(404).json({ error: `File not found: ${fullPath}` });
        }

        // If the key exists in the data, return the specific key's value
        if (data[key] !== undefined) {
            return res.json(data[key]);
        }

        // Otherwise, return the entire file's content
        res.json(data);
    } catch (err) {
        next(err);
    }
});


//handle all other requests, post or get
apiRouter.all('*',  async (req, res) => {
    const availableEndpoints = apiRouter.stack.map(r => r.route?.path);
    return res.status(404).json({error: `Invalid endpoint: ${req.method} ${req.path}`, availableEndpoints});
});

export default apiRouter;