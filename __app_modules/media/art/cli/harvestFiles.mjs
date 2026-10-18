import path from 'node:path';
import { readdir, readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import yaml from 'js-yaml';
import { artworkIdentity } from './collectionHarvest.mjs';

const imageFile = (name) => /\.(?:jpe?g|png|webp)$/i.test(name);
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const safeName = (name) => String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/g, '') || 'Untitled';

export async function downloadHarvest({ manifest, cacheDir, allowWrite = false, fetch = globalThis.fetch, concurrency = 4, onProgress = () => {} }) {
  if (!allowWrite) throw new Error('Download requires --allow-write');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Concurrency must be 1..8');
  await mkdir(cacheDir, { recursive: true });
  const items = manifest.items.filter((item) => item.status === 'download');
  const result = { total: items.length, downloaded: 0, cached: 0, errors: [] };
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      if (!/^\d+$/.test(item.productId)) { result.errors.push({ productId: item.productId, error: 'Invalid product ID' }); continue; }
      const file = path.join(cacheDir, `${item.productId}.image`);
      try {
        const source = JSON.parse(await readFile(`${file}.json`, 'utf8'));
        if (source.url === item.image.src) { imageSize(await readFile(file)); result.cached++; continue; }
      } catch { /* Absent or incomplete cache entries are re-fetched. */ }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(item.image.src, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { permanent: response.status >= 400 && response.status < 500 && response.status !== 429 });
          const bytes = Buffer.from(await response.arrayBuffer());
          const dimensions = imageSize(bytes);
          if (!['jpg', 'jpeg', 'png', 'webp'].includes(dimensions.type)) throw Object.assign(new Error('Not a supported artwork image'), { permanent: true });
          await writeFile(file, bytes);
          await writeFile(`${file}.json`, JSON.stringify({ url: item.image.src, sha256: digest(bytes), width: dimensions.width, height: dimensions.height }));
          result.downloaded++; break;
        } catch (err) {
          if (attempt === 2 || err.permanent) { result.errors.push({ productId: item.productId, url: item.image.src, error: err.message }); break; }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      onProgress({ completed: result.downloaded + result.cached + result.errors.length, total: result.total, failed: result.errors.length });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

export async function scanLibrary(root) {
  const works = [];
  async function walk(directory) {
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
    if (files.some((file) => file.isFile() && file.name === 'metadata.yaml')) {
      try {
        const metadata = yaml.load(await readFile(path.join(directory, 'metadata.yaml'), 'utf8')) || {};
        works.push({ ...metadata, directory, images: files.filter((file) => file.isFile() && imageFile(file.name)).map((file) => path.join(directory, file.name)) });
      } catch { /* An unreadable existing work must never be overwritten. */ }
      return;
    }
    for (const file of files) if (file.isDirectory() && !file.name.startsWith('.')) await walk(path.join(directory, file.name));
  }
  await walk(root);
  return works;
}

/** Import pre-fetched originals. Existing assets are never overwritten. */
export async function importHarvest({ manifest, destination, cacheDir, existingRoot, allowWrite = false }) {
  if (!allowWrite) throw new Error('Import requires --allow-write');
  const existing = await scanLibrary(existingRoot);
  const identities = new Map(existing.map((work) => [artworkIdentity(work.artist, work.title), work.directory]));
  const hashes = new Map();
  for (const work of existing) for (const file of work.images) {
    try { hashes.set(digest(await readFile(file)), work.directory); } catch { /* Missing existing bytes confer no content match. */ }
  }
  const result = { imported: 0, duplicates: 0, skipped: 0, errors: [], entries: [] };
  await mkdir(destination, { recursive: true });
  for (const item of manifest.items) {
    if (item.status !== 'download') { result.skipped++; continue; }
    let staging = null;
    try {
      const identity = artworkIdentity(item.artist, item.title);
      if (identities.has(identity)) {
        result.duplicates++; result.entries.push({ productId: item.productId, status: 'existing', directory: identities.get(identity) }); continue;
      }
      const bytes = await readFile(path.join(cacheDir, `${item.productId}.image`));
      const sha256 = digest(bytes);
      if (hashes.has(sha256)) {
        result.duplicates++; result.entries.push({ productId: item.productId, status: 'identical-image', directory: hashes.get(sha256) }); continue;
      }
      const dimensions = imageSize(bytes);
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(dimensions.type) || !(dimensions.width > 0 && dimensions.height > 0)) throw new Error('Unsupported or invalid artwork image');
      const directory = path.join(destination, safeName(`${item.artist} - n.d. - ${item.title}`));
      const metadata = {
        title: item.title, artist: item.artist, date: 'n.d.', medium: item.sourceMedium || null,
        width: dimensions.width, height: dimensions.height, ratio: Number((dimensions.width / dimensions.height).toFixed(4)),
        category: null, display: null, curation_status: 'unreviewed',
        source_url: item.sourceUrl, image_url: item.image.src, source_collection_url: manifest.collection?.url || null,
        source_product_id: item.productId, source_tags: item.sourceTags || [],
        credit: `${item.artist} — ${new URL(item.sourceUrl).hostname}`,
        sha256, acquired_at: new Date().toISOString(),
      };
      staging = path.join(destination, `.import-${randomUUID()}`);
      await mkdir(staging);
      const extension = dimensions.type === 'jpeg' ? 'jpg' : dimensions.type;
      await writeFile(path.join(staging, `${safeName(item.title)}.${extension}`), bytes, { flag: 'wx' });
      await writeFile(path.join(staging, 'metadata.yaml'), yaml.dump(metadata, { lineWidth: 120 }), { flag: 'wx' });
      await rename(staging, directory); staging = null;
      identities.set(identity, directory); hashes.set(sha256, directory);
      result.imported++; result.entries.push({ productId: item.productId, status: 'imported', directory, sha256, width: dimensions.width, height: dimensions.height });
    } catch (err) {
      if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY') { result.skipped++; result.entries.push({ productId: item.productId, status: 'existing-directory' }); }
      else result.errors.push({ productId: item.productId, error: err.message });
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
  return result;
}
