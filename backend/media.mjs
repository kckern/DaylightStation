import axios from 'axios';
import express from 'express';
import fs from 'fs';
import {Plex} from './lib/plex.mjs';
import { loadFile, saveFile } from './lib/io.mjs';
import moment from 'moment';
import { parseFile } from 'music-metadata';
import { loadMetadataFromMediaKey, loadMetadataFromFile, clearWatchedItems, watchListFromMediaKey, getChildrenFromWatchlist, findUnwatchedItems, applyParamsToItems } from './fetch.mjs';
import { getChildrenFromMediaKey } from './fetch.mjs';
import Infinity from './lib/infinity.js';
import { slugify } from './lib/utils.mjs';
const mediaRouter = express.Router();
mediaRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));
const audioPath = `${process.env.path.media}`;
const videoPath = `${process.env.path.media}`;
const mediaPath = `${process.env.path.media}`;
const notFound = `${audioPath}/${process.env.media.error}`;

const ext = ['mp3','mp4','m4a', 'webm'];
export const findFileFromMediaKey = media_key => {
    media_key = media_key.replace(/^\//, '');
    const lastLeaf = media_key.split('/').pop();
    const extention = lastLeaf.split('.').length > 1 ? lastLeaf.split('.').pop() : null;
    const possiblePaths = extention 
        ? [audioPath, videoPath].map(p => `${p}/${media_key}`) 
        : ext.flatMap(e => [audioPath, videoPath].map(p => `${p}/${media_key}.${e}`));
    const firstMatch = possiblePaths.find(p => fs.existsSync(p));
    //if(!firstMatch) console.log(`File not found: ${JSON.stringify(possiblePaths)}`);
    if(!firstMatch) return {found:false, path: notFound, fileSize: fs.statSync(notFound).size, mimeType: 'audio/mpeg'};
    const fileSize = firstMatch? fs.statSync(firstMatch).size : fs.statSync(notFound).size;
    const fileExt = firstMatch?.split('.').pop();
    if(!firstMatch) return {found:false, path: notFound, fileSize, mimeType: 'audio/mpeg'};

    const mimeType = fileExt === 'mp3' ? 'audio/mpeg' 
        : fileExt === 'm4a' ? 'audio/mp4' 
        : fileExt === 'mp4' ? 'video/mp4' 
        : fileExt === 'webm' ? 'video/webm' 
        : 'application/octet-stream';

    return {found:true, path: firstMatch, fileSize, extention:fileExt, mimeType};
}


mediaRouter.get('/img/*', async (req, res) => {
    const imgPath = req.params[0]; // Capture the full path after /img/
    const baseDir = `${process.env.path.img}`;
    const filePathWithoutExt = `${baseDir}/${imgPath}`;
    const exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

    // Check for image file
    const ext = exts.find(e => fs.existsSync(`${filePathWithoutExt}.${e}`));
    if (ext) {
        const filePath = `${filePathWithoutExt}.${ext}`;
        const mimeType = `image/${ext}`;
        res.status(200).set({
            'Content-Type': mimeType,
            'Content-Length': fs.statSync(filePath).size,
            'Cache-Control': 'public, max-age=31536000',
            'Expires': new Date(Date.now() + 31536000000).toUTCString(),
            'Content-Disposition': `inline; filename="${imgPath}.${ext}"`,
            'Access-Control-Allow-Origin': '*'
        });
        return fs.createReadStream(filePath).pipe(res);
    }

    // Check for media file
    const mediaFile = findFileFromMediaKey(imgPath);
    if (mediaFile.path !== notFound) {
        try {
            const { common: { picture } } = await parseFile(mediaFile.path);
            if (picture && picture.length) {
                const image = picture[0];
                const buffer = Buffer.from(image.data); // Convert data to a Buffer
                res.setHeader('Content-Type', image.format);
                res.setHeader('Content-Length', buffer.length);
                return res.status(200).send(buffer); // Send the buffer as the image
            }
        } catch (error) {
            console.error(`Error parsing media file for image: ${error.message}`);
        }
    }

    // Fallback to notfound image
    const notFoundPath = `${baseDir}/notfound.png`;
    res.status(404).set({
        'Content-Type': 'image/png',
        'Content-Length': fs.statSync(notFoundPath).size,
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Content-Disposition': `inline; filename="notfound.png"`,
        'Access-Control-Allow-Origin': '*'
    });
    return fs.createReadStream(notFoundPath).pipe(res);
});



mediaRouter.all('/plex/play/:plex_key', async (req, res) => {
    const plex_key = req.params.plex_key;
    const plexUrl = await ( new Plex()).loadmedia_url(plex_key);
    try {
        const response = await axios.get(plexUrl);
        if (response.status !== 200) {
            res.status(response.status).json({ 
                error: 'Error fetching from Plex server!', 
                status: response.status, 
                message: response.statusText,
                plexUrl: plexUrl
            });
            return;
        }
        res.redirect(plexUrl);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server!', message: error.message, plexUrl: plexUrl, 
            params: req.params, paths: req.path, query: req.query });
    }
});

