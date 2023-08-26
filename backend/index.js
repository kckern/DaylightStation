const express = require('express');
const fs = require('fs');
const YAML = require('yaml')
const path = require('path');
const configExists = fs.existsSync('./config.yml');

const localPath = path.join(__dirname, '../data_local');
const tmpPath = path.join(__dirname, '../data_tmp');
const apiRouter = require('./api.js');


const app = express();
if (configExists) {
  process.env = { ...process.env, ...YAML.parse(fs.readFileSync('./config.yml', 'utf8')) }

  if(fs.existsSync(localPath)) 
  {
    process.env.dataPath = localPath;
  }else{
    if(!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath);
    process.env.dataPath = tmpPath;
  }

  // Backend API
  app.get('/debug', function (req, res) {
    res.json({ process: { env: process.env } });
  });

  app.use('/data', apiRouter);


  // Frontend
  const fontendPath = path.join(__dirname, '../frontend/build');
  const frontendExists = fs.existsSync(fontendPath);
  if (frontendExists) app.use('/', express.static(fontendPath));
  else app.use('/', (_, res) => res.redirect('http://localhost:3111'));



}
else {
  app.get("*",function (req, res) {
    res.json({ error: 'This application is not configured yet. Please add a config.yml file to the root of the project. '   },500);
  });
}
app.listen(3112);
console.log('Listening on port 3112');