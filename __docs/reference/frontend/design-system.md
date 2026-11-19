# Webapp Design System

Admin, Health, Media, Feed, Home, Life and Auto share browser layout and interaction contracts. Theme packs supply app-specific art direction. Playback engines and feature workflows stay with their apps.

## Find a pattern by task

| Task | Start here | Example |
| --- | --- | --- |
| Open a destination or select a local view | `AppChrome` accepts tabs with an optional `href`. A destination renders a router link. A local view calls `onTabChange(id)`. The app owns selection and reload behavior. | Life routes and Home views |
| Open a feature from a keyboard shortcut | `useHotkey(combo, handler)` binds the shortcut for the mounted owner. Launch shortcuts yield to editable fields and focused modal dialogs. The app chooses the destination or control. Return `false` when there is nothing to open. | [Feed search](../../../__app_modules/media/feed/browser/FeedApp.jsx) · [Media search](../../../__app_modules/media/media/browser/shell/MediaAppShell.jsx) · Health Coach |
| Compose a grouped editor | Supply header and navigation to `AppFrame`. Its `mainRef` points to the primary scroll region. | Admin |
| Measure or adjust the active scroll region | Inside `AppFrame` content, get the ref with `useAppMainRef()` and read `ref?.current` in an event or effect. The frame owns the element and a caller can still receive it through the `mainRef` prop. | Home Mosaic tooltip positioning, Health food selection and toast clearance |
| Return to a view at its previous position | `useViewScroll({mainRef, viewKey, owner, ready})` restores the position after the view is ready and clears it when the owner changes. | Health Today |
| Choose content without losing an unsaved form | Bind the catalog combobox to the draft’s content ID. On selection, update that field and keep the editor mounted. The editor owns Save and Cancel. | [Admin list item editor](../../../__capabilities/content-catalog/browser/admin/ListsItemEditor.jsx) |
| Keep playback alive while browsing | `PlaybackFrame` places controls, overlays and the engine alongside routed children. Each app supplies one main landmark. Feed passes its scrolling element to its routes through Outlet context. | Feed reader and Media canvas |
| Render a symbol or app supplied icon asset | `UiIcon` maps semantic names to the shared icon set. With `src`, it renders the asset and falls back to the named icon on load failure. Icons are decorative; the surrounding control supplies its accessible name. | Fitness navigation rail |
| Read server data | Use `useApiResource(path)` when a component observes a JSON resource. Use `DaylightAPI` for an imperative JSON operation. | [Catalog title lookup](../../../__capabilities/content-catalog/browser/lib/useContentTitle.js) · [Health food icon picker](../../../__app_modules/wellness/health/browser/today/EntryEditor.jsx) · [Admin config editor](../../../frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx) · [Admin member roster](../../../frontend/src/modules/Admin/Household/MembersIndex.jsx) |
| Let someone dismiss an error without clearing its resource | `useDismissibleError(error)` returns the visible error and a `dismiss()` action. Dismissal applies to that error object; a later error remains visible. The resource keeps ownership of the error itself. | Admin integrations, agent directory and Health Agent Dashboard |
| Interpret a command response | Use `daylightApiResponse(path, { method, data, signal })` when the feature needs the original HTTP status and body. The shared client supplies request headers. The feature interprets partial successes and controls retries. | [Playback Hub commands](../../../__app_modules/media/media/browser/admin/playback-hub/hooks/useHubMutations.js) · [Screen registry conflicts](../../../__app_modules/media/media/browser/house/houseApi.js) |
| Save a versioned document | Pass the current revision in `ifMatch` and read `ETag` from the response headers after a successful write. Keep the edited document and conflict errors with the feature. | [Agenda editor client](../../../__app_modules/household/agenda/browser/admin/agendaClient.js) |
| Consume a stream or image | Use `daylightApiResponse` for same-origin requests and pass the response body to the consumer that owns its lifetime. Chat parses incremental events. Camera previews revoke their object URLs when replaced. | [Chat runtime](../../../__capabilities/agent-runtime/browser/chat/runtime.js) · [Camera snapshots](../../../__app_modules/household/camera/browser/useSnapshotFetch.js) |
| Upload a file | Pass native `FormData` as `data` to `daylightApiResponse(path, { method: 'POST', data })`. The client supplies identity headers and the browser sets the multipart boundary. | [Catalog image picker](../../../__capabilities/content-catalog/browser/admin/ImagePickerModal.jsx) |
| Subscribe to live changes | Use the shared socket subscription hook. The feature checks who an event belongs to and which resource changed. On reconnect, a stateful view can reload its authoritative snapshot. | [Subscription hook](../../../frontend/src/hooks/useWebSocket.js) · [Media fleet recovery](../../../__app_modules/media/media/browser/fleet/FleetProvider.jsx) |
| Poll while a screen is in use | `useVisibleRefresh({active, intervalMs, reload})` releases its timer when the document is hidden and refreshes on return. | Home entities and Today timeline, Health day ledger |
| Show temporary confirmation after an action | `useTemporaryIndicator(durationMs)` returns `[visible, show]`. The feature calls `show()` when its current action succeeds. Calling it again extends the confirmation. Unmounting clears the timer. | Art save feedback and Feed copy confirmation |
| Display elapsed time or a countdown | `useDisplayClock(active, intervalMs)` samples wall time while the label is visible. The feature supplies the start time or deadline. | Admin catalog resolving label, Media sleep countdown |
| Observe browser work that has multiple resources to release | In an effect, return `whileDocumentVisible(start)`. Its start callback acquires resources for one visible interval and returns the cleanup. | Feed Scroll performance sampling and player progress painting |
| Label a native field in a mobile sheet | Associate a native label with the input. Use the shared `.ds-input` geometry and a compact `Button` for submission. | Auto fuel, maintenance and journey editors |
| Show an action icon | Use `UiIcon` for search and close. Set the accessible name on the surrounding control. Decorative symbols stay out of its spoken name. | [Shared sheet](../../../frontend/src/lib/ui/Sheet.jsx) · [Media search launcher](../../../__app_modules/media/media/browser/shell/Dock.jsx) |
| Show a field error | Give a Mantine input a label, description and field-specific error. The gallery demonstrates an error that clears after a correction. | [Controls gallery](../../../frontend/src/dev/DsGallery/DsGallery.jsx) |
| Offer one or several choices | Use Mantine `Radio.Group` for mutually exclusive choices, a labelled `Checkbox` for a boolean, and `Chip.Group multiple` for a set. The feature owns the values. A `Menu` exposes actions such as resetting the set. | [Collection filters in the gallery](../../../frontend/src/dev/DsGallery/DsGallery.jsx) |
| Queue an offline action | Use `createBrowserMutationQueue({ prefix, getOwner, idOf, valid })` for owner-scoped actions retained in local storage. Enqueue synchronously before acknowledging the change. The feature supplies the operation and decides when replay is safe. An acknowledged send can retry failed local cleanup within the same page. Concurrent tabs and lost server replies require separate coordination or server idempotency. | [Feed item state](../../../__app_modules/media/feed/browser/FeedWorkspaceContext.jsx) · [Feed annotations](../../../__app_modules/media/feed/browser/offline/annotationOfflineStore.js) |
| Remember a simple preference | `browserPreference(key, fallback, decode)` preserves the raw string format. The feature supplies migration and validation. Call `clear()` when removing a stored override returns selection to its default owner. | Home view, Life member, Admin preview screen and Feed playback settings |
| Save an account preference while keeping the controls responsive | Publish the local edit immediately. Order server reads, migration and saves for the account. Apply acknowledgements to the submitted fields that still represent the latest edit. | Feed reading appearance |

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

