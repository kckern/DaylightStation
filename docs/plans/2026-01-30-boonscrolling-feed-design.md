# Boonscrolling Feed Design

> Replacing doomscrolling with grounded, productive scrolling

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation

---

## Overview

Boonscrolling replaces attention-extracting feeds (Reddit, Twitter, etc.) with a **grounded feed** that mixes external content with personal reality. The feed becomes a two-way channel — not just content delivery, but micro-input capture that feeds back into the system.

### Core Philosophy

- You get the **novelty hit** of scrolling
- But it's **interleaved with reality**: family photos, health reminders, todos, unanswered emails
- The **algorithm is yours**: you control the injection ratio
- **Time awareness**: the longer you scroll, the more grounding content appears
- **Two-way interaction**: quick inputs (buttons, ratings, short text) capture data while you scroll
- **Productive scrolling**: Lifeplan ceremonies, belief validation, and goal check-ins woven into the experience

### Target Interfaces

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BOONSCROLLING INTERFACES                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │                    Feed API (Backend)                        │       │
│   │                                                              │       │
│   │  Aggregates: RSS, Reddit, YouTube, Photos, Grounding         │       │
│   │  Applies: User algorithm, injection ratios, time tracking    │       │
│   └──────────────────────────┬──────────────────────────────────┘       │
│                              │                                           │
│              ┌───────────────┼───────────────┐                          │
│              ▼               ▼               ▼                          │
│   ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐                │
│   │  Mobile App      │ │  Frontend    │ │   Kiosk      │                │
│   │  (sideloaded)    │ │  Web App     │ │   Mode       │                │
│   │                  │ │              │ │              │                │
│   │  * KILLER UX     │ │  iGoogle/    │ │  Tablet on   │                │
│   │  Phone scroll    │ │  Feedly      │ │  couch       │                │
│   │  replacement     │ │  replacement │ │              │                │
│   └──────────────────┘ └──────────────┘ └──────────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

The backend Feed API is the core; frontends consume it differently.

---

## Architecture

### Content Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BOONSCROLLING CONTENT FLOW                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  HARVESTING (Background)                                                 │
│  ───────────────────────                                                 │
│                                                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │  FreshRSS │  │Reddit RSS │  │YouTube RSS│  │ Grounding │            │
│  │  (news)   │  │ (hourly)  │  │ (hourly)  │  │  Sources  │            │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘            │
│        │              │              │              │                    │
│        ▼              ▼              ▼              ▼                    │
│  ┌─────────────────────────────────────────────────────────┐           │
│  │              Content Storage (YAML / DB)                 │           │
│  │  freshrss │  reddit.yml  │  youtube.yml  │ entropy/etc  │           │
│  └─────────────────────────────────────────────────────────┘           │
│                                                                          │
│  SERVING (On Request)                                                    │
│  ────────────────────                                                    │
│                                                                          │
│  GET /feed/next ──► FeedAlgorithmService                                │
│                          │                                               │
│                          ├── Get external (RSS + Reddit + YouTube)      │
│                          ├── Get grounding (Entropy, Todos, Photos...)  │
│                          ├── Apply injection ratio + time decay          │
│                          ├── Check triggers (time of day, context)       │
│                          ├── Inject Lifeplan ceremonies if due           │
│                          ├── Deduplicate (already shown)                 │
│                          └── Return ordered FeedItem[]                   │
│                                                                          │
│  User clicks link ──► Opens external site in browser/app                │
│  User clicks CTA  ──► POST /feed/respond ──► Updates system state       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### DDD Layer Placement

```
backend/src/
├── 1_domains/
│   └── feed/
│       └── entities/
│           ├── FeedItem.mjs
│           ├── FeedSession.mjs
│           └── EngagementEvent.mjs
│
├── 2_adapters/
│   ├── feed/
│   │   ├── content/
│   │   │   ├── FreshRssContentAdapter.mjs
│   │   │   ├── RedditRssAdapter.mjs
│   │   │   ├── YouTubeRssAdapter.mjs
│   │   │   └── index.mjs
│   │   ├── grounding/
│   │   │   ├── PhotoGroundingAdapter.mjs    (Immich)
│   │   │   ├── EntropyGroundingAdapter.mjs
│   │   │   ├── TodoGroundingAdapter.mjs
│   │   │   ├── EmailGroundingAdapter.mjs
│   │   │   ├── NutritionGroundingAdapter.mjs
│   │   │   ├── LifeplanGroundingAdapter.mjs
│   │   │   └── index.mjs
│   │   ├── storage/
│   │   │   ├── YamlFeedDatastore.mjs
│   │   │   └── index.mjs
│   │   └── index.mjs
│
├── 3_applications/
│   └── feed/
│       ├── ports/
│       │   ├── IContentSource.mjs
│       │   ├── IGroundingSource.mjs
│       │   ├── IFeedDatastore.mjs
│       │   └── index.mjs
│       ├── services/
│       │   ├── FeedAlgorithmService.mjs
│       │   ├── FeedContentManager.mjs
│       │   ├── FeedSessionManager.mjs
│       │   └── index.mjs
│       ├── usecases/
│       │   ├── GetFeedItems.mjs
│       │   ├── RecordEngagement.mjs
│       │   ├── RespondToFeedItem.mjs
│       │   └── index.mjs
│       ├── config/
│       │   └── defaultAlgorithm.mjs
│       └── index.mjs
│
└── 4_api/
    └── v1/
        └── routers/
            └── feed.mjs
```

