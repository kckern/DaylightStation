# Media redesign — acceptance ledger

**Status:** In progress. **2 accepted stories / 7 accepted AC; 11 partial stories / 17 partial AC; 69 unverified stories / 264 unverified AC**. No component, test count or API response earns acceptance by itself.

**Contract:** taxonomy §3 and accepted requirements. P0 first, then P1/P2. Each criterion must have evidence of the complete applicable path: user input → target → command → actual player/result → state → displayed feedback. Office is the only physical test screen authorized.

**Baseline (2026-09-14, 25d5f671c):** Vitest reported 513/513 passing, zero skipped; process exit 0 with worker shutdown timeout warning in persistence.test.js. This is unit evidence only. Browser test inspection found synthetic JavaScript clicks bypassing overlays and title-only playback assertions; these do not prove user journeys. Target-safe runtime baseline stopped after five failures; results are recorded below, with tests not run distinguished from passes.

## Evidence runs

| Run | Scope | Red / baseline | Green / acceptance |
|---|---|---|---|
| JOURNEY-AIM-CLOSED-APP-EXPIRY | PLACE.2a/AC5 closed-app/reopen before and after two idle hours | Earlier harness runs read storage before app mount or had clock/setup defects; inconclusive, not product evidence | Accepted source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`; preview header matched on port 44769. Focused command `BASE_URL=http://127.0.0.1:44769 npx playwright test tests/live/flow/media/media-app-aim-journey.runtime.test.mjs --grep 'a closed app restores' --workers=1 --reporter=line`: 1 passed (7.9s). Ordinary Search open and visible This device asserted before storage diagnostic; no device commands. |
| JOURNEY-AIM-RETURN-DEVICE | PLACE.2b phone, tablet and laptop return-to-local-aim journeys plus Start fresh | Prior browser attempts exposed a wide-layout selector mismatch and an assertion after Search unmounted its destination line; reassessment traced both to test routing | Accepted source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`; preview header matched. Serial five-case runtime command `BASE_URL=http://127.0.0.1:42167 npx playwright test tests/live/flow/media/media-app-aim-journey.runtime.test.mjs --workers=1 --reporter=line`: 5 passed (21.2s), raw log `/tmp/media-aim-reassessment-fixed-matrix.log`. AC1 phone/tablet/laptop choices; AC2 immediate aim display and picker state; AC3 Start fresh default returns aim locally, with no device commands. |
| FOUNDATION-NATIVE-UI | Fresh physical renderer operations and shared local/remote controls | Native REDs for stale operation leakage, conflicting/unsupported partial adoption; UI REDs for missing Stop receipt/volume steps, duplicate controls, unavailable dispatch and cross-target drag | Native original2 independently214 GREEN; UI original3 plus root fresh4 independently105 GREEN. Root combined155files1389 GREEN29.61s. Actual compiled six RED gates remain pending; no full-story acceptance |
| FOUNDATION-HANDOFF-EXECUTOR | Isolated generic owner executor: capture/start/align/status/cancel/guarded source Stop | Behavioral REDs for stale native binding, mutable inputs, synchronous callbacks, align cancellation, false cancellation and cancelled late source Stop | Three original repair rounds independently reviewed; fresh root and peer5files82 GREEN. Core is not wired to actual owners/receivers; capabilities remain false. Task8 delivery expiry and actual native/browser integration remain mandatory; not Move/Undo or story acceptance |
| JOURNEY-OFFLINE-CONTROLS | Isolated fleet broadcast → actual compiled Peek/remote controller → retained offline session → keyboard timeline input | Compiled323df31816 RED: offline ArrowRight attempts POST to virtual target session/transport; blocked before leaving browser | Pending Task6a repair3. Real production UI/controller with incoming fleet fixture, all WebSockets isolated and device mutations blocked; no physical receiver or decoder. Queue/transport disabled-state assertions follow the dispatch gate |
| JOURNEY-FRESH-VISIT | Paused actual Arrival → Add same title without interruption → jump second queue visit | Compiled323df32670 RED under stronger F3b boundary: prior functional restart/nearzero advance still passes, but original physical node remains connected | Pending F3b; this new retirement gate protects causal native observations and does not retract earlier functional queue-restart evidence |
| JOURNEY-RATE-PERSISTENCE | Actual Arrival → choose1.25× → Stop → retained queue restart | Compiled323df87663 RED: initial actual rate1.25 and actual restarted advancement pass, but restarted native rate is1 | Pending F3b local config setter + Task6a controller-bound rate; a DOM-only rate change does not preserve session config |
| JOURNEY-SINGLE-CONTROLS | Actual advancing Arrival → full controls → no duplicate handle → Back preserves native playback | Compiled323df95859 RED: both full transport and compact handle remain visible | Pending Task6a; GREEN must retain exact advancing node after Back |
| TASK-F3C-HTTP | Device handoff HTTP → real application service → gateway → correlated result | RED10 missing endpoint/API assertions; review RED3 receipt-only false200 and lost status-starting observation | Original fixround1 independently accepted, root12files68 GREEN. Exact validated body; full typed terminal200, valid status-starting202, receipt-only success rejected502, existing timeout preserved. Exact sole handoff publication asserted; no native executor/Move/owner Stop claim |
| JOURNEY-VOLUME-STEPS | Actual Arrival → ordinary volume slider → step buttons and visible level | Compiled323df87248 RED: slider End changes actual native volume to1, but decrease-volume button is absent | Pending Task6a; GREEN must verify actual native volume and displayed level, not only callback invocation |
| JOURNEY-STOP-FEEDBACK | Actual advancing Arrival → ordinary Stop → explicit retained queue count | Compiled323df52405 RED: native playback stops, but `Queue kept: 1 item` is absent | Pending Task6a; held Add/ready alone must not fabricate a Stop outcome |
| JOURNEY-RESPONSIVE-CONTROLS | Ordinary phone/tablet search → actual Arrival → ±10s, focus continuity, Stop/retained restart | Desktop-only evidence did not establish responsive reachability | Compiled323df phone34439 all3 GREEN17.9s; tablet33929 all3 GREEN19.8s. Phone uses retained SearchMode and explicit Close; no forced clicks. Actual seek completion, viewport-filling focus with controls in bounds, same node/source and zero pause events on shrink/Back, Stop and real retained-queue restart. Not audio/live/remote or all-entry-point parity |
| TASK-F3A-WIRE | Versioned command/result through actual screen/browser receiver, gateway and Peek projections | REDs include receipt-only success, stripped fields, malformed send, duplicate pending, wrong owner/media/live/fingerprint and wrong embedded status route | Independent original round3 accepted17files260; current receivers explicitly HANDOFF_UNSUPPORTED and no owner mutation. No native executor, HTTP endpoint, Move, or whole-story acceptance |
| JOURNEY-M0-SAFETY | Actual detail/playing-item picker → unavailable Move → explicit Keep choice → cancel without dispatch | Idle5537 puts Keep below viewport; first sizing repair42250 collapses device rows; active harness selection/parent assumptions corrected without product changes | Final compiled323df run61193 BOTH GREEN11.8s: ordinary device/Keep clicks reachable in idle popup; active Arrival retains the exact advancing node through Back, then ordinary Stop; zero device commands. Root cap5 CSS/test-loader adjudication verified in both Vitest configurations. Temporary safety gate, not implemented Move |
| TASK-F1B-OWNER | Existing Player/Local owner adoption, guarded Stop, actual native observations, lossless execution order | Review REDs covered old-node facts relabelled after adoption, queue visits/config not actually applied, stale initialization, repeated visits and fresh-bridge provenance | Independent round3 scoped acceptance265 tests; root52 Player/bridge tests GREEN. Same-node/content adoption/restart deliberately has no native proof without F3 renderer operation token; handoffV1 remains false. Not full transfer/browser acceptance |
| JOURNEY-SEARCH-RETRY-POINTER | Silent search → retryable failure → pointer Retry → real results | Old0c14580 never leaves Searching; compiled9a07 run22807 phone passes but desktop pointer blurs/clears input before second request | Root fresh round4:2 global/source Retry REDs→214 related GREEN; independent focused acceptance. Compiled e835 run42250 desktop+phone both GREEN: truthful timeout, exactly one explicit Retry reaches real results, query/Video scope retained, no playback. Backend source-progress change has service/hook tests, not deployed upstream E2E proof; whole-story parity remains |
| TASK-5B-RECOVERY | Stream deadline, supersession, source progress and truthful desktop/phone recovery | Unit/consumer REDs include late old callbacks, debounce false empty, missing empty-source progress and widened named-source failure; real old0c browser14580 still Searching after35s | Independent round3 acceptance; root290 frontend tests +2 service tests GREEN. New compiled desktop/phone silent-transport→actual Retry result remains runtime gate; upstream search service parity is not implied by frontend browser evidence |
| TASK-M0-SAFETY | Fail closed on unsupported destructive Move while retaining explicit non-destructive dispatch | Legacy claim stops source before adoption; transfer receipt stops local source; first guard iteration silently blocked idle Play | Independent root review accepted after two repair rounds; root85 related tests GREEN, including actual picker/provider idle choice, vanished snapshot and rejected dispatch. Temporary safety gate only, not Move/Undo implementation or native transfer acceptance |
| JOURNEY-QUEUE-ESCAPE | Paused Arrival → Add → Escape → second same-title queue entry | Run86990 Escape navigates away with results still open | Run26262 GREEN29.3s after Task9a repair: retained paused Add, first Escape preserves controls/queue, selecting duplicate title actually advances from zero. Independent review accepted and committed0c0c37e77; broader verb/target/device parity still required |
| CAPACITY-HLS-COPY | Verified675677 1080p60 source under actual branch HLS,180s native sample, paused seek, Stop | Forced DASH failed sustained advancement; prior copy control was not production policy | Run32232 GREEN4.3min:179.970s advancement/179.955s wall, no steady waiting/stall, paused+10 seek599ms. Actual exact session22fbd794-743e-4874-9de1-42155e708420 ↔ PID2619298, video copy/audio libmp3lame; CPU11s atage16s,17s atage141s. Ordinary Stop200, exact PID and session absent afterward. Native1374/10799 dropped frames (12.7%) remains a visual-quality caveat; not full-story or device-parity acceptance |
| JOURNEY-QUEUE-ROUND5 | Keyboard and pointer empty Add → held queue → explicit Play | Initial Add autostarts; pointer outside fails before final Content fix | Run86990 two cases GREEN: query/queue retained,2s zero native elements/no playback requests, actual mini Play advances; first pointer nonfocus outside closes results. Third paused Add preserves actual playback but Escape navigates Home with results still open, so same-title jump remains blocked in Task9a |
| JOURNEY-HLS-SERIAL | Full7 Disclosure HLS cases, actual branch read/mint | Earlier34664 first2 exceeded30s readiness; Plex transaction waits were confirmed separately | Bundled accepted0c15499 all7 GREEN1.9min; repeated with accepted F1b on e83527251 all7 GREEN1.6min. Local aim, duration/bar, deep seek, pause/resume, rapid controls, focus and Stop; observed HLS sessions require successful ordinary-Stop responses. Does not prove intermittent Plex transaction latency repaired, physical-device parity, or full-story acceptance |
| JOURNEY-HLS-RECOVERY-STOP | Branch Disclosure HLS → saved resume5251 → paused20% seek → ordinary Stop | Earlier87913 corrupts native blob before delayed manifest completes | Run22686 GREEN36.9s: actual resume5251 completes~1.12s; deep paused1767 completes~1.29s, ready4/notseeking/bar1767;15 HLS observations. Exact observed session bf6ba9f0-9ef4-4c2c-a88f-273206fbd611 Stop200; read-only host process check at05:07:09Z found no matching transcoder. No pre-Stop process correlation or sustained capacity evidence, so broader release/capacity gate remains |
| JOURNEY-NATIVE-TARGETED | Rerun two pre-app failures plus keyboard Add | Serial39999 lost module loading before Office/pause assertions | Targeted17376 Office + pause/resume GREEN; across the two runs all seven native cases have passed, not a single clean full-suite pass. Keyboard case separately failed waiting15s for search results (still Searching), under trace diagnosis |
| JOURNEY-POINTER-DISMISS | Actual Add → first nonfocus outside click | Root28698 confirms nonfocus event target, but results remain visible | Genuine Task4a round5 repair pending. Same run keyboard proves held queue/no media or playback requests for2s; explicit Play assertion used missing np-toggle, corrected to existing mini Play but no end-to-end green yet |
| JOURNEY-NATIVE-MP4 | Actual branch-qualified Arrival original MP4; full-content seek, focus, Stop | Previous global DASH baseline could not start reliably; dev39999 also lost app readiness in2 cases | Bundled accepted0c96950 all7 GREEN1.2min; repeated with accepted F1b on e83549679 all7 GREEN1.1min. Actual branch read/mint; Office peek/local aim, seek/bar, deep seek, pause/resume, forward/back, focus and Stop. No whole-story/device parity or HLS acceptance |
| TASK-2B-RECOVERY | Delayed HLS manifest → generic recovery → actual engine ownership | Real trace87913: 15s hardReset rewrites MediaSource blob with offset query and invokes native load, producing code4 before HLS retry completes | Scoped fixround2 independently accepted63 tests; leaves pending engine intact, fatal recovery uses owned engine. Actual delayed-start rerun and exact Plex session release remain gates |
| TASK-4B-EMPTY-ADD | Add → held queue → explicit Play | Root pointer89426 starts video from intended Add; 9 focused behavioral REDs identify implicit selection/load | Frozen615 Media tests pass; independent review and strengthened ordinary keyboard/pointer browser proof pending. No full-story acceptance |
| BASE-UNIT | Media module + MediaApp | 513 passed; worker termination warning | Not story acceptance |
| TASK-1 | D1–D4 | Behavioral RED for missing local choice/retained handle, wrong retry/aim, modal interception and retry collision | Reviewed repair commits be00b6a4d,40aef3558,4f1235303; focused95/95, related226/226; browser subsets below. Full associated stories not yet accepted |
| JOURNEY-AIM | Phone search → destination sheet → Office → This device | Destination modal visible but underlying Search Mode intercepts device taps: RED | GREEN after layer fix: ordinary taps switch aim and persist deselection on reopening; no playback commands. Phone subset only; full story needs tablet/laptop and reset |
| JOURNEY-STOP-RESTART | Actual video → Stop → reopen retained queue → Play | Missing-handle unit RED in Task 1 | GREEN real browser: stopped media, retained title/queue, then actual video advancing again; full Stop story still requires feedback/remote parity |
| JOURNEY-PEEK-AIM | Office controls → search result with fresh local aim → actual local video | Peek destination override unit RED in Task 1 | GREEN real browser20.4s: local video advances and no device command attempted; broader all-surface aim/control criteria remain unverified |
| JOURNEY-SEARCH | Phone query + Video narrowing → Play → continue choosing | RED: Play closes search; after initial repair real combobox selection still clears query | Task5a 8303c16b0: phone GREEN30.9s, retained dialog/query/Video narrowing and actual advancing video, ordinary Stop cleanup. Independent scoped review clean; Add and explicit Play on integration remain open |
| JOURNEY-QUEUE | Paused real movie → result More actions → Add to queue → same-title queue jump | Initial RED: More actions clears query/resumes playback. After ea32f472d, real menu/Add works but query clears after dismissal (run3118 line43); no synthetic bypass | Task4a runtime fixround1 real-consumer RED→GREEN204 relevant tests; root2-case rerun pending. Queue-jump and full verb stories not accepted |
| JOURNEY-AIM-IDLE | Choose Office → reload retains aim → two idle hours → local aim | RED: after two idle hours label still reads Office Screen; subsequent repair exposed incorrect local wording | Strict phone expiry/reload and local-switch journeys 2 passed in1.2min on round1 + d4fe82276. Subsequent acknowledged-steering ordering/expiry/supersession repairs pass66 focused tests and independent round3 review. No device commands; sender-origin and same-title generation exemptions remain open |
| JOURNEY-FOCUS-LAYOUT | Playing video → Expand → viewport surface and reachable controls | RED: expanded surface remains a centered content column; earlier continuity test did not assert geometry | GREEN after selector repair: viewport bounds, on-screen controls, same media node/source and no pause events; independent review clean |
| TASK-2-REVIEW-FIXES | Known→unknown duration, stalled progress, seek capability, playback generations, actual-position relative seeks and mounted-source ownership | Unit RED for each boundary; full browser rapid Forward→Back exposed stale-position overshoot | Five-round repair/review loop closed through6a1f48856: scoped code findings addressed; Important global DASH capacity/quality gate carried explicitly into Task2b. This is not baseline or story acceptance |
| JOURNEY-CROSS-TITLE | Paused Disclosure Day → ordinary Arrival selection → actual new video | Earlier baselineGREEN; final b587d2226 run RED: old paused source emitted1play event. Logs place old restart after Pause and before Arrival selection, during late seek completion. | Startup probe cancellation repaired in57c171996; deterministic RED→GREEN and round4 review clean. Final strengthened serial suite still pending; actual new-source playback alone does not satisfy no-old-source-restart assertion |
| JOURNEY-PAUSED-SEEK | Real movie playback → Pause → keyboard seek → pointer seek → native decoder completion and visible position | Round4 and round5 browser RED: native position91 remains seeking/readyState1 while visible bar stays6. Native buffered video begins153.9457. Run10113 still failed85s bar difference on a4e08d8a3 source. | After6a1f48856: Arrival normal decision-path GREEN32.8s and Disclosure GREEN37.1s through isolated branch API+frontend, including native !seeking/readyState≥2/paused, visible bar and branch-mint provenance. Earlier fallback-path Arrival GREEN37.6s is separately recorded. Scoped review/full parity/performance remain pending; no full story accepted |
| HARNESS-SERVER | Explicit BASE_URL with unrelated default server unavailable | Config assertion RED: harness attempted to launch another dev stack | Explicit server now externally managed; default auto-start preserved;2 configuration tests pass |
| DASH-CAPACITY | Verified675677 1080p60 source → branch mint → virtual actual decoder for180s | Run95700:179.649s elapsed but only109.646s actual advance;1076 dropped of3298 new frames, repeated buffering. Actual encoder30fps/libx264/7393kbps,3s segments require6–7s body delivery. Final seek check hit a harness closure bug and is invalid; sustained samples remain measured evidence | Operational gate failing. Task2b investigates cause and same-asset policy control. Not a deployment approval, source-quality acceptance, or hardware test |
| DASH-COPY-CONTROL | Same675677 ordinary UI with harness-only copy policy, no production edit | Comparison begins at Plex resume110s versus original0s; record this limitation | Run23231 GREEN4.3min including actual paused+10s decoder seek and policy provenance:179.609s elapsed/179.577s advance, only startup waiting. Exact encoder copy/audioAAC, segment bodies milliseconds.3424/10776 frames dropped (~31.8%), so visual smoothness remains unaccepted. Forced-policy starvation is isolated; production repair still pending |
| DASH-720-CONTROL | Same675677 with harness-only720p/4Mbps policy | Run35225:179.572s wall/86.281s advance;480/2608 dropped frames. Lower quality did not restore sustained delivery; scene/resume differs from prior runs | FAILED; do not adopt downgrade. Observed shared4CPU quota is a resource constraint, not sole-cause proof. No quota/configuration changes |
| HLS-TIMESTAMP-CONTROL | Arrival from actual API resume=false → existing hls.js → paused seek beyond prebuffer | First control56486 failed readiness and selected native HLS; it did not exercise timestamp correction | Explicit hls.js control GREEN45.9s: INIT PTS903668/90000 anchored source; hls.js corrected nominal10s segments to actual12.430s first duration and later starts. Paused91s seek beyond0.043–22.741s prebuffer completed~426ms, readyState4, visible bar91. Harness-only policy, not production fix; Disclosure/sustained/native-fallback/startup reliability gates remain |
| HLS-BRANCH-DEEP | Actual branch play DTO/mint → Disclosure saved spot473 → paused deep seek | Run57322 RED: 60% pointer location requested5251 instead of5300 (49s mapping discrepancy), under separate Task6a diagnosis. Policy review also found same-URL recovery failed to replace HLS ownership | Partial actual observations: real resume473 completed, INIT from fragment0 at905436/90000; deep5251 native seek finished~2.35s, paused/ready4/not seeking, bar5251. Not a passing journey. HLS lifecycle fix, pointer accuracy, sustained capacity and startup repeatability remain required |
| BROWSER-CONTROL-FOUNDATION | Two real same-profile tabs → production correlator → isolated branch WS/ingress → actual receiver hook/controller → returned ACK and target queue | Earlier F2 review found receiver ACK missing required return route despite synthetic wire test passing | Run28523 GREEN36.5s; strengthened run48272 GREEN (two tests37.2s): same persisted profile, distinct live routes, actual target queue entry, caller unchanged, no video or hardware command. Duplicate/reconnect/correlation review findings remain; this is foundation evidence, not full browser-screen story acceptance |
| QUEUE-KEYBOARD | Real Enter/ArrowDown/Enter opens More and chooses Add | Initial menu/query loss documented above; run17073 reached correct interaction but final harness expectation omitted rendered queue index, corrected against QueuePanel source | Run48272 GREEN (two tests37.2s): correct menu focus order, query retained, no video, one retained queue entry. Pointer Add→outside remains an independent review finding; full queue story not accepted |
| EMPTY-QUEUE-ADD | Ordinary pointer Add with no playback | Run89426 RED: a video appeared before any explicit Play; trace records only the intended Add action. Existing queue/controller first-add rule loads the new current item | Repaired in5f6bf6751; stronger run86990 proves settled held queue/no playback requests then explicit Play advances. Earlier instantaneous no-video assertions remain insufficient by themselves |
| BASE-BROWSER | Existing Media flow suite, screenshot-only tests excluded | 1 passed, 5 failed, 30 not run after failure cap; obsolete selectors prevent acceptance | Not story acceptance |
| JOURNEY-LOCAL | Disclosure Day search → actual video → seek/pause/stop | Original disabled duration/progress, absent Expand; old forced-DASH run85106 failed all7 at startup | Superseded by HLS repair87b5994e7: full34664 passes5/7 with2 Plex transaction-latency startup failures; isolated deep22686 and sustained32232 pass. See newer rows for native proof and remaining quality/operational gates; no full baseline acceptance |

