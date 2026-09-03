// frontend/src/modules/Piano/PianoKiosk/pianoConfigModel.js
//
// Pure household-piano config resolution — defaults + per-piano merge logic.
// Split out of PianoConfig.jsx (which keeps the Provider/Context/hooks) so
// Fast Refresh can hot-reload the provider without a full remount.

export const PIANO_CONFIG_DEFAULTS = {
  videos: { plexCollection: null },
  // Playalong menu — a video collection (backing tracks) reusing the Courses flow.
  playalong: { plexCollection: null, plexShow: null },
  // Singalong menu — a karaoke video collection; reuses the Courses grid/detail
  // flow but plays through the karaoke-chrome SingalongPlayer (no keyboard/staff).
  singalong: { plexCollection: null },
  // Karaoke menu — a purpose-built song browser (search + category tabs) over a
  // single Plex show whose seasons are genre categories; plays through the same
  // karaoke-chrome SingalongPlayer as Singalong, but with no course grid/detail.
  karaoke: { plexShow: null },
  // Shortlist menu — curated voice bundles a household wants quick access to,
  // distinct from per-user saved favorites (preset.yml favorites).
  shortlist: { voices: [] },
  music: { collection: null, playlists: [] },
  sheetmusic: { collection: null },
  // Technique-drill collection slug → media/docs/piano-lessons/{collection}/.
  // All lesson content lives in that folder's YAML; this is just the pointer.
  lessons: { collection: 'hannon' },
  games: null,
  midi: { preferredInputName: null },
  effects: { dialect: 'gm2', route: 'pianobridge', transport: 'sysex', resend: 3 },
  // Physical key range of this piano. 88 keys = A0(21)..C8(108); a 61-key board
  // would be 36..96, a 49-key 36..84. MIDI note numbers.
  keyboard: { startNote: 21, endNote: 108 },
  // OS Bluetooth-settings launcher for pairing the BLE-MIDI piano. Null = this
  // client isn't an Android/FKB kiosk (no assumption). When set, the kiosk shows
  // a "pair over Bluetooth" affordance that calls fully.startApplication(pkg, activity).
  // e.g. { package: 'com.android.settings', activity: 'com.android.settings.Settings$BluetoothSettingsActivity' }
  bluetooth: null,
  inactivityMinutes: 10,
  // Re-prompt "who's playing?" after this many idle minutes (0 disables).
  whoIsPlayingMinutes: 2,
  // Always-on MIDI history (disabled by default — opt in per piano).
  autoRecord: { enabled: false, silenceSeconds: 25, minNotes: 5, minSeconds: 3, flushSeconds: 12 },
  // Screensaver disabled until a deviceId is configured (null = no screen control).
  screensaver: { deviceId: null, timeoutMinutes: 20, quietHours: null, offCooldownMinutes: 30 },
  // Curfew: inside this window the kiosk menu goes dark — every tile and
  // activity card greys out and stops responding. Free play is untouched:
  // playing the keys still auto-enters Studio (autoStudio), so the piano works
  // at any hour; only "put on a course / pick a game" closes for the night.
  //
  // Off by default and config-driven — the household's actual cut-off lives in
  // data/household/piano/config.yml (`curfew:`), per piano or shared. A piano
  // with no curfew block never greys out, so this can't surprise a new kiosk.
  curfew: { enabled: false, start: '19:00', end: '06:00' },
  // Studio mode defaults. topPaneLayout: 'staff' (centered grand staff, default) |
  // 'triptych' (circle-of-fifths | staff | live chord name). Household default; a
  // per-user preference (preferences.yml → topPaneLayout) overrides it.
  studio: { topPaneLayout: 'staff' },
  // Producer capability flags. voiceTiers.onboardGm: true when the GM probe
  // (/piano/test/gm-probe) verified the piano is multi-timbral GM — lets the
  // Producer route loop playback to the piano's own engine (tier 1). Null =
  // unverified: browser gmSynth (tier 2) carries everything.
  producer: null,
  // Auto-enter Studio from the menu when sustained playing is detected
  // (spec 2026-07-28-piano-auto-studio-design.md). Count AND span so a
  // key-brush, one chord, or a forearm bump never triggers.
  autoStudio: { enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 },
  // Fixed design canvas: the kiosk lays out at the tablet's CSS viewport
  // (SM-T590 = 1280×800) and scales to fit any other browser — same layout
  // everywhere. Null either dimension to disable scaling.
  display: { designWidth: 1280, designHeight: 800 },
  // Daily piano-game time budget (see docs/reference/piano/games-budget-gate.md).
  // Off by default, like curfew — a household that never sets this block gets
  // unmetered games. Whole-node passthrough (like effects/videos): the server is
  // authoritative for dailyMinutes, deviceDailyMinutes, warnAtMinutes,
  // idleAfterSeconds, users, etc. — the client only reads `enabled` to decide
  // whether to open a meter session at all, but every other field still has to
  // survive the resolver so it reaches whatever eventually needs it, per the
  // resolver's own "silently drops any key not threaded through it" failure mode.
  gameLimit: { enabled: false },
  // Playing challenge at a match boundary (gate 2). Off by default, like
  // gameLimit above it. Whole-node passthrough for the same reason and with the
  // same failure mode: the HOST only reads `enabled` to decide whether to stand a
  // gate in front of the game, but the rest of the block (repertoire, startLevel,
  // retriesBeforeDegrade, climbAfterCleanPasses, users, …) is the gate
  // component's own config and has to survive the resolver to reach it. A key
  // this projection does not name is dropped in silence — a gate whose config
  // never arrives is a gate that is permanently off while the YAML says on.
  gameGate: { enabled: false },
  // Managed board vocabulary and its daily/per-turn pressure. Independent of
  // opponent strength and of the PianoChallenge ladder; off unless configured.
  gameAddressing: { enabled: false },
};

