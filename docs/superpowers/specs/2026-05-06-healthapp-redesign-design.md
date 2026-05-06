# HealthApp Visual Redesign — Design

**Date:** 2026-05-06
**Status:** Brainstorm — review before plan
**Author thread:** conversation 2026-05-06 after live testing showed the deployed HealthApp UI was generic Mantine-default and the chat surface was tab-hidden. User picked direction B (data-forward dashboard) plus a prominent AI widget. Visual mock approved.

**Related:**
- [docs/superpowers/specs/2026-05-06-coachchat-polish-design.md](2026-05-06-coachchat-polish-design.md) — sibling spec (mentions/all fanout + streaming + markdown). Will execute in the same implementation plan.
- [docs/superpowers/specs/2026-05-05-health-coach-chat-design.md](2026-05-05-health-coach-chat-design.md) — original CoachChat module
- `frontend/src/Apps/HealthApp.jsx` — current 100-line wrapper
- `frontend/src/modules/Health/HealthHub` — current dashboard cards
- `frontend/src/modules/Health/CoachChat` — chat module (gets dark-theme restyle)

---

## Why this exists

`HealthApp.jsx` today is generic Mantine: outline tabs, two grey skeleton blocks for loading, no header, no spacing, no visual hierarchy at the page level. The Coach tab is hidden — the user has to know to click into it. Every other DaylightStation app has more thoughtful chrome.

User feedback during live testing: "ugly af." Fair.

This redesign applies coherent visual language across the full HealthApp surface — Tabs/chrome + HealthHub + HealthDetail + CoachChat — with the Coach surface promoted from a hidden tab to a persistent always-reachable ask bar. The visual direction is data-forward dashboard (dense metric cards, mini-charts, dark theme) with an AI-prominent overlay (chat slides up over the dashboard on demand).

---

## Visual direction (locked in)

**Dark theme + data-forward dashboard + AI-overlay pattern.**

- **Theme**: dark mode by default. Light-mode toggle deferred — no use case yet.
- **Layout structure**: no tabs. Hub IS the page. Chat is an overlay launched from a persistent bar.
- **Ask bar**: persistent at the bottom of the viewport. Gradient `✦` avatar, "Ask your coach…" placeholder, ⌘K shortcut, `@`-mention hint inline.
- **Chat surface**: when activated (click bar, ⌘K, or focus), an overlay slides up from the bottom over the dashboard. Dashboard behind fades to ~25% opacity. Esc or scroll-down dismisses. Last message stays in scrollback when re-opened.
- **Hero metric cards**: 3-column row at the top of Hub — Weight (with sparkline), Workouts, Calories. Each card is dense: big number + unit, trend indicator, secondary stat.
- **Coach attribution**: tool calls render inline in chat as compact pills with the `✦ used metric_trajectory · 9ms` shape — small, low-contrast, glanceable.

The mock at the visual companion (selected by the user) is the canonical reference. This spec doesn't reproduce its pixel positions — it captures the structural decisions and component decomposition.

---

## Design tokens

### Color palette (Mantine theme override)

Extend Mantine's theme with a `dark` colorScheme override in `MantineProvider`:

```javascript
// frontend/src/Apps/HealthApp.jsx (or shared theme file)
const healthTheme = {
  colorScheme: 'dark',
  colors: {
    // Reuse Mantine's defaults but pin specific tokens for our chrome
    background: ['#0f1419'],          // page background
    surface:    ['#1c2229'],          // card / surface background
    surfaceAlt: ['#0a0e12'],          // ask-bar / footer background
    border:     ['#2d3743'],          // hairline borders
    textHigh:   ['#e8eef3'],          // primary text
    textMid:    ['#94a3b8'],          // secondary text
    textLow:    ['#6b7785'],          // tertiary / metadata text
  },
  primaryColor: 'blue',                // for accents (down trends, active states)
  // Custom 'ai' gradient used for the AskBar avatar + tool attributions:
  // linear-gradient(135deg, #2563eb 0%, #10b981 100%)
};
```

