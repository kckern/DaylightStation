// backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class KomgaTocToolFactory extends ToolFactory {
  static domain = 'komga-toc';

  createTools() {
    const { dataService, configService, aiGateway, logger } = this.deps;

    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    const apiKey = komgaAuth?.token;

    if (!komgaHost || !apiKey) {
      logger.warn?.('komga-toc.tools.not_configured');
      return [];
    }

    const authHeaders = { 'X-API-Key': apiKey, 'Accept': 'application/json' };

    // Shared: fetch image from Komga with retry for SSL/network errors
    const fetchImageWithRetry = async (url, timeoutMs = 15000) => {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url, {
            headers: { 'X-API-Key': apiKey, 'Accept': 'image/jpeg' },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) return { error: `HTTP ${res.status}` };
          const buffer = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers.get('content-type') || 'image/jpeg';
          return { imageDataUri: `data:${contentType};base64,${buffer.toString('base64')}`, sizeBytes: buffer.length };
        } catch (err) {
          if (attempt < maxRetries && /SSL|ECONNRESET|socket|ETIMEDOUT/i.test(err.message)) {
            const delay = attempt * 2000;
            logger.warn?.('komga-toc.fetch.retry', { url, attempt, delay, error: err.message });
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return { error: err.message };
        }
      }
      return { error: 'Max retries exceeded' };
    };

    // ---------------------------------------------------------------
    // Tool 1: scan_toc_cache
    // ---------------------------------------------------------------
    const scanTocCache = createTool({
      name: 'scan_toc_cache',
      description: 'Scan the TOC cache and return a list of books that need TOC extraction. Returns books with empty articles arrays that have not been previously scanned (no tocScanned flag). Also fetches the full book list from Komga for all configured series to find books not yet cached.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        const komgaConfig = dataService.household.read('config/lists/queries/komga');
        if (!komgaConfig?.params?.series) {
          return { error: 'No komga series configured', booksToProcess: [], count: 0 };
        }

        const seriesList = komgaConfig.params.series;
        const recentCount = komgaConfig.params.recent_issues || 6;
        const booksToProcess = [];

        for (const series of seriesList) {
          const booksUrl = `${komgaHost}/api/v1/series/${series.id}/books?sort=metadata.numberSort,desc&size=${recentCount}`;
          const booksRes = await fetch(booksUrl, { headers: authHeaders });
          if (!booksRes.ok) continue;

          const booksData = await booksRes.json();
          const books = booksData?.content || [];

          for (const book of books) {
            const bookId = book.id;
            const cachePath = `common/komga/toc/${bookId}.yml`;
            const cached = dataService.household.read(cachePath);

            if (cached?.tocScanned) continue;
            if (cached?.articles?.length > 0) continue;

            booksToProcess.push({
              bookId,
              seriesId: series.id,
              seriesLabel: series.label,
              issueTitle: book.metadata?.title || book.name || 'Unknown',
              pageCount: book.media?.pagesCount || 0,
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
    // Merged fetch_page_thumbnail + check_page_is_toc into one tool.
    // Image data stays in-process — never passes through the LLM context.
    // ---------------------------------------------------------------
    const scanPageForToc = createTool({
      name: 'scan_page_for_toc',
      description: 'Fetch a thumbnail of a specific page from a Komga book and use AI vision to check if it is a table of contents page. Returns { isToc: true/false }. This is the cheap detection step — use before committing to full-res extraction.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page }) => {
        // Fetch thumbnail
        const thumbUrl = `${komgaHost}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
        const fetchResult = await fetchImageWithRetry(thumbUrl, 15000);
        if (fetchResult.error) {
          return { error: `Failed to fetch thumbnail: ${fetchResult.error}`, bookId, page };
        }

        // Check with AI vision
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
        logger.info?.('komga-toc.scan_page', { bookId, page, isToc, answer });
        return { bookId, page, isToc, rawAnswer: answer };
      },
    });

    // ---------------------------------------------------------------
    // Tool 3: extract_toc_from_page
    // Fetches full-res image internally and sends to AI vision.
    // ---------------------------------------------------------------
    const extractTocFromPage = createTool({
      name: 'extract_toc_from_page',
      description: 'Fetch a full-resolution page image from Komga and send it to AI vision to extract structured table-of-contents data. Returns an array of {title, page} objects. This is the expensive step — only call after confirming the page is a TOC via scan_page_for_toc.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number of the TOC page' },
          pageCount: { type: 'integer', description: 'Total pages in the book (for validation)' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page, pageCount }) => {
        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        const url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}`;
        const fetchResult = await fetchImageWithRetry(url, 30000);
        if (fetchResult.error) {
          return { error: `Failed to fetch page: ${fetchResult.error}`, bookId, page };
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

        // Parse JSON from response
        let articles = [];
        try {
          const jsonMatch = response.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            articles = JSON.parse(jsonMatch[0]);
          }
        } catch (err) {
          logger.warn?.('komga-toc.extract.parse_error', { bookId, page, error: err.message, response });
          return { error: 'Failed to parse AI response as JSON', bookId, page, rawResponse: response };
        }

        // Validate structure and filter invalid page numbers
        articles = articles
          .filter(a => a && typeof a.title === 'string' && typeof a.page === 'number')
          .map(a => ({ title: a.title.trim(), page: Math.round(a.page) }))
          .filter(a => a.page >= 1 && (!pageCount || a.page <= pageCount));

        logger.info?.('komga-toc.extract.success', { bookId, page, articleCount: articles.length });
        return { bookId, tocPage: page, articles };
      },
    });

    // ---------------------------------------------------------------
    // Tool 4: write_toc_cache
    // ---------------------------------------------------------------
    const writeTocCache = createTool({
      name: 'write_toc_cache',
      description: 'Write extracted TOC data to the YAML cache for a Komga book. Sets tocScanned: true so the book is not re-processed. If no articles were found, writes an empty array with tocScanned: true.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          seriesLabel: { type: 'string', description: 'Series name' },
          issueTitle: { type: 'string', description: 'Issue title' },
          pageCount: { type: 'integer', description: 'Total pages in book' },
          tocPage: { type: 'integer', description: 'Page number where TOC was found (null if not found)' },
          articles: {
            type: 'array',
            description: 'Array of {title, page} objects extracted from the TOC',
          },
        },
        required: ['bookId', 'seriesLabel', 'issueTitle', 'pageCount', 'articles'],
      },
      execute: async ({ bookId, seriesLabel, issueTitle, pageCount, tocPage, articles }) => {
        const cachePath = `common/komga/toc/${bookId}.yml`;
        const tocData = {
          bookId,
          series: seriesLabel,
          issue: issueTitle,
          pages: pageCount,
          tocScanned: true,
          tocPage: tocPage || null,
          articles: articles || [],
        };
        dataService.household.write(cachePath, tocData);
        logger.info?.('komga-toc.cache.written', { bookId, articleCount: (articles || []).length });
        return { success: true, bookId, articleCount: (articles || []).length, cachePath };
      },
    });

    return [scanTocCache, scanPageForToc, extractTocFromPage, writeTocCache];
  }
}
