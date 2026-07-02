/**
 * gmSynth — browser General MIDI synth on top of `webaudiofont` (npm).
 *
 * This is the guaranteed "tier 2" voice output for the Producer: it always
 * works because it renders locally in Web Audio, regardless of what the piano
 * hardware supports. A later `gmSynthTier` adapter wraps this for the
 * VoiceRouter (see docs/_wip/plans/2026-07-01-piano-producer-overhaul-plan.md
 * Task 0.2 / Phase 3).
 *
 * ── Channel convention ──────────────────────────────────────────────────────
 * Channels are 0-INDEXED everywhere in this module (0..15), matching raw MIDI
 * status-byte math (`0x90 | ch`). The GM percussion channel is therefore
 * channel 9 (what musicians call "channel 10"). Exported as DRUM_CHANNEL.
 *
 * ── webaudiofont quirks this module papers over ─────────────────────────────
 * The npm dist (`webaudiofont/npm/dist/WebAudioFontPlayer.js`) is a plain
 * browser script with NO module exports — top-level `var WebAudioFontPlayer`.
 * We import its source text via Vite `?raw` and evaluate it in a Function
 * scope to extract the constructor (no window globals involved).
 *
 * Its own loader (`loader.startLoad`) injects <script> tags pointed at
 * surikov's CDN and polls `window[variableName]`. The kiosk must work OFFLINE,
 * so we do not use it: instead we fetch preset files from `baseUrl`
 * (default `/webaudiofont`, i.e. self-hosted under `frontend/public/`,
 * populated once at dev time by `frontend/scripts/fetch-webaudiofont-presets.mjs`)
 * and evaluate each file's `var _tone_… / var _drum_…` payload the same
 * Function-scope way. We DO reuse the loader's catalog logic
 * (`findInstrument`/`instrumentInfo`, `findDrum`/`drumInfo`) to resolve a GM
 * program / drum pitch to its preset filename + variable name.
 *
 * `player.adjustPreset(ctx, preset)` decodes zone payloads; the `zone.file`
 * branch uses async `decodeAudioData` with no completion callback, so we poll
 * `zone.buffer` on every zone (same readiness check as `loader.loaded()`).
 *
 * Sustained notes: `queueWaveTable` needs a duration up front, so melodic
 * notes are queued for MAX_NOTE_SECONDS and `noteOff` calls the returned
 * envelope's `.cancel()` (~100ms release ramp — webaudiofont's own release).
 * GM drums ignore noteOff (one-shots), per GM convention.
 *
 * Suspended AudioContext (FKB WebView starts suspended until a gesture):
 * `noteOn` auto-resumes a suspended context (fire-and-forget), and an explicit
 * `resume()` is exposed for callers that want to await it on first tap.
 * webaudiofont's queueWaveTable also calls resume() internally as a backstop.
 */
import getLogger from '../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'gm-synth' });
  return _logger;
}

/** GM percussion channel, 0-indexed (MIDI "channel 10"). */
export const DRUM_CHANNEL = 9;

/**
 * Starter GM drum kit — the pitches loadDrums() fetches (webaudiofont ships a
 * separate preset file per drum piece): kick, snare, closed/open hat, crash,
 * ride, low/mid/high toms.
 */
export const DRUM_NOTES = [36, 38, 42, 45, 46, 47, 49, 50, 51];

/** Melodic notes are queued this long, then released via noteOff → cancel(). */
const MAX_NOTE_SECONDS = 30;
/** Drum one-shots: non-looping zones clamp to sample length inside webaudiofont. */
const DRUM_NOTE_SECONDS = 3;
/** How long to wait for adjustPreset's async decodeAudioData to fill zone buffers. */
const BUFFER_WAIT_MS = 15000;
const BUFFER_POLL_MS = 50;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Evaluate a webaudiofont preset file's source and extract its preset object.
 * Preset files are plain scripts of the form `var _tone_XXXX_sf2_file = {…};`
 * (sometimes with a leading console.log). Function scope keeps the var out of
 * the global namespace.
 */
