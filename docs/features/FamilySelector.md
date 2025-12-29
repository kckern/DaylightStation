# FamilySelector App - Design Document

## Overview

The FamilySelector is a visual "roulette wheel" app that randomly (or pseudo-randomly) selects a household member. Use cases include:

- Deciding who does a chore
- Picking who gets to choose dinner
- Selecting a game player order
- Any household decision requiring a fair/fun selection

## User Interface

### Layout
```
┌──────────────────────────────────────────┐
│                                          │
│              🎯 WHEEL TITLE              │
│                                          │
│           ╭───────────────╮              │
│          ╱   👤    👤      ╲             │
│         │  👤        👤    │            │
│         │       ▼         │  ◄── pointer │
│         │  👤        👤    │            │
│          ╲   👤    👤      ╱             │
│           ╰───────────────╯              │
│                                          │
│         Press SPACE to spin!             │
│                                          │
└──────────────────────────────────────────┘
```

### Visual Elements

1. **Wheel**: Circular roulette wheel divided into equal segments
2. **Avatars**: Each segment displays member's avatar image (or initials fallback)
3. **Pointer**: Fixed indicator showing the "selected" position
4. **Title**: Configurable header text (e.g., "Who's turn is it?")
5. **Instructions**: Contextual hint text at bottom

### States

| State | Description |
|-------|-------------|
| `idle` | Wheel stationary, ready for input |
| `spinning` | Wheel rotating with easing animation |
| `result` | Winner highlighted, celebration animation |
| `cooldown` | Brief lockout to prevent spam |

### Animations

- **Spin**: CSS transform rotation with cubic-bezier easing (fast start, slow finish)
- **Winner Reveal**: Pulse/glow effect on winning segment, confetti optional
- **Avatar Hover**: Subtle scale-up on idle wheel segments

## Interactions

| Input | Action |
|-------|--------|
| `Space` | Spin the wheel |
| `Enter` | Spin the wheel |
| `Play` (TV remote) | Spin the wheel |
| `R` | Re-spin (only in result state) |
| `Escape` | Reset to idle |

## Component Props / URL Input

The FamilySelectorApp accepts props to control behavior, similar to other apps like ArtApp.

### Props Interface

```jsx
// Usage in app routing
<FamilySelectorApp 
  winner="kc"           // Optional: Rig the winner (member id)
  title="Dish Duty"     // Optional: Override title
  exclude="child2"      // Optional: Comma-separated member ids to exclude
/>
```

### URL Query Parameters

When launched via URL, the same parameters can be passed as query strings:

```
/app/family-selector                     # Random selection
/app/family-selector?winner=kc           # Rigged: KC wins
/app/family-selector?winner=spouse&title=Movie%20Pick
/app/family-selector?exclude=child1,child2   # Only adults in pool
```

### Prop Definitions

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `winner` | `string` | `null` | Member ID to rig as winner. Spin animation plays normally but lands on this person. |
| `title` | `string` | Config default | Override the wheel title text |
| `exclude` | `string` | `null` | Comma-separated member IDs to temporarily remove from wheel |
| `autoSpin` | `boolean` | `false` | Automatically spin on mount (for kiosk/scheduled use) |

### Implementation Example

```jsx
import "./FamilySelectorApp.scss";
import { useSearchParams } from "react-router-dom";

export default function FamilySelectorApp({ winner, title, exclude, autoSpin }) {
  const [searchParams] = useSearchParams();
  
  // Props take precedence, then URL params, then config defaults
  const riggedWinner = winner || searchParams.get("winner") || null;
  const displayTitle = title || searchParams.get("title") || config.title;
  const excludeList = (exclude || searchParams.get("exclude") || "")
    .split(",")
    .filter(Boolean);
  
  // Filter members
  const activeMembers = config.members.filter(m => !excludeList.includes(m.id));
  
  // Disable if < 2 members
  if (activeMembers.length < 2) {
    return <div className="family-selector-disabled">Not enough members</div>;
  }
  
  // Determine winner (rigged or random)
  const selectedWinner = riggedWinner 
    ? activeMembers.find(m => m.id === riggedWinner) 
    : activeMembers[Math.floor(Math.random() * activeMembers.length)];
  
  // ... rest of component
}
```

### Rigging Priority

When determining the winner, the following priority applies:

1. **URL `?winner=` param** — Highest priority (allows ad-hoc rigging)
2. **Component `winner` prop** — From parent/routing config
3. **Config schedule** — Date-specific overrides from YAML
4. **Config weekly rotation** — If enabled in YAML
5. **Random selection** — Fallback

This allows flexible rigging at multiple levels while keeping the spin animation identical regardless of selection method.

## Configuration Schema

```yaml
# config/apps/family-selector.yml

familySelector:
  title: "Who's turn is it?"
  
  members:
    - id: "kc"
      name: "KC"
      avatar: "/media/avatars/kc.jpg"
      color: "#4A90D9"  # Segment background color
    - id: "spouse"
      name: "Spouse"
      avatar: "/media/avatars/spouse.jpg"
      color: "#D94A6A"
    - id: "child1"
      name: "Child 1"
      avatar: "/media/avatars/child1.jpg"
      color: "#6AD94A"
    - id: "child2"
      name: "Child 2"
      avatar: "/media/avatars/child2.jpg"
      color: "#D9A64A"

  mode: "random"  # "random" | "rigged" | "weighted"
  
  # Rigged mode configuration
  rigged:
    type: "weekly"  # "fixed" | "weekly" | "schedule"
    
    # Fixed: Always land on this person
    fixedMember: null
    
    # Weekly: Rotate through members each week
    weeklyRotation:
      enabled: true
      startDate: "2025-01-06"  # Monday of first week
      order: ["kc", "spouse", "child1", "child2"]
    
    # Schedule: Specific dates mapped to members
    schedule:
      "2025-12-25": "child1"  # Christmas
      "2025-12-31": "spouse"  # New Year's Eve
  
  # Weighted mode configuration (probabilistic rigging)
  weights:
    kc: 1.0
    spouse: 1.0
    child1: 1.5      # 50% more likely
    child2: 0.5      # 50% less likely
  
  # Visual options
  display:
    showConfetti: true
    spinDurationMs: 4000
    minSpins: 3           # Minimum full rotations
    maxSpins: 6           # Maximum full rotations
    showNameOnResult: true
    celebrationDurationMs: 3000
  
  # Sound effects (optional)
  audio:
    spinSound: "/media/audio/wheel-spin.mp3"
    winSound: "/media/audio/winner.mp3"
    tickSound: "/media/audio/tick.mp3"  # Played as wheel passes segments
```

## Technical Implementation

### File Structure
```
frontend/src/Apps/
├── FamilySelectorApp.jsx
├── FamilySelectorApp.scss
└── components/
    └── FamilySelector/
        ├── RouletteWheel.jsx
        ├── RouletteWheel.scss
        ├── WheelSegment.jsx
        └── WinnerDisplay.jsx
```

### Key Components

#### `FamilySelectorApp.jsx`
- Main container, handles keyboard events
- Fetches config from backend
- Manages spin state machine

#### `RouletteWheel.jsx`
- SVG or Canvas-based wheel rendering
- CSS transform for rotation animation
- Calculates final angle based on selection algorithm

#### Selection Algorithm
```javascript
function selectWinner(config, members) {
  const { mode, rigged, weights } = config;
  
  if (mode === 'rigged') {
    return getRiggedWinner(rigged, members);
  }
  
  if (mode === 'weighted') {
    return getWeightedRandom(members, weights);
  }
  
  // Pure random
  return members[Math.floor(Math.random() * members.length)];
}

function getRiggedWinner(rigged, members) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check schedule first (specific dates override)
  if (rigged.schedule?.[today]) {
    return members.find(m => m.id === rigged.schedule[today]);
  }
  
  // Check fixed
  if (rigged.type === 'fixed' && rigged.fixedMember) {
    return members.find(m => m.id === rigged.fixedMember);
  }
  
  // Weekly rotation
  if (rigged.type === 'weekly' && rigged.weeklyRotation?.enabled) {
    const startDate = new Date(rigged.weeklyRotation.startDate);
    const weeksSinceStart = Math.floor((Date.now() - startDate) / (7 * 24 * 60 * 60 * 1000));
    const order = rigged.weeklyRotation.order;
    const index = weeksSinceStart % order.length;
    return members.find(m => m.id === order[index]);
  }
  
  // Fallback to random
  return members[Math.floor(Math.random() * members.length)];
}
```

### Spin Animation