---

## Data Models

### FeedItem

Universal item format regardless of source:

```javascript
/**
 * FeedItem Entity
 *
 * Universal feed item format for all content types.
 *
 * @module domains/feed/entities
 */

export class FeedItem {
  constructor({
    id,
    type,
    source,
    title,
    body,
    image,
    link,
    timestamp,
    priority,
    interaction,
    meta,
  }) {
    this.id = id                    // Unique: 'reddit:abc123', 'photo:xyz'
    this.type = type                // 'external' | 'grounding' | 'input'
    this.source = source            // 'reddit', 'rss', 'youtube', 'immich', 'entropy', etc.

    // Display
    this.title = title              // Headline or summary
    this.body = body || null        // Optional longer text
    this.image = image || null      // Image URL
    this.link = link || null        // Click-through URL (external items)

    // Metadata
    this.timestamp = timestamp      // When content was created/fetched
    this.priority = priority || 0   // For grounding content sorting
    this.meta = meta || {}          // Source-specific metadata

    // Interaction (optional)
    this.interaction = interaction || null

    Object.freeze(this)
  }

  get isExternal() { return this.type === 'external' }
  get isGrounding() { return this.type === 'grounding' }
  get isInteractive() { return this.type === 'input' || this.interaction != null }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      title: this.title,
      body: this.body,
      image: this.image,
      link: this.link,
      timestamp: this.timestamp,
      priority: this.priority,
      interaction: this.interaction,
      meta: this.meta,
    }
  }
}
```

### FeedInteraction

For interactive feed items:

```javascript
/**
 * FeedInteraction Value Object
 *
 * Defines how users can interact with a feed item.
 */

export class FeedInteraction {
  constructor({
    type,
    options,
    placeholder,
    maxLength,
    scale,
    endpoint,
    context,
  }) {
    this.type = type  // 'buttons' | 'quick_reply' | 'text_input' | 'rating'

    // For buttons / quick_reply
    this.options = options || null  // [{ label, value, style }]

    // For text_input
    this.placeholder = placeholder || null
    this.maxLength = maxLength || 280

    // For rating
    this.scale = scale || 5  // 1-5 stars

    // Callback
    this.endpoint = endpoint || '/api/feed/respond'
    this.context = context || {}  // Passed back with response

    Object.freeze(this)
  }

  static buttons(options, context = {}) {
    return new FeedInteraction({
      type: 'buttons',
      options: options.map(opt =>
        typeof opt === 'string'
          ? { label: opt, value: opt, style: 'default' }
          : opt
      ),
      context,
    })
  }

  static textInput(placeholder, context = {}, maxLength = 280) {
    return new FeedInteraction({
      type: 'text_input',
      placeholder,
      maxLength,
      context,
    })
  }

  static rating(scale = 5, context = {}) {
    return new FeedInteraction({
      type: 'rating',
      scale,
      context,
    })
  }
}
```

### EngagementEvent

Client-reported engagement signals:

```javascript
/**
 * EngagementEvent Entity
 *
 * Tracks user engagement for algorithm feedback.
 */

export class EngagementEvent {
  constructor({
    sessionId,
    timestamp,
    type,
    itemId,
    dwellMs,
    visiblePercent,
    interactionType,
    response,
    scrollDepth,
    direction,
    sessionDurationMs,
    itemsViewed,
  }) {
    this.sessionId = sessionId
    this.timestamp = timestamp || new Date()
    this.type = type  // 'impression' | 'dwell' | 'click' | 'interact' | 'scroll' | 'heartbeat'

    // For impression/dwell
    this.itemId = itemId || null
    this.dwellMs = dwellMs || null
    this.visiblePercent = visiblePercent || null

    // For interact
    this.interactionType = interactionType || null
    this.response = response || null

    // For scroll
    this.scrollDepth = scrollDepth || null
    this.direction = direction || null

    // Session context
    this.sessionDurationMs = sessionDurationMs
    this.itemsViewed = itemsViewed

    Object.freeze(this)
  }
}
```

### FeedSession

Server-side session tracking:

```javascript
/**
 * FeedSession Entity
 *
 * Tracks a user's feed session for time warnings and algorithm tuning.
 */

export class FeedSession {
  constructor({
    id,
    username,
    startedAt,
    lastActivityAt,
    itemsServed,
    itemsConsumed,
    groundingServed,
    interactionsCompleted,
    warningsShown,
  }) {
    this.id = id
    this.username = username
    this.startedAt = startedAt || new Date()
    this.lastActivityAt = lastActivityAt || new Date()
    this.itemsServed = itemsServed || []
    this.itemsConsumed = itemsConsumed || []
    this.groundingServed = groundingServed || 0
    this.interactionsCompleted = interactionsCompleted || 0
    this.warningsShown = warningsShown || []
  }

  get durationMs() {
    return this.lastActivityAt - this.startedAt
  }

  get durationMinutes() {
    return Math.floor(this.durationMs / 60000)
  }

  recordActivity() {
    this.lastActivityAt = new Date()
  }

  recordItemServed(itemId) {
    this.itemsServed.push(itemId)
  }

  recordItemConsumed(itemId) {
    if (!this.itemsConsumed.includes(itemId)) {
      this.itemsConsumed.push(itemId)
    }
  }

  recordWarningShown(warningType) {
    this.warningsShown.push({ type: warningType, at: new Date() })
  }

  hasShownWarning(warningType) {
    return this.warningsShown.some(w => w.type === warningType)
  }
}
```

