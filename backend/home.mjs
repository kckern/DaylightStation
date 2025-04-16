import express from 'express';
import { turnOnTVPlug } from './lib/homeassistant.mjs';
const apiRouter = express.Router();


// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

apiRouter.get('/calendar',  async (req, res, next) => {
    return res.json({message: 'Hello from the calendar endpoint'});
});

apiRouter.get('/todo',  async (req, res, next) => {
    return res.json({message: 'Hello from the todo endpoint'});
});

apiRouter.get('/tv_tasker',  async (req, res, next) => {

    await turnOnTVPlug();
    const {tv:{host, port}} = process.env;
    return res.json({message: `TV Tasker is running on ${host}:${port}`});

});


export default apiRouter;