Trend / status colors:
- **Down (good for weight)**: `#10b981` (emerald)
- **Up (bad for weight)**: `#ef4444` (red — used sparingly)
- **Stable / neutral**: `#94a3b8` (slate)
- **Status dot live**: `#10b981` with subtle pulse animation

### Spacing / radii / typography

- **Card radius**: `10px` (interior), `14px` (page-level container)
- **Card padding**: `16px` (interior), `12-14px` (compact rows)
- **Border**: `1px solid #2d3743` for hairlines; `1px solid #1c2229` for low-contrast section dividers
- **Typography**: Mantine default sans (system font stack). Numbers use `font-feature-settings: 'tnum'` for tabular alignment in metric cards.
- **Hero number size**: `36px / 700 weight / line-height 1.1`
- **Metric label size**: `10px uppercase tracking 0.08em color textMid`
- **Chat message size**: `13px line-height 1.6 color textHigh`

### The `✦` AI mark

A consistent visual signature for AI-driven elements. Used at three sizes:

- **24px** — AskBar avatar, ChatOverlay header avatar
- **16px** — Tool-call attribution row inline in chat
- **12px** — Inline citation marks (deferred — not in v1)

Implementation: a small SVG or unicode glyph (`✦` U+2726) rendered inside a circular gradient background:

```css
.ai-mark {
  width: 24px; height: 24px;
  background: linear-gradient(135deg, #2563eb, #10b981);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 12px;
}
```

---

## Component decomposition

### File structure

```
frontend/src/Apps/HealthApp.jsx                   — restructured (no tabs)
frontend/src/Apps/HealthApp.scss                  — page-level layout

frontend/src/modules/Health/AskBar/                NEW
  index.jsx                                        — persistent bottom ask bar
  AskBar.scss
  AskBar.test.jsx

frontend/src/modules/Health/ChatOverlay/           NEW
  index.jsx                                        — slide-up chat overlay over Hub
  ChatOverlay.scss
  ChatOverlay.test.jsx

frontend/src/modules/Health/AiMark/                NEW
  index.jsx                                        — the ✦ gradient mark, three sizes
  AiMark.scss

frontend/src/modules/Health/HealthHub/             MODIFIED
  index.jsx                                        — refactored layout: hero row + cards
  HealthHub.scss                                   — dark theme styling
  HealthHub.test.jsx                               — extend tests

frontend/src/modules/Health/cards/                 MODIFIED (existing dir)
  WeightCard.jsx                                   — hero card with sparkline (NEW or refactor)
  WorkoutsCard.jsx                                 — hero card (NEW or refactor)
  CaloriesCard.jsx                                 — hero card (NEW or refactor)
  // Existing detail cards keep working

frontend/src/modules/Health/CoachChat/             MODIFIED
  index.jsx                                        — dark-theme bubbles, ✦ mark in messages
  CoachChat.scss                                   — dark theme overrides for assistant-ui
  MarkdownText.jsx                                 — dark-mode markdown styles (built in polish-spec)
```

### `<HealthApp />` — restructured

```jsx
function HealthApp() {
  const userId = useResolvedUserId();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [detailType, setDetailType] = useState(null);

  // Dashboard data fetch unchanged
  const { dashboard, loading } = useHealthDashboard();

  // Cmd-K listener focuses ask bar
  useHotkey('mod+k', () => setOverlayOpen(true));

  return (
    <MantineProvider theme={healthTheme} defaultColorScheme="dark">
      <div className="health-app">
        <HealthAppHeader userId={userId} />
        {detailType
          ? <HealthDetail type={detailType} dashboard={dashboard} onBack={() => setDetailType(null)} />
          : <HealthHub dashboard={dashboard} loading={loading} onCardClick={setDetailType} />
        }
        <AskBar onActivate={() => setOverlayOpen(true)} />
        <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId} />
      </div>
    </MantineProvider>
  );
}
```

**No tabs.** Hub is the page. Detail replaces Hub when a card is clicked. Ask bar persists across both views. Chat overlay is mounted globally — its `open` state controls visibility.

