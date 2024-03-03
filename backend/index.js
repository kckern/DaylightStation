import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path,{ join } from 'path';


const __dirname = path.dirname(new URL(import.meta.url).pathname);

const configExists = existsSync(`${__dirname}/../config.app.yml`);
const isDocker = existsSync('/.dockerenv');

import fetchRouter from './fetch.js';
import harvestRouter from './harvest.js';
import exe from './exe.js';

const app = express();
if (configExists) {



  // Parse the YAML files
  const appConfig = parse(readFileSync(join(__dirname, '../config.app.yml'), 'utf8'));
  const secretsConfig = parse(readFileSync(join(__dirname, '../config.secrets.yml'), 'utf8'));
  const localConfig = !isDocker ? parse(readFileSync(join(__dirname, '../config.app-local.yml'), 'utf8')) : {};

// Construct the process.env object
  process.env = { ...process.env, isDocker, ...appConfig, ...secretsConfig, ...localConfig };

  // Backend API
  app.get('/debug', (_, res) => res.json({ process: { env: process.env } }));
  app.use('/data', fetchRouter);
  app.use("/harvest", harvestRouter);
  app.use("/exe", exe);

  // Frontend
  const fontendPath = join(__dirname, '../frontend/dist');
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