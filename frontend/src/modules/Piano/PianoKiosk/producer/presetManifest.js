/**
 * presetManifest — single source of truth for which webaudiofont presets the
 * Producer's gmSynth self-hosts under `frontend/public/webaudiofont/`.
 *
 * Imported by BOTH the runtime (gmSynth.js) and the dev-time downloader
 * (frontend/scripts/fetch-webaudiofont-presets.mjs), so the two can never
 * drift. Keep this file dependency-free — the fetch script runs it in plain
 * node. gmSynth.catalog.test.js walks these lists through the real installed
 * webaudiofont catalog and asserts every resolved file exists on disk.
 */

/**
 * Starter GM program set: acoustic grand (0), e-piano 1 (4), nylon guitar
 * (24), steel guitar (25), acoustic bass (32), fingered bass (33), string
 * ensemble (48), synth pad 1 (88).
 */
export const GM_PROGRAMS = [0, 4, 24, 25, 32, 33, 48, 88];

/**
 * GM percussion pitches (webaudiofont ships one preset file per drum piece):
 * kick 36, snare 38, closed hat 42, low tom 45, open hat 46, mid tom 47,
 * crash 49, high tom 50, ride 51.
 */
export const DRUM_NOTES = [36, 38, 42, 45, 46, 47, 49, 50, 51];
