#!/usr/bin/env node
/**
 * Paged Media TOC Backfill CLI
 *
 * Directly executes the paged-media TOC extraction pipeline without the Mastra
 * agent framework. Calls the same logic as PagedMediaTocToolFactory tools but
 * sequentially in-process, avoiding the LLM orchestration overhead.
 *
 * Usage:
 *   node cli/paged-media-toc-backfill.cli.mjs              # Process all books missing TOC
 *   node cli/paged-media-toc-backfill.cli.mjs --dry-run     # Show what would be processed
 *   node cli/paged-media-toc-backfill.cli.mjs --book ID     # Process a specific book
 *
 * @module cli/paged-media-toc-backfill
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path, { join } from 'path';

import { initConfigService, configService } from '#system/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '#system/logging/config.mjs';
import { DataService } from '#system/config/DataService.mjs';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// Bootstrap (mirrors backend/index.js)
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

// Minimal HTTP client stub for OpenAIAdapter
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
const authHeaders = { 'X-API-Key': apiKey, 'Accept': 'application/json' };

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
const rescan = args.includes('--rescan');  // Ignore tocScanned flag, reprocess all

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

async function getBooksToProcess() {
  const komgaConfig = dataService.household.read('config/lists/queries/komga');
  if (!komgaConfig?.params?.series) {
    console.error('No komga series configured');
    return [];
  }

  const seriesList = komgaConfig.params.series;
  const recentCount = komgaConfig.params.recent_issues || 6;
  const books = [];

  for (const series of seriesList) {
    const url = `${komgaHost}/api/v1/series/${series.id}/books?sort=metadata.numberSort,desc&size=${recentCount}`;
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) {
      console.warn(`  WARN: Failed to fetch books for ${series.label}: ${res.status}`);
      continue;
    }

    const data = await res.json();
    for (const book of (data.content || [])) {
      const bookId = book.id;

      if (specificBook && bookId !== specificBook) continue;

      const cachePath = `common/komga/toc/${bookId}.yml`;
      const cached = dataService.household.read(cachePath);

      if (!rescan && cached?.tocScanned) continue;
      if (!rescan && cached?.articles?.length > 0) continue;

      books.push({
        bookId,
        seriesId: series.id,
        seriesLabel: series.label,
        issueTitle: book.metadata?.title || book.name || 'Unknown',
        pageCount: book.media?.pagesCount || 0,
      });
    }
  }

  return books;
}

/**
 * Fetch a page image from Komga as a base64 data URI.
 * @param {string} bookId
 * @param {number} page - 1-indexed
 * @param {Object} [opts]
 * @param {boolean} [opts.thumbnail=false] - Use thumbnail endpoint (tiny, cheap)
 * @param {number}  [opts.width] - Request resized image via ?width=N (e.g. 1500)
 */
async function fetchPageAsDataUri(bookId, page, opts = {}) {
  const { thumbnail = false, width } = typeof opts === 'boolean'
    ? { thumbnail: opts }   // backward compat: fetchPageAsDataUri(id, p, true)
    : opts;

  let url;
  if (thumbnail) {
    url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
  } else {
    const qs = width ? `?width=${width}` : '';
    url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}${qs}`;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'image/jpeg' },
        signal: AbortSignal.timeout(thumbnail ? 15000 : 30000),
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (err) {
      if (attempt < maxRetries && /SSL|ECONNRESET|socket|ETIMEDOUT/i.test(err.message)) {
        const delay = attempt * 2000;
        console.warn(`  WARN: Fetch attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn(`  WARN: Fetch failed after ${attempt} attempt(s): ${err.message}`);
      return null;
    }
  }
  return null;
}

