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
    this.log = getLogger().child({ component: 'gameshow-audio' });
  }

  setMute(mute) {
    this.mute = mute;
    if (mute) Object.keys(this.channels).forEach((c) => this.stopChannel(c));
  }

  play(cue, { channel = 'sfx', loop = false } = {}) {
    if (this.mute) return;
    try {
      // served by the gameshow router's /media route (raw /media/* is not served)
      const audio = this.audioFactory(`/api/v1/gameshow/media/gameshow/${this.pack}/${cue}.mp3`);
      audio.loop = loop;
      (this.channels[channel] ||= []).push(audio);
      if (channel === 'clue-media') this.#setChannelVolume('music', DUCKED);
      const p = audio.play();
      p?.catch?.((err) => this.log.warn('gameshow.audio.play_failed', { cue, error: err.message }));
    } catch (err) {
      this.log.warn('gameshow.audio.error', { cue, error: err.message });
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
