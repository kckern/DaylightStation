import path from 'node:path';
import { IFeedbackRepository } from '#apps/common/feedback/ports/IFeedbackRepository.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';
import { deleteFile, deleteYaml, fileExists, listDirs, listYamlFiles, loadYaml, saveYaml, writeBinary } from '#system/utils/FileIO.mjs';

const AUDIO_MIME = Object.freeze({
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
});

export function feedbackItemPath(root, app, id) {
  const match = /^(\d{4})(\d{2})\d{8}_/.exec(id);
  if (!match) throw new Error(`unpartitionable feedback id: ${id}`);
  return path.join(root, app, `${match[1]}-${match[2]}`, `${id}.yml`);
}

export class FilesystemFeedbackRepository extends IFeedbackRepository {
  #itemsRoot; #mediaDir;
  constructor({ itemsRoot, mediaDir }) { super(); this.#itemsRoot = itemsRoot; this.#mediaDir = mediaDir; }
  saveAudio({ app, id, extension, bytes }) {
    const relative = path.posix.join('audio', 'feedback', app, `${id}.${extension}`);
    writeBinary(path.join(this.#mediaDir, relative), bytes);
    return relative;
  }
  save(item) { saveYaml(feedbackItemPath(this.#itemsRoot, item.app, item.id), item); }
  load(app, id) {
    let locator;
    try {
      locator = feedbackItemPath(this.#itemsRoot, app, id);
    } catch {
      return null;
    }
    return loadYaml(locator);
  }
  listApps() { return listDirs(this.#itemsRoot); }
  list(app) {
    const directory = path.join(this.#itemsRoot, app);
    return listYamlFiles(directory, { recursive: true }).map(relative => {
      const item = loadYaml(path.join(directory, relative)) || {};
      return { ...item, id: item.id || path.posix.basename(relative) };
    });
  }
  remove(item) {
    if (item.audio) deleteFile(path.join(this.#mediaDir, item.audio));
    return deleteYaml(feedbackItemPath(this.#itemsRoot, item.app, item.id).replace(/\.yml$/, ''));
  }
  findAudioResource(app, id) {
    const item = this.load(app, id);
    if (!item?.audio) return null;
    const locator = path.join(this.#mediaDir, item.audio);
    return fileExists(locator)
      ? createLocalFileResource(locator, { mimeType: AUDIO_MIME[path.extname(locator).toLowerCase()] ?? 'application/octet-stream' })
      : null;
  }
}
