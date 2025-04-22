import { loadCronJobs, updateCronJob } from "./lib/db.mjs";
import cronparser from 'cron-parser';
import crypto from 'crypto';
import moment from "moment-timezone";
import fetch from 'node-fetch';
const md5 = (string) => {
    return crypto.createHash('md5').
    update(string).digest('hex');
}


const windowOffset = (str) => {
    const md5hash = md5(str);
    const threeDecimals = parseInt(md5hash.replace(/[^0-9]/g, '')?.slice(-3)) || 0;
    const maxPossibleDecimal = 999;
    return 0.5 - (threeDecimals / maxPossibleDecimal);
}


export default async (req, res) => {

    const timeZone = 'America/Los_Angeles';

    const hostname = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || /localhost/.test(hostname) ? 'http' : 'https';

    //This function runs every 1 minute
    const cronJobs = await loadCronJobs();


    cronJobs.map(job=>{
        job.nextRun = cronparser.parseExpression(job.cron_tab,{tz:timeZone}).next().toString();
        job.decimal = windowOffset(job.nextRun);
        job.minutesOff = Math.round(job.decimal * job.window);
        job.offset = job.window - (windowOffset(job.nextRun) * job.window);
        job.unix = job.unix = moment(new Date(job.nextRun)).unix() + (job.minutesOff * 60);
        delete job.cron_tab;
        delete job.window;
        delete job.offset;
        delete job.decimal;
        //ddd, DD MMM YYYY HH:mm a, honor the timezone
        job.nextRun = moment(new Date(job.unix * 1000)).tz(timeZone).format('ddd, DD MMM YYYY HH:mm:ss a');
        job.minutesUntil = Math.round((job.unix - moment().unix()) / 60);
        if(job.minutesUntil < 0) job.minutesUntil = null;
        job.needsToRun = job.unix < moment().unix() && (job.last_run === null || job.last_run < job.unix);
    });

    const runNow = cronJobs.filter(job => job.needsToRun || false);
    const messageIds = [];
    for(let job of runNow){
        console.log('Running job:',job);
        const command = job.command;
        const response = await fetch(`${protocol}://${hostname}/api/trigger?q=${command}`);
        const { message_id } = await response.json();
        await updateCronJob(job.uuid,message_id);
        messageIds.push(message_id);
    }

    res.status(200).json({ message: 'Cron job ran', cronJobs,runNow,messageIds });

};