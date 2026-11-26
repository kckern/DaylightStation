# Webapp Design System

Admin, Health, Media, Feed, Home, Life, Auto and Finance share browser layout and interaction contracts. Theme packs supply app-specific art direction. Playback engines and feature workflows stay with their apps.

## Find a pattern by task

| Task | Start here | Example |
| --- | --- | --- |
| Open a destination or select a local view | `AppChrome` accepts tabs with an optional `href`. A destination renders a router link. A local view calls `onTabChange(id)`. The app owns selection and reload behavior. | Life routes and Home views |
| Open or dismiss a dashboard item | Use a router link for the destination and a sibling button for dismissal. Cards without a destination can still offer dismissal. Give compact dismiss buttons the shared touch target. A card with one action can be the link itself. | [Life priorities](../../../__app_modules/personal/life/browser/views/now/PriorityList.jsx) · [Life goal cards](../../../__app_modules/personal/life/browser/views/plan/GoalsView.jsx) |
| Open a feature from a keyboard shortcut | `useHotkey(combo, handler)` binds the shortcut for the mounted owner. Launch shortcuts yield to editable fields and focused modal dialogs. The app chooses the destination or control. Return `false` when there is nothing to open. | [Feed search](../../../__app_modules/media/feed/browser/FeedApp.jsx) · [Media search](../../../__app_modules/media/media/browser/shell/MediaAppShell.jsx) · Health Coach |
| Let native controls own keyboard activation | Shared playback shortcuts leave editable fields alone and yield Enter, Space, and Tab to focused buttons, links, and `role="button"` elements. Other media keys such as `MediaPlayPause` still reach the Player. | [Playback keyboard manager](../../../frontend/src/lib/keyboard/keyboardManager.js) · [Admin queue preview](../../../frontend/src/modules/Admin/Preview/AdminPreviewPlayer.jsx) |
| Honor reduced motion in a browser interaction | Read `getReducedMotionQuery(window)?.matches` from the interaction owner before starting a Web Animations API transition. Under reduced motion, apply the final visual state directly and complete navigation immediately. Cancel visit-bound animations and callbacks when the owner changes or unmounts. | [Feed article detail](../../../__app_modules/media/feed/browser/Scroll/detail/DetailView.jsx) |
| Keep a conversation across views | Use `useAgentConversation` and `AgentConversationProvider` at the member-owned boundary. Both views render `AgentChatSurface` with that conversation. A feature can opt in to restoring its transcript in the same browser tab with `persistSession: true`. The shared surface labels failed replies and retries the same user turn with its submitted attachments; cancellation remains distinct. Mention categories and attachment formats stay with the feature. | [Health Coach](../../../__app_modules/wellness/health/browser/HealthApp.jsx) · [Chat capability](../../../__capabilities/agent-runtime/browser/chat.mjs) |
| Move through a list with held keys | Use `useHotkey` with `allowRepeat: true`. The list owns movement and centering. The shortcut yields to a focused dialog or editable control. | [Feed list navigation](../../../__app_modules/media/feed/browser/useFeedListShortcuts.js) |
| Compose a grouped editor | Supply header and navigation to `AppFrame`. Its `mainRef` points to the primary scroll region. For the responsive shell with bottom tabs on mobile and a left rail on larger screens, use `AppChrome`. `AppChrome` supports at most three `headerActions`; keep the header quiet beyond that. | [Admin layout](../../../frontend/src/modules/Admin/AdminLayout.jsx) · [Home shell](../../../__app_modules/household/home/browser/HomeApp.jsx) · [Life shell](../../../__app_modules/personal/life/browser/LifeApp.jsx) |
| Leave a draft in Admin | Use `GuardedLink` for user-selected destinations and `useGuardedNavigate()` for user actions that leave the editor. Modified link clicks keep normal browser behavior. Member and device drafts survive same-tab Back/Forward in memory; explicit in-app discard uses the provider's single confirmation and clears the draft. A successful delete can keep its direct continuation. | [Member and device editors](../../../frontend/src/modules/Admin/Household/MemberEditor.jsx) · [Draft lifecycle](../../../frontend/src/modules/Admin/shared/useAdminDraftState.js) · [Config editor](../../../frontend/src/modules/Admin/Config/ConfigFileEditor.jsx) · [Admin breadcrumbs](../../../frontend/src/modules/Admin/AdminHeader.jsx) |
| Keep Admin household choices and badges aligned | Import the shared `DEVICE_TYPES`, `MEMBER_TYPES`, and `MEMBER_GROUPS` options from `modules/Admin/utils/constants.js`; use `deviceTypeBadgeColor`, `typeBadgeColor`, and `groupBadgeColor` for their badges. These are Admin domain labels and mappings, not cross-app theme tokens. | [Device list and editor](../../../frontend/src/modules/Admin/Household/DevicesIndex.jsx) · [Member list](../../../frontend/src/modules/Admin/Household/MembersIndex.jsx) · [Admin household vocabulary](../../../frontend/src/modules/Admin/utils/constants.js) |
| Recover a failed control-list lookup | Surface the read's error beside the control that depends on it and retry through that same resource's `reload`. Keep loaded choices mounted and use `useRetryRegion` to move focus to a stable owner before Retry disappears. | [Admin agent member selector](../../../__capabilities/agent-runtime/browser/admin/AgentDetail.jsx) |
| Require an explicit member before a member-scoped command | Disable the command without a resolved member and guard the event handler before constructing the request. | [Admin agent assignment](../../../__capabilities/agent-runtime/browser/admin/OverviewTab.jsx) |
| Show optional numeric settings | Use nullish fallback for an optional number so a valid `0` remains visible; express invalid ranges with the input constraints. | [Health Coach configuration](../../../__app_modules/wellness/health/browser/admin/agents/HealthCoachConfigTab.jsx) |
| Render Admin execution status | Use `statusBadgeColor(status)` from `modules/Admin/utils/constants.js` so list and detail badges share the Admin outcome palette. Keep a view-specific label such as “never run” at the view boundary. | [Scheduler list](../../../frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx) · [Scheduler detail](../../../frontend/src/modules/Admin/Scheduler/JobDetail.jsx) |
| Keep Tab inside an open compact drawer | Use `keepTabInPanel` on the active keyboard scope. Include visible header controls when they are part of that scope. Let docked navigation follow the page’s normal Tab order. Keep Escape handling and return focus with the drawer owner. | [Admin navigation](../../../frontend/src/modules/Admin/AdminLayout.jsx) · [Feed subscriptions](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) |
| Keep controls inside the display safe area | `AppFrame` and `PlaybackFrame` reserve the four device insets at their outer edges. Flow content uses the remaining space. A viewport-fixed surface can use the `--browser-safe-area-*` properties for its own bounds. | [Shared frame and overlay styles](../../../frontend/src/lib/ui/ds.scss) |
| Keep notices clear of frame controls | Pass an in-flow notice host to the `notices` slot on `AppFrame` or `AppChrome`. The row sits below the header, collapses when empty and scrolls independently of the main region for a long stack. | [Life notifications](../../../__app_modules/personal/life/browser/LifeApp.jsx) |
| Measure or adjust the active scroll region | Inside `AppFrame` content, get the ref with `useAppMainRef()` and read `ref?.current` in an event or effect. The frame owns the element and a caller can still receive it through the `mainRef` prop. | Home Mosaic tooltip positioning, Health food selection and toast clearance |
| Return to a view at its previous position | `useViewScroll({mainRef, viewKey, owner, ready})` starts a pending destination at the top, restores its position after content mounts, and clears remembered positions when the owner changes. Give separate destinations their own keys even when they share a navigation item. | [Health Today, Settings and Auditor](../../../__app_modules/wellness/health/browser/HealthApp.jsx) · [Life Plan and linked logs](../../../__app_modules/personal/life/browser/LifeApp.jsx) · [Auto record tabs](../../../__app_modules/household/auto/browser/AutoApp.jsx) · [Home views](../../../__app_modules/household/home/browser/HomeApp.jsx) |
| Keep a draft and pending save when a route changes | Keep `AppView active={...}` mounted and key a sheet's form state to the visit identity. Let `Sheet` derive visibility from the active view so it releases Escape, focus, viewport observation and scroll locks without unmounting the pending operation. The app can set `suspendOverlays` when an app-wide overlay covers the view. Gate dependent writes on their owning session, not merely on whether the view is visible. | [Health Today and custom-food sheet](../../../__app_modules/wellness/health/browser/HealthApp.jsx) · [Custom-food form](../../../__app_modules/wellness/health/browser/capture/CustomFoodSheet.jsx) |
| Isolate a dialog from its application and restore focus | `Sheet` hides the containing app's inactive siblings from assistive technology while keeping body-level portaled choices available. When its opener can disappear or become disabled during an async operation, provide `getFallbackFocusTarget` from the view owner. | [Dialog focus isolation](../../../frontend/src/lib/ui/dismiss/useDialogFocus.js) · [Feed Assembly](../../../__app_modules/media/feed/browser/Scroll/FeedAssemblyOverlay.jsx) · [Life Values](../../../__app_modules/personal/life/browser/views/plan/ValuesView.jsx) |
| Keep a row of touch controls reachable on a narrow screen | Use the shared touch target size and let the row own horizontal overflow. Bring the full control into view when it receives keyboard focus. | [Health week navigator](../../../__app_modules/wellness/health/browser/today/WeekStrip.jsx) |
| Choose content without losing an unsaved form | Bind the catalog combobox to the draft’s content ID. On selection, update that field and keep the editor mounted. The editor owns Save and Cancel. | [Admin list item editor](../../../__capabilities/content-catalog/browser/admin/ListsItemEditor.jsx) |
| Search and choose catalog content | Use `useContentCombobox` for shared catalog query, filtering, request and result ownership. Use `ContentCombobox` when its anchored picker fits; a full-screen search can render its own result layout from the same controller while retaining app-owned dispatch and destination behavior. | [Admin list editor](../../../__capabilities/content-catalog/browser/admin/ListsItemEditor.jsx) · [Media dock picker](../../../__app_modules/media/media/browser/search/MediaContentSearch.jsx) · [Media full-screen search](../../../__app_modules/media/media/browser/search/SearchMode.jsx) · [Catalog picker](../../../__capabilities/content-catalog/browser/combobox/ContentCombobox.jsx) |
| Append a page to a filtered result | Keep the rows and cursor with the selected filter. Use the read scope's idle-only `poll` for automatic append. An append failure can retain the loaded rows and offer a retry for the same cursor. | [Feed Search](../../../__app_modules/media/feed/browser/Search/FeedSearch.jsx) · [Feed Reader](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) · [Media Browse](../../../__app_modules/media/media/browser/browse/useListBrowse.js) |
| Accept a typed content ID | Use the catalog picker's freeform mode. It shares a complete source and alias lookup across editors. If the lookup fails, typed IDs still save and reopening retries validation. | [Catalog source validation](../../../__capabilities/content-catalog/browser/lib/knownSources.js) |
| Keep playback alive while browsing | `PlaybackFrame` places controls, overlays and the engine alongside routed children. Each app supplies one main landmark. Feed passes its scrolling element to its routes through Outlet context. | Feed reader and Media canvas |
| Keep local playback through a prolonged connection outage | Hold a WebSocket auto-reload suppression lease at the mounted playback app root and release it on exit. Reconnect continues while the native decoder plays. | [Feed root](../../../__app_modules/media/feed/browser/FeedApp.jsx) · [Media root](../../../__app_modules/media/media/browser/MediaApp.jsx) |
| Keep controls with their playback owner | Show persistent controls while the persistent renderer owns a playable source. An inline player can have its own controls or explicitly park the persistent source. | [Feed layout](../../../__app_modules/media/feed/browser/FeedApp.jsx) |
| Display progress for persistent playback | Suspend display updates while the document is hidden. The playback controller continues to own the clock and command position. When the document returns, sample the current clock before subscribing to its updates. A sheet scrub preview owns the fill until the gesture ends. | [Feed playback observer](../../../__app_modules/media/feed/browser/Scroll/hooks/usePlaybackObserver.js) · [Feed player sheet](../../../__app_modules/media/feed/browser/players/FeedPlayerSheet.jsx) · [Media position display](../../../__app_modules/media/media/browser/controller/usePlaybackPosition.js) |
| Update relative-time labels while visible | Use `useDisplayClock(active, intervalMs)` for display-only wall-clock sampling. It pauses its interval while the document is hidden and samples again when the page returns. Keep authoritative deadlines and playback positions with their feature owner. | [Shared display clock](../../../frontend/src/lib/hooks/useDisplayClock.js) · [Media staleness](../../../__app_modules/media/media/browser/admin/playback-hub/hooks/useStaleness.js) |
| Show temporary action feedback | Use `useTemporaryIndicator(durationMs)` when repeated successful actions should restart the feedback interval. The hook clears its timer on unmount; the feature owns what the indicator means. | [Shared indicator hook](../../../frontend/src/lib/hooks/useTemporaryIndicator.js) · [Feed assembly overlay](../../../__app_modules/media/feed/browser/Scroll/FeedAssemblyOverlay.jsx) |
| Record progress without blocking playback | Pass the current asset, position and playback context to the shared progress command. A failed write reports the refusal. The next scheduled write uses its own position. | [Playback progress command](../../../__capabilities/playback/browser/player/lib/recordPlaybackProgress.js) |
| Resume an interrupted track | Keep a verified position with the mounted content ID in the current session. Use the existing Player renderer operation when that track becomes active again and the renderer accepts the same seek coordinate. | [Feed persistent player](../../../__app_modules/media/feed/browser/Scroll/PersistentPlayer.jsx) |
| Apply playback settings to a replacement decoder | Keep the session's volume and temporary output fade with the playback owner. Apply their combined value when the native decoder binds, and release media readiness listeners with that decoder. | [Media player bridge](../../../__app_modules/media/media/browser/session/PlayerBridge.jsx) |
| Measure the current playback surface | Bind decoder measurements and shader rendering to the mounted native video. Release its observation, timers and renderer together when the video changes. For cover art, measure the mounted image against its current source so a replacement begins without the prior image's blur. | [Video renderer](../../../__capabilities/playback/browser/player/renderers/VideoPlayer.jsx) · [Audio renderer](../../../__capabilities/playback/browser/player/renderers/AudioPlayer.jsx) |
| Render a symbol or configured icon | `UiIcon` renders a curated Tabler symbol by `name` and accepts `assetName` for an SVG under `media/img/icons`. The asset name can include the `.svg` extension. When the image is absent or fails to load, `name` selects its shared fallback symbol. The surrounding control supplies the accessible name. Use these names for app navigation so shell icons share one inventory. | [Home navigation](../../../__app_modules/household/home/browser/HomeApp.jsx) · [Life navigation](../../../__app_modules/personal/life/browser/LifeApp.jsx) · [Auto navigation](../../../__app_modules/household/auto/browser/AutoApp.jsx) · [Fitness navigation rail](../../../__app_modules/wellness/fitness/browser/nav/FitnessNavbar.jsx) |
| Read server data | Use `useApiResource(path)` for a mounted JSON reader and `readApiResource(path)` for a one-time read that should warm or update the same shared cache. After a committed write, first invalidate affected resource keys so the read cannot join a pre-write GET; then, when readback must finish after its view unmounts, use `readApiResource(path, { freshMs: 0, followSuperseding: true })`. It follows same-registration replacement reads and stops if the owner generation changes. `DaylightAPI` supports standalone JSON operations and writes. | [Catalog title lookup](../../../__capabilities/content-catalog/browser/lib/useContentTitle.js) · [Catalog metadata](../../../__capabilities/content-catalog/browser/admin/catalogContentInfo.js) · [Admin member roster](../../../frontend/src/modules/Admin/Household/MembersIndex.jsx) · [Life value ranking and readback](../../../__app_modules/personal/life/browser/hooks/useLifePlan.js) |
| Read the household device roster | Use `useDeviceConfig(options)` for the canonical device configuration resource. Derive the displayed device from that roster and the current route. The caller retains its own retry and recovery policy. | [Resource hook](../../../frontend/src/lib/hooks/useDeviceConfig.js) · [Media Fleet](../../../__app_modules/media/media/browser/fleet/useDevices.js) · [VideoCall](../../../__app_modules/household/homeline/browser/VideoCall.jsx) |
| Read an account-owned response at a shared URL | For a reader that mounts anew per account and keeps its response local, pass `dedupe: false` to `useApiResource`. The request bypasses in-flight sharing and retains the resource's retry behavior. Keep `swr` off for these readers. | [Feed headline pages](../../../__app_modules/media/feed/browser/FeedApp.jsx) · [Feed subscriptions](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) · [Admin Sessions](../../../frontend/src/modules/Admin/Household/SessionsIndex.jsx) |
| Show the result of loading a list | Use `LoadingState` while the initial read is pending, `ErrorState` with the resource's retry action when the read fails, and `EmptyState` for a confirmed empty result. Set `title` when the recovery region needs a domain-specific heading; adapters must pass the supported title through. Use `StateMessage` when a successful response reports that the service is unavailable. | [Admin integrations](../../../frontend/src/modules/Admin/System/IntegrationsIndex.jsx) · [Signed-in devices](../../../frontend/src/modules/Admin/Household/SessionsIndex.jsx) · [Life ceremony recovery](../../../__app_modules/personal/life/browser/views/ceremony/CeremonyFlow.jsx) |
| Show a quiet Media stream or search error | Use Media's `LoadErrorLine` when the error needs friendly service-specific copy and a local Retry action; pass the `kind` and error value to `loadErrorMessage`. Keep raw transport detail in logs. Use shared `ErrorState` for the standard section-level failure presentation. | [Fleet search](../../../__app_modules/media/media/browser/fleet/FleetPlayPicker.jsx) · [Media load error copy](../../../__app_modules/media/media/browser/shared/loadErrorCopy.js) |
| Announce completed Media search results | Render the empty-result sentence as a `role="status"` live region. If a source failed, say results may be incomplete and put Retry beside, outside the live region; do not claim the search was definitively empty. | [Fleet search empty state](../../../__app_modules/media/media/browser/search/SearchEmptyState.jsx) |
| Recover a failed dashboard section | Give each independent read its own status and Retry. Keep successful sections visible during recovery and show empty copy only after a successful empty read. If a cached empty value is revalidating, keep the recovery region mounted and show loading; if that refresh fails, offer Retry instead of presenting the empty cache as current. | [Life Dashboard](../../../__app_modules/personal/life/browser/views/now/Dashboard.jsx) · [Health weight history](../../../__app_modules/wellness/health/browser/today/WeightChip.jsx) |
| Filter a loaded snapshot | Keep the selection with the view and derive the visible activity from the resource's response. The account and period select the Life Log read. Category changes project that response without fetching it again. | [Life Log projection](../../../__app_modules/personal/life/browser/views/log/shared/useLogActivity.js) |
| Let someone dismiss an error without clearing its resource | `useDismissibleError(error)` returns the visible error and a `dismiss()` action. Dismissal applies to that error object. The resource owns the error, and a later error remains visible. | [Admin configuration editor](../../../frontend/src/hooks/admin/useAdminConfig.js) · [Health Agent Dashboard](../../../__app_modules/wellness/health/browser/admin/agents/useAgentDashboard.js) |
| Interpret a command response | Use `daylightApiResponse(path, { method, data, body, contentType, signal })` when the feature needs the original HTTP status and body. The shared client supplies request headers and serializes `data` as JSON or multipart. Use `body` with `contentType` for a raw payload. The feature interprets partial successes and controls retries. | [Playback Hub commands](../../../__app_modules/media/media/browser/admin/playback-hub/hooks/useHubMutations.js) · [Screen registry conflicts](../../../__app_modules/media/media/browser/house/houseApi.js) |
| Save a versioned document | Pass the current revision in `ifMatch` and read `ETag` from the response headers after a successful write. Keep the edited document and conflict errors with the feature. | [Agenda editor client](../../../__app_modules/household/agenda/browser/admin/agendaClient.js) |
| Consume a stream or image | Use `daylightApiResponse` for same-origin requests and pass the response body to the consumer that owns its lifetime. Chat parses incremental events. Camera previews revoke their object URLs when replaced. | [Chat runtime](../../../__capabilities/agent-runtime/browser/chat/runtime.js) · [Camera snapshots](../../../__app_modules/household/camera/browser/useSnapshotFetch.js) · [Media provenance](../../../__app_modules/media/media/browser/provenance/useProvenance.js) |
| Upload a file or raw asset | Pass native `FormData` as `data`; the browser sets its multipart boundary. For a raw string or binary payload, pass `body` and its explicit `contentType`. The shared client supplies request identity headers in both cases. | [Catalog image picker](../../../__capabilities/content-catalog/browser/admin/ImagePickerModal.jsx) · [Admin score upload](../../../__app_modules/learning/piano/browser/admin/useSheetMusicLibrary.js) · [Admin poster upload](../../../__app_modules/learning/piano/browser/admin/posterJob.js) |
| Subscribe to live changes | Use the shared socket subscription hook. The feature checks who an event belongs to and which resource changed. On reconnect, a stateful view can reload its authoritative snapshot or accept a complete broadcast. | [Subscription hook](../../../frontend/src/hooks/useWebSocket.js) · [Admin Playback Hub](../../../__app_modules/media/media/browser/admin/playback-hub/hooks/useHubStatus.js) · [Media fleet recovery](../../../__app_modules/media/media/browser/fleet/FleetProvider.jsx) |
| Keep an event-driven session current | Use `useGamingSession(sessionId, reconciledSession)` for gameplay projections. It owns the initial and event-triggered reads, aborts replaced reads, accepts only the current session and server revision, and applies the host's reconnect snapshot without another GET. Keep editable notation and eligibility with the open experience visit. | [Public gaming entry](../../../__capabilities/gaming/browser/session-projection.mjs) · [Session projection hook](../../../__capabilities/gaming/browser/platform/useGamingSession.js) · [Admin preview event refresh](../../../tests/isolated/e2e/browser-platform/admin-form-panels.runtime.test.mjs) |
| Poll while a screen is in use | `useVisibleRefresh({active, intervalMs, reload, poll})` releases its timer when the document is hidden. Pass `poll` for interval ticks that allow an outstanding read to finish. The foreground transition calls `reload`. Set `refreshOnFocus` when an already-visible window should also refresh on focus. It uses the idle `poll` callback. | [Home entities](../../../__app_modules/household/home/browser/entities/useHomeEntities.js) · [Health day](../../../__app_modules/wellness/health/browser/today/useHealthDay.js) |
| Bound a stalled foreground read | Pass `{ timeoutMs }` to `useRefreshableRead` when the feature needs a read deadline. The deadline aborts the request and frees the polling slot. A foreground reload can replace the request immediately. Pass a cursor or other request argument to `reload` or `poll` when its value varies per read. The read and its optional `onTimeout` receive that invocation's arguments. | [Home camera detections](../../../__app_modules/household/camera/browser/useDetections.js) · [Feed Reader](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) |
| Refresh a list while someone can still page through it | Use one `useRefreshableRead` scope for an active query. Call `poll` for quiet work, including on visibility return. Use `reload` when a foreground request or a newer authoritative snapshot should replace an older read. Preserve accepted rows while a continuation retries. | [Feed Search indexing, paging and replay](../../../__app_modules/media/feed/browser/Search/FeedSearch.jsx) |
| Poll a resource or group of resources | Use a reader's `poll()` for a delayed check that can share a pending read, or use `pollApiResources(matches)` for matching idle readers. Keep the feature's retry policy with its resources. Use `whileDocumentVisible` to dispose view-only timers on hide. Use forced revalidation after a confirmed write when a pending read could predate it. | [Health Today](../../../__app_modules/wellness/health/browser/today/useHealthDay.js) · [Media Home partial recovery](../../../__app_modules/media/media/browser/browse/HomeView.jsx) |
| Warm nearby views while the current view is visible | Pass a visit-bound `signal` to `prefetchApiResources` and abort it on hide or departure. The queue drops pending paths and callbacks for that batch. Reads already admitted can still warm the shared cache. | [Health day prefetch](../../../__app_modules/wellness/health/browser/today/useHealthDayPrefetch.js) |
| Refresh a feature-owned read | `useRefreshableRead(read)` supplies `reload`, `poll` and `cancel` for an existing transport. Memoize `read(isCurrent, signal)` by its scope, pass the signal to each request, and check `isCurrent()` before starting dependent reads or publishing. Reload arguments are forwarded to the read callback for consumer-owned targeted refresh. Reload, cancel, a scope change or unmount aborts the previous read. Poll starts only when idle and a started read resolves with the callback result. The JSON client preserves `AbortError` when cancellation reaches a pending response body. | [Home doorbell clip batch](../../../__app_modules/household/home/browser/doorbell/useRingClips.js) retries only failed ring days and retains successful clips · [Admin Agendas index](../../../__app_modules/household/agenda/browser/admin/AgendasIndex.jsx) · [Feed notes](../../../__app_modules/media/feed/browser/Annotations/AnnotationPanel.jsx) · [Catalog picker paging](../../../__capabilities/content-catalog/browser/combobox/useContentCombobox.js) |
| Retire search results when the query changes | Cancel the previous batch as soon as query intent changes, even when the next request is debounced. Let the current request publish results and loading state. Close cancels the batch and its pending debounce. | [Admin and Media Content picker](../../../__capabilities/content-catalog/browser/combobox/useContentCombobox.js) |
| Reuse a feature snapshot across views | Read at the provider shared by those views. Derive labels, lookups or warnings from the provider's snapshot, and refresh through the same owner after a confirmed change. | [Media Fleet provider](../../../__app_modules/media/media/browser/fleet/FleetProvider.jsx) |
| Load optional badges alongside required workspace data | Let required data control view readiness. Keep badges with one scoped reader and request reconciliation after the server acknowledges a command. | [Feed workspace](../../../__app_modules/media/feed/browser/FeedWorkspaceContext.jsx) |
| Keep a submitted command across local views | Mount the command owner above the views. Pass an active flag to polling and a null resource path to suspend reads when the view leaves. Start reconciliation with the server when the acknowledgement arrives. | [Home device controls](../../../__app_modules/household/home/browser/entities/useHomeEntities.js) |
| Turn a sidebar into a compact drawer | Observe the shared breakpoint. Derive modal semantics, inert regions and focus from the active presentation. Return focus to a visible control as the presentation changes. | [Feed subscriptions](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) |
| Respond to the compact viewport | Use `useCompactViewport()` for the token-derived `md` boundary (767px compact, 768px wide). For a synchronous event-time check, use `COMPACT_VIEWPORT_QUERY` so the action does not wait for React's next render. Keep each app's responsive behavior and focus destination with that app. | [Admin navigation](../../../frontend/src/modules/Admin/AdminLayout.jsx) · [Feed Reader](../../../__app_modules/media/feed/browser/Reader/Reader.jsx) · [Media Now Playing](../../../__app_modules/media/media/browser/shell/NowPlayingView.jsx) |
| Theme a Highcharts view | Call `useChartThemeTokens(hostRef)` on the themed chart host. It reads `textHigh`, `textMid`, `textLow`, `border`, `surface`, `accent`, `warning`, and `info` after mount; keep chart options null until the values are ready. | [Home entity history](../../../__app_modules/household/home/browser/history/HistoryChart.jsx) · [Health weight trend](../../../__app_modules/wellness/health/browser/progress/WeightTrendChart.jsx) · [Shared token reader](../../../frontend/src/lib/theme/useChartThemeTokens.js) |
| Keep an overlay inside the visible viewport | Attach `observeVisualViewport` within the open visit and return its disposer. Use `Sheet` or `FormDialog` for editable overlays that need to fit above the soft keyboard. An anchored popup can also use `useAppMainRef` to stay within the visible frame and constrain its scrollable results. | [Sheet](../../../frontend/src/lib/ui/Sheet.jsx) · [Health food suggestions](../../../__app_modules/wellness/health/browser/today/AddCombobox.jsx) |
| Keep search results reachable above the keyboard | Use `FormDialog` for the search field and `ContentCombobox` for anchored results. The picker sizes its existing scrollport to the available space and keeps results selection and Escape in the picker. | [Media Music Picker](../../../__app_modules/media/media/browser/shell/PlayerFeatureControls.jsx) · [ContentCombobox](../../../__capabilities/content-catalog/browser/combobox/ContentCombobox.jsx) |
| Keep the viewport steady when loading earlier results | Measure a stable existing row immediately before the prepend commits and compensate for that row's displacement after the commit. Keep the loading indicator out of the row layout. Keep keyboard reveal tied to the highlighted item so a change in its index alone leaves the viewport at its anchor. | [Catalog picker paging](../../../__capabilities/content-catalog/browser/combobox/ContentCombobox.jsx) |
| Contain Tab within a responsive dialog | Use the shared focus trap and render controls only where their presentation is available. If resize removes the focused control, move focus to a visible control in the dialog. If an opener is recreated after dismissal, return focus to the current equivalent control. | [Feed player sheet](../../../__app_modules/media/feed/browser/players/FeedPlayerSheet.jsx) |
| Return focus after an overlay | The shared focus-return hook captures the opener and transfers it when another overlay replaces the first in the same commit. When a menu item disappears or the trigger is recreated, pass the trigger ref to `Sheet` as `returnFocusRef` or to `useOverlayFocusReturn(open, ref)` for a custom overlay. The hook reads the ref after the closing commit. | [Health Follow-ups](../../../__app_modules/wellness/health/browser/today/FollowUpTray.jsx) · [Feed player sheet](../../../__app_modules/media/feed/browser/players/FeedPlayerSheet.jsx) · [Home camera](../../../__app_modules/household/camera/browser/CameraViewport.jsx) |
| Keep a floating picker anchored during scroll and resize | Register the open picker with `useDismissLayer`, observe the visible viewport with `observeVisualViewport`, and capture scroll events while its trigger can move inside a nested scroller. Remove both listeners when the picker closes. Keep placement and feature commands with the picker. A nonmodal picker can return focus on Escape and let a pointer press outside follow native focus. | [Media Details Cast](../../../__app_modules/media/media/browser/cast/CastButton.jsx) |
| Lock background scroll during an overlay | `Sheet` uses `useOverlayScrollLock(active)`. Use the same hook for an independently composed fullscreen overlay. It locks the document and the nearest frame, then restores their previous overflow settings after the last overlay releases them. | [Home camera](../../../__app_modules/household/camera/browser/CameraViewport.jsx) · [Shared Sheet](../../../frontend/src/lib/ui/Sheet.jsx) |
| Move from a list into an editor inside a sheet | Let the sheet handle focus on open and dismissal. When the list or editor replaces the focused control, focus the primary field of the new view. Keep the search query with the list. | [Health saved foods](../../../__app_modules/wellness/health/browser/today/FoodCatalogManager.jsx) |
| Move focus through an inline edit | Focus the first field when the editor replaces its trigger. Cancel returns focus when the trigger is available and no other control has focus. On save, return focus only while it still belongs to the editor. Keep a pending Save focusable with `aria-disabled` and guard against repeated activation. Use `ds-touch-target` on compact edit actions. | [Life Purpose](../../../__app_modules/personal/life/browser/views/plan/PurposeView.jsx) |
| Keep keyboard focus during read recovery | Use `useRetryRegion(reload, loading \|\| revalidating)`. Spread `regionProps` onto the labelled section that stays mounted through loading, error and results. Use the returned `retry` for the read's Retry action. The region receives focus before the button disappears and reports busy state while the read runs. Suppress cached-empty copy during revalidation until the new result settles. | [Admin list editor](../../../__capabilities/content-catalog/browser/admin/ListsFolder.jsx) · [Admin Config Files](../../../frontend/src/modules/Admin/Config/ConfigIndex.jsx) · [Admin config editor](../../../frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx) · [Admin Content Filter](../../../frontend/src/modules/Admin/ContentFilter/FilterLibrary.jsx) · [Home History](../../../__app_modules/household/home/browser/ui/EntityDetailSheet.jsx) · [Life Triage](../../../__app_modules/personal/life/browser/views/now/triage/TriageSessionView.jsx) · [Media Routines](../../../__app_modules/media/media/browser/house/RoutineHistoryView.jsx) · [Media Played earlier](../../../__app_modules/media/media/browser/household/PlayedEarlier.jsx) · [Feed Headlines](../../../__app_modules/media/feed/browser/Headlines/Headlines.jsx) |
| Retain data during a failed refresh | Keep the last accepted `useApiResource` result visible and show its read error beside the controls. Keep query controls mounted, avoid empty-state copy for a failed read, and disable commands that depend on freshness until recovery completes. | [Admin Content Filter](../../../frontend/src/modules/Admin/ContentFilter/FilterLibrary.jsx) · [Media Played earlier](../../../__app_modules/media/media/browser/household/PlayedEarlier.jsx) |
| Recover a loaded config with no structured form value | Distinguish accepted `null`, scalar, or sequence YAML roots from a failed read. Explain that the value has no structured form and link through `GuardedLink` to the raw editor so the file can be inspected or repaired. | [Admin ConfigFormWrapper](../../../frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx) |
| Preserve an Admin config draft through browser history | Keep the raw or parsed draft in the shared in-memory Admin draft map, keyed by auth session, file, and editor mode. Restore only after a successful read matches both the parsed and exact raw baseline; confirmed Discard, Revert, and Save clear the acknowledged revision. Native Back/Forward stays unblocked. | [Admin config hook](../../../frontend/src/hooks/admin/useAdminConfig.js) · [Shared draft state](../../../frontend/src/modules/Admin/shared/useAdminDraftState.js) |
| Recover an empty or failed control inventory | Read `hasResult`, `loading`, and `error` from `useApiResource`. Use `clearDataOnError` when stale actions must stop being available, disable actions while confirming a command with a readback, and keep the labelled `useRetryRegion` mounted if Retry may return an empty list. | [Home camera controls](../../../__app_modules/household/camera/browser/CameraControls.jsx) |
| Keep keyboard focus when a command disables its control | Spread `useFocusRegion(busy)`'s `regionProps` onto the labelled section that presents the outcome. Call its `focus()` before starting the command. The feature supplies busy state through acknowledgement and any required readback. Settlement respects focus moves made during the wait. | [Admin film approval](../../../frontend/src/modules/Admin/ContentFilter/FilmApprovalControls.jsx) |
| Keep search and period controls available during Retry | Put loading, error and results inside one `useRetryRegion` section. Keep the controls that change the query outside that busy section. Restore the view's scroll when its result is ready to render. | [Life Log results](../../../__app_modules/personal/life/browser/views/log/shared/LogReadRegion.jsx) · [Health Saved foods](../../../__app_modules/wellness/health/browser/today/FoodCatalogManager.jsx) |
| Keep a chart available during refresh | Show a loading placeholder while the first result is pending. When the resource already has data, keep it visible and report the active read on its own region. An open editor can keep its draft while the read refreshes independently. | [Health Progress](../../../__app_modules/wellness/health/browser/progress/ProgressView.jsx) |
| Recover independent sections on one page | Give each section its own resource and Retry region. Keep navigation and other sections available while one read is pending. Reuse the handoff for a Refresh control that becomes unavailable during its GET. Render the section’s empty state when its own read succeeds with no results. | [Media Home Suggestions and Recent](../../../__app_modules/media/media/browser/browse/HomeView.jsx) · [Admin Notifications](../../../frontend/src/modules/Admin/Notifications/NotificationsIndex.jsx) |
| Recover a first read that unlocks a view | Keep the named prerequisite region mounted through recovery. Once the view has accepted data, preserve it during background rereads and let independent child reads report their own pending state. | [Home Assistant and Cameras](../../../__app_modules/household/home/browser/HomeApp.jsx) · [Home Timeline](../../../__app_modules/household/home/browser/today/TodayView.jsx) |
| Keep Back available during detail recovery | Keep Back mounted as the first control in the detail region. Use a router link for a fixed destination. From the focused region, Tab reaches Back while the current read is pending. Leaving the detail releases that visit’s pending request. | [Media Item Detail](../../../__app_modules/media/media/browser/browse/DetailView.jsx) · [Admin Integration Detail](../../../frontend/src/modules/Admin/System/IntegrationDetail.jsx) |
| Recover independently loading records and sheet options | Give each read its own Retry region. Keep the sheet alongside the records region. Place the options region inside the sheet so the keyboard stays in the dialog while the read recovers. | [Auto Service History and Service Types](../../../__app_modules/household/auto/browser/ServicePanel.jsx) |
| Recover optional content | Keep a useful focus target through the explicit read. Reuse a persistent control when it represents the result. A short status can confirm an empty or recovered read while the region has focus. An initial visit can omit unused content. | [Life Now Triage summary](../../../__app_modules/personal/life/browser/views/now/TriageSummaryCard.jsx) · [Health Today food review and follow-ups](../../../__app_modules/wellness/health/browser/today/TodayView.jsx) |
| Keep a save with the sheet that submitted it | Mount the form once per sheet visit. `useSheetSubmission(onClose, onError)` guards duplicate submissions and exposes the current visit's pending and failure state. Use `submit` for forms and `run` for a button that starts a save directly. Reconcile shared resources in the submitted action so it can finish after dismissal. A replacement form keeps its own draft. | [Health saved meals](../../../__app_modules/wellness/health/browser/today/TemplatePicker.jsx) · [Health medical reading](../../../__app_modules/wellness/health/browser/medical/MedicalView.jsx) · [Life creation sheets](../../../__app_modules/personal/life/browser/views/plan/PlanCreateSheet.jsx) |
| Close a one-shot action through its current owner | Give each mounted visit one automatic attempt and offer explicit Retry on failure. Use the existing submission and focus guards. A power action stays a command even when the endpoint uses GET. | [Home power actions](../../../__app_modules/household/home/browser/actions/PowerOffAction.jsx) |
| Keep focus on a pending Save | Use `SubmitButton` with the submission's `pending` state. It stays focusable and suppresses activation while pending. An invalid form passes `disabled`. Use `as={Button}` with Mantine's `Button` in a Mantine form. Keep the shared submission guard on the form or command for programmatic submissions. | [Admin settings](../../../__capabilities/content-catalog/browser/admin/SettingsDialogForm.jsx) · [Health medical reading](../../../__app_modules/wellness/health/browser/medical/MedicalView.jsx) · [Auto forms](../../../__app_modules/household/auto/browser/AutoSheetActions.jsx) |
| Keep independent commands available | Import `useKeyedSubmission` from `@/lib/ui`. The hook returns `{ pending, run }`; `pending.has(key)` identifies a busy command, and `run(key, command)` admits one command per key until its promise settles. Pass that state to `SubmitButton`. The caller decides when confirmation is complete and which visit receives feedback. | [Scheduler jobs](../../../frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx) · [Feed detail actions](../../../__app_modules/media/feed/browser/Scroll/detail/useDetailActions.js) |
| Confirm a destructive command or decision with extra choices | Use `ConfirmModal({ opened, onClose, onConfirm, title, message, impact, children, confirmLabel, cancelLabel, confirmDisabled, loading, closeOnEscape })`. The caller owns the command, outcome, and invalidation. The modal joins the shared dismiss stack when present and otherwise uses Mantine's Escape handling. `loading` blocks dismissal and repeat activation; `confirmDisabled` blocks only confirmation. If success removes the opener, provide a stable focus target in the destination. | [Scheduler job](../../../frontend/src/modules/Admin/Scheduler/JobDetail.jsx) · [Admin Members](../../../frontend/src/modules/Admin/Household/MembersIndex.jsx) · [Media screen administration](../../../__app_modules/media/media/browser/house/ScreenAdminView.jsx) · [Media Start Fresh](../../../__app_modules/media/media/browser/shell/StartFreshDialog.jsx) |
| Reveal a replacement view inside a sheet | Keep a focus region mounted across the view change. For direct navigation, focus the region and reset the panel through `Sheet`'s `scrollRef`. When an async command completes, move focus and reset only if the outgoing view still owns focus. | [Health saved meals](../../../__app_modules/wellness/health/browser/today/TemplatePicker.jsx) |
| Return focus while a roster refreshes | Keep the dialog opener mounted beside the async roster. On command acknowledgement, close the form and release its pending state. Invalidate the affected resource by key so a reopened form keeps its draft. Hand explicit Retry focus to the roster region. Show a loading placeholder if the pending read leaves the region with no rows. | [Admin roster helper](../../../frontend/src/modules/Admin/shared/useAdminRoster.js) · [Admin Devices](../../../frontend/src/modules/Admin/Household/DevicesIndex.jsx) · [Admin Members](../../../frontend/src/modules/Admin/Household/MembersIndex.jsx) |
| Give a settings editor consistent save and revert shortcuts | Admin `SaveBar` binds keyboard save and revert to the same availability as its buttons. It accepts the physical letter keys across keyboard layouts, and the shared shortcut listener yields to editable controls and modal focus. The editor owns the draft and write. | [Admin SaveBar](../../../frontend/src/modules/Admin/shared/SaveBar.jsx) |
| Show temporary confirmation after an action | `useTemporaryIndicator(durationMs)` returns `[visible, show]`. The feature calls `show()` when its current action succeeds. Calling it again extends the confirmation. Unmounting clears the timer. | Art save feedback and Feed copy confirmation |
| Display elapsed time or a countdown | `useDisplayClock(active, intervalMs)` samples wall time while the label is visible and catches up when the view returns. The feature supplies the start time or deadline and owns any pending operation. | [Health capture progress](../../../__app_modules/wellness/health/browser/today/CaptureProgress.jsx) · Media sleep countdown |
| Observe browser work that has multiple resources to release | In an effect, return `whileDocumentVisible(start)`. Its start callback acquires resources for one visible interval and returns the cleanup. Keep a media decoder and its playback lifetime independent of progress painting. | Feed Scroll performance sampling and [inline player progress](../../../__app_modules/media/feed/browser/players/FeedPlayer.jsx) |
| Label a native field in a mobile sheet | Associate a native label with the input. Use the shared `.ds-input` geometry and a compact `Button` for submission. Add `ds-touch-target` to a compact checkbox label when the label is the tap surface. | [Auto fuel](../../../__app_modules/household/auto/browser/FuelSheet.jsx) · [Health dish membership](../../../__app_modules/wellness/health/browser/today/MealFoodControls.jsx) |
| Show an action icon | Use `UiIcon` for Back, search and close. Set the accessible name on the surrounding control. Decorative symbols stay out of its spoken name. Add `ds-touch-target` to compact controls that need the 44px minimum on coarse pointers. | [Feed article Back](../../../__app_modules/media/feed/browser/Scroll/detail/DetailView.jsx) · [Auto garage Back](../../../__app_modules/household/auto/browser/AutoApp.jsx) · [Shared sheet](../../../frontend/src/lib/ui/Sheet.jsx) · [Media search launcher](../../../__app_modules/media/media/browser/shell/Dock.jsx) |
| Start a form from configured choices | Keep the sheet open while its choice resource loads. Retry a failed choice read there. Mount the draft with the accepted choices and derive the initial and subsequent field defaults from the selected record. | [Auto service](../../../__app_modules/household/auto/browser/ServicePanel.jsx) |
| Show a field error | Give a Mantine input a label, description and field-specific error. The gallery demonstrates an error that clears after a correction. | [Controls gallery](../../../frontend/src/dev/DsGallery/DsGallery.jsx) |
| Offer one or several choices | Use Mantine `Radio.Group` for mutually exclusive choices, a labelled `Checkbox` for a boolean, and `Chip.Group multiple` for a set. For independent filters outside a choice group, use buttons with `aria-pressed`; add `ds-touch-target` when compact controls need the 44px minimum on coarse pointers. The feature owns the values. A `Menu` exposes actions such as resetting the set. | [Collection filters in the gallery](../../../frontend/src/dev/DsGallery/DsGallery.jsx) · [Feed Assembly filters](../../../__app_modules/media/feed/browser/Scroll/FeedAssemblyOverlay.jsx) |
| Show elapsed playback time in Feed | Use `formatFeedPlaybackTime(seconds)` for player controls, the mini bar, player sheet and inline detail player. It keeps elapsed minutes unpadded (including `60:00` at one hour) and renders missing or invalid positions as `0:00`; metadata duration labels keep their own formats. | [Feed playback formatter](../../../__app_modules/media/feed/browser/players/formatTime.js) |
| Open a menu of actions | Give `ActionMenu` a focusable trigger and Mantine menu items. Opening focuses the first available action. Escape restores the trigger. Tab and Shift+Tab continue in the trigger's normal focus order. A disabled menu or an inactive `AppView` closes its menu visit. Mantine positions the menu and handles arrow navigation and outside clicks. The feature owns item actions and any subsequent dialog. Give that dialog a stable row trigger when its opening menu item is removed. | [Admin list item actions](../../../__capabilities/content-catalog/browser/admin/ListsItemRow.jsx) · [Media Settings](../../../__app_modules/media/media/browser/shell/SettingsMenu.jsx) · [Health food actions](../../../__app_modules/wellness/health/browser/today/EntryRow.jsx) |
| Show a long list without the scroll | Rank the list, then hand it to `TopMoreList` (rows) or `TopMoreMenu` (Mantine menu items) with `n`, the `keepIds` that must always show (the active, current or selected item) and, where some items never deserve a top place (an asleep screen, a browser tab), `canTop`. One "More (k)" control expands the rest in place; in a menu it opens them in the same dropdown below a divider (Mantine 7 has no nested submenu). Enter or Space on More expands it and focus moves to the first newly shown item. A More that would hide one item shows it instead, and a row once shown stays shown while the surface is open. The expansion lasts until the surface unmounts. Log the expansion through `onExpand`. The pure rule is `splitTopMore(items, { n, rank, keepIds, canTop })`; a combobox whose rows are an index-owned keyboard model uses it directly with its own "Show all N" row (`ContentCombobox` `collapseAt`). | [Media Play on…](../../../__app_modules/media/media/browser/cast/DispatchTargetPicker.jsx) · [Media Move to…](../../../__app_modules/media/media/browser/shell/MoveToMenu.jsx) · [Media queue](../../../__app_modules/media/media/browser/shell/QueuePanel.jsx) · [Content search](../../../__capabilities/content-catalog/browser/combobox/ContentCombobox.jsx) |
| Offer an alternate action on hold | Spread `usePressHoldOffer().bind` onto the button or menu item and wrap its ordinary click with `guardClick`. A primary pointer or Space can reveal the alternate action. Render that action as a regular focusable control. If the menu closes on item click, keep it open while the offer is visible so a held release can leave the alternative at hand. Keep an ordinary control for the alternative when it needs to be discoverable without the gesture. | [Media Home item menu](../../../__app_modules/media/media/browser/household/ItemMenu.jsx) · [Media Detail buttons](../../../__app_modules/media/media/browser/browse/DetailView.jsx) |
| Offer a compact segmented choice | Use Mantine `SegmentedControl` with a name for the radio group. Reference the visible label when there is one. Browser frames apply the shared touch target to each label on coarse pointers. | [Health Auditor gap](../../../__app_modules/wellness/health/browser/auditor/AuditorConfig.jsx) · [Health Progress direction](../../../__app_modules/wellness/health/browser/progress/ProgressView.jsx) |
| Open details beside a separate command | Give the detail button and its adjacent switch independent names and hit areas. Apply `ds-touch-target` to the button itself so its edges respond on coarse pointers. Use the shared Sheet to contain keyboard focus and return it on dismissal. | [Home entity row](../../../__app_modules/household/home/browser/ui/EntityRow.jsx) · [Home history sheet](../../../__app_modules/household/home/browser/ui/EntityDetailSheet.jsx) |
| Queue an offline action | Use `createBrowserMutationQueue({ prefix, getOwner, idOf, valid })` for owner-scoped actions retained in local storage. Enqueue synchronously before acknowledging the change. The feature supplies the operation and decides when replay is safe. An acknowledged send retains its response in memory until the same owner completes local cleanup. The dequeue callback receives the remaining queue, the operation, and its response. Where Web Locks are available, each flush requests an exclusive, nonblocking lock per queue key. A competing tab yields to the holder. The holder checks the active owner and reads the queue after acquisition. A lock failure leaves the queue pending. Browsers without Web Locks coalesce replay within the tab. Synchronous appends to the legacy array can race across tabs. Storage changes also take time to reach another tab after release. The acknowledgment is local to the sending tab, and a lost response can require server-side idempotency. | [Feed item state](../../../__app_modules/media/feed/browser/FeedWorkspaceContext.jsx) · [Feed annotations](../../../__app_modules/media/feed/browser/offline/annotationOfflineStore.js) |
| Remember a simple preference | `browserPreference(key, fallback, decode)` preserves the raw string format. The feature supplies migration and validation. Call `clear()` when removing a stored override returns selection to its default owner. | Home view, Life member, Admin preview screen and Feed playback settings |
| Observe a preference shared across tabs | Subscribe with `subscribeToStorageKey(key, reconcile)` and return its disposer with the view. Reconcile by reading the current key through the feature's decoder. A storage clear also triggers reconciliation. | [Health display placement](../../../__app_modules/wellness/health/browser/display/HealthDisplayPreferences.jsx) · [Feed credentials](../../../frontend/src/lib/auth.js) |
| Save an account preference while keeping the controls responsive | Publish the local edit immediately. Order server reads, migration and saves for the account. Apply acknowledgements to the submitted fields that still represent the latest edit. | Feed reading appearance |
| Save one setting when the server returns the full preference map | Use the last confirmed map and the current account's pending edits to derive what the user sees. A refused save retires its own pending edit. | [Feed source preferences](../../../__app_modules/media/feed/browser/FeedWorkspaceContext.jsx) |

