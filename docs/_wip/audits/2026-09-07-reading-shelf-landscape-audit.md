# Reading shelf landscape audit — 2026-09-07

## Scope and method

The reading shelf was rendered in Chromium at the Portal's fixed `1280×800` viewport against an isolated Vite server and an intercepted, synthetic API world. The fixture uses neutral learner labels, fake identifiers, a fake catalog origin, and no production requests or writes. Each flow used the real launcher and reading-shelf navigation. The audit recorded the document dimensions and bounding boxes for every primary action, exit, retry, and task control, then saved a full-page screenshot.

History is the one deliberately scrollable surface. Its Back and Done controls still had to remain in the viewport. Every other surface had to remain within `1280×800`, preserve the learner and Done exit, and provide at least a `44px`-high touch target for measured controls.

The production baseline is four learners. The audit uses four neutral learner fixtures. An eight-learner future-growth stress case was not run and is not part of this acceptance result.

## Findings and changes verified

Two blocking layout problems were visible in the initial browser pass:

1. Alternate-date tasks removed the complete Reading header, learner identity, Done exit, and book context to make the calendar fit. The revised layout keeps the header and places book context on the left with the calendar and actions on the right. The alternate-date Save action now ends at `y=604`, Never mind ends at `y=656`, and Done remains at `x=1042, y=16, 94×64`.
2. The scan chooser used one narrow vertical stack, rendered catalog markup as text in the title, and displayed `32px` avatars inside otherwise large buttons. The revised chooser presents the book on the left and a `2×2` learner grid on the right, sanitizes the title through the normal book presentation path, and displays `72px` avatars. The four learner buttons are each about `279×98`; Dismiss ends at `y=591`.

The mode chooser also benefited from the shared side-by-side task layout. Its three mode choices are `512×64` at `y=320`, `397`, and `473`; Never mind is `512×44` at `y=550`. All controls and book context fit together.

No measured post-change surface exceeded `1280×800`, and no measured action was shorter than `44px`. The closest intentional edge is the shelf's See all history action at `x=990, y=732, 146×52`, leaving `16px` below it. Other useful bounds were:

| Surface | Lowest essential control | Bounding box | Bottom margin |
| --- | --- | --- | --- |
| Shelf | See all history | `x=990, y=732, 146×52` | `16px` |
| ISBN unavailable | Try again | `x=583, y=693, 114×52` | `55px` |
| Update page/minutes pad | Never mind | `x=584, y=625, 552×44` | `131px` |
| Alternate date with error | Never mind | `x=604, y=612, 512×44` | `144px` |
| Scan, four learners | Dismiss | `x=818, y=539, 97×52` | `209px` |

Post-change screenshots from the neutral `User_4` fixture include `docs/_wip/audits/user_4-reading-shelf/09-reread-progress-pad.png`, `10-alternate-date.png`, `11-scan-choose-learner.png`, `12-scanned-book-actions.png`, and `13-scan-finish-credit.png`.

## Rendered state coverage

The completed geometry pass measured 27 rendered surfaces:

- empty, active, finished-only, and mixed collections; obligation text; recent finishes; save receipt combined with a required shelf refresh;
- empty history and multi-month history containing finished and set-aside books;
- ISBN entry, lookup, normal and deliberately long metadata, missing metadata, unavailable-catalog retry, an active duplicate, a prior finish, Read again, page entry, and the add failure/refresh state;
- page, minutes, and check-in books; base actions; progress-mode chooser; page and minutes pads; check-in failure; alternate date and date failure;
- a completed book with a long title, finish context, recorded time, and Read again;
- scan loading and ready with four learners.

The first parameterized run timed out while traversing several expected failure branches. Shelf loading, shelf load failure, add alternate date, page/minutes write errors, scan missing metadata, invalid scan, scan catalog warning, claim failure, and claim-in-progress remain pending a clean targeted rerun. Their harness failures are not counted as layout failures or as measured passes. Two neutral-fixture rerun attempts were interrupted when Vite dependency re-optimization aborted module requests and left fresh browser pages blank; this was reproduced as `net::ERR_NETWORK_CHANGED` across the frontend module graph and cleared after warming the dev server.

The existing reading-shelf contract flow separately covers a scan arriving while ISBN entry is in progress, learner claim, direct shelf launch, finish, receipt, and agenda credit. On the merged runtime, three cases passed together; the one case whose fresh browser hit a blank page during Vite dependency re-optimization passed on its immediate isolated rerun (`1/1`, `6.7s`). Taken together, all four behavior cases passed. Physical-device evidence separately covers waking Fully Kiosk from screen-off to the same foreground Portal page without reload. No real ISBN scan was sent during this browser audit.

## Interim acceptance result

The revised landscape layout resolves the two blocking visual defects and fits all 27 measured reading-shelf surfaces at `1280×800`. History remains scrollable by design while its navigation controls stay visible. The four-case reading-shelf behavior contract passed. Full visual acceptance remains limited by the unmeasured failure-state branches listed above; no layout defect was observed in them, but the audit does not count an unrendered state as a pass.
