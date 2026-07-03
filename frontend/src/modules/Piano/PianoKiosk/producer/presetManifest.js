/**
 * presetManifest — single source of truth for which webaudiofont presets the
 * Producer's gmSynth self-hosts under `frontend/public/webaudiofont/`.
 *
 * Imported by BOTH the runtime (gmSynth.js) and the dev-time downloader
 * (frontend/scripts/fetch-webaudiofont-presets.mjs), so the two can never
 * drift. Keep this file free of npm deps and aliases — the fetch script runs
 * it in plain node, which is also why GM_DRUM below is imported by RELATIVE
 * path rather than the '@shared-music' vite alias. gmSynth.catalog.test.js
 * walks these lists through the real installed webaudiofont catalog and
 * asserts every resolved file exists on disk.
 */

import { GM_DRUM } from '../../../../../../shared/music/percussion.mjs';

/**
 * Starter GM program set: acoustic grand (0), e-piano 1 (4), nylon guitar
 * (24), steel guitar (25), acoustic bass (32), fingered bass (33), string
 * ensemble (48), synth pad 1 (88).
 */
export const GM_PROGRAMS = [0, 4, 24, 25, 32, 33, 48, 88];

/**
 * GM percussion pitches (webaudiofont ships one preset file per drum piece):
 * kick 36, snare 38, closed hat 42, low tom 45, open hat 46, mid tom 47,
 * crash 49, high tom 50, ride 51. Derived from the engine's GM_DRUM map
 * (shared/music/percussion.mjs) so the synth tier and the music engine can
 * never disagree on which drum pieces exist.
 */
export const DRUM_NOTES = Object.freeze([...Object.values(GM_DRUM)].sort((a, b) => a - b));