## Reviewing a shared pattern

Apply these questions during discovery, design, diff review, integration testing and final review. Record the caller and evidence for each answer. Keep an unverified finding open until someone checks the relevant behavior.

| Principle | Review question |
| --- | --- |
| DRY | Which callers repeat a decision that must change together? |
| Appropriate abstraction | Which current callers use the contract, and which differences do they need to retain? |
| Encapsulation | Can a caller use the public interface without knowing an internal DOM selector, storage representation or timer? |
| Single source of truth | Who owns the current route, draft, preference or server value, including when an older response arrives late? |
| Separation of concerns | Can layout change without interrupting playback, writing a draft or duplicating a subscription? |
| YAGNI | Which current workflow or acceptance case requires each new option, layer or dependency? |

Feed uses the shared native `Select` for reading preferences, edition, search mode and highlight color. Auto uses it for place and service types. The surrounding label names the control. The feature owns its options and selected value. Compact density uses the shared touch target on coarse pointers.

A day navigator receives calendar keys in `YYYY-MM-DD` form. The shared `addCalendarDays` helper shifts these keys independently of the device time zone. Health and Weekly Review keep their own rules for selecting today and limiting the range.

Use `localDateKey()` to initialize a date field with the browser's current calendar day. Preserve a stored `YYYY-MM-DD` value when displaying it. Convert a timestamp to a local calendar day before using it to prefill a date field. Auto uses these rules for fuel and service records and for fill-ups logged from a drive.


