/**
 * Shared setup for commands that work on one copy of a title: resolve the Plex
 * part and its source, probe it, and load (or make, once) its word transcript.
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { FfmpegRefineMedia } from '../../server/adapters/content-filter/FfmpegRefineMedia.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} ctx
 * @param {string} ctx.rk - Plex rating key
 * @param {object} ctx.flags - --part, --src, --transcript
 * @param {string} ctx.mediaFilterDir - <mediaDir>/content-filter
 * @param {Function} ctx.loadPlexConfig
 * @param {Function} ctx.getJson
 * @param {string} [ctx.verb] - for the progress line
 */
export async function prepareCopy({ rk, flags, mediaFilterDir, loadPlexConfig, getJson, verb = 'Working on' }) {
  const { token, host } = loadPlexConfig();
  const meta = (await getJson(`${host}/library/metadata/${rk}?X-Plex-Token=${token}`))?.MediaContainer?.Metadata?.[0];
  const parts = (meta?.Media || []).flatMap((m) => m.Part || []);
  if (!parts.length) throw new Error(`Plex item ${rk} has no media parts`);
  const part = flags.part ? parts.find((p) => String(p.id) === String(flags.part)) : parts[0];
  if (!part) throw new Error(`Part ${flags.part} not on ${rk}; parts: ${parts.map((p) => p.id).join(', ')}`);
  const src = flags.src || `${host}${part.key}?X-Plex-Token=${token}`;
  const partId = String(part.id);

  const workDir = path.join(mediaFilterDir, 'refine', rk);
  mkdirSync(path.join(workDir, 'art'), { recursive: true });
  const media = new FfmpegRefineMedia();
  const probe = await media.probe(src);
  if (probe.variableFrameRate) console.error(`⚠ variable frame rate (${probe.fps} vs avg ${probe.avgFps}); frame numbers are nominal`);
  console.error(`${verb} ${rk} "${meta?.title || ''}" part ${partId}: ${probe.width}x${probe.height} ${probe.fps} fps, ${Math.round(probe.duration)} s`);

  const transcriptPath = flags.transcript || path.join(workDir, `words-${partId}.json`);
  if (!existsSync(transcriptPath)) {
    console.error('Transcribing (word timestamps)… this runs once per part.');
    const cmd = (process.env.CONTENT_FILTER_TRANSCRIBE_PY || 'uv run --script').split(/\s+/);
    execFileSync(cmd[0], [...cmd.slice(1), path.join(HERE, 'transcribe.py'), src, transcriptPath], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
  return { meta, partId, src, workDir, media, probe, transcript };
}
