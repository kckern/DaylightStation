import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { getEffectiveMaster, subscribeMaster } from '@/lib/volume/ScreenVolumeContext.js';
import { toTracks } from '@/lib/Player/playlist.js';

const STORAGE_PREFIX = 'daylight.gaming.guessing-music';

function browserSessionStorage() {
  try { return globalThis.sessionStorage || null; }
  catch { return null; }
}

// Environment-owned music capability. Every start owns its cancellation and
// cleanup: a late response from an earlier turn cannot restart playback.
export class GuessingMusic {
  constructor({
    resolveQueue = (source, signal) => DaylightAPI(`api/v1/queue/${encodeURIComponent(source)}`, {}, 'GET', { signal }),
    audioFactory = () => new Audio(),
    random = Math.random,
    storage = undefined,
  } = {}) {
    Object.assign(this, { resolveQueue, audioFactory, random });
    this.storage = storage === undefined ? browserSessionStorage() : storage;
    this.shuffleBags = new Map();
    this.cleanup = null;
    this.log = getLogger().child({ component: 'charades-music' });
  }

  shuffle(values, avoidFirst = null) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const swap = Math.floor(this.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    if (result.length > 1 && result[0] === avoidFirst) {
      const replacement = result.findIndex(value => value !== avoidFirst);
      [result[0], result[replacement]] = [result[replacement], result[0]];
    }
    return result;
  }

  bagKey(config, sessionId) {
    return `${sessionId || 'game'}:${config.source}`;
  }

  loadBag(config, sessionId, tracks) {
    const key = this.bagKey(config, sessionId);
    let bag = this.shuffleBags.get(key);
    if (!bag && config.memory === 'session' && sessionId && this.storage) {
      try { bag = JSON.parse(this.storage.getItem(`${STORAGE_PREFIX}:${key}`)); }
      catch { bag = null; }
    }
    const available = new Set(tracks.map(track => track.mediaUrl));
    const remaining = Array.isArray(bag?.remaining) ? bag.remaining.filter(url => available.has(url)) : [];
    const played = Array.isArray(bag?.played) ? bag.played.filter(url => available.has(url)) : [];
    const known = new Set([...remaining, ...played]);
    remaining.push(...this.shuffle([...available].filter(url => !known.has(url))));
    bag = { remaining, played, last: available.has(bag?.last) ? bag.last : null };
    this.shuffleBags.set(key, bag);
    return { key, bag };
  }

  saveBag(config, sessionId, key, bag) {
    this.shuffleBags.set(key, bag);
    if (config.memory !== 'session' || !sessionId || !this.storage) return;
    try { this.storage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(bag)); }
    catch { /* In-memory cycle tracking remains available when storage is blocked. */ }
  }

  start(config, { onError = () => {}, sessionId = null } = {}) {
    this.stop();
    if (!config?.source) return () => {};
    const abort = new AbortController();
    const audio = this.audioFactory();
    audio.loop = config.repeat === 'one';
    let cancelled = false;
    let tracks = [];
    let index = -1;
    let failures = 0;
    let shuffleState = null;
    const applyVolume = () => { audio.volume = Math.min(1, Math.max(0, config.volume ?? 0.25)) * getEffectiveMaster(); };
    const unsubscribe = subscribeMaster(applyVolume);
    applyVolume();
    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
      unsubscribe();
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', failed);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      this.log.info('gaming.music.stopped', {});
    };
    const report = (error) => {
      if (cancelled) return;
      this.log.warn('gaming.music.failed', { error: error.message });
      cleanup();
      try { onError(error); }
      catch (presentationError) { this.log.warn('gaming.music.error-presenter-failed', { error: presentationError.message }); }
    };
    const playNext = () => {
      if (cancelled || !tracks.length) return;
      if (config.order === 'shuffle' && ['after-cycle', 'one'].includes(config.repeat)) {
        const { key, bag } = shuffleState || this.loadBag(config, sessionId, tracks);
        shuffleState = { key, bag };
        if (!bag.remaining.length) {
          bag.remaining = this.shuffle(tracks.map(track => track.mediaUrl), bag.last);
          bag.played = [];
        }
        const mediaUrl = bag.remaining.shift();
        bag.played.push(mediaUrl);
        bag.last = mediaUrl;
        this.saveBag(config, sessionId, key, bag);
        index = tracks.findIndex(track => track.mediaUrl === mediaUrl);
      } else {
        // Uniformly select among all tracks except the one that just ended.
        const eligible = tracks.map((_, n) => n).filter(n => tracks.length === 1 || n !== index);
        index = eligible[Math.floor(this.random() * eligible.length)];
      }
      audio.src = tracks[index].mediaUrl;
      this.log.info('gaming.music.track', { title: tracks[index].title });
      try { Promise.resolve(audio.play()).catch(error => { if (!cancelled) report(error); }); }
      catch (error) { report(error); }
    };
    const ended = () => {
      failures = 0;
      if (config.repeat === 'one') {
        audio.currentTime = 0;
        try { Promise.resolve(audio.play()).catch(error => { if (!cancelled) report(error); }); }
        catch (error) { report(error); }
      } else playNext();
    };
    const failed = () => {
      if (cancelled) return;
      failures += 1;
      if (failures >= tracks.length) report(new Error('Guessing music could not be played'));
      else playNext();
    };
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', failed);
    this.cleanup = cleanup;
    this.log.info('gaming.music.resolving', { source: config.source });
    Promise.resolve().then(() => this.resolveQueue(config.source, abort.signal)).then(response => {
      if (cancelled) return;
      tracks = toTracks(response);
      if (!tracks.length) { report(new Error('Guessing music source contains no playable tracks')); return; }
      playNext();
    }).catch(error => { if (!cancelled) report(error); });
    return cleanup;
  }

  stop() { this.cleanup?.(); this.cleanup = null; }
}
