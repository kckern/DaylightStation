# Browser apps, Admin and room displays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a live account for personal web apps, restrict Admin to adult household owners/admins, and keep room screens usable without a person login.

**Architecture:** Drive the web route gate and navigation from the server's effective app grants. Keep direct entry, embedded entry, underlying resource APIs and media delivery within the same authorization boundary. Room widgets use a narrow projection of the data approved for that room.

**Tech Stack:** Node.js ≥22.13, ES modules, Express 5, React, the existing YAML stores and Vitest.

**Spec:** [Identity, access, and policy scope](../specs/2026-11-26-identity-and-access-design.md). Start with the [foundation and rollout order](2026-11-26-identity-and-access.md).

## Global Constraints

- One installation can serve multiple households.
- Personal browser apps require a signed-in user. Admin requires a signed-in adult owner or admin of the active household.
- Kids have no login credentials. A future teen login cannot grant administrative authority.
- Kiosks never prompt for browser login. Piano and School can trust a tap or card for participation. Selected games and overrides can require a biometric match with user or admin authority.
- Named and unnamed guests can play Piano, do guest work in School, and use a heart-rate monitor in Fitness. Neither kind of guest earns Fitness rings.

## Review Focus

1. An unauthenticated localhost, reload, `/app` alias or shared screen attempts to mount Admin or load private data before the access check (B1/B3).
2. A future teen token contains a stale admin role, or an ordinary adult selects a teacher in local storage. Require live eligibility and the actual actor's grant (B1/B5).
3. A personal selection, a household summary, or a room/device command admits another person's data or a forbidden effect. Test cached and fresh responses across B2a–B2d.
4. A room with an embedded Finance or Health widget gets transactions or personal history, or a participant leaks into the next subapp (B3).
5. A copied media URL, Range response, manifest, or cast target changes household or outlives the session. Verify the grant at delivery and on subsequent operations (B4).

---

F1–F5 supply memberships, `GET /api/v1/auth/me`, routes and server decisions. Reuse the existing login/claim/invite components. The normal browser route set lives in `frontend/src/main.jsx`. The Admin tree mounts its own `AdminSessionBoundary`. S1 supplies device authentication for managed displays, K1 the optional participant context, and P3 mandatory playback profile selection.

## File structure and task order

| Task | Responsibility and principal code owner |
|---|---|
| B1 | Gate personal routes and the whole Admin application before mount · `frontend/src/main.jsx` |
| B2a | Scope private person records to the authorized subject · `__app_modules/wellness/health/server/api/routers/health.mjs` |
| B2b | Shape Finance and Auto responses by account, category and vehicle grant · `__app_modules/money/finance/server/api/finance.mjs` |
| B2c | Personalize Home views and enforce per-resource read/control grants · `__app_modules/household/home/server/api/home-dashboard.mjs` |
| B2d | Distinguish personal Media history, household curation and room playback · `__app_modules/media/media/server/api/mediaHouse.mjs` |
| B3 | Keep room displays open and constrain embedded subapps · `frontend/src/composition/screens/ScreenRenderer.jsx` |
| B4 | Authorize media bytes, provider proxies and playback grants · `__capabilities/content-catalog/server/application/proxy/MintPlaybackStream.mjs` |
| B5 | Manage membership, owner succession, invitations and scoped sessions · `__backend/src/4_api/v1/routers/admin/household.mjs` |
| B6 | Give authorized owners and admins a dedicated Identity & Access section · `frontend/src/Apps/AdminApp.jsx` |

Source paths and test commands are relative to the DaylightStation checkout. New tests below use Vitest unless a command specifies another runner. Each assertion block lists the cases for the named test file. Build test inputs locally using the listed fixtures and real owner interfaces.

### B1. Gate personal routes and the whole Admin application before mount

**Files**

- Create `frontend/src/modules/Auth/useAccessSession.js`.
- Modify `frontend/src/main.jsx`.
- Modify `frontend/src/Apps/AdminApp.jsx`.
- Modify `frontend/src/modules/Admin/shared/AdminSessionBoundary.jsx`.
- Modify `frontend/src/modules/Auth/AuthGate.jsx`.
- Modify `frontend/src/modules/Auth/PhoneServiceAuth.jsx`.
- Modify `frontend/src/modules/Auth/PublicAuthContext.jsx`.
- Modify `frontend/src/modules/Auth/LoginScreen.jsx`.
- Modify `frontend/src/modules/Auth/SetupWizard.jsx` and `frontend/src/modules/Auth/InviteAccept.jsx` for cookie-only browser enrollment.
- Modify `frontend/src/lib/auth.js`.
- Modify `frontend/src/lib/api.mjs`.
- Modify `frontend/src/composition/participants/participantLaunchClient.js` at its direct `ds_token` read.
- Modify `frontend/public/sw.js` and test `tests/unit/frontend/serviceWorkerShellCache.test.mjs` for cache admission of private responses.
- Modify `frontend/src/lib/appRegistry.js`.
- Modify `frontend/src/modules/AppContainer/AppContainer.jsx`.
- Modify `frontend/src/modules/Admin/shared/useAdminSessionKey.js`.
- Modify `frontend/src/composition/school/teacher.jsx`.
- Test `frontend/src/modules/Auth/AuthGate.access.test.jsx`.
- Test `tests/isolated/api/access/adminEntry.test.mjs`.

**Interfaces**

- Consumes F4 `/auth/me` and F5 per-op guards. `apps` lists server-admitted application IDs for the active account and household. Explicit household selection means visiting its configured origin and obtaining a valid session in it.
- Produces `<AuthGate app="admin|media|health|home|auto|finance|feed|life|teacher|call">` renders loading, login, denied, unavailable with retry, or app. `useAccessSession()` returns `{state,householdId,accountId,personId,apps,refresh}`. The server checks `admin.enter` for the entire Admin HTTP boundary, plus action-specific permission at each leaf.