const logToInfinity = async (media_key, { percent, seconds }) => {
    percent = parseFloat(percent);
    seconds = parseInt(seconds);
    if (seconds < 10) return false;
    const duration = percent > 0 ? (seconds / (percent / 100)) : 0;
    const secondsRemaining = duration - seconds;
    const watchList = loadFile('config/watchlist') || [];
    const matches = watchList.filter(item => item.media_key === media_key) || [];
    if (!matches.length) return false;
    const uids = matches.map(item => item.uid);
    const { infinity: { watchlist_progress, watchlist_watched } } = process.env;
    for (const uid of uids) {
        await Infinity.updateItem(process.env.infinity.watchlist, uid, watchlist_progress, percent);
        if (secondsRemaining < 20) {
            await Infinity.updateItem(process.env.infinity.watchlist, uid, watchlist_watched, true);
            await Infinity.updateItem(process.env.infinity.watchlist, uid, watchlist_progress, 100);
            //reharvest watchlist
            const watchlistTableId = process.env.infinity.watchlist;
            await Infinity.loadTable(watchlistTableId);

        }
        console.log(`Infinity updated: ${uid} - ${percent}%`);
    }
    return true;
};

mediaRouter.post('/log', async (req, res) => {
    const postData = req.body;
    const { type, media_key, percent, seconds, title } = postData;
    if (!type || !media_key || !percent) {
        return res.status(400).json({ error: `Invalid request: Missing ${!type ? 'type' : !media_key ? 'media_key' : 'percent'}` });
    }
    try {
        let librarystring = "";
        if(seconds<10) return res.status(400).json({ error: `Invalid request: seconds < 10` });
        
        let logPath = `history/media_memory/${type}`;
        if (type === 'plex') {
            const plex = new Plex();
            const [meta] = await plex.loadMeta(media_key);
            librarystring = meta ? slugify(meta.librarySectionTitle) : 'media';
            if (meta && meta.librarySectionID) {
                logPath = `history/media_memory/plex/${librarystring}`;
            }
        }

        const log = loadFile(logPath) || {};
        log[media_key] = { time: moment().format('YYYY-MM-DD hh:mm:ssa'), title, media_key, seconds: parseInt(seconds), percent: parseFloat(percent) };
        if(!log[media_key].title) delete log[media_key].title;
        const sortedLog = Object.fromEntries(
            Object.entries(log).sort(([, a], [, b]) => moment(b.time, 'YYYY-MM-DD hh:mm:ssa').diff(moment(a.time, 'YYYY-MM-DD hh:mm:ssa')))
        );
        saveFile(logPath, sortedLog);
        console.log(`Log updated: ${JSON.stringify(log[media_key])}`);
        await logToInfinity(media_key,{percent, seconds});
        res.json({ response: {type,library:librarystring,...log[media_key]} });
    } catch (error) {
        console.error('Error handling /log:', error.message);
        res.status(500).json({ error: 'Failed to process log.' });
    }
});
mediaRouter.all(`/info/*`, async (req, res) => {
    let media_key = req.params[0] || Object.values(req.query)[0];
    if(!media_key) return res.status(400).json({ error: 'No media_key provided', param: req.params, query: req.query });

    // Extract shuffle from query parameters
    const shuffle = Object.keys(req.query).includes('shuffle');
    //Watch List
    const watchListItems = watchListFromMediaKey(media_key);
    if(watchListItems?.length) {
        const {items:[{plex}]} = getChildrenFromWatchlist(watchListItems);
        const info = await (new Plex()).loadPlayableItemFromKey(plex, shuffle);
        return res.json({
            media_key,
            ...info,
            title: info.title || `Plex Item ${plex}`,
        });
    }  




    // File System
    const { fileSize,  extention } = findFileFromMediaKey(media_key);
    if(!extention) media_key = await (async () => {
        const mediakeys = media_key.split(/[|]/);
        const watched = loadFile('history/media_memory/media') || {};
        const sortItems = (a, b) => {
            if(!a.media_key || !b.media_key) return 0;
            const lastLeafA = a.media_key.split('/').pop();
            const lastLeafB = b.media_key.split('/').pop();
            const stemA = a.media_key.replace(`/${lastLeafA}`, '');
            const stemB = b.media_key.replace(`/${lastLeafB}`, '');
            if (lastLeafA < lastLeafB) return 1;
            if (lastLeafA > lastLeafB) return -1;
            const indexA = mediakeys.indexOf(stemA);
            const indexB = mediakeys.indexOf(stemB);
            return indexA - indexB;
        };

        const filterItems = item => {
            const { media_key } = item;
            const { percent } = watched[media_key] || {};
            const isWatched = percent && percent >= 50;
            return !isWatched;
        };

        let unfilteredItems = (await Promise.all(
            mediakeys.map(async key => {
            const { items } = await getChildrenFromMediaKey({ media_key: key });
            console.log(items); 
            return items || [];
            })
        )).flat().sort(sortItems);

        console.log(unfilteredItems);
        
        let items = unfilteredItems.filter(filterItems);
        if(items.length === 0) {
            clearWatchedItems(unfilteredItems.map(item => item.media_key));
            items = unfilteredItems;
        }

        //todo: check for shuffle, limits, etc

        return items?.[0]?.media_key;
    })();

    
    if(!media_key) return res.status(400).json({ error: 'No media_key found', param: req.params, query: req.query });
    const metadata_file = await loadMetadataFromFile({media_key});
    const metadata_media = loadMetadataFromMediaKey(media_key);
    const metadata_parent = loadMetadataFromMediaKey(media_key.split('/').slice(0, -1).join('/'),['image','volume','rate','shuffle']);
    const host = process.env.host || "";
    const media_url = `${host}/media/${media_key}`;
    res.json({
        media_key,
        ...metadata_parent,
        ...metadata_file,
        ...metadata_media,
        media_url,
        fileSize
        
    });
});




