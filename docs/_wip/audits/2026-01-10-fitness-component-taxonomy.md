# Fitness Module Component Taxonomy

**Date:** 2026-01-10  
**Status:** All Phases Complete  
**Scope:** Frontend Fitness module reorganization

---

## Architecture Review Summary

### Key Wins
- **"Slots over Props"** - Replaced complex conditional logic with declarative API
- **Tiered Composition** - Decoupled "where" (Frames) from "what" (Views/Modules)
- **Non-Breaking Migration** - Created Frames first, wrapped existing components

### Applied Recommendations
- ✅ **React.memo** - All sidebar panels wrapped to prevent re-renders from high-frequency context updates
- ✅ **Strict Slot Content** - Frames remain logic-free; visibility decisions live in Views
- 🔲 **CSS Variable Standardization** - Consider moving `$sidebar-width`, `$z-index-overlay` to global theme

---

## Implementation Progress

### ✅ Phase 1: Create Frames (Complete)

Created the following frame components:

| File | Purpose |
|------|---------|
| [frames/FitnessFrame.jsx](../../frontend/src/modules/Fitness/frames/FitnessFrame.jsx) | Base layout with nav + main + overlay slots |
| [frames/FitnessPlayerFrame.jsx](../../frontend/src/modules/Fitness/frames/FitnessPlayerFrame.jsx) | Player layout with content + sidebar + footer + overlay slots |
| [frames/FitnessFrame.scss](../../frontend/src/modules/Fitness/frames/FitnessFrame.scss) | Base frame styles |
| [frames/FitnessPlayerFrame.scss](../../frontend/src/modules/Fitness/frames/FitnessPlayerFrame.scss) | Player frame styles |
| [frames/index.js](../../frontend/src/modules/Fitness/frames/index.js) | Barrel exports |

**FitnessApp.jsx** now uses `FitnessFrame` as its layout shell.

### ✅ Phase 2: Refactor FitnessPlayer to use FitnessPlayerFrame (Complete)

Refactored FitnessPlayer.jsx to use FitnessPlayerFrame:

**Changes:**
- Added import for `FitnessPlayerFrame` from `./frames`
- Extracted sidebar content into `sidebarContent` variable
- Extracted footer into `footerContent` variable  
- Extracted video content into `videoContent` and `mainContent` variables
- Replaced inline JSX layout with `<FitnessPlayerFrame>` component
- Updated FitnessPlayerFrame to support `onRootPointerDownCapture` prop
- Added CSS compatibility rules in FitnessPlayer.scss for frame class names

**Frame Usage:**
```jsx
<FitnessPlayerFrame
  className={playerRootClasses}
  mode={playerMode}
  sidebarSide={sidebarSide}
  sidebarWidth={sidebarRenderWidth}
  sidebar={sidebarContent}
  footer={footerContent}
  contentRef={contentRef}
  mainRef={mainPlayerRef}
  onRootPointerDownCapture={handleRootPointerDownCapture}
>
  {mainContent}
</FitnessPlayerFrame>
```

### ✅ Phase 3: Extract Sidebar Modules (Complete)

Created modular sidebar panel components in `modules/sidebar/`:

| File | Purpose |
|------|---------|
| [modules/sidebar/SidebarCore.jsx](../../frontend/src/modules/Fitness/modules/sidebar/SidebarCore.jsx) | Shell/container for sidebar panels |
| [modules/sidebar/TreasureBoxPanel.jsx](../../frontend/src/modules/Fitness/modules/sidebar/TreasureBoxPanel.jsx) | Gamification rewards display |
| [modules/sidebar/GovernancePanel.jsx](../../frontend/src/modules/Fitness/modules/sidebar/GovernancePanel.jsx) | HR governance status |
| [modules/sidebar/UsersPanel.jsx](../../frontend/src/modules/Fitness/modules/sidebar/UsersPanel.jsx) | Participant avatars/HR monitors |
| [modules/sidebar/MusicPanel.jsx](../../frontend/src/modules/Fitness/modules/sidebar/MusicPanel.jsx) | Audio streaming player |
| [modules/sidebar/VoiceMemoPanel.jsx](../../frontend/src/modules/Fitness/modules/sidebar/VoiceMemoPanel.jsx) | Voice recording trigger |
| [modules/sidebar/panels.scss](../../frontend/src/modules/Fitness/modules/sidebar/panels.scss) | Shared panel styles |
| [modules/sidebar/index.js](../../frontend/src/modules/Fitness/modules/sidebar/index.js) | Barrel exports |

