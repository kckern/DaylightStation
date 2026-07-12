import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluidSynthMp3Converter } from '#adapters/pianoaudio/FluidSynthMp3Converter.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let root, scratchDir, midiPath, mp3Path;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pianoaudio-conv-'));
  scratchDir = path.join(root, 'scratch');
  midiPath = path.join(root, 'src', 'take.mid');
  mp3Path = path.join(root, 'dst', 'nested', 'take.mp3');
  fs.mkdirSync(path.dirname(midiPath), { recursive: true });
  fs.writeFileSync(midiPath, 'MID');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

// Fake exec seam that emulates fluidsynth (writes the wav named after -F) and
// ffmpeg (writes the output file, the second-to-last argv before '-y').
function fakeExec() {
  return vi.fn(async (cmd, args) => {
    if (cmd === 'fluidsynth') {
      const wav = args[args.indexOf('-F') + 1];
      fs.writeFileSync(wav, 'WAV');
    } else if (cmd === 'ffmpeg') {
      const out = args[args.length - 2];
      fs.writeFileSync(out, 'MP3');
    }
    return { stdout: '', stderr: '' };
  });
}

describe('FluidSynthMp3Converter.convert', () => {
  it('runs fluidsynth then ffmpeg with the exact argv and produces the mp3', async () => {
    const execFile = fakeExec();
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await conv.convert(midiPath, mp3Path);

    expect(execFile).toHaveBeenCalledTimes(2);

    const [fsCmd, fsArgs] = execFile.mock.calls[0];
    expect(fsCmd).toBe('fluidsynth');
    const fIdx = fsArgs.indexOf('-F');
    const wavPath = fsArgs[fIdx + 1];
    expect(fsArgs).toEqual(['-ni', '-F', wavPath, '-r', '44100', '/sf/TimGM6mb.sf2', midiPath]);
    expect(path.dirname(wavPath)).toBe(scratchDir);
    expect(wavPath.endsWith('.wav')).toBe(true);

    const [ffCmd, ffArgs] = execFile.mock.calls[1];
    expect(ffCmd).toBe('ffmpeg');
    expect(ffArgs).toEqual([
      '-i', wavPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      `${mp3Path}.tmp`, '-y',
    ]);

    expect(fs.existsSync(mp3Path)).toBe(true);        // final mp3 present
    expect(fs.existsSync(`${mp3Path}.tmp`)).toBe(false); // tmp renamed away
    expect(fs.existsSync(wavPath)).toBe(false);          // scratch wav cleaned
  });

  it('skips conversion (no exec) when the final mp3 already exists', async () => {
    fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
    fs.writeFileSync(mp3Path, 'EXISTING');
    const execFile = fakeExec();
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await conv.convert(midiPath, mp3Path);

    expect(execFile).not.toHaveBeenCalled();
    expect(fs.readFileSync(mp3Path, 'utf8')).toBe('EXISTING');
  });

  it('cleans up the scratch wav and leaves no final mp3 when ffmpeg fails', async () => {
    let wavPath;
    const execFile = vi.fn(async (cmd, args) => {
      if (cmd === 'fluidsynth') {
        wavPath = args[args.indexOf('-F') + 1];
        fs.writeFileSync(wavPath, 'WAV');
        return { stdout: '', stderr: '' };
      }
      throw new Error('ffmpeg exit 1');
    });
    const conv = new FluidSynthMp3Converter({
      soundfontPath: '/sf/TimGM6mb.sf2', scratchDir, logger: silent, execFile,
    });

    await expect(conv.convert(midiPath, mp3Path)).rejects.toThrow('ffmpeg exit 1');

    expect(fs.existsSync(mp3Path)).toBe(false);
    expect(fs.existsSync(`${mp3Path}.tmp`)).toBe(false);
    expect(fs.existsSync(wavPath)).toBe(false);
  });
});