mediaRouter.all('/plex/info/:plex_key/:config?', async (req, res) => {
    const { plex_key, config } = req.params;
    const {host} = process.env;
    const plex_keys = plex_key.split(',');
    
    // Check for shuffle - prefer path config, fallback to query parameters
    const shuffle = /shuffle/i.test(config) || Object.keys(req.query).includes('shuffle');
    
    let infos = [];
    for (const key of plex_keys) {
        const info = await (new Plex()).loadPlayableItemFromKey(key, shuffle);
        infos.push(info);
    }
    //pick one
    const plexInfo = infos[Math.floor(Math.random() * infos.length)] || {};
    plexInfo['image'] = handleDevImage(req, plexInfo.image || `${host}/media/plex/img/notfound.png`);
    
    try {
        res.json(plexInfo);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: plexUrl });
    }
});

export const handleDevImage = (req,image) => {
    const isDev = !!process.env.dev;
    const host = req.headers.host || process.env.host || "";
    return isDev && host ? `http://${host}${image}` : image;
}


mediaRouter.all('/plex/list/:plex_key/:config?', async (req, res) => {
    const { plex_key, config } = req.params;
    const plex_keys = plex_key.split(',');
    const playable = /playable/i.test(config);
    const shuffle = /shuffle/i.test(config) || Object.keys(req.query).includes('shuffle');

    const watchListItems = watchListFromMediaKey(plex_key);
    if(watchListItems?.length) {
        const items =  getChildrenFromWatchlist(watchListItems);
        res.json({
            media_key: plex_key,
            items: items.items.map(({plex, type, title, image}) => {
                return {
                    label: title,
                    type: type,
                    plex: plex,
                    image: handleDevImage(req, image),
                    ...req.query
                };
            }),
            ...items
        });
        return;
    }

    let list = [];
    let info = {};
    for (const plex_key of plex_keys) {
        const {list:items, plex, title, image} = await (new Plex()).loadChildrenFromKey(plex_key, playable, shuffle);
        list = list.concat(items);
        info = {
            plex: info.plex ? `${info.plex},${plex}` : plex,
            title: info.title ? `${info.title} • ${title}` : title,
            image: info.img ? handleDevImage(req, `${info.image}`) : handleDevImage(req, image)
        }
    }
    const list_keys = list.map(item => item.key || item.plex || item.media_key).filter(Boolean);
    const unwatched_keys = findUnwatchedItems(list_keys,"plex",shuffle);
    const unwatchedList = list.filter(item => unwatched_keys.includes(item.key || item.plex || item.media_key));
    list = unwatchedList.map(({key,plex,type,title,image}) => {
        return {
            label: title,
            type: type,
            plex: key || plex,
            image: handleDevImage(req, image),
            ...req.query
        };
    });
    try {
        res.json({...info, items: applyParamsToItems(list)});
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message });
    }
});