**Composable Usage:**
```jsx
import { SidebarCore, TreasureBoxPanel, GovernancePanel, UsersPanel, MusicPanel, VoiceMemoPanel } from './modules/sidebar';

<SidebarCore mode="player">
  <TreasureBoxPanel onClick={handleToggleChart} />
  <GovernancePanel />
  <UsersPanel onRequestGuestAssignment={handleGuest} />
  <MusicPanel videoPlayerRef={playerRef} />
  <VoiceMemoPanel onToggleMenu={openSettingsMenu} />
</SidebarCore>
```

### ✅ Phase 4: Extract Overlay Modules (Complete)

Created modular overlay components in `modules/overlays/`:

| File | Purpose |
|------|---------|
| [modules/overlays/OverlayPortal.jsx](../../frontend/src/modules/Fitness/modules/overlays/OverlayPortal.jsx) | Portal container with z-index/priority |
| [modules/overlays/VoiceMemoOverlayModule.jsx](../../frontend/src/modules/Fitness/modules/overlays/VoiceMemoOverlayModule.jsx) | Voice recording overlay wrapper |
| [modules/overlays/GovernanceOverlayModule.jsx](../../frontend/src/modules/Fitness/modules/overlays/GovernanceOverlayModule.jsx) | Governance state overlay wrapper |
| [modules/overlays/ChallengeOverlayModule.jsx](../../frontend/src/modules/Fitness/modules/overlays/ChallengeOverlayModule.jsx) | Challenge countdown overlay wrapper |
| [modules/overlays/FullscreenVitalsOverlayModule.jsx](../../frontend/src/modules/Fitness/modules/overlays/FullscreenVitalsOverlayModule.jsx) | Fullscreen vitals display wrapper |
| [modules/overlays/OverlayPortal.scss](../../frontend/src/modules/Fitness/modules/overlays/OverlayPortal.scss) | Portal styles |
| [modules/overlays/index.js](../../frontend/src/modules/Fitness/modules/overlays/index.js) | Barrel exports |

**Composable Usage:**
```jsx
import { 
  OverlayPortal, 
  VoiceMemoOverlayModule, 
  GovernanceOverlayModule, 
  ChallengeOverlayModule 
} from './modules/overlays';

// Overlays with priority-based z-index
<OverlayPortal visible={showGovernance} priority="high">
  <GovernanceOverlayModule overlay={governanceOverlay} />
</OverlayPortal>

<OverlayPortal visible={showChallenge} priority="normal">
  <ChallengeOverlayModule challenge={challengeState} />
</OverlayPortal>

<OverlayPortal visible={showVoiceMemo} priority="critical" backdrop>
  <VoiceMemoOverlayModule overlayState={voiceMemoState} ... />
</OverlayPortal>
```

---

## Current State Analysis

### The Problem

The Fitness module has grown organically with implicit assumptions about component relationships:

1. **Tight coupling**: FitnessPlayer assumes FitnessSidebar; FitnessSidebar assumes FitnessPlayer
2. **Mixed responsibility**: "Views" contain layout logic; "Containers" contain business logic
3. **Unclear boundaries**: Where does VoiceMemoOverlay belong? It appears over Player, Show, and Menu
4. **Monolithic shells**: FitnessPlayer.jsx (1,540 lines) orchestrates everything

### Current Component Inventory

| Component | Lines | Current Role | Coupling |
|-----------|-------|--------------|----------|
| FitnessApp.jsx | 645 | Root orchestrator | Medium |
| FitnessPlayer.jsx | 1,540 | Video shell + sidebar + overlays | **Very High** |
| FitnessShow.jsx | 1,209 | Episode browser | Low |
| FitnessMenu.jsx | 346 | Collection grid | Low |
| FitnessSidebar.jsx | 237 | Panel composition | High |
| FitnessNavbar.jsx | 97 | Navigation tabs | Low |
| FitnessPluginContainer.jsx | 60 | Plugin wrapper | Medium |

---

## Proposed Taxonomy

### Level 0: Framework (Layout Shells)

These define the **physical screen regions** without knowing what goes inside them.

