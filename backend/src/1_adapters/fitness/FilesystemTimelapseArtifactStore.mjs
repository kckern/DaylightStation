import os from 'node:os';
import path from 'node:path';
import { ITimelapseArtifactStore } from '#apps/fitness/ports/ITimelapseArtifactStore.mjs';
import {
  buildContainedPath,
  copyFileAsync,
  createHardLinkAsync,
  createTempDir,
  deleteDirAsync,
  ensureDirAsync,
  getFileStatsAsync,
  removeFileAsync,
  writeBinaryAsync,
} from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const FRAME_PATTERN = 'frame_%05d.jpg';
const workspaces = new WeakMap();
const artifacts = new WeakMap();

/** Filesystem implementation of the semantic recap artifact boundary. */
export class FilesystemTimelapseArtifactStore extends ITimelapseArtifactStore {
  #mediaDir;
  #videoEncoder;
  #logger;

  constructor({ mediaDir, videoEncoder, logger = console } = {}) {
    super();
    if (!mediaDir || !videoEncoder) {
      throw new InfrastructureError('FilesystemTimelapseArtifactStore requires mediaDir and videoEncoder', {
        code: 'MISSING_DEPENDENCY',
      });
    }
    this.#mediaDir = mediaDir;
    this.#videoEncoder = videoEncoder;
    this.#logger = logger;
  }

  async createWorkspace(sessionId) {
    const safeId = String(sessionId || 'session').replace(/[^A-Za-z0-9._-]/g, '-');
    const directory = await createTempDir(path.join(os.tmpdir(), `tl-${safeId}-`));
    const handle = Object.freeze({ kind: 'timelapse-workspace' });
    workspaces.set(handle, { directory });
    return handle;
  }

  async writeFrame(workspace, { index, bytes } = {}) {
    const state = requireHandle(workspaces, workspace, 'workspace');
    if (!Number.isInteger(index) || index < 0 || !Buffer.isBuffer(bytes)) {
      throw new InfrastructureError('invalid timelapse frame', { code: 'INVALID_FRAME' });
    }
    const name = `frame_${String(index).padStart(5, '0')}.jpg`;
    await writeBinaryAsync(path.join(state.directory, name), bytes);
  }

  async encode(workspace, { slug, fps, crf = 26, preset, metadata = null } = {}) {
    const state = requireHandle(workspaces, workspace, 'workspace');
    const outputDir = buildContainedPath(this.#mediaDir, 'video/fitness');
    const outputPath = outputDir && buildContainedPath(outputDir, `${slug}.mp4`);
    if (!outputPath) {
      throw new InfrastructureError('invalid timelapse artifact name', { code: 'INVALID_ARTIFACT' });
    }
    await ensureDirAsync(outputDir);
    await this.#videoEncoder.encodeSequence({
      framesDir: state.directory,
      pattern: FRAME_PATTERN,
      fps,
      outputPath,
      crf,
      ...(preset ? { preset } : {}),
      metadata,
    });

    let sizeBytes = null;
    try { sizeBytes = (await getFileStatsAsync(outputPath))?.size ?? null; } catch { /* best-effort */ }
    const artifact = Object.freeze({ kind: 'timelapse-artifact' });
    artifacts.set(artifact, { outputPath });
    return {
      artifact,
      videoPath: `media/video/fitness/${slug}.mp4`,
      sizeBytes,
    };
  }

  async publishPlexCopy(artifact, { plexFileBase } = {}) {
    const state = requireHandle(artifacts, artifact, 'artifact');
    const plexDir = buildContainedPath(this.#mediaDir, 'video/fitness/plex');
    const filename = `${plexFileBase}.mp4`;
    const plexPath = plexDir && buildContainedPath(plexDir, filename);
    if (!plexPath) {
      throw new InfrastructureError('invalid Plex artifact name', { code: 'INVALID_ARTIFACT' });
    }
    await ensureDirAsync(plexDir);
    try { await removeFileAsync(plexPath, { force: true }); } catch { /* replacement remains best-effort */ }
    try {
      await createHardLinkAsync(state.outputPath, plexPath);
    } catch (error) {
      this.#logger?.debug?.('fitness.timelapse.plex_hardlink_fallback', { error: error.message });
      await copyFileAsync(state.outputPath, plexPath);
    }
    return `media/video/fitness/plex/${filename}`;
  }

  async discardWorkspace(workspace) {
    const state = workspaces.get(workspace);
    if (!state) return;
    workspaces.delete(workspace);
    try { await deleteDirAsync(state.directory, { force: true }); } catch { /* best-effort */ }
  }
}

function requireHandle(registry, handle, label) {
  const state = registry.get(handle);
  if (!state) throw new InfrastructureError(`invalid timelapse ${label}`, { code: 'INVALID_HANDLE' });
  return state;
}