### `<HealthAppHeader />` — small status strip

A thin top strip showing user identity, sync status, date.

```jsx
function HealthAppHeader({ userId }) {
  return (
    <header className="health-app__header">
      <div className="health-app__header-left">
        <span className="health-app__status-dot" />
        <span className="health-app__status-text">Health · synced 2m ago · {userId}</span>
      </div>
      <div className="health-app__header-right">{formatToday()}</div>
    </header>
  );
}
```

The "synced 2m ago" comes from the dashboard fetch timestamp. The status dot uses a small pulse keyframe.

### `<HealthHub />` — refactored

Replaces the existing card-grid with a structured hero + secondary layout:

```jsx
function HealthHub({ dashboard, loading, onCardClick }) {
  if (loading) return <HealthHubSkeleton />;

  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <WeightCard data={dashboard.weight} onClick={() => onCardClick('weight')} />
        <WorkoutsCard data={dashboard.workouts} onClick={() => onCardClick('workouts')} />
        <CaloriesCard data={dashboard.nutrition} onClick={() => onCardClick('nutrition')} />
      </section>

      <section className="health-hub__secondary">
        {/* existing detail cards (water, sleep, etc.) flow here in a denser grid */}
        {dashboard.cards?.map(card => <DetailCard key={card.type} data={card} onClick={() => onCardClick(card.type)} />)}
      </section>
    </main>
  );
}
```

**Hero card pattern** (each of WeightCard, WorkoutsCard, CaloriesCard):

```jsx
function WeightCard({ data, onClick }) {
  return (
    <button className="metric-card metric-card--hero" onClick={onClick}>
      <div className="metric-card__label">WEIGHT</div>
      <div className="metric-card__value">
        {data.current.lbs.toFixed(1)} <span className="metric-card__unit">lbs</span>
      </div>
      <div className={`metric-card__trend metric-card__trend--${data.trend.direction}`}>
        {trendArrow(data.trend.direction)} {Math.abs(data.trend.slopePerWeek).toFixed(2)} lbs/wk
        <span className="metric-card__trend-period">· last 30d</span>
      </div>
      <Sparkline points={data.history.map(d => d.lbs)} />
    </button>
  );
}
```

The `Sparkline` component takes a `number[]` and renders a small inline SVG bar chart (~28px tall, full card width). Implementation is ~30 lines of pure SVG, no new dep.

### `<HealthHubSkeleton />` — loading state

Replaces the two grey blocks. Mirrors the actual hero + secondary layout with shimmer placeholders:

```jsx
function HealthHubSkeleton() {
  return (
    <main className="health-hub">
      <section className="health-hub__hero">
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
        <Skeleton height={140} radius="md" />
      </section>
      <section className="health-hub__secondary">
        <Skeleton height={100} radius="md" />
        <Skeleton height={100} radius="md" />
      </section>
    </main>
  );
}
```

### `<AskBar />` — persistent bottom widget

Always mounted; lives at `position: sticky` (or `fixed`) at the bottom of the viewport.

```jsx
function AskBar({ onActivate }) {
  return (
    <div className="ask-bar" role="button" tabIndex={0} onClick={onActivate}>
      <AiMark size={24} />
      <span className="ask-bar__placeholder">
        Ask your coach… <span className="ask-bar__hint">type @ to mention a period or workout</span>
      </span>
      <kbd className="ask-bar__shortcut">⌘K</kbd>
    </div>
  );
}
```