```
┌─────────────────────────────────────────────────────────┐
│                    FitnessFrame                         │
│  ┌──────────┬────────────────────────────────────────┐  │
│  │          │                                        │  │
│  │  NavSlot │            MainSlot                    │  │
│  │          │                                        │  │
│  │          │                                        │  │
│  │          ├────────────────────────────────────────┤  │
│  │          │          FooterSlot (optional)         │  │
│  └──────────┴────────────────────────────────────────┘  │
│                    OverlaySlot (portal)                 │
└─────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────┐
│                  FitnessPlayerFrame                     │
│  ┌─────────────────────────────────┬─────────────────┐  │
│  │                                 │                 │  │
│  │          ContentSlot            │   SidebarSlot   │  │
│  │       (video / chart)           │   (optional)    │  │
│  │                                 │                 │  │
│  ├─────────────────────────────────┴─────────────────┤  │
│  │                 FooterSlot (optional)             │  │
│  └───────────────────────────────────────────────────┘  │
│                    OverlaySlot (portal)                 │
└─────────────────────────────────────────────────────────┘
```

**Key insight:** Frames are **pure layout**. They accept `children` or render props for each slot. They don't know about fitness, video, or sessions.

```jsx
// Framework component - pure layout
<FitnessPlayerFrame
  sidebar={showSidebar ? <SidebarSlotContent /> : null}
  footer={showFooter ? <FooterSlotContent /> : null}
  overlay={activeOverlay}
>
  <ContentSlotContent />
</FitnessPlayerFrame>
```

---

### Level 1: Views (Content Compositions)

Views compose **domain-specific content** into frame slots. Each View is a **complete experience** that can be mounted into a Frame.

| View | Description | Frame Slots Used |
|------|-------------|------------------|
| `MenuView` | Collection browser | Main only |
| `ShowView` | Episode list | Main only |
| `PlayerView` | Video playback | Main + Sidebar + Footer |
| `SessionView` | Chart + camera | Main + Sidebar |
| `PluginView` | App wrapper | Main ± Sidebar |

**Views are responsible for:**
- Deciding which sidebar panels to show
- Deciding which overlays to enable
- Passing relevant context to children

```jsx
// View component - domain composition
const PlayerView = ({ queue, setQueue }) => {
  const [playerMode, setPlayerMode] = useState('normal');
  
  return (
    <FitnessPlayerFrame
      sidebar={playerMode !== 'fullscreen' && <PlayerSidebar />}
      footer={playerMode !== 'fullscreen' && <PlayerFooter />}
      overlay={<PlayerOverlayStack />}
    >
      <VideoContent queue={queue} />
    </FitnessPlayerFrame>
  );
};
```

---

### Level 2: Modules (Reusable Assemblies)

Modules are **self-contained functional units** that can appear in multiple Views.

#### 2A: Sidebar Modules

These can slot into any SidebarSlot, regardless of which View is active.

| Module | Responsibility | Dependencies |
|--------|---------------|--------------|
| `SidebarCore` | Shell for sidebar panels | Frame context |
| `GovernancePanel` | HR policy status | FitnessContext |
| `TreasureBoxPanel` | Gamification display | FitnessContext |
| `UsersPanel` | Participant avatars | FitnessContext |
| `MusicPanel` | Audio player | FitnessContext, Player |
| `VoiceMemoTrigger` | Record button | FitnessContext |
| `MiniCamPanel` | Camera preview | WebRTC |

**Composable sidebar:**
```jsx
<SidebarCore>
  <TreasureBoxPanel onClick={onToggleChart} />
  <GovernancePanel />
  <UsersPanel onGuestAssign={handleGuest} />
  <MusicPanel />
  <VoiceMemoTrigger />
</SidebarCore>
```

#### 2B: Overlay Modules

These render via **portal** and can appear over any View.

| Module | Trigger | Z-Index Layer |
|--------|---------|---------------|
| `VoiceMemoOverlay` | Manual or auto | Topmost |
| `GovernanceOverlay` | Governance state | High |
| `ChallengeOverlay` | Challenge events | Medium |
| `FullscreenVitalsOverlay` | Fullscreen mode | Low |

**Key insight:** Overlays should be **context-aware but View-agnostic**. VoiceMemoOverlay currently renders at document.body level (good), but its trigger logic is scattered.

#### 2C: Content Modules

These are the **main content** that fills ContentSlot.

| Module | Description |
|--------|-------------|
| `VideoPlayer` | Plex video playback |
| `MediaGrid` | Collection thumbnails |
| `EpisodeList` | Season/episode browser |
| `ChartDisplay` | HR race chart |
| `PluginCanvas` | App render area |

---

### Level 3: Primitives (Atomic UI)

Already well-organized in `shared/primitives/`. No changes needed.

---

## Relationship Matrix

This shows which Modules can appear in which Views:

