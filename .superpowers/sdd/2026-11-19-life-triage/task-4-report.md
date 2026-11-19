# Task 4 report: IMailbox port and Gmail adapter
Status: DONE. Files: ports/IMailbox.mjs, adapters/GmailMailbox.mjs, adapters/GmailMailbox.test.mjs (under __app_modules/personal/triage/server).
Tests: 11 passed (vitest, adapters dir).
TDD: tests and impl were written in one pass; RED verified afterwards by removing GmailMailbox.mjs (suite failed to load: cannot resolve ./GmailMailbox.mjs), GREEN with it restored (11/11).
Decisions: listing uses format 'metadata' plus one extra `has:attachment` search to flag attachments; getMessage uses format 'full' and walks parts for filenames. ownerRepliedInThread via threads.get minimal (another message labelled SENT). Capabilities are per-username in memory; scope error flips the capability the failing method needs (modify/compose/send) and later writes fail fast without calling Gmail.
Concerns: listInbox does 1 get + 1 thread fetch per message (N+1; fine for max 200, may be slow). updateDraft rebuilds the raw from the existing draft's headers. Port file also exports MAILBOX_SCOPE_MISSING constant. Not wired into app.mjs (Task 10).

## Fix round 1
Changed (GmailMailbox.mjs): shared buildRaw; to/subject supplied by callers throw MAILBOX_INVALID_HEADER on CR/LF; Message-ID/References from threads and all headers re-read in updateDraft are stripped of line breaks; non-ASCII subjects RFC 2047 (=?UTF-8?B?..?=); updateDraft keeps Cc/Bcc; listInbox skips per-message 404 (debug log), other errors propagate; new #read wrapper maps 403 insufficientPermissions to MAILBOX_SCOPE_MISSING and flips `read` for listInbox/getMessage/senderHistory; senderHistory query is `to:"<address>" in:sent` (quotes/CRLF stripped from address).
Covering tests (6 new + senderHistory updated): invalid header to/subject, threading header stripping, RFC 2047, updateDraft Cc/Bcc/threading, listInbox 404 skip vs 500, read-scope flip.
Command: npx vitest run --config tests/_infrastructure/config/vitest.config.mjs __app_modules/personal/triage/server/adapters
Output: Test Files 1 passed (1); Tests 17 passed (17)
