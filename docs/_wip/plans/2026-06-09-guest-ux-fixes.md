# Guest UX Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the actionable findings from `docs/_wip/audits/2026-06-09-guest-assignment-ux-lifecycle-audit.md` — strap-color visibility (N1/§3), multi-Guest picker fix (N2), numbered Guest labels (N3), kid guest zone profiles (N4), visible tagging feedback via placeholder tiers (N5), threshold microcopy (N6), outcome-based labels (N7), picker explainer (N9), and guest chips in session reports (N10).

**Architecture:** Pure logic moves into small testable libs under `frontend/src/modules/Fitness/lib/` (strap colors, guest-options builder, placeholders); the React components (`FitnessSidebarMenu.jsx`, `FitnessUsers.jsx`) become thin consumers. Guest metadata (`ageClass`, `zones`) rides the existing assignment-metadata pipeline (menu → FitnessContext → GuestAssignmentService → DeviceAssignmentLedger → UserManager/PersistenceManager) — no new state systems.

**Tech Stack:** React 18 (JSX, `.jsx`), plain JS libs (`.js`), SCSS, Vitest for colocated frontend tests (verified working: `npx vitest run <path>` from repo root).

**Excluded (need design/brainstorming first, not plannable as code tasks):** G1 pre-session lobby, G3 HR-anomaly swap detection, G10 in-app config write-back, persisting EventJournal guest events into the saved timeline.

---

## Context Primer (read first)

You are working in the DaylightStation repo. The Fitness app is a kiosk React SPA. Key facts:

- **Guest assignment flow:** tapping an HR device card in the sidebar opens `FitnessSidebarMenu` (`frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`) in `mode='guest'`. Picking a person calls `assignGuestToDevice(deviceId, metadata)` from `FitnessContext` (`frontend/src/context/FitnessContext.jsx`), which routes through `GuestAssignmentService` into the `DeviceAssignmentLedger` (`frontend/src/hooks/fitness/DeviceAssignmentLedger.js`). Ledger records have shape `{ deviceId, occupantName, occupantId, occupantType, entityId, metadata: {…}, updatedAt }`.
- **Zone overrides:** `UserManager.resolveUserForDevice` (`frontend/src/hooks/fitness/UserManager.js:526-556`) reads `ledgerEntry.metadata.zones` — it must be an **Array** (e.g. `[{ id: 'active', min: 95 }]`) and is passed as `zoneOverrides` into `buildZoneConfig` (`frontend/src/hooks/fitness/types.js`). This plumbing exists and works; no UI sets it today.
- **Device colors:** `fitness.yml → device_colors.heart_rate` maps deviceId → color name (the household puts matching colored stickers on physical straps). In `FitnessUsers.jsx` this surfaces ONLY as a heart emoji (`CONFIG.heartRate.colorIcons`, lines 82-90) — and the map is missing `purple`/`beige`/`teal`, the exact configured guest colors.
- **Persistence:** `PersistenceManager.js` `buildParticipantsForPersist(roster, deviceAssignments)` (lines ~162-209) writes the saved-session `participants:` block (`display_name`, `hr_device`, `is_primary`/`is_guest`, `base_user`). It already receives device-assignment snapshots with metadata.
- **Reports:** saved sessions render in `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx`; the roster comes from `frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.js` (reads `meta.is_primary` but currently ignores `is_guest`).
- **Tests:** colocated `*.test.js(x)` under `frontend/src/` run with Vitest from the repo root: `npx vitest run <file>`. Globals (`describe`/`it`/`expect`) are enabled. Follow existing patterns (e.g. `frontend/src/hooks/fitness/GuestAssignmentService.threshold.test.js`).
- **Project rules (CLAUDE.md):** do NOT commit to main directly — work in a git worktree on branch `feature/guest-ux-fixes`, merge to main when done, then delete the branch (record it in `docs/_archive/deleted-branches.md`). Do NOT run `deploy.sh`. Never use raw `console.log` — use the logging framework (`getLogger()`), though these tasks need no new log events beyond what exists.
- **Avatar images** live server-side under the household data path (`/static/img/users/{id}`), NOT in this repo. All image code must tolerate 404s (the existing `onError` fallback chains do this — preserve that property).

Setup:

```bash
git worktree add ../DaylightStation-guest-ux feature/guest-ux-fixes
cd ../DaylightStation-guest-ux
```

---

### Task 1: Strap-color lib (emoji, CSS color, hash fallback, label)

