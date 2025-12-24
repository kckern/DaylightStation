# Component Showcase Plugin - Design Specification

## Overview

The **Component Showcase** is a demo/interactive gallery plugin that displays and demonstrates all shared UX components available in the Fitness module's framework. It serves as both a living style guide and an interactive reference for developers building new plugins.

### Purpose

1. **Discovery** - Browse all available components in one place
2. **Live Data** - Components populated with real FitnessContext data (users, zones, devices)
3. **Testing** - Verify component rendering across states and configurations
4. **Design Reference** - Visual gallery of UI patterns and possibilities
5. **Onboarding** - Help new developers understand the framework

---

## Manifest

- **ID**: `component_showcase`
- **Name**: UX Showcase
- **Version**: 1.0.0
- **Icon**: palette
- **Description**: Interactive demo of all shared UX components and design patterns
- **Modes**: Standalone only
- **Requirements**: None (works with or without active session)
- **Category**: developer

---

## App Structure

### Navigation Architecture

The showcase uses a **tabbed navigation** pattern with six main sections:

1. **Live Context** - Real-time FitnessContext data visualization
2. **Primitives** - Atomic UI building blocks
3. **Composites** - Assembled component combinations
4. **Containers** - Layout scaffolding
5. **Integrations** - Domain-specific fitness widgets
6. **Hooks** - React hook demonstrations

Each tab contains a scrollable grid of component demo cards. Selecting a card expands it to show the full interactive playground.

---

## Tab 0: Live Context Dashboard

This section demonstrates the plugin's integration with FitnessContext, showing real-time session data powering the components.

### Participant Roster Panel

Displays the current `participantRoster` from context:
- Grid of UserAvatar components for each active participant
- Name, current heart rate, and zone badge for each
- "No active participants" empty state when roster is empty
- Clicking a participant highlights their data across all demos

### Heart Rate Zones Reference

Visual representation of the `zoneConfig` from context:
- Horizontal zone strip showing all 6 zones (Rest → Fire)
- Each zone displays its name, HR percentage range, and color
- Current user distribution across zones (pie chart or bar)
- Zone thresholds pulled from `getUserZoneThreshold()`

### Connected Devices Status

Live view of device data from context:
- `heartRateDevices` - List with device ID, assigned user, last reading
- `cadenceDevices` - Speed/cadence monitors with status
- `powerDevices` - Power meter status
- Device count badges and connection indicators
- Uses DeviceAvatar component for each device

### Session Vitals Summary

Aggregated data from `userVitalsMap`:
- Average heart rate across all participants
- Zone distribution breakdown
- Active time vs idle time
- Treasure box coin balance from `treasureBox`

### Governance State Display

Current governance engine status:
- `governanceState.status` indicator (idle, active, challenge)
- Active policy name from `activeGovernancePolicy`
- Challenge progress if `governanceChallenge` is active
- Governed media labels from `governedLabelSet`

---

## Quick Tools Drawer

A persistent utility panel accessible via a floating action button (bottom-right corner) from any tab. These are practical, immediately useful tools for fitness sessions.

### Clock
- Large digital clock showing current time
- 12-hour and 24-hour format toggle
- Optional seconds display
- Zone-colored background option (matches current highest participant zone)

### Session Timer
- Elapsed time since session started (from `isSessionActive` and session start time)
- Large MM:SS or HH:MM:SS display
- Pause indicator when `videoPlayerPaused` is true
- Auto-starts when session begins

### Stopwatch
- Independent stopwatch unrelated to session
- Start, Stop, Reset, Lap controls
- Lap time list with splits
- Audible beep option on lap

### Manual Counter
- Odometer display with large tap-friendly + / − buttons
- Use case: rep counting, set tracking, or any manual tally
- Reset button with confirmation
- Optional goal target with progress ring around the number
- Haptic feedback on each tap (if device supports)

### Cadence Gauge (RPM)
- **Live Mode**: Displays real-time RPM from first `cadenceDevices` in context
- Semi-circular gauge with zone-colored needle
- Target RPM indicator line (configurable)
- "No Device" placeholder when no cadence sensor connected
- Peak RPM badge showing session high