---

## External Content Sources

### Port Interface

```javascript
/**
 * IContentSource Port Interface
 *
 * Abstraction for external content sources (RSS, Reddit, YouTube, etc.)
 */

export class IContentSource {
  /**
   * @returns {string} Source identifier
   */
  get sourceId() {
    throw new Error('Must implement')
  }

  /**
   * Harvest new content (background job)
   * @param {Object} config - Source-specific config
   * @returns {Promise<number>} Count of items harvested
   */
  async harvest(config) {
    throw new Error('Must implement')
  }

  /**
   * Get unconsumed items for a user
   * @param {string} username
   * @param {number} limit
   * @returns {Promise<FeedItem[]>}
   */
  async getUnconsumed(username, limit) {
    throw new Error('Must implement')
  }

  /**
   * Mark items as consumed
   * @param {string} username
   * @param {string[]} itemIds
   */
  async markConsumed(username, itemIds) {
    throw new Error('Must implement')
  }
}
```

### FreshRSS Adapter

For news, blogs, podcasts:

```javascript
/**
 * FreshRssContentAdapter
 *
 * Fetches content from FreshRSS instance.
 * Used for news sites, tech blogs, podcasts.
 */

export class FreshRssContentAdapter {
  #freshRssClient
  #logger

  get sourceId() { return 'rss' }

  async getUnconsumed(username, limit) {
    const items = await this.#freshRssClient.getUnread(username, { limit })

    return items.map(item => new FeedItem({
      id: `rss:${item.id}`,
      type: 'external',
      source: 'rss',
      title: item.title,
      body: item.summary?.substring(0, 280),
      image: item.thumbnail,
      link: item.url,
      timestamp: new Date(item.published),
      meta: {
        feedName: item.feed_title,
        feedId: item.feed_id,
        author: item.author,
      }
    }))
  }

  async markConsumed(username, itemIds) {
    const rssIds = itemIds
      .filter(id => id.startsWith('rss:'))
      .map(id => id.slice(4))

    await this.#freshRssClient.markRead(username, rssIds)
  }
}
```

### Reddit RSS Adapter

```javascript
/**
 * RedditRssAdapter
 *
 * Fetches Reddit content via RSS feeds.
 * Simple, no auth, limited but sufficient for boonscrolling.
 */

export class RedditRssAdapter {
  #parser
  #datastore
  #logger

  get sourceId() { return 'reddit' }

  /**
   * Harvest top posts from configured subreddits
   */
  async harvest(config) {
    const { subreddits, sort = 'hot', timeRange = 'day' } = config
    const posts = []

    for (const subreddit of subreddits) {
      try {
        const url = this.#buildUrl(subreddit, sort, timeRange)
        const feed = await this.#parser.parseURL(url)

        const subredditPosts = feed.items.map(item => ({
          id: this.#extractId(item.link),
          subreddit,
          title: item.title,
          link: item.link,
          content: item.contentSnippet?.substring(0, 280),
          thumbnail: this.#extractThumbnail(item.content),
          author: item.creator,
          pubDate: new Date(item.pubDate),
          harvestedAt: new Date(),
        }))

        posts.push(...subredditPosts)
        this.#logger.debug?.('reddit.harvest.subreddit', {
          subreddit,
          count: subredditPosts.length
        })
      } catch (error) {
        this.#logger.error?.('reddit.harvest.error', {
          subreddit,
          error: error.message
        })
      }
    }

    await this.#datastore.storePosts('reddit', posts)
    this.#logger.info?.('reddit.harvest.complete', { total: posts.length })

    return posts.length
  }

  #buildUrl(subreddit, sort, timeRange) {
    const base = `https://reddit.com/r/${subreddit}`
    if (sort === 'hot') return `${base}/hot/.rss`
    if (sort === 'new') return `${base}/new/.rss`
    if (sort === 'top') return `${base}/top/.rss?t=${timeRange}`
    return `${base}/.rss`
  }

  #extractId(link) {
    const match = link.match(/\/comments\/(\w+)\//)
    return match ? match[1] : link
  }

  #extractThumbnail(content) {
    const match = content?.match(/<img[^>]+src="([^"]+)"/)
    return match ? match[1] : null
  }

  async getUnconsumed(username, limit) {
    const posts = await this.#datastore.getUnconsumed('reddit', username, limit)

    return posts.map(post => new FeedItem({
      id: `reddit:${post.id}`,
      type: 'external',
      source: 'reddit',
      title: post.title,
      body: post.content,
      image: post.thumbnail,
      link: post.link,
      timestamp: post.pubDate,
      meta: {
        subreddit: post.subreddit,
        author: post.author,
      }
    }))
  }

  async markConsumed(username, itemIds) {
    const postIds = itemIds
      .filter(id => id.startsWith('reddit:'))
      .map(id => id.slice(7))

    await this.#datastore.markConsumed('reddit', username, postIds)
  }
}
```

### YouTube RSS Adapter

```javascript
/**
 * YouTubeRssAdapter
 *
 * Fetches YouTube channel uploads via RSS.
 * Treats videos as thumbnailed articles linking to YouTube.
 */

