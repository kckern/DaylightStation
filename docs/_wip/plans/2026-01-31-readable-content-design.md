# Readable Content Design

**Goal:** Add support for readable content (ebooks, comics, magazines, PDFs) via Audiobookshelf and Komga adapters, with a new `ReadableItem` capability.

**Approach:** Proxy-first. Source systems (Komga, Audiobookshelf) handle rendering. We normalize metadata to domain model and pass through content.

---

## Content Types

### Paged vs Flow

| Aspect | Paged | Flow |
|--------|-------|------|
| **Examples** | Comics, PDFs, magazines, manga | EPUB novels, articles |
| **Page count** | Fixed (48 pages is always 48) | Variable (depends on viewport) |
| **Position** | Absolute (`page 23 of 48`) | Relative (`42%` or EPUB CFI) |
| **Facing pages** | Yes - left/right matter | No |
| **Server renderable** | Yes - each page is discrete | No - needs client renderer |
| **Komga** | All content (renders to pages) | - |
| **ABS EPUB** | Fixed-layout EPUB (rare) | Most EPUBs |

---

## Domain Model

### ReadableItem Capability

```javascript
// backend/src/2_domains/content/capabilities/Readable.mjs

ReadableItem extends Item {
  // === Content Type ===
  contentType: 'paged' | 'flow'
  format: 'pdf' | 'cbz' | 'cbr' | 'epub'

  // === Paged-specific ===
  totalPages: number | null           // Fixed count (paged only)
  pageLayout: 'single' | 'facing' | 'auto'
  readingDirection: 'ltr' | 'rtl'
  getPageUrl(page: number): string    // URL to fetch page image
  manifestUrl: string | null          // Readium WebPub manifest

  // === Flow-specific ===
  contentUrl: string | null           // URL to raw EPUB/HTML file

  // === Resumable ===
  resumable: true                     // Always true for readables
  resumePosition: PagePosition | FlowPosition | null

  // === Audio sync (optional) ===
  audioItemId: string | null          // Linked PlayableItem for audiobooks

  // === Methods ===
  isReadable(): true
  getProgress(): number | null        // 0-100 percent
}
```

### Position Types

```javascript
// Page-based position (Komga, fixed-layout)
PagePosition {
  type: 'page'
  page: number              // 1-indexed page number
}

// Flow-based position (EPUB)
FlowPosition {
  type: 'flow'
  cfi: string               // EPUB CFI like "/6/14!/4/2/1:0"
  percent: number           // 0-100 for progress bar
}

// Time-based position (existing, for audio/video)
TimePosition {
  type: 'time'
  seconds: number
  duration: number
}
```

### Generalized ContentProgress

```javascript
// Extends/replaces MediaProgress for all content types

ContentProgress {
  itemId: string
  position: TimePosition | PagePosition | FlowPosition
  lastAccessed: string | null         // ISO timestamp

  // Computed
  get percent(): number               // 0-100, works for all position types
  isComplete(): boolean               // percent >= 90 (configurable)
  isInProgress(): boolean             // position > 0 && !isComplete()
}
```

---

## Source System Capabilities

### Komga

| Feature | Endpoint | Notes |
|---------|----------|-------|
| Libraries | `GET /api/v1/libraries` | Top-level lists |
| Series | `GET /api/v1/series?library_id={id}` | Lists within library |
| Books | `GET /api/v1/series/{id}/books` | Items in series |
| Book detail | `GET /api/v1/books/{id}` | Includes `media.pagesCount` |
| Manifest | `GET /api/v1/books/{id}/manifest` | Readium WebPub format |
| Page image | `GET /api/v1/books/{id}/pages/{n}` | Rendered JPEG |
| Progress | `readProgress: { page, completed }` | Page-based |
| Auth | `X-API-Key` header | |

**Key insight:** Komga renders ALL content (PDF, CBZ, EPUB) to page images. Everything is effectively "paged".

### Audiobookshelf

