/**
 * fetch — pull LilyPond sources from the Mutopia Project into a local cache.
 *
 * Source of truth is mutopiaproject.org's own Apache directory index, walked
 * two levels: `/ftp/<composer>/<opus>/` lists piece directories, each of which
 * holds the `.ly`.
 *
 * Two alternatives were tried and rejected, both empirically:
 *  - GitHub contents API: one request per piece directory, which exhausts the
 *    60/hour unauthenticated budget partway through a single set (and the
 *    recursive-tree endpoint 403s under the same limit).
 *  - Mutopia's own make-table.cgi: one request per composer, but INCOMPLETE —
 *    it returned 10 of Burgmüller's 18 Op.100 studies and none of Schumann's
 *    Op.68. Silent under-collection is worse than slow collection.
 *
 * The directory index has no rate limit and is complete. Downloads are cached
 * on disk, so re-runs and offline iteration cost nothing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SITE = 'https://www.mutopiaproject.org/ftp';
const UA = { 'User-Agent': 'DaylightStation-lilypond-import' };

async function getText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`fetch failed for ${url}: ${lastErr?.message || lastErr}`);
}

/** Sub-directory names from an Apache index page (excluding the parent link). */
export function parseDirIndex(html) {
  return [...String(html).matchAll(/href="([^"?/][^"]*)\/"/g)]
    .map((m) => m[1])
    .filter((name) => !name.startsWith('.') && name !== '..');
}

/** `.ly` filenames from an Apache index page. */
export function parseLyFiles(html) {
  return [...String(html).matchAll(/href="([^"]+\.ly)"/g)]
    .map((m) => m[1])
    .filter((name) => !name.includes('/'));
}

/**
 * Every .ly under ftp/<composer>/<opus>, one entry per piece directory.
 * @returns {Promise<Array<{sourcePath, sourceUrl, downloadUrl}>>}
 */
export async function listOpus(composer, opus, log = () => {}) {
  const base = `${SITE}/${composer}/${opus}`;
  let index;
  try {
    index = await getText(`${base}/`);
  } catch (err) {
    log(`  listing failed for ${composer}/${opus}: ${err.message}`);
    return [];
  }
  const pieces = parseDirIndex(index);
  const out = [];
  for (const piece of pieces) {
    let pageHtml;
    try {
      pageHtml = await getText(`${base}/${piece}/`);
    } catch (err) {
      log(`  listing failed for ${composer}/${opus}/${piece}: ${err.message}`);
      continue;
    }
    for (const file of parseLyFiles(pageHtml)) {
      const sourcePath = `${composer}/${opus}/${piece}/${file}`;
      out.push({ sourcePath, sourceUrl: `${SITE}/${sourcePath}`, downloadUrl: `${SITE}/${sourcePath}` });
    }
  }
  return out;
}

/** Cache filename for a source path — flattened so the cache dir stays flat. */
export const cacheName = (sourcePath) => sourcePath.replace(/\//g, '__');

/** Download into `cacheDir`, skipping anything already present. */
export async function cacheSources(entries, cacheDir, log = () => {}) {
  await fs.mkdir(cacheDir, { recursive: true });
  const out = [];
  for (const e of entries) {
    const file = path.join(cacheDir, cacheName(e.sourcePath));
    try {
      await fs.access(file);
    } catch {
      try {
        await fs.writeFile(file, await getText(e.downloadUrl), 'utf8');
        log(`  fetched ${e.sourcePath}`);
      } catch (err) {
        log(`  fetch-failed ${e.sourcePath}: ${err.message}`);
        continue;
      }
    }
    out.push({ ...e, file });
  }
  return out;
}

/**
 * Offline listing: reconstruct sources from a populated cache directory, so a
 * re-run never needs the network. Optionally filtered to one composer/opus.
 */
export async function listCached(cacheDir, filter = null) {
  let names = [];
  try { names = await fs.readdir(cacheDir); } catch { return []; }
  return names
    .filter((n) => n.endsWith('.ly'))
    .map((n) => {
      const sourcePath = n.replace(/__/g, '/');
      return { sourcePath, sourceUrl: `${SITE}/${sourcePath}`, downloadUrl: `${SITE}/${sourcePath}`, file: path.join(cacheDir, n) };
    })
    .filter((e) => !filter || e.sourcePath.startsWith(`${filter.composer}/${filter.opus}/`))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export default { listOpus, cacheSources, listCached, parseDirIndex, parseLyFiles, cacheName };
