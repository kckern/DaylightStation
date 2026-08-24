# Feed Reference

Daylight Feed is one reading system with three deliberate modes:

- **Reader** is the subscription inbox for deliberate processing.
- **Headlines** is the daily briefing and cross-outlet comparison surface.
- **Scroll** is a bounded, personalized discovery session spanning news, library, household, and personal sources.
- **Search** joins their normalized 12-month history, saved items, and archived material.

Start with [Feed System Architecture](./feed-system-architecture.md) for the cross-mode model and API. Use [Reader System](./reader-system.md) for FreshRSS behavior, [Feed Scroll Architecture](./feed-scroll-architecture.md) for frontend session/rendering behavior, [Feed Assembly Process](./feed-assembly-process.md) for ranking, and [Feed Query System](./feed-query-system.md) for source configuration and filters.

## Current product contract

- Read, unread, save, and archive are canonical user-scoped states shared by every mode.
- Accepted Daylight state remains authoritative while failed FreshRSS writes retry from a durable server queue. Browser-network failures enter a separate durable client queue and replay in order when connectivity returns.
- Scroll sessions and served-item history survive reloads and server restarts for 24 hours.
- Reader and Scroll mount at most 60 list rows/cards while preserving the full scroll range.
- Filters, Reader views, headline view/edition, and search criteria are URL-addressable.
- Theme, reading size, line spacing, width, density, optional Scroll session budgets, Reader/Scroll checkpoints, and source weighting preferences are account-scoped. Existing local appearance settings migrate on first use.
- Search supports text-free history browsing, filters, opaque pagination, and visible backfill coverage.
- Headlines provides a ranked briefing, outlet comparison matrix, multi-source provenance, and a chronological coverage timeline. Timeline labels are deterministic title classification, not an editorial guarantee that a publisher issued a formal correction.
- Reader and Scroll support notes and quoted highlights. Text-quote locators retain prefix/suffix context so a saved highlight can be found after reopening the article.
- Up to 100 explicit article editions can be downloaded to user-scoped IndexedDB on one device. The shell and built assets use the service-worker shell cache; API responses are never placed in the shared cache.
- Account data can be exported/imported in `daylight.feed-export/v1`, including preferences, source tuning, checkpoints, canonical state, annotations, and normalized history metadata.
- Keyboard-accessible state actions and non-gesture alternatives are required for every primary workflow.

## Verification and remaining scope

The implementation closure and requirement-by-requirement status live in [the 2026-08-24 product audit](../../_wip/audits/2026-08-24-feed-app-product-ux-audit.md). Automated tests cover state, workspace migration, mutation replay, annotations, export/import, briefing/timeline construction, navigation, list windowing, and the API surface. Deterministic Chromium acceptance covers phone Reader/Scroll, desktop Headlines, a 500-item bounded Scroll render, and cold-link IndexedDB recovery. Target-display TV acceptance and field performance budgets remain operational gates rather than claims made by unit tests.

## Deliberate limits

- Offline editions contain the item and currently available readable detail, not a guaranteed archive of every remote image/video. Cached notes remain readable and note/create/edit/delete plus read/save/archive changes queue in user-scoped browser storage for ordered replay.
- Checkpoints restore Reader and Scroll mode position; they are not per-paragraph reading-percentage synchronization.
- Portable export is a Feed workspace backup, not OPML subscription management and not a full copyrighted article archive.
- Source tuning currently supports `more`, `less`, `mute`, and reset for top-level Scroll sources. Topic-level controls and a separate subscription/follow model remain distinct future work.
- Briefing timelines show harvested reports in time order and flag titles containing update/correction language. Daylight does not infer unannounced corrections or retain publisher page revisions.
- Summaries remain source-provided and extractive. AI-generated summaries are intentionally absent until provenance, privacy, configuration, and failure contracts are specified.
