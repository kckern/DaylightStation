import { saveImage } from '#system/utils/FileIO.mjs';
export class HarvesterImageStore {
  constructor({ imageDirectory } = {}) { this.imageDirectory = imageDirectory; }
  save = (url, folder, uid) => saveImage(url, this.imageDirectory, folder, uid);
}