## Criteria

### FIND.1a

As a **Seeker**, I want to start typing a title from anywhere in the app, so that I reach it without navigating first.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.1a/AC1 | From any part of the app, one obvious action (or starting to type, where there is a keyboard) opens search with the cursor ready. | Unverified | — |
| FIND.1a/AC2 | Results begin appearing while I type, each with a picture, title, and kind. | Unverified | — |
| FIND.1a/AC3 | The search looks and behaves the same on a phone, tablet, or laptop, and whatever I was doing before (including steering another screen). | Unverified | — |
| FIND.1a/AC4 | Closing search returns me to exactly where I was. | Unverified | — |
| FIND.1a/AC5 | After **Play**, **Add to queue**, or **Play on…**, search stays open with my words and narrowing, so I can keep going (R24). | Partial | JOURNEY-SEARCH: phone ordinary Play retains query/narrowing/dialog with actual advancing video, GREEN30.9s on8303c16b0; Add and explicit Play on paths plus device-size parity pending |

### FIND.1b

As a **Big-Screen Sender**, I want the search I use for a TV to be the same search I use for this device, so that I don't have to learn a second one.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.1b/AC1 | There is only one search. Choosing a screen never opens a different search. | Unverified | — |
| FIND.1b/AC2 | The actions on a result are the same whichever screen is aimed at; only the stated destination differs. | Unverified | — |

