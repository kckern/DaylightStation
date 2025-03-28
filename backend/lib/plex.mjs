
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
    this.baseUrl = `${this.host}:${this.port}`;
  }

  async fetch(paramString) {
    let url = `${this.baseUrl}/${paramString}`;
    if (!/\?/.test(paramString)) url += '?1=1';
    url += `&X-Plex-Token=${this.token}`;
    const raw = (await axios.get(url)).data;
    const parsed = await parseStringPromise(raw, { explicitArray: false, mergeAttrs: true });
    return JSON.parse(JSON.stringify(parsed));
  }

  async loadMeta(key, type = '') {
    return await this.fetch(`library/metadata/${key}${type}`);
  }

  async loadListFromKey(key = false) {
    const data = await this.loadMeta(key, '');
    if (!data) return false;
    let possibleEntities = ['Directory', 'Track', 'Video', 'Playlist'];
    let type = '';
    for (let i of possibleEntities) {
      if (data[i]?.type) {
        type = data[i].type;
        break;
      }
    }
    switch (type) {
      case 'season': return this.loadListFromSeason(key);
      case 'show': return this.loadListFromShow(key);
      case 'playlist': return this.loadListFromPlaylist(key);
      case 'artist': return this.loadListFromArtist(key);
      case 'album': return this.loadListFromAlbum(key);
      case 'collection': return this.loadListFromCollection(key);
      default: return this.loadListItems([key]);
    }
  }

  async loadListItems(keys) {
    const out = [];
    for (let k of keys) {
      out.push(await this.loadSinglePlayableItem(k));
    }
    return out;
  }

  async loadListFromCollection(key) {
    const data = await this.loadMeta(key, '/children');
    if (!data.Video) return [];
    let items = Array.isArray(data.Video) ? data.Video : [data.Video];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadListFromArtist(key) {
    const data = await this.loadMeta(key, '/grandchildren');
    if (!data.Track) return [];
    let items = Array.isArray(data.Track) ? data.Track : [data.Track];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadListFromAlbum(key) {
    const data = await this.loadMeta(key, '/children');
    if (!data.Track) return [];
    let items = Array.isArray(data.Track) ? data.Track : [data.Track];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadListFromSeason(key) {
    const data = await this.loadMeta(key, '/children');
    if (!data.Video) return [];
    let items = Array.isArray(data.Video) ? data.Video : [data.Video];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadListFromPlaylist(key) {
    const data = await this.fetch(`playlists/${key}/items`);
    let items = data.Video || data.Track || [];
    if (!Array.isArray(items)) items = [items];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadListFromShow(key) {
    const data = await this.loadMeta(key, '/grandchildren');
    if (!data.Video) return [];
    let items = Array.isArray(data.Video) ? data.Video : [data.Video];
    const keys = items.map(x => x.ratingKey);
    return this.loadListItems(keys);
  }

  async loadSingleFromKey(key, shuffle = false) {
    const data = await this.loadMeta(key, '');
    if (!data) return false;
    let possibleEntities = ['Directory', 'Track', 'Video', 'Playlist'];
    let type = '';
    for (let i of possibleEntities) {
      if (data[i]?.type) {
        type = data[i].type;
        break;
      }
    }
    switch (type) {
      case 'season': return this.loadSingleFromSeason(key, shuffle);
      case 'show': return this.loadSingleFromShow(key, shuffle);
      case 'playlist': return this.loadSingleFromPlaylist(key, shuffle);
      case 'artist': return this.loadSingleFromArtist(key, shuffle);
      case 'album': return this.loadSingleFromAlbum(key, shuffle);
      case 'collection': return this.loadSingleFromCollection(key, shuffle);
      default: return this.selectKeyToPlay([key], shuffle);
    }
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

  async selectKeyToPlay(keys, shuffle = false) {
    let log = loadFile("memory/plexlog") || {};
    let unwatched = [];
    for (let key of keys) {
      if (!log[key]?.progress) { unwatched.push(key); continue; }
      if (log[key].progress < 90) return [key, log[key].time];
    }
    if (!unwatched.length) {
      for (let key of keys) delete log[key];
      saveFile(log, "memory/plexlog");
      unwatched = keys;
    }
    if (shuffle) shuffleArray(unwatched);
    let selected = unwatched[0];
    let time = log[selected]?.time ? log[selected].time : 0;
    return [selected, time];
  }

  async loadSingleFromWatchlist(watchlist) {
    let log = loadFile("memory/plexlog");
    let watchlists = loadFile("watchlists");
    let list = watchlists[watchlist];
    if (!list) return [];
    let candidates = { normal: {}, urgent: {}, in_progress: {} };
    for (let plexkey in list) {
      let item = list[plexkey];
      let progress = log[plexkey]?.progress;
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
    if (log[selectedKey]?.progress && log[selectedKey].progress < 90) {
      seekTo = log[selectedKey].time;
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
    const data = await this.loadMeta(key, '');
    let show = data.Directory || {};
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
