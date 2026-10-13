# Admin UI Transformation — From Functional to World-Class

**Date:** 2026-02-11
**Status:** Draft
**Scope:** Visual design, UX patterns, interaction quality, and frontend architecture improvements for the DaylightStation Admin interface.

---

## 1. Audit Summary

The admin interface is **architecturally sound** — the hook abstraction, route structure, backend API, and component hierarchy are well-designed. What holds it back is not engineering but *aesthetics and interaction design*. It currently looks like a Mantine template with default settings applied.

### What Works

- **Hook layer** — `useAdminConfig`, `useAdminLists`, `useAdminScheduler`, etc. are clean, reusable, and well-separated from UI
- **Shared components** — `CrudTable`, `ConfigFormWrapper`, `YamlEditor`, `TagInput`, `ConfirmModal` provide consistent primitives
- **Content Lists** — The most mature section; drag-and-drop, streaming search, content hierarchy browsing, section management are all impressive
- **Dirty state tracking** — Unsaved changes badge + revert everywhere prevents data loss
- **Backend API design** — RESTful, consistent, well-documented in the PRD

### What Doesn't Work

| Problem | Where | Impact |
|---------|-------|--------|
| **System fonts** | `AdminApp.jsx` theme: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | Instantly reads as "default"; zero personality |
| **No color identity** | Mantine's `primaryColor: 'blue'` with stock dark palette | Indistinguishable from any Mantine dark app |
| **Flat visual hierarchy** | Every section uses identical `Stack` + `Group` + `Text` | Content and controls blend together; nothing guides the eye |
| **No spatial drama** | Main content area is a single `padding-md` box | No layering, no depth, no visual breathing room |
| **Minimal motion** | Only hover transitions (150ms) and shimmer loading | App feels static and lifeless; no entry animations, no feedback loops |
| **Generic nav** | Mantine `NavLink` list with uppercase section labels | Functional but forgettable; no brand presence in the sidebar |
| **Cramped tables** | 36px rows, 2px/4px padding throughout | Spreadsheet-dense; works for power users but hostile to everyone else |
| **No empty states** | ComingSoon has one; others show bare text or nothing | Missed opportunity for delight and guidance |
| **No toast/notification system** | Saves succeed silently; errors show inline alerts | Users don't know if their action worked without staring at the screen |
| **Inconsistent section chrome** | Some pages use `Paper`, some don't; some have `Divider`, some don't | No visual rhythm across sections |
| **2350-line mega-component** | `ListsItemRow.jsx` | Maintenance nightmare; forces entire component tree to re-render on any item change |
| **Duplicated utilities** | `capitalize()`, `typeBadgeColor()`, `truncateUrl()`, constants in multiple files | Fragility; changes need to be made in multiple places |
| **No keyboard shortcuts** | No Cmd+S to save, no Cmd+Z to undo | Power users forced to mouse everything |
| **No accessibility** | No ARIA labels, no focus management, no reduced-motion support, no keyboard nav on tables | Not usable with assistive technology |
| **No responsive polish** | Navbar collapses at `sm` breakpoint but content area has no mobile treatment | Usable on desktop only |

---

## 2. Design Direction

### Aesthetic: **Mission Control**

The admin interface manages a home automation system — screens, devices, media libraries, fitness equipment, cron jobs, integrations. This is a *control room*. The design should feel like a polished, modern mission control: **authoritative, information-dense but not cluttered, with moments of visual delight** that reward attention.

Think: Linear.app meets a NASA flight console. Clean geometry. Monospaced accents. Ambient glow on active elements. Purposeful use of color to encode meaning, not decoration.

### Palette

Move away from Mantine's stock dark palette. Define a custom color system:

```
Background layers:
  --ds-bg-base:      #0C0E14    (deepest — app shell)
  --ds-bg-surface:   #12141C    (cards, panels)
  --ds-bg-elevated:  #1A1D28    (modals, dropdowns, hover states)
  --ds-bg-overlay:   #222636    (active nav items, selection highlights)

Borders:
  --ds-border:       #2A2E3D    (subtle dividers)
  --ds-border-focus: #4A7BF7    (focus rings, active borders)

Text:
  --ds-text-primary:   #E8EAF0  (primary content)
  --ds-text-secondary: #8B90A0  (labels, metadata)
  --ds-text-muted:     #555A6E  (disabled, tertiary)

Accent:
  --ds-accent:         #4A7BF7  (primary actions, active states)
  --ds-accent-glow:    rgba(74, 123, 247, 0.15)  (ambient glow behind active elements)
  --ds-accent-hover:   #5D8AFF

Semantic:
  --ds-success:    #34D399  (saved, healthy, active)
  --ds-warning:    #FBBF24  (unsaved, degraded, attention)
  --ds-danger:     #F87171  (error, destructive, failed)
  --ds-info:       #60A5FA  (informational badges)
```