## Token contract

`frontend/src/lib/theme/tokens.mjs` defines the base roles, motion values and control geometry. App packs in
`packs.mjs` override semantic roles for their surfaces.

Seven semantic color roles: `background`, `surface`, `surfaceAlt`, `border`,
`textHigh`, `textMid`, `textLow`. Five status colors: `success`, `warning`,
`danger`, `info`, `live`. Motion tokens: `fast` (120ms), `base` (200ms),
`reveal` (300ms), and a shared `easing` curve. The `md` and `lg` breakpoints drive JavaScript and Sass. After editing them in `tokens.mjs`, run `node frontend/scripts/generate-browser-breakpoints.mjs` to update the checked-in Sass variables.

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
- **Web fonts used by more than one app** belong in the single font `<link>`
  in `frontend/index.html`. Roboto Condensed, Inter, IBM Plex Sans and
  JetBrains Mono are there. A font only one module uses (ArtMode's
  Garamonds, the clock's Droid Sans Mono, School's Kongtext) stays with that
  module.
- Admin's palette lives in its pack. `frontend/src/modules/Admin/Admin.variables.scss` defines scoped legacy aliases for editors. The provider encloses an Admin portal target so controls and dialogs inherit the same colors.
- Admin’s navigation uses the shared `md` breakpoint. At 768px the focused link stays in the visible rail. At 767px the rail collapses and its toggle takes focus if that link was focused. [Keyboard and resize tests](../../../tests/live/flow/admin/admin-navigation.runtime.test.mjs)

Before route splitting, one 11 MB bundle loaded every app's CSS on every
page. That hid these dependencies. Lib/ui, Life, Auto and Call had been
reading Admin's tokens, and Piano, School, Fitness and Auto had been rendering
in fonts that only Finance, Feed and Media loaded.

