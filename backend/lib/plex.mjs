import axios from 'axios';
import { loadFile, saveFile } from '../lib/io.mjs';
import { clearWatchedItems } from '../fetch.mjs';
import fs from 'fs';


function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }

export class Plex {
  constructor() {
    const { plex: {  host, port }, PLEX_TOKEN:token } = process.env;
    this.token = token;
    this.host = host;
    this.port = port;
    this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
  }
  async fetch(paramString) {
    let url = `${this.baseUrl}/${paramString}`;
    try {
      if (!/\?/.test(paramString)) url += '?1=1';
      url += `&X-Plex-Token=${this.token}`;
      //console.log(`Fetching Plex API: ${url}`);
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching data from Plex API: ${error.message}`);
      console.error(`URL: ${url}`); 
      return null; // Return null to indicate failure
    }
  }

  async loadmedia_url(itemData, attempt = 0) {
    const plex = itemData?.plex || itemData?.ratingKey;
    if(!attempt >= 1) console.log("Attempting to load media URL for itemData: " , plex);
    itemData = typeof itemData === 'string' ?( await this.loadMeta(itemData))[0] : itemData;
    const {host, plex: { host:plexHost,  session, protocol, platform },PLEX_TOKEN:token } = process.env;
    const plexProxyHost = `${host || ""}/plex_proxy`;
    const { ratingKey:key, type } = itemData;
    if(!["episode", "movie", "track"].includes(type)) {
      const {list} = await this.loadListFromKey(key);
      const [item] = this.selectKeyToPlay(list);
      return await this.loadmedia_url(item.key || item);
    }
    const media_type = this.determinemedia_type(type);
    try {
      if (media_type === 'audio') {
      const mediaKey = itemData?.Media?.[0]?.Part?.[0]?.key;
      if (!mediaKey) throw new Error("Media key not found for audio.");
      return `${plexProxyHost}${mediaKey}`;
      } else {
        if (!key) throw new Error("Rating key not found for video.");
        const url =  `${plexProxyHost}/video/:/transcode/universal/start.mpd?path=%2Flibrary%2Fmetadata%2F${key}&protocol=${protocol}&X-Plex-Client-Identifier=${session}&maxVideoBitrate=5000&X-Plex-Platform=${platform}`;
        const isValid = await axios.get(url).then((response) => {
          return response.status >= 200 && response.status < 300;
        }).catch(() => false);
        if(isValid || attempt > 10) return url;
        else return await this.loadmedia_url(itemData, attempt + 1);
      }
    } catch (error) {
      console.error("Error generating media URL:", error.message);
      return null;
    }
  }

  async loadMeta(plex, type = '') {
    const response =  await this.fetch(`library/metadata/${plex}${type}`);
    const meta =   (response?.MediaContainer?.Metadata || []).map((item) => {
      if(!item) return false;
      item['plex'] = item.ratingKey;
      item['labels'] = item.Label? item.Label.map(x => x['tag'].toLowerCase()) : [];  
      return item;
    }
    );

    return meta;
  }
  async loadChildrenFromKey(plex, playable = false, shuffle = false) {
    if (!plex) return { plex: false, list: [] };
    const [{ title, thumb, type, labels }] = await this.loadMeta(plex) || [{}];
    shuffle = shuffle || labels.includes('shuffle');
    const image = this.thumbUrl(thumb);
    const {list} = await this.loadListFromKey(plex, playable, shuffle);
    return { plex, type, title, image, list };
  }

  async loadListFromKey(plex = false, playable=false, shuffle = false) {
    const [data] = await this.loadMeta(plex);
    if (!data) return false;
    const { type, title } = data;
    let list = [];
    if (type === 'playlist') list = await this.loadListFromPlaylist(plex); //video 12944 audio 321217
    else if (type === 'collection') list = await this.loadListFromCollection(plex, playable); //598767
    else if (type === 'season') list = await this.loadListFromSeason(plex); //598767
    else if (type === 'show') list = await this.loadListFromShow(plex,playable); //598748
    else if (type === 'artist') list = await this.loadListFromArtist(plex,playable); //575855
    else if (type === 'album') list = await this.loadListFromAlbum(plex); //575876
    else list = (await this.loadListKeys(plex)); // Fallback to metadata if no specific list type
    list = shuffle ? list.sort(() => Math.random() - 0.5) : list;
    return { plex, type, list };
  }
  async loadListKeys(input, path) {
    const items = (await this.loadMeta(input, path))?.map(({ plex,ratingKey, parentRatingKey,parentTitle, grandparentRatingKey, grandparentTitle, title,summary, type, thumb })=>{
      return { plex:plex ||ratingKey,title, parent:parentRatingKey, parentTitle, grandparent: grandparentRatingKey, grandparentTitle, type, summary, image: this.thumbUrl(thumb) }
    }) || [];
    return items.length ? items : [];
  }
  async loadImgFromKey(plex) {
    let response = await this.loadMeta(plex);
    const data = response?.[0] || response || null;
    const {thumb, parentThumb, grandparentThumb} = data || {};
    return [thumb, parentThumb, grandparentThumb].map(x => this.thumbUrl(x));
    return false; 
  }

  async loadListFromAlbum(plex) {
    return this.loadListKeys(plex,'/children');
  }
  async loadListFromSeason(plex) {
    return this.loadListKeys(plex,'/children');
  }
  async loadListFromCollection(plex, playable = false) {
    const collection = await this.fetch(`library/collections/${plex}/items`);
    const items = await Promise.all(
      collection.MediaContainer.Metadata.map(async ({ ratingKey, title, thumb, type }) => {
        const item = { plex: ratingKey, title, type, art: this.thumbUrl(thumb) };
        if (["show", "artist", "album"].includes(type)) {
          const subItems = await this.loadListKeys(item.plex, '/children');
          return subItems;
        }
        return item;
      })
    );

    // Flatten the list
    const flatItems = items.flat();
    return flatItems;
  }
  async loadListFromShow(plex, playable = false) {
    return this.loadListKeys(plex,playable ? '/grandchildren' : '/children');
  }
  async loadListFromArtist(plex, playable = false) {
    return this.loadListKeys(plex, playable ? '/grandchildren' : '/children');
  }
  async loadListFromPlaylist(plex) {
    const playlist = await this.fetch(`playlists/${plex}/items`);
    const items = playlist.MediaContainer.Metadata.map(({ ratingKey, title, thumb }) => {
      return { plex:ratingKey, title, art: this.thumbUrl(thumb) };
    });
    return items;
  }
  async loadListKeysFromPlaylist(plex) {
    const items = await this.loadListFromPlaylist(plex);
    return items?.map(({ plex}) => plex);
  }

  determinemedia_type(type) {
    const videoTypes = ['movie', 'episode', 'clip', 'short', 'trailer', 'season', 'show'];
    const audioTypes = ['track', 'album', 'artist'];
    if(videoTypes.includes(type)) return 'dash_video';
    if(audioTypes.includes(type)) return 'audio';
    else return type; // Return the type as is for other cases
  }



  // Helper that takes Plex metadata, plus extra info, and returns a “playable” object
  async buildPlayableObject(itemData, parentKey, parentType, percent = 0, seconds = 0) {
    if (!itemData) {
      return null;
    }

    const { title, type, parentTitle, grandparentTitle, summary, year, thumb } = itemData;
    const media_url = await this.loadmedia_url(itemData);

    // Construct the 'playable item' result
    const result = {
      listkey: parentKey,
      listType: parentType,
      key: itemData.ratingKey,
      type,
      title: title || parentTitle || grandparentTitle,
      artist: type === 'track' ? itemData.grandparentTitle : undefined,
      albumArtist: type === 'track' ? itemData.originalTitle : undefined,
      album: type === 'track' ? itemData.parentTitle : undefined,
      show: type === 'episode' ? itemData.grandparentTitle : undefined,
      season: type === 'episode' ? itemData.parentTitle : undefined,
      summary: summary || "",
      tagline: itemData.tagline || "",
      studio: itemData.studio || "",
      year: year || "",
      media_type: this.determinemedia_type(type),
      media_url,
      image: this.thumbUrl(thumb),
      percent: percent || 0,
      seconds: seconds || 0,
    };

    // Remove any undefined/falsey keys
    Object.keys(result).forEach(key => {
      if (result[key] == null || result[key] === "") {
        delete result[key];
      }
    });

    return result;
  }

  // Returns a single playable item
  async loadPlayableItemFromKey(key, shuffle = false) {
    // Get the "list" from the key
    const { type: parentType, list } = await this.loadListFromKey(key, shuffle);
    // Pick one item from the list (or strings)
    const [selectedKey, seconds,percent] = this.selectKeyToPlay(list, shuffle);
    if (!selectedKey) return false;
    // Load its metadata
    const [itemData] = await this.loadMeta(selectedKey.plex || selectedKey);
    if (!itemData) {
      return false;
    }

    // Build playable object with the shared helper
    const playableItem = await this.buildPlayableObject(itemData, key, parentType, percent, seconds);
    return playableItem;
  }

  // Returns an array of playable items
  async loadPlayableQueueFromKey(key, shuffle = false) {
    // Retrieve the "list" from the key 
    const { type: parentType, list } = await this.loadListFromKey(key, shuffle);

    // We'll accumulate a playable object for each item
    const playableArray = [];
    for (const listItem of list) {
      // Some "list" entries might be strings, others might be objects with .key
      const ratingKey = typeof listItem === 'string' ? listItem : listItem.key;
      if (!ratingKey) continue;

      const [itemData] = await this.loadMeta(ratingKey);
      if (!itemData) continue;

      // We can pass percent=0 or track real progress if you wish
      const playableObject = await this.buildPlayableObject(itemData, key, parentType, 0);
      if (playableObject) {
        playableArray.push(playableObject);
      }
    }

    return playableArray; // Now you have multiple playable items
  }

  getMediaArray(item) {
    if (item?.['@attributes']) return [item];
    return item;
  }

  async loadSingleFromCollection(key, shuffle) {
    const data = await this.loadMeta(key, '/children');
    let videoArray = this.getMediaArray(data.Video || []);
    const keys = videoArray.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }

  async loadSingleFromArtist(key, shuffle) {
    const data = await this.loadMeta(key, '/grandchildren');
    let trackArray = this.getMediaArray(data.Track || []);
    const keys = trackArray.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }

  async loadSingleFromAlbum(key, shuffle) {
    const data = await this.loadMeta(key, '/children');
    let trackArray = this.getMediaArray(data.Track || []);
    const keys = trackArray.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }

  async loadSingleFromSeason(key, shuffle) {
    const data = await this.loadMeta(key, '/children');
    let videoArray = this.getMediaArray(data.Video || []);
    const keys = videoArray.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }

  async loadSingleFromPlaylist(key, shuffle) {
    const data = await this.fetch(`playlists/${key}/items`);
    let items = data.Video || data.Track || [];
    if (!Array.isArray(items)) items = [items];
    const keys = items.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }

  async loadSingleFromShow(key, shuffle) {
    const data = await this.loadMeta(key, '/grandchildren');
    let videoArray = this.getMediaArray(data.Video || []);
    const keys = videoArray.map(x => x.ratingKey);
    return this.selectKeyToPlay(keys, shuffle);
  }
  selectKeyToPlay(keys, shuffle = false) {
    // Normalize keys array
    keys = keys?.[0]?.plex ? keys.map(x => x.plex) : keys || [];
    if (keys.length === 0) return [null, 0, 0];

    // Load viewing history from all plex library logs
    const log = this.loadPlexViewingHistory();
    
    // Debug output
    console.log(`selectKeyToPlay: Loaded ${Object.keys(log).length} history entries for ${keys.length} keys`);
    
    // Categorize episodes by viewing status
    const watched = keys.filter(key => log[key]?.percent >= 90);
    const inProgress = keys.filter(key => log[key]?.percent > 0 && log[key]?.percent < 90);
    const unwatched = keys.filter(key => !log[key]?.percent);

    console.log(`selectKeyToPlay: Watched: ${watched.length}, In Progress: ${inProgress.length}, Unwatched: ${unwatched.length}`);

    // Sequential selection logic
    return this.selectEpisodeByPriority(unwatched, inProgress, watched, log, shuffle);
  }

  loadPlexViewingHistory() {
    const plexLogDir = `${process.env.path.data}/history/media_memory/plex`;
    let log = {};

    if (!fs.existsSync(plexLogDir)) {
      console.log(`selectKeyToPlay: History directory ${plexLogDir} does not exist`);
      return log;
    }

    const files = fs.readdirSync(plexLogDir);
    for (const file of files) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        const libraryLog = loadFile(`history/media_memory/plex/${file.replace(/\.ya?ml$/, '')}`);
        if (libraryLog) {
          log = { ...log, ...libraryLog };
        }
      }
    }

    return log;
  }

  selectEpisodeByPriority(unwatched, inProgress, watched, log, shuffle) {
    // Priority 1: First unwatched episode in sequence
    if (unwatched.length > 0) {
      const selected = shuffle ? unwatched[Math.floor(Math.random() * unwatched.length)] : unwatched[0];
      console.log(`selectKeyToPlay: Selected unwatched episode: ${selected}`);
      return [selected, 0, 0];
    }

    // Priority 2: First in-progress episode in sequence
    if (inProgress.length > 0) {
      const selected = shuffle ? inProgress[Math.floor(Math.random() * inProgress.length)] : inProgress[0];
      const { seconds = 0, percent = 0 } = log[selected] || {};
      console.log(`selectKeyToPlay: Selected in-progress episode: ${selected} at ${percent}%`);
      return [selected, seconds, percent];
    }

    // Priority 3: Restart from first watched episode (clear watch status)
    if (watched.length > 0) {
      clearWatchedItems(watched, "plex");
      const selected = watched[0];
      const { seconds = 0, percent = 0 } = log[selected] || {};
      console.log(`selectKeyToPlay: All episodes watched, restarting from: ${selected}`);
      return [selected, seconds, percent];
    }

    console.log(`selectKeyToPlay: No episodes found`);
    return [null, 0, 0];
  }

  async loadSingleFromWatchlist(watchlist) {
    let log = loadFile("history/media_memory/plex") || {};
    let watchlists = loadFile("config/watchlists");
    let list = watchlists[watchlist];
    if (!list) return [];
    let candidates = { normal: {}, urgent: {}, in_progress: {} };
    for (let plexkey in list) {
      let item = list[plexkey];
      let percent = log[plexkey]?.percent || 0;
      percent = percent > 15 ? percent : 0; // need seconds: TODO
      if (percent > 90) continue;
      if (item.watched) continue;
      if (item.hold) continue;
      if (item.skip_after) {
        let skipAfter = new Date(item.skip_after);
        let today = new Date();
        if (skipAfter <= today) continue;
      }
      if (item.wait_until) {
        let waitUntil = new Date(item.wait_until);
        let next2 = new Date();
        next2.setDate(next2.getDate() + 2);
        if (waitUntil >= next2) continue;
      }
      let priority = "normal";
      if (item.skip_after) {
        let skipAfter = new Date(item.skip_after);
        let eightDays = new Date();
        eightDays.setDate(eightDays.getDate() + 8);
        if (skipAfter <= eightDays) priority = "urgent";
      }
      if (percent > 0) priority = "in_progress";
      let show = item.uid;
      if (!candidates[priority][item.program]) candidates[priority][item.program] = {};
      candidates[priority][item.program][item.index] = [plexkey, item.uid, progress];
    }
    let urgentCount = Object.keys(candidates.urgent).length;
    let inprogressCount = Object.keys(candidates.in_progress).length;
    let chosen;
    if (inprogressCount > 0) chosen = candidates.in_progress;
    else if (urgentCount > 0) chosen = candidates.urgent;
    else {
      let priorities = Object.keys(candidates);
      shuffleArray(priorities);
      chosen = candidates[priorities[0]];
    }
    let arr = Object.values(chosen);
    shuffleArray(arr);
    let program = arr[0];
    let sortedKeys = Object.keys(program).sort((a, b) => parseInt(a) - parseInt(b));
    let values = sortedKeys.map(k => program[k]);
    let [selectedKey, uid] = values[0];
    let seekTo = 0;
    if (log[selectedKey]?.seconds && log[selectedKey].seconds < 90) {
      seekTo = log[selectedKey].seconds;
    }
    return [selectedKey, seekTo, uid];
  }

  async loadEpisode(key) {
    const data = await this.loadMeta(key, '');
    let info = data.Video;
    let out = info || {};
    out.image = this.thumbUrl(out.parentThumb);
    return out;
  }

  async loadMovie(key) {
    const data = await this.loadMeta(key, '');
    let info = data.Video;
    let out = info || {};
    out.image = this.thumbUrl(out.thumb);
    return out;
  }

  async loadAudioTrack(key) {
    const data = await this.loadMeta(key, '');
    let track = data.Track || {};
    let id = track.Media?.Part?.id;
    let path = track.Media?.Part?.key;
    let out = track;
    out.image = this.thumbUrl(track.parentThumb);
    out.path = path;
    out.id = id;
    return out;
  }

  async loadShow(key) {
    const [show] = await this.loadMeta(key, '');
    let out = {
      ratingKey: show.ratingKey,
      studio: show.studio,
      title: show.title,
      titleSort: show.titleSort,
      summary: show.summary,
      year: show.year,
      originallyAvailableAt: show.originallyAvailableAt
    };
    out.path = show.Location?.path || "";
    out.genre = this.flattenTags(show.Genre);
    out.director = this.flattenTags(show.Director);
    out.cast = this.flattenTags(show.Role);
    out.collection = this.flattenTags(show.Collection);
    out.art = (show.thumb || "").replace(/.*\/(\d+)$/, '$1');
    const seasondata = await this.loadMeta(key, '/children');
    let dirs = seasondata.Directory;
    if (dirs && !Array.isArray(dirs)) dirs = [dirs];
    let seasons = [];
    if (dirs) {
      for (let item of dirs) {
        if (!item.ratingKey) continue;
        seasons.push({
          ratingKey: item.ratingKey,
          index: item.index,
          title: item.title,
          summary: item.summary,
          thumb: item.thumb
        });
      }
    }
    out.seasons = seasons;
    return out;
  }

  artUrl(item, id, type = 'art') {
    let paramString = `library/metadata/${item}/${type}/${id}`;
    return `/plex_proxy/${paramString}`;
  }
  thumbUrl(paramString) {
    if (!paramString) return "";
    let symb = /\?/.test(paramString) ? '&' : '?';

    return `/plex_proxy${paramString}`;

    let url = `${this.baseUrl}${paramString}${symb}X-Plex-Token=${this.token}`;
    // Ensure the URL does not contain duplicate "http" segments
    return url.replace(/(http.*?:\/\/).*?\1/, '$1');
  }

  pruneArray(arr, blacklist = []) {
    for (let b of blacklist) {
      delete arr[b];
    }
    return arr;
  }

  pickArray(array, whitelist = []) {
    let out = {};
    for (let w of whitelist) {
      out[w] = array[w];
      if (w === 'thumb') {
        out[w] = (array[w] || "").replace(/.*\/(\d+)$/, '$1');
      }
    }
    return out;
  }

  flattenTags(items, leaf = 'tag') {
    if (!items) return "";
    if (!Array.isArray(items)) items = [items];
    let out = [];
    for (let i of items) {
      out.push(i[leaf]);
    }
    return out.join(", ");
  }

  async loadSinglePlayableItem(metadataId) {
    const itemData = await this.fetch(`library/metadata/${metadataId}`);
    if (itemData.Video?.type === "episode") return this.loadEpisode(metadataId);
    if (itemData.Video?.type === "movie") return this.loadMovie(metadataId);
    if (itemData.Track?.type === "track") return this.loadAudioTrack(metadataId);
    return false;
  }

  async loadArtistAlbums(metadataId) {
    const albums = await this.fetch(`library/metadata/${metadataId}/children?limit=3000&group=title&sort=ratingCount:desc`);
    return albums.Directory;
  }

  async loadArtist(metadataId) {
    const meta = await this.fetch(`library/metadata/${metadataId}?includePopularLeaves=0&limit=3000`);
    const artist = await this.fetch(`library/metadata/${metadataId}/grandchildren?limit=3000&group=title&sort=ratingCount:desc`);
    let tracks = artist.Track || [];
    if (!Array.isArray(tracks)) tracks = [tracks];
    return { meta: meta.Directory, tracks: this.loadTracks(tracks, metadataId) };
  }

  loadTrack(track, artistId = 0) {
    let attrs = track['@'] || track;
    return {
      id: attrs.ratingKey,
      artist: attrs.grandparentTitle,
      track_artist: attrs.originalTitle,
      artist_id: attrs.grandparentRatingKey,
      album: attrs.parentTitle,
      album_id: attrs.parentRatingKey,
      title: attrs.title,
      track_no: attrs.index,
      disc_no: attrs.parentIndex,
      summary: attrs.summary,
      media_id: track.Media?.id,
      media_part_id: track.Media?.Part?.id,
      url: track.Media?.Part?.key,
      duration: track.Media?.Part?.duration,
      path: track.Media?.Part?.file
    };
  }

  loadTracks(tracks, artistId = 0) {
    let out = [];
    if (!Array.isArray(tracks)) tracks = [tracks];
    for (let t of tracks) {
      out.push(this.loadTrack(t, artistId));
    }
    return out;
  }
}