function evalPresetSource(sourceText, variableName) {
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${sourceText}\n;return (typeof ${variableName} !== 'undefined') ? ${variableName} : undefined;`);
  return fn();
}

/** Default player factory: evaluate the npm dist source (no module exports). */
async function defaultPlayerFactory() {
  const { default: source } = await import('webaudiofont/npm/dist/WebAudioFontPlayer.js?raw');
  // eslint-disable-next-line no-new-func
  const PlayerCtor = new Function(`${source}\n;return WebAudioFontPlayer;`)();
  return new PlayerCtor();
}

/** Wait until every zone of a preset has a decoded AudioBuffer. */
function waitForZoneBuffers(preset, timeoutMs) {
  const ready = () => preset.zones.every((z) => !!z.buffer);
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (ready()) { clearInterval(id); resolve(); return; }
      if (Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        reject(new Error('gm-synth: preset zone decode timed out'));
      }
    }, BUFFER_POLL_MS);
  });
}

/**
 * Create a GM synth instance.
 *
 * @param {object} opts
 * @param {AudioContext} opts.audioContext - shared Web Audio context.
 * @param {string} [opts.baseUrl='/webaudiofont'] - where preset .js files are
 *   served from (self-hosted; NO CDN at runtime).
 * @param {() => object|Promise<object>} [opts.playerFactory] - DI seam for
 *   tests; returns a WebAudioFontPlayer-compatible object.
 * @param {typeof fetch} [opts.fetchImpl] - DI seam for tests.
 * @returns GM synth with load/loadDrums/noteOn/noteOff/setChannelProgram/
 *   setChannelGain/allNotesOff/resume/dispose. Channels 0-indexed; 9 = drums.
 */
export function createGmSynth({
  audioContext,
  baseUrl = '/webaudiofont',
  playerFactory = defaultPlayerFactory,
  fetchImpl,
} = {}) {
  if (!audioContext) throw new Error('createGmSynth: audioContext is required');
  const doFetch = fetchImpl || ((...args) => fetch(...args));

  let disposed = false;
  let player = null;
  let playerPromise = null;

  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

  /** ch → { gainNode, program } */
  const channels = new Map();
  /** program → preset (decoded, playable) */
  const presets = new Map();
  /** program → in-flight load promise (dedupe) */
  const loading = new Map();
  /** drum pitch → preset */
  const drumPresets = new Map();
  let drumsLoading = null;
  let drumsLoaded = false;
  /** `${ch}:${note}` → envelope (melodic voices only; drums are one-shots) */
  const activeVoices = new Map();

  function ensurePlayer() {
    if (player) return Promise.resolve(player);
    if (!playerPromise) {
      playerPromise = Promise.resolve()
        .then(() => playerFactory())
        .then((p) => { player = p; return p; })
        .catch((err) => {
          playerPromise = null;
          logger().warn('gm-synth.player-init-failed', { error: err?.message });
          throw err;
        });
    }
    return playerPromise;
  }

  function ensureChannel(ch) {
    let state = channels.get(ch);
    if (!state) {
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1;
      gainNode.connect(masterGain);
      state = { gainNode, program: undefined };
      channels.set(ch, state);
    }
    return state;
  }

  const fileUrlFor = (cdnUrl) => `${baseUrl}/${cdnUrl.split('/').pop()}`;

  async function fetchAndDecode(kind, url, variableName, meta) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    logger().info('gm-synth.load-start', { kind, url, ...meta });
    const resp = await doFetch(url);
    if (!resp.ok) throw new Error(`gm-synth: HTTP ${resp.status} fetching ${url}`);
    const text = await resp.text();
    const preset = evalPresetSource(text, variableName);
    if (!preset || !Array.isArray(preset.zones)) {
      throw new Error(`gm-synth: ${variableName} missing or malformed in ${url}`);
    }
    player.adjustPreset(audioContext, preset);
    await waitForZoneBuffers(preset, BUFFER_WAIT_MS);
    const ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
    logger().info('gm-synth.load-success', { kind, ms, zones: preset.zones.length, ...meta });
    return preset;
  }

  /**
   * Lazy-load + cache one melodic instrument (idempotent; concurrent calls
   * share one in-flight fetch). Rejects on failure — callers on the hot path
   * (setChannelProgram) swallow + log instead.
   */
  async function load(program) {
    if (disposed) return;
    if (presets.has(program)) return;
    if (loading.has(program)) return loading.get(program);
    const p = (async () => {
      const pl = await ensurePlayer();
      const info = pl.loader.instrumentInfo(pl.loader.findInstrument(program));
      const preset = await fetchAndDecode('instrument', fileUrlFor(info.url), info.variable, { program });
      presets.set(program, preset);
    })();
    loading.set(program, p);
    try {
      await p;
    } catch (err) {
      logger().warn('gm-synth.load-failed', { program, error: err?.message });
      throw err;
    } finally {
      loading.delete(program);
    }
  }

  /** Load the percussion set (one preset file per DRUM_NOTES pitch). */
  async function loadDrums() {
    if (disposed) return;
    if (drumsLoaded) return;
    if (drumsLoading) return drumsLoading;
    drumsLoading = (async () => {
      const pl = await ensurePlayer();
      const results = await Promise.allSettled(DRUM_NOTES.map(async (pitch) => {
        const info = pl.loader.drumInfo(pl.loader.findDrum(pitch));
        const preset = await fetchAndDecode('drum', fileUrlFor(info.url), info.variable, { pitch });
        drumPresets.set(pitch, preset);
      }));
      const failed = results.filter((r) => r.status === 'rejected');
      for (const f of failed) {
        logger().warn('gm-synth.load-failed', { kind: 'drum', error: f.reason?.message });
      }
      if (failed.length === DRUM_NOTES.length) {
        throw new Error('gm-synth: all drum presets failed to load');
      }
      drumsLoaded = true;
    })();
    try {
      await drumsLoading;
    } finally {
      drumsLoading = null;
    }
  }

  function resumeIfSuspended() {
    if (audioContext.state === 'suspended') {
      logger().debug('gm-synth.resume', { from: 'noteOn' });
      Promise.resolve(audioContext.resume()).catch(() => {});
    }
  }

  /**
   * Play a note. Channel 9 (0-indexed) routes to the GM drum map; any other
   * channel plays its assigned program (default 0). Notes on presets that are
   * not loaded yet are silently dropped (sampled debug log) — never throws
   * mid-performance.
   */
  function noteOn(channel, note, velocity) {
    if (disposed || !player) {
      if (!disposed) logger().sampled('gm-synth.note-dropped', { channel, note, reason: 'no-player' }, { maxPerMinute: 10, aggregate: true });
      return;
    }
    resumeIfSuspended();
    const volume = clamp(velocity, 1, 127) / 127;
    const state = ensureChannel(channel);

    if (channel === DRUM_CHANNEL) {
      const preset = drumPresets.get(note);
      if (!preset) {
        logger().sampled('gm-synth.note-dropped', { channel, note, reason: 'drum-not-loaded' }, { maxPerMinute: 10, aggregate: true });
        return;
      }
      player.queueWaveTable(audioContext, state.gainNode, preset, 0, note, DRUM_NOTE_SECONDS, volume);
      return;
    }

    const program = state.program ?? 0;
    const preset = presets.get(program);
    if (!preset) {
      logger().sampled('gm-synth.note-dropped', { channel, note, program, reason: 'program-not-loaded' }, { maxPerMinute: 10, aggregate: true });
      return;
    }
    const key = `${channel}:${note}`;
    // Retrigger: release any still-ringing voice on the same channel+note.
    const prior = activeVoices.get(key);
    if (prior) { try { prior.cancel(); } catch (_) { /* voice already dead */ } }
    const envelope = player.queueWaveTable(audioContext, state.gainNode, preset, 0, note, MAX_NOTE_SECONDS, volume);
    if (envelope) activeVoices.set(key, envelope);
  }

  /**
   * Release a sustained note (webaudiofont envelope.cancel → ~100ms ramp).
   * No-op for the drum channel (GM percussion ignores note-off) and for
   * unknown notes.
   */
  function noteOff(channel, note) {
    if (channel === DRUM_CHANNEL) return;
    const key = `${channel}:${note}`;
    const envelope = activeVoices.get(key);
    if (!envelope) return;
    activeVoices.delete(key);
    try { envelope.cancel(); } catch (_) { /* voice already dead */ }
  }

  /**
   * Assign a GM program to a channel and kick off its load if needed
   * (fire-and-forget: failures are logged, never rejected to the caller).
   */
  function setChannelProgram(channel, program) {
    if (disposed) return;
    ensureChannel(channel).program = program;
    load(program).catch(() => { /* logged inside load() */ });
  }

  /** Set channel gain 0..1 on the channel's GainNode (applies to live voices too). */
  function setChannelGain(channel, gain) {
    if (disposed) return;
    ensureChannel(channel).gainNode.gain.value = clamp(gain, 0, 1);
  }

  /** Panic. With a channel: release that channel's tracked voices. Without: everything. */
  function allNotesOff(channel) {
    if (channel == null) {
      if (player) { try { player.cancelQueue(audioContext); } catch (_) { /* context torn down */ } }
      activeVoices.clear();
      return;
    }
    const prefix = `${channel}:`;
    for (const [key, envelope] of activeVoices) {
      if (key.startsWith(prefix)) {
        activeVoices.delete(key);
        try { envelope.cancel(); } catch (_) { /* voice already dead */ }
      }
    }
  }

  /** Await-able resume for callers that want to unlock audio on first gesture. */
  async function resume() {
    if (audioContext.state === 'suspended') await audioContext.resume();
  }

  function dispose() {
    if (disposed) return;
    allNotesOff();
    disposed = true;
    for (const [, state] of channels) {
      try { state.gainNode.disconnect(); } catch (_) { /* already disconnected */ }
    }
    try { masterGain.disconnect(); } catch (_) { /* already disconnected */ }
    channels.clear();
    presets.clear();
    loading.clear();
    drumPresets.clear();
    activeVoices.clear();
    logger().info('gm-synth.disposed', {});
  }

  logger().info('gm-synth.created', { baseUrl });

  return {
    load,
    loadDrums,
    noteOn,
    noteOff,
    setChannelProgram,
    setChannelGain,
    allNotesOff,
    resume,
    dispose,
  };
}

export default createGmSynth;
