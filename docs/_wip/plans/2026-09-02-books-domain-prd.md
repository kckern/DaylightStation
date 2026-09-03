# Books — a domain for real, physical books

**Status:** draft PRD, pre-brainstorm
**Date:** 2026-09-02
**Author:** KC + Claude
**Related:** `docs/reference/school/README.md`, `docs/reference/nutrition/README.md`

---

## 1. Summary

A new `books` domain that answers one question well:

> Given an identifier a child can read off the back of a book, what book is this?

Identifiers are ISBN-10/13 and library record numbers (KCLS BiblioCommons `S82C1482387`,
OpenLibrary `OL15626917W`). The domain resolves them to a canonical book record —
cover, title, author, description, page count, subjects — through pluggable library
adapters.

School is the **first consumer, not the owner**. A `book-log` shelf lets a learner
self-report the books they are reading off-screen: type or scan an identifier once, then
say what page you're on and, eventually, that you finished. There is **no obligation and
no target** — it is a log, not an assignment. Reflections (voice or typed) are optional.
Later phases add ratings, full-text search, and generated comprehension quizzes.

**The domain must be usable with School deleted.** Nothing under `2_domains/books/` or
`3_applications/books/` may import from `#domains/school` or `#apps/school`. The
dependency runs one way only.

---

## 2. Why now / what exists

School already has a reading obligation, and it has the wrong shape for physical books.

`story-time` (`2_domains/school/storyTime.mjs`) is a daily count-against-target program
with **no course behind it**. A read is recorded by `RecordStoryRead` into
`IReadingLogStore`, sharded by study day, idempotent on `pickId`. It works — but every
read must originate from a *reading session at the living-room TV*
(`ReadingSessionService`), picking from screen-resident content. Its row shape is
`{learnerId, studyDay, at, contentId, title, tagUid, location, pickId}`: `contentId` is a
media id, and `title` is a free string. There is nowhere to put an ISBN, an author, or a
cover, and no notion of a book spanning many days.

So a child who reads a paper book from the library has no way to say so.

The closest existing pattern is **Nutrition**: scan a barcode → `NutritionixAdapter`
enriches it → a log row. Books is the same shape with a different corpus, and the house
already owns a BLE barcode scanner (the kitchen ATOM relay, DS2278) that reads
EAN-13 — which is what an ISBN barcode is.

**Reusable seams already in the tree:**

| Need | Existing thing |
|---|---|
| External HTTP adapter behind a port | `1_adapters/reference/WikipediaAdapter.mjs` + `IEncyclopediaGateway` |
| Program plug-in contract | `3_applications/school/ports/IProgramLauncher.mjs` |
| Enrollment validation registry | `SchoolProgramEnrollmentValidators.mjs` |
| Durable per-learner evidence | `IReadingLogStore`, `RecordLearningReflection` |
| Identified learner surface | `School/selfService/LaunchCard.jsx` + `Keypad.jsx` |
| Voice capture UI | `frontend/src/modules/VoiceCapture/` (`useMediaRecorderCapture`) |
| Voice memo model | `frontend/src/hooks/fitness/VoiceMemoManager.js` |
| Transcription | `3_applications/common/ports/ITranscriptionService.mjs` |
| Barcode input | `2_domains/barcode/`, kitchen ATOM BLE scanner |

---

## 3. External source survey (probed 2026-09-02 from the laptop)

Everything in this table was **measured today**, not recalled. Anything inferred is
marked as such.

### OpenLibrary — the spine. MEASURED.

| Endpoint | Result |
|---|---|
| `GET /api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data` | **200.** Title, authors, page count, publishers, publish date, subjects, `identifiers.{isbn_10,lccn,oclc,openlibrary}`, LC classifications. **One call, everything the card needs.** |
| `GET /works/<OLID>.json` | **200.** Description, subjects, revision metadata. |
| `GET /isbn/<isbn>.json` | **302** → `/books/OL…M.json`. Must follow redirects; a client that does not will read this as a failure. |
| `GET /search.json?q=…&fields=…` | **200.** Also returns `ia[]` (Internet Archive ids) and `ebook_access` — the hook for full text. |
| `https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg` | **200**, `image/jpeg`, ~69 KB. |
| `GET /works/<OLID>/ratings.json` | **200.** `{summary:{average,count}, counts:{1..5}}` |
| `GET /works/<OLID>/bookshelves.json` | **200.** `{want_to_read, currently_reading, already_read, stopped_reading}` |

**No API key. No auth.** Rate limits were **not** measured — assume they exist, cache
aggressively, and set a descriptive User-Agent (OpenLibrary asks for one).

### KCLS / BiblioCommons — record-ID → ISBN. MEASURED, but a scrape.

- `GET https://kcls.bibliocommons.com/v2/record/S82C1482387` → **200**, ~600 KB HTML.
- The full bib record is **server-rendered into the page** as a JSON blob (~offset 211 k):
  `{"metadataId":"S82C1482387","format":"EBOOK","title":"Dr. Seuss's ABC","publicationDate":"2013","description":"Arguably the most entertaining alphabet book ever written…","isbns":["9780385372060","038537206X"], …}` plus authors with `relationships` and `searchQuery`.
- The page advertises an SPA gateway at `https://gateway.bibliocommons.com/v2`, but every
  bib path tried (`/v2/bibs/<id>`, `/v2/libraries/kcls/bibs/<id>`, with and without
  `locale`, with a `Referer`) returned **404 `{"error":{"message":"Not found"}}`**. There
  is no public documented JSON API we found. **Inferred:** the real gateway paths exist
  but are undocumented and probably auth- or origin-scoped.

**Design consequence — this is the important one.** A BiblioCommons record gives us
title, description, format and **ISBNs**. So the library adapter's job is *not* to be a
metadata source. It is to **resolve a library record ID to an ISBN**, after which
OpenLibrary supplies canonical metadata. That keeps the brittle HTML scrape on the
smallest possible surface (one field), and makes adding a second library system
(Seattle, Sno-Isle — all BiblioCommons tenants, same page shape, different subdomain)
a config line rather than a new integration.

### Goodreads / Amazon — the "bonus". MEASURED, and recommended OUT of v1.

- `api.goodreads.com` → **401.** The public API was retired; there is no key to get.
- `goodreads.com/search?q=<isbn>` → **200**, `ratingValue: 4.21` present in the HTML.
- `amazon.com/dp/<isbn10>` → **200** from a residential IP today.

Both are scrapes of sites whose ToS forbid it, both are IP-reputation-sensitive, and both
will break without notice. **OpenLibrary's own `ratings.json` and `bookshelves.json`
give us a star average, a rating histogram, and "how many people finished it" from a
documented, licensed, keyless endpoint.** That covers the actual product need — "is this
book any good, and do people finish it" — with none of the exposure.

Recommendation: ship OpenLibrary ratings in v1. Keep `IBookRatingsGateway` as a port so a
Goodreads adapter *can* be dropped in later, behind an explicitly off-by-default config
flag, if the OpenLibrary signal proves too thin for a household of readers.

### Full text — PARTIALLY VERIFIED. Do not commit to a date.

- `GET /search/inside.json?q="Some Pig"` → **200**, real hits with aggregations.
  **But this is a corpus-wide search across all of Internet Archive**, not a search
  within one book.
- Scoping to a single IA item was **NOT verified** — two candidate endpoints
  (`ia-fts.archive.org/api/v1/search/hits?ids=…`, `api.archivelab.org/books/…/searchinside`)
  both returned connection failures (`http=000`) from this machine. Unknown whether that
  is DNS, the network, or a dead endpoint.
- `search.json` does return `ia[]` and `ebook_access` per work, so the *linkage* from
  book → IA item exists and is measured.

**Consequence:** full-text search, and therefore any quiz generated from full text, is a
research spike — not a scheduled phase. Phase 4 below is written as a spike with an exit
criterion, not a deliverable.

---

## 4. Users and jobs

| User | Job |
|---|---|
| A learner (reader, 6–14) | "I finished this book. Log it, show me the cover so I know it's the right one, and let me say what I thought." |
| A learner (pre-reader) | "Scan the barcode for me." |
| A grown-up | "Assign a reading obligation. See what was actually read this month, and what they said about it." |
| Future: the house | "Make a comprehension quiz from a book we have the text for." |

**Non-users:** this is not a library catalogue browser, not a holds/checkout manager, and
not a replacement for `story-time`. The two coexist: story-time is *today's screen
reading*, book-log is *books finished over time*.

---

## 5. Product requirements

### 5.1 Book identity (v1, must)

- **B1.** Accept and normalise: ISBN-13, ISBN-10 (with checksum validation and ISBN-10→13
  conversion), bare EAN-13 from a barcode scan, KCLS/BiblioCommons record IDs
  (`S82C…`, and the `/v2/record/<id>` URL pasted whole), OpenLibrary work (`OL…W`) and
  edition (`OL…M`) keys, and OpenLibrary URLs pasted whole.
- **B2.** A malformed identifier is rejected **at the domain boundary with a specific
  message** ("that's 12 digits — an ISBN has 10 or 13"), never sent to a network call.
  A mistyped digit that *passes* checksum but matches nothing returns "no book found",
  which is a different outcome from "the lookup failed" and must render differently.
- **B3.** The canonical key is **ISBN-13 where one exists**, falling back to the
  OpenLibrary work key. Every alternate identifier seen for a book is stored alongside it,
  so the same book logged by ISBN in March and by library record in June is **one book**.
- **B4.** Work-vs-edition: a log entry records the *edition* the child held, but
  aggregation ("has anyone read Charlotte's Web?") happens at the *work* level.

### 5.2 Lookup (v1, must)

