// Cue player with named channels. 'clue-media' is exclusive: while anything
// plays there, 'music' is ducked (name-that-tune must not fight think music).
import getLogger from '@/lib/logging/Logger.js';

const DUCKED = 0.15;

export class AudioCueEngine {
  constructor({ pack = 'classic', mute = false, audioFactory = (src) => new Audio(src) } = {}) {
    this.pack = pack;
    this.mute = mute;
    this.audioFactory = audioFactory;
    this.channels = { music: [], sfx: [], 'clue-media': [] };
    this.log = getLogger().child({ component: 'party-games-audio' });
  }

  setMute(mute) {
    this.mute = mute;
    if (mute) Object.keys(this.channels).forEach((c) => this.stopChannel(c));
  }

  play(cue, { channel = 'sfx', loop = false, pack = this.pack, volume = 1, context = {} } = {}) {
    if (this.mute) return;
    try {
      // served by the party-games router's /media route (raw /media/* is not served)
      const audio = this.audioFactory(`/api/v1/gaming/media/${pack}/${cue}.mp3`);
      audio.loop = loop;
      const requestedVolume = Number(volume);
      audio.volume = Number.isFinite(requestedVolume) ? Math.max(0, Math.min(1, requestedVolume)) : 1;
      (this.channels[channel] ||= []).push(audio);
      if (channel === 'clue-media') this.#setChannelVolume('music', DUCKED);
      const attribution = { cue, channel, pack, ...context };
      const release = () => {
        this.channels[channel] = (this.channels[channel] || []).filter(item => item !== audio);
        if (channel === 'clue-media' && !this.channels[channel].length) this.#setChannelVolume('music', 1);
      };
      audio.addEventListener?.('ended', release, { once: true });
      audio.addEventListener?.('error', () => { release(); this.log.warn('jeopardy.cue-result', { ...attribution, result: 'failed', reason: 'media-error' }); }, { once: true });
      const p = audio.play();
      p?.then?.(() => this.log.info('jeopardy.cue-result', { ...attribution, result: 'started' }), () => {});
      p?.catch?.((err) => { release(); this.log.warn('jeopardy.cue-result', { ...attribution, result: 'failed', reason: err.message }); });
    } catch (err) {
      this.log.warn('party-games.audio.error', { cue, channel, pack, ...context, error: err.message });
    }
  }

  stopChannel(channel) {
    for (const audio of this.channels[channel] || []) {
      try { audio.pause(); } catch { /* ignore */ }
    }
    this.channels[channel] = [];
    if (channel === 'clue-media') this.#setChannelVolume('music', 1);
  }

  duck(channel) { this.#setChannelVolume(channel, DUCKED); }
  unduck(channel) { this.#setChannelVolume(channel, 1); }

  #setChannelVolume(channel, volume) {
    for (const audio of this.channels[channel] || []) audio.volume = volume;
  }
}