Foundation for N1 and §3. Pure functions, no React.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/strapColors.js`
- Create: `frontend/src/modules/Fitness/lib/strapColors.test.js`

**Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/lib/strapColors.test.js
import {
  heartEmojiForColor,
  cssColorForStrap,
  hashColorForDevice,
  strapLabel
} from './strapColors.js';

describe('heartEmojiForColor', () => {
  it('maps the classic colors', () => {
    expect(heartEmojiForColor('red')).toBe('❤️');
    expect(heartEmojiForColor('green')).toBe('💚');
  });
  it('maps the configured guest-slot colors (audit N1)', () => {
    expect(heartEmojiForColor('purple')).toBe('💜');
    expect(heartEmojiForColor('beige')).toBe('🤎');
    expect(heartEmojiForColor('teal')).toBe('🩵');
  });
  it('is case-insensitive and falls back to orange', () => {
    expect(heartEmojiForColor('PURPLE')).toBe('💜');
    expect(heartEmojiForColor('chartreuse')).toBe('🧡');
    expect(heartEmojiForColor(null)).toBe('🧡');
  });
});

describe('cssColorForStrap', () => {
  it('returns a hex for known colors and null for unknown', () => {
    expect(cssColorForStrap('purple')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cssColorForStrap('teal')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cssColorForStrap('nope')).toBeNull();
    expect(cssColorForStrap(undefined)).toBeNull();
  });
});

describe('hashColorForDevice', () => {
  it('is deterministic per device id', () => {
    expect(hashColorForDevice('51234')).toBe(hashColorForDevice('51234'));
  });
  it('differs across nearby ids', () => {
    expect(hashColorForDevice('51234')).not.toBe(hashColorForDevice('51235'));
  });
  it('returns an hsl() string', () => {
    expect(hashColorForDevice('99999')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });
});

describe('strapLabel', () => {
  it('formats a human label', () => {
    expect(strapLabel('purple')).toBe('Purple strap');
    expect(strapLabel('TEAL')).toBe('Teal strap');
  });
  it('returns null without a color', () => {
    expect(strapLabel(null)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/strapColors.test.js`
Expected: FAIL — `Cannot find module './strapColors.js'`

**Step 3: Write the implementation**

```javascript
// frontend/src/modules/Fitness/lib/strapColors.js
// Single source of truth for physical strap-sticker colors
// (fitness.yml → device_colors.heart_rate) as they surface in the UI.

const COLOR_EMOJI = {
  red: '❤️', orange: '🧡', yellow: '💛', green: '💚', blue: '💙',
  purple: '💜', beige: '🤎', brown: '🤎', teal: '🩵', pink: '🩷',
  white: '🤍', watch: '🤍', black: '🖤', gray: '🩶', grey: '🩶'
};

const COLOR_HEX = {
  red: '#ff6b6b', orange: '#ff922b', yellow: '#f0c836', green: '#51cf66',
  blue: '#6ab8ff', purple: '#b07cf7', beige: '#d2b48c', brown: '#a87c4f',
  teal: '#2cc1c1', pink: '#f783ac', white: '#e9ecef', watch: '#e9ecef',
  black: '#868e96', gray: '#adb5bd', grey: '#adb5bd'
};

const FALLBACK_EMOJI = '🧡';

const norm = (color) => (color == null ? null : String(color).trim().toLowerCase() || null);

export function heartEmojiForColor(color) {
  const key = norm(color);
  if (!key) return FALLBACK_EMOJI;
  return COLOR_EMOJI[key] || FALLBACK_EMOJI;
}

export function cssColorForStrap(color) {
  const key = norm(color);
  if (!key) return null;
  return COLOR_HEX[key] || null;
}

// Deterministic per-device color for straps with no configured color, so
// simultaneous unknown devices are at least visually distinct (audit §3).
export function hashColorForDevice(deviceId) {
  const str = String(deviceId ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function strapLabel(color) {
  const key = norm(color);
  if (!key) return null;
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} strap`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/lib/strapColors.test.js`
Expected: PASS (all)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/strapColors.js frontend/src/modules/Fitness/lib/strapColors.test.js
git commit -m "feat(fitness): strap-color lib — emoji/css/hash/label for sticker colors (audit N1/§3)"
```

---

### Task 2: Wire heart emoji through the lib (fixes the missing purple/beige/teal)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` (CONFIG block ~lines 82-91; `heartColorIcon` ~lines 470-474)

**Step 1: Replace `heartColorIcon` to delegate to the lib**

Add the import at the top of the file (with the other `../lib/` imports if any, otherwise after the existing imports):

```javascript
import { heartEmojiForColor } from '../../lib/strapColors.js';
```

Replace the function body (currently `FitnessUsers.jsx:470-474`):

```javascript
  const heartColorIcon = (deviceId) => heartEmojiForColor(hrColorMap[String(deviceId)]);
```

**Step 2: Delete the now-dead CONFIG block**

Remove the `heartRate:` block from `CONFIG` (lines ~82-91):

```javascript
  heartRate: {
    colorIcons: { red: '❤️', yellow: '💛', green: '💚', blue: '💙', watch: '🤍', orange: '🧡' },
    fallbackIcon: '🧡'
  },
```

Verify nothing else references it: `grep -n "heartRate\.\|CONFIG.heartRate" frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` — expect zero hits after the edit.

**Step 3: Verify no regressions in the colocated suite**

Run: `npx vitest run frontend/src/modules/Fitness frontend/src/hooks/fitness`
Expected: PASS (same pass count as before the change)

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "fix(fitness): purple/beige/teal guest straps get matching heart emoji, not 🧡 fallback (audit N1a)"
```

---

### Task 3: Extract `buildGuestOptions` into a pure, tested lib (characterization)

The picker-option logic currently lives in a `useMemo` (`FitnessSidebarMenu.jsx:167-272`) and is untestable. Extract it verbatim (NO behavior change in this task — the singleton bug is fixed in Task 4).

**Files:**
- Create: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js`
- Create: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx:167-272`

**Step 1: Write characterization tests (current behavior, including the bug)**

```javascript
// frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js
import { buildGuestOptions } from './guestOptionsBuilder.js';

const friend = (id, name) => ({ id, name, profileId: id, category: 'Friend' });