### Heart Rate Gauge
- **Live Mode**: First participant's BPM from `heartRateDevices`
- Zone-colored arc segments matching `zoneConfig`
- Current zone label below gauge
- Animated pulse effect synced to heart rate
- Min/Max indicators for session range

### Treasure Chest Status
- **Live Mode**: Bound to `treasureBox` from context
- Shows current coin balance with animated coin stack
- Progress toward next reward threshold
- "Claim Rewards" button when rewards available
- Sparkle animation when coins are earned

### Quick Notes
- Tap to open voice memo recording (triggers `openVoiceMemoRedo`)
- Shows count of pending `voiceMemos` with badge
- Quick playback of most recent memo

### Interval Timer
- Configurable work/rest intervals
- Visual countdown ring with color change (green for work, blue for rest)
- Round counter (e.g., "Round 3 of 8")
- Audio cues for transitions
- Presets: Tabata (20/10), HIIT (40/20), Custom

### Metronome
- Adjustable BPM with tap-tempo button
- Visual beat indicator (pulsing circle)
- Audible tick option
- Use case: pacing cadence, breath timing

---

## Section Breakdown

### Tab 1: Primitives

Interactive demos for all atomic UI building blocks. Each primitive is populated with real context data where applicable.

#### 1.1 AppButton
- Grid of buttons showing all variants: primary, secondary, ghost, danger, success
- Size comparison row: sm, md, lg, xl
- State matrix: Normal, Hover, Active, Disabled, Loading
- Playground controls for variant, size, disabled, loading, fullWidth, icon position

#### 1.2 AppIconButton
- Icon grid showing common fitness icons (play, pause, heart, settings, etc.)
- Variants: default, primary, danger, success
- Shapes: circle vs square
- Badge and tooltip demonstrations

#### 1.3 NumericKeypad
- Full interactive keypad with live value display
- Useful for weight entry, rep counting, duration setting
- Controls for maxLength, decimal/negative toggles, layout style, label, unit suffix

#### 1.4 Odometer
- Large animated odometer display
- **Live Mode**: Shows current total participant count from `participantRoster.length`
- Value scrubber slider to see animation in action
- Theme gallery: default, neon, retro, minimal
- Format options: integer, decimal, currency, time

#### 1.5 Gauge
- **Live Mode**: Displays first participant's heart rate from `userVitalsMap`
- Zone-colored gauge using `zoneConfig` color definitions
- Playground for value, min/max, size, zones preset, label, units

#### 1.6 ProgressBar
- Multiple progress bars stacked showing variants: default, striped, segmented, gradient
- **Live Mode**: Shows session progress or zone time distribution
- Auto-animating demo bar
- Controls for value, variant, size, color/zone preset, label visibility

#### 1.7 ProgressRing
- Ring with centered content (icon or value)
- Size gallery from 24px to 120px
- Color and stroke width controls

#### 1.8 Timer / ElapsedTimer
- **Live Mode**: Shows actual session elapsed time if session is active
- Start, Pause, Reset demo controls
- Format options: MM:SS, HH:MM:SS, seconds only

#### 1.9 CountdownRing
- Animated countdown ring with preset demos (3s, 5s, 10s)
- Size and color customization
- Completion callback demonstration

#### 1.10 TouchSlider
- Large touch-friendly slider for volume, intensity, etc.
- Horizontal and vertical orientation demos
- Min/max, step, marks, value display controls

#### 1.11 StripedProgressBar
- Animated striped bar with zone color variants
- **Live Mode**: Color matches highest active zone from `userCurrentZones`

#### 1.12 StatusBadge
- Grid of all badge states: active, idle, warning, error, success, offline
- **Live Mode**: Shows connection status from `connected` context value
- Size options and pulse animation toggle

#### 1.13 MicLevelIndicator
- Animated mic level visualization
- Simulated audio level slider for testing
- Bar count and color customization

#### 1.14 VolumeControl
- Full volume control widget with mute toggle
- Horizontal and vertical orientations

---

### Tab 2: Composites

Assembled component combinations for common UI patterns.

#### 2.1 ActionBar
- Toolbar with various button configurations
- Position options: top-docked, bottom-docked, floating
- Variant styles: solid, transparent, glass

#### 2.2 AppNavigation
- Navigation bar with tabs
- Tab styles: pills, underline, segmented
- Icon and label display options

