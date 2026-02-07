# Bug Bash - January 8, 2026

## Overview

This document captures the design for the January 8th bug bash covering RPM device display issues and voice memo improvements.

---

## 1. RPM Device Card Changes

### 1.1 Multi-Device Display Logic

| Device Count | Layout | Stats Shown |
|--------------|--------|-------------|
| 1 | Full card with info section | Yes (name, RPM, unit) |
| 2-3 | Horizontal row of circles | No - RPM overlaid on lower half of circle |
| 4+ | Grid of circles | No - RPM overlaid on lower half of circle |

**Implementation:**
- `RpmDeviceCard.jsx` - Add `deviceCount` prop or derive from parent
- Conditionally render `.device-info` section based on count
- Add `.rpm-value-overlay` to avatar when stats hidden
- Parent component (`FitnessUsers.jsx` or similar) passes layout mode

### 1.2 Visual Styling Revert

Revert `RpmDeviceCard.scss` to match old `JumpropeCard.scss` styling:

| Property | Old (restore) | Current |
|----------|---------------|---------|
| `border-radius` | 12px | 8px |
| `background` | `rgba(30, 30, 30, 0.9)` | `rgba(0, 0, 0, 0.4)` |
| `min-height` | 78px | none |

### 1.3 Circular Avatar Enforcement

Prevent RPM avatars from being squashed into ovals by flex/grid containers.

**CSS changes in `RpmDeviceAvatar.scss`:**
```scss
.rpm-device-avatar {
  aspect-ratio: 1;
  flex-shrink: 0;
  min-width: var(--rpm-avatar-size);
  min-height: var(--rpm-avatar-size);
}
```

### 1.4 Fullscreen Size Match

Change RPM device size in fullscreen overlay to match user avatars.

**File:** `FullscreenVitalsOverlay.jsx` and `.scss`

| Element | Old Size | New Size |
|---------|----------|----------|
| RPM device | 68px | 76px |
| User avatar | 76px | 76px (unchanged) |

---

## 2. Voice Memo Changes

### 2.1 Unified UI Migration

**Problem:** FitnessPlayer.jsx and FitnessShow.jsx use the old `VoiceMemoModal` component instead of the newer `VoiceMemoOverlay`.

**Solution:**
1. Replace VoiceMemoModal usage with context method `openVoiceMemoRedo(null)`
2. Delete legacy components

**Files to modify:**
- `FitnessPlayer.jsx` - FAB onClick calls `openVoiceMemoRedo(null)`
- `FitnessShow.jsx` - Same change

**Files to delete:**
- `common/VoiceMemoModal/VoiceMemoModal.jsx`
- `common/VoiceMemoModal/VoiceMemoModal.scss`
- `common/VoiceMemoModal/index.js` (if exists)

**Files to check for removal:**
- `FitnessVoiceMemoStandalone.jsx` - verify if still used
- `FitnessSidebar/FitnessVoiceMemoStandalone.scss`

### 2.2 Auto-Accept Timeout

Increase auto-accept countdown from 5 seconds to 8 seconds.

**File:** `VoiceMemoOverlay.jsx`
```js
// Change from:
const VOICE_MEMO_AUTO_ACCEPT_MS = 5000;
// To:
const VOICE_MEMO_AUTO_ACCEPT_MS = 8000;
```

### 2.3 Width Increase (~20% wider)

**File:** `VoiceMemoOverlay.scss`

| Property | Old | New |
|----------|-----|-----|
| `min-width` | 320px | 380px |
| `max-width` | 480px | 580px |

Also update responsive breakpoints proportionally.

### 2.4 Duplicate Prevention

**File:** `VoiceMemoManager.js`

Add two-layer duplicate check in `addMemo()`:

```js
addMemo(memo) {
  if (!memo) return null;

  const newMemo = {
    ...memo,
    memoId: memo.memoId || `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: memo.createdAt || Date.now(),
    sessionElapsedSeconds: memo.sessionElapsedSeconds ?? this._getSessionElapsedSeconds()
  };

  // Layer 1: Check for same memoId
  const existingById = this.memos.find(m => String(m.memoId) === String(newMemo.memoId));
  if (existingById) {
    return existingById; // Already exists
  }

  // Layer 2: Check for same transcript within 5 seconds (prevents duplicate IDs for same content)
  const DUPLICATE_WINDOW_MS = 5000;
  const transcriptToMatch = newMemo.transcriptRaw || newMemo.transcriptClean || '';
  if (transcriptToMatch) {
    const existingByContent = this.memos.find(m => {
      const existingTranscript = m.transcriptRaw || m.transcriptClean || '';
      if (!existingTranscript || existingTranscript !== transcriptToMatch) return false;
      const timeDiff = Math.abs((m.createdAt || 0) - (newMemo.createdAt || 0));
      return timeDiff < DUPLICATE_WINDOW_MS;
    });
    if (existingByContent) {
      return existingByContent; // Duplicate content
    }
  }

  this.memos.push(newMemo);
  // ... rest of logging code
}
```

---

## 3. Files Changed Summary

### Modified
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.jsx`
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceCard.scss`
- `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/RpmDeviceAvatar.scss`
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx`
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/FullscreenVitalsOverlay.scss`
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss`
- `frontend/src/modules/Fitness/FitnessPlayer.jsx`
- `frontend/src/modules/Fitness/FitnessShow.jsx`
- `frontend/src/hooks/fitness/VoiceMemoManager.js`

### Deleted
- `frontend/src/modules/Fitness/common/VoiceMemoModal/VoiceMemoModal.jsx`
- `frontend/src/modules/Fitness/common/VoiceMemoModal/VoiceMemoModal.scss`
- `frontend/src/modules/Fitness/common/VoiceMemoModal/` (entire folder)

### To Verify Before Deleting
- `frontend/src/modules/Fitness/FitnessVoiceMemoStandalone.jsx`
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemoStandalone.scss`

---

## 4. Testing Checklist

### RPM Cards
- [ ] Single RPM device shows full card with stats
- [ ] 2-3 RPM devices show horizontal row of circles with RPM overlay
- [ ] 4+ RPM devices show grid of circles with RPM overlay
- [ ] Card styling matches old design (rounded corners, darker bg, min-height)
- [ ] Avatars remain circular when container is resized
- [ ] Fullscreen RPM devices are same size as user avatars (76px)

### Voice Memo
- [ ] FitnessPlayer FAB opens VoiceMemoOverlay (not old modal)
- [ ] FitnessShow voice memo button opens VoiceMemoOverlay
- [ ] Auto-accept countdown is 8 seconds
- [ ] Overlay is wider (~380-580px)
- [ ] Cannot add duplicate memo with same memoId
- [ ] Cannot add duplicate memo with same transcript within 5 seconds
- [ ] Old VoiceMemoModal files are deleted