- [ ] Write `a live adult household owner/admin alone can mount Admin` with these assertions.

  ```js
  expect(views).toMatchObject({signedOut:'login',adult:'denied',owner:'admin',admin:'admin',futureTeen:'denied',revoked:'login'})
  expect(privateRequestBeforeCheck).toBe(0)
  expect(localhostSignedOut.status).toBe(401)
  expect(foreignOwnerInB.status).toBe(403)
  expect(kioskRoute.loginMountCount).toBe(0)
  expect([offlineCheck.view, deniedCheck.view]).toEqual(['retry','denied'])
  expect([privateReadsBeforeRestoreCheck, staleResponsesAfterSwitch]).toEqual([0,0])
  expect([noGrantsAtRoot.view, validInvite.view, usedInvite.view]).toEqual(['no-grants','accept-invite','invite-unavailable'])
  ```

- [ ] Run `npm run test:file -- frontend/src/modules/Auth/AuthGate.access.test.jsx tests/isolated/api/access/adminEntry.test.mjs`. Expect failure on the current localhost/token-only gate or a phone-only post-render check.
- [ ] Replace local JWT decoding as proof with a live session query and role/age evaluation on the server. Protect `AdminApp.jsx` outside every child route, provider and test harness. Keep its existing remount boundary for session changes. Guard Health, Media, Home, Auto, Finance (`/budget`, `/finances`), Feed, Life and `/school/teacher/*` before their effects fetch data. Subsequent 401/403 events clear or update the right personal surface and re-check grants. A 403 shows access denied without looping to login. Include `householdId` in the remount key. Distinguish an owner of A who is an ordinary member in B (403 in B) from a credential issued for A presented to B (foreign household). Include the `/admin/test/combobox` deep link and dedicated `/school/teacher-next` redirect in fixtures.
- [ ] Register direct app IDs, redirects, `/media/channels/*`, screen-hosted apps, `/dev/*`, `/filter-poc`, party host/verifier, `/call`, setup and invite with an explicit policy for each. `/tv`, `/office`, `/piano`, `/fitness`, learner `/school`, and bare `/screen[s]` retain their separate entry mode. Skip public setup/login redirects on a station. If an adult-only app is chosen from a station, show it is unavailable on this screen. Its direct personal browser URL uses the standard gate.
- [ ] Treat a personal browser opening `/call` as a signed-in caller with permission for the chosen destination. A paired intercom/TV uses its device grant and existing call lease without prompting for a human login. Apply the Media gate to a personal live channel unless the channel is explicitly published to an open audience.
- [ ] Classify `/dev/*`, `/filter-poc` and test harness deep links in the installed manifest. Development-only entries are unavailable in production by default. An intentionally exposed diagnostic with real data needs the adult Admin gate and its diagnostic action. An open fixture may contain only the declared public sample data.
- [ ] Use F4's cookie-only sign-in, setup, claim and invite flows. Verify `/auth/me` even when browser preference storage is unavailable. Show a cookie-specific error if sign-in succeeded but the browser cannot retain the session. Migrate `ds_token` only after server validation for the same household/session, then remove it. Remove unusable legacy tokens. Preserve authorized native/CLI bearer flows and existing cross-site defenses. An invalid bearer cannot fall back to a cookie for a different identity.
- [ ] Open a validated same-origin deep link after sign-in. At `/`, show the user's allowed apps with a signed-in empty state for zero grants. Recheck on tab restore and browser Back before revealing private content. Signal session changes across tabs without sharing credentials. Abort old requests, ignore late responses and clear the previous private view and persistence on logout, expiry or account/household switch. Recheck affected grants on a 403. Use a retry screen for an unavailable session check.
- [ ] Cover the route chunk preload in `frontend/src/main.jsx`. Health currently calls `hydrateHealthCache()` at module evaluation. Move private cache hydration and private subscriptions behind the confirmed data owner even when static JS loads early. With an old disk snapshot and delayed session validation, assert zero private storage reads, private paints and subscriptions before admission.
- [ ] Exercise the spec's entry and recovery states from a deep link, normal restart and first setup. Keep the staged owner-acceptance and invite routes reachable before normal app entry for exactly the intended enrollment. Return a replacement-invite message for expired, canceled or already-used links. Opening the same URL while signed in as a different adult requires explicit authentication of the intended account. Test that a device/room receives its station state even when setup or personal sign-in is pending.
- [ ] Admit only public shell/assets to the shared service-worker cache. Exercise a private image alias outside `/api` and `/media`, and a response marked `Cache-Control: no-store`. Run `npm run test:file -- tests/unit/frontend/serviceWorkerShellCache.test.mjs`. Keep any app-specific private persistence behind its confirmed data owner.
- [ ] Run `npm run test:file -- frontend/src/modules/Auth/AuthGate.access.test.jsx tests/isolated/api/access/adminEntry.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(web): require server-confirmed access before mounting private apps"`.

### B2a. Scope private person records to the authorized subject

**Files**