A `--ds-*` name that isn't part of the contract is a bug, not a typo that
silently degrades — an unknown custom property falls back to `inherit`, so it
looks fine until the surrounding context changes. `npm run audit:ui` checks
every `var(--ds-*)` reference against the manifest of legal names.

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

For a content picker or search combo, use `ContentCombobox` from the catalog capability. Its `value` and `onChange` bind the selected content ID to the editor. The controller and result rows are also available for Media’s full-screen search. [Public picker export](../../../__capabilities/content-catalog/browser/picker.mjs) · [Admin form example](../../../__capabilities/content-catalog/browser/admin/ListsItemEditor.jsx)

The primitives in the table are exported from `frontend/src/lib/ui/index.js`. Use them for shared layout, cards and feedback. Use the app’s themed Mantine controls for labelled fields, radio groups, chips and menus.

| Primitive | For | Don't use it when |
|---|---|---|
| `AppThemeProvider` | Wraps an app in its Mantine theme + `--ds-*` vars, given a pack name. | You need a second, nested theme scope — packs are per-app, not per-section. |
| `AppChrome` | Header, responsive primary navigation, main scroll region and optional footer. The shell uses bottom tabs on mobile and a left rail at larger widths. Use `useAppMainRef` inside its content when an interaction needs the scroll element. | A modal or another local layout inside an app. |
| `Sheet` | A task flow that needs its own scrollable surface and dismiss affordance: multi-step forms, detail drill-in, anything the user is *doing*. Bottom sheet on mobile; centered dialog on desktop by default; `placement="side"` makes it a right panel (full height, `min(440px, 100vw)` wide) for a drill-in that should sit beside the page it came from; registers on the dismiss stack so Escape and scrim-click close it; locks body scroll while open. | A yes/no confirmation, a destructive-action warning, or anything that should block the whole screen and demand one decision — use Mantine `Modal` for that; `Sheet` is not centered-attention chrome. |
| `DismissStackProvider` / `useDismissLayer` | Registering any overlay (sheet, custom popover, in-house dropdown) on the single app-wide Escape handler, so nested overlays dismiss top-first instead of racing competing `keydown` listeners. Mantine overlays (`Modal`, `Drawer`, `Popover`, `Menu`) register themselves — pass `managed: true` for those. | The overlay is a native `<dialog>`/Mantine component that already manages its own Escape handling without `useDismissLayer` — don't double-register it as unmanaged. |
| `ToastRegion` / `Toast` | Feedback on something the person just did ("Moved to Lunch", an Undo, a failed send). Out of flow, so it never shifts the page: just above the bottom tabs on mobile, bottom-right on tablet-up; portals into `.ds-root` so it keeps the theme colours. The app owns the state; `Toast` only shows it, so an action's busy state stays live. `autoCloseMs` is for pure information; a toast with an action never auto-closes. Errors are `role="alert"`, the rest `role="status"`. | Anything that arrived on its own schedule and waits on the person (a question, a pending review): give it a reserved slot in the page instead. A section's load failure is an `ErrorState`, not a toast. |
| `LoadingState` / `ErrorState` / `EmptyState` | The only sanctioned way to render an async section's loading, failure, and no-data states. `ErrorState` throws if `onRetry` is missing — a dead-end error with no next step is a spec violation, not a shortcut. | A field-level validation error (that's inline form feedback, not a section state) or a state that isn't loading/error/empty (e.g. a partial/degraded state needs its own explicit UI). |
| `SectionCard` | A surface panel for one logical group. Use `variant="form"` for an elevated editor panel with a monospace heading and additional padding. Omit the title when a grouped editor already provides labeled fields in its body, as in [Shopping retailers](../../../__app_modules/money/finance/browser/admin/ShoppingConfig.jsx). | A simple list item or dense table row. |
| `StatCard` | A label + big tabular number, with optional unit, trend, and sparkline. `emphasis` is the one louder variant a screen may use — at most once per screen. | You need more than one emphasized stat on the same screen — pick the single most important number, or the hierarchy collapses. |
| `Skeleton` | A loading placeholder shaped like the content it stands in for. Mantine-compatible props (`height`, `width`, `radius`, `circle`) for a drop-in swap. Replaces Mantine's own `Skeleton`, which reads as a bright flash on these dark panels. | An indeterminate spinner is more honest than a shaped placeholder (e.g. content whose eventual layout is genuinely unknown). |
| `DateStepper` | Paging a single day backward/forward with a "Today"/"Yesterday" label and a clamp at `max`. | A date *range* picker or multi-date selection — this is single-day stepping only. |
| `AskAffordance` | The entry pill that opens an app's chat/coach overlay (pairs with `__app_modules/Agent/AgentChatSurface`). | Any other kind of search or command input — this is scoped to the ask/chat affordance, not a generic search box. |
| `createAppLogger` | The lazy per-app structured logger (`logger.debug/info/warn/error/sampled`, `.child()`), avoiding import-time logger races. One call per app module. | Ad hoc `console.*` calls anywhere — see the logging framework rules for the general policy this specializes. |
| `TouchButton` | A kiosk-size (min 64px, `--choice` variant 88px), token-driven button for touch-first screens — `variant="primary"\|"secondary"\|"choice"\|"sort-notyet"\|"sort-familiar"\|"sort-gotit"`, optional `keyHint` badge for a paired physical key. Renders `ds-touch ds-touch--<variant>`. | A dense desktop control bar — this is sized for a finger, not a mouse; use a plain Mantine `Button` there instead. |

