const express = require('express');
const fs = require('fs');
const { serverSideRendering } = require('./ssr');
const path = require('path');
const app = express();
const bots = ["google", "bing", "yahoo", "duckduckgo", "baidu", "yandex", "sogou", "exabot", "facebot", "ia_archiver", "facebookexternalhit", "twitterbot", "developers.google.com"];
const botPattern = new RegExp(bots.join("|"), "i");
const fontendPath = path.join(__dirname, '../frontend/build');
const frontendExists = fs.existsSync(fontendPath);


// Server Side Rendering
app.use((req, res, next) => {
  if (botPattern.test(req.headers['user-agent']))
    return serverSideRendering(req, res);
  return next();
});


// Backend API
app.get('/api', function (req, res) {
  res.send('Hello World');
});


// Frontend
if (frontendExists) app.use('/', express.static(fontendPath));
else app.use('/', (_,res) => res.redirect('http://localhost:3000'));


app.listen(8011);