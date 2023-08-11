const express = require('express');
const fs = require('fs');
require('dotenv').config();


const path = require('path');
const app = express();

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