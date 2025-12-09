import axios from './lib/http.mjs';
import express from 'express';
import fs from 'fs';
import {Plex} from './lib/plex.mjs';
import { loadFile, saveFile } from './lib/io.mjs';
import moment from 'moment';
import { parseFile } from 'music-metadata';
import { loadMetadataFromMediaKey, loadMetadataFromFile, clearWatchedItems, watchListFromMediaKey, getChildrenFromWatchlist, findUnwatchedItems, applyParamsToItems } from './fetch.mjs';
import { getChildrenFromMediaKey } from './fetch.mjs';
import Infinity from './lib/infinity.js';
import { isWatched } from './lib/utils.mjs';
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
    // Optional bitrate cap via query
    const qBitrate = parseInt(req.query.maxVideoBitrate, 10);
    const opts = Number.isFinite(qBitrate) ? { maxVideoBitrate: qBitrate } : {};
    const plexUrl = await ( new Plex()).loadmedia_url(plex_key, 0, opts);
    try {
        const response = await axios.get(plexUrl);
        if (response.status !== 200) {
            res.status(response.status).json({ 
                error: 'Error fetching from Plex server!', 
                status: response.status, 
                message: response.statusText
            });
            return;
        }
        res.redirect(plexUrl);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server!', message: error.message, 
            params: req.params, paths: req.path, query: req.query });
    }
});

mediaRouter.all('/plex/mpd/:plex_key', async (req, res) => {
    const plex_key = req.params.plex_key;
    const qBitrate = parseInt(req.query.maxVideoBitrate, 10);
    const opts = Number.isFinite(qBitrate) ? { maxVideoBitrate: qBitrate } : {};
    try {
        const plexUrl = await (new Plex()).loadmedia_url(plex_key, 0, opts);
        if (!plexUrl) {
            return res.status(404).json({ error: 'Media URL not found', plex_key });
        }
        // Redirect through plex_proxy
        const proxyUrl = plexUrl.replace(process.env.plex.host, '/plex_proxy');
        res.redirect(proxyUrl);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error generating media URL', 
            message: error.message,
            plex_key 
        });
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
    const { type, media_key, percent, seconds, title, watched_duration } = postData;
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
        const normalizedSeconds = parseInt(seconds);
        const normalizedPercent = parseFloat(percent);
        const normalizedWatched = Number.parseFloat(watched_duration);
        const watchedDurationValue = Number.isFinite(normalizedWatched) && normalizedWatched >= 0
            ? Number(normalizedWatched.toFixed(3))
            : null;
        const entry = {
            time: moment().format('YYYY-MM-DD hh:mm:ssa'),
            title,
            media_key,
            seconds: normalizedSeconds,
            percent: normalizedPercent
        };
        if (watchedDurationValue != null) {
            entry.watched_duration = watchedDurationValue;
        }
        log[media_key] = entry;
        if(!log[media_key].title) delete log[media_key].title;
        const sortedLog = Object.fromEntries(
            Object.entries(log).sort(([, a], [, b]) => moment(b.time, 'YYYY-MM-DD hh:mm:ssa').diff(moment(a.time, 'YYYY-MM-DD hh:mm:ssa')))
        );
        saveFile(logPath, sortedLog);
       // console.log(`Log updated: ${JSON.stringify(log[media_key])}`);
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
            return !isWatched(percent, 50); // Using 50% alternative threshold
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
        // Optional bitrate/resolution caps via query
        const qBitrate = parseInt(req.query.maxVideoBitrate, 10);
        const qResolution = req.query.maxResolution ?? req.query.maxVideoResolution;
        const qSession = req.query.session;
        const opts = {};
        if (Number.isFinite(qBitrate)) {
            opts.maxVideoBitrate = qBitrate;
        }
        if (typeof qResolution === 'string' && qResolution.length) {
            opts.maxResolution = qResolution;
            opts.maxVideoResolution = qResolution;
        }
        if (typeof qSession === 'string' && qSession.length) {
            opts.session = qSession;
        }
    
    let infos = [];
    for (const key of plex_keys) {
        const info = await (new Plex()).loadPlayableItemFromKey(key, shuffle, opts);
        infos.push(info);
    }
    //pick one
    const plexInfo = infos[Math.floor(Math.random() * infos.length)] || {};
    plexInfo['image'] = handleDevImage(req, plexInfo.image || `${host}/media/plex/img/notfound.png`);
    
    try {
        res.json(plexInfo);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message });
    }
});