### Typography

Replace system fonts with a distinctive pairing:

- **Headlines/Navigation:** `"JetBrains Mono"` — monospaced, technical, authoritative. Loaded from Google Fonts subset (latin, weight 400/500/600).
- **Body/Forms:** `"Inter"` — wait, the guidelines say no Inter. Use `"IBM Plex Sans"` instead — humanist but technical, excellent at small sizes, pairs well with JetBrains Mono.
- **Code/YAML/IDs:** `"JetBrains Mono"` (same as headlines, creating cohesion)

Font loading via `<link>` in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Spatial System

Replace Mantine's spacing scale with a custom 4px grid:

```
--ds-space-1:  4px
--ds-space-2:  8px
--ds-space-3:  12px
--ds-space-4:  16px
--ds-space-5:  20px
--ds-space-6:  24px
--ds-space-8:  32px
--ds-space-10: 40px
--ds-space-12: 48px
--ds-space-16: 64px
```

Key principle: **generous padding inside containers, tight spacing between related elements**. Cards get 20-24px padding. Related form fields get 8-12px gaps. Sections get 32-48px vertical breathing room.

---

## 3. Component-Level Transformation

### 3.1 App Shell & Navigation

**Current:** 250px sidebar, 60px header, stock Mantine AppShell.

**Transform to:**

#### Sidebar (280px)
- Background: `--ds-bg-base` with a subtle 1px right border in `--ds-border`
- **Brand mark** at top: "DAYLIGHT" in JetBrains Mono 600, letter-spacing 0.1em, with a small amber/gold accent dot (sun motif). 48px tall zone.
- **Section labels:** JetBrains Mono 500, 10px, uppercase, letter-spacing 0.15em, color `--ds-text-muted`. Margin-top 24px between sections.
- **Nav items:** IBM Plex Sans 500, 13px. Left border (3px) that slides in on active (accent color). Active item gets `--ds-bg-overlay` background with the accent glow. Hover: `--ds-bg-elevated`.
- **Icons:** 18px Tabler icons. Active icons get accent color; inactive get `--ds-text-secondary`.
- **Collapse behavior:** On mobile, sidebar becomes a full-overlay drawer with frosted glass backdrop (`backdrop-filter: blur(12px)`).

#### Header (56px)
- Background: transparent (sits on main content background)
- **Breadcrumbs:** JetBrains Mono 400, 12px, with `/` separators in `--ds-text-muted`. Current segment in `--ds-text-primary`, parents in `--ds-text-secondary` and clickable.
- **Right side:** Status indicator dot (green = all integrations healthy), mobile burger, future: user avatar.
- No bottom border. Instead, main content area has its own top padding to create breathing room.

#### Main Content Area
- Background: `--ds-bg-surface`
- Padding: 32px (desktop), 16px (mobile)
- Max-width: 1200px for forms/tables, centered with auto margins
- Subtle top-left rounded corner (12px) where it meets the sidebar, creating a layered "panel" effect

### 3.2 Content Lists (Polish, Not Rebuild)

Content Lists are the most complete section. Changes are surgical:

#### Table Rows
- Increase row height from 36px to 44px — more breathing room
- Row background: alternate between `--ds-bg-surface` and `--ds-bg-elevated` (current dark-7/dark-6 is too similar)
- Hover: subtle left border (2px accent) slides in, background shifts to `--ds-bg-overlay`
- Active row (being edited): persistent accent left border + faint `--ds-accent-glow` box-shadow

#### Drag Handles
- Current: `IconGripVertical` with cursor change
- Add: on drag start, row lifts with `box-shadow: 0 8px 32px rgba(0,0,0,0.4)` and slight scale(1.02). Drop zone shows a 2px accent line.