- Modify `__app_modules/wellness/health/server/api/routers/health.mjs`.
- Modify `__app_modules/wellness/health/server/api/routers/health-dashboard.mjs`.
- Modify `__app_modules/wellness/health/server/composition/healthApi.mjs`.
- Modify `__app_modules/personal/life/server/api/life.mjs`.
- Modify `__app_modules/media/feed/server/api/feed.mjs`.
- Modify `__backend/src/3_applications/common/context/DefaultPrincipalResolver.mjs`.
- Modify `__capabilities/lifelog/server/api/lifelog.mjs`.
- Modify `__app_modules/wellness/health/server/api/routers/health-mentions.mjs`.
- Modify `__app_modules/wellness/health/server/composition/lifelog-weight.mjs`.
- Modify `__app_modules/wellness/health/browser/healthCache.js`.
- Modify `__app_modules/wellness/health/browser/HealthApp.jsx`, `__app_modules/wellness/health/browser/operations/healthOperations.js` and `__app_modules/media/feed/browser/offline/feedOfflineStore.js` for household and subject changes.
- Modify `__app_modules/wellness/health/server/application/health/HealthOperations.mjs` at coaching subject resolution. Check `__app_modules/wellness/health/server/adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs` and `__app_modules/wellness/health/server/adapters/persistence/PhotoStore.mjs` using the real test stores.
- Modify `__app_modules/media/feed/server/application/services/FeedPrincipalResolver.mjs`.
- Modify `__app_modules/personal/life/server/api/life/identity.mjs`.
- Modify `__app_modules/personal/life/server/api/life/log.mjs`.
- Modify `__app_modules/personal/life/server/application/LifeApiOperations.mjs`, `__app_modules/personal/triage/server/api/triageRouter.mjs` and `__app_modules/personal/journalist/server/api/journalist.mjs` for private collections, counts and queued actions.
- Test `tests/isolated/api/access/personalBrowserData.test.mjs`.
- Test `__app_modules/wellness/health/browser/HealthApp.routing.test.jsx` and `__app_modules/wellness/health/browser/operations/healthOperations.test.js`.

**Interfaces**

- Consumes F2 per-person storage, live active membership, server-resolved resource ownership and F3 decisions for personal reads and writes.
- Produces `health.read`, `health.write`, `life.read`, `life.write`, `feed.read` and the remaining catalogued leaf actions apply `self` or an explicit household-bound delegation to their resources.

| Health entry point | Current routing seam | Expected owner |
|---|---|---|
| `/health/context`, `/health/medical`, nutrition photos and audio | The main router's `getDefaultUsername(req)` checks `req.user.sub` and then falls back to the configured default. The medical and attachment stores already take a user key. | The authorized subject's storage key for lists, mutations and actual file reads |
| `/lifelog/weight` | The route reads `req.user.username`. The token resolver supplies `sub`. The weight service's resolver can consequently choose the head. | The same person as the Health dashboard, including for a second adult |
| `/health/coaching/:date`, `/health/mentions/*`, `/health-dashboard/:userId` | Coaching and mentions accept a query selector. Generated dashboards take a person in the URL. | Treat the selector as a requested resource and authorize reading, editing or deleting for that specific person |
| Browser cache, background harvest and coaching job | Health currently claims its cache by `userId`. The Withings harvester takes a username and coaching composition contains head-of-household defaults. | B2a owns browser isolation. S3 and S5 supply explicit person bindings to offline writers and their outputs. |

- [ ] Write `private records use the active person even when a head or another username is supplied` with these assertions.

  ```js
  expect(ownHealth.data.marker).toBe('a-sam-private')
  expect([otherHouse.status,otherOwnerUndelegated.status]).toEqual([404,404])
  expect(authorizedDelegation.data.marker).toBe('a-delegated-private')
  expect(missingUser.status).toBe(401)
  expect(headFallbackCalls).toBe(0)
  expect([newMember.readings, otherAdult.unexpectedWrites, sameNameInOtherHouse.unexpectedWrites]).toEqual([[],0,0])
  expect([caregiverRead.status, readOnlyCaregiverWrite.status]).toEqual([200,403])
  expect(await readMedicalValues('a','patient')).toContain(expectedValue)
  expect(secondAdultsWeightChart).toEqual(secondAdultsStoredWeights)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/personalBrowserData.test.mjs`. Expect failure when a default-head or selected username still determines a private read.
- [ ] Resolve the legacy username/storage key from the active household/person link. Require an explicit delegated read/write with resource ownership for legitimate caregiver views. Check reference ownership for list queries, blobs/photos, patches, history and background operations. A human credential by itself cannot authorize another member's health history.
- [ ] For each Health route family record the action, how it selects its subject, and which store receives the resolved key. Cover medical CRUD, weight/lifelog, nutrition capture and attachments, coaching, mentions, agent dashboards and chat. Start a browser request from the live membership. Resolve an explicitly delegated subject before calling `ScopedPersonData.forPerson(hid,personId)`. Use its storage key for every downstream read and write, including generated summaries and files. Remove head-of-household fallbacks from personal HTTP entry points. Route shared device/workload operations through B3 or S3/S5 with their own subject bindings.
- [ ] In a temporary data tree, post readings for two adults in one home and a same-named person in another. Read, edit and delete through the normal API and inspect all three stores. Query each dashboard, attachment and suggestion list. Check that a caregiver change reaches the patient's store and records the actor in the audit. Verify that a new member sees an empty history and an ambiguous legacy mapping produces an error without touching a store.
- [ ] Use confirmed household/account/subject keys before hydrating Health snapshots, barcode operations or downloaded Feed editions. Discard late reads and prevent pending mutations crossing a subject switch. Check the legacy username-only cache and Feed's generic `household` bucket before reuse. Only restore data whose owner can be established. Test A → B → A including equal person labels across households, a delayed A response and a reopened tab. Run `npm run test:file -- __app_modules/wellness/health/browser/HealthApp.routing.test.jsx __app_modules/wellness/health/browser/operations/healthOperations.test.js`.
- [ ] Use the selected household's service factory, dates/timezone, stores and user-specific providers for Health/Health Dashboard, Life/Lifelog and Feed. Remove implicit head/default behavior from these *browser* paths. Supply an explicit principal to genuine background jobs in S5. Partition personal API caches and web persistence by household/account/person. Check the cached `life.username`, `/log/:username`, and mentions' user selector against the same delegation. The existing Triage `requireOwnerSession` is a scoped precedent.
- [ ] In `personalBrowserData.test.mjs`, use distinct Feed subscriptions, unread counts, Triage summaries/cards, Life plans and Lifelog mail snippets for two adults. Check list totals, search results, cached annotations and exports as well as detail reads. Keep installation health diagnostics on a separate declared projection if needed. Verify a Triage reader can inspect a permitted card and cannot send, close, archive or undo it without the corresponding action. Bind Journalist/Work inputs and agent outputs to their original person on replay (S5).
- [ ] Run `npm run test:file -- tests/isolated/api/access/personalBrowserData.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(web): scope health life and feed records to the authorized person"`.

