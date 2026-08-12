import { getChildLogger } from '../../../lib/logging/singleton.js';

const logger = getChildLogger({ component: 'card-game-sound' });

export const CAMPAIGN_SOUND_IDS = Object.freeze([
  'ui.select', 'ui.back', 'session.saved', 'move.commit',
  'hit.direct', 'hit.partial', 'hit.miss',
  'enemy.attack', 'enemy.defend', 'enemy.charge', 'partner.faint',
  'encounter.win', 'pokedex.seen', 'partner.caught', 'daily.stamp',
  'weekly.ticket', 'bond.rank', 'trainer.level', 'gym.intro',
  'gym.badge', 'partner.evolve', 'campaign.complete', 'system.error',
]);

const PATTERNS = Object.freeze({
  'ui.select': [[620, 0]], 'ui.back': [[330, 0]], 'session.saved': [[440, 0], [660, 0.08]],
  'move.commit': [[392, 0], [523, 0.06]],
  'hit.direct': [[523, 0], [659, 0.07], [784, 0.14]],
  'hit.partial': [[392, 0], [494, 0.1]], 'hit.miss': [[180, 0], [145, 0.12]],
  'enemy.attack': [[196, 0], [165, 0.08]], 'enemy.defend': [[330, 0], [440, 0.08]],
  'enemy.charge': [[440, 0], [554, 0.1]], 'partner.faint': [[330, 0], [262, 0.14], [196, 0.28]],
  'encounter.win': [[523, 0], [659, 0.1], [784, 0.2]], 'pokedex.seen': [[740, 0]],
  'partner.caught': [[392, 0], [523, 0.1], [784, 0.22]], 'daily.stamp': [[280, 0], [560, 0.06]],
  'weekly.ticket': [[523, 0], [784, 0.1], [1047, 0.2]], 'bond.rank': [[440, 0], [660, 0.12]],
  'trainer.level': [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.25]],
  'gym.intro': [[147, 0], [196, 0.14], [294, 0.28]],
  'gym.badge': [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]],
  'partner.evolve': [[330, 0], [440, 0.12], [660, 0.25], [880, 0.38]],
  'campaign.complete': [[392, 0], [523, 0.1], [659, 0.2], [784, 0.3], [1047, 0.42]],
  'system.error': [[180, 0], [150, 0.1], [180, 0.2]],
});

export class CampaignSoundController {
  constructor() {
    this.audioContext = null;
    this.playedKeys = new Set();
    this.muted = false;
    this.reduced = false;
    try {
      this.muted = localStorage.getItem('card-game:muted') === 'true';
      this.reduced = localStorage.getItem('card-game:reduced-effects') === 'true';
    } catch { /* storage is optional in kiosk/private mode */ }
  }

  settings() { return { muted: this.muted, reducedEffects: this.reduced }; }

  setMuted(value) {
    this.muted = Boolean(value);
    try { localStorage.setItem('card-game:muted', String(this.muted)); } catch { /* optional */ }
    return this.settings();
  }

  setReducedEffects(value) {
    this.reduced = Boolean(value);
    try { localStorage.setItem('card-game:reduced-effects', String(this.reduced)); } catch { /* optional */ }
    return this.settings();
  }

  context() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return null;
    this.audioContext ||= new AudioContext();
    if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
    return this.audioContext;
  }

  play(eventId, { onceKey = null, grading = false } = {}) {
    if (!CAMPAIGN_SOUND_IDS.includes(eventId) || this.muted || grading) return false;
    if (onceKey && this.playedKeys.has(onceKey)) return false;
    if (onceKey) this.playedKeys.add(onceKey);
    const ctx = this.context();
    const notes = PATTERNS[eventId];
    if (!ctx || !notes) return false;
    try {
      for (const [frequency, delay] of notes) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + delay;
        oscillator.type = eventId === 'hit.miss' || eventId === 'system.error' ? 'square' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(this.reduced ? 0.035 : 0.075, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.14);
      }
      return true;
    } catch (error) {
      logger.warn('card-game.sound-failed', { eventId, error: error.message });
      return false;
    }
  }
}

export const campaignSound = new CampaignSoundController();

const LEGACY_IDS = { direct: 'hit.direct', partial: 'hit.partial', miss: 'hit.miss', badge: 'gym.badge', defeat: 'partner.faint' };
export function playJourneySfx(kind, options) {
  return campaignSound.play(LEGACY_IDS[kind] || kind, options);
}
playJourneySfx.settings = () => campaignSound.settings();
playJourneySfx.setMuted = (value) => campaignSound.setMuted(value);
playJourneySfx.setReducedEffects = (value) => campaignSound.setReducedEffects(value);
playJourneySfx.play = (eventId, options) => campaignSound.play(eventId, options);

export default playJourneySfx;
