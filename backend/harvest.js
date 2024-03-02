
const express = require('express');
const harvestRouter = express.Router();



harvestRouter.get('*',  async (req, res) => {
    return res.status(404).json({error: 'Invalid endpoint'});
});


//handle all other requests, post or get
harvestRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: 'Invalid endpoint'});
});



module.exports = harvestRouter;