describe('buildGuestOptions — characterization', () => {
  it('offers generic Guest plus tab-filtered candidates', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve')],
      deviceAssignments: [],
      selectedTab: 'friends'
    });
    expect(out.topOptions.map(o => o.id)).toContain('guest');
    expect(out.filteredOptions.map(o => o.id)).toEqual(['eve']);
  });

  it('shows Original when a guest displaces the base user', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [],
      activeAssignment: { occupantName: 'Eve', metadata: { name: 'Eve', candidateId: 'eve' } },
      baseName: 'Alice',
      baseUserId: 'alice',
      selectedTab: 'friends'
    });
    const original = out.topOptions.find(o => o.isOriginal);
    expect(original).toMatchObject({ id: 'alice', name: 'Alice', source: 'Original' });
  });

  it('excludes candidates assigned to any device', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve'), friend('dave', 'Dave')],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'eve', profileId: 'eve' }, occupantId: 'eve' }],
      selectedTab: 'friends'
    });
    expect(out.filteredOptions.map(o => o.id)).toEqual(['dave']);
  });

  it('allowWhileAssigned candidates bypass the exclusion', () => {
    const out = buildGuestOptions({
      guestCandidates: [{ ...friend('alice', 'Alice'), allowWhileAssigned: true }],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'alice', profileId: 'alice' }, occupantId: 'alice' }],
      selectedTab: 'family'  // returnees are tagged Family in FitnessSidebar
    });
    // not excluded — Alice can reclaim
    expect(out.topOptions.concat(out.filteredOptions).some(o => o.id === 'alice' || o.id === 'guest')).toBe(true);
  });

  it('excludes actively-broadcasting HR participants (Bug 06)', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve')],
      deviceAssignments: [],
      activeHeartRateParticipants: [{ isActive: true, id: 'eve', profileId: 'eve', name: 'Eve' }],
      selectedTab: 'friends'
    });
    expect(out.filteredOptions).toEqual([]);
  });

  it('hides generic Guest on the device where it is currently selected', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'guest', profileId: 'guest_111' }, occupantId: 'guest_111', occupantName: 'Guest' }],
      activeAssignment: { occupantName: 'Guest', metadata: { name: 'Guest', candidateId: 'guest', profileId: 'guest_111' } },
      selectedTab: 'friends'
    });
    expect(out.topOptions.some(o => o.id === 'guest')).toBe(false);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: FAIL — module not found.

**Step 3: Create the lib by moving the memo body**

Copy the body of the `guestOptions` memo (`FitnessSidebarMenu.jsx:167-272`, from `const seen = new Set();` through the `return { topOptions, filteredOptions }`) into:

```javascript
// frontend/src/modules/Fitness/lib/guestOptionsBuilder.js
// Pure builder for the guest-picker option lists. Extracted from
// FitnessSidebarMenu so the exclusion/tab logic is unit-testable.

export function buildGuestOptions({
  guestCandidates = [],
  deviceAssignments = [],
  activeAssignment = null,
  activeHeartRateParticipants = [],
  baseName = null,
  baseUserId = null,
  selectedTab = 'friends'
} = {}) {
  // <<< PASTE the memo body here, with two mechanical substitutions: >>>
  // 1. The original line
  //      const baseUserId = fitnessContext?.getUserByName?.(baseName)?.id;
  //    is GONE — `baseUserId` is now a parameter (the component passes it in).
  // 2. Everything else is verbatim: multiAssignableKeys build, currentlySelectedId,
  //    deviceAssignments exclusion loop, activeHeartRateParticipants exclusion,
  //    Original top option, generic Guest top option, tab filter, withAvatars.
  // Returns { topOptions, filteredOptions }.
}
```

**Step 4: Wire the component to the lib**

In `FitnessSidebarMenu.jsx`, add the import:

```javascript
import { buildGuestOptions } from '../../lib/guestOptionsBuilder.js';
```

Replace the memo (lines 167-272) with:

```javascript
  const guestOptions = React.useMemo(() => buildGuestOptions({
    guestCandidates,
    deviceAssignments,
    activeAssignment,
    activeHeartRateParticipants,
    baseName,
    baseUserId: baseName ? (fitnessContext?.getUserByName?.(baseName)?.id ?? null) : null,
    selectedTab
  }), [guestCandidates, activeAssignment, baseName, deviceIdStr, selectedTab, deviceAssignments, activeHeartRateParticipants, fitnessContext]);
```

**Step 5: Run tests**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js && npx vitest run frontend/src/modules/Fitness frontend/src/hooks/fitness`
Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/lib/guestOptionsBuilder.js frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "refactor(fitness): extract guest picker option builder into pure tested lib"
```

---

### Task 4: Fix N2 — generic Guest must stay available while assigned on other devices

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js`
- Test: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`

**Step 1: Write the failing test**

```javascript
describe('buildGuestOptions — multi-Guest (audit N2)', () => {
  it('still offers generic Guest on device B while device A has a generic Guest', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [{ deviceId: 'A', metadata: { candidateId: 'guest', profileId: 'guest_A' }, occupantId: 'guest_A', occupantName: 'Guest' }],
      activeAssignment: null, // we are opening the menu for device B
      selectedTab: 'friends'
    });
    expect(out.topOptions.some(o => o.id === 'guest' && o.isGeneric)).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: the new test FAILS (Guest is excluded); all characterization tests still pass.

**Step 3: Implement**

In `buildGuestOptions`, immediately after the `multiAssignableKeys` set is built from candidates, add:

```javascript
  // W2: generic "Guest" is a per-device alias (guest_<deviceId>), so the raw
  // 'guest' candidate id must never globally block the option. The
  // currently-selected check (currentlySelectedId) still hides it on the
  // device where it is actively assigned.
  multiAssignableKeys.add('guest');
