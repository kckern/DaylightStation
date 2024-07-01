import express from 'express';
const apiRouter = express.Router();
import Infinity from './lib/infinity.js';
import { saveFile } from './lib/io.js';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

apiRouter.get('/infinity/harvest/:table_id?',  async (req, res) => {
    let table_id = req.params.table_id || process.env.infinity.default_table || false;
    let table_alias = table_id+"";
    table_id = process.env.infinity.tables[table_id] || table_id;
    if(!table_id) return res.status(400).json({error: 'No table_id provided'});
    let table_data = await Infinity.loadTable(table_id);
    if(!table_data) return res.status(500).send('Failed to load data from Infinity');
    res.json(table_data);
    saveFile(`infinity/${table_alias}.json`, table_data);
});

apiRouter.get('/budget',  async (req, res) => {
    const finances = yaml.load(readFileSync('../data/budget/finances.yml', 'utf8'));
    res.json(finances);
});

//handle all other requests, post or get
apiRouter.all('*',  async (req, res) => {
    const availableEndpoints = apiRouter.stack.map(r => r.route.path);
    return res.status(404).json({error: `Invalid endpoint: ${req.method} ${req.path}`, availableEndpoints});
});

export default apiRouter;