| Feature | Endpoint | Notes |
|---------|----------|-------|
| Libraries | `GET /api/libraries` | Top-level lists |
| Items | `GET /api/libraries/{id}/items` | Items in library |
| Item detail | `GET /api/items/{id}?expanded=1` | Full metadata |
| Audio stream | `POST /api/items/{id}/play` | Returns session with track URLs |
| EPUB file | `GET /api/items/{id}/ebook` | Raw EPUB (application/epub+zip) |
| Progress | `GET /api/me/progress/{id}` | `currentTime`/`ebookLocation` |
| Auth | `Authorization: Bearer {token}` | |

**Key insight:** ABS serves raw EPUB files. Client uses epub.js to render. Audio has chapters and progress tracking.

**Distinguishing audiobook vs ebook:**
- `media.numAudioFiles > 0` → audiobook (PlayableItem)
- `media.ebookFormat` exists → ebook (ReadableItem)

---

## Architecture

### Proxy-First Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    Daylight Frontend                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Page viewer │  │ epub.js     │  │ Audio player        │  │
│  │ (paged)     │  │ (flow)      │  │ (audio)             │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  Daylight Backend                            │
│                                                              │
│  Proxy Layer (auth injection, passthrough):                  │
│    /api/v1/proxy/komga/*    → KomgaProxyAdapter             │
│    /api/v1/proxy/abs/*      → AudiobookshelfProxyAdapter    │
│                                                              │
│  Content Layer (metadata normalization):                     │
│    KomgaAdapter       → ReadableItem (paged), ListableItem  │
│    AudiobookshelfAdapter → PlayableItem | ReadableItem      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
          │                │                    │
          ▼                ▼                    ▼
     ┌─────────┐      ┌─────────┐         ┌─────────┐
     │  Komga  │      │   ABS   │         │  Plex   │
     └─────────┘      └─────────┘         └─────────┘
```

### What We Build vs Proxy

| Feature | Build | Proxy |
|---------|-------|-------|
| Page images (Komga) | - | Passthrough |
| EPUB file (ABS) | - | Passthrough |
| Audio stream (ABS) | - | Passthrough |
| Manifest/TOC | Normalize format | Passthrough |
| Progress read | Normalize to ContentProgress | API call |
| Progress write | Transform, forward | API call |
| List items | Normalize to ListableItem | API call |
| EPUB rendering | - | Frontend (epub.js) |
| Page rendering | - | Komga (pre-rendered) |

---

## Adapters

### KomgaProxyAdapter

```javascript
// backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs

export class KomgaProxyAdapter {
  getServiceName() { return 'komga'; }
  getBaseUrl() { return this.#host; }
  isConfigured() { return Boolean(this.#host && this.#apiKey); }

  getAuthHeaders() {
    return { 'X-API-Key': this.#apiKey };
  }

  transformPath(path) {
    return path.replace(/^\/komga/, '');
  }
}
```

### KomgaAdapter (IContentSource)

```javascript
// backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs

export class KomgaAdapter {
  source = 'komga'
  prefixes = [{ prefix: 'komga' }]

  async getItem(id) {
    const localId = this.#stripPrefix(id);
    const book = await this.#client.getBook(localId);

    return new ReadableItem({
      id: `komga:${book.id}`,
      source: 'komga',
      title: book.name,
      contentType: 'paged',
      format: this.#normalizeFormat(book.media.mediaProfile),
      totalPages: book.media.pagesCount,
      pageLayout: this.#getPageLayout(book),
      readingDirection: book.metadata.readingDirection || 'ltr',
      getPageUrl: (n) => `/api/v1/proxy/komga/api/v1/books/${book.id}/pages/${n}`,
      manifestUrl: `/api/v1/proxy/komga/api/v1/books/${book.id}/manifest`,
      thumbnail: `/api/v1/proxy/komga/api/v1/books/${book.id}/thumbnail`,
      resumePosition: book.readProgress
        ? { type: 'page', page: book.readProgress.page }
        : null
    });
  }

  async getList(id) {
    const localId = this.#stripPrefix(id);

    if (!localId) {
      // Root: return libraries
      const libraries = await this.#client.getLibraries();
      return libraries.map(lib => this.#toListableItem(lib, 'library'));
    }

    if (localId.startsWith('lib:')) {
      // Library: return series
      const libId = localId.replace('lib:', '');
      const series = await this.#client.getSeries(libId);
      return series.map(s => this.#toListableItem(s, 'series'));
    }

    if (localId.startsWith('series:')) {
      // Series: return books
      const seriesId = localId.replace('series:', '');
      const books = await this.#client.getBooks(seriesId);
      return books.map(b => this.#toReadableListItem(b));
    }

    return [];
  }

  async resolvePlayables(id) {
    return []; // Readables, not playables
  }

  async resolveReadables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }
}
```

### AudiobookshelfAdapter (IContentSource)

```javascript
// backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs

export class AudiobookshelfAdapter {
  source = 'abs'
  prefixes = [{ prefix: 'abs' }]

  async getItem(id) {
    const localId = this.#stripPrefix(id);
    const item = await this.#client.getItem(localId);

    // Ebook
    if (item.media.ebookFile) {
      return new ReadableItem({
        id: `abs:${item.id}`,
        source: 'abs',
        title: item.media.metadata.title,
        contentType: 'flow',
        format: item.media.ebookFile.ebookFormat,
        contentUrl: `/api/v1/proxy/abs/api/items/${item.id}/ebook`,
        thumbnail: `/api/v1/proxy/abs/api/items/${item.id}/cover`,
        resumePosition: item.userMediaProgress?.ebookLocation
          ? { type: 'flow', cfi: item.userMediaProgress.ebookLocation, percent: item.userMediaProgress.ebookProgress * 100 }
          : null,
        metadata: {
          author: item.media.metadata.authorName,
          narrator: item.media.metadata.narratorName,
          series: item.media.metadata.seriesName
        }
      });
    }

    // Audiobook
    if (item.media.numAudioFiles > 0) {
      return new PlayableItem({
        id: `abs:${item.id}`,
        source: 'abs',
        title: item.media.metadata.title,
        mediaType: 'audio',
        duration: item.media.duration,
        mediaUrl: `/api/v1/proxy/abs/api/items/${item.id}/play`,
        resumable: true,
        resumePosition: item.userMediaProgress?.currentTime || null,
        thumbnail: `/api/v1/proxy/abs/api/items/${item.id}/cover`,
        metadata: {
          author: item.media.metadata.authorName,
          narrator: item.media.metadata.narratorName,
          series: item.media.metadata.seriesName,
          chapters: item.media.chapters
        }
      });
    }

    return null;
  }

  async getList(id) {
    const localId = this.#stripPrefix(id);

    if (!localId) {
      // Root: return libraries
      const response = await this.#client.getLibraries();
      return response.libraries.map(lib => this.#toListableItem(lib, 'library'));
    }

    if (localId.startsWith('lib:')) {
      // Library: return items
      const libId = localId.replace('lib:', '');
      const response = await this.#client.getLibraryItems(libId);
      return response.results.map(item => this.#toListableItem(item));
    }

    return [];
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return (item instanceof PlayableItem) ? [item] : [];
  }

  async resolveReadables(id) {
    const item = await this.getItem(id);
    return (item instanceof ReadableItem) ? [item] : [];
  }
}
```

---

## API Endpoints

### Proxy Routes

```javascript
// backend/src/4_api/v1/routers/proxy.mjs (extend existing)

// Komga proxy
router.all('/komga/*', proxyHandler('komga'));

// Audiobookshelf proxy (may already exist)
router.all('/abs/*', proxyHandler('audiobookshelf'));
```

### Content Routes

```javascript
// backend/src/4_api/v1/routers/readable.mjs (new)

// Get readable item
router.get('/:id', async (req, res) => {
  const item = await contentSourceRegistry.getItem(req.params.id);
  if (!item?.isReadable?.()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(item);
});

// Get TOC (for flow content, proxy to source)
router.get('/:id/toc', async (req, res) => {
  // For Komga: proxy manifest
  // For ABS: return chapter structure from item metadata
});

// Update progress
router.patch('/:id/progress', async (req, res) => {
  const { position } = req.body; // PagePosition or FlowPosition
  // Forward to source system
});
```

---

## Frontend Rendering

### Paged Content (Komga)

```jsx
function PagedReader({ item }) {
  const [page, setPage] = useState(item.resumePosition?.page || 1);

  return (
    <div className={item.pageLayout === 'facing' ? 'spread' : 'single'}>
      {item.pageLayout === 'facing' && page > 1 && (
        <img src={item.getPageUrl(page - 1)} alt={`Page ${page - 1}`} />
      )}
      <img src={item.getPageUrl(page)} alt={`Page ${page}`} />

      <nav>
        <button onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
        <span>{page} / {item.totalPages}</span>
        <button onClick={() => setPage(p => Math.min(item.totalPages, p + 1))}>Next</button>
      </nav>
    </div>
  );
}
```

### Flow Content (ABS EPUB)

```jsx
import ePub from 'epubjs';

function FlowReader({ item }) {
  const viewerRef = useRef();
  const bookRef = useRef();

  useEffect(() => {
    bookRef.current = ePub(item.contentUrl);
    const rendition = bookRef.current.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%'
    });

    // Restore position
    if (item.resumePosition?.cfi) {
      rendition.display(item.resumePosition.cfi);
    } else {
      rendition.display();
    }

    return () => bookRef.current?.destroy();
  }, [item]);

  return <div ref={viewerRef} className="epub-viewer" />;
}
```

---

## Configuration

### services.yml

```yaml
# Already exists
komga:
  docker: http://komga:8080
  kckern-server: https://mags.kckern.net
  kckern-macbook: https://mags.kckern.net

audiobookshelf:
  docker: http://audiobookshelf:80
  kckern-server: https://audiobookshelf.kckern.net
  kckern-macbook: https://audiobookshelf.kckern.net
```

### integrations.yml

```yaml
# Already exists
audiobooks:
  - provider: audiobookshelf

ebooks:
  - provider: audiobookshelf
  - provider: komga
```

### Auth files

```yaml
# data/household/auth/komga.yml
token: {api-key}

# data/household/auth/audiobookshelf.yml
token: {jwt-token}
```

---

## Implementation Tasks

### Phase 1: Domain Model
1. Create `ReadableItem` capability
2. Create `PagePosition` and `FlowPosition` value objects
3. Extend `ContentProgress` to support all position types
4. Export from `#domains/content`

### Phase 2: Proxy Adapters
1. Create `KomgaProxyAdapter`
2. Register in proxy router
3. Verify passthrough works

### Phase 3: Content Adapters
1. Create `KomgaClient` (API wrapper)
2. Create `KomgaAdapter` (IContentSource)
3. Create `AudiobookshelfClient` (API wrapper)
4. Create `AudiobookshelfAdapter` (IContentSource)
5. Register adapters in `ContentSourceRegistry`

### Phase 4: API Routes
1. Add `/api/v1/proxy/komga/*` route
2. Add `/api/v1/readable/:id` routes
3. Add progress sync endpoints

### Phase 5: Frontend
1. Create `PagedReader` component
2. Integrate epub.js for `FlowReader`
3. Add to content player/viewer system

---

## Open Questions

1. **Audio-synced reading:** ABS audiobooks with companion EPUB - how to link and sync?
2. **Offline support:** Cache pages/chapters for offline reading?
3. **Annotations:** Support for highlights/bookmarks?
4. **Search:** Full-text search within flow content?

---

## References

- Komga API: https://komga.org/docs/api/
- Audiobookshelf API: https://api.audiobookshelf.org/
- Readium WebPub Manifest: https://readium.org/webpub-manifest/
- EPUB CFI: https://idpf.org/epub/linking/cfi/
