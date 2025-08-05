import express from 'express';

const fitnessRouter = express.Router();

// Hello world endpoint
fitnessRouter.get('/', (req, res) => {
    res.json({ 
        message: 'Hello World from Fitness API',
        status: 'success'
    });
});

export default fitnessRouter;