```javascript
function calculateSpinAngle(selectedIndex, memberCount, config) {
  const segmentAngle = 360 / memberCount;
  const selectedSegmentCenter = selectedIndex * segmentAngle + (segmentAngle / 2);
  
  // Random number of full spins
  const fullSpins = randomBetween(config.minSpins, config.maxSpins);
  
  // Final angle: full rotations + offset to land on selected segment
  // Subtract from 360 because wheel spins clockwise but segments are indexed counter-clockwise
  const finalAngle = (fullSpins * 360) + (360 - selectedSegmentCenter);
  
  return finalAngle;
}
```

### Backend API

```javascript
// GET /api/family-selector/config
// Returns the full configuration

// GET /api/family-selector/spin
// Server-side spin (optional, for audit trail)
// Returns: { winner: "kc", spinId: "uuid", timestamp: "..." }

// POST /api/family-selector/log
// Log a spin result for history
// Body: { winner: "kc", context: "dinner-choice" }
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| History Display | **No** | Keep UI clean, no spin history shown |
| Animation | **Pure CSS** | Use CSS transforms where possible, minimal JS |
| Rigging Behavior | **Hidden** | Rigged spins appear random; wheel lands on predetermined winner naturally |
| Minimum Members | **2 required** | Wheel disabled/hidden with fewer than 2 members |

## Open Questions

### Product/UX

1. ~~**History Display**~~: ✅ No history display
2. **Context Selection**: Should user be able to specify what they're selecting for? (chores, dinner, etc.)
3. **Exclusion Mode**: Allow temporarily removing members? ("Child2 is at a sleepover")
4. **Team Mode**: Support selecting multiple winners? (2 people for a team)
5. **TV Remote Navigation**: How do we handle focus management on the wheel segments for accessibility?

### Technical

6. ~~**Animation Library**~~: ✅ Pure CSS transforms
7. **Canvas vs SVG**: SVG is easier to style, Canvas better for complex effects—which to use?
8. **Sound**: Should audio be baked in or optional via config?
9. **Mobile Support**: Touch interaction for manual spinning (swipe gesture)?
10. **Persistence**: Should spin results be logged to a database for fairness auditing?

### Configuration

11. **Weighted Display**: In weighted mode, should segments be visually sized by weight?
12. ~~**Secret Rigging**~~: ✅ Hidden rigging—spins always appear random
13. **Override UI**: Should there be an admin UI to quickly change the rigged winner?
14. **Time-of-Day**: Support different weights for different times? (kids more likely for evening chores)

### Edge Cases

15. ~~**Single Member**~~: ✅ Wheel disabled for < 2 members
16. **All Members Excluded**: Error state or disable spin?
17. **Mid-Spin Interrupt**: Allow canceling a spin? What state does it return to?
18. **Network Failure**: If server-side spin fails, fall back to client-side?

## Future Enhancements

- **Voice Activation**: "Hey Daylight, spin the wheel"
- **Streak Tracking**: "KC has been selected 3 times in a row!"
- **Fairness Mode**: Track history and bias toward under-selected members
- **Custom Wheels**: Different wheels for different purposes (chores, games, meals)
- **Shareable Results**: Generate image/GIF of spin result for sharing

## Implementation Plan

### Phase 1: Static Wheel (MVP)
**Estimated: 2-3 hours**

| Task | File | Description |
|------|------|-------------|
| 1.1 | `FamilySelectorApp.jsx` | Create component shell with props/URL param parsing |
| 1.2 | `FamilySelectorApp.scss` | Basic layout: centered wheel container, title, instruction text |
| 1.3 | `FamilySelectorApp.jsx` | Render SVG wheel with hardcoded 4 segments |
| 1.4 | `FamilySelectorApp.scss` | Style wheel segments with distinct colors |
| 1.5 | `FamilySelectorApp.jsx` | Add avatar images to each segment (or initials fallback) |
| 1.6 | `FamilySelectorApp.scss` | Add fixed pointer/indicator element |
| 1.7 | `RootApp.jsx` | Register route `/app/family-selector` |

**Deliverable**: Static wheel displays on screen with avatars, no interaction.

---

### Phase 2: Spin Animation
**Estimated: 2-3 hours**

| Task | File | Description |
|------|------|-------------|
| 2.1 | `FamilySelectorApp.jsx` | Add state machine: `idle` → `spinning` → `result` |
| 2.2 | `FamilySelectorApp.jsx` | Add keyboard listener for Space/Enter |
| 2.3 | `FamilySelectorApp.jsx` | Calculate target rotation angle based on random winner |
| 2.4 | `FamilySelectorApp.scss` | CSS `@keyframes` for spin with `cubic-bezier` easing |
| 2.5 | `FamilySelectorApp.jsx` | Apply dynamic `transform: rotate(Xdeg)` via inline style |
| 2.6 | `FamilySelectorApp.jsx` | Transition to `result` state after animation ends (`onTransitionEnd`) |
| 2.7 | `FamilySelectorApp.scss` | Winner highlight effect (glow/pulse on winning segment) |

**Deliverable**: Press Space → wheel spins → lands on random person → winner highlighted.

---

### Phase 3: Rigged Selection
**Estimated: 1-2 hours**

| Task | File | Description |
|------|------|-------------|
| 3.1 | `FamilySelectorApp.jsx` | Parse `winner` prop and `?winner=` URL param |
| 3.2 | `FamilySelectorApp.jsx` | If rigged, calculate angle to land on specified member |
| 3.3 | `FamilySelectorApp.jsx` | Add random variance to spin count (3-6 rotations) for natural feel |
| 3.4 | — | Test: verify rigged spin looks identical to random spin |

**Deliverable**: `?winner=kc` always lands on KC, indistinguishable from random.

---

### Phase 4: Configuration Integration
**Estimated: 2-3 hours**

| Task | File | Description |
|------|------|-------------|
| 4.1 | `config/apps/family-selector.yml` | Create config file with members array |
| 4.2 | `backend/api.mjs` | Add endpoint `GET /api/family-selector/config` |
| 4.3 | `FamilySelectorApp.jsx` | Fetch config on mount, replace hardcoded members |
| 4.4 | `FamilySelectorApp.jsx` | Support dynamic segment count (2-8 members) |
| 4.5 | `FamilySelectorApp.scss` | Responsive segment sizing based on member count |
| 4.6 | `FamilySelectorApp.jsx` | Implement `exclude` prop to filter members |
| 4.7 | `FamilySelectorApp.jsx` | Show disabled state when < 2 active members |

**Deliverable**: Wheel dynamically renders from config, exclusions work.

---

### Phase 5: Polish & Edge Cases
**Estimated: 1-2 hours**

| Task | File | Description |
|------|------|-------------|
| 5.1 | `FamilySelectorApp.jsx` | Add cooldown state to prevent spam-spinning |
| 5.2 | `FamilySelectorApp.jsx` | Handle `R` key to re-spin from result state |
| 5.3 | `FamilySelectorApp.jsx` | Handle `Escape` to reset to idle |
| 5.4 | `FamilySelectorApp.scss` | Add entrance animation on mount |
| 5.5 | `FamilySelectorApp.jsx` | Implement `autoSpin` prop for kiosk mode |
| 5.6 | `FamilySelectorApp.scss` | Responsive sizing for TV vs desktop |
| 5.7 | — | Cross-browser testing (Chrome, Safari, TV WebView) |

**Deliverable**: Production-ready component with all interactions polished.

---

### Phase 6: Optional Enhancements
**Estimated: As needed**

| Task | Description | Priority |
|------|-------------|----------|
| 6.1 | Add confetti animation on winner reveal | Low |
| 6.2 | Add sound effects (spin, tick, winner) | Low |
| 6.3 | Weekly rotation logic from config | Medium |
| 6.4 | Schedule-based rigging (specific dates) | Medium |
| 6.5 | Weighted random mode | Low |
| 6.6 | Backend logging of spin results | Low |

---

### File Checklist

```
frontend/src/Apps/
├── FamilySelectorApp.jsx      ← New
├── FamilySelectorApp.scss     ← New

config/apps/
├── family-selector.yml        ← New

backend/
├── api.mjs                    ← Add endpoint
```

### Estimated Total: 8-13 hours

## Dependencies

- React (existing)
- CSS Animations or animation library (TBD)
- Canvas/SVG rendering
- Optional: Howler.js for audio, canvas-confetti for celebration effects

## Acceptance Criteria

- [ ] Wheel displays all configured family members with avatars
- [ ] Space/Enter/Play triggers spin animation
- [ ] Spin lands on predetermined winner in rigged mode
- [ ] Spin is truly random in random mode
- [ ] Winner is visually highlighted
- [ ] Configuration is loaded from YAML
- [ ] Works on TV interface (remote control)
- [ ] Accessible (keyboard navigation, screen reader announcements)