### FIND.2a

As a **Seeker**, I want to narrow my search to a kind of content, so that "Frozen" finds the film and not forty songs.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.2a/AC1 | Kinds are shown as choices next to the search; the current one is always visible. | Unverified | — |
| FIND.2a/AC2 | Choosing a kind updates results immediately without retyping. | Unverified | — |
| FIND.2a/AC3 | Kinds that contain sub-kinds (for example, Music → Hymns) let me choose either level. | Unverified | — |
| FIND.2a/AC4 | The kind I chose stays while search is open; the next time search opens it starts at All. Same on every device (Q6). | Unverified | — |

### FIND.3a

As a **Seeker**, I want to know whether the results are complete, so that I can trust a short list.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.3a/AC1 | While sources are still answering, I see that results are still arriving. | Unverified | — |
| FIND.3a/AC2 | When all are in, the "still arriving" sign disappears. | Unverified | — |
| FIND.3a/AC3 | If a source didn't answer, I'm told which, in plain words, with a way to try it again. | Unverified | — |
| FIND.3a/AC4 | These signs look and read identically wherever search appears. | Unverified | — |

### FIND.4a

As a **Seeker**, I want a helpful next step when nothing matches, so that I'm not stuck.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.4a/AC1 | If nothing matches in the chosen kind, matches from all kinds appear under a divider ("Not in Audiobooks — from everything:"), with the kind in words on every row (R25). | Unverified | — |
| FIND.4a/AC2 | If a source didn't answer, I'm told that before any widening, so a failure never looks like "not there" (R25). | Unverified | — |
| FIND.4a/AC3 | If nothing matches anywhere, I'm told so plainly and offered to check spelling or browse the nearest kind. | Unverified | — |
| FIND.4a/AC4 | An empty result never looks like a result still loading. | Unverified | — |

### FIND.5a

As a **Wanderer**, I want to explore the catalog by kind with pictures, so that I can recognise something good.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.5a/AC1 | I can reach every kind of content without typing. | Unverified | — |
| FIND.5a/AC2 | Every title shows a picture (or a recognisable placeholder), title, and kind. | Unverified | — |
| FIND.5a/AC3 | Long collections load more as I scroll, without a separate button hunt. | Unverified | — |
| FIND.5a/AC4 | Backing out returns me to the same scroll position. | Unverified | — |

### FIND.6a

As a **Wanderer**, I want to open a show, album, or folder and see its parts in order, so that I can choose the right one.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.6a/AC1 | Parts appear in their natural order (episodes by season, tracks by number). | Unverified | — |
| FIND.6a/AC2 | I can see where I am as a trail (for example: TV → Bluey → Season 2) and jump to any level. | Unverified | — |
| FIND.6a/AC3 | The whole-collection actions (play, shuffle, add) are available at the top and name the screen they will use. | Unverified | — |

### FIND.7a