/** Resolve screensaver config: per-piano values override shared, over defaults. */
export function resolveScreensaver(shared, p) {
  const s = shared.screensaver || {};
  const ps = p.screensaver || {};
  const d = PIANO_CONFIG_DEFAULTS.screensaver;
  return {
    deviceId: ps.deviceId ?? s.deviceId ?? d.deviceId,
    timeoutMinutes: ps.timeoutMinutes ?? s.timeoutMinutes ?? d.timeoutMinutes,
    quietHours: ps.quietHours ?? s.quietHours ?? d.quietHours,
    offCooldownMinutes: ps.offCooldownMinutes ?? s.offCooldownMinutes ?? d.offCooldownMinutes,
  };
}

/** Resolve curfew config: per-piano values override shared, over defaults. */
export function resolveCurfew(shared, p) {
  const s = shared.curfew || {};
  const ps = p.curfew || {};
  const d = PIANO_CONFIG_DEFAULTS.curfew;
  return {
    enabled: ps.enabled ?? s.enabled ?? d.enabled,
    start: ps.start ?? s.start ?? d.start,
    end: ps.end ?? s.end ?? d.end,
  };
}

/** Resolve auto-record config: per-piano over shared over defaults (field-wise). */
export function resolveAutoRecord(shared, p) {
  const s = shared.autoRecord || {};
  const ps = p.autoRecord || {};
  const d = PIANO_CONFIG_DEFAULTS.autoRecord;
  return {
    enabled: ps.enabled ?? s.enabled ?? d.enabled,
    silenceSeconds: ps.silenceSeconds ?? s.silenceSeconds ?? d.silenceSeconds,
    minNotes: ps.minNotes ?? s.minNotes ?? d.minNotes,
    minSeconds: ps.minSeconds ?? s.minSeconds ?? d.minSeconds,
    flushSeconds: ps.flushSeconds ?? s.flushSeconds ?? d.flushSeconds,
  };
}

/** Derive the list of pianos from raw config; falls back to a single default piano. */
export function derivePianos(raw) {
  const shared = raw || {};
  const pianos = shared.pianos || {};
  const ids = Object.keys(pianos);
  if (ids.length > 0) {
    return ids.map((id) => ({ id, label: pianos[id]?.label || id }));
  }
  return [{ id: 'default', label: shared.label || 'Piano' }];
}

// The Sound sheet's Mine rail item is favourites (≤8) + this shortlist in a
// 24-tile grid that must not scroll. 16 is the remaining headroom.
const SHORTLIST_MAX = 16;

