const express = require('express');
const fs = require('fs');
require('dotenv').config();


const { serverSideRendering } = require('./ssr');
const path = require('path');
const app = express();
const bots = ["google", "bing", "yahoo", "duckduckgo", "baidu", "yandex", "sogou", "exabot", "facebot", "ia_archiver", "facebookexternalhit", "twitterbot", "developers.google.com"];
const botPattern = new RegExp(bots.join("|"), "i");



// Server Side Rendering
app.use((req, res, next) => {
  if (botPattern.test(req.headers['user-agent']))
    return serverSideRendering(req, res);
  return next();
});


// Backend API
app.get('/debug', function (req, res) {
  res.json({ process: {env: process.env} });

});


// Frontend
const fontendPath = path.join(__dirname, '../frontend/build');
const frontendExists = fs.existsSync(fontendPath);
if (frontendExists) app.use('/', express.static(fontendPath));
else app.use('/', (_,res) => res.redirect('http://localhost:3111'));


app.listen(3112);