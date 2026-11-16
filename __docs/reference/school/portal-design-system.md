# School Portal design and runtime contracts

The School browser composes existing learning programs through a surface, activity metadata and a layout frame. Pedagogy and authorization stay with each program's server services. This reference describes the installed browser contracts; it does not imply deployment or content enrollment.

## Surface and layouts

`browser/portal/SchoolSurface.jsx` exports `SchoolSurfaceProvider` and `useSchoolSurface`. A provider accepts `surfaceId`, `deviceId` and `density` (`touch` or `compact`), measures its containing element, and supplies bounds, an overlay root, a resource store and a School API client. Device identity belongs to that mounted surface. Nested providers reuse the house theme rather than layering another theme over an activity.

`SchoolActivityFrame` exposes `title`, `identity`, `progress`, `actions`, `feedback`, `onBack`, `onDone` and children. Layout names are `workspace`, `focus`, `split`, `media` and `board`. Flex children have bounded, shrinkable content regions; an activity uses container measurements rather than a screen-resolution request or viewport-fixed stage. Card Ladder retains its authored reference coordinates and scales them into the available stage.

`SchoolButton` and `SchoolSelect` wrap the house UI controls. Button variants are `primary`, `secondary`, `choice` and `plain`; controls preserve native props, refs, form submission and existing classes. `activation="press"` owns touch-down activation and suppresses the matching release click. Existing explicit pointer handlers remain valid. Busy buttons disable activation. Semantic `--school-*` roles resolve to the house `--ds-*` palette at the surface boundary. Instructional art, board and currency colors remain domain-specific.

## Activity metadata and ownership

`browser/activities/activityManifest.js` is the browser source for activity labels, layouts, aliases, capabilities, availability and launch requirements. `programs.js` remains a compatibility facade. `SchoolActivityHost` maps root workspace activities to their existing renderer and applies the declared frame. Unavailable renderers present a visible return action.

| Family | Presentation owner |
| --- | --- |
| Home, subjects, library, catalog, progress, print | Root activity host |
| Quiz, geography drill, probes, remediation, basic and rich flashcards | Root activity host |
| Sentence Ladder, Reels, Card Ladder, Rubik's Cube, Gratitude, debrief | Existing program adapter inside root activity host |
| Book log, economy bank, companion readalong | Existing service adapter inside root activity host |
| Agenda, treasure/rewards, launch card and preview | Portal shell, scoped overlays and self-service composition |
| Reading session and media lesson | Their existing independently mounted widget providers |

The manifest includes composed widgets and overlays as well as root renderers; it is not permission to instantiate every entry through `SchoolActivityHost`. Writing is explicitly unavailable. `useSchoolActivityState` gives the workspace one active activity; clearing an obsolete activity lane cannot clear its replacement.

Report links name a program and instance through `/school/program/:program/:instance`. Opening such a route requests a fresh server launch. URLs and manifest requirements never reconstruct grants or authorize a learner. Existing launch validation still checks learner and required grant fields before mounting.

## Reads, writes and realtime

Use `useSchoolApi` or the feature hooks in `runtime/useSchoolFeatureApi.js` inside a surface. Feature facades retain endpoint and grant semantics while using the supplied transport. Standalone legacy API exports remain compatibility entry points. See [failure policy](./failure-policy.md) for response envelopes, causal GET generations, resource states, bounded retention, cancellation and safe diagnostics.

`useSchoolResource` owns read state; `useSchoolInvalidation` coalesces School/State Gates events and repairs on visibility and websocket reconnect. It removes listeners and pending timers on cleanup. Keys include effective surface/device, learner and query identity. Rewards and agenda share a ring-gates read within the same surface, while preserving each field's last successful verification time. Refresh failures keep useful data visibly stale. A cached response never grants credit, launches protected work or authorizes a purchase.

Teacher writes are single-flight from the first activation, settle busy state after thrown failures and ignore UI callbacks after teacher changes or unmount. Resources created by a request, such as marked-sheet object URLs, still have explicit disposal independent of those callbacks. Catalog, print and geography failures expose retry and remain distinct from valid empty collections.

`useSchoolCommands` owns one command dispatcher with surface activation, physical key mapping, IME and modifier guards, input policy and priority. Modal commands take priority over the background activity; hosted rewards trap and restore focus inside the surface overlay root. Passive scanner, composition and stall observation retain their specialized owners.

## Durable work, economy and media

The browser advances tracked work after durable acknowledgments. Rich flashcards display opening, failed-open and unrecorded-review states; retries retain the card. Reels derive learner and reel from a current grant, validate authored item ids and correctness on the server, and require persisted prerequisite attempts before stage progression. Media and optional speaking remain participation evidence rather than invented mastery.

Capture generations invalidate pending microphone permission after cancellation or unmount. A late stream is stopped before recorder construction. Preview audio, tracks, timers and object URLs have explicit owners and cleanup.

Material playback reports natural completion separately from player clearing. Closing a player cannot manufacture completion. School records learning evidence through its existing services; [economy](../economy/economy.md) owns pricing, payouts, balances and ledger writes. The debrief labels weekly earnings preview as a weekly preview rather than claiming that an unrelated balance change was earned by that debrief. Playback uses the public playback capability and existing media lesson/session services; the Portal does not introduce a second media engine.

## Adding or changing an activity

1. Add metadata and required launch fields to the manifest; mark unsupported delivery unavailable.
2. Keep authorization and evidence recording in the existing server owner. Add an adapter to the root host or the appropriate independently mounted widget owner.
3. Compose a frame and shared controls, use container bounds and semantic tokens, and register commands through the scoped dispatcher.
4. Use scoped API/resource hooks, explicit status/error/retry behavior and event invalidation. Define cleanup for acquired resources and pending writes.
5. Verify durable acknowledgment, learner changes, exit, touch/keyboard behavior and a constrained host. Use the isolated Portal fixture for viewport, overlay and focus checks.

`npm run audit:ui` scans School with a separate per-file baseline for reviewed legacy styling and passive listeners. New `portal`, `runtime` and `activities` mechanisms have no baseline allowance; native controls, raw command listeners and undefined tokens fail the gate. The original global baseline is unchanged. This ratchet intentionally leaves authored legacy artwork and motion for focused visual redesign rather than claiming every old stylesheet has been eliminated.
