import express from 'express';
const JournalistRouter = express.Router();
import auth from './journalist/auth.mjs';
import bump from './journalist/bump.mjs';
import cron from './journalist/cron.mjs';
import entry from './journalist/entry.mjs';
import foodlog_hook from './journalist/foodlog_hook.mjs';
import img from './journalist/img.mjs';
//import health from './journalist/health.mjs';
import journal from './journalist/journal.mjs';
import report from './journalist/report.mjs';
import trigger from './journalist/trigger.mjs';
import webhook from './journalist/webhook.mjs';
import test from './journalist/test.mjs';


const endpoints = {
    auth,
    bump,
    cron,
    entry,
    foodlog_hook,
    img,
   // health,
    journal,
    report,
    trigger,
    webhook,
    test,
    "": async (req) => {
        return {message: "Welcome to the journalist API. Please use one of the following endpoints: " + Object.keys(endpoints).join(", ")};
    }
};


Object.keys(endpoints).forEach(key => {
    ['get', 'post', 'put'].forEach(method => {
        JournalistRouter.route(`/${key}`)[method](async (req, res) => {
            try {
                const response = await endpoints[key](req);
                return res.status(200).json(response);
            } catch (error) {
                return res.status(500).json({error: error.message});
            }
        });
    });
});



//handle all other requests, post or get
JournalistRouter.all('*',  async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint.
    You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist.
    The only available endpoints are ${JournalistRouter.stack.map(i=>i.route.path).join(', ')}
    `});
});

export default JournalistRouter;