### B2b. Scope Finance and Auto within the household

**Files**

- Modify `__app_modules/money/finance/server/api/finance.mjs`.
- Modify `__app_modules/money/finance/server/composition/financeApi.mjs`.
- Modify `__app_modules/household/auto/server/api/automotive.mjs`.
- Modify `__app_modules/household/auto/server/composition/automotiveApi.mjs`.
- Modify `__app_modules/money/finance/server/application/FinanceApiService.mjs` and `__app_modules/money/finance/browser/hooks/useFinanceData.mjs`.
- Modify `__app_modules/household/auto/server/application/usecases/GetVehicleOverview.mjs` and `__app_modules/household/auto/browser/AutoApp.jsx`.
- Test `tests/isolated/api/access/householdBrowserData.test.mjs`.

**Interfaces**

- Consumes F2 explicit household runtime, F3 action + resource owner and B1 authenticated browser entry.
- Use F3's data context for household, account, budget category and vehicle resources. Register named responses for a granted budget summary, account detail, basic vehicle status, location/trips and document bytes. The `finance.read` and `auto.read` entry grants constrain which summary a caller may open. Extra fields and effects need their own grant. Preserve the normal full response for callers authorized for it.

- [ ] Write `the browser cannot redirect a household read, provider call or command to a second household` with these assertions.

  ```js
  expect(ordinaryReader.financeRead.status).toBe(200)
  expect(ordinaryReader.financeWrite.status).toBe(403)
  expect(foreignFinance.status).toBe(404)
  expect(foreignCarDocument.bytes).toHaveLength(0)
  expect(targetB.commands).toEqual([])
  expect(categoryOnly.response).toEqual({category:'groceries',remaining:fixtureRemaining})
  expect([hasMortgageOrPayee, hasGpsOrTripCoordinates, deniedProviderCalls]).toEqual([false,false,0])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/householdBrowserData.test.mjs`. Expect failure on query/body-selected household or a boot-bound service.
- [ ] Replace `financeService.householdId(requested)` with the verified household context. Add `GET /api/v1/finance/summary/categories/:categoryId` for the granted category and remaining amount, using the existing budget calculation. Keep mortgage, account, payroll, memo and transaction detail in their own authorized responses. Scope collection totals and account/provider selection. Restrict refresh, categorization, compilation, syncing and edits independently. A read-shaped request that contacts the provider must check the provider operation before making the call. A summary-only Finance client must not preload the full budget/mortgage response.
- [ ] Bind Auto queries, commands and file delivery to the granted vehicle and resource. Return the allowed overview fields, and compute its counts/reminders from admitted data. A maintenance viewer may read the next service date without GPS, place coordinates, trip details, recordings or document names. Verify direct file, location and mutation paths independently. A room can consume only its B3 display projection.
- [ ] Run `npm run test:file -- tests/isolated/api/access/householdBrowserData.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(web): scope household app reads and commands"`.

### B2c. Return a personal Home view over the household inventory

**Files**

- Modify `__app_modules/household/home/server/api/home-dashboard.mjs`, `__app_modules/household/home/server/composition/homeApi.mjs`, and the handlers in `__backend/src/4_api/v1/handlers/home-dashboard/`.
- Modify `__app_modules/household/home/server/application/home-automation/usecases/GetHomeEntities.mjs`, `__app_modules/household/home/server/application/home-automation/usecases/GetHomeTimeline.mjs` and `__app_modules/household/home/server/application/home-automation/usecases/ActivateDashboardScene.mjs`.
- Modify `__app_modules/household/home/server/api/homeAutomation.mjs`, `__app_modules/household/home/server/composition/events.mjs` and `__app_modules/household/camera/server/api/camera.mjs`.
- Modify `__app_modules/household/home/browser/HomeApp.jsx`, `__app_modules/household/home/browser/entities/useHomeEntities.js` and `__app_modules/household/home/browser/hooks/useHomeDashboard.js`.
- Test `tests/isolated/api/access/homeViewer.test.mjs` and `__app_modules/household/home/browser/HomeApp.test.jsx`.

**Interfaces**

- Consume F3's verified data context, the household dashboard config and the existing Home entity, summary, mosaic and timeline policies. Keep shared device state in the household store.
- Preserve existing entity IDs and response fields for authorized readers. Return an `allowedActions` list on an admitted command target. Add `GET/PATCH /api/v1/home-dashboard/preferences/me` for `{startView,pinnedEntityIds,roomOrder,revision}`. Resolve the person from the live membership and use F2's person store. Use the supplied revision for a conditional update.

- [ ] Write `a restricted viewer can personalize Home and see only the granted part of the household`. Include an adult with ordinary grants and a synthetic future teen with identical read grants. Test normal v1 teen enrollment separately in F4.

  ```js
  expect(view.entities.map(e => e.id).sort()).toEqual(['garage.light','kitchen.temperature'])
  expect(view.entities.find(e => e.id === 'garage.light').allowedActions).not.toContain('home.control')
  expect([viewedHiddenRoomName, hiddenMotionInTimeline, hiddenPowerInSummary]).toEqual([false,false,false])
  expect([saveOwnPins.status, toggleGarage.status, liveCamera.status, cameraClip.status]).toEqual([200,403,403,403])
  expect([gatewayCallsAfterDenial, oldAccountPinsInNewView]).toEqual([0,0])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/homeViewer.test.mjs __app_modules/household/home/browser/HomeApp.test.jsx`. Expect failures on household-wide responses and the browser-wide last-view preference.
