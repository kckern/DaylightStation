import express from 'express';

const lifelogRouter = express.Router();

// Hello world endpoint
lifelogRouter.get('/', (req, res) => {
    res.json({ 
        message: 'Hello World from Lifelog API',
        status: 'success'
    });
});

export default lifelogRouter;