- **B5.** `GET /api/v1/books/resolve?id=<anything from B1>` returns a `BookRecord`:
  `{bookId, isbn13, isbn10[], olWorkKey, olEditionKey, title, subtitle, authors[],
  publishedYear, publisher, pageCount, description, subjects[], coverUrl, format,
  sources[], resolvedAt}`.
- **B6.** Resolution is a **chain, not a single source**: normalise → (if library record
  ID) library adapter for the ISBN → OpenLibrary `/api/books` for edition metadata →
  **OpenLibrary work record for the description** → cover. Each step is independently
  failable and the record says which sources answered (`sources[]`).

  The work fetch is **required, not an optimisation**: `/api/books?jscmd=data` returns no
  `description` field at all, for either *Narnia* or *Guys from Space* (measured). A
  single-call implementation renders every book with a blank description.
- **B7.** A partial record is a **success**, not a failure. A book with no cover and no
  description still renders — the child typed a real ISBN and deserves to see the title.
  Only "no identifier matched anywhere" is a miss.
- **B8.** **Every resolved record is cached durably**, keyed by canonical id, with the raw
  source payloads retained. Two reasons: household reading repeats heavily (siblings, re-reads),
  and it means an OpenLibrary outage does not stop a child from logging a book the house
  has seen before. Cache is a repository, not a TTL cache — records are refreshed on
  demand, never expired out from under a log entry.
- **B9.** **THERE IS NO SEARCH BAR ON THE CHILD SURFACE. DECIDED 2026-09-02.** A child
  never browses for a book; they identify the object in their hands. The identifier is
  printed on the thing itself, and lookup is a direct read of it — one number in, one book
  out, no result list, no ambiguity, no picking the wrong edition, and no way to log a book
  you are not holding.

  This is a product decision, not a simplification: a search box turns "log what you read"
  into "shop for a title", which is a different activity with a different failure mode.

  `SearchBooks` therefore exists **only** for grown-up assignment authoring (A9), behind
  the teacher gate, and is not reachable from a learner surface. A child who cannot get a
  number to resolve is helped by §5.2b, not by a search field.

- **B14. Design for a 500 px cover and never upscale.** Measured: *Narnia* returns ~69 KB
  at `-L`, but *Guys from Space* — a midlist picture book — returns **500 × 398 px**, and
  that is the realistic ceiling for most of what a young child reads. Cover resolution is a
  property of the book, not of the source, so no provider swap improves it. The confirm
  card and the shelf must look deliberate at that size; a layout tuned to a large cover
  will look broken for the majority of the shelf. A book with **no** cover gets the calm
  placeholder the school launch card already uses, never an invented one.

### 5.2b The two barcodes on a library book (v1, must)

A library book carries **two** machine-readable numbers, and a child will scan whichever
one faces them:

1. The publisher's **ISBN EAN-13** on the back cover — 978/979, canonical, resolves
   everywhere.
2. The library's own **item barcode sticker** — the library's copy-level identifier, which
   is not an ISBN and means nothing to OpenLibrary.

**B10. The system can always tell them apart, for free.** `ScanCode.isIsbn13` is an exact
shape test — 13 digits starting 978/979. A library sticker fails it and comes back
`namespace: null, form: 'unknown'` (measured, appendix). So a scan that is not a book is
*known* not to be a book, immediately, with no lookup attempted.

**B11. An unresolvable sticker gets an instruction, not an error.** *"That's the library's
sticker. Flip the book over and scan the barcode on the back."* This is the answer that
replaces the search bar for the common failure, and it needs no library integration at
all. A child holding the book is ten seconds from the right barcode.

**B12. Library-record resolution is a bonus path, and its feasibility is UNVERIFIED.**

Measured 2026-09-02:

- **ISBN → KCLS record works.** `v2/search?query=9780385372060&searchType=smart` (also
  `keyword`) returns 200 and the record id `S82C1482387`. `searchType=anywhere` and
  `identifier` both 500 — use `smart`.
- **KCLS record → ISBN works** (§3): the bib JSON is server-rendered into the record page.

**Not measured, and NOT assumable:** whether BiblioCommons resolves an *item barcode*
(the sticker) to a bib record at all. I have no KCLS book in hand, and a made-up barcode
cannot distinguish "not indexed" from "no such item". **Inferred, stated as inference:**
BiblioCommons is a discovery layer over an ILS, and public discovery search normally
indexes bib-level identifiers (ISBN, OCLC, title, author) rather than copy-level item
barcodes — so this may well be impossible. Do not build against it until it is checked.

**The one-command check, with a library book in hand:**

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
curl -s -L -A "$UA" "https://kcls.bibliocommons.com/v2/search?query=<STICKER_DIGITS>&searchType=smart" \
  | grep -oE 'S[0-9]+C[0-9]+' | sort -u | head