#### ContentSearchCombobox
- The dropdown is already well-styled. Add: entry animation — dropdown scales from 0.95 to 1.0 with opacity 0→1 over 150ms.
- Breadcrumb bar: use JetBrains Mono for path segments (these are content IDs/paths — monospace is semantically correct)
- Pending sources indicator: replace pulse animation with a more refined shimmer sweep (left-to-right gradient pass)

#### Section Headers
- Current: plain text with 2px border-bottom
- Transform: JetBrains Mono 500, 11px uppercase, letter-spacing 0.1em. Small accent-colored triangle/chevron before the title. Collapse animation: height + opacity transition (200ms ease-out).

#### Empty States
- Current: centered text
- Transform: centered icon (64px, muted), descriptive text, and a prominent "Add first item" CTA button. Subtle dashed border around the empty zone.

### 3.3 Config File Editor

#### File Browser (ConfigIndex)
- Current: flat list grouped by directory
- Transform to a compact tree view:
  - Directory rows: JetBrains Mono 500, 12px, with folder icon. Click to expand/collapse.
  - File rows: IBM Plex Sans 400, 13px, indented 24px. Right-aligned: file size (JetBrains Mono 400, 11px, muted), modified date (relative: "2h ago"), protected badge.
  - Files with purpose-built editors: show a small arrow-right icon + "Open editor" chip that links out
  - Hover: row background to `--ds-bg-elevated`

#### YAML Editor
- Current: CodeMirror with oneDark theme
- Add custom theme overrides to match the DS palette:
  - Background: `--ds-bg-base` (darker than surrounding card)
  - Gutter: slightly lighter, with line numbers in `--ds-text-muted`
  - Active line: subtle highlight in `--ds-bg-overlay`
  - Matching brackets: accent color underline
- **Diff view on save** (stretch goal): Before saving, show a side-by-side or inline diff (red/green lines) in a modal. Confirm to save. This prevents accidental config damage.
- **Line error markers:** When YAML parse fails, highlight the error line with a red left-gutter marker and red underline, not just an alert box above.

### 3.4 Scheduler

#### Job Index Table
- Current: Mantine Table with Badge components
- Transform: Custom styled table with:
  - **Status column:** Replace text badges with animated indicator dots. Idle = dim gray pulse. Running = blue sweep animation. Error = red steady glow. Disabled = no dot.
  - **Cron column:** Show the cron expression in JetBrains Mono, with the human-readable label below in IBM Plex Sans 12px muted.
  - **Last run column:** Relative time ("3m ago") with a green/red dot. On hover, tooltip shows full ISO timestamp.
  - **Run Now button:** Compact, icon-only (`IconPlayerPlay`). On click, button morphs into a spinner. On completion, morphs into a check or X (stays for 2s then reverts). No page reload needed.
  - **Frequency bands:** Render as collapsible sections with the band name as a header chip (e.g., "EVERY 10 MIN" in a small rounded badge)

#### Job Detail
- Layout: Two-column on desktop. Left: metadata (name, module, schedule, dependencies, window). Right: execution status + history.
- **Execution history:** Mini timeline visualization. Each run is a dot on a horizontal timeline. Green = success, red = fail. Hover a dot to see duration + timestamp. Click to expand error details.
- **Dependency visualization:** If job has dependencies, show them as small connected badges (job A → job B → this job). Not a full graph — just a linear chain.

### 3.5 Household Members

#### Members Index
- Current: standard Mantine Table
- Transform: Card list (not table). Each member card:
  - Avatar placeholder (colored circle with initials, seeded by username)
  - Display name (IBM Plex Sans 500, 15px)
  - Username below in JetBrains Mono 400, 12px, muted
  - Type/Group badges (right-aligned)
  - "Head" crown icon if head of household
  - Hover: slight lift (translateY -2px) + shadow
  - Click navigates to editor

#### Member Editor
- Current: Tabs component with flat form fields
- Transform: **Vertical tabs** on the left (200px rail) with the tab content on the right. This avoids the "all tabs look the same" problem:
  - Tab rail: same styling as the main sidebar nav (consistency). Active tab has accent left border.
  - Each tab panel: starts with a section title + brief description of what this tab controls
  - **Identity tab:** Two-column grid for text fields. Avatar preview at top-right with upload capability.
  - **Nutribot tab:** Visual macro breakdown — small donut chart or stacked bar showing the configured macro split. Fields below for editing.
  - **Fitness tab:** Zone overrides displayed as a horizontal colored bar (each zone as a segment) with number inputs below.