export class YouTubeRssAdapter {
  #parser
  #datastore
  #logger

  get sourceId() { return 'youtube' }

  async harvest(config) {
    const { channels } = config  // [{ id: 'UC...', name: 'Channel Name' }]
    const videos = []

    for (const channel of channels) {
      try {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`
        const feed = await this.#parser.parseURL(url)

        const channelVideos = feed.items.map(item => {
          const videoId = item.id.split(':').pop()
          return {
            id: videoId,
            channelId: channel.id,
            channelName: channel.name || feed.title,
            title: item.title,
            link: item.link,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            description: item.contentSnippet?.substring(0, 200),
            pubDate: new Date(item.pubDate),
            harvestedAt: new Date(),
          }
        })

        videos.push(...channelVideos)
        this.#logger.debug?.('youtube.harvest.channel', {
          channel: channel.name,
          count: channelVideos.length
        })
      } catch (error) {
        this.#logger.error?.('youtube.harvest.error', {
          channel: channel.id,
          error: error.message
        })
      }
    }

    await this.#datastore.storePosts('youtube', videos)
    this.#logger.info?.('youtube.harvest.complete', { total: videos.length })

    return videos.length
  }

  async getUnconsumed(username, limit) {
    const videos = await this.#datastore.getUnconsumed('youtube', username, limit)

    return videos.map(video => new FeedItem({
      id: `youtube:${video.id}`,
      type: 'external',
      source: 'youtube',
      title: video.title,
      body: video.description,
      image: video.thumbnail,
      link: video.link,
      timestamp: video.pubDate,
      meta: {
        channelId: video.channelId,
        channelName: video.channelName,
        videoId: video.id,
      }
    }))
  }

  async markConsumed(username, itemIds) {
    const videoIds = itemIds
      .filter(id => id.startsWith('youtube:'))
      .map(id => id.slice(8))

    await this.#datastore.markConsumed('youtube', username, videoIds)
  }
}
```

---

## Grounding Content Sources

### Port Interface

```javascript
/**
 * IGroundingSource Port Interface
 *
 * Abstraction for grounding content sources (photos, entropy, todos, etc.)
 */

export class IGroundingSource {
  /**
   * @returns {string} Source identifier
   */
  get sourceId() {
    throw new Error('Must implement')
  }

  /**
   * @returns {number} Default priority (higher = more likely to be shown)
   */
  get defaultPriority() {
    return 0
  }

  /**
   * Get grounding items for a user
   * @param {string} username
   * @param {Object} options
   * @param {number} options.limit
   * @param {string[]} options.excludeIds - Already shown items
   * @param {Object} options.context - Time of day, session state, etc.
   * @returns {Promise<FeedItem[]>}
   */
  async getItems(username, options) {
    throw new Error('Must implement')
  }
}
```

### Grounding Source Implementations

```javascript
/**
 * PhotoGroundingAdapter (Immich)
 */
export class PhotoGroundingAdapter {
  #immichClient

  get sourceId() { return 'photo' }
  get defaultPriority() { return 5 }

  async getItems(username, { limit, excludeIds }) {
    // Get random photos, weighted toward "memories" (same date, past years)
    const photos = await this.#immichClient.getRandomPhotos(username, {
      limit,
      excludeIds,
      preferMemories: true,
    })

    return photos.map(photo => new FeedItem({
      id: `photo:${photo.id}`,
      type: 'grounding',
      source: 'photo',
      title: photo.description || this.#formatMemoryTitle(photo),
      image: photo.thumbnailUrl,
      link: photo.webUrl,
      timestamp: new Date(photo.takenAt),
      priority: photo.isMemory ? 10 : 5,
      meta: {
        albumName: photo.album,
        location: photo.location,
        people: photo.people,
        yearsAgo: photo.yearsAgo,
      }
    }))
  }

  #formatMemoryTitle(photo) {
    if (photo.yearsAgo) {
      return `${photo.yearsAgo} year${photo.yearsAgo > 1 ? 's' : ''} ago`
    }
    return null
  }
}

/**
 * EntropyGroundingAdapter
 */
export class EntropyGroundingAdapter {
  #entropyService

  get sourceId() { return 'entropy' }
  get defaultPriority() { return 20 }  // High priority - actionable

  async getItems(username, { limit, context }) {
    const report = await this.#entropyService.getReport(username)

    // Filter to yellow/red items only
    const actionable = report.items.filter(item => item.status !== 'green')

    return actionable.slice(0, limit).map(item => new FeedItem({
      id: `entropy:${item.source}`,
      type: 'grounding',
      source: 'entropy',
      title: `${item.name}: ${item.label}`,
      priority: item.status === 'red' ? 30 : 20,
      meta: {
        entropySource: item.source,
        status: item.status,
        value: item.value,
      },
      interaction: FeedInteraction.buttons([
        { label: 'Log activity', value: 'log', style: 'primary' },
        { label: 'Snooze', value: 'snooze' },
      ], { source: item.source }),
    }))
  }
}

/**
 * TodoGroundingAdapter
 */
export class TodoGroundingAdapter {
  #todoAdapter

  get sourceId() { return 'todo' }
  get defaultPriority() { return 25 }

  async getItems(username, { limit }) {
    const tasks = await this.#todoAdapter.getTasks(username, {
      filter: 'overdue_or_due_today',
    })

    return tasks.slice(0, limit).map(task => new FeedItem({
      id: `todo:${task.id}`,
      type: 'grounding',
      source: 'todo',
      title: task.content,
      body: task.description,
      priority: task.overdue ? 30 : 20,
      timestamp: task.due ? new Date(task.due) : null,
      meta: {
        taskId: task.id,
        project: task.project,
        overdue: task.overdue,
        priority: task.priority,
      },
      interaction: FeedInteraction.buttons([
        { label: 'Done', value: 'complete', style: 'primary' },
        { label: 'Snooze 1 day', value: 'snooze' },
        { label: 'Open', value: 'open' },
      ], { taskId: task.id }),
    }))
  }
}

/**
 * NutritionGroundingAdapter
 */
export class NutritionGroundingAdapter {
  #nutritionService

  get sourceId() { return 'nutrition' }
  get defaultPriority() { return 15 }

  async getItems(username, { context }) {
    const { hour } = context
    const items = []

    // Meal reminders based on time of day
    const meals = [
      { name: 'breakfast', startHour: 6, endHour: 10 },
      { name: 'lunch', startHour: 11, endHour: 14 },
      { name: 'dinner', startHour: 17, endHour: 21 },
    ]

    for (const meal of meals) {
      if (hour >= meal.startHour && hour <= meal.endHour) {
        const logged = await this.#nutritionService.hasMealLogged(username, meal.name)

        if (!logged) {
          items.push(new FeedItem({
            id: `nutrition:${meal.name}:${new Date().toDateString()}`,
            type: 'input',
            source: 'nutrition',
            title: `Did you eat ${meal.name}?`,
            priority: 15,
            interaction: FeedInteraction.buttons([
              { label: 'Yes, log it', value: 'log', style: 'primary' },
              { label: 'Not yet', value: 'later' },
              { label: 'Skip', value: 'skip' },
            ], { meal: meal.name }),
          }))
        }
      }
    }

    return items
  }
}

/**
 * EmailGroundingAdapter
 */
export class EmailGroundingAdapter {
  #emailService

  get sourceId() { return 'email' }
  get defaultPriority() { return 18 }

  async getItems(username, { limit }) {
    const unanswered = await this.#emailService.getUnanswered(username, {
      minAgeDays: 2,
      limit,
    })

    return unanswered.map(email => new FeedItem({
      id: `email:${email.id}`,
      type: 'grounding',
      source: 'email',
      title: `${email.from} (${email.daysAgo} days)`,
      body: email.subject,
      priority: Math.min(25, 15 + email.daysAgo),  // Older = higher priority
      meta: {
        emailId: email.id,
        from: email.from,
        subject: email.subject,
        daysAgo: email.daysAgo,
      },
      interaction: FeedInteraction.buttons([
        { label: 'Reply later', value: 'snooze' },
        { label: 'Archive', value: 'archive' },
        { label: 'Open', value: 'open' },
      ], { emailId: email.id }),
    }))
  }
}

/**
 * LifeplanGroundingAdapter
 *
 * Injects Lifeplan ceremony items (belief validation, goal check-ins, etc.)
 */
export class LifeplanGroundingAdapter {
  #lifeplanService

  get sourceId() { return 'lifeplan' }
  get defaultPriority() { return 10 }

  async getItems(username, { limit, context }) {
    const { sessionDurationMinutes } = context
    const items = []

    // Only inject after some scrolling (earned attention)
    if (sessionDurationMinutes < 3) {
      return items
    }

    // Check for due ceremonies
    const dueCeremonies = await this.#lifeplanService.getDueCeremonies(username)

    for (const ceremony of dueCeremonies.slice(0, limit)) {
      switch (ceremony.type) {
        case 'belief_validation':
          items.push(this.#createBeliefItem(ceremony))
          break
        case 'goal_pulse':
          items.push(this.#createGoalPulseItem(ceremony))
          break
        case 'value_check':
          items.push(this.#createValueCheckItem(ceremony))
          break
        case 'gratitude':
          items.push(this.#createGratitudeItem(ceremony))
          break
      }
    }

    return items
  }

  #createBeliefItem(ceremony) {
    const { belief } = ceremony
    return new FeedItem({
      id: `lifeplan:belief:${belief.id}`,
      type: 'input',
      source: 'lifeplan',
      title: `"${belief.statement}" — Still true?`,
      priority: 12,
      meta: { beliefId: belief.id, ceremonyType: 'belief_validation' },
      interaction: FeedInteraction.buttons([
        { label: 'Strongly agree', value: '5' },
        { label: 'Agree', value: '4' },
        { label: 'Neutral', value: '3' },
        { label: 'Disagree', value: '2' },
      ], { beliefId: belief.id, type: 'belief_validation' }),
    })
  }

  #createGoalPulseItem(ceremony) {
    const { goal } = ceremony
    return new FeedItem({
      id: `lifeplan:goal:${goal.id}`,
      type: 'input',
      source: 'lifeplan',
      title: `${goal.name}: How's progress?`,
      body: goal.description,
      priority: 12,
      meta: { goalId: goal.id, ceremonyType: 'goal_pulse' },
      interaction: FeedInteraction.rating(5, { goalId: goal.id, type: 'goal_pulse' }),
    })
  }