```

**Step 4: Run tests**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: PASS — including the Task 3 test "hides generic Guest on the device where it is currently selected" (the `currentlySelectedId` path adds `'guest'` to `seen` independently of the assignments loop).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/guestOptionsBuilder.js frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js
git commit -m "fix(fitness): allow simultaneous generic Guests on multiple devices (audit N2)"
```

---

### Task 5: N3 — numbered generic Guest display names

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js` (add export)
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (`handleAssignGuest`, ~lines 301-317)
- Test: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`

**Step 1: Write the failing test**

```javascript
import { buildGuestOptions, nextGenericGuestName } from './guestOptionsBuilder.js';

describe('nextGenericGuestName (audit N3)', () => {
  const generic = (deviceId, name) => ({
    deviceId, occupantName: name,
    metadata: { candidateId: 'guest', profileId: `guest_${deviceId}`, name }
  });

  it('first guest is plain "Guest"', () => {
    expect(nextGenericGuestName([])).toBe('Guest');
  });
  it('second guest is "Guest 2"', () => {
    expect(nextGenericGuestName([generic('A', 'Guest')])).toBe('Guest 2');
  });
  it('numbers past the highest existing, avoiding collisions', () => {
    expect(nextGenericGuestName([generic('A', 'Guest'), generic('B', 'Guest 2')])).toBe('Guest 3');
    expect(nextGenericGuestName([generic('B', 'Guest 2')])).toBe('Guest 3');
  });
  it('ignores named-guest assignments', () => {
    expect(nextGenericGuestName([{ deviceId: 'A', occupantName: 'Eve', metadata: { candidateId: 'eve' } }])).toBe('Guest');
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: FAIL — `nextGenericGuestName` is not exported.

**Step 3: Implement in the lib**

```javascript
// Append to guestOptionsBuilder.js
export function nextGenericGuestName(deviceAssignments = []) {
  const genericNames = (deviceAssignments || [])
    .filter((a) => String(a?.metadata?.candidateId || '') === 'guest')
    .map((a) => String(a?.occupantName || a?.metadata?.name || '').trim());
  if (genericNames.length === 0) return 'Guest';
  let highest = 1;
  genericNames.forEach((n) => {
    const m = /^Guest(?: (\d+))?$/.exec(n);
    if (m) highest = Math.max(highest, m[1] ? parseInt(m[1], 10) : 1);
  });
  return `Guest ${highest + 1}`;
}
```

**Step 4: Use it at assign time**

In `FitnessSidebarMenu.jsx` `handleAssignGuest` (~line 301), import `nextGenericGuestName` alongside `buildGuestOptions` and change the assignment call:

```javascript
  const handleAssignGuest = (option) => {
    if (!assignGuestToDevice || !deviceIdStr) return;
    const profileId = option.isGeneric
      ? `guest_${deviceIdStr}`
      : (option.profileId || option.id);
    const name = option.isGeneric
      ? nextGenericGuestName(deviceAssignments)
      : option.name;
    assignGuestToDevice(deviceIdStr, {
      name,
      profileId,
      candidateId: option.id,
      source: option.source,
      baseUserName: baseName
    });
    if (onClose) onClose();
  };
```

**Step 5: Run tests + commit**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/lib/guestOptionsBuilder.js frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "feat(fitness): number simultaneous generic Guests — Guest, Guest 2, ... (audit N3)"
```

---

### Task 6: N7 — outcome-based labels

Pure string changes; no unit test (manual verify in Task 14).

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`

**Step 1: Rename "Remove User"** (~line 542): change the button text from `⛔ Remove User` to:

```jsx
            ⛔ Ignore This Strap
```

**Step 2: Rename the "Original" badge.** In `buildGuestOptions` (the lib — the Original top option), change `source: 'Original'` to `source: 'Give back'`. Update the Task 3 characterization test expectation (`source: 'Original'` → `source: 'Give back'`).

**Step 3: Run tests**

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
Expected: PASS after the expectation update.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/lib/guestOptionsBuilder.js frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "feat(fitness): outcome-based guest menu labels — 'Ignore This Strap', 'Give back' (audit N7)"
```

---

### Task 7: N9 — explainer line for unrecognized straps in the picker

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (`renderGuestAssignment`, ~line 501)
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.scss` (this file holds the `.guest-option` styles)

**Step 1: Add the hint markup.** At the top of `renderGuestAssignment`'s main return (`<div className="guest-mode-content">`, before the top-options section):

```jsx
        {!baseName && (
          <div className="guest-menu-hint">
            Unrecognized heart-rate strap <strong>{monitorLabel}</strong>.
            Pick who’s wearing it — or “Guest” if they’re visiting.
          </div>
        )}
