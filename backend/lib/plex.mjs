
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { loadFile, saveFile } from '../lib/io.mjs';


function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }

export class Plex {
  constructor() {
    const { plex: { token, host, port } } = process.env;
    this.token = token;
    this.host = host;
    this.port = port;
    this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
  }
  async fetch(paramString) {
    try {
      let url = `${this.baseUrl}/${paramString}`;
      if (!/\?/.test(paramString)) url += '?1=1';
      url += `&X-Plex-Token=${this.token}`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching data from Plex API: ${error.message}`);
      return null; // Return null to indicate failure
    }
  }

  async loadMediaUrl(itemData) {
    itemData = typeof itemData === 'string' ?( await this.loadMeta(itemData))[0] : itemData;
    const { plex: { host, token, session, protocol, platform } } = process.env;
    const { ratingKey:key, type } = itemData

    if(!["episode", "movie", "track"].includes(type)) {
      //treat as list
      const {list} = await this.loadListFromKey(key);
      const [item] = this.selectKeyToPlay(list);
      
      return await this.loadMediaUrl(item.key || item);
    }
    const mediaType = this.determineMediaType(type);
    try {
      if (mediaType === 'audio') {
      const mediaKey = itemData?.Media?.[0]?.Part?.[0]?.key;
      if (!mediaKey) throw new Error("Media key not found for audio.");
      return `${host}${mediaKey}?X-Plex-Token=${token}`;
      } else {
      if (!key) throw new Error("Rating key not found for video.");
      return `${host}/video/:/transcode/universal/start.mpd?path=%2Flibrary%2Fmetadata%2F${key}&protocol=${protocol}&X-Plex-Client-Identifier=${session}&maxVideoBitrate=3000&X-Plex-Platform=${platform}&X-Plex-Token=${token}`;
      }
    } catch (error) {
      console.error("Error generating media URL:", error.message);
      return null;
    }

  }

  async loadMeta(key, type = '') {
    const response =  await this.fetch(`library/metadata/${key}${type}`);
    return  response?.MediaContainer?.Metadata || [];
  }

  async loadChildrenFromKey(key, shuffle = false) {
    if(!key) return {key: false, list: []};
    const [{title,thumb}] = await this.loadMeta(key);
    const img = this.thumbUrl(thumb);
    let list = await this.loadListKeys(key, '/children');
    list = shuffle ? list.sort(() => Math.random() - 0.5) : list;
    return { key, title, img, list };
  }

  async loadListFromKey(key = false, shuffle = false) {
    const [data] = await this.loadMeta(key);
    if (!data) return false;
    const { type, title } = data;
    //console.log({ key, title, type });
    let list;
    if (type === 'playlist') list = await this.loadListFromPlaylist(key); //video 12944 audio 321217
    else if (type === 'collection') list = await this.loadListFromCollection(key);
    else if (type === 'season') list = await this.loadListFromSeason(key); //598767
    else if (type === 'show') list = await this.loadListFromShow(key); //598748
    else if (type === 'artist') list = await this.loadListFromArtist(key); //575855
    else if (type === 'album') list = await this.loadListFromAlbum(key); //575876
    else list = [key]; //movie: 52769
    list = shuffle ? list.sort(() => Math.random() - 0.5) : list;
    return { key, type, list };
  }
  async loadListKeys(key, path) {
    const keys = (await this.loadMeta(key, path))?.map(({ ratingKey, title, thumb })=>{
      return { key:ratingKey, title, img: this.thumbUrl(thumb) }
    }) || [];
    return keys.length ? keys : [];
  }

  async loadImgFromKey(key) {
    const [data] = await this.loadMeta(key);
    return this.thumbUrl(data.thumb);
  }

  async loadListFromAlbum(key) {
    return this.loadListKeys(key,'/children');
  }
  async loadListFromSeason(key) {
    return this.loadListKeys(key,'/children');
  }
  async loadListFromCollection(key) {
    return this.loadListKeys(key,'/children');
  }
  async loadListFromShow(key) {
    return this.loadListKeys(key,'/grandchildren');
  }
  async loadListFromArtist(key) {
    return this.loadListKeys(key,'/grandchildren');
  }
  async loadListFromPlaylist(key) {
    const playlist = await this.fetch(`playlists/${key}/items`);
    const keys = playlist.MediaContainer.Metadata.map(({ ratingKey, title, thumb }) => {
      return { ratingKey, title, art: this.thumbUrl(thumb) };
    });
    return keys;
  }

  determineMediaType(type) {
    const videoTypes = ['movie', 'episode', 'clip', 'short', 'trailer'];
    const audioTypes = ['track', 'album', 'artist'];
    if(videoTypes.includes(type)) return 'video';
    if(audioTypes.includes(type)) return 'audio';
    else return null
  }



  // Helper that takes Plex metadata, plus extra info, and returns a “playable” object
  async buildPlayableObject(itemData, parentKey, parentType, progress = 0) {
    if (!itemData) {
      return null;
    }

    const { title, type, parentTitle, grandparentTitle, summary, year, thumb } = itemData;
    const mediaUrl = await this.loadMediaUrl(itemData);

    // Construct the 'playable item' result
    const result = {
      listkey: parentKey,
      listType: parentType,
      key: itemData.ratingKey,
      type,
      title: title || parentTitle || grandparentTitle,
      artist: type === 'track' ? itemData.grandparentTitle : undefined,
      album: type === 'track' ? itemData.parentTitle : undefined,
      show: type === 'episode' ? itemData.grandparentTitle : undefined,
      season: type === 'episode' ? itemData.parentTitle : undefined,
      summary: summary || "",
      tagline: itemData.tagline || "",
      studio: itemData.studio || "",
      year: year || "",
      mediaType: this.determineMediaType(type),
      mediaUrl,
      img: this.thumbUrl(thumb),
      progress: progress || 0
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
    const [selectedKey, progress] = this.selectKeyToPlay(list, shuffle);
    if (!selectedKey) return false;

    // Load its metadata
    const [itemData] = await this.loadMeta(selectedKey);
    if (!itemData) {
      return false;
    }

    // Build playable object with the shared helper
    const playableItem = await this.buildPlayableObject(itemData, key, parentType, progress);
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

      // We can pass progress=0 or track real progress if you wish
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
    keys = keys?.[0]?.key ? keys.map(x => x.key) : keys || [];
    let log = loadFile("_media_memory")?.plex || {};

    const watched = keys.filter(key => log[key]?.percent >= 90).sort((a, b) => log[b].time - log[a].time);
    const inProgress = keys.filter(key => log[key]?.percent > 0 && log[key]?.percent < 90).sort((b, a) => log[b].percent - log[a].percent);

    //console.log({ keys, watched, inProgress });
    const unwatched = keys.filter(key => !log[key]?.percent) || [];
    

    if(inProgress.length > 0) return [inProgress[0], log[inProgress[0]].percent];
    if (unwatched.length === 0) return [watched[0], log[watched[0]].percent];
    
    const sortFunction = shuffle ? () => Math.random() - 0.5 : ()=>true;
    const queue = unwatched.sort(sortFunction);
    if (queue.length === 0) return [watched[0], log[watched[0]].percent];
    const [selected] = queue;
    let time = log[selected]?.percent || 0;
    return [selected, time];
  }

  async loadSingleFromWatchlist(watchlist) {
    let log = loadFile("_media_memory")?.plex || {};
    let watchlists = loadFile("watchlists");
    let list = watchlists[watchlist];
    if (!list) return [];
    let candidates = { normal: {}, urgent: {}, in_progress: {} };
    for (let plexkey in list) {
      let item = list[plexkey];
      let progress = log[plexkey]?.seconds;
      progress = progress > 15 ? progress : 0;
      if (progress > 90) continue;
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
      if (progress > 0) priority = "in_progress";
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
    out.img = this.thumbUrl(out.parentThumb);
    return out;
  }

  async loadMovie(key) {
    const data = await this.loadMeta(key, '');
    let info = data.Video;
    let out = info || {};
    out.img = this.thumbUrl(out.thumb);
    return out;
  }

  async loadAudioTrack(key) {
    const data = await this.loadMeta(key, '');
    let track = data.Track || {};
    let id = track.Media?.Part?.id;
    let path = track.Media?.Part?.key;
    let out = track;
    out.img = this.thumbUrl(track.parentThumb);
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
    let url = `${this.baseUrl}/${paramString}?X-Plex-Token=${this.token}`;
    return url;
  }

  thumbUrl(paramString) {
    if (!paramString) return "";
    let symb = /\?/.test(paramString) ? '&' : '?';
    return `${this.baseUrl}${paramString}${symb}X-Plex-Token=${this.token}`;
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
