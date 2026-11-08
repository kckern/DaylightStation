/**
 * contentfilter preflight <ratingKey> — can a pipeline run happen on this machine?
 * Checks what refine needs (transcription, word alignment, ImageMagick) and that Plex can
 * name the film's media part. Prints the first problem as
 * "Refine cannot run here: <what> is not installed" (or the Plex error) and exits 1.
 */
import { spawnSync } from 'child_process';

const pyCmd = (env, key, fallback) => (env[key] || fallback).split(/\s+/);

/** @returns {string|null} the first problem, or null */
export async function preflight({ rk, env = process.env, run = spawnSync, partOf }) {
  const py = (key, fallback, code) => {
    const [bin, ...pre] = pyCmd(env, key, fallback);
    const r = run(bin, [...pre, '-c', code], { encoding: 'utf8', timeout: 30000 });
    return r.status === 0;
  };
  // uv-run scripts declare their own deps; a plain python must have one backend importable.
  if (env.CONTENT_FILTER_TRANSCRIBE_PY && !py('CONTENT_FILTER_TRANSCRIBE_PY', 'python3',
    'import importlib.util as u, sys; sys.exit(0 if (u.find_spec("faster_whisper") or u.find_spec("mlx_whisper")) else 1)')) {
    return 'Refine cannot run here: faster-whisper is not installed';
  }
  if (!env.CONTENT_FILTER_TRANSCRIBE_PY && run('uv', ['--version'], { encoding: 'utf8' }).status !== 0) {
    return 'Refine cannot run here: uv is not installed (or set CONTENT_FILTER_TRANSCRIBE_PY)';
  }
  if (!py('CONTENT_FILTER_ALIGN_PY', 'python3', 'import torch, torchaudio')) return 'Refine cannot run here: torch and torchaudio are not installed';
  const has = (b) => run('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).status === 0;
  if (!has('magick') && !has('convert')) return 'Refine cannot run here: ImageMagick is not installed';
  if (!has('ffmpeg')) return 'Refine cannot run here: ffmpeg is not installed';
  try {
    if (!(await partOf(rk))) return `Plex has no media part for ${rk}`;
  } catch (e) {
    return `Plex could not be reached for ${rk}: ${e.message}`;
  }
  return null;
}