/** Resolve one piano's effective config: per-piano values override shared, over defaults. */
export function resolvePianoConfig(raw, pianoId) {
  const shared = raw || {};
  const pianos = shared.pianos || {};
  // 'default' (the synthesized single piano) inherits straight from shared top-level.
  const p = pianos[pianoId] || (pianoId === 'default' ? shared : {});
  return {
    label: p.label || (pianoId === 'default' ? (shared.label || 'Piano') : pianoId),
    device: p.device ?? shared.device ?? null,   // hardware profile id, e.g. 'suzuki-mdg-400'
    effects: { ...PIANO_CONFIG_DEFAULTS.effects, ...(shared.effects || {}), ...(p.effects || {}) },
    // Whole videos block (per-piano overrides shared), so collection tabs,
    // sequential_labels, thresholds, etc. all reach the frontend — not just
    // plexCollection. Default floor keeps the { plexCollection } shape.
    videos: { ...PIANO_CONFIG_DEFAULTS.videos, ...(shared.videos || {}), ...(p.videos || {}) },
    playalong: { ...PIANO_CONFIG_DEFAULTS.playalong, ...(shared.playalong || {}), ...(p.playalong || {}) },
    singalong: { ...PIANO_CONFIG_DEFAULTS.singalong, ...(shared.singalong || {}), ...(p.singalong || {}) },
    karaoke: { ...PIANO_CONFIG_DEFAULTS.karaoke, ...(shared.karaoke || {}), ...(p.karaoke || {}) },
    shortlist: (() => {
      const merged = { ...PIANO_CONFIG_DEFAULTS.shortlist, ...(shared.shortlist || {}), ...(p.shortlist || {}) };
      return { ...merged, voices: (merged.voices || []).slice(0, SHORTLIST_MAX) };
    })(),
    music: {
      collection: p.music?.collection ?? shared.music?.collection ?? null,
      playlists: p.music?.playlists ?? shared.music?.playlists ?? [],
    },
    // Whole-node passthrough (like videos): sheetmusic carries either the legacy
    // single `collection` or the grouped `collections` score tabs.
    sheetmusic: { ...PIANO_CONFIG_DEFAULTS.sheetmusic, ...(shared.sheetmusic || {}), ...(p.sheetmusic || {}) },
    lessons: { collection: p.lessons?.collection ?? shared.lessons?.collection ?? PIANO_CONFIG_DEFAULTS.lessons.collection },
    midi: { preferredInputName: p.midi?.preferredInputName ?? shared.midi?.preferredInputName ?? null },
    keyboard: {
      startNote: p.keyboard?.startNote ?? shared.keyboard?.startNote ?? PIANO_CONFIG_DEFAULTS.keyboard.startNote,
      endNote: p.keyboard?.endNote ?? shared.keyboard?.endNote ?? PIANO_CONFIG_DEFAULTS.keyboard.endNote,
    },
    bluetooth: p.bluetooth ?? shared.bluetooth ?? PIANO_CONFIG_DEFAULTS.bluetooth,
    inactivityMinutes: p.inactivityMinutes ?? shared.inactivityMinutes ?? PIANO_CONFIG_DEFAULTS.inactivityMinutes,
    whoIsPlayingMinutes: p.whoIsPlayingMinutes ?? shared.whoIsPlayingMinutes ?? PIANO_CONFIG_DEFAULTS.whoIsPlayingMinutes,
    autoRecord: resolveAutoRecord(shared, p),
    games: p.games ?? shared.games ?? null,
    screensaver: resolveScreensaver(shared, p),
    curfew: resolveCurfew(shared, p),
    studio: {
      topPaneLayout: p.studio?.topPaneLayout
        ?? shared.studio?.topPaneLayout
        ?? PIANO_CONFIG_DEFAULTS.studio.topPaneLayout,
    },
    producer: p.producer ?? shared.producer ?? PIANO_CONFIG_DEFAULTS.producer,
    autoStudio: { ...PIANO_CONFIG_DEFAULTS.autoStudio, ...(shared.autoStudio || {}), ...(p.autoStudio || {}) },
    display: { ...PIANO_CONFIG_DEFAULTS.display, ...(shared.display || {}), ...(p.display || {}) },
    gameLimit: { ...PIANO_CONFIG_DEFAULTS.gameLimit, ...(shared.gameLimit || {}), ...(p.gameLimit || {}) },
    gameGate: { ...PIANO_CONFIG_DEFAULTS.gameGate, ...(shared.gameGate || {}), ...(p.gameGate || {}) },
    gameAddressing: {
      ...PIANO_CONFIG_DEFAULTS.gameAddressing,
      ...(shared.gameAddressing || {}),
      ...(p.gameAddressing || {}),
    },
  };
}