  #createValueCheckItem(ceremony) {
    const { value, competing } = ceremony
    return new FeedItem({
      id: `lifeplan:value:${value.id}`,
      type: 'input',
      source: 'lifeplan',
      title: `This week, did you prioritize ${value.name} over ${competing.name}?`,
      priority: 10,
      meta: { valueId: value.id, ceremonyType: 'value_check' },
      interaction: FeedInteraction.buttons([
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
        { label: 'Wasn\'t tested', value: 'na' },
      ], { valueId: value.id, competingId: competing.id, type: 'value_check' }),
    })
  }

  #createGratitudeItem(ceremony) {
    return new FeedItem({
      id: `lifeplan:gratitude:${Date.now()}`,
      type: 'input',
      source: 'lifeplan',
      title: 'One thing you\'re grateful for today?',
      priority: 8,
      meta: { ceremonyType: 'gratitude' },
      interaction: FeedInteraction.textInput(
        'Something small or big...',
        { type: 'gratitude' },
        280
      ),
    })
  }
}
```

---

## Feed Algorithm Service

The core algorithm that assembles the feed:

```javascript
/**
 * FeedAlgorithmService
 *
 * Assembles feed items from multiple sources using configurable algorithm.
 * Handles injection ratios, time decay, triggers, and deduplication.
 */