## Token contract

`frontend/src/lib/theme/tokens.mjs` defines the base roles, motion values and control geometry. App packs in
`packs.mjs` override semantic roles for their surfaces.

Seven semantic color roles: `background`, `surface`, `surfaceAlt`, `border`,
`textHigh`, `textMid`, `textLow`. Five status colors: `success`, `warning`,
`danger`, `info`, `live`. Motion tokens: `fast` (120ms), `base` (200ms),
`reveal` (300ms), and a shared `easing` curve. The `md` and `lg` breakpoints drive JavaScript and Sass. After editing them in `tokens.mjs`, run `node frontend/scripts/generate-browser-breakpoints.mjs` to update the checked-in Sass variables.

For native scrolling, pass `getPreferredScrollBehavior(element)` as
`behavior` when moving a rail or revealing a selected item. The feature
supplies the scroll distance or alignment. For custom frame animations,
read the live browser preference through `getReducedMotionQuery(view)` so
an ongoing animation can finish immediately if the preference changes.
Gate decorative CSS motion with `prefers-reduced-motion`.
[Catalog keyboard highlight](../../../__capabilities/content-catalog/browser/combobox/ContentCombobox.jsx) · [Media Home rail](../../../__app_modules/media/media/browser/browse/HomeView.jsx) · [Feed list shortcuts](../../../__app_modules/media/feed/browser/useFeedListShortcuts.js)