- [ ] Pass the data context into config/state/entities/history/timeline reads. Intersect configured dashboard admission with resource and field grants before deriving room labels, totals, summaries and mosaic. Limit upstream links and camera directory entries. Future authorized household totals use an explicitly registered aggregate. Merge shared events with person-authorized calendars and tasks without selecting the head by default.
- [ ] Register distinct grants for `home.read`, `home.history.read`, `home.control`, `home.scene.activate`, `home.preferences.write`, `camera.live.read`, `camera.recordings.read` and `camera.control`. Check resource ownership at snapshots, HLS segments, recordings, control and scene dispatch. Test `/home` and `/home-automation` aliases, GET-shaped TV/volume/script commands, and bulk/room controls. A scene must have approved effects for this caller. Refuse the entire group command before its first effect if a target falls outside the grant.
- [ ] Apply defaults and then the member's preferences to permitted resources. An old or removed pin is omitted and cannot restore access. Deny editing another member's layout or the household config through the self endpoint. Render controls from allowed actions and refresh on a refusal or policy change. Verify that granting just the garage-light control adds that one control and that revocation removes it, including from an open subscription.
- [ ] Repeat the two test files above. Expect allowed preferences to persist for the same member across browsers and all refusal cases to leave the gateway untouched.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(home): scope dashboard responses and commands to the viewer"`.

### B2d. Scope Media history, shared curation and screen playback

**Files**

- Modify `__app_modules/media/media/server/api/media.mjs`, `__app_modules/media/media/server/api/mediaHouse.mjs`, `__app_modules/media/media/server/application/HouseholdMediaMemoryService.mjs` and `__backend/src/4_api/v1/routers/device.mjs`.
- Modify `__app_modules/media/media/server/adapters/persistence/YamlMediaQueueDatastore.mjs`, `__capabilities/playback/server/application/usecases/MarkContentWatched.mjs` and `__capabilities/playback/server/adapters/persistence/YamlMediaProgressMemory.mjs`.
- Modify `__app_modules/media/media/browser/MediaApp.jsx` and `__app_modules/media/media/browser/session/LocalSessionProvider.jsx`.
- Test `tests/isolated/api/access/mediaAudienceState.test.mjs`.

**Interfaces**

- Use F3 data contexts for a person, a household collection, or an authorized screen/activity. Keep the existing household favorites and queue formats. B4 owns byte delivery and P3 owns audience-specific playback filtering.
- Bind recent plays, Carry On, watched/unwatched, announcements and live broadcasts to their actual owner and audience. Return the person's resume position for personal playback. Use the screen/session position for unattributed room playback. Explicit sharing can admit a play into household activity.

- [ ] Write `two people share favorites and a queue while keeping distinct resume positions for the same film`. Assert that a room play credits zero people by default, that marking watched for A leaves B's progress unchanged, that move/cast requires authority over both targets, and that another household receives zero frames. Use overlapping film and device IDs.
- [ ] Run `npm run test:file -- tests/isolated/api/access/mediaAudienceState.test.mjs`. Expect failure on global watched state, local-session restore or unscoped broadcast.
- [ ] Resolve the household from the verified request on Media, queue and fleet aliases. Keep browsing distinct from adding favorites, enqueuing, rearranging/clearing, playback control, moving a session and fleet administration. Check the grant at the device dispatch boundary. `/media/screens` owns fleet state and `/screens` owns room layout.
- [ ] Key private progress, recommendations derived from history, pending playback updates and their subscriptions by household and person. Scope room recovery state to the actual device/session. Migrate unambiguously personal history to its owner. Preserve historical household playback in the shared collection according to its existing audience. Never copy ambiguous plays into every member's personal resume list.
- [ ] Run the same test file after migration, restart, switch and revocation fixtures. Expect distinct positions, preserved shared curation and no out-of-scope playback effects.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(media): scope personal progress and shared playback state"`.

### B3. Keep room displays open and constrain embedded subapps

**Files**

- Create `__capabilities/screen-host/server/application/RoomProjections.mjs`.
- Modify `frontend/src/composition/screens/ScreenRenderer.jsx`.
- Modify `frontend/src/composition/screens/widgets/builtins.js`.
- Modify `frontend/src/modules/AppContainer/AppContainer.jsx`.
- Modify `__capabilities/screen-host/server/application/ScreensQueryService.mjs`.
- Modify `__app_modules/personal/weekly-review/server/api/weekly-review.mjs`, `__app_modules/personal/weekly-review/server/adapters/WeeklyReviewCalendarAdapter.mjs` and `__app_modules/personal/weekly-review/server/adapters/WeeklyReviewSchoolAdapter.mjs`.
- Modify `__app_modules/personal/calendar/server/api/calendar.mjs`, `__app_modules/personal/gratitude/server/api/gratitude.mjs`, `__app_modules/household/homeline/server/api/homeline.mjs` and `__app_modules/household/share/server/api/share.mjs` at their audience or destination boundary.
- Modify `__backend/src/4_api/v1/routers/screens.mjs`.
- Modify `__backend/src/4_api/utils/participantHttp.mjs`.
- Modify `__app_modules/money/finance/browser/widgets/FinanceChart.jsx`.
- Modify `__capabilities/screen-host/browser/data/ScreenDataProvider.jsx`.
- Modify `__capabilities/screen-host/browser/panels/PanelRenderer.jsx`.
- Modify `__capabilities/content-catalog/server/api/participantLaunches.mjs`.
- Modify `__app_modules/wellness/health/browser/Weight.jsx`.
- Modify `__app_modules/money/finance/server/application/FinanceApiService.mjs`.
- Test `tests/isolated/api/access/roomProjections.test.mjs`.
- Test `frontend/src/composition/screens/ScreenRenderer.access.test.jsx`.

