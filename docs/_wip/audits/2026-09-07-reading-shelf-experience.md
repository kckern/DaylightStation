# Reading shelf browser acceptance — 2026-09-07

## Scope and isolation

- Portal viewport: 1280×800, matching the read-only Fully Kiosk device report.
- Routes: `/school` for typed-entry shelf cases; `/screen/portal` for the real screen-framework scan mount.
- Browser server: existing isolated Vite at `http://127.0.0.1:3211`, using `.superpowers/sdd/2026-09-07-reading-shelf-implementation/playwright.config.mjs` with `webServer` disabled.
- All `/api/v1/**` calls, catalog covers, shelf reads, scan pending/claim calls, and reading writes were intercepted by the disposable `User_4` fixture. The scan event was delivered locally with `window.__wsService._dispatch`; no production WebSocket message or reading record was sent.

## Command and result

```sh
env -u NO_COLOR npx playwright test --config .superpowers/sdd/2026-09-07-reading-shelf-implementation/playwright.config.mjs tests/live/flow/school/reading-shelf-contract.runtime.test.mjs --reporter=line
```

Result: **4 passed (1.1m)**.

The contract verifies:

- six-digit code → direct shelf launch with no intermediate card;
- truly empty initial shelf → ISBN entry, returning shelf, finished-only shelf, completed detail and reread context;
- rapid keyboard ISBN entry, hostile catalog text/cover normalization, and bounded horizontal shelf rows;
- visible, hit-testable 44px+ primary actions; progress-pad, alternate-date Save, shelf/history, Undo, and agenda-credit controls remain within 1280×800;
- one-tap finish, stable write identifiers, inline recent finish, history, Undo, and optional Reading credit after exit;
- a pending scan stays anonymous and makes zero reading writes while a keypad draft is active, then shows the learner chooser, claims `User_4`, opens the prefilled scanned-book actions, finishes explicitly, and shows persisted Reading credit.

## Screenshots

Current disposable-fixture evidence is under `docs/_wip/audits/user_4-reading-shelf/`:

- `01-panel-code.png`, `02-hostile-data-shelf.png`, `03-isbn-actions.png`
- `04-finished-shelf.png`, `05-history.png`, `06-undo-finish.png`, `07-agenda-reading-credit.png`
- `08-initial-empty-number.png`, `09-reread-progress-pad.png`, `10-alternate-date.png`
- `11-scan-choose-learner.png`, `12-scanned-book-actions.png`, `13-scan-finish-credit.png`

## Defects found and rechecked

- Rapid keyboard input initially left the mounted NumberPad empty because its window listener was replaced during an earlier activity-listener update. After the listener was made stable, the unchanged rapid `page.keyboard.type(ISBN)` path completed the full flow.
- The reread progress Save control initially ended at y=807.656 and the alternate-date action was below the fold. The focused progress/date layouts were compacted; both 44px+ controls now pass the in-viewport and trial-click checks at 1280×800.

## Hardware evidence and limits

The controller ran the deployment gate read-only, then exercised Fully Kiosk `screenOff` followed by `screenOn` + `toForeground`. Device state changed from `screenOn:false` to `screenOn:true`, foreground remained `de.ozerov.fully`, and the page stayed `/screens/portal` without reload or reading writes on FKB 1.60.1-play. This verifies the physical wake API and the existing plural route. A real ISBN was not scanned into the production Portal; end-to-end production scanner delivery remains a deployment-time check.