As a **Wanderer**, I want to be offered things that suit the moment, so that I have a place to start.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.7a/AC1 | Opening the app shows a small set of suggestions: favourites, what's unfinished, what has played on this screen at this time of day, and new additions (R15, R46). | Unverified | — |
| FIND.7a/AC2 | Suggestions follow the same tap rule as every other item: a collection opens, a playable item plays at the aim, and details are one step away (Q2). | Unverified | — |
| FIND.7a/AC3 | Suggestions never include what's already playing on any screen (R16). | Unverified | — |

### FIND.8a

As a **Wanderer**, I want to see details about one item without starting it, so that I can decide with confidence.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.8a/AC1 | From any item, wherever it appears (search, browsing, suggestions, recent), I can open its details in one step. | Unverified | — |
| FIND.8a/AC2 | Details show picture, title, description, length, kind, and how far anyone has got. | Unverified | — |
| FIND.8a/AC3 | Details offer the same play and line-up actions as everywhere else, with the destination stated. | Unverified | — |
| FIND.8a/AC4 | Opening details never starts, stops, or changes playback. | Unverified | — |

### FIND.8b

As a **Seeker**, I want tapping a result to do the obvious thing while details stay one step away, so that speed and understanding don't compete.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.8b/AC1 | Tapping a playable item (episode, song, film) plays it at the aim; tapping a collection (show, season, album, playlist, artist, folder) opens it. Same everywhere (Q2). | Unverified | — |
| FIND.8b/AC2 | Collection results also carry an inline **Play** button, or **Continue S2E7** when one is under way, so "Put on Bluey" is one tap (R8). | Unverified | — |
| FIND.8b/AC3 | Cameras and single photos are the exception: a tap shows them on the device in hand, with **Show on…** as the second action (R10). | Unverified | — |
| FIND.8b/AC4 | A mis-tap costs nothing: the confirmation offers undo (`RELY.4`). | Unverified | — |
| FIND.8b/AC5 | A secondary action on every result opens its details. | Unverified | — |

### FIND.9a

As a **Resumer**, I want recently played items from every screen, so that something played on the TV last night is still easy to find.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.9a/AC1 | Recent items include things played on any screen in the house, each marked with where it last played. | Unverified | — |
| FIND.9a/AC2 | A recent item offers the same actions as any other item (details, play, line up, send elsewhere). | Unverified | — |
| FIND.9a/AC3 | Tapping a recent item never replaces a queue without the same confirmation and undo as any other play. | Unverified | — |

### FIND.10a

As a **Resumer**, I want to see unfinished things and next episodes, so that I can carry on without searching.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.10a/AC1 | Unfinished items show where they stopped (for example, "34 min left", "Chapter 7"). | Unverified | — |
| FIND.10a/AC2 | For a series, the next unwatched episode is offered. | Unverified | — |
| FIND.10a/AC3 | Anything playing on any screen right now is not offered as "carry on"; it shows instead as "Now on Living Room TV · Remote · Move here" (R16). | Unverified | — |
| FIND.10a/AC4 | Each screen keeps its own spot; when they differ, both are shown (R14). | Unverified | — |
| FIND.10a/AC5 | Something counts as unfinished only after 5 minutes or 5% has been watched (default), and as finished once the credits start (R41). | Unverified | — |
| FIND.10a/AC6 | Any item can be marked watched or unwatched (R41). | Unverified | — |
| FIND.10a/AC7 | Finished items drop off the list on their own. | Unverified | — |

### FIND.11a

As an **Ambient listener**, I want to see what played earlier on a screen, item by item, so that I can find the song I liked.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.11a/AC1 | Each screen's queue has a **Played earlier** list, newest first, with picture, title, and the time it played. | Unverified | — |
| FIND.11a/AC2 | Items from shuffled or "keep similar things playing" runs are included. | Unverified | — |
| FIND.11a/AC3 | Any item there offers the same actions as everywhere else, including adding it to favourites. | Unverified | — |

### FIND.12a

As an **Ambient listener**, I want to keep favourites, so that the things we put on every day are one tap away.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.12a/AC1 | Any item or collection can be added to or removed from favourites in one step, wherever it appears. | Unverified | — |
| FIND.12a/AC2 | Favourites appear first on the start page and among suggestions. | Unverified | — |
| FIND.12a/AC3 | Favourites are shared by the household (Q3); anyone can remove one. | Unverified | — |

### FIND.12b

As a **Child**, I want favourites shown as big pictures, so that I can find them without reading.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.12b/AC1 | Favourites show large pictures with the title underneath. | Unverified | — |
| FIND.12b/AC2 | Tapping one follows the same rule as everywhere: its **Play** button plays, the picture opens it (Q2, R8). | Unverified | — |

### FIND.13a

As a **Hand-Held Viewer**, I want to remove something from the household list, so that a late-night film doesn't show up on the children's tablet.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| FIND.13a/AC1 | Any item in recent, carry on, or suggestions can be removed from the household list in one step. | Unverified | — |
| FIND.13a/AC2 | A removed item stops appearing in suggestions on every screen. | Unverified | — |
| FIND.13a/AC3 | Removal can be undone for 10 seconds (default). | Unverified | — |

### PLAY.1a

As a **Seeker**, I want "play now" to play at my aim, whichever control I use, so that the same word always does the same thing.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.1a/AC1 | "Play now" on a search result, a browsed item, an item's details, a suggestion, or a recent item all play at the aim shown on screen. | Unverified | — |
| PLAY.1a/AC2 | The item starts now on that screen; whatever was queued after the old item stays queued (R1). | Unverified | — |
| PLAY.1a/AC3 | A confirmation names the item and the screen (see `RELY.1`). | Unverified | — |
| PLAY.1a/AC4 | If the aim is busy with someone else's playback, the aim label says so before I tap (`PLACE.5`); the tap itself never stops to ask (R2). | Unverified | — |
| PLAY.1a/AC5 | Tapping the same item again while it is still starting doesn't start it twice; the item reads "Starting on Living Room TV…" (R34). | Unverified | — |

### PLAY.1b

As a **Hand-Held Viewer**, I want "play now" to start here when my aim is this device, so that I stay in control of what's in my hands.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.1b/AC1 | With the aim on this device, every "play now" starts on this device; no other screen changes. | Unverified | — |
| PLAY.1b/AC2 | Playback starts without leaving the part of the app I'm in; a compact handle appears (see `STEER.1`). | Unverified | — |

### PLAY.2a

As a **Wanderer**, I want to play a whole show or album in order, so that I don't pick each part.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.2a/AC1 | A whole-collection "play" is available wherever the collection appears (result, browse, details). | Unverified | — |
| PLAY.2a/AC2 | Playback starts at the first part (or the first unfinished part; see `PLAY.4`) and the queue lists the rest in order. | Unverified | — |
| PLAY.2a/AC3 | Playing a collection replaces that screen's queue, in order with shuffle off. The confirmation names the collection, the number of items, and the screen, and offers undo (R1, R26). | Unverified | — |

### PLAY.3a

As a **Queue Builder**, I want to shuffle a whole collection in one step, so that it plays in a fresh order.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.3a/AC1 | "Shuffle" is offered beside "play" on every collection, wherever it appears. | Unverified | — |
| PLAY.3a/AC2 | The queue shows the shuffled order and shuffle reads as on. | Unverified | — |
| PLAY.3a/AC3 | Starting a collection with **Shuffle** turns shuffle on; starting one with **Play** turns it off (R26). | Unverified | — |

### PLAY.4a

As a **Resumer**, I want to choose between continuing and starting over, so that I get the position I meant.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.4a/AC1 | When an item has a saved spot, playing it continues from there; the confirmation offers **Start over** (R9). | Unverified | — |
| PLAY.4a/AC2 | Each screen keeps its own spot. When they differ, I choose: "1 h 20 m on Living Room TV · 12 m on Kid's tablet" (R14). | Unverified | — |
| PLAY.4a/AC3 | When there's no saved spot, it simply starts. | Unverified | — |

### PLAY.8a

As a **Bystander**, I want a doorbell camera or clip shown on the TV to go back to my programme afterwards, so that an interruption doesn't end what we were watching.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.8a/AC1 | **Show briefly** puts the camera or clip over what's playing on that screen. | Unverified | — |
| PLAY.8a/AC2 | Closing it, or its time running out, returns the previous programme at its spot, with its queue. | Unverified | — |
| PLAY.8a/AC3 | The note on the screen says what interrupted and where it came from. | Unverified | — |

### PLAY.8b

As a **Routine Setter**, I want a doorbell routine to show the camera briefly and then return, so that visitors don't end the film.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.8b/AC1 | A routine can choose "show briefly, then return" for any screen. | Unverified | — |
| PLAY.8b/AC2 | Cameras started by routines use it unless the routine says otherwise. | Unverified | — |

### PLAY.9a

