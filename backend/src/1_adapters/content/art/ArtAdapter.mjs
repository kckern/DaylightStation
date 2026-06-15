/**
 * ArtAdapter — selects a classic artwork from media/img/art/classic.
 *
 * Each artwork lives in its own subfolder containing one image file plus a
 * metadata.yaml. Selection is currently RANDOM; this `pick` seam is where a
 * date-seeded "one painting per day" policy would later plug in.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createArtAdapter({ imgBasePath, logger = console }) {
  const artDir = path.join(imgBasePath, 'art', 'classic');

  async function selectFeatured({ pick = randomPick } = {}) {
    let entries;
    try {
      entries = await fs.readdir(artDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`No artwork available: ${err.message}`);
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (folders.length === 0) throw new Error('No artwork available');

    const folder = pick(folders);
    const folderPath = path.join(artDir, folder);
    const files = await fs.readdir(folderPath);
    const imageFile = files.find((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
    if (!imageFile) throw new Error(`No image file in art folder: ${folder}`);

    let meta = { title: null, artist: null, date: null, origin: null, medium: null };
    try {
      const raw = await fs.readFile(path.join(folderPath, 'metadata.yaml'), 'utf-8');
      const parsed = yaml.load(raw) || {};
      meta = {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        date: parsed.date != null ? String(parsed.date) : null,
        origin: parsed.origin ?? null,
        medium: parsed.medium ?? null,
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { folder, error: err.message });
    }

    const image =
      `/media/img/art/classic/${encodeURIComponent(folder)}/${encodeURIComponent(imageFile)}`;
    return { image, meta };
  }

  return { selectFeatured };
}

export default createArtAdapter;
