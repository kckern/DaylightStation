/**
 * ArtAdapter — selects a classic artwork from media/img/art/classic.
 *
 * Each artwork lives in its own subfolder containing one image file plus a
 * metadata.yaml. Only landscape works whose aspect ratio (width / height) sits
 * between 4:3 and 16:9 (inclusive) are eligible — narrower (portrait/square)
 * and wider (panoramic) works are filtered out so the painting fills the
 * 16:9 frame without awkward gaps.
 *
 * Selection is RANDOM over the eligible set; this `pick` seam is where a
 * date-seeded "one painting per day" policy would later plug in. The eligible
 * set is built once (reading every metadata.yaml) and cached for the process.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIN_RATIO = 4 / 3;   // narrowest allowed (>= 4:3); narrower → excluded
const MAX_RATIO = 16 / 9;  // widest allowed (<= 16:9); wider → excluded
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

export function createArtAdapter({ imgBasePath, logger = console }) {
  const artDir = path.join(imgBasePath, 'art', 'classic');
  let eligibleCache = null; // [{ folder, meta }] — built once, reused

  async function readMeta(folder) {
    try {
      const raw = await fs.readFile(path.join(artDir, folder, 'metadata.yaml'), 'utf-8');
      const parsed = yaml.load(raw) || {};
      return {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        date: parsed.date != null ? String(parsed.date) : null,
        origin: parsed.origin ?? null,
        medium: parsed.medium ?? null,
        width: toInt(parsed.width),
        height: toInt(parsed.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { folder, error: err.message });
      return null;
    }
  }

  // Build the eligible set: landscape works with a known aspect ratio in range.
  async function buildEligible() {
    let entries;
    try {
      entries = await fs.readdir(artDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`No artwork available: ${err.message}`);
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const eligible = [];
    for (const folder of folders) {
      const meta = await readMeta(folder);
      if (!meta || !meta.width || !meta.height) continue; // need dims to judge aspect
      const ratio = meta.width / meta.height;
      if (ratio >= MIN_RATIO && ratio <= MAX_RATIO) eligible.push({ folder, meta });
    }
    logger.info?.('art.index.built', { total: folders.length, eligible: eligible.length });
    return eligible;
  }

  async function selectFeatured({ pick = randomPick } = {}) {
    if (!eligibleCache) eligibleCache = await buildEligible();
    if (eligibleCache.length === 0) throw new Error('No artwork available');

    const chosen = pick(eligibleCache);
    const folderPath = path.join(artDir, chosen.folder);
    let files;
    try {
      files = await fs.readdir(folderPath);
    } catch (err) {
      logger.warn?.('art.folder.unreadable', { folder: chosen.folder, error: err.message });
      throw new Error(`No artwork available: ${err.message}`);
    }
    const imageFile = files.find((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
    if (!imageFile) {
      logger.warn?.('art.image.missing', { folder: chosen.folder });
      throw new Error(`No image file in art folder: ${chosen.folder}`);
    }

    const image =
      `/media/img/art/classic/${encodeURIComponent(chosen.folder)}/${encodeURIComponent(imageFile)}`;
    return { image, meta: chosen.meta };
  }

  return { selectFeatured };
}

export default createArtAdapter;