export class FeedAlgorithmService {
  #contentManager
  #groundingSources
  #sessionManager
  #configService
  #logger

  static DEFAULT_CONFIG = {
    // Base injection ratio (1 in N items is grounding)
    baseGroundingRatio: 5,

    // Time decay: increase grounding frequency over time
    timeDecay: {
      enabled: true,
      startMinutes: 5,
      decayRate: 0.9,  // Multiply ratio by this every N minutes
      minRatio: 2,     // Never go below 1 in 2
    },

    // Content source weights
    sourceWeights: {
      rss: 1.0,
      reddit: 1.0,
      youtube: 0.8,
    },

    // Grounding source weights
    groundingWeights: {
      entropy: 2.0,    // High priority
      todo: 2.0,
      nutrition: 1.5,
      email: 1.0,
      photo: 1.0,
      lifeplan: 0.8,   // Less frequent
    },

    // Limits
    maxLifeplanPerSession: 1,
    batchSize: 10,
  }

  constructor({ contentManager, groundingSources, sessionManager, configService, logger }) {
    this.#contentManager = contentManager
    this.#groundingSources = groundingSources
    this.#sessionManager = sessionManager
    this.#configService = configService
    this.#logger = logger
  }

  /**
   * Get next batch of feed items
   */
  async getNextBatch(username, sessionId, options = {}) {
    const config = this.#resolveConfig(username)
    const session = await this.#sessionManager.getOrCreate(sessionId, username)

    // Calculate current grounding ratio based on time
    const groundingRatio = this.#calculateGroundingRatio(session, config)

    // Determine how many of each type we need
    const batchSize = options.limit || config.batchSize
    const groundingCount = Math.ceil(batchSize / groundingRatio)
    const externalCount = batchSize - groundingCount

    // Fetch content
    const [externalItems, groundingItems] = await Promise.all([
      this.#contentManager.getExternalContent(username, {
        limit: externalCount,
        excludeIds: session.itemsServed,
      }),
      this.#getGroundingContent(username, {
        limit: groundingCount,
        excludeIds: session.itemsServed,
        context: this.#buildContext(session),
      }),
    ])

    // Interleave items
    const items = this.#interleave(externalItems, groundingItems, groundingRatio)

    // Record served items
    for (const item of items) {
      session.recordItemServed(item.id)
    }
    await this.#sessionManager.save(session)

    // Check for time warnings
    const warning = this.#checkTimeWarning(session, config)

    this.#logger.debug?.('feed.batch.generated', {
      sessionId,
      external: externalItems.length,
      grounding: groundingItems.length,
      ratio: groundingRatio,
      sessionMinutes: session.durationMinutes,
    })

    return {
      items,
      sessionId: session.id,
      sessionDurationMs: session.durationMs,
      warning,
      meta: {
        groundingRatio,
        nextGroundingIn: Math.floor(groundingRatio),
      },
      hasMore: externalItems.length >= externalCount,
    }
  }

  #calculateGroundingRatio(session, config) {
    let ratio = config.baseGroundingRatio

    if (config.timeDecay.enabled) {
      const minutes = session.durationMinutes
      const decayPeriods = Math.floor(minutes / config.timeDecay.startMinutes)

      for (let i = 0; i < decayPeriods; i++) {
        ratio = Math.max(config.timeDecay.minRatio, ratio * config.timeDecay.decayRate)
      }
    }

    return Math.round(ratio)
  }

  async #getGroundingContent(username, options) {
    const items = []
    const config = this.#resolveConfig(username)

    for (const source of this.#groundingSources) {
      try {
        const weight = config.groundingWeights[source.sourceId] || 1.0
        const sourceLimit = Math.ceil(options.limit * weight / this.#groundingSources.length)

        const sourceItems = await source.getItems(username, {
          limit: sourceLimit,
          excludeIds: options.excludeIds,
          context: options.context,
        })

        items.push(...sourceItems)
      } catch (error) {
        this.#logger.error?.('feed.grounding.error', {
          source: source.sourceId,
          error: error.message,
        })
      }
    }

    // Sort by priority and limit
    return items
      .sort((a, b) => b.priority - a.priority)
      .slice(0, options.limit)
  }

  #interleave(external, grounding, ratio) {
    const result = []
    let groundingIndex = 0

    for (let i = 0; i < external.length; i++) {
      result.push(external[i])

      // Inject grounding content every N items
      if ((i + 1) % ratio === 0 && groundingIndex < grounding.length) {
        result.push(grounding[groundingIndex++])
      }
    }

    // Add remaining grounding items at end
    while (groundingIndex < grounding.length) {
      result.push(grounding[groundingIndex++])
    }

    return result
  }

  #checkTimeWarning(session, config) {
    const minutes = session.durationMinutes

    if (minutes >= 20 && !session.hasShownWarning('urgent')) {
      session.recordWarningShown('urgent')
      return {
        type: 'urgent',
        message: '20 minutes. Here\'s what else needs your attention:',
        style: 'takeover',
      }
    }

    if (minutes >= 10 && !session.hasShownWarning('moderate')) {
      session.recordWarningShown('moderate')
      return {
        type: 'moderate',
        message: '10 minutes of scrolling. Need a break?',
        style: 'card',
        options: ['Keep going', 'Take a break', 'Show me something productive'],
      }
    }

    if (minutes >= 5 && !session.hasShownWarning('gentle')) {
      session.recordWarningShown('gentle')
      return {
        type: 'gentle',
        message: 'You\'ve been here 5 minutes',
        style: 'subtle',
      }
    }

    return null
  }

  #buildContext(session) {
    return {
      hour: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      sessionDurationMinutes: session.durationMinutes,
      itemsViewed: session.itemsConsumed.length,
    }
  }

  #resolveConfig(username) {
    const userConfig = this.#configService.getAppConfig('feed') || {}
    return { ...FeedAlgorithmService.DEFAULT_CONFIG, ...userConfig }
  }
}
```

---

## Client-Server Sync

### Engagement Tracking

```javascript
/**
 * Client sends engagement events periodically
 */

