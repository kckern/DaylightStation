
const express = require('express');
const apiRouter = express.Router();
const {Infinity} = require('./lib/infinity');
const { saveFile } = require('./lib/io');


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


module.exports = apiRouter;