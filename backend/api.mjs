
import express from 'express';
import { processWebhookPayload } from './journalist/telegram_hook.mjs';
import {processFoodLogHook} from './journalist/foodlog_hook.mjs';
const apiRouter = express.Router();
apiRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));


apiRouter.all(  '/journalist',    processWebhookPayload);
apiRouter.all(  '/foodlog',       processFoodLogHook);
apiRouter.all(  '/*',        async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint. You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist. `});
});


export default apiRouter;