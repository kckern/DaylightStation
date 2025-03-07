import express from 'express';
import crypto from 'crypto';
const apiRouter = express.Router();

const imports = [
    './lib/weather.js',
];


// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

apiRouter.get('/10mins',  async (req, res, next) => {

    try {
        const functions = await Promise.all(imports.map(path => import(path).then(module => module.default)));

        const guidId = crypto.randomUUID().split('-').pop();
        console.log(`Request ID: ${guidId}`);
        const data = {
            time: new Date().toISOString(),
            message: 'This endpoint is called every 10 minutes',
            guidId
        }
        res.json(data);
    
        await Promise.all(functions.map(fn => fn(guidId)));

    } catch (err) {
        next(err);
    }

});

export default apiRouter;