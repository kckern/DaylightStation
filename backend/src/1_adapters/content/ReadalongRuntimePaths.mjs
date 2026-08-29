import path from 'node:path';
import { fileExists } from '#system/utils/FileIO.mjs';

export class ReadalongRuntimePaths {
  constructor({ contentPath, mediaPath } = {}) { this.contentPath = contentPath; this.mediaPath = mediaPath; }
  read() {
    const data = path.join(this.contentPath, 'readalong');
    const audio = path.join(this.mediaPath, 'audio', 'readalong');
    const video = path.join(this.mediaPath, 'video', 'readalong');
    return {
      dataPath: fileExists(data) ? data : this.contentPath,
      mediaPath: fileExists(audio) ? audio : path.join(this.mediaPath, 'audio'),
      mediaPathMap: { talks: fileExists(video) ? video : path.join(this.mediaPath, 'video') },
    };
  }
}