**Interfaces**

- Consumes F5 catalog, S1 declared/bound device for household-specific projections, K1 scoped participant selection for explicit subapps. The ad hoc screen can render open content without a person.
- Produces `RoomProjections.read({ctx,screenId,widgetId})` returns only the approved data contract for a widget on that household screen. Each embedded registration declares `participantMode:'none'|'optional'|'required'` and the admitted operations.

| Installed app IDs from `__capabilities/screen-host/portable/appIds.mjs` | Context to exercise |
|---|---|
| `keycode`, `webcam`, `controllers` | Local diagnostic/input or expressly granted device operation. Apply browser camera/device consent where relevant. |
| `family-selector`, `gratitude`, `school`, `party-games` | A projected household roster and an activity-specific claim where the action uses a person. Preserve game host/verifier and learner restrictions. |
| `weekly-review`, `glympse` | Only the review projection or location share approved for this audience and target. |
| `videocall`, `wrapup`, `office_off` | A paired device, allowed destination and action. HomeLine also checks its call lease. |
| `websocket` | A registered, authorized topic and its audience-specific response on subscribe, replay and delivery. |

- [ ] Write `a room clock renders anonymously while a household widget receives only its projected fields` with these assertions.

  ```js
  expect(adhoc.loginMountCount).toBe(0)
  expect(lounge.participants).toEqual([])
  expect(projectedBudget).toEqual({series:approvedSeries})
  expect([anonymousRawFinance.status,deviceRawFinance.status]).toEqual([401,403])
  expect(privateAppEmbedded.mounted).toBe(false)
  expect(afterScopedGame.participants).toEqual([])
  expect([privateEventTitleInRoom, unsharedLearnerImageInRoom, rawReflectionInRoom]).toEqual([false,false,false])
  expect([otherCallLeaseCanEnd, foreignShareJobVisible]).toEqual([false,false])
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/roomProjections.test.mjs frontend/src/composition/screens/ScreenRenderer.access.test.jsx`. Expect failure on widget reuse of a full private app API or inherited participant state.
- [ ] Keep `/screen`, `/screens`, named configurations, `/office` and `/tv` navigable with no login. Restrict ad hoc URL/config/menu sources and remote commands to registered open operations. Verify managed device/household ownership for richer data. `fleet:<name>` and private network status can identify a declared display for discovery. Privileged projections and actions require its verified binding. ScreenRenderer fetches config before adopting fleet identity. Serve a minimal discovery response first, then authorized layout/config after station binding. Strip disallowed data sources and widget props before ScreenDataProvider starts polling.
- [ ] Declare projection fields and actions on the actual configured widgets. For Finance/Health charts expose only an explicitly configured aggregate or authorized person's display projection for this room. An absent privacy grant hides that widget. A projected chart cannot access accounts, health histories, raw config, camera archives or presentation authoring APIs. Keep Agenda show/start on declared screens and editing with signed-in authorized hosts. Start with FinanceChart's existing `/finance/data/daytoday` projection and the room Weight widget's `/lifelog/weight` source. Assert an approved chart beside a denied transactions read, an assigned weight value beside denied history, and an allowed camera beside a denied recording.
- [ ] Use the same admission metadata for registry, `AppContainer`, URL launch, subscriptions/overlays and nested layouts. Mount a local picker only for a subapp that declares it. Clear its subject on exit and invalidate late responses/subscriptions. Coordinate snapshot and private topic access with S4. Cover query opens, queued `app:` items and `inspect/describe/begin/resume` participant launches, including a remote destination. Keep Party Games' host and verifier roles session-bound and Weekly Review drafts bound to the household and authorized review audience.
- [ ] Register all installed `SCREEN_APP_IDS` and widgets with a projection or a scoped command. For Calendar/Weekly Review, select allowed source calendars, busy-only events, approved learner showcase items, photos and shared reflections before merging or counting. Bind recordings, transcripts and draft/finalize operations to the review owner and sharing grants. For Agenda/Gratitude use only the roster projection and selected contribution for that activity. Cover a private appointment and a private learner image beside a shared event on the same day.
- [ ] Bind the HomeLine caller, allowed destination and lease at list, wake, join and end. Share target directories and job/media polling use a verified sender or authorized destination. For `wrapup`/`office_off` guard the device effect, for `websocket` guard the topic, and for `glympse` admit only an approved location share. Check local webcam/controller and key-test apps against the declared device capabilities and browser permissions. Test the same app from `/app/:appId` and from a screen.
- [ ] Run `npm run test:file -- tests/isolated/api/access/roomProjections.test.mjs frontend/src/composition/screens/ScreenRenderer.access.test.jsx`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(screens): authorize room projections and scoped subapps"`.

### B4. Authorize media bytes, provider proxies and playback grants

**Files**

- Create `__capabilities/content-catalog/server/application/proxy/PlaybackAccessGrants.mjs`.
- Modify `__capabilities/content-catalog/server/application/proxy/MintPlaybackStream.mjs`.
- Modify `__capabilities/content-catalog/server/composition/proxy-services.mjs`.
- Modify `__capabilities/playback/server/api/play.mjs`.
- Modify `__backend/src/4_api/v1/routers/proxy.mjs`.
- Modify `__backend/src/4_api/v1/routers/static.mjs`.
- Modify `__backend/src/5_composition/modules/plexSurfaceIdentity.mjs`.
- Modify `__app_modules/media/media/server/api/stream.mjs`.
- Modify `__capabilities/content-catalog/server/api/content.mjs`.
- Modify `__capabilities/content-catalog/server/api/display.mjs`.
- Modify `__app_modules/media/media/server/api/local.mjs`.
- Modify `__app_modules/media/livestream/server/api/livestream.mjs`.
- Test `tests/isolated/api/access/mediaDeliveryAccess.test.mjs`.