Cards, sheets and frame regions use `--ds-space-sm`, `--ds-space-md` and `--ds-space-lg` for 0.5, 0.75 and 1rem spacing. Caption, detail and heading text use the corresponding `--ds-type-*` roles. These preserve the existing visual sizes across app packs.

The contract reaches consumers through Mantine, scoped CSS or the document root.

- **Inside Mantine** (components, JSX using Mantine props): `createAppTheme.js`
  projects the token colors into Mantine's ramp shape, so a role reads as
  `var(--mantine-color-surface-0)`, `var(--mantine-color-textHigh-0)`, etc.
- **In plain SCSS** (anything outside Mantine's styling system): `dsCssVars()`
  emits the same roles as `--ds-*` custom properties (`--ds-surface`,
  `--ds-text-high`, `--ds-danger`, `--ds-motion-base`, …) onto a `.ds-root`
  wrapper. `AppThemeProvider` renders that wrapper, so any SCSS under the
  provider can read `var(--ds-surface)` directly.
- **On every page, provider or not:** `installRootTokens()` (called first
  thing in `main.jsx`) puts the base contract, with no pack applied, on
  `:root` as the first stylesheet in `<head>`. A kiosk screen, the login form,
  or anything else rendered outside a provider still reads real contract
  values. A provider's `.ds-root` restates them with its pack applied and wins
  by nesting.

The base contract carries an `accent` (the blue a surface gets when no pack
names one); a pack's `accent` replaces it.

**Every route is its own chunk** (`main.jsx` lazy-loads each app), so a page
gets only the CSS of the app it shows. Anything more than one app uses must
therefore live in a shared place, never in whichever app happened to define
it first:

- **Tokens** belong in `lib/theme/tokens.mjs`.
- **App typography** belongs in the app's theme pack (`fontFamily` and, when
  needed, `fontFamilyMonospace` and `headings`). `createAppTheme()` applies
  these settings to Mantine and `dsCssVars()` exposes the family tokens to
  app SCSS. Home, Admin and Auto use this contract. Keep reading-mode and
  player typography local to Feed and Media, where those choices are part of
  the content or playback experience.
