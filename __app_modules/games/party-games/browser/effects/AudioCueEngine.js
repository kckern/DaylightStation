// Cue player with named channels. 'clue-media' is exclusive: while anything
// plays there, 'music' is ducked (name-that-tune must not fight think music).
import getLogger from '@/lib/logging/Logger.js';

const DUCKED = 0.15;
const ATTRIBUTION = new Set(['sessionId', 'revision', 'teamId', 'commandId', 'windowKey', 'controllerId', 'challengeId', 'roundIndex']);
const now = () => globalThis.performance?.now?.() ?? Date.now();

export class AudioCueEngine {
  constructor({ pack = 'classic', mute = false, audioFactory = (src) => new Audio(src) } = {}) {
    this.pack = pack;
    this.mute = mute;
    this.audioFactory = audioFactory;
    this.channels = { music: [], sfx: [], 'clue-media': [] };
    this.playbacks = new WeakMap();
    this.log = getLogger().child({ component: 'party-games-audio' });
  }

  setMute(mute) {
    this.mute = mute;
    if (mute) Object.keys(this.channels).forEach((c) => this.stopChannel(c));
  }

  play(cue, { channel = 'sfx', loop = false, pack = this.pack, volume = 1, context = {} } = {}) {
    const attribution = { cue, channel, pack, ...Object.fromEntries(Object.entries(context).filter(([key]) => ATTRIBUTION.has(key))) };
    if (this.mute) {
      this.#trace({ ...attribution, result: 'suppressed', reason: 'muted' });
      return { finished: Promise.resolve({ result: 'muted' }) };
    }
    const startedAt = now();
    let audio, settled = false, resolve;
    const finished = new Promise(done => { resolve = done; });
    const settle = (result, reason) => {
      if (settled) return;
      settled = true;
      this.channels[channel] = (this.channels[channel] || []).filter(item => item !== audio);
      if (audio) this.playbacks.delete(audio);
      if (channel === 'clue-media' && !this.channels[channel].length) this.#setChannelVolume('music', 1);
      this.#trace({ ...attribution, result, ...(reason ? { reason } : {}), elapsedMs: Math.max(0, now() - startedAt) });
      resolve({ result, ...(reason ? { reason } : {}) });
    };
    try {
      audio = this.audioFactory(`/api/v1/gaming/media/${pack}/${cue}.mp3`);
      audio.loop = loop;
      const requestedVolume = Number(volume);
      audio.volume = Number.isFinite(requestedVolume) ? Math.max(0, Math.min(1, requestedVolume)) : 1;
      (this.channels[channel] ||= []).push(audio);
      this.playbacks.set(audio, { settle });
      if (channel === 'clue-media') this.#setChannelVolume('music', DUCKED);
      audio.addEventListener?.('ended', () => settle('ended'), { once: true });
      audio.addEventListener?.('error', () => settle('failed', 'media-error'), { once: true });
      const started = () => { if (!settled) this.#trace({ ...attribution, result: 'started', elapsedMs: Math.max(0, now() - startedAt) }); };
      const promise = audio.play();
      if (promise?.then) promise.then(started, error => settle('failed', error.message));
      else started();
    } catch (error) { settle('failed', error.message); }
    return { finished };
  }

  #trace(fields) {
    try { this.log[fields.result === 'failed' ? 'warn' : 'info']('jeopardy.cue-result', fields); }
    catch { /* Logging must not interrupt playback or leave a receipt pending. */ }
  }

  stopChannel(channel, { reason = 'channel-stopped' } = {}) {
    for (const audio of [...(this.channels[channel] || [])]) {
      try { audio.pause(); } catch { /* ignore */ }
      this.playbacks.get(audio)?.settle('stopped', reason);
    }
    this.channels[channel] = [];
    if (channel === 'clue-media') this.#setChannelVolume('music', 1);
  }

  stopAll(reason = 'owner-exit') {
    for (const channel of Object.keys(this.channels)) this.stopChannel(channel, { reason });
  }

  duck(channel) { this.#setChannelVolume(channel, DUCKED); }
  unduck(channel) { this.#setChannelVolume(channel, 1); }

  #setChannelVolume(channel, volume) {
    for (const audio of this.channels[channel] || []) audio.volume = volume;
  }
}
