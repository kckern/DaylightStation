# Reading shelf

`BookShelf` retains its public `{ learnerId, grant, idleTimeoutSeconds, onExit }`
interface. The existing shelf and write endpoints remain authoritative for
book ownership, ISBN validation, signed learner grants, progress, and credit.
The frontend does not maintain separate credit counters.

## Entering and browsing

The scanned-book overlay uses the full available width. On landscape screens,
a large, uncropped cover fills the left column, with the title and author below;
the reader choices fill the right column. Cover sizing follows viewport height
to leave room for book details. Narrow screens stack the book above the choices.

The reading code is one of three ways in. A scan of the book asks who is
reading it; a reading icon beside the panel's day board asks who they are and
opens that learner's shelf directly on the ISBN pad, with no code and no
scanned book. A scan arriving while the panel is busy defers to a corner offer
rather than interrupting, and taking that offer clears the panel and asks the
same "who's reading this?" question an idle scan asks.

A successfully resolved reading code opens the shelf through the existing
self-service program action immediately. If the server requires identity
confirmation, **Open <name>'s books** both confirms the learner and launches
the shelf; declining opens nothing. The server still validates the code and
issues the signed learner grant. Other programs and print actions retain their
existing action cards.

Leaving the shelf returns to the keypad and remounts the live agenda board,
which reloads persisted reading activity. A reading save can add a completed
Reading circle without creating or completing any required assignment. See
[agenda acknowledgment](./agenda-and-completion.md#reading-on-the-status-board).

The first successful load opens the ISBN pad directly when the learner has no
shelf records, or when the panel door asked for it. Back returns to the shelf
and later reads do not reopen the pad. A learner with only finished or set-aside records gets the shelf.

Two shelves, both horizontal rows of the same card. **Reading now** holds the
reading and unread items, with the **add card last** — a book's own footprint,
the same 2:3 slot a cover letterboxes into, drawn empty with a plus. It is
always there, so an empty shelf offers a card rather than a sentence.
**Finished and set aside** holds up to 30 done readings, finished and set-aside
alike, ordered by effective outcome date and then by recording time.

A row **runs off the panel edge** and scrolls sideways. That is the point: the
shelf spans the panel and the text column is drawn with padding, so a row
starts under its heading and is cut by the panel's right edge. A history that
ended in whitespace said there was nothing more to see.

A done card carries its outcome as a **mark on the art** — a green check for
finished, an amber bookmark for set aside — so the two are told apart before a
word is read. A finished card's caption is therefore its day alone; a
set-aside card keeps its words.

A card sizes to its own text: nothing fixes a height, so a two-line title is
never cut. The 2:3 box belongs to the art wrapper rather than the image, since
`aspect-ratio` on a replaced element is negotiated against its intrinsic size.

See all history opens finished and set-aside books grouped by month in a
vertically scrolling list; the month list is the scroll container and the
header stays put. Finished tiles in either place open completed details. Read
again creates a new read, including on the same study day. If that ISBN
already has an active or unread item, it opens that item instead.

## Covers

Every surface renders a cover from `/api/v1/books/{isbn13}/cover` — the
household's own address, never a provider's. Behind it is the cascade in
[`BookCoverArt`](../../../backend/src/2_domains/books/BookCoverArt.mjs): a
ladder of catalogues ordered so the best art wins rather than the first, with a
Google image search as the last rung, and every candidate's BYTES judged rather
than trusted. Providers answer `200` for books they have no art for, so
"it downloaded" is not "it is a cover".

Art is kept on disk under `media/books/covers/` — the media mount, not the data
tree: a book RECORD is a small hand-editable fact worth syncing, a cover is tens
of kilobytes of JPEG derived from it and re-fetchable at any time. Keeping it
locally is what stops a cover host being down from blanking a shelf a child is
standing in front of. A book nobody
has art for is recorded as a miss and left alone for two weeks.

**The ladder always ends in a cover.** When every rung misses, the endpoint
draws one — a coloured board with a spine, a foil frame, the title in a serif
and the author under a rule, from
[`GeneratedCover`](../../../backend/src/2_domains/books/GeneratedCover.mjs).
The hue is a hash of the ISBN, so the same book is always the same colour and a
child can pick it out of a row by shape and colour like any other tile. It is
obviously not the publisher's art and is not meant to be mistaken for it; it
replaces a grey box with a star that made two different books look like the
same failure. It is never stored — it is derived from the record, so it costs
nothing to redraw and improves by itself the day a title is corrected — and it
is cached for a day rather than a week, so real art takes over as soon as it
turns up.

The panel keeps its own placeholder for the one case the server cannot cover:
the request itself failing.

## Add, update, and finish

ISBN input retains checksum validation, scanner/keyboard entry, and manual
correction. There is no lookup button: thirteen valid digits advance after a
short settle, and ten fire the catalog immediately but advance only on a real
hit, after a second of quiet that any further digit cancels. A ten the catalog
does not know shows `Use this number` rather than stranding the entry, and says
nothing else — the child may still be typing. A lookup shows its cover, title,
author, and actions together:
Start reading, Update page, Finished today, and Finished on another day.
Selecting an action accepts the displayed book. Wrong book? Edit number keeps
the typed ISBN. Missing catalog metadata shows an honest ISBN placeholder and
still permits logging. Active/unread matches offer Open it. Prior finished
matches show Last finished and Read again before the same action choices.

An active book opens compact details and illustrated progress/finish actions.
Update page or Log minutes opens the corresponding pad, with Save page or Save
minutes. Check mode's I read some today writes the check-in directly. Finished
today saves with the server's `studyDay`. Finished on another day opens the day
grid and its Save finish button names the selected date. The oldest allowed
date comes from `earliestFinishDay`; future dates are never offered. The
progress caption still opens the mode chooser, and set it aside remains
available.

## Save and retry behavior

A persisted write returns immediately to the shelf with an inline result.
Finished results offer Undo finish, an append-only reopened event targeted by
the receipt's own item ID, independent of the currently selected book. New
writes replace the prior result; navigation alone does not discard it.

Open/progress operation IDs are allocated before writing and reused for
retries. A ref guards double taps and remains held through the following
shelf read. Actual write failures keep the editor, typed values, and operation
IDs. If the write succeeds but the following read fails, the result stays
visible with Saved. Your shelf could not refresh. and Retry shelf. Stale tiles
cannot start another update until that read succeeds; retry only reads.
Freshness is separate from operation errors: a failed Undo retains its own
feedback and correction ID while stale tile/add/history actions stay blocked
and Retry shelf remains available. The first-book tile follows the same guard.

Done, idle close, unmount, and learner/grant changes invalidate late responses.
Pointer, input, and keyboard/scanner activity rearm idle closure.

## Dates and historical data

Finish context and recent ordering use the effective finished-event date,
falling back to the projection for older shelf shapes. Optional server-stamped
`recordedAt` is displayed separately as Recorded with local date/time. Legacy
records without it show date-only context: event `at` must never be presented
as an exact recording time. No historical migration, merging, or deletion is
required. Rereads and Undo preserve the existing records.

Tests live beside the books components, including `shelfExperience.test.jsx`
which exercises the real hook and components with mocked API transport.
