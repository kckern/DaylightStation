# Fediverse & Nostr Feed Adapters

> Read-only feed consumption from fediverse platforms and Nostr into the DaylightStation feed scroll

**Last Updated:** 2026-03-02
**Status:** Design Draft
**Depends On:** Existing feed adapter infrastructure (`IFeedSourceAdapter`, `SourceResolver`, `FeedPoolManager`)

---

## Overview

Add seven feed source adapters for consuming public content from fediverse platforms and Nostr. All adapters are read-only (no publishing, liking, or boosting) and use public unauthenticated endpoints. All claim `CONTENT_TYPES.SOCIAL` and appear in the wire tier's social allocation alongside Reddit.

**Platforms:**

| Platform | Protocol | Transport | Content |
|----------|----------|-----------|---------|
| Mastodon | ActivityPub | REST | Microblog posts |
| Pixelfed | ActivityPub (Mastodon-compat) | REST | Photo posts |
| Loops.video | ActivityPub (Mastodon-compat) | REST | Short video |
| PeerTube | PeerTube API | REST | Videos |
| PieFed | Lemmy-compat API | REST | Link aggregation |
| Nostr | NIP-01 | WebSocket | Text notes (kind 1) |
| Generic ActivityPub | Mastodon-compat API | REST | Any fediverse instance |

**Not in scope:**
- X/Twitter (deferred — no free public API)
- Authenticated access / home timelines
- Publishing, liking, boosting, or any write operations
- The social publishing domain from `social-and-licensing.md`

---

## Architecture

### Two-Layer Pattern (FreshRSS Precedent)

Three of the named adapters (Mastodon, Pixelfed, Loops) plus the generic catch-all all speak the same Mastodon-compatible API. A shared `ActivityPubClient` handles the protocol, and each adapter provides platform-specific normalization.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ActivityPubClient.mjs                         │
│                  (low-level Mastodon-compat API)                   │
│                                                                     │
│  • URL building per instance                                        │
│  • Public timeline / hashtag / account fetching                     │
│  • Link header pagination parsing                                   │
│  • Rate-limit retry (429 backoff)                                   │
│  • Response parsing                                                 │
└──────────┬──────────────┬──────────────┬──────────────┬─────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
  ┌──────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────────┐
  │   Mastodon   │ │  Pixelfed  │ │   Loops   │ │  ActivityPub     │
  │ FeedAdapter  │ │ FeedAdapter│ │FeedAdapter│ │  FeedAdapter     │
  │              │ │            │ │           │ │  (generic)       │
  │ text posts,  │ │ photo dims,│ │ video     │ │  baseline        │
  │ boosts,      │ │ albums,    │ │ duration, │ │  normalize for   │
  │ replies      │ │ alt text   │ │ blurhash  │ │  any instance    │
  └──────────────┘ └────────────┘ └───────────┘ └──────────────────┘

  ┌──────────────┐ ┌────────────┐ ┌───────────┐
  │   PeerTube   │ │   PieFed   │ │   Nostr   │
  │ FeedAdapter  │ │ FeedAdapter│ │FeedAdapter│
  │              │ │            │ │           │
  │ Own REST API │ │ Lemmy API  │ │ WebSocket │
  │ /api/v1/     │ │ /api/v3/   │ │ NIP-01    │
  └──────────────┘ └────────────┘ └───────────┘
```

### File Layout

```
backend/src/1_adapters/feed/
  ActivityPubClient.mjs              ← shared low-level client
  sources/
    MastodonFeedAdapter.mjs          ← Mastodon-specific normalize
    PixelfedFeedAdapter.mjs          ← photo-focused normalize
    LoopsFeedAdapter.mjs             ← video-focused normalize
    ActivityPubFeedAdapter.mjs       ← generic catch-all
    PeerTubeFeedAdapter.mjs          ← own API, standalone
    PieFedFeedAdapter.mjs            ← Lemmy API, standalone
    NostrFeedAdapter.mjs             ← WebSocket, standalone
