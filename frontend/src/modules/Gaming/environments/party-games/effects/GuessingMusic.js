import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { getEffectiveMaster, subscribeMaster } from '@/lib/volume/ScreenVolumeContext.js';
import { toTracks } from '@/lib/Player/playlist.js';

// Environment-owned music capability. Every start owns its cancellation and
// cleanup: a late response from an earlier turn cannot restart playback.
export class GuessingMusic {
  constructor({
    resolveQueue = (source, signal) => DaylightAPI(`api/v1/queue/${encodeURIComponent(source)}`, {}, 'GET', { signal }),
    audioFactory = () => new Audio(),
    random = Math.random,
  } = {}) {
    Object.assign(this, { resolveQueue, audioFactory, random });
    this.cleanup = null;
    this.log = getLogger().child({ component: 'charades-music' });
  }

  start(config, { onError = () => {} } = {}) {
    this.stop();
    if (!config?.source) return () => {};
    const abort = new AbortController();
    const audio = this.audioFactory();
    let cancelled = false;
    let tracks = [];
    let index = -1;
    let failures = 0;
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
      // Uniformly select among all tracks except the one that just ended.
      const eligible = tracks.map((_, n) => n).filter(n => tracks.length === 1 || n !== index);
      index = eligible[Math.floor(this.random() * eligible.length)];
      audio.src = tracks[index].mediaUrl;
      this.log.info('gaming.music.track', { title: tracks[index].title });
      try { Promise.resolve(audio.play()).catch(error => { if (!cancelled) report(error); }); }
      catch (error) { report(error); }
    };
    const ended = () => { failures = 0; playNext(); };
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
