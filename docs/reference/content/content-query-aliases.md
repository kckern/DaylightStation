# Content Query Aliases Configuration

This document defines the configuration schema for content query aliases in DaylightStation. Query aliases provide user-friendly shortcuts for searching and filtering content across sources.

---

## Overview

Content query aliases allow users to define shortcuts for common content queries. For example, `music:mozart` can resolve to a Plex search filtered to music libraries only.

**Two levels of alias configuration:**

| Level | Location | Purpose |
|-------|----------|---------|
| **Source-level** | `integrations.yml` | Define library aliases and tags per source |
| **Household-level** | `apps/content/config.yml` | User-defined query alias overrides |

---

## Source Configuration (integrations.yml)

Libraries and albums can declare aliases and tags for query routing.

### Plex Libraries

```yaml
# household/integrations.yml

media:
  - provider: plex
    libraries:
      - id: 1
        name: "Movies"
        type: movie
        # No aliases - accessed via type or name

      - id: 2
        name: "TV Shows"
        type: show

      - id: 3
        name: "Music"
        type: music
        aliases: [music]           # Responds to music:*

      - id: 4
        name: "Kids Movies"
        type: movie
        tags: [kids]               # Responds to kids:*

      - id: 5
        name: "Audiobooks"
        type: music
        aliases: [audiobook, ab]   # Responds to audiobook:* or ab:*
        tags: [audiobooks]

      - id: 6
        name: "Podcasts"
        type: music
        aliases: [podcast, pod]
        tags: [podcasts]

      - id: 7
        name: "Fitness Videos"
        type: movie
        tags: [fitness, exercise]  # Responds to fitness:* or exercise:*

      - id: 14
        name: "Ambient & Background"
        type: music
        aliases: [ambient]
        tags: [ambient, background]
```

### Library Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | Yes | Plex library section ID |
| `name` | string | Yes | Display name (must match Plex) |
| `type` | string | Yes | Library type: `movie`, `show`, `music`, `photo` |
| `aliases` | string[] | No | Query prefixes that route to this library (e.g., `music:bach`) |
| `tags` | string[] | No | Tag categories this library belongs to (e.g., `kids:*` includes all libraries tagged `kids`) |

### Immich Albums

```yaml
# household/integrations.yml

gallery:
  - provider: immich
    albums:
      - id: "abc-123-def"
        name: "Family Photos"
        tags: [family, photos]     # Responds to family:* or photos:*

      - id: "xyz-789-ghi"
        name: "Vacations"
        tags: [travel, vacation]

      - id: "holiday-album-id"
        name: "Christmas 2025"
        tags: [christmas, holiday, family]
```

### Album Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Immich album UUID |
| `name` | string | Yes | Display name |
| `tags` | string[] | No | Tag categories this album belongs to |

---

## User-Defined Aliases (apps/content/config.yml)

Households can define custom query aliases that override or extend built-in behavior.

### Full Example

```yaml
# household/config/content.yml

# User-defined query alias overrides
contentQueryAliases:
  # Extend built-in music alias to exclude certain content
  music:
    exclude: [audiobook, podcast, ambient]   # Exclude these library aliases/tags

  # Define a tag-based alias
  family:
    type: tag
    tag: family                               # Routes to all sources tagged 'family'

  # Shorthand alias mapping
  ab:
    mapTo: audiobooks                         # ab:* becomes audiobooks:*

  # Library-specific alias
  exercise:
    type: library
    libraries: [7]                            # Route to specific Plex library IDs

  # Search with default filters
  recent:
    type: query
    filters:
      time: "30d.."                           # Last 30 days
      sort: date

  # Composite alias combining multiple sources
  kids-media:
    type: composite
    include:
      - tag: kids
      - library: 4                            # Kids Movies library

  # Exclusion-only alias (all media except...)
  movies-only:
    type: media
    exclude: [music, audiobook, podcast]
```

### Alias Types