```

Each adapter wired in `app.mjs` alongside the existing 18 adapters.

---

## Platform API Details

### Mastodon (and Mastodon-compat: Pixelfed, Loops)

Public endpoints, no token required:

- `GET /api/v1/timelines/public?local=true` — instance local timeline
- `GET /api/v1/timelines/tag/:hashtag` — hashtag timeline
- `GET /api/v1/accounts/:id/statuses` — single account's posts
- `GET /api/v1/accounts/lookup?acct=user@instance` — account ID lookup

Pagination via `Link` header with `max_id` cursor:
```
Link: <https://instance.social/api/v1/timelines/public?max_id=12345>; rel="next"
```

Response shape (status object):
```json
{
  "id": "112345",
  "content": "<p>HTML content</p>",
  "created_at": "2026-03-02T12:00:00.000Z",
  "account": { "acct": "user@instance", "display_name": "User", "avatar": "..." },
  "media_attachments": [{ "type": "image", "url": "...", "meta": { "original": { "width": 1200, "height": 800 } } }],
  "reblogs_count": 12,
  "replies_count": 3,
  "favourites_count": 45,
  "url": "https://instance.social/@user/112345"
}
```

Pixelfed posts always populate `media_attachments[]` with image dimensions and alt text. Loops posts populate `media_attachments[]` with `type: 'video'` and include duration.

### PeerTube

Own REST API, not Mastodon-compatible:

- `GET /api/v1/videos?sort=-publishedAt` — recent videos
- `GET /api/v1/video-channels/:handle/videos` — channel videos
- `GET /api/v1/search/videos?search=:query` — search

Offset-based pagination: `start` + `count` parameters.

Response includes: `name`, `description`, `duration`, `thumbnailPath`, `previewPath`, `views`, `channel.displayName`, `publishedAt`.

### PieFed (Lemmy-compat)

- `GET /api/v3/post/list?community_name=:name&sort=Hot` — community posts
- `GET /api/v3/post/list?sort=Hot` — instance front page

Page-based pagination: `page` parameter.

Posts have: `post.name` (title), `post.body` (text), `post.thumbnail_url`, `post.url` (link), `counts.score`, `counts.comments`, `creator.name`.

### Nostr (NIP-01)

WebSocket relay protocol:

1. Connect to `wss://relay.example.com`
2. Send `["REQ", "sub-id", { "kinds": [1], "authors": ["hex_pubkey"], "limit": 20 }]`
3. Receive `["EVENT", "sub-id", { ... }]` messages until `["EOSE", "sub-id"]`
4. Close connection

Filter by pubkey: `{"kinds":[1],"authors":["hex_pubkey"],"limit":20}`
Filter by hashtag: `{"kinds":[1],"#t":["topic"],"limit":20}`
Pagination: `until` timestamp on oldest event becomes cursor for next page.

Event shape:
```json
{
  "id": "hex_event_id",
  "pubkey": "hex_pubkey",
  "created_at": 1709380800,
  "kind": 1,
  "content": "Plain text with possible URLs",
  "tags": [["t", "bitcoin"], ["p", "other_pubkey"]]
}
```

Requires bech32 decoding of `npub` → hex pubkey for config.

---

## Adapter Structure

Each adapter extends `IFeedSourceAdapter`. Using Mastodon as the reference:

```js
export class MastodonFeedAdapter extends IFeedSourceAdapter {
  #apClient;     // shared ActivityPubClient
  #dataService;
  #logger;

  constructor({ activityPubClient, dataService, logger = console }) {
    super();
    this.#apClient = activityPubClient;
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'mastodon'; }
  get provides() { return [CONTENT_TYPES.SOCIAL]; }

  async fetchItems(query, username) { ... }
  async fetchPage(query, username, { cursor } = {}) { ... }
  async getDetail(localId, meta, username) { ... }

  #normalize(status, query, instance) { ... }
  #extractImage(status) { ... }
}
```

### What Varies Per Adapter

| Concern | Mastodon/Pixelfed/Loops/Generic AP | PeerTube | PieFed | Nostr |
|---------|-------------------------------------|----------|--------|-------|
| Client | Shared `ActivityPubClient` | Standalone | Standalone | Standalone |
| `sourceType` | `mastodon`/`pixelfed`/`loops`/`activitypub` | `peertube` | `piefed` | `nostr` |
| Transport | `fetch()` REST | `fetch()` REST | `fetch()` REST | `WebSocket` |
| Pagination | `max_id` from `Link` header | `start`+`count` offset | `page` offset | `until` timestamp |
| `#normalize()` | status → FeedItem | video → FeedItem | post → FeedItem | event → FeedItem |
| `getDetail()` | Full status + thread | Video metadata + desc | Post body + comments | Referenced events |
| Image extraction | `media_attachments[0]` | `thumbnailPath` | `thumbnail_url` | URL in `content` |

### ActivityPubClient (Shared)

