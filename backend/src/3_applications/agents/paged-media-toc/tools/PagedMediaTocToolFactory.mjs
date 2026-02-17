// backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class PagedMediaTocToolFactory extends ToolFactory {
  static domain = 'paged-media-toc';

  createTools() {
    const { pagedMediaGateway, tocCacheDatastore, aiGateway, logger } = this.deps;

    if (!pagedMediaGateway) {
      logger.warn?.('paged-media-toc.tools.no_gateway');
      return [];
    }

    // ---------------------------------------------------------------
    // Tool 1: scan_toc_cache
    // ---------------------------------------------------------------
    const scanTocCache = createTool({
      name: 'scan_toc_cache',
      description: 'Scan the TOC cache and return a list of books that need TOC extraction. Returns books with empty articles arrays that have not been previously scanned (no tocScanned flag). Also fetches the full book list from the media server for all configured series to find books not yet cached.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        const config = tocCacheDatastore.readQueryConfig();
        if (!config?.params?.series) {
          return { error: 'No series configured', booksToProcess: [], count: 0 };
        }

        const seriesList = config.params.series;
        const recentCount = config.params.recent_issues || 6;
        const booksToProcess = [];

        for (const series of seriesList) {
          let books;
          try {
            books = await pagedMediaGateway.getRecentBooks(series.id, recentCount);
          } catch (err) {
            logger.warn?.('paged-media-toc.scan.series_error', { seriesId: series.id, error: err.message });
            continue;
          }

          for (const book of books) {
            const cached = tocCacheDatastore.readCache(book.id);
            if (cached?.tocScanned) continue;
            if (cached?.articles?.length > 0) continue;

            booksToProcess.push({
              bookId: book.id,
              seriesId: series.id,
              seriesLabel: series.label,
              issueTitle: book.title,
              pageCount: book.pageCount,
            });
          }
        }

        return {
          totalConfiguredSeries: seriesList.length,
          booksToProcess,
          count: booksToProcess.length,
        };
      },
    });

    // ---------------------------------------------------------------
    // Tool 2: scan_page_for_toc
    // ---------------------------------------------------------------
    const scanPageForToc = createTool({
      name: 'scan_page_for_toc',
      description: 'Fetch a thumbnail of a specific page from a book and use AI vision to check if it is a table of contents page. Returns { isToc: true/false }. This is the cheap detection step — use before committing to full-res extraction.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book ID' },
          page: { type: 'integer', description: '1-indexed page number' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page }) => {
        let fetchResult;
        try {
          fetchResult = await pagedMediaGateway.getPageThumbnail(bookId, page);
        } catch (err) {
          return { error: `Failed to fetch thumbnail: ${err.message}`, bookId, page };
        }

        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        const messages = [
          { role: 'user', content: 'Is this page a table of contents or index page from a magazine? A table of contents typically lists article titles with corresponding page numbers. Answer with ONLY "yes" or "no".' },
        ];
        const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
          model: 'gpt-4o-mini',
          maxTokens: 10,
        });
        const answer = (response || '').trim().toLowerCase();
        const isToc = answer.startsWith('yes');
        logger.info?.('paged-media-toc.scan_page', { bookId, page, isToc, answer });
        return { bookId, page, isToc, rawAnswer: answer };
      },
    });

    // ---------------------------------------------------------------
    // Tool 3: extract_toc_from_page
    // ---------------------------------------------------------------
    const extractTocFromPage = createTool({
      name: 'extract_toc_from_page',
      description: 'Fetch a full-resolution page image and send it to AI vision to extract structured table-of-contents data. Returns an array of {title, page} objects. This is the expensive step — only call after confirming the page is a TOC via scan_page_for_toc.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book ID' },
          page: { type: 'integer', description: '1-indexed page number of the TOC page' },
          pageCount: { type: 'integer', description: 'Total pages in the book (for validation)' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page, pageCount }) => {
        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        let fetchResult;
        try {
          fetchResult = await pagedMediaGateway.getPageImage(bookId, page);
        } catch (err) {
          return { error: `Failed to fetch page: ${err.message}`, bookId, page };
        }

        const messages = [
          { role: 'user', content: `This is a table of contents page from a magazine. Extract every article or feature title and its page number. Return ONLY a JSON array of objects with "title" and "page" fields. Example: [{"title": "The Future of AI", "page": 22}, {"title": "Climate Report", "page": 38}]. Rules:
- Include only actual articles/features, not section headers like "FEATURES" or "DEPARTMENTS" unless they have page numbers
- Use the exact title text as printed
- Page numbers must be integers
- Skip ads, editor letters, and minor items like "Letters to the Editor"
- If a title spans multiple lines, combine into one string` },
        ];
        const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
          model: 'gpt-4o',
          maxTokens: 2000,
          imageDetail: 'high',
        });

        let articles = [];
        try {
          const jsonMatch = response.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            articles = JSON.parse(jsonMatch[0]);
          }
        } catch (err) {
          logger.warn?.('paged-media-toc.extract.parse_error', { bookId, page, error: err.message, response });
          return { error: 'Failed to parse AI response as JSON', bookId, page, rawResponse: response };
        }

        articles = articles
          .filter(a => a && typeof a.title === 'string' && typeof a.page === 'number')
          .map(a => ({ title: a.title.trim(), page: Math.round(a.page) }))
          .filter(a => a.page >= 1 && (!pageCount || a.page <= pageCount));

        logger.info?.('paged-media-toc.extract.success', { bookId, page, articleCount: articles.length });
        return { bookId, tocPage: page, articles };
      },
    });

    // ---------------------------------------------------------------
    // Tool 4: detect_page_offset
    // ---------------------------------------------------------------
    const detectPageOffset = createTool({
      name: 'detect_page_offset',
      description: 'Detect the offset between printed page numbers and vendor page indices. Scans full-resolution pages starting from a given page, asking AI to read the printed page number. Reads up to 10 pages and requires 2+ to agree on the same offset (consensus). Returns the offset (vendor_page - printed_page).',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book ID' },
          startPage: { type: 'integer', description: '1-indexed page to start scanning from (typically tocPage + 1)' },
        },
        required: ['bookId', 'startPage'],
      },
      execute: async ({ bookId, startPage }) => {
        const maxAttempts = 10;
        const readings = [];

        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        for (let i = 0; i < maxAttempts; i++) {
          const vendorPage = startPage + i;
          let fetchResult;
          try {
            fetchResult = await pagedMediaGateway.getPageImage(bookId, vendorPage);
          } catch (err) {
            logger.warn?.('paged-media-toc.offset.fetch_error', { bookId, vendorPage, error: err.message });
            continue;
          }

          const messages = [
            { role: 'user', content: 'What page number is printed on this page? Look for a number at the top or bottom of the page that indicates the page number. Reply with ONLY the number (e.g. "42"), or "none" if no page number is visible.' },
          ];
          const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
            model: 'gpt-4o-mini',
            maxTokens: 10,
          });

          const answer = (response || '').trim().toLowerCase();
          const parsed = parseInt(answer, 10);

          if (!isNaN(parsed) && parsed > 0) {
            const offset = vendorPage - parsed;
            readings.push({ vendorPage, printedPage: parsed, offset });
            logger.info?.('paged-media-toc.offset.reading', { bookId, vendorPage, printedPage: parsed, offset });
          } else {
            logger.info?.('paged-media-toc.offset.no_number', { bookId, vendorPage, answer });
          }
        }

        if (readings.length < 2) {
          logger.info?.('paged-media-toc.offset.insufficient_readings', { bookId, startPage, readings: readings.length });
          return { bookId, tocPageOffset: 0, reason: 'insufficient_readings', readings };
        }

        // Find consensus offset (mode)
        const counts = {};
        for (const r of readings) {
          counts[r.offset] = (counts[r.offset] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const [bestOffset, bestCount] = sorted[0];

        if (bestCount < 2) {
          logger.info?.('paged-media-toc.offset.no_consensus', { bookId, counts, readings });
          return { bookId, tocPageOffset: 0, reason: 'no_consensus', readings };
        }

        const tocPageOffset = parseInt(bestOffset, 10);
        logger.info?.('paged-media-toc.offset.consensus', { bookId, tocPageOffset, agreement: `${bestCount}/${readings.length}`, readings });
        return { bookId, tocPageOffset, agreement: `${bestCount}/${readings.length}`, readings };
      },
    });

    // ---------------------------------------------------------------
    // Tool 5: write_toc_cache
    // ---------------------------------------------------------------
    const writeTocCache = createTool({
      name: 'write_toc_cache',
      description: 'Write extracted TOC data to the YAML cache for a book. Sets tocScanned: true so the book is not re-processed. If no articles were found, writes an empty array with tocScanned: true.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book ID' },
          seriesLabel: { type: 'string', description: 'Series name' },
          issueTitle: { type: 'string', description: 'Issue title' },
          pageCount: { type: 'integer', description: 'Total pages in book' },
          tocPage: { type: 'integer', description: 'Page number where TOC was found (null if not found)' },
          tocPageOffset: { type: 'integer', description: 'Offset between vendor page indices and printed page numbers (vendor_page = printed_page + offset). 0 if not detected.' },
          articles: {
            type: 'array',
            description: 'Array of {title, page} objects extracted from the TOC',
          },
        },
        required: ['bookId', 'seriesLabel', 'issueTitle', 'pageCount', 'articles'],
      },
      execute: async ({ bookId, seriesLabel, issueTitle, pageCount, tocPage, tocPageOffset, articles }) => {
        const tocData = {
          bookId,
          series: seriesLabel,
          issue: issueTitle,
          pages: pageCount,
          tocScanned: true,
          tocPage: tocPage || null,
          tocPageOffset: tocPageOffset || 0,
          articles: articles || [],
        };
        tocCacheDatastore.writeCache(bookId, tocData);
        logger.info?.('paged-media-toc.cache.written', { bookId, articleCount: (articles || []).length });
        return { success: true, bookId, articleCount: (articles || []).length };
      },
    });

    return [scanTocCache, scanPageForToc, extractTocFromPage, detectPageOffset, writeTocCache];
  }
}