async function checkPageIsToc(imageDataUri) {
  const messages = [
    { role: 'user', content: 'Is this page a table of contents or index page from a magazine? A table of contents typically lists article titles with corresponding page numbers. Answer with ONLY "yes" or "no".' },
  ];
  try {
    const response = await aiGateway.chatWithImage(messages, imageDataUri, {
      model: 'gpt-4o-mini',
      maxTokens: 10,
      imageDetail: 'auto',
    });
    return (response || '').trim().toLowerCase().startsWith('yes');
  } catch (err) {
    console.warn(`  WARN: AI check failed: ${err.message}`);
    return false;
  }
}

async function extractTocFromPage(bookId, page) {
  // Full page rendered as JPEG via Accept header (~1MB, within OpenAI limits, good OCR quality)
  const imageDataUri = await fetchPageAsDataUri(bookId, page);
  if (!imageDataUri) return [];

  const messages = [
    { role: 'user', content: `This is a table of contents page from a magazine. Extract every article or feature title and its page number. Return ONLY a JSON array of objects with "title" and "page" fields. Example: [{"title": "The Future of AI", "page": 22}, {"title": "Climate Report", "page": 38}]. Rules:
- Include only actual articles/features, not section headers like "FEATURES" or "DEPARTMENTS" unless they have page numbers
- Use the exact title text as printed
- Page numbers must be integers
- Skip ads, editor letters, and minor items like "Letters to the Editor"
- If a title spans multiple lines, combine into one string` },
  ];
  const response = await aiGateway.chatWithImage(messages, imageDataUri, {
    model: 'gpt-4o',
    maxTokens: 2000,
  });

  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return parsed
      .filter(a => a && typeof a.title === 'string' && typeof a.page === 'number')
      .map(a => ({ title: a.title.trim(), page: Math.round(a.page) }));
  } catch {
    console.warn(`  WARN: Failed to parse AI response for ${bookId} page ${page}`);
    return [];
  }
}

/**
 * Calculate what percentage of the book's content pages are "covered" by TOC articles.
 * Uses a simple heuristic: articles should reference pages spread across the book.
 * Returns a ratio 0-1 where 1 means articles span the full page range.
 */
function calcTocCoverage(articles, pageCount) {
  if (!articles.length || pageCount <= 0) return 0;
  const pages = articles.map(a => a.page).sort((a, b) => a - b);
  const minPage = pages[0];
  const maxPage = pages[pages.length - 1];
  // Content typically starts ~10% in and ends ~90% through
  const contentStart = Math.max(1, Math.floor(pageCount * 0.1));
  const contentEnd = Math.floor(pageCount * 0.9);
  const contentRange = contentEnd - contentStart;
  if (contentRange <= 0) return 1;
  const coverage = (maxPage - minPage) / contentRange;
  return Math.min(1, coverage);
}