| Type | Description | Example Use |
|------|-------------|-------------|
| `tag` | Routes to all sources with matching tag | `family:*` -> all family-tagged content |
| `library` | Routes to specific library IDs | Direct library access |
| `query` | Applies default query filters | `recent:*` -> time-filtered search |
| `composite` | Combines multiple sources/tags | `kids-media:*` -> union of tagged + library |
| `mapTo` | Simple alias redirection | `ab:*` -> `audiobooks:*` |

### Alias Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Alias type: `tag`, `library`, `query`, `composite`, `mapTo` |
| `tag` | string | Tag name to match (for `type: tag`) |
| `libraries` | number[] | Plex library IDs (for `type: library`) |
| `filters` | object | Default query parameters (for `type: query`) |
| `include` | array | Sources to include (for `type: composite`) |
| `exclude` | string[] | Aliases/tags to exclude from results |
| `mapTo` | string | Target alias (simple redirection) |

---

## Resolution Priority

When a query like `music:bach` is received:

1. **User aliases** (`contentQueryAliases`) are checked first
2. **Library aliases** (`libraries[].aliases`) are checked next
3. **Library tags** (`libraries[].tags`) are checked
4. **Built-in aliases** (source category aliases like `media:`, `gallery:`) are checked last

### Exclusion Behavior

The `exclude` field removes content from results:

```yaml
music:
  exclude: [audiobook, podcast]
```

With this config, `music:bach` searches music libraries but excludes any libraries with `audiobook` or `podcast` aliases or tags.

---

## Built-in Aliases

These aliases are provided by the content system and can be overridden:

| Alias | Default Behavior | Override Example |
|-------|------------------|------------------|
| `media:` | All Plex video/audio | `media: { exclude: [fitness] }` |
| `gallery:` | All Immich photos/videos | N/A |
| `audiobooks:` | Audiobookshelf libraries | `ab: { mapTo: audiobooks }` |
| `ebooks:` | Readable content | N/A |

---

## Query Examples

### Alias-Based Queries

```
music:bach              # Search music libraries for "bach"
kids:dinosaurs          # Search kids-tagged libraries for "dinosaurs"
audiobook:tolkien       # Search audiobook libraries for "tolkien"
ab:pratchett            # Same as audiobook:pratchett (if ab mapTo audiobooks)
family:vacation         # Search family-tagged content for "vacation"
recent:                 # All recent content (last 30 days)
```

### API Routes

```
GET /api/v1/content/query/search?source=music&text=bach
GET /api/v1/content/query/search?source=kids&text=dinosaurs
GET /api/v1/play/music:bach                    # Play random music match
GET /api/v1/item/audiobook:tolkien             # Get audiobook item
```

### Frontend URL Parameters

```
?play=music:bach                # Play music search result
?list=kids:                     # Browse kids content
?queue=audiobook:pratchett      # Queue audiobook search results
```

---

## Validation Rules

1. **Alias names** must be lowercase alphanumeric with hyphens allowed
2. **Library IDs** must exist in the configured Plex server
3. **Album IDs** must be valid UUIDs matching Immich albums
4. **Tags** are case-insensitive and normalized to lowercase
5. **Circular references** (`a mapTo b`, `b mapTo a`) are detected and rejected
6. **Reserved names** (`plex`, `immich`, `filesystem`) cannot be used as alias names

---

## Migration from Direct Library Access

Previously, content was accessed by library ID directly:

```yaml
# Old approach - hardcoded library IDs
items:
  - input: plex:12345           # Direct item ID
  - input: plex.library:3       # Direct library reference
```

With query aliases:

```yaml
# New approach - semantic aliases
items:
  - input: music:               # All music
  - input: kids:                # All kids content
  - input: audiobook:tolkien    # Search within category
```

Benefits:
- Library IDs can change without breaking configs
- Semantic naming improves readability
- Cross-source queries become possible (`kids:` could include Plex + Immich)

---

## Related Documentation

- [Query Combinatorics](./query-combinatorics.md) - Full query parameter reference
- [Content Stack Reference](./content-stack-reference.md) - API topology and resolution
- [Configuration System](../core/configuration.md) - Config file locations and loading