**Interfaces**

- Consumes F3 access decision, B2 owner and B3 authorized room projections, S1 target device, P3 audience/policy result. Ordinary static frontend assets remain publicly loadable.
- Produces The `media.play` action gates play admission. `PlaybackAccessGrants.issue({ctx,itemId,targetDeviceId,audience,policyRevision})` resolves an opaque bounded handle. `.resolve(handle,{householdId,targetDeviceId,itemId,now})` validates owner, consumer, current session/device grant, revision and expiry.

- [ ] Write `Range, manifests and embedded assets resolve only under the original play grant` with these assertions.

  ```js
  expect(validRange.status).toBe(206)
  expect(samePlayNextSegment.ok).toBe(true)
  expect([foreignCast.status,wrongItem.status]).toEqual([404,404])
  expect(afterRevocation.allowed).toBe(false)
  expect(unrestrictedUrlInRestrictedManifest).toBe(false)
  expect(bundleAsset.status).toBe(200)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/mediaDeliveryAccess.test.mjs`. Expect failure on unguarded media delivery or provider handles usable for another item/target.
- [ ] Classify metadata/art, user media, generated files, full streams, HLS manifests/segments, captions, thumbnails, Range/HEAD, downloads and provider proxy aliases by resource owner. Cover `/plex_proxy`, `/proxy`, `/static`, `/play`, `/display`, shared content endpoints and generated provider URLs at the actual byte-serving or upstream proxy boundary. Apply owner filtering to discovery and catalog SSE as well as final delivery. Separate live-channel listening from channel management, and media history attribution from resource access. Disable shared/public caching of private response bytes, including redirected images and segments.
- [ ] For clients that cannot set an auth header on a media URL, issue a short-lived opaque handle bound to a play, item, audience and authorized target. Use the existing stream minter, native range support and provider leases. Authenticate the recipient or its scoped playback session. Knowing a device name alone is insufficient. Withhold provider credentials and unrestricted upstream URLs from restricted clients. Recheck on renewal, segment access, new target, logout/revocation and audience changes. Terminate active private streams when the grant is revoked.
- [ ] Treat generated per-user media and caches as protected resources even where bytes live in a shared media filesystem. Preserve existing open assets deliberately marked as distributable and native player behavior. Test normal direct play, cast, seek, resume, stale manifests and mixed optional/mandatory filtering.
- [ ] Run `npm run test:file -- tests/isolated/api/access/mediaDeliveryAccess.test.mjs`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(media): authorize stream handles and private asset delivery"`.

### B5. Manage membership, owner succession, invitations and scoped sessions

**Files**

- Create `__backend/src/3_applications/auth/MembershipAdministration.mjs`.
- Create `__backend/src/4_api/v1/routers/accessHouseholds.mjs`.
- Modify `__backend/src/4_api/v1/routers/admin/household.mjs`.
- Modify `__backend/src/4_api/v1/routers/admin/config.mjs`.
- Modify `__backend/src/3_applications/admin/HouseholdAdminService.mjs`.
- Modify `__backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs`.
- Modify `frontend/src/modules/Admin/Household/MemberEditor.jsx`.
- Modify `frontend/src/modules/Admin/Household/SessionsIndex.jsx`.
- Add the effective browser lifetime and optional idle timeout to Admin's Identity & Access session settings. Reuse `frontend/src/modules/Admin/AdminNav.jsx` and `frontend/src/Apps/AdminApp.jsx` for its entry.
- Modify `__backend/src/4_api/v1/routers/admin/index.mjs`.
- Modify `__capabilities/content-catalog/server/api/admin/content.mjs`.
- Modify `__backend/src/4_api/v1/routers/api.mjs`.
- Test `tests/isolated/api/access/membershipAdministration.test.mjs`.
- Test `frontend/src/modules/Admin/Household/MemberEditor.test.jsx`.

**Interfaces**

- Consumes F1 persisted memberships and role/age facts, F3 role assignment rules, F4 session/invitation operations and B1 adult owner/admin entry.
- Produces `MembershipAdministration.change({ctx,hid,personId,patch,expectedRevision})` edits one authorized membership. `.transferOwner({ctx,hid,successorId,expectedRevision})` changes ownership atomically. Session and invite controls act on scoped resources only.

- [ ] Write `a household admin cannot escalate a teen or use generic configuration edits to change protected roles` with these assertions.

  ```js
  expect([teenGrant.status,selfPromotion.status,crossHouseEdit.status]).toEqual([403,403,404])
  expect(lastOwnerRemoval.status).toBe(409)
  expect(committedOwnersAfterTransfer).toContain(successorId)
  expect(tenantBCredentialDigest).toBe(originalDigest)
  expect(teenRow.canInvite).toBe(false)
  expect([ordinaryHouseAdminCreate.status,systemOperatorCreate.status]).toEqual([403,201])
  expect(correctedTeenAdmin.effectiveAdmin).toBe(false)
  ```

