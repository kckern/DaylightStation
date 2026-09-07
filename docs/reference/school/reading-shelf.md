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

Only the first successful load of a learner with no shelf records opens the
ISBN pad directly. Back returns to the shelf and later reads do not reopen the
pad. A learner with only finished or set-aside records gets the shelf.

Reading now contains reading/unread items; Recently finished contains up to
12 finished items ordered by effective finish date, then recording time when
available. Both collections use compact horizontal rows, with Add a book above
the active row. See all history opens finished and set-aside books by month.
Finished tiles in either place open completed details. Read again creates a
new read, including on the same study day. If that ISBN already has an active
or unread item, it opens that item instead.

## Add, update, and finish

ISBN input retains checksum validation, scanner/keyboard entry, and manual
correction. A lookup shows its cover, title, author, and actions together:
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