As a **Host**, I want music playing behind a photo slideshow, so that a birthday slideshow on the TV has a soundtrack.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.9a/AC1 | While a slideshow plays, **Add music behind** lets me choose a song, album, or playlist. | Unverified | — |
| PLAY.9a/AC2 | Photos and music are steered separately: skipping a photo doesn't skip a song. | Unverified | — |
| PLAY.9a/AC3 | Stopping the slideshow asks whether to keep the music playing. | Unverified | — |

### PLAY.5a

As a **Queue Builder**, I want one clear "play next" action, so that I know exactly where the item goes.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.5a/AC1 | There is one "play next" verb, available on every item wherever it appears. | Unverified | — |
| PLAY.5a/AC2 | The item appears immediately after what's playing now; if I add several, they play in the order I added them (Q4). | Unverified | — |
| PLAY.5a/AC3 | The confirmation states the position and screen, for example "Next · 3rd in line on Kitchen speaker"; pressing and holding **Play next** offers "at the very front" (R27). | Unverified | — |

### PLAY.6a

As a **Seeker**, I want to add something to the end without interrupting, so that the current playback isn't disturbed.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.6a/AC1 | "Add to queue" is available on every item wherever it appears and uses the aim. | Partial | Desktop keyboard/pointer Add→held queue→explicit Play and actual receiver route pass; all-surface/aim/device parity remains open |
| PLAY.6a/AC2 | What's playing continues without a pause or skip. | Partial | Paused video remains paused through Add (26262). Bundled accepted0c0c37e77 browser3846 GREEN9.3s: Arrival advances through Add, exact native node/currentSrc retained, no pause/emptied/loadstart events; queue grows to2 and query stays. Remote/device parity remains open |
| PLAY.6a/AC3 | The confirmation names the item, its position ("7th"), and the screen. | Unverified | — |

### PLAY.7a

As a **Queue Builder**, I want to add a whole album or season to the queue, next or at the end, so that I can build long queues quickly.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.7a/AC1 | Whole-collection "play next" and "add to queue" are available wherever a collection appears. | Unverified | — |
| PLAY.7a/AC2 | The confirmation states how many items were added and where. | Unverified | — |
| PLAY.7a/AC3 | The added items keep their natural order. | Unverified | — |

### PLAY.10a

As a **Host**, I want a screen's queue set to "add only" during a party, so that guests' taps add songs instead of replacing mine.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLAY.10a/AC1 | Turning **Add only** on or off for a screen's queue takes one step. | Unverified | — |
| PLAY.10a/AC2 | While it's on, **Play** from any other device adds to the queue and says "Added · 5th in line" instead of replacing. | Unverified | — |
| PLAY.10a/AC3 | The screen's row in the house view shows that add-only is on. | Unverified | — |
| PLAY.10a/AC4 | This protects a host's queue; it is not a limit on children (Q11), and anyone can turn it off. | Unverified | — |

### PLACE.1a

As a **Big-Screen Sender**, I want the aim shown next to every play action, so that I know where a tap will go before I tap.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.1a/AC1 | Everywhere a play or line-up action appears, the aim is visible on the same screen, on every device size. | Unverified | — |
| PLACE.1a/AC2 | The aim uses the screen's name and room ("Living Room TV"), or "This device (Dad's phone)", or "3 screens" (R49). | Unverified | — |
| PLACE.1a/AC3 | What the aim says is always what happens. No control ignores it. | Partial | JOURNEY-PEEK-AIM local playback after Office controls passes; all other surfaces/verbs pending |
| PLACE.1a/AC4 | When I'm steering another screen, the aim is still shown as its own thing and does not change unless I change it (see Tension T2). | Partial | JOURNEY-PEEK-AIM proves no redirection; complete label visibility and other aims pending |

### PLACE.2a