- [ ] Run `npm run test:file -- tests/isolated/api/access/membershipAdministration.test.mjs frontend/src/modules/Admin/Household/MemberEditor.test.jsx`. Expect failure on broad profile updates or installation-wide session/credential management.
- [ ] Give the member editor separate fields for relationship, eligibility, roles and browser enrollment. Require eligible adult targets for owner/admin. Reserve grant/transfer of household administrative authority to an eligible owner and protect the last eligible owner from voluntary concurrent demotion or archival. An authoritative age correction removes ineligible admin powers immediately, including those of the last owner. Use installation-owner recovery to appoint an eligible successor. Offer ordinary invited adults access only to their assigned apps. Show kid and teen rows as kiosk participants without credential issuance controls. Enforce the same rule via HTTP. Household members cannot change their own age eligibility or promote themselves. A conflicting age classification on linked memberships must be resolved through trusted administration before a promoted account can enter Admin.
- [ ] Implement revision-checked server mutations and audit actor, target and household. Guard raw YAML/profile editors, OAuth, scheduler, event-bus broadcast and other high-impact Admin APIs with correct installation or household scope. Redact secrets and prohibit raw config writes to credentials, roles and membership authority. Only an installation operator can create/disable households, through a dedicated installation operation. Bootstrap/transfer requires an explicit eligible owner in the affected household. Include domain-owned admin actions on the catalog by verb: Playback Hub management, Content Filter signoff, agent memory administration, School virtual devices/lifecycle, Health Coach dashboard deletion and RetroArch sync. Preserve genuinely shared read operations with their own grants. Implement `POST /api/v1/system/access/households` with `system.households.manage` for a signed-in eligible installation operator. Stage a unique ID, configured origin and explicit adult owner membership, reject duplicate mappings, and activate the household only when its scoped runtime and owner enrollment are ready. Add a second household through that path in the acceptance fixture.
- [ ] Update the Admin session roster and revocation controls to use authorized household/account views and preserve self logout. On a role or eligibility change invalidate all affected sessions, cached decisions, biometric proofs and subscriptions. Verify a role change in A cannot touch the same account's membership or sessions in B.
- [ ] Show inherited and overridden session settings, the effect of shortening a lifetime on current sessions, and each session's last activity and deadline. Gate household edits on the household policy management grant and installation defaults on installation authority. Exercise a ten-year value, disabling idle expiry, removing a household override and denial of a change to a different household.
- [ ] Run `npm run test:file -- tests/isolated/api/access/membershipAdministration.test.mjs frontend/src/modules/Admin/Household/MemberEditor.test.jsx`. Expect all named cases to pass.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(admin): manage household memberships and privileged role changes"`.

### B6. Deliver Identity & Access in Admin

**Files**

- Create `frontend/src/modules/Admin/IdentityAccess/IdentityAccessSection.jsx` and `frontend/src/modules/Admin/IdentityAccess/IdentityAccessSection.test.jsx`.
- Create `__backend/src/4_api/v1/routers/admin/accessAudit.mjs` and mount it in `__backend/src/4_api/v1/routers/admin/index.mjs`. Test its ownership filter in `tests/isolated/api/access/membershipAdministration.test.mjs` from B5.
- Modify `frontend/src/Apps/AdminApp.jsx`, `frontend/src/modules/Admin/AdminNav.jsx`, `frontend/src/modules/Admin/Household/MembersIndex.jsx`, `frontend/src/modules/Admin/Household/MemberEditor.jsx` and `frontend/src/modules/Admin/Household/SessionsIndex.jsx`.
- Modify `frontend/src/main.jsx` for the personal `/account/sessions` entry. Use B1's live-session gate with an authenticated-self mode independent of app grants, so a user with zero app grants can still revoke their own sessions. Reuse the session list and revoke controls with an explicit self scope.
- Use B5's membership operations, F4's session/invite lifecycle, S1's credential registry and P4's access-policy preview. Test the integrated section in `tests/isolated/e2e/browser-platform/household-access.runtime.test.mjs` from F6.

**Interfaces**

- Mount `/admin/identity-access/*` within the whole-Admin adult owner/admin gate. Land on People in the active household. Keep existing household member, session and device links working and point them to the same scoped resources. Other signed-in users can revoke their own browser sessions outside Admin.
- Provide People & invitations, Roles & permissions, Policy assignments, Stations & services, and Sessions & history. Offer Check access from a person or role. Show the effective rule source, its scope, any independent remaining grants, and a proposed change's impact. Gate each view and mutation on its grant.
- Provide `GET /api/v1/admin/access/audit` for the current household with `access.audit.read`. Page through access-change events from B5/P4 and credential/session lifecycle events from S1/F4. Return time, actor, change, target scope and revision where present. Exclude private record contents. Verify a second household's rows, totals and pagination cursors cannot appear.

- [ ] Write `an authorized owner manages household access without granting a login to every participant`. Cover a child roster entry, named guest, eligible adult invitation, expired/reissued invitation, an existing account joining a second household, owner transfer, scoped suspension and read-only policy preview. Verify that future teen identity and ordinary adult accounts cannot enter Admin even through a deep link.
- [ ] Run `npm run test:file -- frontend/src/modules/Admin/IdentityAccess/IdentityAccessSection.test.jsx`. Expect failure on the missing section and unscoped legacy role picker.
- [ ] Connect People and invitations to B5/F4. Label a kiosk-only member as a valid participant. Restrict grant/revoke controls and their API mutations to the actor's delegable actions, target scopes and eligible people. Having permission to perform an action alone does not delegate it. Use explicit grant-management authority for ordinary grants and reserve owner/admin assignment for an eligible owner. Show active, pending, expired, revoked and suspended states at the appropriate account, membership or invite. Expose owner transfer and local-operator recovery as distinct journeys.
- [ ] Reuse P4 for preview and activation. Show that removing a person's direct grant can leave effective access through a role. Use the same versioned save for editors reached directly or from a person. Use F4's session controls and S1's device/service credential operations. Present browser lifetime, effective scope and recent changes without exposing protected content or reusable secrets.
- [ ] Run the same component test and the F6 installed-browser test after the dependent tracks land. Expect an eligible owner to complete the invite, scoped grant and revoke while an ordinary admin cannot appoint a new admin or change another household.
- [ ] Stage the files listed for this task and commit with `git commit -m "feat(admin): add household identity and access workflows"`.
