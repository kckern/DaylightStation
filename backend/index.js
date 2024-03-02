const express = require('express');
const fs = require('fs');
const YAML = require('yaml')
const path = require('path');
const configExists = fs.existsSync(`${__dirname}/../config.app.yml`);
const isDocker = fs.existsSync('/.dockerenv');


const fetchRouter = require(path.join(__dirname, 'fetch.js'));
const harvestRouter = require(path.join(__dirname, 'harvest.js'));


const app = express();
if (configExists) {
  process.env = { ...process.env,isDocker, ...YAML.parse(fs.readFileSync(path.join(__dirname, '../config.app.yml'), 'utf8')) };



  // Backend API
  app.get('/debug', (_, res) =>res.json({ process: { env: process.env } }));
  app.use('/data', fetchRouter);
  app.use("/harvest", harvestRouter);


  // Frontend
  const fontendPath = path.join(__dirname, '../frontend/dist');
  const frontendExists = fs.existsSync(fontendPath);
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