mediaRouter.all('/plex/table/:plex_key', async (req, res) => {
    const { plex_key } = req.params;
    const plex_keys = plex_key.split(',');
    const playable = true; // No shuffle for table view
    let list = [];
    let info = {};

    for (const key of plex_keys) {
        const { list: items, plex, title, image } = await (new Plex()).loadChildrenFromKey(key, playable);
        list = list.concat(items);
        info = {
            plex: info.plex ? `${info.plex},${plex}` : plex,
            title: info.title ? `${info.title} • ${title}` : title,
            image: info.image ? `${info.image}` : image
        };
    }

    const tableRows = list.map(({  plex, grandparentTitle, parentTitle, type, title, image }) => `
        <tr>
            <td><img src="${image}" alt="${title}" style="width:50px;height:50px;"></td>
            <td>${plex}</td>
            <td>${title}</td>
            <td>${parentTitle}</td>
            <td>${grandparentTitle}</td>
        </tr>
    `).join('');

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${info.title || 'Plex Table'}</title>
            <style>
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f4f4f4;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                tr:hover {
                    background-color: #f1f1f1;
                }
                img {
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h1>${info.title || 'Plex Table'}</h1>

            <table>
                <thead>
                    <tr>
                        <th>Image</th>
                        <th>Plex Key</th>
                        <th>Title</th>
                        <th>Parent</th>
                        <th>Grand Parent</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </body>
        </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});


mediaRouter.all('/plex/img/:plex_key', async (req, res) => {
    const cacheFolder = `${mediaPath}/cache/plex`;
    const { plex_key } = req.params;
    const cacheFile = `${cacheFolder}/${plex_key}.jpg`;

    fs.mkdirSync(cacheFolder, { recursive: true });

    if (fs.existsSync(cacheFile)) {
        return res.sendFile(cacheFile);
    }

    try {
        const urls = (await (new Plex()).loadImgFromKey(plex_key)).filter(Boolean).map(url => {
            if (/plex_proxy/.test(url)) {
                const {host} = process.env.plex;
                return `${host}${url.replace(/\/plex_proxy/, '')}${url.includes('?') ? '&' : '?'}X-Plex-Token=${process.env.PLEX_TOKEN}`;
            }
            return url;
        });
        console.log(`Fetching image from: ${urls.join(', ')}`);
        const [imgUrl] = await Promise.all(
            urls.map(url =>
            axios.get(url, { method: 'HEAD' })
                .then(response => ({ url, status: response.status }))
                .catch(error => ({ url, status: error.response ? error.response.status : null }))
            )
        ).then(results => results.filter(({ status }) => status >= 200 && status < 300).map(({ url }) => url));

        const response = await axios.get(imgUrl, { responseType: 'stream' });

        // Pipe the image to the response immediately
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
        //return false;
        // Save the image to the cache
        const writeStream = fs.createWriteStream(cacheFile);
        response.data.pipe(writeStream)
            .on('finish', () => console.log(`Image cached: ${cacheFile}`))
            .on('error', (err) => console.error(`Cache error: ${err.message}`));
    } catch (err) {
        console.error(`Fetch error: ${err.message || err.code}`);
        res.status(500).json({ error: 'Error fetching image', message: err.message });
    }
});

mediaRouter.all('/plex/audio/:plex_key', async (req, res) => {
    const { plex_key } = req.params;
    const media_url = await (new Plex()).loadmedia_url(plex_key);
    try {
        //assume mp3, passthrough
        const response = await axios.get(media_url, { responseType: 'stream' });
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Length', response.headers['content-length']);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${plex_key}.mp3"`);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, media_url });
    }
});


mediaRouter.all('*', async (req, res) => {

    const { path, fileSize, mimeType } = findFileFromMediaKey(req.path);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
    res.setHeader('Last-Modified', new Date(Date.now()).toUTCString());
    res.setHeader('Content-Range', `bytes 0-${fileSize - 1}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${path.split('/').pop()}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            res.status(416).send('Requested range not satisfiable');
            return;
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(path, { start, end });

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);
        fileStream.pipe(res);
    } else {
        const fileStream = fs.createReadStream(path);
        res.status(200);
        fileStream.pipe(res);
    }
});

export default mediaRouter;