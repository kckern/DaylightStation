"use strict";

import express from "express";
import crypto from "crypto";
import moment from "moment-timezone";
import { CronExpressionParser } from "cron-parser";
import Infinity from "./lib/infinity.js";
import { loadFile, saveFile } from "./lib/io.mjs";

const apiRouter = express.Router();
const timeZone = "America/Los_Angeles";

const cron = {
  cron10Mins: [
    "./lib/weather.js",
     "./lib/gcal.js",
     "./lib/todoist.js",
     "./lib/gmail.js",
  ],
  cronHourly: [
     "./lib/withings.mjs",
     "./lib/fitsync.mjs",
     "./lib/strava.mjs",
     "./lib/health.mjs",
     "./lib/garmin.mjs",
    // ...Infinity.keys.map(key => (req) => Infinity.loadData(key, req)),
  ],
  cronDaily: [
     "./lib/clickup.js",
     "./lib/youtube.mjs",
  ]
};

apiRouter.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

Object.keys(cron).forEach(key => {
  apiRouter.get(`/${key}`, async (req, res, next) => {
    try {
      const functions = await Promise.all(
        cron[key].map(async item => {
          if (typeof item === "string") {
            const module = await import(item);
            return module.default;
          } else if (typeof item === "function") {
            return item;
          }
          throw new Error(`Invalid item for ${key}`);
        })
      );
      const guidId = crypto.randomUUID().split("-").pop();
      console.log(`[${key}] Job ID: ${guidId}`);
      const data = {
        time: new Date().toISOString(),
        message: `Called endpoint for ${key}`,
        guidId
      };
      res.json(data);
      await Promise.all(functions.map(fn => fn(guidId)));
    } catch (error) {
      next(error);
    }
  });
});

export default apiRouter;

function md5(string) {
  return crypto.createHash("md5").update(string).digest("hex");
}

function windowOffset(str) {
  const md5hash = md5(str);
  const numeric = parseInt(md5hash.replace(/[^0-9]/g, "").slice(-3)) || 0;
  const max = 999;
  return 0.5 - numeric / max;
}

function computeNextRun(job, fromMoment) {
  const rawNext = CronExpressionParser.parse(job.cron_tab, {
    currentDate: fromMoment.toDate(),
    tz: timeZone
  }).next().toDate();
  const offsetMinutes = job.window
    ? Math.round(windowOffset(rawNext.toString()) * parseFloat(job.window))
    : 0;
  return moment(rawNext).add(offsetMinutes, "minutes").tz(timeZone);
}

export const cronContinuous = async () => {
  const now = moment().tz(timeZone);
  const cronJobs = loadFile("config/cron") || [];
  for (const job of cronJobs) {
    if (typeof job !== "object" || job === null) {
      console.warn(`Invalid job format:`, job);
      continue; // Skip invalid jobs
    }
    if (!job.nextRun) {
      const nextMoment = computeNextRun(job, now);
      job.nextRun = nextMoment.format("YYYY-MM-DD HH:mm:ss");
      job.secondsUntil = nextMoment.unix() - now.unix();
      job.needsToRun = false;
      job.last_run = job.last_run || 0;
    } else {
      // echo countdown to job.nextRun
      // console.log(`Job ${job.name} next run in ${job.secondsUntil} seconds`);
    }
  }
  for (const job of cronJobs) {
    if (!moment.tz(job.nextRun, "YYYY-MM-DD HH:mm:ss", timeZone).isValid()) {
      console.warn(`Invalid nextRun for job:`, job);
      job.needsToRun = false;
      continue; // Skip invalid jobs
    }
    const jobNextRun = moment.tz(job.nextRun, "YYYY-MM-DD HH:mm:ss", timeZone);
    const diff = jobNextRun.unix() - now.unix();
    job.secondsUntil = diff;
    if (diff <= 0) {
      job.needsToRun = true;
    } else {
      job.needsToRun = false;
    }
  }
  saveFile("config/cron", cronJobs);
  const runNow = [];
  for (const job of cronJobs) {
    if (job.needsToRun) {
      runNow.push(job);
    }
  }
  for (const job of runNow) {
    const jobName = job.name;
    const jobFile = cron[jobName];
    if (jobFile) {
      const guidId = crypto.randomUUID().split("-").pop();
      const funcs = await Promise.all(
        jobFile.map(async item => {
          if (typeof item === "string") {
            const module = await import(item);
            return module.default;
          } else if (typeof item === "function") {
            return item;
          }
          console.warn(`Invalid cron item for ${jobName}:`, item);
          return null; // Gracefully handle invalid items
        })
      );
      await Promise.all(
        funcs.map(fn => {
          if (typeof fn === "function") {
            return fn(guidId);
          } else {
            console.warn(`Skipped execution for non-function in ${jobName}:`, fn);
          }
        })
      );
      job.messageIds = job.messageIds ? [...job.messageIds, guidId] : [guidId];
    }
    delete job.messageIds; // Remove messageIds after running
    job.last_run = now.format("YYYY-MM-DD HH:mm:ss");
    const newNextRunMoment = computeNextRun(job, now);
    job.nextRun = newNextRunMoment.format("YYYY-MM-DD HH:mm:ss");
    job.secondsUntil = newNextRunMoment.unix() - now.unix();
    job.needsToRun = false;
  }
  saveFile("config/cron", cronJobs);
};

setInterval(() => {
  cronContinuous().catch(err => console.error("Error running some cron jobs:", err));
}, 5000);