#### 2.3 AppModal
- Button-triggered modal demonstration
- Sizes: sm, md, lg, fullscreen
- Backdrop options: blur, dim, none
- Close button and custom content

#### 2.4 ConfirmDialog
- Confirmation dialog presets: Delete, Cancel, Quit
- Variants: danger, warning, info
- Customizable title, message, and button text

#### 2.5 AppList
- **Live Mode**: Displays `participantRoster` as a scrollable list
- Item types: simple text, with icons, with badges, selectable
- Single and multi-select modes
- Divider visibility toggle

#### 2.6 MultiChoice
- Selection grid for quick choices
- **Live Mode**: Zone selector using `zoneConfig` options
- Layouts: grid, row, column
- Single and multi-select modes

#### 2.7 DataEntryForm
- Sample form with various field types: text, number, select, toggle
- Stack and grid layouts
- Live value display

---

### Tab 3: Containers

Layout scaffolding components for structuring app content.

#### 3.1 FullScreenContainer
- Mini viewport showing container behavior
- Header and footer slot demonstrations
- Background color/gradient options
- Padding controls

#### 3.2 SplitViewContainer
- Resizable split view demo
- Horizontal and vertical orientations
- Initial ratio slider (20%-80%)
- Minimum pane size and resizable toggle

#### 3.3 GameCanvas
- Canvas with placeholder content or simple animation
- Aspect ratio options: 16:9, 4:3, 1:1
- Scale modes: contain, cover, stretch
- Debug grid overlay option

---

### Tab 4: Integrations

Domain-specific fitness components, all populated with live context data.

#### 4.1 UserAvatar
- **Live Mode**: Displays avatars for each user in `userCollections.all`
- States: online, away, exercising, completed
- Size options with status indicator and border color (zone-based)

#### 4.2 UserAvatarGrid
- **Live Mode**: Full grid of `participantRoster` with real avatars and names
- Layout options: grid, row, stack
- Column count and size controls
- Name label visibility toggle

#### 4.3 DeviceAvatar
- **Live Mode**: Shows each device from `allDevices` (HR monitors, cadence, power)
- Connection status and battery level display
- Device type icons: watch, heart rate strap, scale

#### 4.4 WebcamView
- Camera feed (or placeholder when camera unavailable)
- Filter options: none, mirror, grayscale, night vision
- Aspect ratio and controls visibility

#### 4.5 HeartRateDisplay
- **Live Mode**: Shows real-time BPM from first active `heartRateDevices`
- Large animated BPM display with pulsing effect
- Zone-colored background using `userCurrentZones`
- Size options and zone label toggle

#### 4.6 ZoneIndicator
- **Live Mode**: Indicates current zone for selected participant
- Display styles: strip, badge, bar, label
- Zone data from `zoneConfig` with proper colors and labels
- Percentage display option

#### 4.7 ChartWidget
- **Live Mode**: Plots heart rate timeline from `getTimelineSeries('heartRate')`
- Chart types: line, area, bar
- Height adjustment and axis visibility
- Zone threshold lines overlay option

#### 4.8 MusicPlayerWidget
- Compact music player controls
- **Live Mode**: Reflects `musicEnabled` and `selectedPlaylistId` from context
- States: playing, paused, loading
- Artwork visibility toggle

#### 4.9 TreasureBoxWidget
- **Live Mode**: Displays actual `treasureBox` coin balance from session
- States: locked, unlocked, opening, open
- Size options and glow effect toggle

---

### Tab 5: Hooks

Interactive demonstrations of React hooks with real context integration.

#### 5.1 useCountdown
- Countdown display with start/pause/reset controls
- Configurable start value and duration
- Completion callback demonstration

#### 5.2 useAnimatedNumber
- Number that animates smoothly on change
- **Live Mode**: Can animate to current participant count or total HR readings
- Duration and easing function controls

#### 5.3 useResponsiveSize
- Resizable container with live size readout
- Displays current width, height, and computed breakpoint
- Drag-to-resize handles

#### 5.4 useGameLoop
- Simple animation using requestAnimationFrame game loop
- Bouncing ball or pulsing element demo
- FPS counter display and pause/resume controls

#### 5.5 useTouchGestures
- Touch gesture detection zone
- Visual indicators for: swipe, tap, long press, pinch
- Gesture event log display
- Threshold settings

