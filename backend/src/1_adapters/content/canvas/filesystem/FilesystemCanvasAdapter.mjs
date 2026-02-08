// backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs
import fs from 'fs';
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

export class FilesystemCanvasAdapter {
  #basePath;
  #proxyPath;
  #fs;
  #exifReader;

  constructor(config, deps = {}) {
    if (!config.basePath) {
      throw new InfrastructureError('FilesystemCanvasAdapter requires basePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'basePath',
      });
    }

    this.#basePath = config.basePath;
    this.#proxyPath = config.proxyPath || '/api/v1/canvas/image';
    this.#fs = deps.fs || fs;
    this.#exifReader = deps.exifReader || null;
  }

  get source() {
    return 'canvas-filesystem';
  }

  get prefixes() {
    return [{ prefix: 'canvas' }];
  }

  async list(filters = {}) {
    const items = [];
    const categories = this.#listCategories();

    for (const category of categories) {
      if (filters.categories?.length > 0 && !filters.categories.includes(category)) {
        continue;
      }

      const categoryPath = `${this.#basePath}/${category}`;
      const files = this.#listImageFiles(categoryPath);

      for (const file of files) {
        const item = await this.#buildItem(category, file);
        if (item) items.push(item);
      }
    }

    return items;
  }

  async getItem(id) {
    let localPath = id.replace(/^canvas:/, '');
    let fullPath = `${this.#basePath}/${localPath}`;

    // Try adding image extensions if exact path not found (best-effort, first wins)
    if (!this.#fs.existsSync(fullPath)) {
      const resolved = IMAGE_EXTENSIONS.find(ext =>
        this.#fs.existsSync(`${fullPath}${ext}`)
      );
      if (resolved) {
        localPath = `${localPath}${resolved}`;
        fullPath = `${this.#basePath}/${localPath}`;
      } else {
        return null;
      }
    }

    // Directory = category container (for sibling browsing)
    if (this.#fs.statSync(fullPath).isDirectory()) {
      const files = this.#listImageFiles(fullPath);
      return new ListableItem({
        id: `canvas:${localPath}`,
        source: this.source,
        title: this.#formatName(localPath),
        itemType: 'container',
        type: 'folder',
        metadata: {
          type: 'folder',
          childCount: files.length,
          librarySectionTitle: 'Canvas',
        }
      });
    }

    const parts = localPath.split('/');
    const category = parts[0];
    const filename = parts.slice(1).join('/');

    return this.#buildItem(category, filename);
  }

  /**
   * Get list items for a category (IContentSource interface)
   * @param {string} id - Category name
   * @returns {Promise<DisplayableItem[]>}
   */
  async getList(id) {
    const localPath = id.replace(/^canvas:/, '');
    return this.list({ categories: [localPath] });
  }

  /**
   * Resolve to playable items (IContentSource interface)
   * Canvas items are static images, not playable media
   * @param {string} id
   * @returns {Promise<[]>}
   */
  async resolvePlayables(id) {
    // Static images aren't playable, return empty array
    return [];
  }

  /**
   * Resolve to displayable items (for slideshows, galleries)
   * @param {string} id - Category name or full path
   * @returns {Promise<DisplayableItem[]>}
   */
  async resolveDisplayables(id) {
    const localPath = id.replace(/^canvas:/, '');
    const fullPath = `${this.#basePath}/${localPath}`;

    // Check if it's a directory (category) or file
    if (this.#fs.existsSync(fullPath) && this.#fs.statSync(fullPath).isDirectory()) {
      // It's a category folder - return all images
      return this.list({ categories: [localPath] });
    }

    // It's a single file
    const item = await this.getItem(`canvas:${localPath}`);
    return item ? [item] : [];
  }

  #listCategories() {
    if (!this.#fs.existsSync(this.#basePath)) return [];

    return this.#fs.readdirSync(this.#basePath)
      .filter(name => {
        const stat = this.#fs.statSync(`${this.#basePath}/${name}`);
        return stat.isDirectory() && !name.startsWith('.');
      });
  }

  #listImageFiles(categoryPath) {
    if (!this.#fs.existsSync(categoryPath)) return [];

    return this.#fs.readdirSync(categoryPath)
      .filter(name => {
        const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext);
      });
  }

  async #buildItem(category, filename) {
    const localPath = `${category}/${filename}`;
    const fullPath = `${this.#basePath}/${localPath}`;
    const exif = await this.#readExif(fullPath);
    const imageUrl = `${this.#proxyPath}/${localPath}`;

    return new DisplayableItem({
      id: `canvas:${localPath}`,
      source: this.source,
      title: this.#titleFromFilename(filename),
      imageUrl,
      thumbnail: imageUrl,
      type: 'image',
      category,
      artist: exif.artist,
      year: exif.year,
      tags: exif.tags || [],
      frameStyle: 'classic',
      metadata: {
        type: 'image',
        parentTitle: this.#formatName(category),
        librarySectionTitle: 'Canvas',
      },
    });
  }

  async #readExif(filePath) {
    if (!this.#exifReader) {
      return { artist: null, year: null, tags: [] };
    }

    try {
      const data = this.#exifReader.load(this.#fs.readFileSync(filePath));
      return {
        artist: data.Artist?.value || null,
        year: this.#parseYear(data.DateTimeOriginal?.value),
        tags: this.#parseTags(data.ImageDescription?.value),
      };
    } catch {
      return { artist: null, year: null, tags: [] };
    }
  }

  #parseYear(dateString) {
    if (!dateString) return null;
    const match = dateString.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  #parseTags(description) {
    if (!description) return [];
    const match = description.match(/Tags:\s*(.+)/i);
    return match ? match[1].split(',').map(t => t.trim()) : [];
  }

  #formatName(name) {
    return name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  #titleFromFilename(filename) {
    return this.#formatName(filename);
  }

  /**
   * Canvas items are standalone display art — no meaningful sibling navigation.
   * @param {string} _compoundId
   * @returns {Promise<null>}
   */
  async resolveSiblings(_compoundId) {
    return null;
  }
}

export default FilesystemCanvasAdapter;