- **Web fonts used by more than one app** belong in the single font `<link>`
  in `frontend/index.html`. Roboto Condensed, Inter, IBM Plex Sans and
  JetBrains Mono are there. A font only one module uses (ArtMode's
  Garamonds, the clock's Droid Sans Mono, School's Kongtext) stays with that
  module.
- Admin's palette and typography live in its pack. `frontend/src/modules/Admin/Admin.variables.scss` defines scoped aliases for editors: the Admin-only names are `--admin-*`, and the legacy `--ds-*` aliases stay in `.admin-theme` for the piano admin, fitness config, content-catalog, party-games and chess consumers that still read them. The provider encloses an Admin portal target so controls and dialogs inherit the same colors.
- Admin’s navigation uses the shared `md` breakpoint. At 768px the focused link stays in the visible rail. At 767px the rail collapses and its toggle takes focus if that link was focused. [Keyboard and resize tests](../../../tests/live/flow/admin/admin-navigation.runtime.test.mjs)

Before route splitting, one 11 MB bundle loaded every app's CSS on every
page. That hid these dependencies. Lib/ui, Life, Auto and Call had been
reading Admin's tokens, and Piano, School, Fitness and Auto had been rendering
in fonts that only Finance, Feed and Media loaded.

A `--ds-*` name that isn't part of the contract is a bug, not a typo that
silently degrades — an unknown custom property falls back to `inherit`, so it
looks fine until the surrounding context changes. `npm run audit:ui` checks
every `var(--ds-*)` reference against the manifest of legal names.