## Data fetching

`frontend/src/lib/hooks/useApiResource.js` is the house `{ data, loading,
error, revalidating, reload, refresh }` fetch hook — a GET-backed request wrapped in
the loading/error bookkeeping every app needs, so no screen hand-rolls its
own. In its default mode it behaves like any plain fetch-on-mount hook:
`loading` starts `true` and clears once the request settles, and `reload()`
always re-enters that same loading state. This mode does no cache reads or
writes, and there is nothing new to opt into.

Concurrent mounts share a pending GET for the same path and scope when it
started within the last three seconds. A later mount starts a fresh read
once that window expires. Invalidation and cache patches retire the
pre-change request and let mounted readers share the first fresh GET for
each path. Readers recovering from a transient failure can also share a
pending retry. An explicit `reload()` or `refresh()` starts its own read.

Use `reload()` to retry one reader. Use `invalidateApiResources(matches)`
when a write affects mounted readers of one or more shared resources. Use
`await refresh()` when a workflow must wait for its fresh GET to settle.
It resolves with the response accepted by this reader, rejects with the
read error, and rejects with `AbortError` if the request is superseded or
the reader changes scope or unmounts. A create or remove dialog should
close when its write succeeds. If the roster GET then fails, let the
resource show a Retry button that issues only the GET.

When an editor allows typing during a write, let the acknowledgement update
the Revert baseline for the submitted draft. Keep edits made after submission
in the current draft and leave the Unsaved indicator visible.

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
successful payload for the life of the tab. When a path already has a cached
entry, the hook renders that value on the very first paint — `loading` is
`false` immediately, and a separate `revalidating` flag reports that a
background refresh is running instead. The fetch still happens; its result
quietly replaces the displayed data and updates the cache, with no loading
state appearing at any point. `reload()` on a path with a cached entry behaves
the same way, which is what lets a mutation's refresh stay invisible instead
of flashing the view back to a loading state. A path with no cached entry yet
behaves exactly like the default mode until its first successful response
seeds the cache.

When a background refresh fails, the reader can provide both the last
successful `data` and the current `error`. Keep the selected snapshot visible
and offer `reload()` through `ErrorState` with a refresh-specific `title`, as
in the [Home history drawer](../../../__app_modules/household/home/browser/ui/EntityDetailSheet.jsx).

Cache writes are race-protected: a response is only allowed to overwrite its
path's cached value if it is still the most-recently-issued request for that
path by the time it resolves. This covers both an overlapping reload on one
component and two separately mounted components requesting the same path — in
either case, a slower, superseded response can never clobber a fresher answer
that already landed.

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

## The rules

- New webapp UI is built from `@/lib/ui` and the token contract — not raw
  Mantine primitives standing in for a house component that already exists,
  and never a literal hex/rgb/motion value where a token applies.
- **Third duplicate gets promoted.** The first two times a pattern (a card
  shape, a state layout, an interaction) appears, it can live locally. The
  third occurrence is copy-paste calcifying into drift — extract it into
  `frontend/src/lib/ui` instead of copying it again.
- `npm run audit:ui` is the enforcement gate. It scans the app roots and
  `lib/ui` itself for five violation classes — raw colors, raw motion/keyframe
  values, hand-rolled `keydown` listeners, native `<button>`/`<select>`
  elements outside `lib/ui`, and `--ds-*` names outside the token manifest —
  and compares each count against a checked-in baseline
  (`scripts/audit-ui-tokens.baseline.json`). A count at or below its baseline
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

## Visual verification

`/dev/ds-gallery` renders every primitive together — chrome, both card types,
all three async states, the sheet, the date stepper, the ask affordance — so a
token or primitive change can be eyeballed in one place instead of hunting
across apps. `tests/live/flow/ds/ds-gallery.runtime.test.mjs` drives it at a
phone and a desktop viewport, asserts no horizontal overflow, exercises the
sheet's open/Escape-close cycle, and saves a full-page screenshot per
viewport. Because layout regressions (a wrapper collapsing, a media query
losing specificity) are invisible to jsdom-based unit tests, this Playwright
pass — and a look at the resulting screenshots — is what actually confirms a
design-system change renders correctly; re-run it after any change to tokens,
packs, or `lib/ui`.