// Client-side (pseudocode)
class FeedEngagementTracker {
  #sessionId
  #events = []
  #flushInterval = 5000  // 5 seconds

  trackImpression(itemId, visiblePercent) {
    this.#events.push({
      type: 'impression',
      itemId,
      visiblePercent,
      timestamp: Date.now(),
    })
  }

  trackDwell(itemId, dwellMs) {
    this.#events.push({
      type: 'dwell',
      itemId,
      dwellMs,
      timestamp: Date.now(),
    })
  }

  trackInteraction(itemId, interactionType, response) {
    this.#events.push({
      type: 'interact',
      itemId,
      interactionType,
      response,
      timestamp: Date.now(),
    })
  }

  async flush() {
    if (this.#events.length === 0) return

    const batch = this.#events.splice(0)

    await fetch('/api/feed/engagement', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: this.#sessionId,
        events: batch,
        sessionDurationMs: this.#getSessionDuration(),
        itemsViewed: this.#getItemsViewed(),
      }),
    })
  }
}
```

### Server Engagement Handler

```javascript
/**
 * RecordEngagement Use Case
 */
export class RecordEngagement {
  #sessionManager
  #contentManager
  #logger

  async execute(sessionId, events, metadata) {
    const session = await this.#sessionManager.get(sessionId)
    if (!session) return { success: false, error: 'Session not found' }

    session.recordActivity()

    // Process events
    for (const event of events) {
      switch (event.type) {
        case 'impression':
        case 'dwell':
          session.recordItemConsumed(event.itemId)
          break
        case 'interact':
          session.interactionsCompleted++
          break
      }
    }

    await this.#sessionManager.save(session)

    // Mark items as consumed in content sources
    const consumedIds = events
      .filter(e => e.type === 'dwell' && e.dwellMs > 1000)
      .map(e => e.itemId)

    if (consumedIds.length > 0) {
      await this.#contentManager.markConsumed(session.username, consumedIds)
    }

    return { success: true }
  }
}
```

---

## API Endpoints

```javascript
/**
 * Feed Router
 */