```

A record id printed means the sticker path is real and worth an adapter method. Nothing
printed means B11 is the whole answer, and that is a perfectly good outcome — the ladder
degrades to "flip it over", which always works.

**B13. Order of resolution is cheapest-first and never guesses.** ISBN-13 shape → resolve
directly. Anything else → *if* B12 proves out, try the library adapter; otherwise B11's
instruction. A number that resolves to nothing is never reinterpreted as a title.

### 5.3 The School reading shelf (v1, must)

**DECIDED 2026-09-02: the shelf is obligation-blind, and obligations are a separate layer
on top of it (§5.3b).**

The log records what was read. It does not know whether anything was owed. That
separation is the point of the whole design:

- A child with **no enrollment** gets the full shelf — look a book up, log pages, finish
  it, reflect on it. Nothing is greyed out and nothing nags.
- A child **with** an enrollment gets **the same shelf, with the same interactions**, plus
  a progress hint and a row on the agenda.
- Changing, adding or removing an obligation **never migrates, rewrites or invalidates a
  single log entry**, because no log entry ever referred to one.

Nothing below this line in §5.3 knows what an obligation is. That is deliberate and it is
the invariant to protect in review: an import of the assignment layer from the shelf, or a
`programId` on a progress event, is the mistake this section exists to prevent.

**The log is an append-only stream of progress events, not a row with a status column.**

- **S4.** A **shelf item** is `(learnerId, bookId)` — this child, this book, opened once.
  It holds no state of its own beyond when it was opened.
- **S5.** A **progress event** is appended to that item: `{entryId, at, kind, page?,
  note?, rating?}` where `kind` is `started` | `progress` | `finished` | `set-aside`.
  Current state is **derived from the last event**, never stored separately — the same
  discipline `ReadingSessionService` applies to its assignment/browsing mode, and for the
  same reason: derived state cannot go stale.
- **S6.** **DECIDED 2026-09-02.** Progress is one number, and the *kind* of number is a
  property of the book, not of the app. A shelf item carries a **`progressMode`**:

  | Mode | The child enters | The shelf draws | Suits |
  |---|---|---|---|
  | `page` | the page they're on | a bar against `number_of_pages` | novels, chapter books — the default |
  | `minutes` | how long they read today | a running total ("3h 20m so far") | audiobooks, ebooks with no fixed pagination |
  | `check` | nothing — one tap | a count of days touched | reference books, poetry, devotionals, anything dipped into |

  A page number is the default because it is the thing a child already knows and because
  OpenLibrary hands us `number_of_pages` (measured, §3), so one number becomes a bar with
  no further input. But a dictionary has no page you are "on", and forcing one would make
  the app wrong about the book in a way a child can see.

  ```
  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
  │  ▓▓▓▓▓▓▓▓▓░░░░░░░░  84 / 184    │   │  [cover]  Field Guide to Birds  │
  │  [cover]  Charlotte's Web       │   │           read on 12 days       │
  │           E. B. White           │   │                                 │
  │                                 │   │   ┌───────────────────────┐     │
  │   What page are you on?         │   │   │  I read some today    │     │
  │        ┌───────┐                │   │   └───────────────────────┘     │
  │        │  84   │                │   │                                 │
  │        └───────┘                │   │   [ I'm done with it ]          │
  │   [ Save ]  [ I finished it ]   │   │                                 │
  └─────────────────────────────────┘   └─────────────────────────────────┘
              page                                   check
  ```

  Rejected: a percent slider (vaguer than a page, and fiddlier than a number pad), and
  page-plus-minutes-every-time (two inputs on every update, and time-on-task starts to
  smell like the obligation we just ruled out — `minutes` earns its place as a *mode* for
  books that have no pages, not as a second field on every book).

- **S6a.** The mode is **inferred once at open time and always overridable**: `page` when
  the resolved record has a page count, `check` when it does not. `minutes` is never
  inferred — nothing in the metadata reliably says "this is an audiobook" — so it is
  reached by the child or a grown-up switching to it.
- **S6b.** Switching modes is **one tap on the card** ("this book doesn't have pages"),
  not a settings screen. A child discovers the wrong mode at the moment they are trying
  to log, and that is the only moment they will ever fix it.
- **S6c.** Switching modes **never rewrites history**. Past events keep the shape they
  were written in; the shelf renders whatever each event actually holds. A book logged by
  page for 80 pages and then switched to `check` shows both, in order, rather than
  pretending the pages were never read.

- **S7.** The number is optional in every mode, and the UI must not imply otherwise. A
  child who does not know still records a bare `progress` event meaning "worked on this
  today" — the card drops the bar and keeps the buttons. A signal with no number is still
  a signal, and `check` is just the mode where that is the *only* signal.
- **S7a.** A page beyond the known page count is **accepted, not rejected**. Editions
  differ and OpenLibrary's count is for one of them; refusing "212 of 184" would tell a
  child holding the book that they are wrong when they are not. Clamp the bar at full,
  store the number as given.
- **S8.** `set-aside` is a first-class outcome, not a failure. Abandoning a book is a real
  reading decision and the shelf should let a child make it cleanly rather than leaving
  a book "in progress" forever.
- **S9.** Re-reads: a second `started` on an item that already `finished` opens a **new
  shelf item** for the same book. Two reads of *Charlotte's Web* are two reads.

**Entry flow — and the identity problem**

**DECIDED 2026-09-02: the launch card is the primary path, because it is the only one
that knows who is holding the book.** A barcode scan is anonymous. It carries a reader
and a payload and nothing else — a scanner has no idea which of four children pressed
the trigger. The launch card already solves this: a panel code opens a **user-scoped**
session, and everything done inside it belongs to that learner. So the ISBN is entered
*inside* an identified session, not before one.

- **S10.** **Primary — identified entry.** Learner opens their launch card, taps
  "Add a book", and types or scans an identifier → the cover, title, author and
  description appear → "Is this your book?" → confirm → it joins their shelf with a
  `started` event. A child logging something already finished can go straight to
  `finished`.
- **S11.** **Confirmation is mandatory before any write.** The reason to show the cover
  is so a child catches a wrong digit. A resolve must never auto-log.
- **S12.** Once a book is on the shelf, **updating progress never touches an identifier
  again** — the child taps their book and types a page. Identifier entry happens once per
  book, ever. That is what makes typing thirteen digits acceptable at all.
- **S13.** A reflection (voice memo, typed note, star rating) may be attached to any
  event, and is prompted — optionally, never blocking — on `finished`. A book read is a
  book read.

**S14. Attribution has exactly three tiers, and the third is not "guess".**

| Tier | Situation | What happens |
|---|---|---|
| 1 | A launch-card session is open at that surface | The scan lands on that learner immediately. This is the good path and the one to design for |
| 2 | No session open | The scan becomes an **unclaimed book**, held against the reader, claimed later by a learner from their own shelf |
| 3 | — | **Never infer the learner from the reader's location alone.** A book scanned in the living room is not evidence about which child scanned it |

Tier 1 is the same answer `ReadingSessionService` already gives for the living-room TV —
*"whose screen is this?"* — with the same last-tap-wins rule. Reusing that model rather
than inventing a second notion of "who is at this reader" is deliberate.

Tier 3 is a rule, not an oversight. The equivalent guess in Fitness (a passing heart-rate
strap glued an outdoor run to a garage session) is the reason the venue/presence guards
exist. A book credited to the wrong child is a smaller harm and exactly the same mistake.

**S15. Unclaimed books are a first-class object, not an error state.**
**DECIDED 2026-09-02: any learner claims them from their own shelf.**

- **S15a.** The scan is **acknowledged at the reader** — the cover on screen, a beep. A
  scanner that appears to do nothing is indistinguishable from a broken scanner; that is
  already `ScanDispatcher`'s stated invariant and it holds here.
- **S15b.** The book is **resolved immediately** — that needs no identity — and parked
  with its cover, its reader and its scan time. Claiming later is then recognising a
  picture, not reconstructing a number.
- **S15c.** Unclaimed books appear **at the top of every learner's shelf**: *"Someone
  scanned these — is one of them yours?"* with `[That's mine]` and `[Not me]`.
- **S15d.** **Claiming stamps the ORIGINAL scan time, not the claim time.** A book scanned
  Tuesday and claimed Thursday started on Tuesday. The scan is the evidence; the claim is
  only the attribution catching up.
- **S15e.** **First claim wins.** A claimed book leaves every other learner's tray at
  once. Two children who both read it will have scanned it twice, which is two entries —
  correct, and not this mechanism's problem to solve.
- **S15f.** **`Not me` is per-learner, never global.** It hides the card for that child
  only. A global dismissal would let one sibling delete another's book from a surface the
  owner had not looked at yet, and nothing anywhere would report it.
- **S15g.** **A wrong claim is one tap to undo**, and undoing returns the book to the tray
  rather than deleting it. This is a household log with no stakes; the cost of a mistaken
  claim must be lower than the cost of hesitating over one.
- **S15h.** **Unclaimed books expire — default 7 days, in `books.yml`.** A tray that only
  grows becomes noise nobody reads, and at that point the scanner has stopped working with
  nothing to say so. Expiry emits a real event (`books.unclaimed.expired`) rather than
  disappearing from a sweep, so the logs can answer "are scans going unclaimed?" — which is the question that
  tells us whether the anonymous path was worth building at all.

**S16. The scan ingress already exists. MEASURED 2026-09-02.**

`parseScanCode('9780064400558')` returns `{namespace: 'book', body: '9780064400558',
form: 'shape'}` today — `ScanCode.mjs` carries `ISBN13_PREFIXES = ['978','979']`, an
`isIsbn13` shape test, and `book` in `NAMESPACES`. Its docstring already reasons about
"the book log" as a real destination. **What is missing is only a handler registered
against that namespace in `ScanDispatcher`**, which is the cheapest possible seam.

Two measured details that shape the work:

- The shape test is strict and correct: exactly 13 digits, `startsWith` 978/979. A
  grocery EAN containing `978` mid-string (`1234978123456`) returns `unknown`, not `book`.
- **A bare ISBN-10 (`0064400557`) returns `unknown`**, so it is not claimed by the scanner
  path. This is fine in practice — the EAN barcode printed on a book is always the
  978/979 ISBN-13 — but it means ISBN-10 support (B1) matters for *typed* entry, where a
  child reads the number off a copyright page.

**Storage**

- **S14.** `IBookLogStore` under `school/records/`, never pruned, sharded per learner.
  Idempotent on `entryId` for the same reason `IReadingLogStore` is idempotent on
  `pickId`: a retried POST must not append a second "finished".
- **S15.** A grown-up view: each learner's shelf — read, reading, set aside — with covers,
  dates and reflections. This is the artefact that makes the whole thing worth building:
  a bookshelf of what a child actually read this year.

### 5.3b Reading assignments — the obligation layer (v1, must)

**DECIDED 2026-09-02: obligations come back, as a declarative grammar over the log.**
A grown-up must be able to express all of these without new code:

> read 20 pages a day · read 2 books a week · check in every day with your reading ·
> read *this* book · read *this* series

**A1. One program, one small grammar.** A `reading` program whose enrollment carries an
`obligation` block. Four metrics, a quantity, a window, an optional scope:

```yaml
programId: reading
subject: english
obligation:
  metric:   pages | minutes | books | checkins
  quantity: 20
  per:      day | week | month | once
  scope:                                  # optional; omitted = any book
    books: [<bookId>, ...]                # an explicit set
    label: "The Chronicles of Narnia"     # what the child is told they're doing
schedule:                                 # EXISTING, generic — see A2
  daysOfWeek: [1, 2, 3, 4, 5]
```

The five asks map onto it with nothing left over:

| The ask | The enrollment |
|---|---|
| 20 pages a day | `{metric: pages, quantity: 20, per: day}` |
| 2 books a week | `{metric: books, quantity: 2, per: week}` |
| Check in daily | `{metric: checkins, quantity: 1, per: day}` |
| Read *this* book | `{metric: books, quantity: 1, per: once, scope: {books: [id]}}` |
| Read *this* series | `{metric: books, quantity: 7, per: once, scope: {books: [7 ids], label: …}}` |

**A2. `schedule` is NOT reinvented.** Every enrollment already passes through
`withSchedule` → `validateSchedule` (`schoolCalendar.mjs`), which owns `daysOfWeek`,
`except` and `also`. "20 pages a day, weekdays only" is an obligation **plus** the
existing schedule. The obligation says *how much*; the schedule says *which days count*.
Duplicating that here would give a household two places to excuse a Saturday and one of
them would lose.

**A3. Every metric is a pure function over the log.** Nothing is precomputed or stored
alongside the enrollment, so an obligation edited today reads correctly against reading
done last week:

| Metric | Derivation | Contributing books |
|---|---|---|
| `pages` | per book, `max(page in window) − last page before window`, clamped at ≥ 0, summed | `page` mode only |
| `minutes` | sum of `minutes` on events in the window | `minutes` mode only |
| `books` | count of `finished` events in the window, within scope | any mode |
| `checkins` | count of distinct study days holding ≥ 1 progress event | **any mode** |

The clamp matters: a child who re-reads a chapter moves their page backwards, and a
negative day would cancel out a real day's reading elsewhere in the sum, with nothing to
show for it.

**A4. Metric/mode mismatch is always surfaced.** A `pages` obligation and a
`check`-mode reference book cannot meet each other. Two rules:

- The enrollment validator **warns at write time** when a scoped book cannot satisfy the
  metric (a `pages` target scoped to a book with no page count is a config mistake that
  would otherwise present as a child who "never reads").
- The shelf says so **on the card** — *"this one doesn't count toward your pages"* —
  rather than counting nothing and explaining nothing.
- `checkins` is mode-agnostic and is therefore the recommended default for young readers
  and for anyone whose shelf is mostly reference books.

**A5. `once` means cumulative since the enrollment began**, not "today". `per: once` is
also the only window under which the program can be **terminal** — a finished series
leaves the agenda, exactly as a `cadence: 'once'` program does. Daily and weekly
obligations are never terminal; tomorrow they ask again, as `story-time` does.

**A6. `doneToday` for a non-daily window means "nothing owed today".** A 2-books-a-week
obligation reports done once the week's quota is met, and the launcher carries the real
picture in `obligationProgress` — the field `IProgramLauncher`'s status shape already
defines. A weekly target that read as unmet on six days out of seven would put a
permanent red tile on the board for a child who is on track.

**A7. Not enrolled, enrolled, and unreadable are three distinguishable answers** — the
same three `StoryTimeProgramLauncher.status()` is careful to separate, for the same
reason. An unreadable log is `error: true`, never a zero: a false zero shows a child who
read four books as owing four books.

**A8. Scope is an explicit list of books. MEASURED 2026-09-02 — series metadata will not
carry it.** `/api/books?jscmd=data` returns **no `series` field at all**. The edition
record (`/isbn/<isbn>.json`, after the 302) does, but as a raw MARC string with
cataloguer punctuation — `series: ['The Chronicles of Narnia -- bk. 2']`. Two editions of
one series will not spell that the same way, so it cannot be an obligation's scope key.

It is still useful as an **authoring hint**: when a grown-up scopes an assignment to a
book, offer *"this looks like The Chronicles of Narnia, bk. 2 — add the others?"* and let
them confirm a set. A curated list is also simply better — it lets an assignment be
"these four, in any order" or "the three we own", which no series field could express.

**A9. Assigning uses the same lookup as a child's.** A grown-up scoping an assignment
resolves books through the identical `ResolveBook` path and confirm card. One lookup
surface, two callers.

**A10. The obligation layer is where the launcher lives** — `BookLogProgramLauncher`
implementing `IProgramLauncher`, registered in `createSchoolProgramEnrollmentValidators`.
It reads the shelf through the same store the shelf writes, and the shelf gains no
knowledge of it. That is the whole architecture in one sentence.

### 5.4 Voice reflection (v1, should)

- **V1.** Reuse `VoiceCaptureOverlay` / `useMediaRecorderCapture`. Do not write a second
  recorder.
- **V2.** Audio is stored; transcription runs through `ITranscriptionService` and is
  **best-effort** — a failed transcription leaves the audio intact and the entry valid.
  The memo is the evidence; the transcript is a convenience.
- **V3.** Transcripts feed `RecordLearningReflection`'s evidence ledger so book
  reflections show up in the same instructional-insight surfaces as everything else.
- **V4.** Browser autoplay/mic-gesture constraints apply wherever this runs. Recording
  needs a user gesture — that is satisfied by the child pressing a button, but any
  *auto*-prompt design must account for it.

### 5.5 Ratings (v1, should)

- **R1.** `IBookRatingsGateway`, implemented by OpenLibrary (`ratings.json`,
  `bookshelves.json`). Shown as context on the confirm card — "4.0 from 131 readers".
- **R2.** A learner's own star rating is stored on the log entry and is **never** mixed
  with the external one.
- **R3.** Goodreads/Amazon adapters: port exists, no implementation in v1. See §3.

### 5.6 Quizzes without full text (phase 4) — and where the source of truth lives

**DECIDED 2026-09-02: a quiz does not need the book's text.** Public metadata already
carries enough to write real plot questions, and all of it is keyless, offline-capable and
free of ToS exposure.

**Q1. What is actually available. MEASURED 2026-09-02** (*The Lion, the Witch and the
Wardrobe*, ISBN 9780064471046, via one keyless `/api/books?jscmd=data` call):

| Field | Content |
|---|---|
| `subject_people` | Aslan, Lucy Pevensie, Susan Pevensie, Edmund Pevensie, Peter Pevensie, Jadis the White Witch, Mr. Beaver, Mrs. Beaver, Giant Rumblebuffin, Father Christmas, Maugrim, Mr. Tumnus |
| `subject_places` | England, Narnia, London, Cair Paravel, Stone Table |
| `subject_times` | 1940, 1941 |
| `excerpts` | `{"text": "Once ther were four children whose names were Peter, Susan, Edmund and Lucy.", "comment": "first sentence"}` |
| `links` | the book's Wikipedia article |
| `description` | publisher blurb |

That character list is exactly the "Common Knowledge" data LibraryThing is prized for, and
OpenLibrary gives it away with no key.

**Q2. The house already owns the plot summaries.** OpenLibrary's `links` point at
Wikipedia, and the household runs an **offline Wikipedia container**. Measured today:

| Book | Article | Plot section |
|---|---|---|
| The Lion, the Witch and the Wardrobe | 31,734 chars | yes |
| The Wild Robot | 19,447 chars | yes |
| Because of Winn-Dixie | 9,746 chars | yes |
| Hatchet | 4,816 chars | yes |
| Frog and Toad Are Friends | 4,711 chars | **no** |

So the chain is: **ISBN → OpenLibrary (characters, places, excerpts, Wikipedia link) →
local Wikipedia (plot) → quiz.** Entirely offline after the metadata fetch, no API key,
nothing scraped, and it reuses `WikipediaAdapter` and the `wikipedia` service already
wired into the app.

**Q3. Say plainly what such a quiz measures.** It tests *"do you know this story"* — not
*"did you read this book"*. A child who watched the film or read the blurb can pass it.
Two consequences, both non-negotiable:

- A generated quiz is **never** evidence of reading, and must not gate a `finished` event
  or satisfy an obligation on its own. The reading log stays the record; the quiz is a
  conversation-starter.
- Questions must be built from **plot specifics and character relations** (who betrays
  their siblings; who is Maugrim), never from the description alone. A back-cover blurb
  quiz is passed by reading the back cover, which is precisely what a child who skipped
  the book would do.

**Q4. Coverage is the real limit, and it is uneven.** Famous books are well served;
early readers and the midlist long tail are not (*Frog and Toad* has an article with no
plot section). The rule: **no plot source, no quiz.** Generating one anyway from
description and subjects would produce a plausible, unanswerable test — the worst
possible artefact to put in front of a child.

**Q5. Grown-up approval still stands.** A generated quiz is a draft that a grown-up
approves before it can be assigned. Nothing auto-assigns a machine-written test.

**Q6. Full text stays a spike, and is now optional rather than blocking.** If per-book
search-inside proves reachable (§3 — unverified), it upgrades question quality. It is no
longer on the critical path for having quizzes at all.

#### Q6a. A worked long-tail example — *Guys from Space*. MEASURED 2026-09-02.

A book a child in this house is reading right now: Daniel Pinkwater, *Guys from Space*
(1989), ISBN 9780027746723 — a 32-page picture book, exactly the midlist case that decides
whether any of this survives contact.

| Field | Result |
|---|---|
| Resolves | **Yes** — title, author, `number_of_pages: 32` |
| Description | **Yes** — *"A boy accompanies some guys from space on a visit to another planet, where they discover such incredibly amazing things as talking rocks and root beer with ice cream."* |
| Cover | **500 × 398 px, 23 KB** |
| `subject_people` / `subject_places` | **none** |
| `excerpts` | **none** |
| Wikipedia article | **none** for the book (only for Pinkwater himself) |
| Internet Archive | `guysfromspace00pink_0`, `ebook_access: borrowable` |

Four things this settles:

1. **The core loop is unaffected.** Cover, title, author and a page count are all present,
   so the confirm card renders and the progress bar works. Phase 2 does not depend on any
   of the rich fields.
2. **The quiz path fails here, exactly as Q4 says it should.** No characters, no excerpts,
   no plot article — so **no quiz**, and the rule earns its keep on a real book rather
   than a hypothetical one. Anything generated from that one-sentence description would be
   a test about a sentence.
3. **500 px is the realistic ceiling for a midlist picture book, and that is a property of
   the book, not of the source.** LibraryThing's covers are low-resolution here for the
   same reason OpenLibrary's are. **Design consequence: the confirm card and the shelf must
   look right at ~500 px and must never upscale.** A layout that assumes a large cover will
   look broken for most of what a young child actually reads.
4. **The description came from the WORK record, not from `/api/books?jscmd=data`** — that
   call returned no description at all. So B6's chain must fetch the work record too; a
   single-call implementation would show a blank description for this book and for Narnia
   alike.

And one inversion worth noting: this obscure picture book **is** in Internet Archive
(`borrowable`), while it has no Wikipedia article. For the long tail, full text is the
*more* promising quiz source, not the less — the opposite of the famous-book case. That
raises the value of the §3 search-inside spike rather than lowering it.

#### Q7. LibraryThing — correcting the premise

**LibraryThing cannot be self-hosted.** It is a commercial hosted service with no
open-source edition and no container image; there is nothing to `docker run`. Measured
today, it is also not reachable programmatically from here: both `api/thingISBN/<isbn>`
and the Common Knowledge REST endpoint return **Cloudflare bot-protection challenge
pages**, not data. Its cover service and CK API additionally require a developer key.

The things LibraryThing was wanted for are already covered:

| Wanted from LibraryThing | Where it actually comes from |
|---|---|
| High-resolution cover art | `covers.openlibrary.org/b/isbn/<isbn>-L.jpg` — measured 200, ~69 KB JPEG |
| Quotes from the text | OpenLibrary `excerpts` (measured) |
| Characters, places, setting | OpenLibrary `subject_people` / `subject_places` / `subject_times` (measured) |
| Series membership | Edition record `series`, as a dirty MARC string — see A8; use a curated list |

#### Q8. Should the source of truth live in a third-party app? Recommendation: no.

The self-hostable Goodreads analogue is **BookWyrm**, not LibraryThing. The household
already runs `calibre-web`, `komga` and `audiobookshelf` — all three catalogue **owned
digital files**, none of them a physical library book, and none exposes an
ISBN-lookup-for-arbitrary-books API.

Keeping the source of truth in-house is the recommendation, for reasons specific to this
product rather than a preference for building things:

- The product **is** the School layer — per-learner attribution through the launch card,
  progress events stamped on study days, an obligation grammar read by an agenda,
  evidence that reaches a report card. None of that exists in BookWyrm, so it would all
  have to be built anyway, on the far side of an integration boundary.
- It would mean four children with accounts in a federated social application, which is a
  great deal of surface, moderation and identity for a household shelf.
- The thing worth not building — a book **metadata** database — is already not being
  built. OpenLibrary is that database. The house owns only the log, which is a handful of
  fields per entry.
- The log is plain YAML under `school/records/`, on the same backup and inspection path as
  every other household record, and is exportable to a Goodreads/StoryGraph CSV if it ever
  needs to leave.

#### Q9a. The self-hosted survey — MEASURED 2026-09-02 (GitHub API)

| Project | Stars | Status | What it is |
|---|---|---|---|
| **MyBibliotheca** | 583 | MIT, Python, active (2.2.0, 2026-08-28) | **Self-hosted Goodreads.** Reading tracker: pages + minutes, started/finished/set-aside, multi-user, REST API, Goodreads/StoryGraph import |
| **BookWyrm** | 2,774 | active (2026-09-02) | Federated (ActivityPub) social reading — reviews, shelves, progress, quotes |
| **Kavita** | 11,605 | active (2026-09-02) | Reading *server* for owned files (ebooks/manga) |
| **Calibre-Web** | 18,097 | active — **already running here** | Browse/read owned ebooks in a Calibre library |
| **Komga** | 6,625 | active — **already running here** | Comics/ebooks server |
| **Audiobookshelf** | 14,221 | active — **already running here** | Audiobooks/podcasts |
| **Readarr** | 3,473 | **ARCHIVED** (last push 2025-06-27) | Was "Sonarr for ebooks". Dead — do not adopt |
| LibraryThing | — | **not self-hostable**, Cloudflare-blocked | See Q7 |

The three already running all catalogue **owned digital files**. None tracks a physical
library book. MyBibliotheca is the only one on this list aimed at *reading consumption*
rather than *file management*, which is what was actually being asked for.

#### Q9b. MyBibliotheca in detail — a real candidate, for a different job

**Measured** (repo `pickles4evaaaa/mybibliotheca`, MIT, created 2025-06-11, current
release **2.2.0** on 2026-08-28 — note the linked `v1.1.0` is two majors behind):

- Docker Compose; KuzuDB (a graph database) with a **single-worker constraint**
  (`WORKERS=1` required in production).
- **A real REST API with token auth** (`api_token_required` / `validate_api_token`):
  - Books: `GET|POST /books`, `GET|PUT|DELETE /books/<id>`, `/books/search`,
    `/books/user-search`, **`/books/external-search`**, **`/books/unified-metadata`**
  - Reading logs: `GET|POST /reading_logs`, `POST /reading_logs/check`,
    `DELETE /reading_logs/<id>`
  - Users: `app/api/users.py`
- Multi-user with isolated libraries; ISBN **and** title lookup with automatic metadata and
  cover fetching; Goodreads/StoryGraph CSV import.

**The convergence is remarkable and worth noting**: their feature copy describes books
"started, finished, or set aside", pages *and* listening minutes as first-class, and
"progress that feels encouraging rather than demanding" — independently the same three
states, the same two metrics, and the same no-nag stance this PRD arrived at. That is
good evidence the model in §5.3 is the right one.

**Where it does not fit as the source of truth.** Its reading log is
`{id, book_id, user_id, date, pages_read, minutes_read, notes, created_at, updated_at}`,
and:

1. **`pages_read` is a DELTA, not a position.** Our design is "what page are you on" (S6),
   because that is what a child knows and it is what draws the bar. Theirs is "how many
   pages today". Convertible, but their store could no longer answer the question the UI
   is built on.
2. **`check` mode is impossible.** `create_reading_log` **rejects** an entry where
   `pages_read <= 0 and minutes_read <= 0`. The reference-book case from this brainstorm —
   "just tell me you read some today" — has no truthful representation; it would need a
   fabricated `pages_read: 1`.
3. **None of the obligation layer exists there** — no enrollment, no per-learner target, no
   4am study-day boundary, no agenda. All of §5.3b gets built here regardless.
4. **Identity does not line up.** Their users are accounts; our learners are launch-card
   panel codes. Every child would exist twice, with a mapping to keep in sync.
5. **No unclaimed-scan tray, no voice memos, no evidence-ledger integration.**
6. **Young, and moving fast** — 14 months old, 1.x → 2.2.0 already, an unusual database
   choice, and a hosted instance reporting 34 readers. Schema churn is likely.

**Two things its API gives us that OpenLibrary does not. MEASURED.** The book serializer
returns `id, title, subtitle, asin, authors, publisher, published_date, page_count,
language, description, cover_url, google_books_id, openlibrary_id, categories,
average_rating, rating_count, series, series_volume, series_order`:

1. **Structured series data — `series`, `series_volume`, `series_order`.** This is the
   direct answer to A8, where OpenLibrary could only offer the dirty MARC string
   `'The Chronicles of Narnia -- bk. 2'`. If the household catalogues a series in
   MyBibliotheca, an assignment can be scoped from it with real volume ordering instead of
   a grown-up typing seven ISBNs.
2. **It aggregates Google Books as well as OpenLibrary** (`google_books_id` *and*
   `openlibrary_id`). Google Books carries descriptions for much of the long tail where
   OpenLibrary is thin — the *Guys from Space* case (Q6a) — so this is a credible
   enrichment fallback.

`locations` (a real strength for a household's physical shelves) appears on web routes but
**not** in the token-auth API package, which registers only books, reading logs and users.
Treat it as a UI feature, not an integration point, until checked.

**On MyBibliotheca Cloud:** hosted and free during beta. For a grown-up's own shelf that is
a reasonable way to try it. For the children's reading records it is the wrong call —
that data should stay on household infrastructure, which is the whole reason §5.6 Q8
argues for keeping the source of truth in-house.

**RECOMMENDED: adopt it, but downstream — a mirror, never the upstream source of truth.**

- The shelf stays authoritative in-house. A small adapter **pushes** finished books and
  daily page/minute deltas into MyBibliotheca over its REST API.
- The household then gets its polished library UI, stats, public shelf and Goodreads
  export **for free**, and School depends on none of it. If MyBibliotheca breaks, is
  replaced, or churns its schema, the children's records are untouched.
- It is separately a strong pick for **a grown-up's own** reading tracking, which is a real
  win on its own terms and needs no integration at all to start.
- Its `/books/unified-metadata` and `/books/external-search` endpoints also make it a
  ready-made **fallback** metadata source if OpenLibrary ever disappoints.

This is phase 5 — after the shelf is proven, and never on the critical path.

#### Q9. Goodreads — what the existing RSS harvester can and cannot do

**There is already a working Goodreads integration**: `GoodreadsHarvester` (RSS, with a
circuit breaker) writing to lifelog, and `GoodreadsFeedAdapter` surfacing books as
scrapbook feed items. It reads
`https://www.goodreads.com/review/list_rss/<userId>?shelf=<shelf>` and extracts `readAt`,
`rating`, `author`, `bookId`, `review` and `coverImage`.

**It is user-shelf scoped, and that is the whole limitation.** It answers *"what has this
Goodreads account read, and what did they say about it"* — a personal shelf. It cannot
answer *"tell me about ISBN X"*, so it is **not** a metadata or public-review source for a
child's library book.

Where it does fit:

- **A grown-up's own shelf as an assignment source.** Books already read and rated by a
  parent are a curated pool to scope an assignment from (A8's curated list, populated from
  a shelf rather than typed).
- **Enrichment for books a household member has read** — a real review in a real voice,
  next to a child's own reflection.
- It is a sanctioned RSS surface, unlike the search-page scrape rejected in §3, so it
  carries none of that exposure.

## 6. Architecture

Layer placement follows `docs/reference/core/layers-of-abstraction/`.

```
2_domains/books/
  BookIdentifier.mjs        ISBN-10/13 validate, normalise, convert; record-ID and URL parsing
  BookRecord.mjs            the entity; merge rules for multi-source records
  BookIdentity.mjs          canonical-key selection, alternate-id set, work vs edition
  index.mjs

3_applications/books/
  ports/
    IBookMetadataGateway.mjs   byIsbn(), byWorkKey(), search()
    ILibraryCatalogGateway.mjs byRecordId() -> {isbns[], title, format, description}
    IBookRatingsGateway.mjs    forWork()
    IBookFullTextGateway.mjs   (phase 4)
    IBookRepository.mjs        the durable resolved-record cache
  ResolveBook.mjs           the resolution chain (B6)
  SearchBooks.mjs

1_adapters/books/
  OpenLibraryAdapter.mjs        IBookMetadataGateway + IBookRatingsGateway
  BiblioCommonsAdapter.mjs      ILibraryCatalogGateway; tenant subdomain from config
1_adapters/persistence/yaml/
  YamlBookRepository.mjs

4_api/v1/routers/books.mjs      GET /resolve, GET /search, GET /:bookId/cover

--- the seam ---

2_domains/school/bookShelf.mjs             shelf-item + progress-event rules; progressMode
                                           (page|minutes|check) inference and switching;
                                           state derived from the last event
3_applications/school/
  usecases/OpenBookShelfItem.mjs           confirm -> `started`
  usecases/RecordBookProgress.mjs          progress | finished | set-aside
  usecases/ClaimUnclaimedBook.mjs          tier-2 attribution (S15)
  handlers/bookScanHandler.mjs             registered on the EXISTING `book` namespace
                                           in ScanDispatcher (S16) — the ingress is built
  ports/IBookLogStore.mjs
  ports/IUnclaimedBookTray.mjs
1_adapters/persistence/yaml/YamlBookLogStore.mjs

  `BookLogProgramLauncher` (IProgramLauncher; `status({ userId })`, `dayOf`, `issueLaunchTarget`
  → a signed `bookGrant`) and `validateBookLogEnrollment` (§5.3b) both exist — the obligation
  layer came back as a separate layer over the obligation-blind log. A no-obligation
  enrollment reports `doneToday: null` (neither served nor owed).

frontend/src/modules/School/books/
  NumberPad.jsx         the pad — explicit submit, retained entry, variable length, X key
  DayPicker.jsx         rolling three weeks, weekday first, no month breaks (+ dayGrid.js)
  isbn.js               client-side ISBN check with the length gate + the copy table
  useBookShelf.js       state machine, generation guard, idle timer, entryId minting
  BookShelf.jsx / ShelfTile.jsx / UpdateBook.jsx / AddBook.jsx / History.jsx
  (UnclaimedTray waits on phase 2b; api calls live on schoolApi.books, logs on schoolLog.bookShelf)
```

**Config:** `data/household[-{hid}]/config/books.yml` — library tenant (`kcls`), which
gateways are enabled, cache behaviour. Loaded via `ConfigService.getHouseholdAppConfig`.
Remember config is cached at startup; a change needs a restart.

**Logging:** structured events from the start, per CLAUDE.md — `books.resolve.hit`,
`books.resolve.miss`, `books.resolve.partial` (with which sources answered),
`books.library.scrape-shape-changed`, `school.book-log.recorded`. The scrape-shape event
matters most: it is the only way we will learn that BiblioCommons changed their page
before a child does.

---

## 6b. Adapter topology — who implements what

**The domain is called `books`, not `reading`.** Two existing collisions decide it, not
taste: `1_adapters/content/readable/` already means *files you read on a screen* (Komga,
Audiobookshelf), and School already owns "reading" for the living-room story flow —
`ReadingSessionService`, `IReadingLogStore`, `RecordStoryRead`, the `reading-session`
learner action. A `reading` domain would be ambiguous with both. `books` names
bibliographic identity, which is exactly what an ISBN denotes and exactly what this domain
resolves. The School-side program keeps the id **`book-log`**; the surface a child sees is
"the shelf".

**LazyLibrarian is not part of this domain.** It is an *acquisition* tool — it finds and
downloads ebook/audiobook files from indexers into the library, feeding Calibre, Komga and
Audiobookshelf, which already have their own adapters. It has no bibliographic lookup for
a paper book a child borrowed from KCLS. **No adapter, no port, no integration.**

**MyBibliotheca is used through three narrow ports, never as the store.**

| Port (`3_applications/books/ports/`) | Implementations | Notes |
|---|---|---|
| `IBookMetadataGateway` | `OpenLibraryAdapter` (primary), `MyBibliothecaAdapter` (fallback) | MyBibliotheca's `/books/unified-metadata` and `/books/external-search` aggregate **Google Books as well as OpenLibrary**, which is the credible fix for the long-tail description gap (Q6a) |
| `ILibraryCatalogGateway` | `BiblioCommonsAdapter` | KCLS record → ISBN only (§5.2b) |
| `IHouseholdCatalogue` | `MyBibliothecaAdapter` | What the household owns, and **structured `series` / `series_volume` / `series_order`** — the direct answer to A8's dirty MARC string. Assignment scoping reads this |
| `IReadingMirror` | `MyBibliothecaAdapter` | Downstream push of finished books and daily deltas (phase 5) |
| `IBookLogStore` | `YamlBookLogStore` | **Ours. Always ours.** Never MyBibliotheca |

**What our supplement layer owns, because MyBibliotheca structurally cannot express it:**

- `check` mode — its `create_reading_log` rejects an entry with no number (measured)
- absolute page position — it stores deltas, we store "what page are you on" (S6)
- the 4am study-day boundary
- launch-card identity → learner mapping (their users are accounts; ours are panel codes)
- the obligation grammar (§5.3b) — nothing like it exists there
- the unclaimed-scan tray, voice memos, and the evidence ledger

That split is the whole design: **MyBibliotheca is an enrichment source, a catalogue
authority and a mirror — three things it is good at — and never the system of record for a
child's reading.**

### Deployment record — 2026-09-02

- `mybibliotheca` added to the **Media** stack (`docker-compose.yml` backed up first),
  image `pickles4evaaaa/mybibliotheca:2.2.0`, port **5054**, data at
  `./mybibliotheca/data`, `WORKERS=1` (KuzuDB requirement), secrets generated into a
  `chmod 600` `.env`. Container healthy; onboarding wizard served.
- **`mybibliotheca.{domain}`** — hand-written non-numeric proxy host
  (`proxy_host/mybibliotheca.conf`), matching the `logs.conf` precedent so NPM cannot
  overwrite it. Verified 200 end-to-end. Wildcard DNS and the `npm-6` wildcard cert
  already covered the name; no DNS or certificate work was needed.
- **`lazylibrarian.{domain}` already existed** (an existing NPM host conf, same upstream). A
  duplicate conf was written, detected by `nginx -t` as a conflicting server name, and
  **removed**; the UI-managed host is authoritative. Verified 200.
- Both hosts inherit the shared perimeter include that every existing host uses, so they
  are no more exposed than the rest of the stack.

**Pre-existing security finding, not introduced by this work: LazyLibrarian has no
authentication.** Its `config.ini` declares no `http_user` and no `http_pass`, and
`http://lazylibrarian:5299/` answers 200 with no login (verified 2026-09-02). It has
filesystem reach, holds indexer and download-client API keys, and can queue downloads —
and it has been reachable at `lazylibrarian.{domain}` behind only the network perimeter
since well before today. Fix: Settings → Interface → HTTP User / HTTP Pass, or set
`http_user`/`http_pass` in `/config/config.ini` and restart. This belongs next to the
standing Cloudflare Access item for the log store.

## 6c. Plan revisions after the 2026-09-02 build session

Three measured findings change the topology in §6b. None of them changes phase 1.

### R1. Google Books is NOT usable today, and MyBibliotheca cannot fix that

- **Keyless Google Books returns HTTP 429** — `Quota exceeded ... for consumer
  project_number:624717413613`, i.e. a shared anonymous project whose daily quota is
  already spent. Measured from **both** the laptop and the prod host, so it is not an
  egress-IP problem.
- **The household's existing `GOOGLE_API_KEY`** (in `household/auth/google.yml`, alongside
  `GOOGLE_CSE_ID`) returns **403 `PERMISSION_DENIED` — "Requests to this API books method
  ... are blocked"**. That is the Books API not being enabled on the project, not a bad
  key. **Fix: enable "Books API" for that project in the Google Cloud console.** One
  click, then the existing key works with its own quota.
- **MyBibliotheca has no Google API key field at all.** Its `metadata_settings.json`
  carries only `mode`/`default` per field and no credential anywhere — so it is stuck on
  the keyless path that is currently 429.

**And its provider defaults lean on Google for nearly everything**: `title`, `authors`,
`publisher`, `published_date`, `page_count`, `description`, `categories`, `cover_url`,
`average_rating`, **and `series`** all default to `google`. Only the `people.*` fields and
`openlibrary_id` default to OpenLibrary.

### R2. MyBibliotheca is demoted to mirror-only

This directly retracts two rows of §6b's table.

- **`IBookMetadataGateway` — MyBibliotheca fallback: REMOVED.** Its enrichment is a
  keyless Google call that currently 429s. Routing our long-tail lookups through it would
  make our reliability strictly worse than calling OpenLibrary ourselves, and would put a
  second process's quota problems inside our resolve chain.
- **`IHouseholdCatalogue` — series authority: WITHDRAWN for v1.** The `series` field I
  proposed depending on **defaults to the same 429'd Google source**, and the library is
  currently empty (0 books, 0 people, 0 logs), so there is no series data to read. A8's
  **explicit curated list stands as the only mechanism**, exactly as originally written.
  MyBibliotheca may become a nice authoring surface for those lists later; it is not a
  dependency.
- **What remains: `IReadingMirror`, phase 5, downstream, optional.** Unchanged and still
  worth doing — but now the *only* reason to integrate at all.

**Replacement:** add a `GoogleBooksAdapter` of **our own**, using the household key, once
the Books API is enabled. We hold the credential, we own the quota, and we skip a
dependency on a codebase whose repair-route surface (§Q9b) argues against putting it in a
hot path. Until that switch is flipped, **OpenLibrary alone is the metadata source** —
which is fine: it resolved every book tested, including the long-tail *Guys from Space*,
whose description came from the work record (B6).

### R3. Audiobookshelf is a first-class `minutes` source, directly

The house runs Audiobookshelf with a working API token (`household/auth/audiobookshelf.yml`)
and two libraries — `Audiobooks` (`faa92fe8-…`) and `Books` (`72920089-…`), both
`mediaType: book`, verified 200.

An ABS **listening session is already a `minutes` signal**, which is exactly the
`progressMode: minutes` case in §5.3 S6. So audiobooks can eventually populate the shelf
**with no child typing anything** — and the right path is **ABS → us, directly**, not
ABS → MyBibliotheca → us. We already hold the token, the API is documented and stable, and
it removes a hop through the least reliable component in the picture.

Not phase 1. Recorded here so the shelf's event model is not designed in a way that
forecloses it: a progress event must be able to carry a `source` of `abs` and an external
session id for idempotency, alongside the hand-entered case.

### R3a. Google Books works now — and it is a FIELD-LEVEL source, not a better one

`GOOGLE_BOOKS_API_KEY` (a second, Books-only key — the CSE key could not be extended;
the console refuses with *"BOOKS API: Cannot be combined with the currently selected API
restrictions"*) is in `household/auth/google.yml` and **all three test ISBNs now resolve**,
including the long-tail *Guys from Space*.

But the results are uneven in a way that decides the merge policy. MEASURED 2026-09-02:

| Book | Google `pageCount` | Google title | Cover |
|---|---|---|---|
| Guys from Space | **0** (OpenLibrary: 32) | correct | yes |
| Narnia | **0** | "The Lion, the Witch and the Wardrobe **(rack)**" | **no** |
| Charlotte's Web | 196 | "Charlotte's Web **Book and Charm**" (OpenLibrary: 184) | yes |

Two of three page counts are **0**, `items[0]` lands on packaging variants (a "rack"
edition, a book-plus-charm bundle), and one cover is missing. Page count is what draws the
progress bar (S6), so a 0 there is not cosmetic — it disables the core interaction with nothing to show for it.

**RESOLUTION MERGE POLICY — per field, not per source:**

| Field | Preferred | Why |
|---|---|---|
| `pageCount` | **OpenLibrary** | Google returned 0 twice out of three; OL was correct every time |
| `title`, `authors` | **OpenLibrary** | Google's first hit carries bundle/edition noise |
| `coverUrl` | **OpenLibrary** | Google missed Narnia entirely |
| `description` | **Google**, falling back to the OL *work* record | Google had a real description for all three, including the long tail |
| `categories`/`subjects` | either; prefer OL `subject_people`/`subject_places` for quizzes (Q1) | |

Google is therefore a **description source**, not a replacement spine. Never take a whole
record from it. Never let a Google `pageCount: 0` overwrite an OpenLibrary count — treat
0 as absent, not as a value.

This also independently validates MyBibliotheca's per-field `mode`/`default` config shape
(R1): field-level provider choice is the correct model here, even though their defaults
(everything to Google) are the wrong settings.

### R4. Naming note

**`books.{domain}` is already taken** — an existing NPM host serves it to Audiobookshelf, along
with `audio.`, `audiobooks.` and `audiobookshelf.`. If the books domain ever wants a
public hostname, pick another name or move that alias.

## 6d. Implementation status — 2026-09-02

Built test-first; every module below had a failing test before it existed.
**201 tests green** across the books domain, the adapters, the resolve chain, persistence
and the School wiring, plus the repo's own layer/fs audits and the parse gate.

| Layer | Module | Tests | What it settles |
|---|---|---|---|
| `2_domains/books` | `BookIdentifier.mjs` | 19 | ISBN-10/13 validation and 10→13 conversion; BiblioCommons and OpenLibrary ids and pasted URLs. **Every failure is named** — `isbn13-checksum` vs `not-a-book-prefix` vs `not-an-identifier` are three different sentences on screen |
| `2_domains/books` | `BookRecord.mjs` | 16 | The canonical shape (30 fields, union of every vendor's concepts) + the measured per-field merge policy. Empty (`0`, `''`) normalises to `null` |
| `3_applications/books/ports` | `IBookMetadataGateway.mjs` | — | The contract: adapters return a **complete native record**, never a provider shape |
| `1_adapters/books` | `OpenLibraryAdapter.mjs` | 11 | Two-hop fetch for the description; `[{name}]`→`[string]`; `{type,value}` unwrapping; `'September 1, 1994'`→`1994`; MARC series split |
| `1_adapters/books` | `GoogleBooksAdapter.mjs` | 11 | `pageCount: 0`→null; exact-ISBN item selection over Google's ranking; http→https covers; optional key |
| `3_applications/books` | `ResolveBook.mjs` | 12 | Four distinguishable outcomes; parallel providers; durable cache; library-record path |
| `2_domains/school` | `bookLog.mjs` | 19 | **The enrollable configuration** — the closed obligation grammar |
| `2_domains/school` | `bookShelf.mjs` | 20 | Progress modes, derived state, and every metric's derivation |
| `3_applications/school/ports` | `IBookLogStore.mjs` | — | Append-only, learner-sharded, idempotent on `entryId` |
| `3_applications/school` | `BookLogProgramLauncher.mjs` | 15 | Agenda integration; `doneToday` for non-daily windows; only `once` is terminal |
| `1_adapters/persistence/yaml` | `YamlBookLogStore.mjs` | 13 | Learner-sharded records; append-only; idempotent on `entryId`; corrupt shelves side-filed before replacement |

### It is enrollable end to end

`BOOK_LOG_PROGRAM_ID` is registered in `createSchoolProgramEnrollmentValidators`
**unconditionally** — like story-time, it needs no service wired at boot, because an
enrollment with no obligation is complete on its own. Verified through the real registry:

```
registered programs: story-time, book-log
  pure log       -> {programId:"book-log", corpusId:null, subject:"english", obligation:null}
  20 pages/day   -> {…, obligation:{metric:"pages",    quantity:20, per:"day"},  schedule:{daysOfWeek:[1,2,3,4,5]}}
  2 books/week   -> {…, obligation:{metric:"books",    quantity:2,  per:"week"}}
  daily checkin  -> {…, obligation:{metric:"checkins", quantity:1,  per:"day"}}
  this series    -> {…, obligation:{metric:"books", quantity:3, per:"once",
                                    scope:{books:["a","b","c"], label:"Narnia"}}}
  bad metric     -> ERRORS: obligation.metric must be one of pages|minutes|books|checkins
```

All five asks from the brainstorm validate, `schedule` composes through the existing
`withSchedule` wrapper with no new code, and the grammar refuses what it does not
understand.

### Verified against the live API, not just fixtures

```
Guys from Space   pages=32  description="A boy accompanies some guys from space…"  olWork=OL84048W
Narnia            series="The Chronicles of Narnia" vol=2  people=[Aslan, Lucy Pevensie, …]
Charlotte's Web   pages=184 people=[Fern Arable, Wilbur, Charlotte A. Cavatica, …]
```

The two-hop description fetch, the MARC series split and the character extraction all work
on real data. Two live findings worth keeping:

- **OpenLibrary title casing is unreliable** — it returns `"charlotte's web"`. Deliberately
  NOT title-cased in the adapter, which would mangle *bell hooks* or *eeny meeny*; this
  belongs at display time.
- A pre-existing `CloseLanguageDay` test fails in the full School suite and passes in
  isolation, on a **clean tree as well as this one**. A test-ordering flake, unrelated to
  this work, but worth a separate look.

### One design change made while building

**`itemId` is `<learnerId>:<bookId>:<startedEntryId>`, so it locates its own shard and never
collides.** The learner leads because an identifier that cannot find its own record is half
an identifier (`learnerId` is `SAFE_ID`, no colons, so the first colon always splits); the
`started` event's `entryId` — not `openedAt` — makes two opens of one book on one day two
items, which is what lets a backdated finish carry an honest `openedAt`.

### Still to build

`YamlBookRepository` (the resolved-record cache), the `/api/v1/books` router,
`BiblioCommonsAdapter`, the use cases (`OpenBookShelfItem`, `RecordBookProgress`,
`ClaimUnclaimedBook`), composition wiring, and the frontend (`BookLookup`,
`BookConfirmCard`, `BookShelf`, `PageUpdate`, `UnclaimedTray`).

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| BiblioCommons HTML shape changes | High, and it *will* | The scrape extracts exactly one field (ISBN). Contract test against a saved fixture; a dedicated log event on shape mismatch; a manual-ISBN fallback path that always works |
| OpenLibrary rate-limits or is down | Medium | Durable repository cache (B8) means the house only pays once per book; descriptive User-Agent; graceful partial records |
| OpenLibrary coverage gaps for children's/board books | Medium | `search` fallback (B9) and a manual-entry escape hatch — a child must always be able to log a book the internet has never heard of |
| Goodreads/Amazon scraping | High (legal + reputational) | Out of v1. Port only |
| Self-reporting is unverifiable | Inherent | Accepted. This is a household, not an exam board. The reflection *is* the evidence of reading; a voice memo about a book you didn't read is harder than reading it |
| Domain leaks into School | Medium | An `audit:layers` rule: no import from `#domains/school` or `#apps/school` under `books/` |
| Reinventing story-time | Medium | Separate stores, and now clearly separate objects: story-time is a daily *obligation*, the shelf is an *unobligated log*. See OQ 4 |
| A shelf nobody visits | Medium | It has no nag to fall back on, so the pull has to be real — the progress bar and the year's bookshelf are the whole draw. Worth watching in the logs (`school.book-shelf.*`) rather than assuming |

---

## 8. Phasing

| Phase | Scope | Done when |
|---|---|---|
| **1. Lookup** | `2_domains/books`, OpenLibrary adapter, BiblioCommons adapter, `ResolveBook`, repository, `/api/v1/books/resolve`, `/search` | An ISBN *or* a KCLS record ID typed into a curl returns a full record with a cover URL |
| **2. Shelf** | `bookShelf` domain rules, `IBookLogStore`, open/progress use cases, the launch-card lookup + confirm + shelf + page-update UI. **Typed entry only** | A child opens their launch card, types an ISBN once, confirms the cover, and can thereafter tap that book and type a page to watch a bar move |
| **2b. Scanner** | `bookScanHandler` on the existing `book` namespace, session-scoped attribution (tier 1), unclaimed tray + claim flow + expiry (tier 2) | A child scans a back cover inside their launch-card session and the book appears on their shelf; a scan with nobody logged in lands in the tray and can be claimed |
| **3. Reflect** | Voice memo, transcription, star rating, grown-up review surface | A grown-up can play back what a child said about a book they finished |
| **4. Quizzes** | Wikipedia-plot + OpenLibrary character/excerpt quiz generation, grown-up approval. **Spike** (F1) for full text separately | A grown-up approves a generated quiz for a book with a plot source; a book without one offers no quiz at all |
| **5. Mirror** | Push finished books and daily deltas to MyBibliotheca over its REST API; optionally read `series` back for assignment scoping | The household library UI shows what the children read, and School keeps working when it is switched off |

Phase 1 is independently useful and independently shippable. It is also the phase that
de-risks everything else, because it is the one touching four external services.

---

## 9. Decisions and open questions

### Decided in the 2026-09-02 brainstorm

1. **Obligations are a separate layer over an obligation-blind log.** The shelf works
   identically with or without an enrollment; changing an obligation never migrates a log
   entry. §5.3, §5.3b
2. **The obligation grammar is four metrics × a quantity × a window × an optional scope**
   (`pages` | `minutes` | `books` | `checkins`), composed with the *existing* `schedule`
   block rather than reinventing "which days count". Every metric is a pure function over
   the log. §5.3b A1–A7
3. **Progress is a page number by default**, drawn against OpenLibrary's page count, with
   a per-book `progressMode` (`page` | `minutes` | `check`) so a reference book is not
   forced to have a page you are "on". §5.3 S6–S7a
4. **No search bar on the child surface.** The identifier is on the object in their hands;
   lookup is a direct read of it. `SearchBooks` exists only behind the teacher gate for
   assignment authoring. §5.2 B9
5. **Two barcodes, told apart for free.** `ScanCode`'s 978/979 shape test already
   distinguishes an ISBN from a library sticker, so an unresolvable sticker gets an
   instruction — *"flip the book over"* — not an error. Library-record resolution is a
   bonus path whose feasibility is **unverified**; §5.2b carries the one-command check to
   run with a book in hand. §5.2b B10–B13
6. **The launch card is the primary entry surface**, because it is user-scoped and a
   scanner is not. Three attribution tiers; the third is never a guess. §5.3 S10–S16
7. **An anonymous scan becomes an unclaimed book**, claimed by any learner from their own
   shelf, stamped with the original scan time; first claim wins, `Not me` is per-learner,
   7-day expiry, logged. §5.3 S15
8. **Quizzes do not need full text.** OpenLibrary characters/places/excerpts plus the
   household's offline Wikipedia plot summaries are enough — where they exist. No plot
   source, no quiz. Such a quiz tests "do you know this story", never "did you read this
   book", and may not gate anything. §5.6 Q1–Q6a
9. **LibraryThing is not self-hostable** and is currently unreachable programmatically
   (Cloudflare challenge, measured). Everything it was wanted for — covers, quotes,
   characters — is already in OpenLibrary, keyless. §5.6 Q7
10. **The source of truth stays in-house.** BookWyrm (not LibraryThing) is the
    self-hostable analogue, but the product *is* the School layer, and OpenLibrary is
    already the metadata database we are not building. §5.6 Q8
11. **MyBibliotheca is adopted downstream as a mirror, not upstream as the source of
    truth** — its log rejects a no-number entry (killing `check` mode) and stores page
    *deltas* rather than positions, but its API offers structured `series` data and Google
    Books enrichment that OpenLibrary lacks. Phase 5, never on the critical path. §5.6 Q9b
12. **The existing Goodreads RSS harvester is user-shelf scoped** — useful for a grown-up's
    own shelf as an assignment pool and for enrichment, useless as an ISBN lookup. §5.6 Q9

### Resolved while implementing (2026-09-02)

5. **Story-time stays separate. DECIDED.** They are different objects with different
   shard keys: `IReadingLogStore` shards by **study day** because a daily count asks about
   one day; `IBookLogStore` shards by **learner** because every question about a book
   ("what is on this shelf", "how far in", "finished this month") spans days. Merging them
   would scatter one book's events across a dozen files and make the shelf a fan-out read.
   A grown-up who wants one "reading" number gets it at the **report** layer, by adding two
   figures — not by merging two stores with incompatible shapes.
6. **Book facts are shared; shelves are per learner. DECIDED.** The resolved-record cache
   (`IBookRepository`) is household-wide — a book's page count is not a private fact, and
   a sibling's lookup should warm it for everyone. The **log** is per learner
   (`listForLearner`). The unclaimed tray is necessarily household-visible, which is what
   makes `Not me` per-learner rather than global (S15f).
7. **Goodreads is not needed. DECIDED — port only, no adapter.** OpenLibrary's
   `ratings.json` and `bookshelves.json` supply a star average, a histogram and a
   finished-reader count from a keyless licensed endpoint; the existing RSS harvester
   covers a grown-up's own shelf. Neither requires the scrape rejected in §3.
8. **A `finished` needs no grown-up nod. DECIDED.** With no obligation by default there is
   nothing to game. With one, the enrollment's own `quantity` is the ceiling, and
   `scope` bounds *which* books count — so "log Captain Underpants twenty times" cannot
   inflate a scoped target at all. Re-reads are handled structurally instead: a second
   `started` after a `finished` opens a NEW shelf item (S9), so the history stays honest
   without anyone having to approve anything.

### Decided during execution (2026-09-02)

12. **A backdated finish credits the finish day, never today.** For the "already finished
    it" door, `openedAt` and the `started` event carry the chosen day (noon UTC); a
    check-in is any non-`set-aside` event on a day — the same page as yesterday included.
13. **Every metric is measured on the household study day.** `bookShelf.mjs` takes an
    injected `dayOf`; the launcher supplies `studyDayForInstant` with the household timezone
    and exposes it as ONE public `dayOf` that the shelf route uses too. A 9pm Pacific read
    is today, a 3am one is yesterday.
14. **The reading code names the shelf.** The daily agenda mints it with `continueToday`
    *and* `program: 'book-log'`; typed and scanned resolvers share `findContinuationEntry`,
    which prefers the named program — so a served reading code reopens the shelf while a
    "One more?" receipt still opens a lesson. Program entries carry `cadence: 'once'` for a
    `per: 'once'` obligation, so a finished series can leave the agenda.
15. **Identity is the grant's.** `X-School-Book-Grant` (an HMAC twin of the cube grant with
    its own context/purpose) is verified against the URL's learner and the route acts for the
    grant's payload; bodies never carry a learner.
16. **The `finishedOn > today` check compares against the household STUDY DAY** —
    `dayOf(now)`, the launcher's 4am-boundary day, injected into `OpenBookShelfItem` and
    `RecordBookProgress` from the composition root. It replaced a UTC-day ceiling (final
    review m1) that accepted a local-tomorrow after ~5pm PT and, east of UTC, refused
    "Today" at 06:00 local. A study-day ceiling refuses neither an evening finish (9pm
    Pacific is still today's study day) nor an early-morning one past 4am.

**Tidy-ups carried, not blocking:** sweep `BookLogProgramLauncher.test.mjs`'s `10:00Z`
fixtures (3am PDT) to `18:00Z`, the `2026-08-04T10:00Z` one at a week boundary first; let
`studyDay()` delegate to `dayOf`; restrict the store's `openItem` dedupe to the `started`
event's `entryId`; add a body-mutation tamper case to the grant issuer test; wire
`excludeKeys` into `findContinuationEntry` once a section names its errored program keys.

### Deferred by phasing, not undecided

9. The scanner path (phase 2b) sits behind typed entry (phase 2) on purpose. If the tray
   fills with books nobody claims — visible in `books.unclaimed.expired` — that is the
   signal to drop the anonymous path rather than tune it.

## Appendix: verification log (2026-09-02)

Measured from the laptop, live network. Reproduce with:

```bash
curl -s "https://openlibrary.org/api/books?bibkeys=ISBN:9780064400558&format=json&jscmd=data"
curl -sL -o /dev/null -w '%{http_code} %{content_type}\n' "https://covers.openlibrary.org/b/isbn/9780064400558-L.jpg"
curl -s "https://openlibrary.org/works/OL52267W/ratings.json"
curl -s "https://openlibrary.org/works/OL52267W/bookshelves.json"
curl -s "https://openlibrary.org/search/inside.json?q=%22Some+Pig%22"
curl -sL -A "$UA" "https://kcls.bibliocommons.com/v2/record/S82C1482387" | grep -o '"isbns":\[[^]]*\]' | head -1
```

- KCLS `S82C1482387` = *Dr. Seuss's ABC*, EBOOK, 2013, ISBN 9780385372060 / 038537206X.
- `gateway.bibliocommons.com/v2/{bibs,libraries/kcls/bibs}/S82C1482387` → 404 `{"error":{"message":"Not found"}}`.
- `api.goodreads.com` → 401 (retired). `goodreads.com/search?q=<isbn>` → 200, `ratingValue` present.
- Per-book scoped full-text search: **not verified**, both candidate endpoints unreachable from this machine.
- Rate limits: **not measured** for any source.

### In-repo verification (2026-09-02)

The scan ingress for books already exists. Reproduce:

```bash
node --input-type=module -e "
import { parseScanCode, NAMESPACES } from './backend/src/2_domains/scan/ScanCode.mjs';
for (const c of ['9780064400558','0064400557','1234978123456'])
  console.log(c, JSON.stringify(parseScanCode(c)));
console.log(NAMESPACES.join(', '));
"
```

```
9780064400558  {"namespace":"book","body":"9780064400558","raw":"9780064400558","form":"shape"}
0064400557     {"namespace":null,"body":"0064400557","raw":"0064400557","form":"unknown"}
1234978123456  {"namespace":null,"body":"1234978123456","raw":"1234978123456","form":"unknown"}
NAMESPACES: content, command, nutrition, school, book, product
```

- ISBN-13 resolves to `book` via `form: 'shape'` — no handler is registered for it yet.
- A bare ISBN-10 does **not**; it is `unknown`. Scanning is unaffected (book EAN barcodes
  are always 978/979 ISBN-13), but typed ISBN-10 needs domain handling (B1).
- A grocery EAN containing `978` mid-string is correctly **not** claimed as a book.
