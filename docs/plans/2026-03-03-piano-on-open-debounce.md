# Piano on_open Debounce Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop `usePianoConfig` from spamming the HA `on_open` script every time the piano component remounts after idle timeout.

**Architecture:** Add a module-scoped timestamp in `usePianoConfig.js` that debounces `on_open` calls to once per 5 minutes. The variable lives outside the component so it survives mount/unmount cycles. The HA-side guard in `office_tv_hdmi_3.yaml` remains as a safety net.

**Tech Stack:** React hooks, existing DaylightAPI, existing logging framework.

---

### Task 1: Add debounce guard to `on_open` in usePianoConfig

**Files:**
- Modify: `frontend/src/modules/Piano/usePianoConfig.js:1-51`

**Step 1: Add module-scoped debounce variable**

At the top of the file (after imports, before the function), add:

```javascript
const ON_OPEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
let lastOnOpenTime = 0;
```

**Step 2: Wrap the `on_open` call with debounce check**

Replace lines 30-34 (the `if (pianoConfig?.on_open)` block) with:

```javascript
        if (pianoConfig?.on_open) {
          const now = Date.now();
          if (now - lastOnOpenTime < ON_OPEN_DEBOUNCE_MS) {
            logger.debug('ha.on-open-debounced', {
              scriptId: pianoConfig.on_open,
              lastCalledSecsAgo: Math.round((now - lastOnOpenTime) / 1000),
            });
          } else {
            lastOnOpenTime = now;
            DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST')
              .then(() => logger.debug('ha.on-open-executed', { scriptId: pianoConfig.on_open }))
              .catch(err => logger.warn('ha.on-open-failed', { error: err.message }));
          }
        }
```

**Step 3: Verify manually**

1. Start dev server: `npm run dev`
2. Open browser console, set `window.DAYLIGHT_LOG_LEVEL = 'debug'`
3. Play piano → first mount should log `ha.on-open-executed`
4. Let it idle-timeout and hide, play again → should log `ha.on-open-debounced`
5. Wait 5+ minutes, play again → should log `ha.on-open-executed`

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/usePianoConfig.js
git commit -m "fix(piano): debounce on_open HA script to prevent spam on remount"
```

---

### Task 2: Update WIP doc status

**Files:**
- Modify: `docs/_wip/auto-show-ha-script-spam.md`

**Step 1: Mark fix as implemented**

Add a section after the "Recommended Fix" section:

```markdown
## Resolution

**Implemented:** Option A (debounce) — 2026-03-03

Module-scoped `lastOnOpenTime` in `usePianoConfig.js` debounces `on_open` calls to once per 5 minutes. Combined with the HA-side condition guard already deployed in `office_tv_hdmi_3.yaml`, the nightlight flash spam is fully resolved at both layers.
```

**Step 2: Commit**

```bash
git add docs/_wip/auto-show-ha-script-spam.md
git commit -m "docs: mark piano on_open spam as resolved"
```