Feed keeps its own `--feed-*` aliases (surfaces, text, accent, tints) on `.feed-app`, but every one derives from a `--ds-*` role, using `color-mix()` for tints and status backgrounds. A Feed stylesheet reads `var(--feed-*)` with no literal fallback. The literals left in Feed are data or media hues: source and tier palettes, annotation highlights, the reading themes, and the black and white used as shadow, scrim and glyph ink over photos and video.

Media's `--media-*` aliases on `.media-app` derive from the `--ds` roles (the Media pack sets them to the values of the dark ramp steps). The alias rule on `<html>` stays on the Mantine ramp, because portaled popovers sit outside `.ds-root` and would read the base contract there. Media also styles surfaces that kiosk screens render outside the Media app (the menu, the launch cards, the classical surround, the content filter), so its shadow, scrim and glyph inks resolve at Sass time through `scrim()`, `chalk()` and `tint()` in `theme/_ink.scss`; they compile to the same plain `rgba()` values. Durations that match no token go through `sweep()` in `theme/_motion.scss`, which emits `calc(var(--ds-motion-sweep) * k)`; 120ms uses `--ds-motion-fast`. The literals left in Media are the pack source in `mediaTheme.js`, the Plex-style menu and classical surround palettes, the content-filter review hues and its inks over film frames, and per-title generated hues, each carrying a `data-color` note.

Colors that come from data (a status derived from a value, a chart series, a
sentiment ramp) are the one place a literal color is legitimate. Mark the line
with a `data-color` comment so the audit's `raw-color` rule exempts it:

```scss
color: #f85149; /* data-color: over-budget */
```

Without the annotation, the same line is a violation.

## Packs

A pack (`frontend/src/lib/theme/packs.mjs`) is the only thing that varies
between apps. It owns:

- `primaryColor` — the Mantine color name driving default component variants.
- `accent` — the one hex value the app is allowed to lean on for its own
  identity (exposed as `--ds-accent`).
- `character` — a one-sentence direction statement, so visual drift between
  apps is a declared choice, not an accident.
- Optionally, color-role overrides (merged over the base token colors).

A pack may **not** remove or weaken anything the base contract guarantees:
focus rings, contrast ratios, disabled/hover/error state behavior, touch
target sizing. Those come from `createAppTheme.js` and the shared SCSS and
apply to every pack that doesn't set `themeExtras` (see below) unchanged.

**To add a pack:** add one entry to `PACKS` in `packs.mjs` — `name`,
`character`, `primaryColor`, `accent`, and optional color overrides. Nothing
else needs to change; `AppThemeProvider` picks up any registered pack by name.
The `school` pack (green accent, `#51cf66`) is the study-desk direction for
kiosk screens like the card-ladder stage — one calm accent for progress and
primary actions, no chrome to hunt through.

The `finance` pack (`/budget`, `/finances`) is a light scheme: `surface` is the
grey panel, `background` the charcoal header bar, and `status` carries the
spent (`info`), gained (`success`) and overspend (`danger`) hues. It sets
`themeExtras: { components: {} }` so Mantine keeps its own component sizes.
The Finance Drawer mounts in a portal outside the themed root, so it carries
`dsCssVars(PACKS.finance)` as its own `style`.

### `themeExtras` — the escape hatch

`themeExtras` is an optional top-level key on a pack, applied by
`createAppTheme.js` as a **wholesale, non-deep-merged override**: any of
`colors` / `other` / `components` / etc. it sets fully replaces the base
contract's version of that section, rather than blending into it. It exists
for a product that predates the shared contract, or whose art direction goes
beyond the 7 semantic roles and `accent` — its own component defaults, extra
color ramps, fonts and breakpoints. Admin uses it for its editor defaults and
scoped portals. In `__app_modules/media/media/browser/theme/mediaTheme.js`,
`MEDIA_PACK.themeExtras` layers Media's full
amber/dark Mantine theme (component defaultProps included) on top of the base,
so Media's own `Button`/`Modal`/`Drawer` defaults are the sole authority,
never silently blended with the base contract's generic ones. The Media pack
also exports `MEDIA_TOKENS` (ink / surface / line / text / muted / accent) and
self-hosts its one type family (Atkinson Hyperlegible Next, OFL); how they are
used is in [`../media/media-app.md`](../media/media-app.md#visual-system).

Setting `themeExtras` moves ownership, not just styling: a pack that replaces
`components` (or `other`) is no longer covered by the base guarantee above for
whatever it replaced — that pack is now responsible for its own focus rings,
contrast, disabled/hover/error states, and touch target sizing wherever
`themeExtras` takes over. Reach for it only when a pack's identity genuinely
can't fit inside the base contract's 7 roles + `accent`; most packs never need
it.

## Primitives

For a content picker or search combo, use `ContentCombobox` from the catalog capability. Its `value` and `onChange` bind the selected content ID to the editor. Media’s full-screen search uses the catalog controller and result rows with `ActionMenu` for the standalone More menu. Closing a destination picker returns focus to the row’s More button, or to the search field if the row has gone. [Public picker export](../../../__capabilities/content-catalog/browser/picker.mjs) · [Admin form example](../../../__capabilities/content-catalog/browser/admin/ListsItemEditor.jsx) · [Media full-screen search](../../../__app_modules/media/media/browser/search/SearchMode.jsx)

Use `frontend/src/lib/ui/index.js` for shared layout, cards and feedback. Import `FormDialog` from `@/lib/ui`. Use the app’s themed Mantine controls for labelled fields, radio groups, chips and menus. [FormDialog](../../../frontend/src/lib/ui/FormDialog.jsx)

| Primitive | For | Don't use it when |
|---|---|---|
| `AppThemeProvider` | Wraps an app in its Mantine theme + `--ds-*` vars. `pack` accepts a registered pack name or a complete pack object; use the object when the app extends its theme with component defaults. Pass `scopeId` when the CSS variables and Mantine root need an explicit scope. | You need a second, nested theme scope — packs are per-app, not per-section. Examples: [Admin](../../../frontend/src/Apps/AdminApp.jsx) · [Media](../../../__app_modules/media/media/browser/MediaApp.jsx). |
| `AppChrome` | Header, responsive primary navigation, main scroll region and optional footer. The shell uses bottom tabs on mobile and a left rail at larger widths. Use `useAppMainRef` inside its content when an interaction needs the scroll element. `headerActions` accepts up to three actions. | A modal or another local layout inside an app. |
| `AppView` | Retains a routed view and exposes its active state to descendant sheets. A sheet locks the owning frame and the document while visible. | Route content that can safely unmount on navigation. |
| `Sheet` | A task surface for forms, detail views and capture. It opens from the bottom on mobile and centers on desktop by default. Use `placement="side"` for a desktop right panel or `placement="fullscreen"` for an edge-to-edge camera stage. Fullscreen controls respect the safe area, and the sheet fits the visual viewport when the keyboard opens. Escape dismisses the active sheet. | Use Mantine `Modal` for confirmations and warnings that require a decision. |
| `FormDialog` | A centered or top-aligned Mantine form dialog that can scroll above the soft keyboard. With `DismissStackProvider`, each open form owns one Escape layer, so nested dialogs close from the top inward. `closeOnEscape={false}` marks a busy form as managed and prevents Escape from closing a lower layer. Outside the provider, Mantine handles Escape directly. | Use `Sheet` when the form should open from the bottom on mobile. |
| `DismissStackProvider` / `useDismissLayer` | Register each overlay for its actual open visit. The most recently opened layer gets Escape, and a focused child can cancel it. Set `managed: true` when the layer handles Escape itself. A persistent portal can supply `isActive` when its own open state determines whether it participates. Shared dialogs such as `FormDialog` and `ConfirmModal` register internally; call the hook directly only for a custom overlay. | The app's `onBaseDismiss` can handle route Back after the active layers close. |
| `TopMoreList` / `TopMoreMenu` / `splitTopMore` | A long list or menu that shows its top `n` (ranked by the caller) and one "More (k)" for the rest; `keepIds` are never hidden. See "Show a long list without the scroll" above. | Lists in their natural order that page from the server (browse rows, home rows), and short fixed menus — those are not collapsed. |
| `ToastRegion` / `Toast` | Feedback on something the person just did ("Moved to Lunch", an Undo, a failed send). Out of flow, so it never shifts the page: just above the bottom tabs on mobile, bottom-right on tablet-up; portals into `.ds-root` so it keeps the theme colours. The app owns the state; `Toast` only shows it, so an action's busy state stays live. `autoCloseMs` is for pure information; a toast with an action never auto-closes. Errors are `role="alert"`, the rest `role="status"`. | Anything that arrived on its own schedule and waits on the person (a question, a pending review): give it a reserved slot in the page instead. A section's load failure is an `ErrorState`, not a toast. |
| `LoadingState` / `ErrorState` / `EmptyState` | The only sanctioned way to render an async section's loading, failure, and no-data states. `ErrorState` throws if `onRetry` is missing — a dead-end error with no next step is a spec violation, not a shortcut. | A field-level validation error (that's inline form feedback, not a section state) or a state that isn't loading/error/empty (e.g. a partial/degraded state needs its own explicit UI). |
| `SectionCard` | A surface panel for one logical group. Use `variant="form"` for an elevated editor panel with a monospace heading and additional padding. Omit the title when a grouped editor already provides labeled fields in its body, as in [Shopping retailers](../../../__app_modules/money/finance/browser/admin/ShoppingConfig.jsx). | A simple list item or dense table row. |
| `StatCard` | A label + big tabular number, with optional unit, trend, and sparkline. `emphasis` is the one louder variant a screen may use — at most once per screen. | You need more than one emphasized stat on the same screen — pick the single most important number, or the hierarchy collapses. |
| `Skeleton` | A loading placeholder shaped like the content it stands in for. Mantine-compatible props (`height`, `width`, `radius`, `circle`) for a drop-in swap. Replaces Mantine's own `Skeleton`, which reads as a bright flash on these dark panels. | An indeterminate spinner is more honest than a shaped placeholder (e.g. content whose eventual layout is genuinely unknown). |
| `DateStepper` | Paging a single day backward/forward with a "Today"/"Yesterday" label and a clamp at `max`. | A date *range* picker or multi-date selection — this is single-day stepping only. |
| `createAppLogger` | The lazy per-app structured logger (`logger.debug/info/warn/error/sampled`, `.child()`), avoiding import-time logger races. One call per app module. | Ad hoc `console.*` calls anywhere — see the logging framework rules for the general policy this specializes. |
| `TouchButton` | A kiosk-size (min 64px, `--choice` variant 88px), token-driven button for touch-first screens — `variant="primary"\|"secondary"\|"choice"\|"sort-notyet"\|"sort-familiar"\|"sort-gotit"`, optional `keyHint` badge for a paired physical key. Renders `ds-touch ds-touch--<variant>`. | A dense desktop control bar — this is sized for a finger, not a mouse; use a plain Mantine `Button` there instead. |

