#!/usr/bin/env node
/**
 * Backfill tocPageOffset for existing TOC cache files.
 *
 * Reads each cached TOC YAML, finds the last TOC page, then scans
 * subsequent pages to detect the printed page number and compute the
 * offset (vendorPage - printedPage). Writes the offset back to cache.
 *
 * This is a one-time migration script — once all files have tocPageOffset,
 * the agent handles it for new books.
 *
 * Usage:
 *   node cli/backfill-toc-offset.cli.mjs              # Process all missing offsets
 *   node cli/backfill-toc-offset.cli.mjs --dry-run     # Show what would be processed
 *   node cli/backfill-toc-offset.cli.mjs --book ID     # Process a specific book
 *
 * @module cli/backfill-toc-offset
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path, { join } from 'path';
import { readdirSync } from 'fs';

import { initConfigService, configService } from '#system/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '#system/logging/config.mjs';
import { DataService } from '#system/config/DataService.mjs';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const baseDir = process.env.DAYLIGHT_BASE_PATH;
if (!baseDir) {
  console.error('ERROR: DAYLIGHT_BASE_PATH not set in .env');
  process.exit(1);
}

const dataDir = join(baseDir, 'data');
const configDir = join(dataDir, 'system', 'config');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const dataService = new DataService({ configService });

const openaiApiKey = configService.getSecret('OPENAI_API_KEY');
if (!openaiApiKey) {
  console.error('ERROR: OPENAI_API_KEY not configured');
  process.exit(1);
}

const axios = (await import('axios')).default;
const aiGateway = new OpenAIAdapter(
  { apiKey: openaiApiKey },
  { httpClient: axios, logger: console }
);

const komgaAuth = configService.getHouseholdAuth('komga');
const komgaHost = configService.resolveServiceUrl('komga');

if (!komgaHost || !komgaAuth?.token) {
  console.error('ERROR: Komga not configured (missing host or token)');
  process.exit(1);
}

const apiKey = komgaAuth.token;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchThumbnail(bookId, page) {
  const url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'image/jpeg' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (err) {
      if (attempt < maxRetries && /SSL|ECONNRESET|socket|ETIMEDOUT/i.test(err.message)) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function detectOffset(bookId, startPage, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const vendorPage = startPage + i;
    process.stdout.write(`    page ${vendorPage}...`);

    const imageDataUri = await fetchThumbnail(bookId, vendorPage);
    if (!imageDataUri) {
      console.log(' (skip)');
      continue;
    }

    const messages = [
      { role: 'user', content: 'What page number is printed on this page? Look for a number at the top or bottom of the page that indicates the page number. Reply with ONLY the number (e.g. "42"), or "none" if no page number is visible.' },
    ];

    try {
      const response = await aiGateway.chatWithImage(messages, imageDataUri, {
        model: 'gpt-4o-mini',
        maxTokens: 10,
      });
      const answer = (response || '').trim().toLowerCase();
      const parsed = parseInt(answer, 10);

      if (!isNaN(parsed) && parsed > 0) {
        const offset = vendorPage - parsed;
        console.log(` printed="${parsed}" → offset=${offset}`);
        return offset;
      }
      console.log(` "${answer}"`);
    } catch (err) {
      console.log(` error: ${err.message}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Backfill tocPageOffset');
  console.log(`  Host: ${komgaHost}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const tocDir = join(dataDir, 'household', 'common', 'komga', 'toc');
  const files = readdirSync(tocDir).filter(f => f.endsWith('.yml'));

  const toProcess = [];
  for (const file of files) {
    const bookId = file.replace('.yml', '');
    if (specificBook && bookId !== specificBook) continue;

    const cachePath = `common/komga/toc/${bookId}.yml`;
    const cached = dataService.household.read(cachePath);
    if (!cached) continue;

    // Skip if already has offset
    if (cached.tocPageOffset !== undefined && cached.tocPageOffset !== null) continue;

    // Need a TOC page to know where to start scanning
    const tocPages = cached.tocPages || (cached.tocPage ? [cached.tocPage] : []);
    const lastTocPage = tocPages.length > 0 ? Math.max(...tocPages) : 0;

    toProcess.push({
      bookId,
      series: cached.series,
      issue: cached.issue,
      pages: cached.pages,
      lastTocPage,
      hasArticles: (cached.articles?.length || 0) > 0,
    });
  }

  console.log(`Found ${toProcess.length} file(s) needing offset detection\n`);

  if (toProcess.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const book of toProcess) {
      console.log(`  ${book.bookId} — ${book.series} — ${book.issue} (lastToc=${book.lastTocPage}, articles=${book.hasArticles})`);
    }
    return;
  }

  let processed = 0;
  let detected = 0;

  for (const book of toProcess) {
    console.log(`[${processed + 1}/${toProcess.length}] ${book.series} — ${book.issue}`);

    const startPage = book.lastTocPage > 0 ? book.lastTocPage + 1 : 1;
    console.log(`  Scanning from page ${startPage}...`);

    const offset = await detectOffset(book.bookId, startPage);

    const cachePath = `common/komga/toc/${book.bookId}.yml`;
    const cached = dataService.household.read(cachePath);

    // Validate: check if applying the offset causes articles to map outside 1..pageCount
    let finalOffset = offset !== null ? offset : 0;
    if (finalOffset !== 0 && cached.articles?.length > 0) {
      const invalid = cached.articles.filter(a => {
        const vp = a.page + finalOffset;
        return vp < 1 || vp > (cached.pages || 0);
      });
      if (invalid.length > cached.articles.length * 0.25) {
        console.log(`  ⚠ offset=${finalOffset} makes ${invalid.length}/${cached.articles.length} articles out of range — resetting to 0`);
        finalOffset = 0;
      }
    }

    cached.tocPageOffset = finalOffset;
    dataService.household.write(cachePath, cached);

    if (offset !== null) {
      console.log(`  ✓ Saved offset=${finalOffset}\n`);
      detected++;
    } else {
      console.log(`  ✗ Could not detect offset, saved 0\n`);
    }

    processed++;
  }

  console.log('Done!');
  console.log(`  Processed: ${processed}`);
  console.log(`  Detected: ${detected}`);
  console.log(`  Not detected: ${processed - detected}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
