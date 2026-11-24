# Feed Reference

Daylight Feed is one reading system with three deliberate modes:

- **Reader** is the subscription inbox for deliberate processing.
- **Headlines** is the daily briefing and cross-outlet comparison surface.
- **Scroll** is a bounded, personalized discovery session spanning news, library, household, and personal sources.
- **Search** joins their normalized 12-month history, saved items, and archived material.
- **Paper** (`/feed/paper`) is the newsstand for the office paper, the daily edition the NewsReporter `edition` kind writes and prints on the thermal printer. See [Paper newsstand](#paper-newsstand).

Start with [Feed System Architecture](./feed-system-architecture.md) for the cross-mode model and API. Use [Reader System](./reader-system.md) for FreshRSS behavior, [Feed Scroll Architecture](./feed-scroll-architecture.md) for frontend session/rendering behavior, [Feed Assembly Process](./feed-assembly-process.md) for ranking, [Feed Query System](./feed-query-system.md) for source configuration and filters, and the [Feed Design System](./design-system.md) for tokens, control treatments, and per-surface visual rules (the Headlines outlet matrix is the default headline view; Briefing is the secondary toggle).

## Current product contract

- Read, unread, save, and archive are canonical user-scoped states shared by every mode.
- Accepted Daylight state remains authoritative while failed FreshRSS writes retry from a durable server queue. Browser-network failures enter a separate account-scoped durable client queue and replay in order when connectivity returns.
- Scroll sessions and served-item history survive reloads and server restarts for 24 hours.
- Reader and Scroll mount at most 60 list rows/cards while preserving the full scroll range.
- Filters, Reader views, headline view/edition, and search criteria are URL-addressable. Reader Unread/Saved/Archived are canonical history queries rather than filters over the recent stream.
- Theme, reading size, line spacing, width, density, optional Scroll session budgets, Reader/Scroll checkpoints, and source weighting preferences are account-scoped. Existing local appearance settings migrate on first use.
- Search supports text-free history browsing, filters, opaque pagination, and visible backfill coverage.
- Headlines provides a ranked briefing, outlet comparison matrix, multi-source provenance, and a chronological coverage timeline. Timeline labels are deterministic title classification, not an editorial guarantee that a publisher issued a formal correction.
- Reader and Scroll support notes and quoted highlights. Text-quote locators retain prefix/suffix context so a saved highlight can be found after reopening the article.
- Up to 100 explicit article editions can be downloaded to user-scoped IndexedDB on one device. The shell and built assets use the service-worker shell cache; API responses are never placed in the shared cache.
- Account data can be exported/imported in `daylight.feed-export/v1`, including preferences, source tuning, checkpoints, canonical state, annotations, and normalized history metadata.
- Keyboard-accessible state actions and non-gesture alternatives are required for every primary workflow.

## Paper newsstand

`__app_modules/media/feed/browser/Paper/` reads the newsreporter API (`/api/v1/newsreporter`) and nothing in the Feed's own API.

- **Which paper:** the enabled reporters with `kind: edition` from `GET /api/v1/newsreporter`. None shows "No paper is configured". With several, a picker sets `?paper=<id>`.
- **Today** (`/feed/paper`): the stored PNG from `GET /:id/editions/:date/image.png` at paper width (576 CSS px, one per printer dot), scaled down on phones. It sits on a white sheet with black ink in every reading theme, because that is the medium. Under it: a `role="status"` line ("Printed 08:11 · office", "Composed 05:31 · not printed", "No edition yet"), an inputs line ("214 headlines · 14 stories · missing: strava") and the edition's stories as links that open in a new tab.
- **Actions:** Print posts `deliver {force: true}`; Print to… picks from `GET /:id/printers` and posts `{printer, force: true}`; Recompose posts `compose {}`; Preview posts `compose {dryRun: true}` and shows the returned base64 PNG in place with Keep (a real compose) and Discard. Every action disables all four buttons while it runs and shows elapsed seconds; composing takes 30 to 90 s. Deliver outcomes (`printed`, `already_delivered`, `expired`, `composed_then_printed`, `print_failed`) become plain-words notifications.
- **Back issues:** the last 30 from `GET /:id/editions?limit=30` (date, number, lead headline, status, cost). Each is a link to `/feed/paper/:date`; there the actions carry `date` and Print reads Reprint.
- **Logging:** the `feed-paper` child logger: `paper.view`, `paper.action.{start,complete,error}`, `paper.preview.{keep,discard,no_image}`, `paper.image.error`, `paper.empty`.

The mode tabs are one rail (`.feed-tabs__modes`) that scrolls sideways at phone widths and keeps the current tab in view, so four tabs and the unread badge never push the controls onto a second row.

## Verification and remaining scope

The implementation closure and requirement-by-requirement status live in the 2026-08-24 product audit (ops:docs/_wip/audits/2026-08-24-feed-app-product-ux-audit.md). Automated tests cover state, workspace migration, mutation replay, annotations, export/import, briefing/timeline construction, navigation, list windowing, and the API surface. Deterministic Chromium acceptance covers phone Reader/Scroll, desktop Headlines, a 500-item bounded Scroll render, and cold-link IndexedDB recovery. Target-display TV acceptance and field performance budgets remain operational gates rather than claims made by unit tests.

## Deliberate limits

- Offline editions contain the item and currently available readable detail, not a guaranteed archive of every remote image/video. Cached notes remain readable and note/create/edit/delete plus read/save/archive changes queue in user-scoped browser storage for ordered replay.
- Checkpoints restore Reader and Scroll mode position; they are not per-paragraph reading-percentage synchronization.
- Portable export is a Feed workspace backup, not OPML subscription management and not a full copyrighted article archive.
- Source tuning currently supports `more`, `less`, `mute`, and reset for top-level Scroll sources. Topic-level controls and a separate subscription/follow model remain distinct future work.
- Briefing timelines show harvested reports in time order and flag titles containing update/correction language. Daylight does not infer unannounced corrections or retain publisher page revisions.
- Summaries remain source-provided and extractive. AI-generated summaries are intentionally absent until provenance, privacy, configuration, and failure contracts are specified.