For custom modal surfaces, use Mantine's focus trap to contain Tab and
Shift+Tab. Match the trap to the named dialog and put adjacent controls
inside that boundary. Give focus to the primary input or a useful first
control. The feature still owns return focus and any navigation history.
When a transient menu item opens a dialog, give it a persistent return target
before opening. Media's Start fresh dialog returns to the Settings button.
[Media phone search](../../../__app_modules/media/media/browser/search/SearchMode.jsx) ·
[Media settings](../../../__app_modules/media/media/browser/shell/SettingsMenu.jsx) ·
[Feed Scroll detail](../../../__app_modules/media/feed/browser/Scroll/detail/DetailModal.jsx)

In `Sheet`, mark the initial input with `data-autofocus`. Once the sheet
records the opener, it moves focus to that input or Close if focus is still
outside the panel. Tab and Shift+Tab stay in the sheet, including when an
action has moved focus to a loading region. Custom dialogs can use
`useDialogFocus(active, panelRef, fallbackRef)` on their own panel and
compose its returned `onKeyDown` with feature-specific keys.
[Auto place naming](../../../__app_modules/household/auto/browser/DrivesPanel.jsx) ·
[Auto service types](../../../__app_modules/household/auto/browser/ServicePanel.jsx) ·
[Feed player sheet](../../../__app_modules/media/feed/browser/players/FeedPlayerSheet.jsx) ·
[Feed article detail](../../../__app_modules/media/feed/browser/Scroll/detail/DetailModal.jsx) ·
[Media phone search](../../../__app_modules/media/media/browser/search/SearchMode.jsx) ·
[Home camera](../../../__app_modules/household/camera/browser/CameraViewport.jsx)

Use `Sheet`'s `getFallbackFocusTarget` when a live update can remove the
opening control. Return a mounted control or a named focusable region.
The sheet tries its explicit `returnFocusRef` or original opener first and
uses the fallback if focus is still on the document body. Home Rooms offers
the expanded room header and Home Assistant region as destinations.
[Home detail sheet](../../../__app_modules/household/home/browser/ui/EntityDetailSheet.jsx)

The seven browser app routes opt into the edge-to-edge viewport. Mantine
dialog sizing follows the same safe rectangle, including body portals.
For centered notifications, set `data-safe-area-center` so they center
between asymmetric device insets.

## Data fetching

`frontend/src/lib/hooks/useApiResource.js` is the house `{ data, hasResult, loading,
error, revalidating, reload, refresh, poll }` fetch hook — a GET-backed request wrapped in
the loading/error bookkeeping every app needs, so no screen hand-rolls its
own. In its default mode it behaves like any plain fetch-on-mount hook:
`loading` starts `true` and clears once the request settles, and `reload()`
always re-enters that same loading state. This mode does no cache reads or
writes, and there is nothing new to opt into.

Concurrent mounts share an unbounded pending GET for the same path and scope
when it started within the last three seconds. A later mount starts a fresh read
once that window expires. Bounded readers with the same `timeoutMs` can join
the same request through its original deadline, including during transient
retry backoff. Invalidation and cache patches retire the
pre-change request and let mounted readers share the first fresh GET for
each path. Readers recovering from a transient failure can also share a
pending retry. An explicit `reload()` or `refresh()` starts its own read.
Use `poll()` on a timer. It waits for the next tick if the reader already has
a GET, a retry delay or a queued refresh.

Each in-flight GET stays connected while a mounted reader, an admitted
prefetch or an imperative cache read needs it. Departure releases the mounted
reader's interest. The final
departure cancels the transport after the current turn so a synchronous
observer replacement or prefetch can still adopt it. A later visit issues
a fresh GET for the same path.

For a mounted app with local tabs, pass `enabled` for the active consumers of
each read and keep the resource path tied to its owner. A non-SWR reader keeps
its last accepted same-path result within that mount. Auto's selected car
overview feeds the header and reminders across views. Drives and Fuel share
one fuel reader, Service loads its history and type labels, and Docs releases
its documents read on departure. Use `hasResult` when the view must distinguish
its first read from an accepted result such as an HTTP 204. Restore scroll
after the active view can render its accepted result.
[Auto tabs](../../../__app_modules/household/auto/browser/AutoApp.jsx)

With `swr: true`, each path has one current cacheable read. All mounted,
enabled readers of that path display its accepted snapshot and receive its
refresh status. Readers and admitted prefetches that share a pending GET use
the same read. An accepted result can still warm the cache if a joined reader
leaves. The response is dropped if every reader leaves and no prefetch or
imperative cache read owns it. A timer tick leaves any current cacheable read
or retry for that path alone.

Set `freshMs` for a reader that can reuse a recently accepted snapshot on
mount. Explicit reload and invalidation still request fresh data. Use the same
`timeoutMs` for readers sharing a bounded resource. They share the original
deadline across body parsing and transient retries. An explicit retry starts
a new deadline.

For a mixed prefetch queue, `timeoutMsForPath` returns the same timeout used
by an observer of that path. A joined prefetch keeps the time remaining on
its original read. Home entities and Health days use a 25-second timeout, so
a stalled read can expire while the last accepted snapshot stays visible.
The next foreground poll can start a fresh read at the existing cadence.
[Home entities](../../../__app_modules/household/home/browser/entities/useHomeEntities.js) ·
[Health day prefetch](../../../__app_modules/wellness/health/browser/today/useHealthDayPrefetch.js)

In Admin lists, the row, image picker, capability check, combobox title,
Display preview and Item Details use one descriptor key. Search picks
provide immediate labels and images while the descriptor loads. Item Details
revalidates on open, can join an active read and publishes a successful Retry
to the row. Display preview can reuse a recent snapshot on reopening.
An ordinary menu display revalidates on mount. A caller that supplies a
renderable image skips the read.
[Catalog descriptor entry](../../../__capabilities/content-catalog/browser/descriptor.mjs) · [Row projection](../../../__capabilities/content-catalog/browser/admin/catalogContentInfo.js)

Use `reload()` to retry one reader. Use `invalidateApiResources(matches)`
when a write affects mounted readers of one or more shared resources. Use
`await refresh()` when a workflow must wait for its fresh GET to settle.
It resolves with the response accepted by this reader, rejects with the
read error, and rejects with `AbortError` if the request is superseded or
the reader changes scope or unmounts. A fresh SWR read supersedes waiters
for an older read of the same key. A create or remove dialog should
close when its write succeeds. If the roster GET then fails, let the
resource show a Retry button that issues only the GET.

A command can use `refresh({ followSuperseding: true })` when a replacement
read of the same key can confirm its write. The waiter follows the latest
read and takes its result or error. A change of key or storage owner, or
unmounting the observer, retires the waiter. [Scheduler roster](../../../frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx)

Life goal detail reads the selected member's goal and uses the same transition
command as the list. An acknowledged transition invalidates that goal, the
member's list and the full plan. The current detail waits for its GET, and
its Retry repeats the read while the submitted transition stays committed.
[Life goal detail](../../../__app_modules/personal/life/browser/views/plan/GoalDetail.jsx)

Capture the affected resource paths when a write starts. Auto refreshes the
submitted vehicle's overview and the changed collection, even if the driver
has selected another car by the time the save finishes. Household place
names have a wider audience and refresh the mounted journey and fuel-stop
reads that use them.
[Auto API](../../../__app_modules/household/auto/browser/useAutoApi.js)

Use `patchApiResource(path, update, { create: true })` when a confirmed
snapshot must publish even if the key is cold. The patch retires older
requests and reaches mounted readers before they revalidate. Health uses
this when reconciliation returns the first snapshot for an affected day.
[Health reconciliation](../../../__app_modules/wellness/health/browser/operations/HealthOperationsProvider.jsx)

For writes that update view state or invalidate session-wide reads, check
that the submitting session is still active. Health keeps its session above
the tabs, so a save can update the day after tab navigation. A new session
reads the committed server state.
[Health operations provider](../../../__app_modules/wellness/health/browser/operations/HealthOperationsProvider.jsx)

When an editor allows typing during a write, let the acknowledgement update
the Revert baseline for the submitted draft. Keep edits made after submission
in the current draft and leave the Unsaved indicator visible. Admin notification
settings replaces its draft with the server response only when the submitted
draft is still current. Later edits stay in the form until the next Save.

List and Section Settings keep Save focusable while `useSheetSubmission` guards
activation. The open visit overlays later field edits on the accepted settings.
If the confirmation read fails, the dialog exposes a GET-only Retry and keeps
both the acknowledged fields and the draft visible. [Admin settings form](../../../__capabilities/content-catalog/browser/admin/SettingsDialogForm.jsx)
[Admin notification settings](../../../frontend/src/modules/Admin/Notifications/NotificationsIndex.jsx)

A panel can keep an open editor mounted alongside its resource feedback.
The write refreshes the submitted resource on acknowledgement. Only the
editor instance that submitted it can dismiss itself after the save. A rejected
save keeps the draft and uses `StateMessage` to announce the error in the
editor, where the user can correct it and retry.
[Auto Fuel panel](../../../__app_modules/household/auto/browser/FuelPanel.jsx)

Player configuration belongs to the page. Playback instances share the first
request and its result, including the default when that request fails.

Transient network and proxy failures retry twice by default. A current
one-shot consumer can pass `retryTransient: false` to retain its immediate
error behavior; Displayer uses this while still sharing key scoping and
stale-response protection.

`clearDataOnError: true` clears a reader's displayed snapshot when an
accepted request fails. Media Fleet uses it because a failed roster must
stop offering those devices until a later read succeeds. This option
does not evict shared or persisted cache entries.