| Module | MenuView | ShowView | PlayerView | SessionView | PluginView |
|--------|:--------:|:--------:|:----------:|:-----------:|:----------:|
| **Sidebar** |
| GovernancePanel | ❌ | ❌ | ✅ | ✅ | ⚙️ |
| TreasureBoxPanel | ❌ | ❌ | ✅ | ✅ | ⚙️ |
| UsersPanel | ❌ | ❌ | ✅ | ✅ | ⚙️ |
| MusicPanel | ❌ | ❌ | ✅ | ❌ | ⚙️ |
| VoiceMemoTrigger | ❌ | ❌ | ✅ | ✅ | ⚙️ |
| MiniCamPanel | ❌ | ❌ | ❌ | ✅ | ⚙️ |
| **Overlays** |
| VoiceMemoOverlay | ✅ | ✅ | ✅ | ✅ | ✅ |
| GovernanceOverlay | ❌ | ❌ | ✅ | ❌ | ⚙️ |
| ChallengeOverlay | ❌ | ❌ | ✅ | ❌ | ⚙️ |
| **Content** |
| VideoPlayer | ❌ | ❌ | ✅ | ❌ | ❌ |
| ChartDisplay | ❌ | ❌ | ⚙️ | ✅ | ⚙️ |

Legend: ✅ = Yes | ❌ = No | ⚙️ = Configurable via manifest/props

---

## Proposed File Structure

```
frontend/src/modules/Fitness/
├── index.js                          # Public exports
│
├── frames/                           # Level 0: Layout shells
│   ├── FitnessFrame.jsx             # Nav + Main + Overlay
│   ├── FitnessPlayerFrame.jsx       # Content + Sidebar + Footer + Overlay
│   └── index.js
│
├── views/                            # Level 1: Complete experiences
│   ├── MenuView.jsx                 # Collection grid
│   ├── ShowView.jsx                 # Episode browser (was FitnessShow)
│   ├── PlayerView.jsx               # Video playback (core from FitnessPlayer)
│   ├── SessionView.jsx              # Chart + sidebar (from FitnessSessionApp)
│   ├── PluginView.jsx               # Generic plugin wrapper
│   └── index.js
│
├── modules/                          # Level 2: Reusable assemblies
│   ├── sidebar/                     # Sidebar modules
│   │   ├── SidebarCore.jsx          # Shell/composition
│   │   ├── GovernancePanel.jsx
│   │   ├── TreasureBoxPanel.jsx
│   │   ├── UsersPanel.jsx
│   │   ├── MusicPanel.jsx
│   │   ├── VoiceMemoTrigger.jsx
│   │   ├── MiniCamPanel.jsx
│   │   └── index.js
│   │
│   ├── overlays/                    # Overlay modules
│   │   ├── VoiceMemoOverlay.jsx
│   │   ├── GovernanceOverlay.jsx
│   │   ├── ChallengeOverlay.jsx
│   │   ├── FullscreenVitalsOverlay.jsx
│   │   └── index.js
│   │
│   ├── content/                     # Content modules
│   │   ├── VideoPlayer.jsx          # Core video (extracted from FitnessPlayer)
│   │   ├── MediaGrid.jsx            # (from FitnessMenu)
│   │   ├── EpisodeList.jsx          # (from FitnessShow)
│   │   ├── ChartDisplay.jsx         # (from FitnessChartApp)
│   │   └── index.js
│   │
│   └── footer/                      # Footer modules
│       ├── PlayerFooter.jsx         # (from FitnessPlayerFooter)
│       └── index.js
│
├── plugins/                          # Self-contained mini-apps
│   ├── registry.js
│   ├── PluginContainer.jsx
│   └── apps/
│       ├── JumpingJackGame/
│       ├── CameraViewApp/
│       └── ...
│
├── shared/                           # Level 3: Primitives (unchanged)
│   ├── primitives/
│   ├── composites/
│   ├── integrations/
│   └── ...
│
├── domain/                           # Business logic (unchanged)
│   └── ...
│
├── context/                          # (Consider moving to here)
│   └── FitnessContext.jsx
│
└── navigation/                       # Navigation handling
    ├── FitnessNavbar.jsx
    └── navigationUtils.js
```

---

## Migration Strategy

### Phase 1: Create Frames (Non-breaking)

1. Create `frames/FitnessFrame.jsx` - Extract layout from FitnessApp
2. Create `frames/FitnessPlayerFrame.jsx` - Extract layout from FitnessPlayer
3. Have existing components render inside frames without behavior change

### Phase 2: Extract Modules (Incremental)

