import express from 'express';

const fitnessRouter = express.Router();

// Fitness config endpoint
fitnessRouter.get('/', (req, res) => {
    const fitnessData = process.env.fitness;
    if(!fitnessData) return res.status(404).json({ error: 'Fitness configuration not found' });
    res.json(fitnessData);
});

export default fitnessRouter;