Click anywhere on the bar → `onActivate()` opens the chat overlay. The placeholder is for visual fidelity only — the actual input lives in the overlay (so we don't double-state).

Keyboard:
- `⌘K` / `Ctrl+K` from anywhere → opens overlay (handled at `<HealthApp />` level via `useHotkey`)
- `Tab` to focus the bar, then `Enter` / `Space` → opens overlay

### `<ChatOverlay />` — slide-up chat surface

Wraps `<CoachChat />` with overlay chrome:

```jsx
function ChatOverlay({ open, onClose, userId }) {
  // Trap focus when open; Esc closes; preserve scroll/state across opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`chat-overlay ${open ? 'chat-overlay--open' : ''}`}
      aria-hidden={!open}
    >
      <div className="chat-overlay__scrim" onClick={onClose} />
      <div className="chat-overlay__panel" role="dialog" aria-modal="true">
        <header className="chat-overlay__header">
          <AiMark size={24} />
          <span className="chat-overlay__title">Health Coach</span>
          <span className="chat-overlay__user">· {userId}</span>
          <button className="chat-overlay__close" onClick={onClose}>Esc to dismiss</button>
        </header>
        <div className="chat-overlay__body">
          <CoachChat userId={userId} variant="overlay" />
        </div>
      </div>
    </div>
  );
}
```

**Animation**: CSS transform on `.chat-overlay__panel` — `translateY(100%)` when closed, `translateY(0)` when open. Transition `~200ms ease-out`. Scrim fades from `0 → 0.6 alpha`. No JS animation lib needed.

**Persistence**: The overlay is mounted ALWAYS (just hidden via `transform`). `<CoachChat />` keeps its message state across opens. New conversation = explicit "New chat" button (deferred — for v1, conversation persists for the session).

**Scroll behavior**: When closed, dashboard is scrollable normally. When open, dashboard scroll locked (`body { overflow: hidden }` while overlay open).

### `<CoachChat />` — dark-theme restyle (variant prop)

The existing CoachChat component lives at `frontend/src/modules/Health/CoachChat/`. We pass a `variant="overlay"` prop that switches its CSS to dark-theme styling. Light-theme styles stay (in case CoachChat is ever embedded elsewhere).

Specific changes inside `CoachChat.scss`:

```scss
.coach-chat--overlay {
  background: var(--mantine-color-background-0);
  color: var(--mantine-color-textHigh-0);

  // Assistant-ui CSS variable bridge — re-pin for dark theme
  --aui-primary: #2563eb;
  --aui-primary-foreground: #fff;
  --aui-background: var(--mantine-color-background-0);
  --aui-foreground: var(--mantine-color-textHigh-0);
  --aui-muted: var(--mantine-color-surface-0);
  --aui-muted-foreground: var(--mantine-color-textMid-0);
  --aui-border: var(--mantine-color-border-0);

  // User message bubbles: surfaceAlt with subtle border
  .coach-chat__message--user [data-message-part-text] {
    background: var(--mantine-color-surface-0);
    color: var(--mantine-color-textHigh-0);
    border-radius: 14px;
    padding: 10px 14px;
    max-width: 70%;
    margin-left: auto;
  }

  // Assistant messages: no bubble, just inline text with markdown
  .coach-chat__message--assistant {
    color: var(--mantine-color-textHigh-0);
    line-height: 1.6;
    max-width: 90%;
  }
}
```

### `<ToolCallAttribution />` — inline `✦ used X · Yms` pill

Rendered when an assistant message has tool-call metadata. Compact, low-contrast, expand-on-click for full args/result:

```jsx
function ToolCallAttribution({ toolCalls }) {
  if (!toolCalls?.length) return null;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-call-attribution">
      {toolCalls.map((tc, i) => (
        <button
          key={i}
          className="tool-call-attribution__row"
          onClick={() => setExpanded(e => !e)}
        >
          <AiMark size={16} />
          <span>used <code>{tc.toolName}</code> · {tc.latencyMs}ms</span>
        </button>
      ))}
      {expanded && (
        <pre className="tool-call-attribution__details">
          {JSON.stringify(toolCalls, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

For streaming (per the polish-spec sibling), the row is rendered while a tool is mid-flight with a "running…" spinner; on `tool-end`, swaps to the static "used X · Yms" form.

---

## Data flow

The redesign is purely visual and structural. **No new backend endpoints. No agent changes. No tool changes.**

The data the redesigned components need is what `useHealthDashboard()` already returns:

```typescript
type DashboardData = {
  weight: {
    current: { lbs: number, fatPercent?: number, date: string };
    trend: { direction: 'up'|'down'|'flat', slopePerWeek: number };
    history: Array<{ date: string, lbs: number }>;  // for sparkline
  };
  workouts: {
    weekCount: number;
    breakdown: Array<{ type: string, count: number }>;
  };
  nutrition: {
    avg: { calories: number, protein: number, ... };
    today?: { calories: number, ... };
  };
  cards: Array<{ type: string, ... }>;  // existing detail cards
};
```

If `dashboard.weight.history` doesn't already include enough points for a sparkline, the implementation plan adds it to the `/api/v1/health/dashboard` response. Otherwise we use what's there.

---

## Animation / interaction details

**Overlay open/close:**
- `translateY` transition `200ms ease-out` on the panel
- Scrim alpha transition `200ms ease-out` (`0 → 0.6`)
- Body scroll lock while open
- Initial focus: chat composer input
- Esc → close
- Click on scrim → close
- Click on dashboard area visible behind overlay → close (same as scrim)

**AskBar focus / activation:**
- `⌘K` / `Ctrl+K` global → opens overlay
- Tab to focus → enter/space → opens overlay
- Click anywhere on the bar → opens overlay

**Sparkline:**
- Static SVG. No animation in v1 (sparklines re-render when data updates).

**Status dot pulse:**
- 2s ease-in-out alpha pulse `0.5 → 1.0 → 0.5`. Pure CSS keyframe, no JS.

**Tool-call attribution expand:**
- Height auto-grow `150ms ease-out`. CSS `transition: max-height` with sufficient max value.

---

## Loading + error states

- **Initial dashboard fetch**: HealthHubSkeleton renders (3 hero placeholders + secondary placeholders).
- **Dashboard fetch error**: top-of-page error banner with "retry" button. Existing error-handling in `useHealthDashboard` keeps working.
- **Chat overlay before first message**: empty state with 3 suggested starter prompts:
  - "What's my weight trend?"
  - "How's my tracking density?"
  - "Compare last 30 days to my last cut"
  Each starter is a clickable chip that pre-fills the composer. Defer if scope tight.

---

## Accessibility

- All metric cards have `role="button"`, accessible name from label + value, `tabIndex={0}` for keyboard navigation.
- AskBar has `role="button"` and `aria-label="Ask the health coach"`.
- ChatOverlay uses `role="dialog"` with `aria-modal="true"` while open. Focus trap within the overlay (focus moves to composer on open; Tab cycles within).
- Status dot pulse respects `prefers-reduced-motion: reduce` (animation disabled).
- Color contrast: dark theme palette tested at WCAG AA for text/background combos. The trend colors (`#10b981` green / `#ef4444` red) on `#1c2229` surface meet 4.5:1.

---

## Testing strategy

Component tests (vitest + `@testing-library/react`):

- `HealthApp` — renders header + Hub + AskBar + ChatOverlay. Click ⌘K opens overlay. Esc closes overlay.
- `HealthAppHeader` — renders userId and sync status; status dot present.
- `HealthHub` — renders 3 hero cards from dashboard data; click on a hero card invokes `onCardClick(type)`.
- `HealthHubSkeleton` — renders when loading; same column count as the loaded version.
- `WeightCard` — renders current + trend + sparkline. Trend arrow + color match direction.
- `Sparkline` — renders SVG with correct number of bars. Empty array renders empty SVG (no crash).
- `AskBar` — renders ✦ + placeholder + ⌘K hint. Click invokes `onActivate`.
- `ChatOverlay` — closed state has `aria-hidden="true"`. Open state has focus trapped. Esc closes.
- `AiMark` — renders at all three sizes; uses gradient background.
- `ToolCallAttribution` — renders one row per tool call. Click expands details.

End-to-end (Playwright, optional for v1):
- Load HealthApp → see Hub. Click WeightCard → Detail loads. Back → Hub. Type ⌘K → overlay opens. Type "test" → submit. Esc → overlay closes.

---

## Coordination with the polish spec (sibling)

The companion spec [2026-05-06-coachchat-polish-design.md](2026-05-06-coachchat-polish-design.md) covers three CoachChat fixes (mentions/all fanout, SSE streaming, markdown rendering). Those changes touch `CoachChat/index.jsx`, `runtime.js`, `MarkdownText.jsx`, and `CoachChat.scss`.

This redesign also touches `CoachChat.scss` (dark-theme variant) and `index.jsx` (variant prop). They're additive, not conflicting:
- Polish-spec changes the internals of message rendering (markdown, streaming).
- This spec adds dark-theme CSS overrides and overlay variant chrome.

They share an implementation worktree. The combined plan executes both spec's changes in coordinated tasks. When the merge lands, both feature sets ship together.

---

## What this design does NOT include

To keep scope bounded:

- **Light-mode toggle.** Dark-only for v1.
- **Coach observations card on Hub** (the user-flagged defer). The transcript-driven insight surfacing is a worthwhile follow-up but it's a new feature, not a redesign. Defer.
- **Mobile responsive layout beyond Mantine's defaults.** Tablet/desktop is the primary target. Mobile gets best-effort flex/grid wrapping; bespoke mobile UX is a follow-up.
- **Customizable dashboard layout.** Card order is fixed.
- **Animation library** (`framer-motion` etc.). All animations are pure CSS transitions/keyframes. Keeps deps small.
- **Skeleton-driven progressive loading.** First-fetch goes from skeleton → all-cards-at-once. Per-card streaming load order is over-engineered for current request volume.
- **Theme tokens shared across other apps.** The dark-theme tokens defined here scope to HealthApp via `MantineProvider`. Other apps unaffected.
- **Suggested starter prompts in chat overlay empty state.** Listed as "defer if scope tight" above. The implementation plan picks this up if there's room.
- **`✦` icon as a literal SVG asset.** Unicode `U+2726` is used. SVG-ifying for crispness deferred.
- **Settings panel for the AskBar** (toggle keyboard shortcut, etc.). YAGNI.

---

## Open questions for the implementation plan

1. **`useHealthDashboard()` data shape.** The component sketches assume `dashboard.weight.history` is present. If today's `/api/v1/health/dashboard` doesn't include enough history points for a sparkline, the plan adds them. Verify first; small fix either way.
2. **Existing HealthHub card components.** This spec assumes we replace the existing cards with new hero/detail decompositions. If the existing cards are being used elsewhere, the plan handles backwards-compat. Likely they're HealthApp-only.
3. **Suggested-starters in empty chat state.** Three suggested prompts are nice-to-have. Plan includes if no surprises; defers if tasks are stacking up.
4. **Sparkline implementation choice.** Pure SVG is the proposal. Mantine has `<Sparkline>` from `@mantine/charts` that's already installed. Use Mantine's version if its rendering matches the visual mock; fall back to inline SVG otherwise.
5. **Chat overlay above modals.** If anything else in the app spawns a modal while the overlay is open, z-index conflicts may surface. v1 keeps overlay z-index low (50); revisit if conflict.

---

## Why this is the right shape

**The redesign matches the existing architecture, doesn't fight it.** Components decompose along existing module boundaries (Apps + modules + cards). No new infrastructure. The added components (AskBar, ChatOverlay, AiMark, ToolCallAttribution) are small and focused — each <100 lines.

**The AI-prominent pattern matches user intent.** The user immediately reached for the chat after the previous deploy; making it persistent acknowledges that the chat IS the primary surface for them, and the dashboard is supporting context. The dashboard isn't demoted — it's still the default-visible view — but the chat isn't second-class anymore.

**Coordinated with polish spec.** Markdown rendering and streaming wiring (in the polish spec) plug naturally into the dark-theme chat bubbles defined here. Same execution cycle. One deploy.

**Pure CSS animations + Mantine theme.** No new dependencies beyond what the polish spec adds (`react-markdown`, `remark-gfm`). The redesign rides Mantine's existing theming primitives. Cheap to maintain.