```

(`baseName` is null exactly when the device has no configured owner and no preserved `baseUserName` — i.e. a Pikachu.)

**Step 2: Style.** In `FitnessSidebar.scss`, next to the other `guest-` rules:

```scss
.guest-menu-hint {
  padding: 0.5rem 0.75rem;
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  border-left: 3px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;

  strong { color: #fff; }
}
```

**Step 3: Verify the suite still passes, commit**

Run: `npx vitest run frontend/src/modules/Fitness`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx frontend/src/modules/Fitness/player/FitnessSidebar.scss
git commit -m "feat(fitness): explain unrecognized straps in the guest picker (audit N9)"
```

---

### Task 8: N6 — sub-threshold transfer microcopy

Show "the last N min will transfer" only when it's true: an active assignment younger than the continuous-usage threshold.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.scss`

**Step 1: Compute the condition.** Near the existing `activeAssignment` derivation (~line 55-64), add:

```javascript
  // Continuous-usage threshold (fitness.yml → governance.usage_threshold_seconds,
  // 300s default — same resolution FitnessContext uses for GuestAssignmentService).
  const fitnessRoot = fitnessContext?.fitnessConfiguration?.fitness
    || fitnessContext?.fitnessConfiguration
    || {};
  const usageThresholdSeconds = fitnessRoot?.governance?.usage_threshold_seconds;
  const usageThresholdMs = (Number.isFinite(usageThresholdSeconds) ? usageThresholdSeconds : 300) * 1000;
  const segmentAgeMs = Number.isFinite(activeAssignment?.updatedAt)
    ? Date.now() - activeAssignment.updatedAt
    : null;
  const segmentWillTransfer = Number.isFinite(segmentAgeMs) && segmentAgeMs < usageThresholdMs;
```

**Step 2: Render the note.** In `renderGuestAssignment`, directly under the Task 7 hint block:

```jsx
        {segmentWillTransfer && (
          <div className="guest-menu-note">
            {currentLabel}’s last {Math.max(1, Math.round(segmentAgeMs / 60000))} min on this
            strap will transfer to whoever you pick.
          </div>
        )}
```

**Step 3: Style.**

```scss
.guest-menu-note {
  padding: 0.4rem 0.75rem;
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: #ffd76a;
  background: rgba(255, 215, 106, 0.08);
  border-radius: 4px;
}
```

**Step 4: Run suite, commit**

Run: `npx vitest run frontend/src/modules/Fitness`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx frontend/src/modules/Fitness/player/FitnessSidebar.scss
git commit -m "feat(fitness): surface sub-threshold transfer in guest picker (audit N6)"
```

---

### Task 9: N4 — "Guest (kid)" with configured zone profile

Three parts: config-driven kid option in the builder; zones map→array converter; pass-through at assign time; persistence of `guest_profile`.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.js`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (`buildParticipantsForPersist`, ~lines 162-209)
- Test: `frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js`
- Test: `frontend/src/hooks/fitness/PersistenceManager.guestProfile.test.js` (new)

**Step 1: Failing tests for the builder + converter**

```javascript
import { buildGuestOptions, nextGenericGuestName, zonesMapToArray } from './guestOptionsBuilder.js';

describe('Guest (kid) option (audit N4)', () => {
  it('adds a kid generic option when guestProfiles.kid is configured', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [],
      selectedTab: 'friends',
      guestProfiles: { kid: { zones: { active: 95, warm: 130, hot: 155, fire: 175 } } }
    });
    const kid = out.topOptions.find(o => o.id === 'guest-kid');
    expect(kid).toMatchObject({ isGeneric: true, ageClass: 'kid', source: 'Kid' });
    // adult generic still present
    expect(out.topOptions.some(o => o.id === 'guest')).toBe(true);
  });

  it('omits the kid option without config', () => {
    const out = buildGuestOptions({ guestCandidates: [], deviceAssignments: [], selectedTab: 'friends' });
    expect(out.topOptions.some(o => o.id === 'guest-kid')).toBe(false);
  });
});

describe('zonesMapToArray', () => {
  it('converts a users.yml-style zone map to the ledger array shape', () => {
    expect(zonesMapToArray({ active: 95, warm: 130 })).toEqual([
      { id: 'active', min: 95 },
      { id: 'warm', min: 130 }
    ]);
  });
  it('returns null for empty/invalid input', () => {
    expect(zonesMapToArray(null)).toBeNull();
    expect(zonesMapToArray({})).toBeNull();
    expect(zonesMapToArray({ active: 'high' })).toBeNull();
  });
});
```

**Step 2: Run to verify failures**, then implement in the lib:

```javascript
// In buildGuestOptions: accept `guestProfiles = null` in the destructured params.
// Right after the existing generic-guest topOptions push, add:
    if (guestProfiles?.kid && !seen.has('guest-kid')) {
      seen.add('guest-kid');
      topOptions.push({ id: 'guest-kid', name: 'Guest', source: 'Kid', isGeneric: true, ageClass: 'kid' });
    }
// And alongside multiAssignableKeys.add('guest'):
    multiAssignableKeys.add('guest-kid');

// New export:
export function zonesMapToArray(zonesMap) {
  if (!zonesMap || typeof zonesMap !== 'object') return null;
  const entries = Object.entries(zonesMap)
    .filter(([, min]) => Number.isFinite(min))
    .map(([id, min]) => ({ id, min }));
  // Reject if any configured value was non-numeric (misconfiguration) or empty
  if (entries.length === 0 || entries.length !== Object.keys(zonesMap).length) return null;
  return entries;
}
```

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js` — PASS.

**Step 3: Wire the menu.** In `FitnessSidebarMenu.jsx`:

```javascript
// Near the fitnessRoot derivation from Task 8:
  const guestProfiles = fitnessRoot?.guest_profiles || null;

// Pass into the builder memo:  guestProfiles,
// (add `guestProfiles` to the memo dependency array)

// In handleAssignGuest, build the metadata with age class + zones:
  const handleAssignGuest = (option) => {
    if (!assignGuestToDevice || !deviceIdStr) return;
    const profileId = option.isGeneric
      ? `guest_${deviceIdStr}`
      : (option.profileId || option.id);
    const name = option.isGeneric ? nextGenericGuestName(deviceAssignments) : option.name;
    const ageClass = option.ageClass || null;
    const zones = ageClass ? zonesMapToArray(guestProfiles?.[ageClass]?.zones) : null;
    assignGuestToDevice(deviceIdStr, {
      name,
      profileId,
      candidateId: option.id,
      source: option.source,
      baseUserName: baseName,
      ...(ageClass ? { ageClass } : {}),
      ...(zones ? { zones } : {})
    });
    if (onClose) onClose();
  };
```

The `zones` array flows untouched through `assignGuestToDevice` → ledger `metadata.zones` → `UserManager.resolveUserForDevice` (`UserManager.js:532`), which already applies it via `buildZoneConfig`. The `ZONE_OVERRIDE_APPLIED` event (`GuestAssignmentService.js:320-327`) fires automatically — existing logging covers this feature.

**Step 4: Persist `guest_profile`.** Failing test first:

```javascript
// frontend/src/hooks/fitness/PersistenceManager.guestProfile.test.js
// Persisting the guest age class (audit N4). Model construction on
// PersistenceManager.lateTagMerge.test.js — same harness, minimal session.
// Assert: a roster entry whose device assignment metadata carries
// ageClass: 'kid' produces participants[id].guest_profile === 'kid'
// alongside is_guest: true; entries without ageClass have no guest_profile key.
```

Write the test using the construction pattern from `PersistenceManager.lateTagMerge.test.js` (same mock session/roster shape; pass `deviceAssignments` containing `{ occupantId: 'guest_48291', deviceId: '90006', metadata: { ageClass: 'kid' } }`). Run it — FAIL.

Implement in `buildParticipantsForPersist` (`PersistenceManager.js`), inside the `participants[participantId] = { ... }` literal:

```javascript
    const guestAgeClass = assignment?.metadata?.ageClass || null;

    participants[participantId] = {
      ...(name ? { display_name: name } : {}),
      ...(hrDevice != null ? { hr_device: String(hrDevice) } : {}),
      ...(isPrimary ? { is_primary: true } : {}),
      ...(isGuest ? { is_guest: true } : {}),
      ...(isGuest && guestAgeClass ? { guest_profile: guestAgeClass } : {}),
      ...(entry.baseUserName ? { base_user: String(entry.baseUserName) } : {})
    };
```

Run: `npx vitest run frontend/src/hooks/fitness/PersistenceManager.guestProfile.test.js frontend/src/hooks/fitness` — PASS.

**Step 5: Document the config knob.** Add to the prod `fitness.yml` AFTER merge (manual, server-side — note for the operator, not this branch):

```yaml
guest_profiles:
  kid:
    zones: { active: 95, warm: 130, hot: 155, fire: 175 }
  # adult: omitted — adults use device defaults, same as today
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/lib/guestOptionsBuilder.js frontend/src/modules/Fitness/lib/guestOptionsBuilder.test.js frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx frontend/src/hooks/fitness/PersistenceManager.js frontend/src/hooks/fitness/PersistenceManager.guestProfile.test.js
git commit -m "feat(fitness): Guest (kid) option with configured zone profile, persisted as guest_profile (audit N4)"
```

---

### Task 10: N5 — placeholder tiers for generic Guests

Generic Guests stop looking like untagged Pikachus: distinct placeholder image IDs (`guest-adult`, `guest-kid`) with graceful fallback to `user` (Pikachu) when the asset doesn't exist yet.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/guestPlaceholders.js`
- Create: `frontend/src/modules/Fitness/lib/guestPlaceholders.test.js`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (`renderOption` img, ~line 471)
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` (card avatar, ~lines 1036-1049)

**Step 1: Failing test**

```javascript
// frontend/src/modules/Fitness/lib/guestPlaceholders.test.js
import { genericGuestImageId, isGenericGuestProfileId } from './guestPlaceholders.js';

describe('guest placeholders (audit N5)', () => {
  it('maps age class to placeholder image ids', () => {
    expect(genericGuestImageId('kid')).toBe('guest-kid');
    expect(genericGuestImageId('adult')).toBe('guest-adult');
    expect(genericGuestImageId(null)).toBe('guest-adult');
  });
  it('detects device-keyed generic guest profileIds', () => {
    expect(isGenericGuestProfileId('guest_48291')).toBe(true);
    expect(isGenericGuestProfileId('friend-b')).toBe(false);
    expect(isGenericGuestProfileId(null)).toBe(false);
  });
});
```

Run: `npx vitest run frontend/src/modules/Fitness/lib/guestPlaceholders.test.js` — FAIL.

**Step 2: Implement**

```javascript
// frontend/src/modules/Fitness/lib/guestPlaceholders.js
// Placeholder avatar tiers (audit N5 / Part 4):
//   untagged device            → 'user'        (Pikachu — unchanged, means "tag me")
//   generic Guest, adult       → 'guest-adult' (claimed-but-anonymous)
//   generic Guest, kid         → 'guest-kid'
// Assets live server-side at /static/img/users/<id>.jpg. If an asset is
// missing the existing <img onError> chains fall back to 'user', so this
// degrades to today's behavior until the images are dropped in.

export function genericGuestImageId(ageClass) {
  return ageClass === 'kid' ? 'guest-kid' : 'guest-adult';
}

export function isGenericGuestProfileId(profileId) {
  return typeof profileId === 'string' && profileId.startsWith('guest_');
}
```

Run the test — PASS.

**Step 3: Picker grid.** In `FitnessSidebarMenu.jsx` `renderOption`, change the img `src` (line ~472) so generic options use the placeholder:

```jsx
            <img
              src={DaylightMediaPath(`/static/img/users/${
                option.isGeneric ? genericGuestImageId(option.ageClass) : (option.profileId || option.id)
              }`)}
```

(import `genericGuestImageId` from `../../lib/guestPlaceholders.js`; the existing `onError` → `/static/img/users/user` chain stays.)

**Step 4: Sidebar card.** In `FitnessUsers.jsx`, where the HR avatar `<img>` renders (~line 1037), derive the image id:

```javascript
              const avatarImageId = isHeartRate && isGenericGuestProfileId(profileId)
                ? genericGuestImageId(guestAssignment?.metadata?.ageClass)
                : profileId;
```

and use `avatarImageId` in the `src`:

```jsx
                          src={DaylightMediaPath(`/static/img/users/${avatarImageId}`)}
```

(import both helpers from `../../lib/guestPlaceholders.js`; `onError` fallback to `user` unchanged.)

**Step 5: Run suite, commit**

Run: `npx vitest run frontend/src/modules/Fitness frontend/src/hooks/fitness`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/lib/guestPlaceholders.js frontend/src/modules/Fitness/lib/guestPlaceholders.test.js frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "feat(fitness): distinct placeholder avatars for generic Guests, adult vs kid (audit N5)"
```

**Operator note (post-merge, not code):** drop `guest-adult.jpg` and `guest-kid.jpg` into the household avatar directory on the prod host (same place as `user.jpg`). Until then, generic Guests keep showing Pikachu — no breakage.

---

### Task 11: §3 — strap color on the card: avatar ring + "Purple strap" labels + hash fallback

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.scss` (only if the inline style needs a supporting rule)

**Step 1: Extend the strapColors import** in `FitnessUsers.jsx`:

```javascript
import { heartEmojiForColor, cssColorForStrap, hashColorForDevice, strapLabel } from '../../lib/strapColors.js';
```

**Step 2: Color-name labels for unmapped devices.** In the card render where the display name resolves (~lines 938-946), after `deviceName = resolved.displayName;` add:

```javascript
                // §3: an unresolved card shows "Purple strap" instead of "#10366"
                // when the strap has a configured sticker color.
                if (resolved.source === 'fallback') {
                  const colorLabel = strapLabel(hrColorMap[deviceIdStr]);
                  if (colorLabel) {
                    deviceName = colorLabel;
                    deviceNameSource = 'strapColor';
                  }
                }
```

**Step 3: Avatar ring.** Where `avatarImageId` was added in Task 10, derive the ring color:

```javascript
              // §3: surface the physical sticker color as a saturated avatar ring.
              // Configured color wins; unidentified cards (no user, no assignment)
              // get a deterministic per-device hash color so simultaneous
              // Pikachus are visually distinct.
              const strapRingColor = isHeartRate
                ? (cssColorForStrap(hrColorMap[deviceIdStr])
                    || (!resolvedUser && !guestAssignment ? hashColorForDevice(deviceIdStr) : null))
                : null;
```

Apply it to the avatar div (~line 1033):

```jsx
                    <div
                      className={`card-avatar ${zoneClass}`}
                      style={strapRingColor ? { boxShadow: `0 0 0 3px ${strapRingColor}` } : undefined}
                    >
```

**Step 4: Manual verification** (this is visual; no unit test):

1. Confirm a dev server isn't already running: `lsof -i :3111` (see CLAUDE.md ports). Start `npm run dev` if needed.
2. Open `http://localhost:3111/fitness` and use the HR sim (`HRSimTrigger` is enabled on localhost) to start a simulated HR device with an ID that is in `device_colors.heart_rate` (e.g. 10366) and one that isn't (e.g. 51234).
3. Expect: 10366's card shows a purple ring, 💜 icon, and label "Purple strap"; 51234 shows a stable hash-colored ring with `#51234`.

**Step 5: Run suite, commit**

Run: `npx vitest run frontend/src/modules/Fitness frontend/src/hooks/fitness`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "feat(fitness): strap sticker color as avatar ring + color-name labels + hash fallback (audit §3)"
```

---

### Task 12: N10 — guest chip in the session-detail timeline

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.js` (~lines 92-108, roster map)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` (~lines 264-281 lanes memo + lane name `<text>` render)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss`
- Create: `frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.guest.test.js`

**Step 1: Failing adapter test**

```javascript
// frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.guest.test.js
import { createChartDataSource } from './sessionDataAdapter.js';

describe('sessionDataAdapter — guest flags (audit N10)', () => {
  it('exposes isGuest and guestProfile from the participants block', () => {
    const session = {
      participants: {
        'user-a': { display_name: 'User A', is_primary: true },
        'guest_48291': { display_name: 'Guest', is_guest: true, guest_profile: 'kid' }
      },
      timeline: { series: {}, interval_seconds: 5, tick_count: 0 }
    };
    const { roster } = createChartDataSource(session);
    const guest = roster.find(r => r.id === 'guest_48291');
    expect(guest).toMatchObject({ isGuest: true, guestProfile: 'kid' });
    const primary = roster.find(r => r.id === 'user-a');
    expect(primary.isGuest).toBe(false);
  });
});
```

Note: check the actual exported function name at the top of `sessionDataAdapter.js` (`grep -n "export" frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.js`) and use it in the test — the audit referenced `createChartDataSource`; if it differs, adjust the import (not the assertion).

Run it — FAIL (no `isGuest` field).

**Step 2: Implement in the adapter.** In the participants-keyed roster map (~line 92-107), add to the returned object:

```javascript
        isGuest: meta.is_guest || meta.isGuest || false,
        guestProfile: meta.guest_profile || meta.guestProfile || null,
```

(Also add `isGuest: false, guestProfile: null` to the legacy-roster branch for shape consistency.)

Run the test — PASS.

**Step 3: Render the chip.** In `FitnessTimeline.jsx`, the `lanes` memo (~line 265) builds `{ userId, name, avatarUrl, … }` from roster entries — add `isGuest: entry.isGuest === true`. Then find the SVG `<text>` element that renders `lane.name` (search the file for `lane.name`), and append inside it:

```jsx
                {lane.isGuest && (
                  <tspan className="fitness-timeline__guest-chip" dx="6">guest</tspan>
                )}
```

**Step 4: Style.** In `FitnessTimeline.scss`:

```scss
.fitness-timeline__guest-chip {
  font-size: 0.65em;
  fill: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

**Step 5: Run widget tests, commit**

Run: `npx vitest run frontend/src/modules/Fitness/widgets`
Expected: PASS

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.js frontend/src/modules/Fitness/widgets/FitnessChart/sessionDataAdapter.guest.test.js frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss
git commit -m "feat(fitness): mark guests in session-detail timeline lanes (audit N10)"
```

---

### Task 13: Documentation sync

Per CLAUDE.md, code changes must update docs.

**Files:**
- Modify: `docs/reference/fitness/guest-mode.md`
- Modify: `docs/reference/fitness/assign-guest.md`
- Modify: `docs/reference/fitness/unknown-hr-monitors.md`
- Modify: `docs/_wip/audits/2026-06-09-guest-assignment-ux-lifecycle-audit.md`

**Step 1: `guest-mode.md`** —
- "Guest Identity Classes": remove the **Known limitation** blockquote about the picker singleton (fixed in Task 4); note numbered display names ("Guest", "Guest 2", …) and the kid variant with `guest_profiles.kid` zones.
- "UI Presentation → Avatar resolution": generic Guests now resolve to `guest-adult`/`guest-kid` placeholder images with fallback to Pikachu.
- "UI Presentation → Color": describe the avatar ring (configured color, hash fallback for unidentified devices) and "Purple strap" labels.
- "Reports & Persistence": add `guest_profile: kid` to the YAML example; session-detail now renders a "guest" chip.
- "Considerations & Footguns": drop the bullets fixed here (generic-Guests-identical, no-badge-anywhere) and reword the kid-zones bullet to point at `guest_profiles`.

**Step 2: `assign-guest.md`** — update the Scenario 6 "Note on generic Guest" paragraph: the singleton limitation is fixed; `'guest'`/`'guest-kid'` are inherently multi-assignable in `guestOptionsBuilder.js`.

**Step 3: `unknown-hr-monitors.md`** — the Tier 2 table row and §"color-allocated visitor slots" can now truthfully describe a prominent ring + "Purple strap" label (previously the doc claimed a border that didn't exist); note the hash-color fallback for Tier 3 wild devices.

**Step 4: Audit scorecard** — in the 2026-06-09 audit, mark N1, N2, N3, N4, N5, N6, N7, N9, N10 and §3 as implemented with a `(fixed YYYY-MM-DD, feature/guest-ux-fixes)` annotation.

**Step 5: Commit**

```bash
git add docs/reference/fitness/guest-mode.md docs/reference/fitness/assign-guest.md docs/reference/fitness/unknown-hr-monitors.md docs/_wip/audits/2026-06-09-guest-assignment-ux-lifecycle-audit.md
git commit -m "docs(fitness): sync guest-mode references with guest UX fixes"
```

---

### Task 14: Final verification & merge prep

**Step 1: Full colocated frontend suite**

Run: `npx vitest run frontend/src`
Expected: PASS, zero failures. If any pre-existing failures exist, confirm they also fail on `main` (`git stash` or compare in the main worktree) before dismissing — report them either way.

**Step 2: Isolated harness (jest + vitest targets)**

Run: `npm run test:isolated`
Expected: PASS (matches main's baseline).

**Step 3: Manual smoke on the dev server** (per Task 11 step 4 setup):
1. Tap an unmapped sim device card → hint line + (if recently assigned) transfer note render; "Ignore This Strap" label present.
2. Assign generic "Guest" on device A, then open device B's menu → "Guest" option still offered; assigning yields card "Guest 2".
3. If `guest_profiles.kid` is present in the dev config: "Guest" with `Kid` badge appears; assigning it logs `ZONE_OVERRIDE_APPLIED` (check `dev.log` or browser console at debug level).

**Step 4: STOP — do not merge or push without the user.** Per project rules the user reviews all changes. Present the branch diff summary and wait. After approval: merge `feature/guest-ux-fixes` into `main` directly (no PR), delete the branch, and record it in `docs/_archive/deleted-branches.md` with its final commit hash.
