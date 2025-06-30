
import express from 'express';
import { processWebhookPayload } from './journalist/telegram_hook.mjs';
import {processFoodLogHook} from './journalist/foodlog_hook.mjs';
import {foodReport, scanBarcode, canvasImageEndpoint} from './journalist/food_report.mjs';
import { updateWebhook } from './journalist/lib/telegram.mjs';
import imageHandler from './journalist/img.mjs';
import moment from 'moment-timezone';
const apiRouter = express.Router();
apiRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));


const timezone = (req, res) => {
    const timezone = process.env.TIMEZONE || 'America/Los_Angeles';
    const today = moment().tz(timezone).format('YYYY-MM-DD');
    const dayOfWeek = moment().tz(timezone).format('dddd');
    const timeAMPM = moment().tz(timezone).format('h:mm a');
    const unix = moment().tz(timezone).unix();
    const momentTimezone = moment.tz.guess();
    res.status(200).json({
        timezone,
        today,
        dayOfWeek,
        timeAMPM,
        unix,
        momentTimezone
    });
}


apiRouter.all(  '/journalist',    processWebhookPayload);
apiRouter.all(  '/foodlog',       processFoodLogHook);
apiRouter.all(  '/foodreport',    foodReport);
apiRouter.all(  '/nutribot/images/:param1/:param2', canvasImageEndpoint);
//add a handler for processImageUrl?
apiRouter.all(  '/telegram/img',        imageHandler);
apiRouter.all(  '/barcode',         scanBarcode);
apiRouter.all(  '/time',         timezone);
apiRouter.all('/:env(dev|prod)', async (req, res) => {
    const env = req.params.env;
    const journalistHook = env === 'dev' ? process.env.journalist.journalist_dev_hook : process.env.journalist.journalist_prod_hook;
    const nutribotHook = env === 'dev' ? process.env.journalist.nutribot_dev_hook : process.env.journalist.nutribot_prod_hook;

    const journalistWebhookResult = await updateWebhook(process.env.TELEGRAM_JOURNALIST_BOT_TOKEN, journalistHook);
    //wait 2 seconds to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
    const nutribotWebhookResult = await updateWebhook(process.env.TELEGRAM_NUTRIBOT_TOKEN, nutribotHook);

    res.status(200).json({ 
        message: `${env.charAt(0).toUpperCase() + env.slice(1)} webhooks updated successfully.`,
        results: {
            journalistWebhook: journalistWebhookResult,
            nutribotWebhook: nutribotWebhookResult
        }
    });
});
apiRouter.all(  '/*',        async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint. You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist. `});
});


export default apiRouter;