1. Extract `modules/sidebar/SidebarCore.jsx` from FitnessSidebar
2. Extract individual panels (GovernancePanel, etc.) - already mostly separate
3. Move overlays to `modules/overlays/` - VoiceMemoOverlay is already portal-based

### Phase 3: Refactor to Views (Major)

1. Create `views/PlayerView.jsx` - Compose VideoPlayer + sidebar modules + overlays
2. Slim down FitnessPlayer.jsx to just video logic (~500 lines target)
3. Create `views/SessionView.jsx` from FitnessSessionApp pattern

### Phase 4: Update FitnessApp

1. Replace current switch-case rendering with View composition
2. Views become declarative based on navigation state
3. FitnessApp becomes thin orchestrator (~200 lines target)

---

## Key Design Principles

### 1. Slots Over Props

Instead of:
```jsx
// ❌ Tight coupling
<FitnessPlayer showSidebar={true} sidebarMode="player" governanceEnabled />
```

Use:
```jsx
// ✅ Slot-based composition
<FitnessPlayerFrame sidebar={<PlayerSidebar />}>
  <VideoPlayer />
</FitnessPlayerFrame>
```

### 2. Overlays Are Global

Overlays render at a **fixed portal point** managed by FitnessApp, not by individual Views:

```jsx
// In FitnessApp
<FitnessContext.Provider>
  <FitnessFrame>
    {/* Views render here */}
  </FitnessFrame>
  <OverlayPortal>
    <VoiceMemoOverlay />
    <GovernanceOverlay />
    {/* Other overlays */}
  </OverlayPortal>
</FitnessContext.Provider>
```

### 3. Modules Declare Capabilities

Plugins/views declare what sidebar panels they support via manifest:

```javascript
// Plugin manifest
export const manifest = {
  id: 'fitness_session',
  sidebar: {
    enabled: true,
    panels: ['treasure', 'users', 'voiceMemo'],
    governance: false,
    music: false
  },
  overlays: ['voiceMemo', 'fullscreenVitals']
};
```

### 4. Context Provides, Views Consume

FitnessContext remains the SSOT for session state. Views/Modules consume via hooks:

```jsx
// Module only uses what it needs
const GovernancePanel = () => {
  const { governanceState, zones } = useFitnessContext();
  // ...
};
```

---

## Questions to Resolve

1. **Footer ownership**: Should PlayerFooter be part of PlayerView or a separate module that other views could use?

2. **Navbar persistence**: Should navbar always render (current), or should PlayerView hide it?

3. **Plugin sidebars**: Should plugins get the "full" sidebar or a simplified version?

4. **Overlay coordination**: How do we prioritize when multiple overlays want to show?

5. **State management**: Should views manage their own state, or should more move to context?

---

## Next Steps

1. **Review this taxonomy** - Does it capture the current needs and future flexibility?
2. **Validate with concrete scenarios** - "I want sidebar with chart but no player" - does this work?
3. **Prioritize migration phases** - Which pain points justify the refactor effort?
4. **Create migration tickets** - Break into achievable PRs

---

## Appendix: Current vs Proposed Rendering

### Current (FitnessApp.jsx)

```jsx
{fitnessPlayQueue.length > 0 ? (
  <FitnessPlayer playQueue={fitnessPlayQueue} ... />  // Monolith
) : (
  <div style={{ display: 'flex' }}>
    <FitnessNavbar ... />
    <div className="fitness-main-content">
      {currentView === 'users' && <FitnessPluginContainer pluginId="fitness_session" />}
      {currentView === 'show' && <FitnessShow ... />}
      {currentView === 'menu' && <FitnessMenu ... />}
      {currentView === 'plugin' && <FitnessPluginContainer ... />}
    </div>
  </div>
)}
```

### Proposed (FitnessApp.jsx)

```jsx
<FitnessFrame
  nav={<FitnessNavbar />}
  overlay={<OverlayStack />}
>
  {currentView === 'player' && (
    <PlayerView
      queue={fitnessPlayQueue}
      sidebar={<PlayerSidebar />}
      footer={<PlayerFooter />}
    />
  )}
  {currentView === 'session' && (
    <SessionView
      sidebar={<SessionSidebar />}
    />
  )}
  {currentView === 'show' && <ShowView showId={selectedShow} />}
  {currentView === 'menu' && <MenuView collection={activeCollection} />}
  {currentView === 'plugin' && <PluginView pluginId={activePlugin.id} />}
</FitnessFrame>
```

The key difference: **Views own their composition**, FitnessApp just routes to them.
