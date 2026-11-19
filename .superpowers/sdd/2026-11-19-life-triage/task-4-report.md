# Task 4 report: IMailbox port and Gmail adapter
Status: DONE. Files: ports/IMailbox.mjs, adapters/GmailMailbox.mjs, adapters/GmailMailbox.test.mjs (under __app_modules/personal/triage/server).
Tests: 11 passed (vitest, adapters dir).
TDD: tests and impl were written in one pass; RED verified afterwards by removing GmailMailbox.mjs (suite failed to load: cannot resolve ./GmailMailbox.mjs), GREEN with it restored (11/11).
Decisions: listing uses format 'metadata' plus one extra `has:attachment` search to flag attachments; getMessage uses format 'full' and walks parts for filenames. ownerRepliedInThread via threads.get minimal (another message labelled SENT). Capabilities are per-username in memory; scope error flips the capability the failing method needs (modify/compose/send) and later writes fail fast without calling Gmail.
Concerns: listInbox does 1 get + 1 thread fetch per message (N+1; fine for max 200, may be slow). updateDraft rebuilds the raw from the existing draft's headers. Port file also exports MAILBOX_SCOPE_MISSING constant. Not wired into app.mjs (Task 10).
