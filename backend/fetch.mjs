import express from 'express';
const apiRouter = express.Router();
import Infinity from './lib/infinity.js';
import { loadFile, loadRandom, saveFile } from './lib/io.mjs';
import { readFileSync, readdirSync } from 'fs';
import test from './jobs/weight.mjs';
import yaml, { load } from 'js-yaml';
import moment from 'moment-timezone';
import fs from 'fs';
import { parseFile } from 'music-metadata';
import { findFileFromMediaKey } from './media.mjs';
import { processListItem } from './jobs/nav.mjs';
import {lookupReference, generateReference} from 'scripture-guide';
import { Plex } from './lib/plex.mjs';
const dataPath = `${process.env.path.data}`;
const mediaPath = `${process.env.path.media}`;

// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

const findUnwatchedItems = (media_keys, category = "media", shuffle = false) => {
    const media_memory = loadFile(`_media_memory`)[category] || {};
    const unwatchedItems = media_keys.filter(key => {
        const watchedItem = media_memory[key];
        return !(watchedItem && watchedItem.percent > 0.5);
    });

    // If all items are filtered out, return the whole list
    const result = unwatchedItems.length > 0 ? unwatchedItems : media_keys;

    // If shuffle is true, shuffle the array
    return result.sort(() => (shuffle ? Math.random() - 0.5 : 0));
};



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
    const filesInFolder = readdirSync(`${dataPath}/talks/${talk_folder || ''}`).filter(file => file.endsWith('.yaml')).map(file => file.replace('.yaml', ''));
    const [selectedFile] = findUnwatchedItems(filesInFolder, 'talk', true);
    const filePath = `${dataPath}/talks/${talk_folder || ''}/${talk_id || selectedFile}.yaml`;
    const talkData = yaml.load(readFileSync(filePath, 'utf8'));
    const mediaFilePath = `${mediaPath}/talks/${talk_folder || ''}/${talk_id || selectedFile}.mp4`;
    const mediaExists = fs.existsSync(mediaFilePath);
    const mediaUrl = mediaExists ? `${host}/media/talks/${talk_folder || ''}/${talk_id || selectedFile}` : null;
    delete talkData.mediaUrl;
    return res.json({
        input: talk_id || selectedFile,
        media_key: `talks/${talk_folder || ''}/${talk_id || selectedFile}`,
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
        const versions = readdirSync(`${dataPath}/scripture/${volume}`)
                            .filter(folder => fs.statSync(`${dataPath}/scripture/${volume}/${folder}`).isDirectory());
        return versions.length > 0 ? versions[0] : null;
    }

    const getVerseIdFromVolume = (volume, version) => {
        const chapters = readdirSync(`${dataPath}/scripture/${volume}/${version}`)
            .filter(file => file.endsWith('.yaml'))
            .map(file => file.replace('.yaml', ''));
        const keys = chapters.map(chapter => `${volume}/${version}/${chapter}`);
        const unseenChapters = findUnwatchedItems(keys, 'scriptures');
        const [nextUp] = unseenChapters.map(key => key.match(/(\d+)$/)[1]) || [chapters[0]] || [null];
        return nextUp;
    };

    const deduceFromInput = (first_term, second_term) => {
        let volume = null;
        let version = null;
        let verse_id = null;

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

        const filePath = `${dataPath}/scripture/${volume}/${version}/${verse_id}.yaml`;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
            error: 'Scripture file not found', 
            first_term, second_term, volume, version, verse_id,
            filePath
            });
        }
        const reference = generateReference(verse_id).replace(/:1$/, '');
        const host = process.env.host || "";
        const mediaFilePath = `${mediaPath}/scripture/${volume}/${version}/${verse_id}.mp3`;
        const mediaExists = fs.existsSync(mediaFilePath);
        const mediaUrl = mediaExists ? `${host}/media/scripture/${volume}/${version}/${verse_id}` : null;

        const data = yaml.load(readFileSync(`${dataPath}/scripture/${volume}/${version}/${verse_id}.yaml`, 'utf8'));
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

apiRouter.get('/hymn/:hymn_num?', async (req, res, next) => {
    try {
        const preferences = ["_ldsgc", ""];
        const hymnData = req.params.hymn_num ? loadFile(`songs/hymns/${req.params.hymn_num}`) : loadRandom(`songs/hymns`);
        const hymn_num = String(req.params.hymn_num || hymnData?.hymn_num || '').padStart(3, '0');
        const { mediaFilePath, mediaUrl } = preferences.reduce((result, prf) => {
            if (result) return result; // If a result is already found, skip further checks
            prf = prf ? `${prf}/` : '';
            const mediaFilePath = `${mediaPath}/songs/hymns/${prf}${hymn_num}.mp3`;
            const host = process.env.host || "";
            try {
            if (fs.existsSync(mediaFilePath)) {
                return {
                mediaUrl: `${host}/media/songs/hymns/${prf}${hymn_num}`,
                mediaFilePath
                };
            }
            } catch (err) {
            console.error(`Error checking file path: ${mediaFilePath}`, err.message);
            }
            return null;
        }, null) || {};

        if (!mediaFilePath || !mediaUrl) {
            return res.status(200).json({ ...hymnData, mediaUrl: null, duration: 0 });
        }

        if (!mediaFilePath || !mediaUrl) {
            throw new Error(`Failed to resolve media file or URL for hymn number: ${hymn_num}`);
        }
        const metadata = await parseFile(mediaFilePath, { native: true });
        const duration = parseInt(metadata?.format?.duration) || 0;

        if (!mediaUrl) {
            throw new Error(`Hymn file not found for hymn number: ${hymn_num}`);
        }
        res.json({...hymnData, mediaUrl, duration});
    } catch (err) {
        next(err);
    }
});