export const handleDevImage = (req,image) => {
    if (!image) return null; // Return null for undefined/empty images
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
    let librarySection = null;
    let plexInfo = null;
    
    // Get info for the first plex_key (show-level metadata, not episode)
    if (plex_keys.length > 0) {
        try {
            const plexInstance = new Plex();
            const [showMeta] = await plexInstance.loadMeta(plex_keys[0]);
            if (showMeta) {
                plexInfo = {
                    key: showMeta.ratingKey,
                    type: showMeta.type,
                    title: showMeta.title,
                    summary: showMeta.summary,
                    year: showMeta.year,
                    studio: showMeta.studio,
                    tagline: showMeta.tagline,
                    labels: showMeta.Label ? showMeta.Label.map(l => l.tag) : [],
                    collections: showMeta.Collection ? showMeta.Collection.map(c => c.tag) : [],
                    image: handleDevImage(req, plexInstance.thumbUrl(showMeta.thumb) || `${process.env.host}/media/plex/img/notfound.png`)
                };
                
                // Remove any undefined/falsey keys
                Object.keys(plexInfo).forEach(key => {
                    if (plexInfo[key] == null || plexInfo[key] === "") {
                        delete plexInfo[key];
                    }
                });
            }
        } catch (error) {
            console.error('Error loading plex info:', error);
        }
    }
    
    for (const plex_key of plex_keys) {
        try {
            const result = await (new Plex()).loadChildrenFromKey(plex_key, playable, shuffle);
            
            // Handle case where Plex item is not found or invalid
            if (!result || result.error) {
                console.warn(`⚠️ Plex item not found or invalid: ${plex_key}`, result?.error || 'Unknown error');
                continue; // Skip this item and continue with the next one
            }
            
            const {list: items = [], plex, title, image} = result;
            
            // Debug: log the first item to see available fields
            if (items && items.length > 0) {
                console.log('🎬 DEBUG: First item from plex.loadChildrenFromKey:', JSON.stringify(items[0], null, 2));
            }
            
            // Only process if we have valid items
            if (items && Array.isArray(items)) {
                list = list.concat(items);
            }
            
            // Update info only if we have valid data
            if (plex || title || image) {
                info = {
                    plex: info.plex && plex ? `${info.plex},${plex}` : (info.plex || plex),
                    title: info.title && title ? `${info.title} • ${title}` : (info.title || title),
                    image: info.image && image ? handleDevImage(req, `${info.image}`) : (image ? handleDevImage(req, image) : info.image)
                };
            }
            
            // Get library section for the first plex key to determine correct category
            if (!librarySection && plex_key) {
                try {
                    const plexInstance = new Plex();
                    const metaResult = await plexInstance.loadMeta(plex_key);
                    const [meta] = metaResult || [];
                    librarySection = meta && meta.librarySectionTitle ? slugify(meta.librarySectionTitle) : null;
                } catch (metaError) {
                    console.warn(`⚠️ Failed to get library section for ${plex_key}:`, metaError.message);
                }
            }
        } catch (error) {
            console.error(`❌ Error processing Plex key ${plex_key}:`, error.message);
            console.error('Stack trace:', error.stack);
            // Continue processing other items instead of crashing
            continue;
        }
    }
    
    const list_keys = list.map(item => item.key || item.plex || item.media_key).filter(Boolean);
    const category = librarySection ? `plex/${librarySection}` : "plex";
    const unwatched_keys = findUnwatchedItems(list_keys, category, shuffle);
    // We will handle filtering history later, not needed for menu lists where this is used
    const unwatchedList = list; //list.filter(item => unwatched_keys.includes(item.key || item.plex || item.media_key));
    // Prepare Plex instance for building thumb URLs (season thumbnails)
    const plexThumb = new Plex();
    const viewingHistory = plexThumb.loadPlexViewingHistory();
    
    // Debug logging for history lookup
    const historyKeys = Object.keys(viewingHistory);
    console.log(`Loaded ${historyKeys.length} history items. Sample keys: ${historyKeys.slice(0, 5).join(', ')}`);

    list = unwatchedList.map(({key,plex,type,title,image,parent,parentTitle,parentRatingKey,summary,index,duration,parentThumb,grandparentThumb,parentIndex,userRating,thumb_id,artist,albumArtist,album,grandparentTitle,originalTitle}) => {
        const item = {
            label: title,
            title: title,
            type: type,
            plex: key || plex,
            image: handleDevImage(req, image),
            thumb_id
        };

        const watchData = viewingHistory[item.plex] || viewingHistory[String(item.plex)];
        if (watchData) {
            item.watchProgress = parseFloat(watchData.percent) || 0;
            item.watchSeconds = parseInt(watchData.seconds) || 0;
            item.watchedDate = watchData.time;
            const watchedDurationValue = parseFloat(watchData.watched_duration);
            if (!Number.isNaN(watchedDurationValue) && watchedDurationValue >= 0) {
                item.watchDurationSeconds = watchedDurationValue;
            }
        } else {
             // console.log(`No history for ${item.plex} (type: ${typeof item.plex})`);
        }
        
        // Add music-specific metadata for tracks
        if (type === 'track') {
            if (artist || grandparentTitle) item.artist = artist || grandparentTitle;
            if (albumArtist || originalTitle) item.albumArtist = albumArtist || originalTitle;
            if (album || parentTitle) item.album = album || parentTitle;
            if (parentTitle) item.parentTitle = parentTitle;
            if (grandparentTitle) item.grandparentTitle = grandparentTitle;
        }
        
        // Add query params at the end so they don't override metadata
        Object.assign(item, req.query);
        
        // Add duration for all items (in seconds)
        if (duration) {
            item.duration = parseInt(duration / 1000); // Convert from milliseconds to seconds
        }
        
        // Add episode-specific information
        if (type === 'episode') {
            // Add episode description (summary)
            if (summary) {
                item.episodeDescription = summary;
            }
            
            // Add episode number (index) as integer (even if 0)
            if (index !== undefined && index !== null) {
                const num = parseInt(index);
                if (!Number.isNaN(num)) item.episodeNumber = num;
            }

            
            
            // Add season information
            if (parent || parentTitle || parentRatingKey) {
                item.seasonId = parent || parentRatingKey;
                item.seasonName = parentTitle;
                // Prefer Plex's parentIndex as the numeric season number
                if (parentIndex !== undefined && parentIndex !== null) {
                    const sNum = parseInt(parentIndex);
                    if (!Number.isNaN(sNum)) item.seasonNumber = sNum;
                }
                // Extract season number from season name or index if available
                if (item.seasonNumber == null && parentTitle) {
                    const seasonMatch = parentTitle.match(/season\s*(\d+)/i);
                    if (seasonMatch) {
                        item.seasonNumber = parseInt(seasonMatch[1]);
                    } else if (parentTitle.toLowerCase().includes('season')) {
                        // Try to extract number from various season formats
                        const numberMatch = parentTitle.match(/(\d+)/);
                        if (numberMatch) {
                            item.seasonNumber = parseInt(numberMatch[1]);
                        }
                    }
                }
            }

            // Add season thumbnail URL when available (prefer parentThumb)
            const seasonThumbPath = parentThumb || grandparentThumb;
            if (seasonThumbPath) {
                try {
                    item.seasonThumbUrl = handleDevImage(
                        req,
                        plexThumb.thumbUrl(seasonThumbPath) || `${process.env.host}/media/plex/img/notfound.png`
                    );
                } catch (e) {
                    // noop; do not block response on thumbnail issues
                }
            }
        }
        
        // For shows, expose integer rating from Plex userRating
        if (type === 'show' && userRating != null) {
            const parsed = parseInt(userRating, 10);
            if (!Number.isNaN(parsed)) {
                item.rating = parsed;
            }
        }
        
        return item;
    });
    // Build seasons map if episodes are present
    let seasons = null;
    try {
        const episodeItems = list.filter(i => i.type === 'episode');
        if (episodeItems.length) {
            const uniqueSeasonIds = [...new Set(episodeItems.map(i => i.seasonId).filter(Boolean))];
            if (uniqueSeasonIds.length) {
                const plexInstance = new Plex();
                seasons = {};
                // Fetch metadata for each season to enrich description & canonical thumb
                const seasonMetaArray = await Promise.all(uniqueSeasonIds.map(async sid => {
                    try {
                        const [meta] = await plexInstance.loadMeta(sid);
                        return { sid, meta };
                    } catch (e) {
                        return { sid, meta: null };
                    }
                }));
                for (const { sid, meta } of seasonMetaArray) {
                    // Find one representative episode item for fallback values
                    const sample = episodeItems.find(i => i.seasonId === sid) || {};
                    // Prefer meta fields, fallback to episode derived fields
                    const seasonNumber = (meta && (meta.index != null)) ? parseInt(meta.index) : sample.seasonNumber;
                    const title = (meta && meta.title) || sample.seasonName || `Season ${seasonNumber || ''}`.trim();
                    const img = handleDevImage(req, (meta && plexThumb.thumbUrl(meta.thumb)) || sample.seasonThumbUrl || `${process.env.host}/media/plex/img/notfound.png`);
                    const summary = (meta && meta.summary) || null;
                    seasons[sid] = {
                                num:seasonNumber,
                                title,
                               img,
                               summary,
                    };
                    if(!seasons[sid].summary) delete seasons[sid].summary;
                }
                // Remove season detail fields from episode items (leave seasonId only for mapping)
                for (const ep of episodeItems) {
                    delete ep.seasonName;
                    delete ep.seasonNumber;
                    delete ep.seasonThumbUrl;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to build seasons map:', e.message);
    }
    try {
        const responseData = {...info};
        if (plexInfo) {
            responseData.info = plexInfo;
        }
        if (seasons) {
            responseData.seasons = seasons; // Insert seasons before items
        }
        responseData.items = applyParamsToItems(list);
        
        // Temporary Debugging
        responseData._debug = {
            dataPath: process.env.path.data,
            historyCount: Object.keys(viewingHistory).length,
            sampleKeys: Object.keys(viewingHistory).slice(0, 5),
            firstItemPlex: list[0]?.plex,
            firstItemHistory: viewingHistory[list[0]?.plex] || viewingHistory[String(list[0]?.plex)]
        };

        res.json(responseData);
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
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message });
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