An opt-in stale-while-revalidate mode (`swr: true`) is for a view whose
structure should survive a refetch rather than disappear behind a loading
state. A small in-memory cache, keyed by the request path and bounded to a
fixed number of entries (least-recently-used eviction), holds the last
successful payload for the life of the tab. Freshness lives with each cached
snapshot and leaves memory when its entry is evicted. When a path already
has a cached entry, the hook renders that value on the very first paint. If
`freshMs` is set and the entry is still fresh, the mount reuses it without a
request when no cacheable read is already active. Otherwise a background
refresh runs and the separate `revalidating` flag reports it without showing a
loading state; the response replaces the displayed data and updates the cache.
An explicit `reload()` on a path with a cached entry behaves
the same way, which is what lets a mutation's refresh stay invisible instead
of flashing the view back to a loading state. A path with no cached entry yet
behaves exactly like the default mode until its first successful response
seeds the cache.

When a background refresh fails, the reader can provide both the last
successful `data` and the current `error`. Keep the selected snapshot visible
and offer `reload()` through `ErrorState` with a refresh-specific `title`, as
in the [Home history drawer](../../../__app_modules/household/home/browser/ui/EntityDetailSheet.jsx).

Only the current cacheable read can update the stored and displayed snapshot.
A fresh read retires the earlier read and its scheduled retries. A retry
continues the same read. Resetting a single cache key cancels its pending
cacheable read and preserves the last displayed value until revalidation.

**Persisting across page loads (opt-in, per app).**
`registerResourcePersistence({ store, prefixes })` returns a handle with `ready`, `setOwner`, and `dispose`. Independent consumers register disjoint path prefixes. Each registration backs the `swr` cache
with a store: `createIdbResourceStore(name)` in
`lib/hooks/persistentResourceStore.js`, which uses IndexedDB and is capped by
entry count and total bytes.

- **On registration**, owned snapshots under `prefixes` are restored into
  memory. An app can await `ready` before its first read for a warm start.
- **After confirming the owner**, cache updates are written to disk in
  batches every 400 ms and on `pagehide`.
- **Restored entries are stale by definition.** Every reader revalidates
  them, and the prefetcher does not treat them as fresh.
- **The disk copy belongs to one person.** Call the handle's `setOwner(id)` after server confirmation, including when the restored owner matches. A first claim or a change of owner retires matching cached data, pending writes and prefetches, and revalidates mounted readers. IndexedDB checks the persisted owner inside each write transaction.
- **Publish the confirmed context when a claim clears it.** Health uses `patchApiResource` to publish the exact context response immediately after its cache owner changes. The mounted shell can keep the current draft and focus during revalidation. A matching owner only needs `primeApiResource` to seed persistence. [Health cache owner](../../../__app_modules/wellness/health/browser/healthCache.js)
- **Dispose the registration** to release its listeners, discard its pending
  work and clear memory for just its prefixes.
- **Failures degrade to a normal network load.** No IndexedDB, a blocked
  open, a quota error, or a load slower than `timeoutMs` all do this.
- **Bump `RECORD_VERSION`** when a persisted payload shape changes
  incompatibly. Every old record is then ignored and pruned.

Health is the first app to use this (`__app_modules/wellness/health/browser/healthCache.js`).

The Health app's day view is the primitive's first consumer of the `swr`
mode; see
[`__docs/reference/health/README.md`](../health/README.md#loading-and-refresh)
for what that looks like end to end.

## Real-time subscriptions

Use `wsService.subscribeTopic(topic, handler)` when a feature needs events
from one exact topic. Return its disposer from the subscribing effect. The
shared connection subscribes once per topic and releases the server interest
when the last consumer leaves. On reconnect it restores the active topics.
The Admin diagnostic uses `app:websocket/<topic>` and the same subscription
contract as Media's external controls. Home Line signaling uses the
credentialed `subscribeAuthorized` method. [WebSocket service](../../../frontend/src/services/WebSocketService.js)

## One-shot microphone capture

Use `useMediaRecorderCapture()` when a feature needs a recording as a blob.
A mounted caller owns one capture through permission, recording and the final
flush. If an overlay stays mounted when hidden, pass `{ active: open }` so
closing it releases the tracks and stops its meter and elapsed timer. A retired
capture cannot publish a recording. The feature owns any transcription or
submission that follows. [Recorder hook](../../../frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js)

Life Triage uses `ds-touch-target` for Record, Stop and Send on coarse pointers.
The transcript fills the draft for review. Send submits the answer explicitly.
[Triage answer](../../../__app_modules/personal/life/browser/views/now/triage/AnswerInput.jsx)

## The rules

- New webapp UI is built from `@/lib/ui` and the token contract — not raw
  Mantine primitives standing in for a house component that already exists,
  and never a literal hex/rgb/motion value where a token applies.
- **Third duplicate gets promoted.** The first two times a pattern (a card
  shape, a state layout, an interaction) appears, it can live locally. The
  third occurrence is copy-paste calcifying into drift — extract it into
  `frontend/src/lib/ui` instead of copying it again.
- `npm run audit:ui` is the enforcement gate. It scans these roots: `frontend/src/Apps`,
  `frontend/src/lib/ui`, `frontend/src/modules/Admin`, and the `browser`
  folders of the Home, Health, Auto, Life, Feed, Media and Finance (`money/finance/browser`) app modules under
  `__app_modules/` (School has its own scoped guard). It looks for five violation classes — raw colors, raw motion/keyframe
  values, hand-rolled `keydown` listeners, native `<button>`/`<select>`
  elements outside `lib/ui`, and `--ds-*` names outside the token manifest —
  and compares each count against a checked-in baseline kept per root
  (`scripts/audit-ui-tokens.baseline.json`, `{ root: { rule: n } }`;
  `node scripts/audit-ui-tokens.mjs --write-baseline` rewrites it and refuses
  to raise any existing root's count; a new root must be added deliberately with
  `--add-root <root>`, and `--init-baseline` only works when no baseline file exists). A count at or below its baseline
  passes; a count above it fails the gate. **Baselines only shrink.** Fixing
  violations lowers a baseline number in the same change; a new violation
  raising a count above its baseline is a hard failure, never grounds for
  raising the baseline instead.
- `npm run check:scss` guarantees every SCSS entrypoint under `frontend/src`
  actually compiles — an invalid selector or other Sass error fails the
  pre-commit gate with the offending file and line, the same way it would
  fail `vite build` (and therefore the Docker image build), instead of only
  surfacing once someone tries to ship. Token/mixin partials aren't compiled
  standalone; each is exercised transitively through whichever entrypoint
  pulls it in via `@use`/`@import`, matching how Vite's own CSS pipeline sees
  them.
- **A component imports every stylesheet whose classes or tokens it uses.**
  Routes are lazy chunks (`main.jsx`), so a page gets only the CSS its own
  module graph imports; a class that lives only in an app sheet
  (`frontend/src/Apps/<Name>App.scss`) is unstyled wherever that app is not
  loaded. Shared tokens live in a shared module every consumer imports (the
  piano's are `__app_modules/Piano/pianoTokens.scss`); global utilities such as
  `.tabular-nums` live in `frontend/src/styles/utilities.scss`, loaded by
  `main.jsx`. `npm run audit:css-ownership` enforces it on commit: for each app
  sheet it lists the classes no other stylesheet defines, finds them as
  className tokens in `.js`/`.jsx` files outside that app's entry and own module
  folder, and compares the count per app with
  `scripts/audit-css-ownership.baseline.json` (same only-shrink rule). It sees
  class names only — a component that renders another module's component (and
  so its classes) is covered by that component importing its own sheet.

## Audit roots and accepted residuals

Final counts from `node scripts/audit-ui-tokens.mjs` (raw-color / raw-motion / raw-keydown / native-control / undefined-token). Every root is 0 on raw-color and undefined-token. Counts that are not zero are reviewed and accepted:

| Root | motion | keydown | native | Notes |
| --- | --- | --- | --- | --- |
| `frontend/src/Apps`, `frontend/src/lib/ui`, Home, Health, Life | 0 | 0 | 0 | clean |
| `frontend/src/modules/Admin` | 0 | 3 | 6 | Keydown: capture-phase review keys (`ContentFilter/useReviewKeys.js`) and dynamic-letter menus that `useHotkey` cannot express. Native: custom tabs and marks whose geometry is not a Button. |
| `household/auto/browser` | 0 | 0 | 1 | one native control kept |
| `media/feed/browser` | 3 | 5 | 111 | Motion: bespoke keyframes. Native: the feed-chip and feed-quiet treatment does not fit the `.ds-touch` Button geometry (see next work). Also 17 `notifications.show` sites and the scroll `matchMedia(min-width:900px)` stay; the audit does not count them. |
| `media/media/browser` | 14 | 7 | 76 | Motion: provenance and menu keyframes, and the SegmentMap test pins 120ms. Keydown: window-level TV-remote listeners. Native: same chip geometry issue as Feed. `cast/DestinationLine` keeps a Modal because FormDialog does not forward a ref. Four raw fetches remain (LaunchCard chain, countryMapGeoCache). |
| `money/finance/browser` | 0 | 0 | 8 | native controls kept |

Other known gaps:

- Health `today/DayInputBar` keeps a Mantine Modal. The shared `Sheet` has no focus-return opt-out and no layer prop (its z-index 300 sits below the toast layer at 350).
- Legacy `--ds-*` aliases in `.admin-theme` (see Packs) are kept for non-Admin consumers.

### Next shared-layer work

- `Sheet`: a focus-return opt-out and a layer prop, to take `DayInputBar` off Mantine Modal.
- `FormDialog`: forward a ref, to take `cast/DestinationLine` off Modal.
- A compact `Button` density that fits Feed and Media chips, which would retire most of the 187 native controls there.

## Visual verification

`/dev/ds-gallery` renders every visual primitive exported by `lib/ui` together —
chrome, cards, the async states, sheet, confirm and form dialogs, action menu,
toasts, skeleton, buttons, the date stepper — so a
token or primitive change can be eyeballed in one place instead of hunting
across apps. `tests/live/flow/ds/ds-gallery.runtime.test.mjs` drives it at a
phone and a desktop viewport, asserts no horizontal overflow, exercises the
sheet's open/Escape-close cycle, and saves a full-page screenshot per
viewport. Because layout regressions (a wrapper collapsing, a media query
losing specificity) are invisible to jsdom-based unit tests, this Playwright
pass — and a look at the resulting screenshots — is what actually confirms a
design-system change renders correctly; re-run it after any change to tokens,
packs, or `lib/ui`. `frontend/src/dev/DsGallery/DsGallery.test.jsx` fails when a
component is added to the `lib/ui` barrel without a gallery entry
(`<Demo primitives="...">`) or a stated exemption.

## Route-owned overlays

An editor, destructive confirmation, or other draft overlay must carry the
identity of the route/resource that opened it. Gate rendering against the
current owner during render, then clear stale state when that owner changes or
the view becomes inactive. This closes stale drafts immediately and prevents
Back/Forward navigation or retained tabs from reviving an action against a
different resource. Keep the owner with the overlay state instead of inferring
it from a row whose payload may be incomplete.