#### 5.6 useKeyboardNav
- Focusable item grid for arrow key navigation
- Focus indicator styling options
- Keyboard event log

#### 5.7 useAudioFeedback
- Audio test buttons for each sound type
- Sounds: click, success, error, countdown beeps
- Volume slider and enable/disable toggle

---

## Design Token Gallery

A dedicated panel (accessible from any tab via header icon) showcasing CSS variables and design tokens.

### Colors Section

**Backgrounds**: Swatches for primary (#0f0f0f), secondary (#1a1a1a), tertiary (#252525), elevated (#2a2a2a)

**Text**: Swatches for primary (#ffffff), secondary (#aaaaaa), muted (#666666), accent (#4fc3f7)

**Actions**: Swatches for primary (#4fc3f7), success (#51cf66), warning (#ffd43b), danger (#ff6b6b)

**Heart Rate Zones**: Visual strip showing all 6 zones with colors pulled from `zoneConfig`:
- Rest (gray, #888888)
- Cool (blue, #6ab8ff)  
- Active (green, #51cf66)
- Warm (yellow, #ffd43b)
- Hot (orange, #ff922b)
- Fire (red, #ff6b6b)

### Typography Section
- Font family preview (system-ui, monospace)
- Size scale visualization (xs through 3xl)
- Weight demonstrations

### Spacing Section
- Spacing scale visual blocks (xs: 4px through xl: 32px)
- Padding and margin examples

### Shadows & Borders Section
- Shadow elevation examples (sm, md, lg)
- Border radius scale (sm: 4px through full: 9999px)

### Animations Section
- Standard transition speed demos (fast: 150ms, normal: 250ms, slow: 400ms)
- Keyframe animation gallery (pulse, spin, bounce, fade)

---

## Context Data Reference

The showcase uses the following FitnessContext values for live demonstrations:

| Context Value | Used In |
|--------------|---------|
| `participantRoster` | UserAvatarGrid, AppList, Odometer (count), Live Context tab |
| `userVitalsMap` | Gauge (HR), HeartRateDisplay, Live Context tab |
| `userCurrentZones` | ZoneIndicator, StripedProgressBar color |
| `zoneConfig` | Zone colors everywhere, MultiChoice options, Zone Reference panel |
| `heartRateDevices` | HeartRateDisplay, DeviceAvatar, Device Status panel |
| `allDevices` | DeviceAvatar grid, device counts |
| `cadenceDevices` | Cadence Gauge (RPM), Quick Tools drawer |
| `connected` | StatusBadge connection indicator |
| `treasureBox` | TreasureBoxWidget balance, Treasure Chest Status tool |
| `governanceState` | Governance Status panel |
| `governanceChallenge` | Challenge progress display |
| `activeGovernancePolicy` | Policy name display |
| `governedLabelSet` | Governed labels list |
| `musicEnabled` | MusicPlayerWidget state |
| `selectedPlaylistId` | MusicPlayerWidget current playlist |
| `getTimelineSeries()` | ChartWidget data source |
| `getUserZoneThreshold()` | Zone threshold lines on charts |
| `isSessionActive` | Conditional UI (active vs demo mode), Session Timer |
| `videoPlayerPaused` | Session Timer pause indicator |
| `voiceMemos` | Quick Notes badge count |
| `openVoiceMemoRedo()` | Quick Notes recording trigger |

When no session is active, components display placeholder/demo data with a "Demo Mode" indicator.

---

## UI/UX Features

### Search & Filter
- Global search across all components by name or description
- Filter by category, complexity, or use case tags

### Live vs Demo Mode Toggle
- Switch between real context data and mock demo data
- Useful for testing components without an active session

### Favorites
- Star frequently used components for quick access
- Favorites panel at top of each section

### Responsive Preview
- Device frame selector: phone, tablet, TV
- Resize handles for custom dimensions
- Tests component responsiveness

### Dark/Light Preview
- Toggle preview area background color
- Test component visibility in different contexts

---

## File Structure

Primary files for the ComponentShowcase plugin:

- **index.jsx** - Plugin entry point
- **ComponentShowcase.jsx** - Main app component with tab navigation
- **ComponentShowcase.scss** - Styles
- **manifest.js** - Plugin manifest

Section components:
- **sections/LiveContextSection.jsx** - Real-time FitnessContext dashboard
- **sections/PrimitivesSection.jsx** - Atomic component demos
- **sections/CompositesSection.jsx** - Combined component demos  
- **sections/ContainersSection.jsx** - Layout component demos
- **sections/IntegrationsSection.jsx** - Fitness-specific widget demos
- **sections/HooksSection.jsx** - React hook demonstrations

Supporting components:
- **components/ComponentCard.jsx** - Individual component demo card
- **components/PropsPlayground.jsx** - Interactive props editor
- **components/DesignTokenPanel.jsx** - Token gallery overlay
- **components/CategoryNav.jsx** - Tab navigation

Data:
- **data/componentDefs.js** - Component metadata and default props
- **data/mockData.js** - Demo mode placeholder data

---

## Implementation Phases

### Phase 1: Foundation
- Basic plugin structure with manifest
- Tab navigation between 6 sections
- LiveContextSection with real FitnessContext integration
- Component card layout grid

### Phase 2: Component Demos
- All Primitives section demos with playground controls
- All Composites section demos
- Live data binding for components that support it

### Phase 3: Advanced Sections
- Containers section with resizable demos
- Integrations section with full context binding
- Hooks section with interactive examples

### Phase 4: Polish
- Search functionality
- Design token gallery panel
- Responsive preview modes
- Favorites system
- Live/Demo mode toggle

---

## Component Demo Card Layout

Each component is displayed in a standardized card format:

**Header**: Component name, favorite star button, expand button

**Preview Area**: Live rendered component with current props

**Playground**: Controls for adjusting props (dropdowns, sliders, checkboxes, color pickers)

**Footer**: "Live Data" indicator when using FitnessContext values, component category tag

---

## Accessibility

- All demos include proper ARIA labels
- Full keyboard navigation throughout the app
- Focus indicators on all interactive elements
- Color contrast verified for all text
- Screen reader announcements for state changes

---

## Performance Considerations

- Lazy load section content (only render active tab)
- Virtualize long component lists
- Debounce playground prop changes (300ms)
- Memoize rendered component previews
- Context selectors to minimize re-renders

---

## Future Enhancements

1. **Playground Presets** - Save and load prop configurations
2. **Side-by-Side Compare** - View two components or variants together
3. **Animation Editor** - Visual timeline for animation customization
4. **Theme Builder** - Create and export custom color schemes
5. **Component Composition** - Drag-and-drop to combine components into layouts
6. **Usage Analytics** - Track which components are viewed most often
7. **Deep Linking** - URL parameters to link directly to a specific component
8. **Export Snapshot** - Screenshot current component state for documentation

---

## Related Documents

- [shared/DESIGN.md](../../shared/DESIGN.md) - Full component specifications
- [FitnessPlugins/design.md](../design.md) - Plugin framework documentation
- [FitnessPlugins/CONTRIBUTING.md](../CONTRIBUTING.md) - How to build plugins

---

## Implementation Plan

### Phase 1: Plugin Scaffold & Navigation

**Goal**: Establish the basic plugin structure with working tab navigation.

**Tasks**:
- Create manifest.js with plugin metadata
- Create index.jsx entry point
- Build ComponentShowcase.jsx main shell with header and tab bar
- Implement CategoryNav component for 6-tab navigation
- Create placeholder sections for each tab
- Add basic SCSS with design token variables
- Register plugin in FitnessPlugins registry

**Deliverables**:
- Plugin launches from menu
- Tabs switch between placeholder content
- Close button returns to previous view

---

### Phase 2: Live Context Dashboard

**Goal**: Build Tab 0 with real-time FitnessContext data visualization.

**Tasks**:
- Create LiveContextSection.jsx
- Build Participant Roster Panel using UserAvatarGrid with `participantRoster`
- Build Heart Rate Zones Reference using ZoneIndicator with `zoneConfig`
- Build Connected Devices Status panel using DeviceAvatar with `allDevices`
- Build Session Vitals Summary aggregating `userVitalsMap`
- Build Governance State Display with `governanceState` indicators
- Add "Demo Mode" fallback when no session active
- Wire up real-time updates via context subscription

**Deliverables**:
- Live dashboard reflects actual session state
- Graceful fallback to demo data when offline
- All context values displayed correctly

---

### Phase 3: Quick Tools Drawer

**Goal**: Implement the floating utility panel with practical session tools.

**Tasks**:
- Create QuickToolsDrawer.jsx with slide-out panel
- Add floating action button (FAB) for drawer toggle
- Implement Clock tool with format toggle
- Implement Session Timer bound to session state
- Implement Stopwatch with lap functionality
- Implement Manual Counter (Odometer + buttons)
- Implement Cadence Gauge bound to `cadenceDevices`
- Implement Heart Rate Gauge bound to `heartRateDevices`
- Implement Treasure Chest Status bound to `treasureBox`
- Implement Quick Notes trigger for voice memos
- Implement Interval Timer with presets
- Implement Metronome with tap-tempo
- Add tool enable/disable preferences (persisted)

**Deliverables**:
- Drawer accessible from any tab via FAB
- All 10 tools functional
- Live tools reflect real device data
- Preferences persist across sessions

---

### Phase 4: Primitives Section

**Goal**: Build complete interactive demos for all primitive components.

**Tasks**:
- Create PrimitivesSection.jsx with component grid
- Create ComponentCard.jsx reusable demo card
- Create PropsPlayground.jsx with control types (dropdown, radio, checkbox, slider, color)
- Build demos for all 14 primitives:
  - AppButton, AppIconButton, NumericKeypad, Odometer
  - Gauge, ProgressBar, ProgressRing, Timer/ElapsedTimer
  - CountdownRing, TouchSlider, StripedProgressBar
  - StatusBadge, MicLevelIndicator, VolumeControl
- Wire live data where applicable (Gauge → HR, StatusBadge → connected)
- Add "Live Data" indicator badges

**Deliverables**:
- All primitives have interactive demos
- Playground controls update component in real-time
- Live context bindings working

---

### Phase 5: Composites & Containers Sections

**Goal**: Complete demos for composite and container components.

**Tasks**:
- Create CompositesSection.jsx
- Build demos for 7 composites:
  - ActionBar, AppNavigation, AppModal, ConfirmDialog
  - AppList (with participantRoster), MultiChoice (with zoneConfig)
  - DataEntryForm
- Create ContainersSection.jsx
- Build demos for 3 containers:
  - FullScreenContainer, SplitViewContainer, GameCanvas
- Add resizable demo areas for containers
- Wire live data to AppList and MultiChoice

**Deliverables**:
- All composites and containers demoed
- Modal/dialog triggers working
- Container resize handles functional

---

### Phase 6: Integrations Section

**Goal**: Complete demos for all fitness-specific integration widgets.

**Tasks**:
- Create IntegrationsSection.jsx
- Build demos for 9 integrations:
  - UserAvatar (with userCollections.all)
  - UserAvatarGrid (with participantRoster)
  - DeviceAvatar (with allDevices)
  - WebcamView (with camera or placeholder)
  - HeartRateDisplay (with heartRateDevices)
  - ZoneIndicator (with userCurrentZones)
  - ChartWidget (with getTimelineSeries)
  - MusicPlayerWidget (with musicEnabled, selectedPlaylistId)
  - TreasureBoxWidget (with treasureBox)
- Ensure all components use real context data
- Handle "No Data" states gracefully

**Deliverables**:
- All integrations have working demos
- Real-time data flowing through all widgets
- Empty states handled

---

### Phase 7: Hooks Section

**Goal**: Create interactive demonstrations for all React hooks.

**Tasks**:
- Create HooksSection.jsx
- Build interactive demos for 7 hooks:
  - useCountdown (with controls)
  - useAnimatedNumber (bound to participant count option)
  - useResponsiveSize (resizable container)
  - useGameLoop (bouncing animation)
  - useTouchGestures (gesture detection zone)
  - useKeyboardNav (focusable grid)
  - useAudioFeedback (sound test buttons)
- Add explanatory text for each hook's purpose
- Show hook return values in real-time

**Deliverables**:
- All hooks have interactive demos
- Clear demonstration of each hook's behavior
- Educational descriptions included

---

### Phase 8: Design Token Gallery

**Goal**: Build the design token reference panel.

**Tasks**:
- Create DesignTokenPanel.jsx as overlay/modal
- Add header icon to trigger panel from any tab
- Build Colors section with swatches (backgrounds, text, actions, zones)
- Build Typography section with font samples
- Build Spacing section with visual scale
- Build Shadows & Borders section with examples
- Build Animations section with live demos
- Pull zone colors dynamically from `zoneConfig`

**Deliverables**:
- Token gallery accessible from header
- All design tokens visualized
- Zone colors reflect context config

---

### Phase 9: Search & Filtering

**Goal**: Add global search and component filtering.

**Tasks**:
- Add search input to header
- Create componentDefs.js with searchable metadata (name, description, tags, category)
- Implement fuzzy search across all components
- Add filter chips for categories and complexity
- Highlight matching components in results
- Deep link to specific component on selection

**Deliverables**:
- Search finds components by name, description, or tag
- Filter narrows results by category
- Selecting result navigates to component

---

### Phase 10: Polish & UX Enhancements

**Goal**: Add finishing touches and quality-of-life features.

**Tasks**:
- Implement Favorites system with star toggle and favorites panel
- Add Live/Demo Mode toggle in header
- Create mockData.js for demo mode fallbacks
- Implement responsive preview modes (phone, tablet, TV frames)
- Add keyboard shortcuts (tab switching, search focus, drawer toggle)
- Performance optimization (lazy loading, memoization, virtualization)
- Accessibility audit (ARIA labels, focus management, screen reader testing)
- Add loading states and error boundaries
- Write unit tests for critical functionality

**Deliverables**:
- Favorites persist and display
- Mode toggle switches data source
- Responsive preview working
- All accessibility requirements met
- Tests passing

---

### Phase 11: Documentation & Handoff

**Goal**: Finalize documentation and prepare for team use.

**Tasks**:
- Update CONTRIBUTING.md with showcase usage instructions
- Add inline help tooltips for complex controls
- Create "What's New" section for component updates
- Add version indicator showing shared component library version
- Write developer README for the plugin
- Record demo video/GIF for documentation

**Deliverables**:
- Documentation complete
- Plugin ready for team use
- Demo assets created

---

## Timeline Estimate

| Phase | Estimated Effort | Dependencies |
|-------|------------------|--------------|
| Phase 1: Scaffold | 2-3 hours | None |
| Phase 2: Live Context | 3-4 hours | Phase 1 |
| Phase 3: Quick Tools | 4-6 hours | Phase 1 |
| Phase 4: Primitives | 4-5 hours | Phase 1 |
| Phase 5: Composites/Containers | 3-4 hours | Phase 4 |
| Phase 6: Integrations | 4-5 hours | Phase 4 |
| Phase 7: Hooks | 3-4 hours | Phase 4 |
| Phase 8: Design Tokens | 2-3 hours | Phase 1 |
| Phase 9: Search | 2-3 hours | Phases 4-7 |
| Phase 10: Polish | 4-6 hours | All previous |
| Phase 11: Documentation | 2-3 hours | Phase 10 |

**Total**: ~34-46 hours

Phases 3-7 can be parallelized after Phase 1 is complete. Phase 2 and Phase 3 have no dependencies on each other.

---

## Addendum: TV Layout Architecture

This plugin runs on a TV interface where **scrolling is prohibited**. All content must fit within the visible viewport at all times. The layout system uses pure flexbox with reactive scaling to achieve this.

### Core Principles

1. **No Overflow, No Scroll** - The entire app tree sets `overflow: hidden` from root to leaf. No element may trigger scrollbars or scroll behavior.

2. **Tab Bar at Bottom** - Navigation tabs are fixed to the bottom edge, TV remote–friendly, with large touch targets.

3. **Content Fills Available Space** - The main content area uses `flex: 1` and `min-height: 0` to absorb remaining viewport height after the tab bar.

4. **Reactive Scaling** - Font sizes and element dimensions use `clamp()` with viewport-relative units to scale proportionally while respecting minimum/maximum bounds.

### Layout Structure

```
┌─────────────────────────────────────────┐
│                                         │
│              .cs-content                │
│         (flex: 1, min-height: 0)        │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │     Section Grid (flexbox)      │   │
│   │   Cards scale to fit viewport   │   │
│   └─────────────────────────────────┘   │
│                                         │
├─────────────────────────────────────────┤
│            CategoryNav (tabs)           │
│         (flex-shrink: 0, bottom)        │
└─────────────────────────────────────────┘
```

### CSS Implementation

```scss
.component-showcase {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.cs-content {
  flex: 1;
  min-height: 0;           // Critical: allows flex child to shrink
  overflow: hidden;        // No scrolling
  display: flex;
  flex-direction: column;
}

.cs-live-grid,
.cs-demo-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: clamp(8px, 1vw, 16px);
  grid-template-columns: repeat(auto-fit, minmax(clamp(200px, 20vw, 320px), 1fr));
  grid-auto-rows: 1fr;     // Equal row heights
  overflow: hidden;
}

.cs-card,
.cs-demo-card {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.cs-card__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

### Reactive Typography

All text uses clamped viewport units to scale with screen size:

```scss
:root {
  --cs-font-xs: clamp(10px, 0.8vw, 12px);
  --cs-font-sm: clamp(11px, 0.9vw, 14px);
  --cs-font-md: clamp(13px, 1vw, 16px);
  --cs-font-lg: clamp(16px, 1.2vw, 20px);
  --cs-font-xl: clamp(20px, 1.5vw, 28px);
  --cs-font-2xl: clamp(24px, 2vw, 36px);
}

.cs-card-title {
  font-size: var(--cs-font-lg);
}

.cs-card-kicker {
  font-size: var(--cs-font-xs);
}
```

### Responsive Element Sizing

Icons, avatars, gauges, and interactive elements also scale:

```scss
:root {
  --cs-avatar-size: clamp(32px, 4vw, 56px);
  --cs-icon-size: clamp(16px, 2vw, 28px);
  --cs-gauge-size: clamp(80px, 10vw, 140px);
  --cs-spacing-unit: clamp(4px, 0.5vw, 8px);
}
```

### Grid Density Control

Section grids adjust column count based on viewport:

| Viewport Width | Columns | Card Min Width |
|----------------|---------|----------------|
| < 800px        | 1–2     | 200px          |
| 800–1200px     | 2–3     | 240px          |
| 1200–1600px    | 3–4     | 280px          |
| > 1600px       | 4–5     | 320px          |

### Tab Bar (Bottom Navigation)

```scss
.cs-category-nav {
  flex-shrink: 0;
  display: flex;
  gap: clamp(4px, 0.5vw, 12px);
  padding: clamp(8px, 1vw, 16px);
  background: var(--cs-bg-elevated);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.cs-tab {
  flex: 1;
  padding: clamp(10px, 1.2vw, 18px) clamp(12px, 1.5vw, 24px);
  font-size: var(--cs-font-md);
  border-radius: var(--cs-radius-md);
}
```

### Quick Tools Drawer Adjustment

The FAB and drawer must not obscure content or cause layout shift:

```scss
.cs-fab {
  position: absolute;          // Not fixed, relative to content area
  bottom: calc(var(--tab-bar-height) + 16px);
  right: 16px;
}

.cs-tools {
  position: absolute;
  bottom: calc(var(--tab-bar-height) + 16px);
  right: 16px;
  max-height: 60vh;           // Capped height
  overflow: hidden;           // Internal content may need truncation
}
```

### Content Truncation Strategy

When content cannot fit, apply graceful degradation:

1. **Text**: Use `text-overflow: ellipsis` with single-line clamping or multi-line `-webkit-line-clamp`.
2. **Lists**: Show first N items with "+X more" badge.
3. **Grids**: Reduce visible cards; hide overflow with count indicator.
4. **Charts/Gauges**: Scale down proportionally; hide labels at small sizes.

### Implementation Checklist

- [ ] Root container `height: 100%` and `overflow: hidden`
- [ ] Tab bar moved to bottom with `flex-shrink: 0`
- [ ] Content area uses `flex: 1` and `min-height: 0`
- [ ] All grids use `overflow: hidden` and `grid-auto-rows: 1fr`
- [ ] Font sizes converted to `clamp()` with vw middle value
- [ ] Element sizes converted to `clamp()` with vw middle value
- [ ] Cards truncate overflow content gracefully
- [ ] Quick Tools positioned relative to content, not viewport
- [ ] Tested at 720p, 1080p, and 4K resolutions