### 3.6 Devices

#### Device Index
- Current: SimpleGrid of minimal cards
- Transform: Each card shows:
  - Device icon (different per type: TV icon, monitor icon, music keyboard icon)
  - Device name (JetBrains Mono 500, 14px — device IDs are technical identifiers)
  - Type badge
  - **Status indicator:** Small dot showing online/offline if we can determine it (stretch goal via HA integration)
  - **Display count:** "2 displays" chip
  - Card border: subtle accent-colored left bar based on device type (blue for shield-tv, green for linux-pc, purple for midi)

#### Device Editor
- Current: Conditional rendering based on type, generic ObjectFields
- Transform: Purpose-built section layouts per device type:
  - **Display control:** Visual representation — a small rectangle labeled "Display 1", "Display 2" with on/off toggle and script fields below each. Not a flat form — a spatial layout that mirrors the physical setup.
  - **Module hooks:** Table with clear on_open / on_close columns. JetBrains Mono for HA entity IDs.

### 3.7 Integrations

#### Index
- Current: SimpleGrid cards with status badges
- Transform: Dashboard-style grid with health indicators:
  - Each card: Provider icon (use real logos where possible or styled initials), provider name, URL (truncated with monospace font), last health check timestamp
  - **Health indicator:** Full-width bar at top of each card. Green = healthy, red = unreachable, gray = not configured, amber = degraded. Animated gradient sweep on the bar for visual interest.
  - Category grouping: horizontal rule with centered category label

#### Detail
- **Test Connection button:** When clicked, show a real-time connection test visualization:
  1. Button becomes a progress indicator
  2. Show "Connecting..." with an animated dot trail
  3. On success: green checkmark animation (Lottie or CSS), response time displayed
  4. On failure: red X with error message expanding below
- **Auth status section:** Use a lock/unlock icon. Configured = closed lock, green. Missing = open lock, amber, with instructional text about where to configure.

### 3.8 App Config Forms

#### AppConfigEditor Wrapper
- Current: Badge + Save/Revert buttons
- Transform: **Sticky action bar** at top of the form area. When user scrolls down on a long form, the action bar stays visible (position: sticky, top: 0) with a subtle shadow indicating it's floating. Contains:
  - App name + icon
  - Dirty indicator (amber dot that pulses once on change)
  - Revert button (subtle)
  - Save button (accent, prominent)

#### Fitness Config (Accordion)
- Current: Separated Mantine Accordion with icon-labeled items
- Transform: Same structure but with:
  - Accordion headers: JetBrains Mono 500, 12px, uppercase. Right-aligned subtitle showing item count or summary (e.g., "6 zones", "4 playlists")
  - Expanded content: fades in over 150ms with slight slide-down (12px)
  - **Zone editor:** Instead of just a CrudTable, show a horizontal bar visualization of the zones (like a thermometer) with colors from the config. Below: the editable fields. The bar updates live as you edit.
  - **Device mappings:** Use a visual mapping — device badge on left → arrow → user badge on right. More intuitive than a flat table.

---

## 4. Interaction Patterns

### 4.1 Toast Notifications

