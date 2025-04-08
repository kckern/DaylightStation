import express from 'express';
const apiRouter = express.Router();
import Infinity from './lib/infinity.js';
import { loadFile, saveFile } from './lib/io.mjs';
import { readFileSync, readdirSync } from 'fs';
import test from './jobs/weight.mjs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import fs from 'fs';
import { parseFile } from 'music-metadata';


const dataPath = `${process.env.path.data}`;
const videoPath = `${process.env.path.video}`;
const audioPath = `${process.env.path.audio}`;

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


apiRouter.get('/hymn/:hymn_num',  async (req, res, next) => {

    
    try {
        const hymn_num = req.params.hymn_num;
        const hymnData = loadFile(`songs/hymns/${hymn_num}`);
        res.json(hymnData);
    } catch (err) {
        next(err);
    }
}
);

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


apiRouter.get('/list/:folder/:type',  async (req, res, next) => {


    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const extentions = {
        media: ['.mp3', '.mp4', '.m4a']
    }
    try {
        const folder = req.params.folder;
        const type = req.params.type;
        const validExtensions = extentions[type] || ["*"];
        const getFiles = (basePath) => {
            const folderPath = `${basePath}/${folder}`;
            if (!fs.existsSync(folderPath)) return [];
            return fs.readdirSync(folderPath).filter(file => {
                const ext = file.split('.').pop();
                return validExtensions.includes(`.${ext}`);
            }).map(file => {
                const filePath = `${folderPath}/${file}`;
                return fs.existsSync(filePath) ? file : null;
            }).filter(Boolean);
        };

        const items = await Promise.all(
            [...getFiles(videoPath), ...getFiles(audioPath)].map(async file => {
            // Extract id3 tags
            const isVideo = file.endsWith('.mp4');
            const filePath = isVideo || true ? `${videoPath}/${folder}/${file}` : `${audioPath}/${folder}/${file}`;
            const keepTags = ['title', 'artist', 'album', 'year', 'track', 'genre'];
            const tags = (await parseFile(filePath, { native: true })).common;
            const fileTags = keepTags.reduce((acc, tag) => {
                if (tags[tag] && typeof tags[tag] === 'object' && 'no' in tags[tag]) {
                    acc[tag] = tags[tag].no;
                } else if (tags[tag]) {
                    acc[tag] = tags[tag];
                }
                //delete if null
                if (!acc[tag]) delete acc[tag];
                return acc;
            }, {});
            const key = file.replace(/\.[^/.]+$/, "");
            const url = `${baseUrl}/media/${folder}/${key}`;
            const image = `${baseUrl}/media/img/${folder}/${key}`;
            return { ...fileTags, image, url };
            })
        );
        //todo add metadata from a config
        return res.json({list:"List Title",items});
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