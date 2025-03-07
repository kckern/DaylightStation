import express from 'express';
import crypto from 'crypto';
const apiRouter = express.Router();

const cron = {
    cron10Mins: [
        './lib/weather.js',
        './lib/gcal.js',
        './lib/todoist.js',
        './lib/gmail.js',
    ],
    cronHourly: [    
        './lib/withings.mjs',
    ],
    cronDaily: [
        './lib/withings.mjs',
    ]
}

// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

Object.keys(cron).forEach(key => {
    apiRouter.get(`/${key}`, async (req, res, next) => {
        try {
            const functions = await Promise.all(cron[key].map(path => import(path).then(module => module.default)));

            const guidId = crypto.randomUUID().split('-').pop();
            console.log(`\n\n[${key}] Job ID: ${guidId}`);
            const data = {
                time: new Date().toISOString(),
                message: `This endpoint is called for ${key}`,
                guidId
            }
            res.json(data);

            await Promise.all(functions.map(fn => fn(guidId)));

        } catch (err) {
            next(err);
        }
    });
});

export default apiRouter;
