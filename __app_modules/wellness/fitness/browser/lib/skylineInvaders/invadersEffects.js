// Skyline Invaders effects: engine event -> ordered effects (visuals and audio
// cues) for the kit's effect dispatcher. Audio is the shared Skyline audio
// engine, unchanged: its slot list is fixed, so every cue here is one of its
// slots. A slot with no file under the game's sounds folder plays that
// engine's synthesized tone.

// `crash` is the bomb's rumble. `music` is the engine's loop slot.
export const INVADERS_SOUND_SLOTS = Object.freeze(['laser', 'missile', 'hit', 'target', 'explosion', 'crash', 'hurt', 'deny', 'boost', 'finish', 'music']);

// Per-volley and per-threat lines would flood the log store; the shell logs
// steps sampled and volleys through the shot trace. A null name tells the
// dispatcher to log nothing for the event.
const UNLOGGED_EVENTS = Object.freeze(['shot.fired', 'volley.settled', 'fuel.added', 'threat.spawned', 'threat.damaged', 'threat.destroyed']);
export const INVADERS_LOG_NAMES = Object.freeze({
  event: (event) => (UNLOGGED_EVENTS.includes(event.type) ? null : `skyline_invaders.round.${event.type}`),
  executed: 'skyline_invaders.effect.executed',
  skipped: 'skyline_invaders.effect.skipped',
  failed: 'skyline_invaders.effect.failed',
});

export const WEAPON_BANNERS = Object.freeze({ double: 'Double shot!', spread: 'Spread shot!' });
export const BOMB_READY_BANNER = 'Bomb ready — STOMP!';
export const BOOST_LABELS = Object.freeze({ rapid: 'Rapid fire', shield: 'Shield', twin: 'Twin cannon' });

/** `mediaUrl(path)` turns a media-relative path into a URL. Returns { slot: url }. */
export const invadersSoundUrls = (mediaUrl) => Object.fromEntries(
  INVADERS_SOUND_SLOTS.map((slot) => [slot, mediaUrl(`fitness/skyline-invaders/sounds/${slot}.mp3`)]),
);

/**
 * What the scene and shell draw on top of the engine state.
 *   pops       [{ key, kind: 'kill' | 'hit' | 'impact', x, y?, points?, threat? }]  (InvadersScene)
 *   shakeKey   0 = still; any other value is a shake in progress           (InvadersScene)
 *   shakeKind  'bomb' | 'hit' | null
 *   banner     { key, text } | null                                        (shell, MomentBanner)
 */
export const EMPTY_EFFECTS = Object.freeze({ pops: Object.freeze([]), shakeKey: 0, shakeKind: null, banner: null });

export const MAX_POPS = 24;      // a bomb can destroy a screenful in one frame
const POP_MS = 600;
const BANNER_MS = 1500;
const SHAKE_MS = Object.freeze({ bomb: 300, hit: 200 });

/**
 * The effect table for createEffectDispatcher. `setEffects` is a React state
 * setter (it is always called with an updater); `effectTimersRef.current` is a
 * Set of pending timeouts that the owner clears on unmount.
 * Dispatch with `{ time }` (the engine's `state.time`): it makes the keys unique.
 */
export function buildInvadersEffectTable({ setEffects, effectTimersRef }) {
  const later = (fn, ms) => {
    const timer = setTimeout(() => { effectTimersRef.current.delete(timer); fn(); }, ms);
    effectTimersRef.current.add(timer);
  };
  const pop = (entry) => {
    setEffects((current) => ({ ...current, pops: [...current.pops, entry].slice(-MAX_POPS) }));
    later(() => setEffects((current) => ({ ...current, pops: current.pops.filter((item) => item.key !== entry.key) })), POP_MS);
  };
  const shake = (kind) => {
    // The updater has run long before the timer fires (React applies it on the
    // next render), so `mine` is set by the time it is read.
    let mine = 0;
    setEffects((current) => { mine = current.shakeKey + 1; return { ...current, shakeKey: mine, shakeKind: kind }; });
    // Only the latest shake may end the shaking: an older timer leaves a newer shake alone.
    later(() => setEffects((current) => (current.shakeKey === mine ? { ...current, shakeKey: 0, shakeKind: null } : current)), SHAKE_MS[kind]);
  };

  const banner = (key, text) => {
    setEffects((current) => ({ ...current, banner: { key, text } }));
    later(() => setEffects((current) => (current.banner?.key === key ? { ...current, banner: null } : current)), BANNER_MS);
  };

  return {
    'shot.fired': () => [{ id: 'shot-cue', cue: 'laser' }],
    'threat.damaged': (event, extra) => [
      { id: 'damage-spark', visual: () => pop({ key: `hit-${event.data.id}-${extra.time}`, kind: 'hit', x: event.data.x, y: event.data.y }) },
      { id: 'damage-cue', cue: 'hit' },
    ],
    'threat.destroyed': (event, extra) => [
      { id: 'kill-pop', visual: () => pop({
        key: `kill-${event.data.id}-${extra.time}`, kind: 'kill',
        x: event.data.x, y: event.data.y, points: event.data.points, threat: event.data.threat,
      }) },
      { id: 'kill-cue', cue: 'target' },
    ],
    // The one event with two cues at once: the boom, and a longer low rumble under it.
    bomb: () => [
      { id: 'bomb-shake', visual: () => shake('bomb') },
      { id: 'bomb-cue', cue: 'explosion' },
      { id: 'bomb-rumble-cue', cue: 'crash' },
    ],
    // Moving up the weapon ladder is announced; cooling down a level is only heard.
    'weapon.level': (event, extra) => (event.data.reason === 'power'
      ? [{ id: 'weapon-banner', visual: () => banner(`weapon-${event.data.level}-${extra.time}`, WEAPON_BANNERS[event.data.tier] || 'Power up!') }, { id: 'weapon-cue', cue: 'boost' }]
      : [{ id: 'weapon-drop-cue', cue: 'deny' }]),
    // The one control the shooter has to be told about mid-round.
    'bomb.ready': (event, extra) => [
      { id: 'bomb-ready-banner', visual: () => banner(`bomb-ready-${extra.time}`, BOMB_READY_BANNER) },
      { id: 'bomb-ready-cue', cue: 'missile' },
    ],
    'base.hit': (event, extra) => {
      if (event.data.shielded) return [{ id: 'shield-cue', cue: 'deny' }];
      if (!(event.data.damage > 0)) return null;
      return [
        { id: 'base-shake', visual: () => {
          shake('hit');
          pop({ key: `impact-${event.data.x}-${extra.time}`, kind: 'impact', x: event.data.x });
        } },
        { id: 'base-cue', cue: 'hurt' },
      ];
    },
    'boost.activated': (event, extra) => [
      { id: 'boost-banner', visual: () => banner(`boost-${event.data.kind}-${extra.time}`, BOOST_LABELS[event.data.kind] || 'Boost') },
      { id: 'boost-cue', cue: 'boost' },
    ],
    'level.ended': () => [{ id: 'finish-cue', cue: 'finish' }],
  };
}
