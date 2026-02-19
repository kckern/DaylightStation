// tests/isolated/adapter/feed/ABSEbookFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import os from 'os';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ABSEbookFeedAdapter } from '#adapters/feed/sources/ABSEbookFeedAdapter.mjs';

// Mock absClient
const mockAbsClient = {
  getLibraryItems: jest.fn(),
  getItem: jest.fn(),
  host: 'https://abs.example.com',
};

// Mock global fetch for EPUB downloads
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Temp dir for cache (replaces mockDataService)
let tmpDir;

function createAdapter(overrides = {}) {
  return new ABSEbookFeedAdapter({
    absClient: mockAbsClient,
    token: 'test-token',
    mediaDir: tmpDir,
    logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
    ...overrides,
  });
}

function readCacheFile(bookId) {
  const filePath = path.join(tmpDir, 'archives', 'abs', 'chapters', `${bookId}.yml`);
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf-8'));
}

function writeCacheFile(bookId, data) {
  const dir = path.join(tmpDir, 'archives', 'abs', 'chapters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${bookId}.yml`), yaml.dump(data), 'utf-8');
}

// Helper: build a minimal EPUB with NCX TOC and XHTML content files via adm-zip
async function buildMockEpub(chapters, { withContent = true } = {}) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();

  const navPoints = chapters.map((title, i) =>
    `<navPoint id="ch${i}" playOrder="${i + 1}"><navLabel><text>${title}</text></navLabel><content src="ch${i}.xhtml"/></navPoint>`
  ).join('\n');

  const ncx = `<?xml version="1.0"?><ncx><navMap>${navPoints}</navMap></ncx>`;
  zip.addFile('OEBPS/toc.ncx', Buffer.from(ncx, 'utf-8'));
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));

  if (withContent) {
    chapters.forEach((title, i) => {
      zip.addFile(`OEBPS/ch${i}.xhtml`, Buffer.from(
        `<html><body><p>Content of ${title}. This is the second sentence. And here is the third sentence. Plus a fourth one for good measure.</p></body></html>`
      ));
    });
  }

  return zip.toBuffer();
}

// Helper: mock fetch to return an EPUB buffer, then a failed cover response
function mockFetchEpub(epubBuffer) {
  // First call: EPUB download
  mockFetch.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => epubBuffer.buffer.slice(
      epubBuffer.byteOffset, epubBuffer.byteOffset + epubBuffer.byteLength
    ),
  });
  // Second call: cover image fetch (fail → fallback to 2:3)
  mockFetch.mockResolvedValueOnce({ ok: false });
}

