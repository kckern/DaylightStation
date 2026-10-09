import path from 'node:path';
import { fileExists, saveYaml } from '#system/utils/FileIO.mjs';

/** Persistence and addressing adapter for fresh-video channel metadata. */
export class NewsMediaStore {
  constructor({ mediaRoot }) {
    this.mediaRoot = mediaRoot;
  }

  #providerDir(provider) {
    return path.join(this.mediaRoot, 'video', 'news', provider);
  }

  hasThumbnail(provider) {
    return fileExists(this.thumbnailPath(provider));
  }

  thumbnailPath(provider) {
    return path.join(this.#providerDir(provider), 'show.jpg');
  }

  saveMetadata(provider, metadata) {
    saveYaml(path.join(this.#providerDir(provider), 'metadata'), metadata);
  }

  /** Legacy admin response references; kept with the layout-owning adapter. */
  publicReferences(provider, { thumbnail = false } = {}) {
    return {
      metadataRelPath: `media/video/news/${provider}/metadata.yml`,
      thumbnailRelPath: thumbnail ? `media/video/news/${provider}/show.jpg` : null,
    };
  }
}

export default NewsMediaStore;