function writeTocCache(bookId, seriesLabel, issueTitle, pageCount, tocPages, articles) {
  const cachePath = `common/komga/toc/${bookId}.yml`;
  const tocData = {
    bookId,
    series: seriesLabel,
    issue: issueTitle,
    pages: pageCount,
    tocScanned: true,
    tocPages: tocPages || [],
    articles: articles || [],
  };
  dataService.household.write(cachePath, tocData);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Paged Media TOC Backfill');
  console.log(`  Host: ${komgaHost}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}${rescan ? ' (rescan)' : ''}`);
  if (specificBook) console.log(`  Book: ${specificBook}`);
  console.log();

  const books = await getBooksToProcess();
  console.log(`Found ${books.length} book(s) to process\n`);

  if (books.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const book of books) {
      console.log(`  ${book.bookId} — ${book.seriesLabel} — ${book.issueTitle} (${book.pageCount} pages)`);
    }
    return;
  }

  let processed = 0;
  let withToc = 0;
  let withoutToc = 0;

  for (const book of books) {
    console.log(`[${processed + 1}/${books.length}] ${book.seriesLabel} — ${book.issueTitle} (${book.pageCount}pp)`);

    try {
      // Step 1: Find TOC pages by scanning thumbnails (don't stop at first — TOC may span pages)
      const tocPages = [];
      const maxScan = Math.min(12, book.pageCount);
      let lastTocPage = -1;

      for (let p = 1; p <= maxScan; p++) {
        process.stdout.write(`  Checking page ${p}/${maxScan}...`);
        const thumb = await fetchPageAsDataUri(book.bookId, p, true);
        if (!thumb) {
          console.log(' (skip)');
          continue;
        }

        const isToc = await checkPageIsToc(thumb);
        console.log(isToc ? ' TOC' : ' -');

        if (isToc) {
          tocPages.push(p);
          lastTocPage = p;
        } else if (lastTocPage > 0 && p > lastTocPage + 2) {
          // Passed the TOC region (allow 2-page gap for ads/editorial between TOC pages)
          break;
        }
      }

      // Step 2: Extract articles from all TOC pages
      let allArticles = [];
      for (const tp of tocPages) {
        process.stdout.write(`  Extracting from page ${tp}...`);
        try {
          const articles = await extractTocFromPage(book.bookId, tp);
          console.log(` ${articles.length} articles`);
          allArticles.push(...articles);
        } catch (err) {
          console.log(` ERROR: ${err.message}`);
        }
      }

      // Deduplicate by title
      const seen = new Set();
      allArticles = allArticles.filter(a => {
        const key = a.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Step 3: Coverage check — if coverage is low, scan the next page too
      if (allArticles.length > 0 && tocPages.length > 0) {
        const coverage = calcTocCoverage(allArticles, book.pageCount);
        console.log(`  Coverage: ${Math.round(coverage * 100)}% (${allArticles.length} articles span pages ${allArticles[0]?.page}-${allArticles[allArticles.length - 1]?.page} of ${book.pageCount})`);

        if (coverage < 0.5) {
          const nextPage = tocPages[tocPages.length - 1] + 1;
          if (nextPage <= maxScan) {
            process.stdout.write(`  Low coverage — checking page ${nextPage}...`);
            try {
              const thumb = await fetchPageAsDataUri(book.bookId, nextPage, true);
              if (thumb) {
                const isToc = await checkPageIsToc(thumb);
                if (isToc) {
                  console.log(' TOC (continuation)');
                  tocPages.push(nextPage);
                  const moreArticles = await extractTocFromPage(book.bookId, nextPage);
                  for (const a of moreArticles) {
                    const key = a.title.toLowerCase();
                    if (!seen.has(key)) {
                      seen.add(key);
                      allArticles.push(a);
                    }
                  }
                  const newCoverage = calcTocCoverage(allArticles, book.pageCount);
                  console.log(`  Updated coverage: ${Math.round(newCoverage * 100)}% (${allArticles.length} articles)`);
                } else {
                  console.log(' not TOC');
                }
              }
            } catch (err) {
              console.log(` ERROR: ${err.message}`);
            }
          }
        }
      }

      // Filter out articles with invalid page numbers
      const beforeFilter = allArticles.length;
      allArticles = allArticles.filter(a => a.page >= 1 && a.page <= book.pageCount);
      if (allArticles.length < beforeFilter) {
        console.log(`  Filtered ${beforeFilter - allArticles.length} article(s) with page numbers outside 1-${book.pageCount}`);
      }

      // Print final article list
      for (const a of allArticles) {
        console.log(`    p.${a.page}: ${a.title}`);
      }

      // Step 4: Write cache
      writeTocCache(book.bookId, book.seriesLabel, book.issueTitle, book.pageCount, tocPages, allArticles);
      console.log(`  Saved (${allArticles.length} articles, ${tocPages.length} TOC pages)\n`);

      processed++;
      if (allArticles.length > 0) withToc++;
      else withoutToc++;
    } catch (err) {
      console.error(`  ERROR processing ${book.bookId}: ${err.message}\n`);
      processed++;
      withoutToc++;
    }
  }

  console.log('Done!');
  console.log(`  Processed: ${processed}`);
  console.log(`  With TOC: ${withToc}`);
  console.log(`  Without TOC: ${withoutToc}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