describe('ABSEbookFeedAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sourceType is abs-ebooks', () => {
    const adapter = createAdapter();
    expect(adapter.sourceType).toBe('abs-ebooks');
  });

  test('returns feed card with chapter title and preview when EPUB has TOC', async () => {
    const epubBuffer = await buildMockEpub([
      'Introduction',
      'The Surprising Power of Atomic Habits',
      'How Your Habits Shape Your Identity',
    ]);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-123',
        media: {
          metadata: {
            title: 'Atomic Habits',
            authorName: 'James Clear',
            genres: ['Self-Improvement'],
          },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        library: 'lib-abc',
        genres: ['Self-Improvement'],
      },
    }, 'testuser');

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('abs-ebooks');
    expect(items[0].tier).toBe('library');
    expect(items[0].id).toMatch(/^abs-ebooks:book-123:/);
    expect(items[0].title).toBeTruthy();
    // body should be chapter preview (not author — title)
    expect(items[0].body).toContain('Content of');
    expect(items[0].image).toContain('/api/v1/proxy/abs/items/book-123/cover');
    expect(items[0].link).toBe('https://abs.example.com/item/book-123');
    expect(items[0].meta.sourceName).toBe('Audiobookshelf');
    expect(items[0].meta.author).toBe('James Clear');
    expect(items[0].meta.bookTitle).toBe('Atomic Habits');
    expect(items[0].meta.imageWidth).toBeDefined();
    expect(items[0].meta.imageHeight).toBeDefined();
  });

  test('skips books without meaningful TOC', async () => {
    // EPUB with only front matter (all filtered out)
    const epubBuffer = await buildMockEpub(['Cover', 'Title Page']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-no-toc',
        media: {
          metadata: { title: 'Flat Book', authorName: 'Nobody' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    expect(items).toHaveLength(0);
  });

  test('returns empty array when no books match query', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [],
      total: 0,
    });

    const adapter = createAdapter();

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    expect(items).toHaveLength(0);
  });

  test('uses cached chapter data when available', async () => {
    // Pre-populate cache file
    writeCacheFile('book-cached', {
      bookId: 'book-cached',
      title: 'Cached Book',
      author: 'Author',
      coverWidth: 600,
      coverHeight: 900,
      chapters: [
        { id: 0, title: 'Chapter 1: Basics', preview: 'Some preview text.' },
        { id: 1, title: 'Chapter 2: Advanced', preview: 'Another preview.' },
      ],
    });

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-cached',
        media: {
          metadata: { title: 'Cached Book', authorName: 'Author' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    const adapter = createAdapter();

    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    expect(items).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('builds correct genre filter for ABS API', async () => {
    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [],
      total: 0,
    });

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    expect(mockAbsClient.getLibraryItems).toHaveBeenCalledWith(
      'lib-abc',
      expect.objectContaining({
        filter: 'genres.U2VsZi1JbXByb3ZlbWVudA==',
      })
    );
  });

  test('caches chapter data with content to disk after parsing EPUB', async () => {
    const epubBuffer = await buildMockEpub(['Opening', 'Deep Dive']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-new',
        media: {
          metadata: { title: 'New Book', authorName: 'Writer' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    const cachedData = readCacheFile('book-new');
    expect(cachedData).toBeTruthy();
    expect(cachedData.bookId).toBe('book-new');
    expect(cachedData.title).toBe('New Book');
    expect(cachedData.author).toBe('Writer');
    expect(cachedData.coverWidth).toEqual(expect.any(Number));
    expect(cachedData.coverHeight).toEqual(expect.any(Number));
    expect(cachedData.chapters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Opening',
        preview: expect.any(String),
        content: expect.any(String),
      }),
    ]));
  });

  test('filters out front matter from EPUB TOC', async () => {
    const epubBuffer = await buildMockEpub([
      'Cover', 'Title Page', 'Copyright Page', 'Dedication',
      'Table of Contents', 'Introduction and Acknowledgements',
      'Week 1: Soul Connection', 'Week 2: Birth', 'Conclusion',
      'Appendix A: Resources',
    ]);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-fm',
        media: {
          metadata: { title: 'Test Book', authorName: 'Author' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc', genres: ['Self-Improvement'] },
    }, 'testuser');

    const cachedData = readCacheFile('book-fm');
    const titles = cachedData.chapters.map(c => c.title);
    expect(titles).not.toContain('Cover');
    expect(titles).not.toContain('Title Page');
    expect(titles).not.toContain('Copyright Page');
    expect(titles).not.toContain('Table of Contents');
    expect(titles).not.toContain('Appendix A: Resources');
    expect(titles).toContain('Introduction and Acknowledgements');
    expect(titles).toContain('Week 1: Soul Connection');
    expect(titles).toContain('Conclusion');
  });

  test('preview is first 3 sentences of chapter content', async () => {
    const epubBuffer = await buildMockEpub(['Chapter One', 'Chapter Two']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-preview',
        media: {
          metadata: { title: 'Preview Book', authorName: 'Author' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc' },
    }, 'testuser');

    const cachedData = readCacheFile('book-preview');
    const ch = cachedData.chapters[0];
    // Content has 4 sentences; preview should have first 3
    expect(ch.preview).toContain('Content of Chapter One.');
    expect(ch.preview).toContain('This is the second sentence.');
    expect(ch.preview).toContain('And here is the third sentence.');
    expect(ch.preview).not.toContain('fourth');
  });

  test('getDetail returns article section with chapter HTML', async () => {
    // Pre-populate cache for getDetail
    writeCacheFile('book-detail', {
      bookId: 'book-detail',
      chapters: [
        { id: 0, title: 'Intro', content: 'First paragraph.\n\nSecond paragraph.', preview: 'First paragraph.' },
        { id: 1, title: 'Main', content: 'Main content here.', preview: 'Main content here.' },
      ],
    });

    const adapter = createAdapter();

    const detail = await adapter.getDetail('book-detail:0');

    expect(detail.sections).toHaveLength(1);
    expect(detail.sections[0].type).toBe('article');
    expect(detail.sections[0].data.html).toContain('<p>First paragraph.</p>');
    expect(detail.sections[0].data.html).toContain('<p>Second paragraph.</p>');
    expect(detail.sections[0].data.wordCount).toBeGreaterThan(0);
  });

  test('getDetail returns empty sections when chapter has no content', async () => {
    writeCacheFile('book-empty', {
      bookId: 'book-empty',
      chapters: [
        { id: 0, title: 'Intro' },
      ],
    });

    const adapter = createAdapter();

    const detail = await adapter.getDetail('book-empty:0');
    expect(detail.sections).toHaveLength(0);
  });

  test('cover dimensions default to 2:3 on fetch failure', async () => {
    const epubBuffer = await buildMockEpub(['Chapter A', 'Chapter B']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [{
        id: 'book-nocover',
        media: {
          metadata: { title: 'No Cover', authorName: 'Author' },
          ebookFormat: 'epub',
        },
      }],
      total: 1,
    });

    mockFetchEpub(epubBuffer); // includes failed cover mock

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc' },
    }, 'testuser');

    const cachedData = readCacheFile('book-nocover');
    expect(cachedData.coverWidth).toBe(2);
    expect(cachedData.coverHeight).toBe(3);
  });

  // ===== Prefetch tests =====

  test('fetchItems favors cached books over uncached', async () => {
    // Pre-cache book-a
    writeCacheFile('book-a', {
      bookId: 'book-a',
      title: 'Cached Book A',
      author: 'Author A',
      coverWidth: 2, coverHeight: 3,
      chapters: [
        { id: 0, title: 'Chapter A1', preview: 'Preview A1.' },
        { id: 1, title: 'Chapter A2', preview: 'Preview A2.' },
      ],
    });

    // book-b is NOT cached — would need EPUB download
    const epubBuffer = await buildMockEpub(['Chapter B1', 'Chapter B2']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        {
          id: 'book-b',
          media: { metadata: { title: 'Book B', authorName: 'Author B' }, ebookFormat: 'epub' },
        },
        {
          id: 'book-a',
          media: { metadata: { title: 'Cached Book A', authorName: 'Author A' }, ebookFormat: 'epub' },
        },
      ],
      total: 2,
    });

    // Only need fetch for book-b (if it gets processed)
    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    // Limit 1 — should pick from cached book-a without downloading
    const items = await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      limit: 1,
      params: { library: 'lib-abc' },
    }, 'testuser');

    expect(items).toHaveLength(1);
    // The item should come from cached book-a (no fetch needed)
    expect(items[0].meta.bookTitle).toBe('Cached Book A');
    // fetch should NOT have been called for the selected book
    // (it may have been called for prefetch of uncached books)
  });

  test('prefetchAll caches all books in library', async () => {
    const epubBuffer1 = await buildMockEpub(['Ch1-A', 'Ch1-B']);
    const epubBuffer2 = await buildMockEpub(['Ch2-A', 'Ch2-B']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        { id: 'pa-1', media: { metadata: { title: 'Book PA1' }, ebookFormat: 'epub' } },
        { id: 'pa-2', media: { metadata: { title: 'Book PA2' }, ebookFormat: 'epub' } },
      ],
      total: 2,
    });

    mockFetchEpub(epubBuffer1);
    mockFetchEpub(epubBuffer2);

    const adapter = createAdapter();
    const result = await adapter.prefetchAll({
      params: { library: 'lib-abc' },
    });

    expect(result.cached).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    // Verify cache files were written
    expect(readCacheFile('pa-1')).toBeTruthy();
    expect(readCacheFile('pa-2')).toBeTruthy();
  });

  test('prefetchAll skips already-cached books when force is false', async () => {
    writeCacheFile('ps-1', {
      bookId: 'ps-1', title: 'Already Cached', chapters: [
        { id: 0, title: 'Ch1' }, { id: 1, title: 'Ch2' },
      ],
    });

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        { id: 'ps-1', media: { metadata: { title: 'Already Cached' }, ebookFormat: 'epub' } },
      ],
      total: 1,
    });

    const adapter = createAdapter();
    const result = await adapter.prefetchAll({
      params: { library: 'lib-abc' },
    });

    expect(result.cached).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('prefetchAll with force rebuilds existing caches', async () => {
    writeCacheFile('pf-1', {
      bookId: 'pf-1', title: 'Old Cache', chapters: [],
    });

    const epubBuffer = await buildMockEpub(['Fresh Ch1', 'Fresh Ch2']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        { id: 'pf-1', media: { metadata: { title: 'Rebuilt Book' }, ebookFormat: 'epub' } },
      ],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();
    const result = await adapter.prefetchAll(
      { params: { library: 'lib-abc' } },
      { force: true },
    );

    expect(result.cached).toBe(1);
    expect(result.skipped).toBe(0);

    const rebuilt = readCacheFile('pf-1');
    expect(rebuilt.title).toBe('Rebuilt Book');
    expect(rebuilt.chapters.length).toBeGreaterThan(0);
  });

  test('prefetchAll calls onProgress callback', async () => {
    const epubBuffer = await buildMockEpub(['Progress Ch1', 'Progress Ch2']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        { id: 'pp-1', media: { metadata: { title: 'Progress Book' }, ebookFormat: 'epub' } },
      ],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const onProgress = jest.fn();
    const adapter = createAdapter();

    await adapter.prefetchAll(
      { params: { library: 'lib-abc' } },
      { onProgress },
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 'pp-1',
        title: 'Progress Book',
        current: expect.any(Number),
        total: expect.any(Number),
      }),
    );
  });

  test('prefetchAll returns zeros when no library ID', async () => {
    const adapter = createAdapter();
    const result = await adapter.prefetchAll({ params: {} });
    expect(result).toEqual({ cached: 0, skipped: 0, failed: 0 });
  });

  test('background prefetch creates cache files for uncached books', async () => {
    const epubBuffer = await buildMockEpub(['BG Ch1', 'BG Ch2']);

    mockAbsClient.getLibraryItems.mockResolvedValueOnce({
      results: [
        { id: 'bg-1', media: { metadata: { title: 'BG Book' }, ebookFormat: 'epub' } },
      ],
      total: 1,
    });

    mockFetchEpub(epubBuffer);

    const adapter = createAdapter();

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: { library: 'lib-abc' },
    }, 'testuser');

    // Wait for fire-and-forget prefetch to complete
    await new Promise(r => setTimeout(r, 100));

    // Cache file should exist after background prefetch
    const cached = readCacheFile('bg-1');
    expect(cached).toBeTruthy();
    expect(cached.bookId).toBe('bg-1');
  });
});