```js
export class ActivityPubClient {
  #fetchFn;
  #logger;

  constructor({ fetchFn, logger = console }) { ... }

  async getPublicTimeline(instance, { local, limit, maxId } = {}) { ... }
  async getHashtagTimeline(instance, hashtag, { limit, maxId } = {}) { ... }
  async getAccountStatuses(instance, accountId, { limit, maxId } = {}) { ... }
  async lookupAccount(instance, acct) { ... }

  // Parses Link header for max_id cursor
  #parseLinkHeader(header) { ... }

  // Rate-limit retry (429 backoff, like Reddit adapter)
  #fetchWithRetry(url, options, attempt = 0) { ... }
}
```

### Nostr Adapter (WebSocket)

```js
export class NostrFeedAdapter extends IFeedSourceAdapter {
  #dataService;
  #logger;

  async fetchPage(query, username, { cursor } = {}) {
    const config = this.#dataService.user.read('config/feed/nostr', username);
    const relays = config?.relays || query.params?.relays || [];
    const filter = this.#buildFilter(config, query, cursor);

    // Short-lived connection: open → REQ → collect until EOSE → close
    const events = await this.#fetchFromRelays(relays, filter);
    const items = events.map(e => this.#normalize(e, query));

    // Oldest event's created_at becomes cursor for next page
    const oldest = events.length ? Math.min(...events.map(e => e.created_at)) : null;
    return { items, cursor: oldest ? String(oldest) : null };
  }
}
```

---

## Normalized FeedItem Shape

Every adapter maps platform data to this structure (matching Reddit/FreshRSS):

```js
{
  id: 'mastodon:fosstodon.org:112345',    // sourceType:instance:localId
  tier: query.tier || 'wire',
  source: 'mastodon',                      // matches sourceType
  title: null,                             // most social posts lack titles
  body: 'Plain text excerpt, max 200 chars...',
  image: '/api/v1/proxy/fediverse/...',    // proxied media URL
  link: 'https://fosstodon.org/@user/112345',
  timestamp: '2026-03-02T12:00:00.000Z',
  priority: query.priority || 0,
  meta: {
    author: 'user@fosstodon.org',
    sourceName: 'fosstodon.org',
    sourceIcon: 'https://fosstodon.org',
    boosts: 12,                            // Mastodon: reblogs_count
    replies: 3,                            // Mastodon: replies_count
    favourites: 45,                        // Mastodon: favourites_count
    duration: 187,                         // PeerTube/Loops: video seconds
    imageWidth: 1200,                      // when available
    imageHeight: 800,
  },
}
```

**ID format:** Includes instance host to avoid collisions across instances. Nostr uses `nostr:eventid` (event IDs are globally unique).

**Image proxy:** New `/api/v1/proxy/fediverse/:host/*` route (like existing Reddit proxy) to avoid mixed-content issues and provide caching.

---

## Configuration

### Directory Structure

All feed config consolidated under `config/feed/`:

```
data/users/{username}/config/feed/
  queries/              # thin activation files
    mastodon.yml
    pixelfed.yml
    loops.yml
    peertube.yml
    piefed.yml
    nostr.yml
    activitypub.yml     # generic catch-all
    reddit.yml          # existing, moved from config/queries/
    ...
  mastodon.yml          # subscription config
  pixelfed.yml
  loops.yml
  peertube.yml
  piefed.yml
  nostr.yml
  activitypub.yml
  reddit.yml            # subreddit config, moved from feed.yml
```

### Query Files (Thin Activation)

```yaml
# config/feed/queries/mastodon.yml
type: mastodon
tier: wire
limit: 10
priority: 3
```

### Subscription Config Examples

```yaml
# config/feed/mastodon.yml
instances:
  fosstodon.org:
    hashtags: [linux, homelab, selfhosted]
    accounts: [nixCraft, lunduke]
  mastodon.social:
    mode: local
```

```yaml
# config/feed/pixelfed.yml
instances:
  pixelfed.social:
    accounts:
      - natgeo@pixelfed.social
      - streetphotog@pixel.town
```

```yaml
# config/feed/peertube.yml
instances:
  videos.example.com:
    channels:
      - science@videos.example.com
    mode: channel
```

```yaml
# config/feed/piefed.yml
instances:
  piefed.social:
    communities: [technology, science, linux]
    mode: community
```

```yaml
# config/feed/nostr.yml
relays:
  - wss://relay.damus.io
  - wss://nos.lol
pubkeys:
  - npub1abc...
hashtags:
  - bitcoin
  - nostr
```

```yaml
# config/feed/activitypub.yml — generic catch-all
instances:
  pleroma.example.com:
    mode: local
  akkoma.example.com:
    hashtags: [art, photography]
    accounts: [artist@akkoma.example.com]
```