As a **Big-Screen Sender**, I want to aim at a TV for the evening, so that every play goes there without extra steps.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.2a/AC1 | I can change the aim in one step from wherever the aim is shown. | Unverified | — |
| PLACE.2a/AC2 | The chosen aim persists as I move around the app and after a reload. | Partial | JOURNEY-AIM-IDLE: strict phone reload restores Office, GREEN in2-test1.2min run; all-surface/navigation parity pending |
| PLACE.2a/AC3 | After 2 hours of no use (default), the aim returns to "this device" on its own, so a phone is never left aimed at a TV for days (Q1). | Partial | JOURNEY-AIM-IDLE: phone clock crosses2h, actual destination line becomes This device without device commands; strict2-test1.2min GREEN on Task3a round1 + d4fe82276; review/exemption integration pending |
| PLACE.2a/AC4 | That clock doesn't run while the aimed screen is playing something this device sent or is steering (R4). | Unverified | — |
| PLACE.2a/AC5 | Opening the app after that much idle starts on "this device", even though a reload otherwise restores the aim (R7). | Accepted | JOURNEY-AIM-CLOSED-APP-EXPIRY, accepted source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`, preview port 44769 header matched: closed page, reopened before expiry restores Office, then renewed aim and reopened after expiry; ordinary Search open showed This device before storage diagnostic. Focused run 1 passed (7.9s), zero device commands. Earlier failures were harness-ordering/setup results, not product evidence. |
| PLACE.2a/AC6 | Every play and line-up action then uses it (see `PLAY.1a`). | Unverified | — |

### PLACE.2b

As a **Hand-Held Viewer**, I want to aim back at this device in one step, on any device, so that I'm never stuck sending to a TV.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.2b/AC1 | "This device" is always one of the choices, on phone, tablet, and laptop alike. | Accepted | JOURNEY-AIM-RETURN-DEVICE, source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`: serial five-case browser matrix GREEN; phone picker and tablet/laptop browse-header picker expose the choice. Log `/tmp/media-aim-reassessment-fixed-matrix.log` |
| PLACE.2b/AC2 | Choosing it immediately updates the aim everywhere it is shown. | Accepted | JOURNEY-AIM-RETURN-DEVICE, source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`: immediate destination-line update and reopened picker selection verified on phone, tablet, and laptop; no device commands. Log `/tmp/media-aim-reassessment-fixed-matrix.log` |
| PLACE.2b/AC3 | Starting fresh (`RELY.8`) also offers to return the aim to this device. | Accepted | JOURNEY-AIM-RETURN-DEVICE, source `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`: checked default and local-only copy verified; after confirmation Search was reopened and the destination line showed This device; no device commands. Log `/tmp/media-aim-reassessment-fixed-matrix.log` |

### PLACE.3a

As a **Big-Screen Sender**, I want to send a single item to a different screen without changing my aim, so that one-off exceptions are painless.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.3a/AC1 | Every item, wherever it appears, offers "play on…" (and "add to queue on…"). | Unverified | — |
| PLACE.3a/AC2 | Choosing a screen sends only that item there; the aim reads the same afterwards. | Unverified | — |
| PLACE.3a/AC3 | The confirmation names the item and the screen it went to. | Unverified | — |

### PLACE.3b

As a **House Watch**, I want to add a single item to another screen's queue, so that the kids' room gets one more episode without me walking in. *(Moved from PLAY.6b, R48.)*

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.3b/AC1 | With another screen as the aim, or via **Add to queue on…** on the item, the item joins that screen's queue. | Unverified | — |
| PLACE.3b/AC2 | That screen's queue visibly includes the new item when I look. | Unverified | — |

### PLACE.4a

As a **Big-Screen Sender**, I want to play on several screens at once, so that the whole ground floor hears the same thing.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.4a/AC1 | When choosing a screen, I can choose more than one, with the choice clearly labelled as "several screens". | Unverified | — |
| PLACE.4a/AC2 | The aim then reads, for example, "Kitchen + Living Room". | Unverified | — |
| PLACE.4a/AC3 | Progress and confirmation are shown per screen, so one failing doesn't hide the others succeeding. | Unverified | — |
| PLACE.4a/AC4 | The screens start at about the same time, then each is steered on its own; they may drift apart (Q8). | Unverified | — |
| PLACE.4a/AC5 | Either screen's Remote offers **Line up with Kitchen** to bring them back together (R29). | Unverified | — |
| PLACE.4a/AC6 | Choosing screens in the same or neighbouring rooms warns that drift may be audible (R29). | Unverified | — |
| PLACE.4a/AC7 | **Add to queue** with several screens aimed adds to each, and the confirmation says so (R29). | Unverified | — |

### PLACE.5a

As a **Big-Screen Sender**, I want to see what each screen is doing while I choose, so that I don't interrupt someone.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.5a/AC1 | Each choice shows the screen's name, room, and whether it is playing (with title and time left), paused, idle, or off. | Unverified | — |
| PLACE.5a/AC2 | Screens that haven't reported in the last 2 minutes (default) are marked as uncertain. | Unverified | — |
| PLACE.5a/AC3 | Choosing a screen that is playing someone else's content warns me what will be replaced before it happens, and the aim label keeps showing that it's busy, so no later tap needs to ask (R2). | Unverified | — |
| PLACE.5a/AC4 | "Someone else's playback" means something started from a different device, or by a routine, since that screen was last idle (R3). | Unverified | — |

### PLACE.6a

As a **Room Hopper**, I want to decide, when I send, whether this device stops or keeps playing, so that I get a hand-off or a second room on purpose.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.6a/AC1 | Whenever this device is playing and the aim is another screen, the aim label shows what will happen here ("move it" or "keep playing here too"), and I can change it there before tapping, on every device size (R2). | Unverified | — |
| PLACE.6a/AC2 | A one-off **Play on…** or **Move to…** asks at that moment, pre-set to my usual choice. | Unverified | — |
| PLACE.6a/AC3 | My usual choice is remembered and pre-selected, and visible before I confirm. | Unverified | — |
| PLACE.6a/AC4 | Afterwards, this device does exactly what the choice said. | Unverified | — |

### PLACE.7a

As a **Room Hopper**, I want to bring what's playing on the TV to the device in hand, so that I can carry on as I leave the room.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.7a/AC1 | Wherever I can see another screen's playback (the house overview or its controls), "move to this device" is offered. | Unverified | — |
| PLACE.7a/AC2 | This device starts the same item at the same moment with the same queue; the other screen stops. | Unverified | — |
| PLACE.7a/AC3 | A confirmation says it moved, and from where. | Unverified | — |
| PLACE.7a/AC4 | If it can't move, I'm told why and the other screen keeps playing. | Unverified | — |
| PLACE.7a/AC5 | Video, audio, and photo slideshows move at the same spot; a live channel or camera simply starts fresh on the new screen (Q5). | Unverified | — |

### PLACE.8a

As a **Room Hopper**, I want to send what's playing here to a TV at the same moment, so that I switch to the big screen without starting over.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.8a/AC1 | From the handle on my own playback, "move to…" is offered, wherever I am in the app. | Unverified | — |
| PLACE.8a/AC2 | The chosen screen starts at the same moment with the same queue. | Unverified | — |
| PLACE.8a/AC3 | This device stops or keeps playing according to `PLACE.6`. | Unverified | — |
| PLACE.8a/AC4 | Progress and confirmation follow `RELY.2` and `RELY.3`. | Unverified | — |

### PLACE.9a

As a **House Watch**, I want to move playback between two other screens, so that I can follow a programme into another room.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| PLACE.9a/AC1 | From another screen's controls, "move to…" lists other screens, including this device. | Unverified | — |
| PLACE.9a/AC2 | The destination picks up at the same moment; the original stops. | Unverified | — |
| PLACE.9a/AC3 | Both screens' states update in the house overview. | Unverified | — |

### STEER.1a

As a **Hand-Held Viewer**, I want a persistent handle on what's playing here, so that I can steer it from anywhere in the app.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.1a/AC1 | While anything is playing or paused on this device, a compact handle is visible in every part of the app with title, picture, progress, and play/pause. | Unverified | — |
| STEER.1a/AC2 | Tapping it opens full controls and the queue. | Unverified | — |
| STEER.1a/AC3 | When full controls are open, the compact handle doesn't duplicate them. | Unverified | — |
| STEER.1a/AC4 | The handle also covers the screen I most recently sent to or steered, so pausing the TV when the phone rings is one tap (R21). | Unverified | — |
| STEER.1a/AC5 | The same controls are available from the lock screen and notifications (R21). | Unverified | — |

### STEER.1b

As a **House Watch**, I want to steer another screen with the same controls I use for this device, so that I don't learn two ways.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.1b/AC1 | Opening another screen's playback shows the same controls, in the same layout, with that screen's name clearly at the top. | Unverified | — |
| STEER.1b/AC2 | Controls the screen can't support are shown as unavailable with a short reason, not missing. | Unverified | — |
| STEER.1b/AC3 | It is always obvious which screen I am steering, and I can switch to another in one step. | Unverified | — |
| STEER.1b/AC4 | Leaving the controls of another screen never changes my aim. | Unverified | — |
| STEER.1b/AC5 | When I pause, stop, replace, or move another screen's playback, that screen shows a brief note saying where it came from, for example "Paused from Dad's phone", with **Put it back** (Q7, R30). | Unverified | — |
| STEER.1b/AC6 | Volume changes don't produce notes, and repeated notes are grouped. A screen that can't show a note, such as a speaker, records it on its row in the house view (R30). | Unverified | — |
| STEER.1b/AC7 | While controlling another screen, **Add to this queue** opens the one search pointed at that screen for that add only; my aim doesn't change (R23). | Unverified | — |

### STEER.1c

As a **Big-Screen Sender**, I want to go from "it's playing on the TV" straight to steering it, so that I can adjust it right away.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.1c/AC1 | The confirmation that something started on a screen offers "steer it" (see `RELY.3`). | Unverified | — |
| STEER.1c/AC2 | The same route is available afterwards from the house overview, with no time limit. | Unverified | — |

### STEER.2a

As a **Hand-Held Viewer**, I want to expand video to fill the screen and shrink it back, so that I can watch properly and still browse.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.2a/AC1 | Video can be expanded to fill the screen (or the whole display) in one step. | Partial | Desktop geometry RED→GREEN; JOURNEY-RESPONSIVE-CONTROLS phone/tablet actual viewport fill and controls-in-bounds GREEN. Other entry-point parity pending |
| STEER.2a/AC2 | Shrinking it keeps playing without a pause or restart. | Partial | Desktop and JOURNEY-RESPONSIVE-CONTROLS phone/tablet GREEN: same node/source and zero pause events across expand/shrink/Back. Other entry-point/format parity pending |
| STEER.2a/AC3 | Audio-only playback shows a picture and title when expanded. | Unverified | — |

### STEER.3a

As a **House Watch**, I want to pause, resume, and skip on any screen, so that I can react to the room.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.3a/AC1 | Play/pause is one control that shows whether it is playing or paused. | Partial | JOURNEY-LOCAL real local pause/resume passes; remote parity and duplicate handle pending |
| STEER.3a/AC2 | Skip forward and back are available for any queue. | Unverified | — |
| STEER.3a/AC3 | After a press, the control reflects the change within 2 seconds, or tells me it hasn't happened yet (R46). | Unverified | — |
| STEER.3a/AC4 | If the screen can't be reached, the press reads "not sent" and is never carried out later (R35). | Unverified | — |

### STEER.4a

As a **Hand-Held Viewer**, I want to scrub and jump a few seconds back or forward, so that I can catch what I missed.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.4a/AC1 | A position bar can be dragged; the time is shown while dragging. | Partial | JOURNEY-PAUSED-SEEK real Arrival/Disclosure desktop RED→GREEN with native decoder completion and visible bar; earlier currentTime-assignment-only check superseded. Remote/other formats/device parity pending |
| STEER.4a/AC2 | Jump back and forward buttons are present for every playback, local or on another screen. | Partial | JOURNEY-LOCAL actual ±10-second local jumps pass; remote/other formats pending |
| STEER.4a/AC3 | Live content shows that it's live and offers "go to live" instead of a position. | Unverified | — |

### STEER.5a

As a **House Watch**, I want to change volume and speed for whatever I'm steering, so that it suits the listener.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.5a/AC1 | Volume can be changed with large tap targets (steps up and down), not only by dragging, and the level is shown. | Unverified | — |
| STEER.5a/AC2 | Speed can be changed for spoken word and video wherever the screen supports it. | Unverified | — |
| STEER.5a/AC3 | Changes take effect on the screen being steered, not on this device. | Unverified | — |

### STEER.6a

As a **Fixer**, I want to stop playback and know what stopping leaves, so that I don't lose a queue by accident.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.6a/AC1 | There is one "stop" control, meaning the same thing everywhere. | Partial | JOURNEY-STOP-RESTART proves actual local Stop; consistent surface/remote semantics pending |
| STEER.6a/AC2 | After stopping, I'm told what remains ("Queue kept: 8 items") and can reopen it. | Partial | JOURNEY-STOP-RESTART queue reopens; complete feedback/remote parity pending |
| STEER.6a/AC3 | Emptying the queue is a separate, clearly named action (`STEER.8`). | Unverified | — |
| STEER.6a/AC4 | Where the screen supports it, stop also offers **and turn the screen off** (R42). | Unverified | — |

### STEER.10a

As a **Resumer**, I want a sleep timer, so that a bedtime audiobook stops once I'm asleep and I can find where I dropped off.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.10a/AC1 | I can set it to stop after a number of minutes, or at the end of this chapter or episode. | Unverified | — |
| STEER.10a/AC2 | Playback fades out rather than cutting off, and the time left shows on the handle. | Unverified | — |
| STEER.10a/AC3 | Continue later offers both where it stopped and where the timer was set. | Unverified | — |

### STEER.11a

As a **House Watch**, I want to pause or stop every screen at once, so that I can quiet the house in one step.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.11a/AC1 | **Pause all** and **Stop all** are on the house view and the handle. | Unverified | — |
| STEER.11a/AC2 | After pausing all, **Resume all** brings back exactly the screens that were playing. | Unverified | — |
| STEER.11a/AC3 | Screens that couldn't be reached are listed as not paused. | Unverified | — |

### STEER.12a

As a **House Watch**, I want to turn subtitles on and choose the audio language for whatever I'm steering, so that visiting grandparents can follow the film.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.12a/AC1 | Subtitles and audio language are available for this device and for any screen through its Remote. | Unverified | — |
| STEER.12a/AC2 | Only the languages the item actually has are offered. | Unverified | — |
| STEER.12a/AC3 | The choice carries on to the next episode of the same show. | Unverified | — |

### STEER.7a

As a **Queue Builder**, I want to open the queue for any playback from anywhere, even after it stops, so that I always know what's next.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.7a/AC1 | The queue is reachable in one step from the handle on my playback and from any screen's controls. | Unverified | — |
| STEER.7a/AC2 | It's still reachable after stopping, until I clear it or start fresh. | Partial | JOURNEY-STOP-RESTART local reopen and actual restart pass; clear/reset and remote journeys pending |
| STEER.7a/AC3 | It shows what's playing now, what's next (including items placed "next"), and a count. | Unverified | — |
| STEER.7a/AC4 | Photos have a queue like video and audio; a live channel or camera is a single thing with no queue or position (Q5). | Unverified | — |
| STEER.7a/AC5 | Each queue also shows what **played earlier** (`FIND.11`). | Unverified | — |

### STEER.8a

As a **Queue Builder**, I want to reorder, jump to, remove, and clear queue items, so that the order is exactly right.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.8a/AC1 | I can move an item up or down, or drag it, and the new order shows immediately. | Unverified | — |
| STEER.8a/AC2 | Tapping an item plays it now. | Unverified | — |
| STEER.8a/AC3 | Removing one item or clearing all can be undone for 10 seconds (default; see `RELY.4`). | Unverified | — |
| STEER.8a/AC4 | These work identically for this device and another screen. | Unverified | — |

### STEER.9a

As a **Queue Builder**, I want to set repeat and shuffle once, in one place, so that it plays on the way I want.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.9a/AC1 | Repeat (off, all, one) and shuffle each appear once, alongside the queue, and show whether they are on. | Unverified | — |
| STEER.9a/AC2 | Changing them doesn't interrupt what's playing. | Unverified | — |
| STEER.9a/AC3 | They behave the same for any screen. | Unverified | — |
| STEER.9a/AC4 | Shuffle only reorders what's already queued; items placed "next" are never shuffled, and turning shuffle off restores the original order (R26). | Unverified | — |

### STEER.13a

As an **Ambient listener**, I want to choose what happens when the queue ends, so that the house doesn't go silent mid-dinner.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.13a/AC1 | The end of the queue offers: stop, repeat, or keep similar things playing. | Unverified | — |
| STEER.13a/AC2 | The current choice is shown at the bottom of the queue. | Unverified | — |
| STEER.13a/AC3 | Items added by "keep similar things playing" are marked as added automatically. | Unverified | — |

### STEER.13b

As a **Resumer**, I want the next episode to start on its own after a countdown, with "stop after this one", so that a series carries on without fetching the phone, and a parent can end it.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| STEER.13b/AC1 | At the end of an episode, the next starts after a visible countdown that can be cancelled. | Unverified | — |
| STEER.13b/AC2 | **Stop after this one** can be set during an episode, on this device or from a Remote. | Unverified | — |
| STEER.13b/AC3 | Next-episode behaviour lives here; carry on only lists what's next (`FIND.10`). | Unverified | — |

### HOUSE.1a

As a **House Watch**, I want a glanceable sign of what's playing around the house from anywhere in the app, so that I notice without going looking.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.1a/AC1 | One house indicator is visible everywhere in the app, on every device size, shown once. | Unverified | — |
| HOUSE.1a/AC2 | It states how many screens are playing (and whether any are paused). | Unverified | — |
| HOUSE.1a/AC3 | Opening it shows the full overview in one step. | Unverified | — |

### HOUSE.2a

As a **House Watch**, I want to see what every screen is doing, all together, so that I understand the house at once.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.2a/AC1 | Each screen shows its name, room, whether it is playing, paused, idle, or off, and, when playing, picture, title, and progress. | Unverified | — |
| HOUSE.2a/AC2 | From any screen in the overview I can open its controls (`STEER.1b`), move its playback here (`PLACE.7`), or play something on it (`PLACE.3`). | Unverified | — |
| HOUSE.2a/AC3 | Screens that are playing appear before idle and off ones. | Unverified | — |
| HOUSE.2a/AC4 | Each row has **Pause**, **Stop**, and **Move here** directly on it (R22). | Unverified | — |
| HOUSE.2a/AC5 | A row shows that screen's current start progress or last failure to everyone, not only to the device that sent it (R36). | Unverified | — |
| HOUSE.2a/AC6 | The overview offers **Pause all** and **Stop all** (`STEER.11`). | Unverified | — |

### HOUSE.2b

As a **Room Hopper**, I want to see this device alongside every other screen in the overview, so that the house picture is whole.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.2b/AC1 | This device appears in the overview, marked as "this device". | Unverified | — |
| HOUSE.2b/AC2 | What it shows matches what other people see for it from their devices (checked with two devices side by side). | Unverified | — |

### HOUSE.3a

As a **House Watch**, I want to know when information might be out of date, so that I don't act on old news.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.3a/AC1 | A screen that hasn't reported in the last 2 minutes (default) is marked with when it was last heard from. | Unverified | — |
| HOUSE.3a/AC2 | If this device loses touch with the house, the whole overview says so, and recovers on its own. | Unverified | — |
| HOUSE.3a/AC3 | Controls on an uncertain screen say that the result may not be confirmed. | Unverified | — |

### HOUSE.4a

As a **Routine Setter**, I want every screen, including browsers, to have a human name, so that people and routines can pick the right one.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.4a/AC1 | Every screen is listed under a name like "Kitchen tablet" or "Dad's laptop", never a code. | Unverified | — |
| HOUSE.4a/AC2 | Anyone can name or rename a device from within the app; TVs and kiosks come already named (Q10). | Unverified | — |
| HOUSE.4a/AC3 | Names are unique. After a rename, the house view shows "Poo (was Kitchen tablet)" for a week (default), and renaming a screen a routine uses says so first (R31). | Unverified | — |
| HOUSE.4a/AC4 | The name stays the same across reloads and appears everywhere the screen is mentioned. | Unverified | — |

### HOUSE.5a

As a **House Watch**, I want to see whether a person or a routine started something, so that unexpected playback makes sense.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.5a/AC1 | A screen's playback shows how it started, for example "Started by kitchen button, 7:02". | Unverified | — |
| HOUSE.5a/AC2 | The same note appears in the screen's controls. | Unverified | — |

### HOUSE.6a

As a **Setup person**, I want to add, place, merge, and retire screens, so that the house list stays trustworthy.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| HOUSE.6a/AC1 | I can add a screen and give it a name and a room. | Unverified | — |
| HOUSE.6a/AC2 | When a device reappears as a duplicate, I can merge it with its earlier self. | Unverified | — |
| HOUSE.6a/AC3 | Before retiring an old screen, I'm shown which routines point at it. | Unverified | — |
| HOUSE.6a/AC4 | Screens silent for more than 30 days (default) fold into a "not seen lately" section. | Unverified | — |

### RELY.1a

As a **Seeker**, I want every play, add, and send to confirm in the same way, so that I never wonder whether a tap worked.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.1a/AC1 | Every action that changes what's playing or lined up gives a short confirmation naming the item and the screen. | Unverified | — |
| RELY.1a/AC2 | The same outcome confirms the same way, whichever control started it, on every device size. | Unverified | — |
| RELY.1a/AC3 | When the result is already obvious on this device (it visibly starts playing here), the confirmation is brief and unobtrusive. | Unverified | — |
| RELY.1a/AC4 | Confirmations don't pile up; a newer one replaces an older one of the same kind. | Unverified | — |
| RELY.1a/AC5 | "The same outcome" includes where it happened: playing here confirms quietly, while playing on another screen confirms with that screen's name and progress (T8). | Unverified | — |

### RELY.2a

As a **Big-Screen Sender**, I want to see progress while a TV turns on and loads, so that waiting doesn't feel like failure.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.2a/AC1 | While a far screen gets ready, I see its steps in plain words ("Turning on", "Loading"). | Unverified | — |
| RELY.2a/AC2 | Progress is visible wherever I go in the app until the outcome is known. | Unverified | — |
| RELY.2a/AC3 | The wording fits the screen type (it doesn't say "TV" for a speaker). | Unverified | — |

### RELY.3a

As a **Big-Screen Sender**, I want to know it actually started, so that I can put the phone down.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.3a/AC1 | When playback is confirmed, I see "Playing on Living Room TV" with a way to steer it. | Unverified | — |
| RELY.3a/AC2 | If it can't be confirmed, I'm told it may not have started, with options to check (steer it) or try again. | Unverified | — |
| RELY.3a/AC3 | An unconfirmed outcome stays visible until I dismiss it. | Unverified | — |
| RELY.3a/AC4 | "May not have started" notices for the same screen replace each other, and clear once that screen reports playing (R37). | Unverified | — |

### RELY.4a

As a **Queue Builder**, I want to undo my last change, so that a slip costs nothing.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.4a/AC1 | After replacing what's playing, removing, or clearing, an undo is offered for 10 seconds (default). | Unverified | — |
| RELY.4a/AC2 | Undo restores the previous item, position, and queue on that screen. | Unverified | — |
| RELY.4a/AC3 | Truly irreversible actions (starting fresh) ask first instead of offering undo. | Unverified | — |
| RELY.4a/AC4 | Undo (**Put it back**) is also available from the affected screen's Remote on any device, not only on the device that made the change (R13). | Unverified | — |

### RELY.4b

As a **Bystander**, I want to put back what was on from the screen that was changed, so that I don't need the phone that changed it.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.4b/AC1 | The note on the changed screen offers **Put it back** (Q7, R30). | Unverified | — |
| RELY.4b/AC2 | Any device's Remote for that screen offers the same (R13). | Unverified | — |
| RELY.4b/AC3 | Putting it back restores the item, its spot, and its queue. | Unverified | — |

### RELY.5a

As a **Hand-Held Viewer**, I want to be told when playback fails or skips an item, wherever I am, so that silence never hides a problem.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.5a/AC1 | A failure shows a notice naming the item and screen, in plain words, even if I'm in another part of the app. | Unverified | — |
| RELY.5a/AC2 | If an item was skipped because it failed, the notice says so and what's playing instead. | Unverified | — |
| RELY.5a/AC3 | The handle on my playback shows a problem sign until things recover. | Unverified | — |
| RELY.5a/AC4 | The same applies to failures on other screens I started or am steering. | Unverified | — |

### RELY.6a

As a **Fixer**, I want to retry exactly the attempt that failed, so that fixing it is one step.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.6a/AC1 | Every failure notice has its own retry, which retries that attempt (same item, same screen), no other. | Unverified | — |
| RELY.6a/AC2 | Next to retry, I can choose another screen for that attempt. | Unverified | — |
| RELY.6a/AC3 | Several failures are each shown separately with their own retry. | Unverified | — |

### RELY.7a

As a **Hand-Held Viewer**, I want everything to survive a reload or a network hiccup, so that I don't lose my place.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.7a/AC1 | After a reload or crash, what was playing, its position, its queue, and repeat and shuffle are as they were, with playback paused rather than suddenly playing aloud (R38). | Unverified | — |
| RELY.7a/AC2 | My aim is restored too, unless the idle time has passed (R7). | Unverified | — |
| RELY.7a/AC3 | Every screen keeps its spot and queue through a power cut (R38). | Unverified | — |
| RELY.7a/AC4 | A brief network hiccup doesn't reload the app or interrupt what I'm doing; I see a quiet "reconnecting" note if it lasts. | Unverified | — |
| RELY.7a/AC5 | The part of the app I was in is restored. | Unverified | — |

### RELY.8a

As a **Fixer**, I want to start fresh knowing what will be cleared, so that I get a clean slate without surprises.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.8a/AC1 | "Start fresh" is in this device's settings, reachable in one step from anywhere (R46). | Unverified | — |
| RELY.8a/AC2 | It lists exactly what will be cleared (what's playing, queue, position, aim) and lets me keep some of it. | Unverified | — |
| RELY.8a/AC3 | It asks for confirmation, then everything reads as new. | Unverified | — |

### RELY.9a

As a **Wanderer**, I want to know where I am and move between the main areas, so that I never feel lost.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.9a/AC1 | The current area is always highlighted, including when I'm in the queue or another screen's controls. | Unverified | — |
| RELY.9a/AC2 | Choosing the area I'm already in takes me to its top, without adding extra steps to going back. | Unverified | — |

### RELY.10a

As a **Wanderer**, I want "back" to retrace my steps, so that I can find my way out.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.10a/AC1 | Back, whether the device's own back or an on-screen one, goes one step to where I actually came from. | Unverified | — |
| RELY.10a/AC2 | Any on-screen back is labelled with where it goes, and goes there. | Unverified | — |
| RELY.10a/AC3 | Closing a pop-up counts as one back. | Partial | Desktop retained-search Escape preserves underlying NowPlaying in26262; real-provider tests prove second Escape base Back. Other overlays/device-back parity remains open |

### RELY.14a

As a **Setup person**, I want a first-use moment on a new device, so that it gets a name and whoever holds it learns where taps go.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.14a/AC1 | The first time the app opens on a device, it asks for a name, with a sensible default and a way to skip. | Unverified | — |
| RELY.14a/AC2 | It explains the "Playing to:" aim label once. | Unverified | — |
| RELY.14a/AC3 | A household with nothing played yet sees a way into browsing by kind instead of an empty page. | Unverified | — |

### RELY.11a

As a **Seeker** with low vision, I want large text, spoken announcements, and status that isn't shown by colour alone, so that I can use the app without squinting.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.11a/AC1 | Text follows the device's large-text setting without anything being cut off. | Unverified | — |
| RELY.11a/AC2 | Every confirmation, warning, and change of status is announced by screen readers. | Unverified | — |
| RELY.11a/AC3 | Playing, paused, and out-of-date are shown with words or shapes as well as colour. | Unverified | — |

### RELY.12a

As a **Hand-Held Viewer** holding a baby, I want the main controls within thumb reach, so that I can use the app one-handed.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.12a/AC1 | The aim, play/pause, and search can be reached with one thumb on a phone. | Unverified | — |
| RELY.12a/AC2 | No essential action needs two hands. | Unverified | — |

### RELY.13a

As a **Big-Screen Sender** on a sunny patio, I want the app readable in glare, so that I can still see where things will play.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| RELY.13a/AC1 | Text and controls keep enough contrast to read outdoors. | Unverified | — |
| RELY.13a/AC2 | The aim label and confirmations stay legible at arm's length. | Unverified | — |

### AUTO.1a

As a **Routine Setter**, I want a button, tag, or routine to start content on a named screen, so that the house does the right thing with nobody at a screen.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| AUTO.1a/AC1 | When the trigger fires, the named screen starts the chosen item, queue, or shuffled collection, with the chosen volume. | Unverified | — |
| AUTO.1a/AC2 | It starts within the same few seconds a person's send would. | Unverified | — |
| AUTO.1a/AC3 | Progress and failures are reported like any other send, visible to anyone looking at that screen in the overview (see `HOUSE.5`), and recorded in routine history (`AUTO.4`). | Unverified | — |

### AUTO.1b

As a **Routine Setter**, I want a routine to be able to start playback on a device left open on the wall, so that the kitchen tablet can play the morning programme. *(Persona corrected, R48.)*

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| AUTO.1b/AC1 | Any named device left open in the app can be a target for routines (Q10). | Unverified | — |
| AUTO.1b/AC2 | Routines follow the screen itself, so renaming it doesn't break them (R31). | Unverified | — |
| AUTO.1b/AC3 | Playback started this way appears on that device as if someone had started it there. | Unverified | — |

### AUTO.2a

As a **Routine Setter**, I want repeated or overlapping triggers to give one predictable result, so that routines don't pile up.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| AUTO.2a/AC1 | Firing the same trigger twice within 10 seconds (default) doesn't start it twice or add duplicates to the queue. | Unverified | — |
| AUTO.2a/AC2 | Reloading a device that a routine started doesn't restart the routine's content from the beginning. | Unverified | — |
| AUTO.2a/AC3 | A person's action on that screen after a routine always takes effect; the routine doesn't fight it. | Unverified | — |

### AUTO.3a

As a **House Watch**, I want every screen, including browsers, to report what it's playing to the rest of the house, so that the overview and household displays are complete.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| AUTO.3a/AC1 | Anything playing on any device in the app appears in the overview and on other household displays. | Unverified | — |
| AUTO.3a/AC2 | When a device stops or is closed, it shows as stopped soon after, not as still playing. | Unverified | — |
| AUTO.3a/AC3 | A person using the app on a device can see that it is visible to the house. | Unverified | — |

### AUTO.4a

As a **Routine Setter**, I want a record of recent routine starts and how they went, so that a failed 7:00 routine doesn't go unnoticed.

| Criterion | Observable outcome | Status | Test / evidence |
|---|---|---|---|
| AUTO.4a/AC1 | A list shows each routine start: when, which screen, what, and whether it played. | Unverified | — |
| AUTO.4a/AC2 | A failure is marked plainly, with the reason ("Kitchen tablet was asleep"). | Unverified | — |
| AUTO.4a/AC3 | A routine pointed at a screen that isn't on or reachable is flagged ahead of time. | Unverified | — |
