import express from 'express';
const apiRouter = express.Router();
import Infinity from './lib/infinity.js';
import { saveFile } from './lib/io.mjs';
import { readFileSync, readdirSync } from 'fs';
import test from './jobs/weight.mjs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
const dataPath = `${process.env.path.data}`;

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
        const data = {
            title: "Come thou fount of every blessing",
            hymn_num: "1001",
            verses: [
                [
                    "Come thou fount of every blessing",
                    "Tune my heart to sing thy grace",
                    "Streams of mercy never ceasing",
                    "Call for songs of loudest praise",
                    "Teach me some melodious sonnet",
                    "Sung by flaming tongues above",
                ],
                [
                    "Here I raise my Ebenezer",
                    "Hither by thy help I'm come",
                    "And I hope, by thy good pleasure",
                    "Safely to arrive at home",
                    "Jesus sought me when a stranger",
                    "Wandering from the fold of God",
                ],
                [
                    "He, to rescue me from danger",
                    "Interposed his precious blood",
                    "O to grace how great a debtor",
                    "Daily I'm constrained to be",
                    "Let thy goodness like a fetter",
                    "Bind my wandering heart to thee",
                ],
                [
                    "Prone to wander, Lord, I feel it",
                    "Prone to leave the God I love",
                    "Here's my heart, O take and seal it",
                    "Seal it for thy courts above"
                ]
            ],

        }
        res.json(data);
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