Each adapter reads its subscription config from `dataService.user.read('config/feed/{sourceType}', username)`. Query files just activate the adapter and set tier/limit/priority. Users can disable a platform by removing the query file without losing subscription lists.

---

## Implementation Phases

### Phase 1 — Config Migration & Proxy

- [ ] Create `config/feed/` directory structure
- [ ] Move existing query files from `config/queries/` → `config/feed/queries/`
- [ ] Move Reddit subreddit config from `feed.yml` → `config/feed/reddit.yml`
- [ ] Update `FeedPoolManager` / query loader to read from new path
- [ ] Update `RedditFeedAdapter` to read from `config/feed/reddit`
- [ ] Add `/api/v1/proxy/fediverse/:host/*` image proxy route
- [ ] Verify existing feed works after migration

### Phase 2 — ActivityPubClient & Mastodon Adapter

- [ ] Implement `ActivityPubClient.mjs` (shared low-level client)
  - [ ] Public timeline, hashtag, account fetching
  - [ ] `Link` header pagination parsing
  - [ ] Rate-limit retry (429 backoff)
  - [ ] Account lookup by `acct`
- [ ] Implement `MastodonFeedAdapter.mjs`
  - [ ] Injects `ActivityPubClient`
  - [ ] Reads config from `config/feed/mastodon`
  - [ ] `fetchPage()` with `max_id` cursor
  - [ ] `getDetail()` for full status + thread context
  - [ ] Mastodon-specific `#normalize()` (text, boosts, replies)
- [ ] Wire into `app.mjs`
- [ ] Create sample query + subscription YAML
- [ ] Test against a live instance (e.g., fosstodon.org)

### Phase 3 — Pixelfed & Loops (Mastodon-Compat)

- [ ] Implement `PixelfedFeedAdapter.mjs`
  - [ ] Reuses `ActivityPubClient`
  - [ ] `#normalize()` emphasizes `media_attachments[]` dimensions, alt text
- [ ] Implement `LoopsFeedAdapter.mjs`
  - [ ] Reuses `ActivityPubClient`
  - [ ] `#normalize()` emphasizes video duration, blurhash
- [ ] Wire into `app.mjs`, sample configs

### Phase 4 — Generic ActivityPub Catch-All

- [ ] Implement `ActivityPubFeedAdapter.mjs`
  - [ ] Reuses `ActivityPubClient`
  - [ ] Baseline `#normalize()` that handles any content type gracefully
  - [ ] Covers Pleroma, Akkoma, Misskey, GoToSocial, Firefish, etc.
- [ ] Wire into `app.mjs`, sample config

### Phase 5 — PeerTube Adapter

- [ ] Implement `PeerTubeFeedAdapter.mjs` (standalone, own API)
  - [ ] `/api/v1/videos` endpoint
  - [ ] Offset-based pagination (`start` + `count`)
  - [ ] Channel and search fetch modes
  - [ ] Video-specific normalize: duration, resolution, `thumbnailPath`
- [ ] Wire into `app.mjs`, sample config

### Phase 6 — PieFed Adapter

- [ ] Implement `PieFedFeedAdapter.mjs` (standalone, Lemmy API)
  - [ ] `/api/v3/post/list` endpoint
  - [ ] Page-based pagination
  - [ ] Community and instance-frontpage fetch modes
  - [ ] Post normalize: title, body, `thumbnail_url`, score, comments
- [ ] Wire into `app.mjs`, sample config

### Phase 7 — Nostr Adapter

- [ ] Implement `NostrFeedAdapter.mjs` (standalone, WebSocket)
  - [ ] Short-lived connections: open → `REQ` → collect until `EOSE` → close
  - [ ] `until` timestamp cursor for pagination
  - [ ] `npub` → hex pubkey bech32 decoding
  - [ ] Hashtag and pubkey filter modes
  - [ ] Parse `content` for inline image URLs
- [ ] Wire into `app.mjs`, sample config

### Future — X/Twitter

Deferred until a viable public access path exists. Current recommendation: subscribe to Twitter feeds via RSS-Bridge in FreshRSS, which surfaces them through the existing `FreshRSSSourceAdapter`.

---

## Open Questions

1. **Should Mastodon/Pixelfed/Loops share a proxy route or have separate ones?** Current design uses a single `/api/v1/proxy/fediverse/:host/*` for all.
2. **Nostr relay connection pooling** — for Phase 7, should we keep connections open across fetches (reduces latency) or stick with short-lived connections (simpler, no state)?
3. **Account avatar caching** — fediverse account avatars change. Cache locally or always proxy?
