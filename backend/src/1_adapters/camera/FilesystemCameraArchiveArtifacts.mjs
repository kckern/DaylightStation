import path from 'node:path';
import { ICameraArchiveArtifacts } from '#apps/camera/ports/ICameraArchiveArtifacts.mjs';
import { deleteDirAsync, ensureDirAsync } from '#system/utils/FileIO.mjs';

const layouts = new WeakMap();
export class FilesystemCameraArchiveArtifacts extends ICameraArchiveArtifacts {
  #workRoot; #hotRoot;
  constructor({ workRoot, hotRoot }) { super(); this.#workRoot = workRoot; this.#hotRoot = hotRoot; }
  async beginDay(cameraId, day) {
    const work = path.join(this.#workRoot, cameraId, day);
    const output = path.join(this.#hotRoot, cameraId, day);
    await ensureDirAsync(work); await ensureDirAsync(path.join(output, 'audio'));
    const handle = Object.freeze({ kind: 'camera-archive-day' }); layouts.set(handle, { work, output }); return handle;
  }
  segment(day, index) { return path.join(requireDay(day).work, `seg-${String(index).padStart(3, '0')}.mp4`); }
  sheetCollection(day) { return path.join(requireDay(day).output, 'sheets'); }
  sessionClip(day, { index, time, label }) { return target(path.join(requireDay(day).output, `s${String(index + 1).padStart(2, '0')}-${time}-${label}.mp4`)); }
  audioSidecar(day, { time, container }) { return target(path.join(requireDay(day).output, 'audio', `${time}.${container}`)); }
  timelapse(day, phase) { return target(path.join(requireDay(day).output, `timelapse-${phase}.mp4`)); }
  concatManifest(day, index) { return path.join(requireDay(day).work, `session-${index}.concat.txt`); }
  async discard(day) { const state = requireDay(day); await deleteDirAsync(state.work, { force: true }); }
}
const requireDay = handle => { const state = layouts.get(handle); if (!state) throw new Error('invalid camera archive day'); return state; };
const target = locator => ({ locator, name: path.basename(locator) });
