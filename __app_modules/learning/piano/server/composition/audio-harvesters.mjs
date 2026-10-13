import path from 'node:path';
import { PianoMp3Harvester } from '../adapters/pianoaudio/PianoMp3Harvester.mjs';
import { PianoImageHarvester } from '../adapters/pianoaudio/PianoImageHarvester.mjs';
import { FsMidiLibrary } from "../adapters/pianoaudio/FsMidiLibrary.mjs";
import { FluidSynthMp3Converter } from "../adapters/pianoaudio/FluidSynthMp3Converter.mjs";
import { MidiPngConverter } from "../adapters/pianoaudio/MidiPngConverter.mjs";
import { ConvertPendingPianoMidi } from "../application/pianoaudio/ConvertPendingPianoMidi.mjs";
import { renderPianoRollPng } from "../rendering/pianoaudio/pianoRollImage.mjs";

export function registerPianoAudioHarvesters({ registerHarvester, configService, logger }) {
registerHarvester('piano-mp3', () => {
    const sourceDir = path.join(configService.getMediaDir(), 'midi', 'piano', 'log');
    const destDir = `${configService.getMediaDir()}/audio/piano`;
    const soundfontPath = '/usr/share/soundfonts/TimGM6mb.sf2'; // Alpine soundfont-timgm; confirm path post-build
    // Junk guardrail: skip note-less / long-AND-sparse (stuck note / idle) files;
    // real long practice sessions (dense with notes) still render.
    const pianoAudioCfg = configService?.getHouseholdAppConfig?.(null, 'pianoaudio') || {};
    const junkMinSeconds = pianoAudioCfg.junkMinSeconds ?? 1800; // 30 min
    const junkMinNotes = pianoAudioCfg.junkMinNotes ?? 200;
    const concurrency = pianoAudioCfg.concurrency ?? 8; // parallel renders (host has 16 cores)
    const library = new FsMidiLibrary({ sourceDir, destDir, logger, junkMinSeconds, junkMinNotes });
    const converter = new FluidSynthMp3Converter({ soundfontPath, sourceDir, destDir, scratchDir: '/tmp/pianoaudio', logger });
    const convertUseCase = new ConvertPendingPianoMidi({ library, converter, logger, concurrency });
    return new PianoMp3Harvester({ convertUseCase, logger });
  });

  // Piano-roll PNG — render a wrapped piano-roll image beside every .mid (same
  // junk guard; reuses the shared pending/convert use case with a png output).
  registerHarvester('piano-png', () => {
    const sourceDir = path.join(configService.getMediaDir(), 'midi', 'piano', 'log');
    const destDir = `${configService.getMediaDir()}/audio/piano`;
    const pianoAudioCfg = configService?.getHouseholdAppConfig?.(null, 'pianoaudio') || {};
    const junkMinSeconds = pianoAudioCfg.junkMinSeconds ?? 1800;
    const junkMinNotes = pianoAudioCfg.junkMinNotes ?? 200;
    const concurrency = pianoAudioCfg.pngConcurrency ?? 12; // canvas-only → cheap, more parallelism
    const library = new FsMidiLibrary({ sourceDir, destDir, outputExt: 'png', logger, junkMinSeconds, junkMinNotes });
    const converter = new MidiPngConverter({ sourceDir, destDir, renderPng: renderPianoRollPng, logger });
    const renderUseCase = new ConvertPendingPianoMidi({ library, converter, logger, concurrency });
    return new PianoImageHarvester({ renderUseCase, logger });
  });
}