export function createFeedRouter({
  getFeedItems,
  recordEngagement,
  respondToFeedItem,
  feedAlgorithmService,
  configService
}) {
  const router = express.Router()

  const getUsername = () => configService.getHeadOfHousehold()

  /**
   * GET /feed
   * Get next batch of feed items
   */
  router.get('/', asyncHandler(async (req, res) => {
    const { sessionId, limit = 10 } = req.query
    const username = getUsername()

    const result = await getFeedItems.execute(username, sessionId, { limit: Number(limit) })
    res.json(result)
  }))

  /**
   * POST /feed/engagement
   * Record engagement events
   */
  router.post('/engagement', asyncHandler(async (req, res) => {
    const { sessionId, events, sessionDurationMs, itemsViewed } = req.body

    const result = await recordEngagement.execute(sessionId, events, {
      sessionDurationMs,
      itemsViewed,
    })

    res.json(result)
  }))

  /**
   * POST /feed/respond
   * Respond to interactive feed item
   */
  router.post('/respond', asyncHandler(async (req, res) => {
    const { itemId, response, context } = req.body
    const username = getUsername()

    const result = await respondToFeedItem.execute(username, {
      itemId,
      response,
      context,
    })

    res.json(result)
  }))

  /**
   * GET /feed/config
   * Get user's feed configuration
   */
  router.get('/config', asyncHandler(async (req, res) => {
    const username = getUsername()
    const config = feedAlgorithmService.getConfig(username)
    res.json(config)
  }))

  /**
   * PUT /feed/config
   * Update user's feed configuration
   */
  router.put('/config', asyncHandler(async (req, res) => {
    const username = getUsername()
    const config = req.body

    await feedAlgorithmService.updateConfig(username, config)
    res.json({ success: true })
  }))

  return router
}
```

---

## Configuration

### User Config (YAML)

File: `data/household/apps/feed/config.yml`

```yaml
# External content sources
sources:
  reddit:
    enabled: true
    subreddits:
      - technology
      - worldnews
      - science
      - programming
    sort: hot
    harvestInterval: 3600  # seconds

  youtube:
    enabled: true
    channels:
      - id: UCBcRF18a7Qf58cCRy5xuWwQ  # Example channel
        name: "Tech Channel"
      - id: UC123...
        name: "Science Channel"
    harvestInterval: 3600

  rss:
    enabled: true
    # Uses FreshRSS subscriptions

# Grounding sources
grounding:
  photo:
    enabled: true
    preferMemories: true

  entropy:
    enabled: true
    onlyYellowRed: true

  todo:
    enabled: true
    filter: overdue_or_due_today

  nutrition:
    enabled: true

  email:
    enabled: true
    minAgeDays: 2

  lifeplan:
    enabled: true
    maxPerSession: 1

# Algorithm settings
algorithm:
  baseGroundingRatio: 5
  timeDecay:
    enabled: true
    startMinutes: 5
    decayRate: 0.9
    minRatio: 2

  sourceWeights:
    rss: 1.0
    reddit: 1.0
    youtube: 0.8

  groundingWeights:
    entropy: 2.0
    todo: 2.0
    nutrition: 1.5
    email: 1.0
    photo: 1.0
    lifeplan: 0.8

# Time warnings
timeWarnings:
  gentle:
    afterMinutes: 5
    message: "You've been here 5 minutes"
  moderate:
    afterMinutes: 10
    message: "10 minutes of scrolling. Need a break?"
  urgent:
    afterMinutes: 20
    message: "20 minutes. Here's what needs your attention:"
```

---

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create `FeedItem`, `FeedSession`, `EngagementEvent` entities
2. Create `IContentSource`, `IGroundingSource` port interfaces
3. Create `YamlFeedDatastore` for content storage
4. Create `FeedSessionManager`

### Phase 2: External Content
5. Create `RedditRssAdapter`
6. Create `YouTubeRssAdapter`
7. Create `FreshRssContentAdapter`
8. Create `FeedContentManager` to orchestrate sources
9. Implement harvesting scheduler

### Phase 3: Grounding Sources
10. Create `PhotoGroundingAdapter` (Immich)
11. Create `EntropyGroundingAdapter`
12. Create `TodoGroundingAdapter`
13. Create `NutritionGroundingAdapter`
14. Create `EmailGroundingAdapter` (stubbed initially)
15. Create `LifeplanGroundingAdapter` (after Lifeplan domain exists)

### Phase 4: Algorithm & API
16. Create `FeedAlgorithmService`
17. Create `GetFeedItems` use case
18. Create `RecordEngagement` use case
19. Create `RespondToFeedItem` use case
20. Create feed router with endpoints

### Phase 5: Frontend (Web)
21. Create FeedApp in frontend
22. Implement infinite scroll with engagement tracking
23. Implement interactive items (buttons, text input, rating)
24. Implement time warnings

### Phase 6: Mobile App (Future)
25. Design mobile app architecture
26. Implement native scroll experience
27. Push notifications for grounding nudges

---

## Future Enhancements

- **Obsidian integration**: Random note resurfacing as grounding content
- **Paperless-ngx integration**: Unprocessed documents as grounding items
- **ML-based algorithm**: Learn user preferences from engagement data
- **Social features**: Share interesting items to Telegram/family
- **Offline support**: Cache content for offline scrolling
- **Widget**: Home screen widget showing grounding summary
- **Voice**: "What should I know right now?" via voice assistant

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design document |