apiRouter.get('/budget',  async (req, res, next) => {
    try {
        const finances = yaml.load(readFileSync(`${dataPath}/budget/finances.yml`, 'utf8'));
        res.json(finances);
    } catch (err) {
        next(err);
    }
});
apiRouter.get('/budget/daytoday',  async (req, res, next) => {
    try {
        const {budgets} = yaml.load(readFileSync(`${dataPath}/budget/finances.yml`, 'utf8'));
        const dates = Object.keys(budgets);
        const latestDate = dates.sort((a, b) => moment(b).diff(moment(a)))[0];
        const {dayToDayBudget} = budgets[latestDate];
        const months = Object.keys(dayToDayBudget);
        const latestMonth = months.sort((a, b) => moment(b).diff(moment(a)))[0];
        const budgetData = dayToDayBudget[latestMonth];
        delete budgetData.transactions;
        res.json(budgetData);
    } catch (err) {
        next(err);
    }
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
    const mediaConfig = loadFile(`media_config`);
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

    const inheritableTags = ['volume', 'shuffle', 'continuous', 'image', 'rate'];
    for (const tag of inheritableTags) {
        for(const item of items) {
            if (item[tag] === undefined && parent[tag] !== undefined) {
                item[tag] = parent[tag];
            }
        }
    }
    return items;

}
// Helper function to get children from a parent media_key
export const getChildrenFromMediaKey = async ({media_key}) => {
    const validExtensions = ['.mp3', '.mp4', '.m4a'];
    const folderExists = fs.existsSync(`${mediaPath}/${media_key}`);
    if (!folderExists) {
        //load lists
        const listItems = await Promise.all(loadFile(`lists`).map(processListItem));
        const filterFn = item => item?.folder?.toLowerCase() === media_key?.toLowerCase();
        const items = listItems.filter(filterFn) || [];
        if(!!items.length) return {items};
        const isPlex = /^\d+$/.test(media_key);
        if(isPlex) {
            const PLEX = new Plex();
            const plexResponse = await PLEX.loadChildrenFromKey(media_key);
            const plexList = plexResponse?.list.map(({key,title,type,image}) => {
                let action = "play";
                if(["show", "season"].includes(type)) action = "list";
                if(["album"].includes(type)) action = "queue";
                return {
                    label:title, image, type,
                    [action]: {plex: key}
                }
            });
            delete plexResponse.list;
            if(plexList) return {meta:plexResponse, items: plexList };
        }
    }


    const getFiles = (basePath) => {
        const folderPath = `${basePath}/${media_key}`;
        if (!fs.existsSync(folderPath)) return [];
        return fs.readdirSync(folderPath).map(file => {
            const isFolder = fs.statSync(`${folderPath}/${file}`).isDirectory();
            if (isFolder) return {folder: file};
            const ext = file.split('.').pop();
            if(validExtensions.includes(`.${ext}`)) {return {file};}
            return null;
        }).filter(Boolean)
        .map(({file,folder}) => {
            if(folder) return {folder};
            const fileWithoutExt = file.replace(/\.[^/.]+$/, ""); // Remove the file extension
            return fs.existsSync(`${folderPath}/${file}`) ? {  media_key: `${media_key}/${fileWithoutExt}` } : null;
        }).filter(Boolean);
    };

    //TODO if no folder for the media_key, check if the media_key is folder in the nav data

    const items = (await Promise.all(getFiles(mediaPath) // Get files from media path
                        .map(loadMetadataFromFile)))
                        .map(loadMetadataFromConfig)
                        .filter(Boolean);

    // Load metadata for the parent and apply parent tags to children
    const parentMetadata = loadMetadataFromMediaKey(media_key);
    const items_full =  applyParentTags(items, parentMetadata);
    return { items: items_full, parentMetadata };
};

apiRouter.get('/list/*', async (req, res, next) => {


    try {
        const media_key = req.params[0];
        const {meta,items} = await getChildrenFromMediaKey({media_key,  mediaPath});

        // Add metadata from a config
        const metadata = loadMetadataFromMediaKey(media_key);
        metadata.label = metadata.title || media_key;
        return res.json({ media_key,...meta, ...metadata, items });
    } catch (err) {
        next(err);
    }
});



//list the *.yml files in data path /data
const dataFiles = readdirSync(`${dataPath}`).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''));
apiRouter.get('/list',  async (req, res, next) => {
    try {
        res.json({dataPath, dataFiles});
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

//add an endpoint to fetch a specific file
apiRouter.get('/:file/:key',  async (req, res, next) => {
    try {
        const file = req.params.file;
        const data = yaml.load(readFileSync(`${dataPath}/${file}.yaml`, 'utf8'));
        if(data?.[req.params.key]) return res.json(data[req.params.key]);
        else res.json(data);
    } catch (err) {
        next(err);
    }
});


apiRouter.get('/:file',  async (req, res, next) => {
    try {
        const file = req.params.file;
        const data = yaml.load(readFileSync(`${dataPath}/${file}.yaml`, 'utf8'));
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