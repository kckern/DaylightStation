# Media Element Access Consolidation Design

**Date**: 2026-01-18
**Status**: Approved
**Scope**: Architecture cleanup - Phase 1 of loading overlay optimization

---

## Problem

Four independent methods exist to access the `<video>` element, with inconsistent shadow DOM handling:

| Method | Location | Issue |
|--------|----------|-------|
| `containerRef` | useCommonMediaController | Direct ref, no shadow DOM unwrap |
| `mediaAccess.getMediaEl()` | Player.jsx state | Registered via callback |
| `transportAdapter.getMediaEl()` | useMediaTransportAdapter | Falls back through layers |
| Inline shadow DOM query | VideoPlayer LoadingOverlay | `shadowRoot?.querySelector('video')` |

This caused the loop overlay flash bug - `.loop` was read from the wrong element.

---

## Solution

### New Accessor Interface

**Location:** `useCommonMediaController.js`

```javascript
const getContainerEl = useCallback(() => {
  return containerRef.current;
}, []);

const getMediaEl = useCallback(() => {
  const container = containerRef.current;
  if (!container) return null;

  // If container has shadow DOM, get the inner video/audio
  if (container.shadowRoot) {
    return container.shadowRoot.querySelector('video, audio');
  }

  // Otherwise container IS the media element
  return container;
}, []);

return {
  // ... existing returns
  getMediaEl,
  getContainerEl,
};
```

### ResilienceBridge Interface Update

**Location:** `Player.jsx`

```javascript
// Add ref for child registration
const mediaElRef = useRef({ getMediaEl: () => null, getContainerEl: () => null });

const resilienceBridge = useMemo(() => ({
  reportEvent: (event) => { /* ... */ },
  getState: () => resilienceState,

  // New accessors
  getMediaEl: () => mediaElRef.current?.getMediaEl?.() ?? null,
  getContainerEl: () => mediaElRef.current?.getContainerEl?.() ?? null,

  // Child registration
  registerAccessors: ({ getMediaEl, getContainerEl }) => {
    mediaElRef.current = { getMediaEl, getContainerEl };
  },
}), [resilienceState]);
```

### Child Registration

**Location:** `VideoPlayer.jsx` and `AudioPlayer.jsx`

```javascript
useEffect(() => {
  if (resilienceBridge?.registerAccessors) {
    resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
  }
}, [resilienceBridge, getMediaEl, getContainerEl]);
```

### Transport Adapter Simplification

**Location:** `useMediaTransportAdapter.js`

```javascript
// Remove fallback chains, single delegation
const getMediaEl = useCallback(() => {
  return resilienceBridge?.getMediaEl?.() ?? null;
}, [resilienceBridge]);

const getContainerEl = useCallback(() => {
  return resilienceBridge?.getContainerEl?.() ?? null;
}, [resilienceBridge]);
```

---

## Migration (Big Bang)

### Removals

| File | Remove |
|------|--------|
| `Player.jsx` | `mediaAccess` state, `setMediaAccess`, `registerMediaAccess` |
| `SinglePlayer.jsx` | `registerMediaAccess` prop threading |
| `VideoPlayer.jsx` | Inline shadow DOM query, `registerMediaAccess` call |
| `useMediaTransportAdapter.js` | `mediaAccess` prop, fallback chain |

### Props to Stop Passing

```javascript
registerMediaAccess={registerMediaAccess}
mediaAccess={mediaAccess}
```

---

## Verification

Run existing test after migration:
```bash
npm test -- tests/runtime/player/video-loop-overlay.runtime.test.mjs
```

---

## Files Affected

- `frontend/src/modules/Player/hooks/useCommonMediaController.js` - Add accessors
- `frontend/src/modules/Player/Player.jsx` - Update bridge, remove old state
- `frontend/src/modules/Player/components/VideoPlayer.jsx` - Register, remove inline query
- `frontend/src/modules/Player/components/AudioPlayer.jsx` - Register accessors
- `frontend/src/modules/Player/components/SinglePlayer.jsx` - Remove prop threading
- `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js` - Simplify

---

## Next Steps (Future Phases)

After this consolidation:
1. **Phase 2**: Consolidate overlay systems (LoadingOverlay vs PlayerOverlayLoading)
2. **Phase 3**: Unify stall detection (three systems → one)
