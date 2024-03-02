import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path from 'path';

const configExists = existsSync(`${process.cwd()}/../config.app.yml`);
const isDocker = existsSync('/.dockerenv');

import fetchRouter from './fetch.js';
import harvestRouter from './harvest.js';

const app = express();
if (configExists) {
  process.env = { ...process.env, isDocker, ...parse(readFileSync(path.join(process.cwd(), '../config.app.yml'), 'utf8')) };
  //override with local env if not docker
  if(!isDocker) process.env = { ...process.env, ...parse(readFileSync(path.join(process.cwd(), '../config.app-local.yml'), 'utf8')) };

  // Backend API
  app.get('/debug', (_, res) => res.json({ process: { env: process.env } }));
  app.use('/data', fetchRouter);
  app.use("/harvest", harvestRouter);

  // Frontend
  const fontendPath = path.join(process.cwd(), '../frontend/dist');
  const frontendExists = existsSync(fontendPath);
  if (frontendExists) app.use('/', express.static(fontendPath));
  else {
    console.log('Frontend not found. Redirecting to localhost:3111');
    console.log(`I was expecting to find the frontend at ${fontendPath} but it was not there. Please run the frontend build script first.`);
    app.use('/', (_, res) => res.redirect('http://localhost:3111'));
  }
}
else {
  app.get("*",function (req, res) {
    res.json({ error: 'This application is not configured yet. Please add a config.app.yml file to the root of the project. '   },500);
  });
}
app.listen(3112);
console.log('Listening on port 3112');