Add a notification system (Mantine's `notifications` or custom):

- **Save success:** Green toast, bottom-right, auto-dismiss 3s. "Changes saved" with a checkmark.
- **Save error:** Red toast, persists until dismissed. Error message + "Retry" action button.
- **Destructive action:** Amber toast confirming deletion: "Job 'weather' deleted. Undo?" with a 5-second undo window.
- **Connection test:** Toast shows test result inline.

### 4.2 Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Cmd+S` / `Ctrl+S` | Save current form | Any config page with dirty state |
| `Cmd+Z` / `Ctrl+Z` | Revert (undo all changes) | Any config page with dirty state |
| `Escape` | Close modal/drawer | Any open modal |
| `/` | Focus search | Content Lists (when no input focused) |
| `?` | Show shortcuts cheatsheet | Global |

Implementation: `useHotkeys` from Mantine hooks or a lightweight custom hook.

### 4.3 Loading States

Replace the single centered `<Loader>` with contextual skeletons:

- **Table loading:** Render 5-8 skeleton rows with shimmer animation matching the column widths
- **Card grid loading:** Render 4-6 skeleton cards in the grid layout
- **Form loading:** Render skeleton inputs matching the form structure
- **Inline operations:** Button spinners for save/trigger actions (already present in some places, extend everywhere)

### 4.4 Optimistic Updates

For operations where the result is predictable (toggle active, reorder items, delete):
1. Apply the change to local state immediately
2. Send the API request in the background
3. On failure, roll back local state and show error toast

This eliminates the flash of loading state for fast operations.

### 4.5 Transition Animations

Page-level transitions when navigating between routes:

- **Forward navigation** (index → detail): Content slides left + fades in (150ms)
- **Back navigation** (detail → index): Content slides right + fades in (150ms)
- Use `framer-motion`'s `AnimatePresence` with `motion.div` wrapper around route `<Outlet>` — or CSS-only with View Transitions API if browser support is acceptable.

### 4.6 Focus Management

- Modal open: focus first interactive element
- Modal close: return focus to trigger button
- Form save: if errors, focus first field with error
- Table row operations: after delete, focus next row; after add, focus first input in new row
- Keyboard navigation in tables: arrow keys to move between rows when no input is focused

---

## 5. Architecture Improvements

### 5.1 Break Up ListsItemRow (2350 Lines)

Split into focused sub-components:

```
ListsItemRow.jsx (200 lines — orchestration only)
├── ItemDragHandle.jsx
├── ItemAvatar.jsx (shimmer + lazy load + image picker)
├── ItemLabel.jsx (inline editing)
├── ItemActionChip.jsx (action selector)
├── ItemContentInput.jsx (ContentSearchCombobox integration)
├── ItemProgressBar.jsx (watchlist-only)
├── ItemConfigBadges.jsx (ConfigIndicators)
├── ItemContextMenu.jsx (right-click / dots menu)
└── ItemDetailsDrawer.jsx (side panel)
```

Each sub-component receives only the props it needs. The parent `ListsItemRow` manages state and passes handlers down. This:
- Reduces re-renders (React.memo on leaf components)
- Makes each piece independently testable
- Brings each file under 300 lines

### 5.2 Extract Shared Utilities

Create `frontend/src/modules/Admin/utils/`:

```
utils/
├── formatters.js      — formatDuration, formatSize, formatDate, formatRelativeTime, cronToHuman
├── constants.js       — DEVICE_TYPES, MEMBER_TYPES, CATEGORY_LABELS, CATEGORY_ORDER, CONTAINER_TYPES
├── badges.js          — typeBadgeColor, statusBadgeColor, frequencyBand helpers
├── capitalize.js      — capitalize, kebabToTitle, pluralize
└── validation.js      — validateUsername, validateCron, validateYaml (with mark extraction)
```

### 5.3 Form Validation Layer

Create a lightweight validation hook:

```jsx
const { errors, validate, clearError } = useFormValidation({
  username: [required(), pattern(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only')],
  birthyear: [optional(), range(1900, 2025)],
  'apps.nutribot.goals.calories_min': [optional(), min(0)],
});

// In form:
<TextInput error={errors.username} ... />
```

This replaces the ad-hoc validation scattered across components.

### 5.4 Custom Mantine Theme

Replace the two-line theme in `AdminApp.jsx` with a comprehensive theme object:

```jsx
const theme = createTheme({
  primaryColor: 'ds-blue',
  fontFamily: '"IBM Plex Sans", sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", monospace',
  headings: {
    fontFamily: '"JetBrains Mono", monospace',
    fontWeight: '600',
  },
  colors: {
    'ds-blue': [/* 10-shade custom blue scale */],
    'ds-green': [/* success scale */],
    'ds-red': [/* danger scale */],
    'ds-amber': [/* warning scale */],
  },
  components: {
    Button: { defaultProps: { radius: 'sm' } },
    Paper: { defaultProps: { radius: 'md', p: 'lg' } },
    TextInput: { defaultProps: { radius: 'sm' } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' } },
    Table: {
      styles: {
        table: { fontFamily: '"IBM Plex Sans", sans-serif' },
        th: { fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' },
      },
    },
  },
  other: {
    // Custom DS tokens accessible via theme.other
    transitionSpeed: '150ms',
    borderRadius: { card: '8px', button: '6px', input: '6px' },
  },
});
```

### 5.5 Notification Provider

Wrap the app with Mantine's `Notifications` provider:

```jsx
// AdminApp.jsx
import { Notifications } from '@mantine/notifications';

<MantineProvider theme={theme}>
  <Notifications position="bottom-right" />
  <div className="App admin-app">
    <Routes>...</Routes>
  </div>
</MantineProvider>
```

Then in hooks, fire notifications on save/error:

```jsx
import { notifications } from '@mantine/notifications';

// In useAdminConfig.save():
notifications.show({
  title: 'Saved',
  message: `${filePath} updated successfully`,
  color: 'green',
  autoClose: 3000,
});
```

---

## 6. Accessibility Remediation

| Area | Current | Required |
|------|---------|----------|
| Focus rings | None visible | All interactive elements get visible focus ring on keyboard navigation (`:focus-visible`) |
| ARIA labels | Missing everywhere | All icon-only buttons need `aria-label`. Tables need proper `role` attributes. |
| Reduced motion | Not supported | Wrap animations in `@media (prefers-reduced-motion: reduce)` — disable transforms, reduce durations to 0ms |
| Color contrast | Muted text on dark bg may fail WCAG AA | Verify all text colors meet 4.5:1 ratio against their backgrounds |
| Screen reader | Drag-and-drop not announced | Add `aria-live` regions for reorder operations. Use dnd-kit's built-in announcements. |
| Keyboard nav | Tables not navigable | Add `tabIndex={0}` to table rows. Arrow key navigation between rows. Enter to activate. |

---

## 7. Implementation Phases

### Phase A: Foundation (Theme + Layout + Notifications)

Highest visual impact for lowest effort. Changes the entire feel of the app.

1. Add Google Fonts to `index.html`
2. Create comprehensive Mantine theme in `AdminApp.jsx`
3. Create `Admin.variables.scss` with custom CSS properties (palette, spacing)
4. Restyle `AdminLayout.jsx` sidebar + header
5. Add `@mantine/notifications` provider
6. Wire toast notifications into `useAdminConfig.save()` and `useAdminConfig.revert()`

**Estimated file changes:** 4-6 files
**Visual impact:** Transforms the entire app immediately

### Phase B: Component Polish (Tables + Cards + Forms)

1. Restyle table rows (height, hover states, alternating backgrounds)
2. Restyle cards (member cards, device cards, integration cards)
3. Add contextual skeleton loaders
4. Add entry/exit animations to modals and dropdowns
5. Restyle form inputs (consistent border radius, focus states)
6. Add sticky action bar to config forms

**Estimated file changes:** 10-15 files
**Visual impact:** Every page feels polished

### Phase C: Interaction Quality

1. Add keyboard shortcuts (Cmd+S, Cmd+Z, Escape, /)
2. Add optimistic updates to `useAdminLists` (toggle, reorder, delete)
3. Add page transition animations
4. Improve empty states with illustrations/icons + CTAs
5. Add undo-on-delete toasts with 5s window

**Estimated file changes:** 8-12 files
**Interaction impact:** App feels responsive and professional

### Phase D: Architecture Cleanup

1. Break up `ListsItemRow.jsx` into sub-components
2. Extract shared utilities to `utils/`
3. Create `useFormValidation` hook
4. Add inline form validation to all editors
5. Add data-testid attributes per PRD Section 11.5

**Estimated file changes:** 15-20 files
**Maintenance impact:** Codebase becomes sustainable

### Phase E: Accessibility

1. Add ARIA labels to all interactive elements
2. Add keyboard navigation to tables
3. Add reduced-motion media queries
4. Verify color contrast ratios
5. Add focus management to modals and forms
6. Test with VoiceOver/NVDA

**Estimated file changes:** 20+ files (small changes each)
**Compliance impact:** WCAG AA baseline

---

## 8. Files Inventory

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/modules/Admin/Admin.variables.scss` | CSS custom properties for DS palette, spacing, typography |
| `frontend/src/modules/Admin/utils/formatters.js` | Shared formatting utilities |
| `frontend/src/modules/Admin/utils/constants.js` | Shared constants and enums |
| `frontend/src/modules/Admin/utils/badges.js` | Badge color/variant helpers |
| `frontend/src/modules/Admin/utils/validation.js` | Form validation rules |
| `frontend/src/hooks/admin/useFormValidation.js` | Validation hook |
| `frontend/src/modules/Admin/ContentLists/ItemDragHandle.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemAvatar.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemLabel.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemActionChip.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemContentInput.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemContextMenu.jsx` | Extracted from ListsItemRow |
| `frontend/src/modules/Admin/ContentLists/ItemDetailsDrawer.jsx` | Extracted from ListsItemRow |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/Apps/AdminApp.jsx` | Comprehensive theme, notifications provider, font imports |
| `frontend/src/Apps/AdminApp.scss` | Custom property imports, base app styling |
| `frontend/src/modules/Admin/Admin.scss` | Complete restyle of sidebar, header, main content |
| `frontend/src/modules/Admin/AdminLayout.jsx` | Sidebar width, brand mark, content area styling |
| `frontend/src/modules/Admin/AdminHeader.jsx` | Breadcrumb restyle, status indicator |
| `frontend/src/modules/Admin/AdminNav.jsx` | Active states, section label styling, icon treatment |
| `frontend/src/modules/Admin/ContentLists/ContentLists.scss` | Row height, hover states, section headers, empty states |
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Break into sub-components (dramatic reduction) |
| `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` | Skeleton loading, animation |
| `frontend/src/modules/Admin/ContentLists/ListsIndex.jsx` | Card restyle, empty state |
| `frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx` | Status dots, frequency bands, Run Now animation |
| `frontend/src/modules/Admin/Scheduler/JobDetail.jsx` | Two-column layout, execution timeline |
| `frontend/src/modules/Admin/Household/MembersIndex.jsx` | Card layout, avatar, badges |
| `frontend/src/modules/Admin/Household/MemberEditor.jsx` | Vertical tabs, section descriptions |
| `frontend/src/modules/Admin/Household/DevicesIndex.jsx` | Type-colored cards, display count |
| `frontend/src/modules/Admin/Household/DeviceEditor.jsx` | Purpose-built display sections |
| `frontend/src/modules/Admin/System/IntegrationsIndex.jsx` | Health indicator bars, dashboard layout |
| `frontend/src/modules/Admin/System/IntegrationDetail.jsx` | Connection test visualization |
| `frontend/src/modules/Admin/Config/ConfigIndex.jsx` | Tree view, file metadata |
| `frontend/src/modules/Admin/Config/ConfigFileEditor.jsx` | Custom CodeMirror theme, error line markers |
| `frontend/src/modules/Admin/Apps/AppConfigEditor.jsx` | Sticky action bar |
| `frontend/src/modules/Admin/Apps/FitnessConfig.jsx` | Zone visualization, device mapping arrows |
| `frontend/src/modules/Admin/shared/CrudTable.jsx` | Restyle rows, add keyboard nav |
| `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx` | Sticky bar, toast on save |
| `frontend/src/modules/Admin/shared/YamlEditor.jsx` | Custom CodeMirror theme, line error markers |
| `frontend/src/modules/Admin/shared/ConfirmModal.jsx` | Entry animation, focus management |
| `frontend/src/modules/Admin/shared/TagInput.jsx` | Restyle badges, keyboard handling |
| `frontend/src/hooks/admin/useAdminConfig.js` | Toast notifications on save/error |
| `frontend/src/hooks/admin/useAdminLists.js` | Optimistic updates for toggle/reorder/delete |
| `index.html` | Google Fonts preconnect + stylesheet |

---

## 9. Metrics of Success

After transformation, the admin interface should:

1. **Pass the "screenshot test"** — A screenshot should look professionally designed, not like a template
2. **Feel immediate** — Common operations (toggle, reorder, save) complete in <100ms perceived time
3. **Guide the user** — Visual hierarchy makes it obvious what to do next on every page
4. **Reward exploration** — Animations and transitions make navigation feel satisfying
5. **Support power users** — Keyboard shortcuts, dense information display, no unnecessary modals
6. **Be maintainable** — No component over 400 lines, shared utilities, consistent patterns
7. **Be accessible** — Navigable by keyboard, usable with screen readers, respects motion preferences
