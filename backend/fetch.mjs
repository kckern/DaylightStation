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
const dataPath = `${process.env.path.data}`;
const mediaPath = `${process.env.path.media}`;

// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});




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


//scritpures
apiRouter.get('/scripture/:volume/:version/:verse_id',  async (req, res, next) => {
    try {
        const {volume, version, verse_id} = req.params;
        const data = yaml.load(readFileSync(`${dataPath}/scripture/${volume}/${version}/${verse_id}.yaml`, 'utf8'));
        res.json(data);
    } catch (err) {
        next(err);
    }
}
);

apiRouter.get('/hymn/:hymn_num?', async (req, res, next) => {
    try {
        const hostname = req.get('host');
        const protocol = /localhost/.test(hostname) ? 'http' : 'https';
        const preferences = ["_ldsgc", ""];
        const hymnData = req.params.hymn_num ? loadFile(`songs/hymns/${req.params.hymn_num}`) : loadRandom(`songs/hymns`);
        const hymn_num = String(req.params.hymn_num || hymnData?.hymn_num || '').padStart(3, '0');
        const { mediaFilePath, mediaUrl } = preferences.reduce((result, prf) => {
            if (result) return result; // If a result is already found, skip further checks
            prf = prf ? `${prf}/` : '';
            const mediaFilePath = `${mediaPath}/songs/hymns/${prf}${hymn_num}.mp3`;
            try {
            if (fs.existsSync(mediaFilePath)) {
                return {
                mediaUrl: `${protocol}://${hostname}/media/songs/hymns/${prf}${hymn_num}`,
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


export const loadMetadataFromFile = async ({media_key, baseUrl}) => {
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

    const media_url = `${baseUrl}/media/${media_key}`;
    const ext = path.split('.').pop();
    const media_type = ["mp3", "m4a"].includes(ext) ? "audio" : "video";
    const result = { media_key, media_key, ...fileTags, media_type,media_url };

    if (tags.picture) {
        result.image = `${baseUrl}/media/img/${media_key}`;
    }

    return result;
}

const loadMetadataFromConfig =  (item, keys=[]) => {
    const {media_key} = item;
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
export const getChildrenFromMediaKey = async ({media_key, baseUrl}) => {
    const validExtensions = ['.mp3', '.mp4', '.m4a'];
    const folderExists = fs.existsSync(`${mediaPath}/${media_key}`);
    if (!folderExists) {
        //load lists
        const listItems = await Promise.all(loadFile(`lists`).map(processListItem));
        const filterFn = item => item?.folder?.toLowerCase() === media_key?.toLowerCase();
        return listItems.filter(filterFn) || [];
    }


    const getFiles = (basePath) => {
        const folderPath = `${basePath}/${media_key}`;
        if (!fs.existsSync(folderPath)) return [];
        return fs.readdirSync(folderPath).filter(file => {
            const ext = file.split('.').pop();
            return validExtensions.includes(`.${ext}`);
        }).map(file => {
            const fileWithoutExt = file.replace(/\.[^/.]+$/, ""); // Remove the file extension
            return fs.existsSync(`${folderPath}/${file}`) ? { baseUrl, media_key: `${media_key}/${fileWithoutExt}` } : null;
        }).filter(Boolean);
    };

    //TODO if no folder for the media_key, check if the media_key is folder in the nav data

    const items = (await Promise.all(getFiles(mediaPath) // Get files from media path
                        .map(loadMetadataFromFile)))
                        .map(loadMetadataFromConfig)
                        .filter(Boolean);

    // Load metadata for the parent and apply parent tags to children
    const parentMetadata = loadMetadataFromMediaKey(media_key);
    return applyParentTags(items, parentMetadata);
};

apiRouter.get('/list/*', async (req, res, next) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    try {
        const media_key = req.params[0];
        const items = await getChildrenFromMediaKey({media_key, baseUrl, mediaPath});

        // Add metadata from a config
        const metadata = loadMetadataFromMediaKey(media_key);
        return res.json({ media_key, ...metadata, items });
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