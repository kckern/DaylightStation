# Menu Dual-Selection & Scroll Diagnostic Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dual-selection bug where two menu items appear highlighted after back-navigation, and add diagnostic logging for a reported scroll issue on 2-row menus.

**Architecture:** Two targeted fixes in `Menu.jsx`: (1) `navigateTo` clears ALL `.active` classes instead of only the previous one, preventing stale highlights; (2) the restore effect guards against empty items producing index -1. Plus diagnostic logging at scroll decision points and restore effect for production observability.

**Tech Stack:** React (JSX), DOM-direct manipulation, structured logging via `getLogger()`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Menu/Menu.jsx:738-787` | Modify | Fix `navigateTo` to clear all actives; add scroll decision logging |
| `frontend/src/modules/Menu/Menu.jsx:792-835` | Modify | Fix restore effect empty-items guard; add restore diagnostic logging |

---

### Task 1: Fix dual-selection and add diagnostics

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx:738-835`

All changes are in the same file and tightly coupled — one task, not two.

- [ ] **Step 1: Fix `navigateTo` — clear all active classes**

In `frontend/src/modules/Menu/Menu.jsx`, find the `navigateTo` function (line ~748). Replace the single-element cleanup:

```javascript
    // Swap CSS classes — direct DOM, no React
    const prevEl = menuItemsEl.children[prevIndex];
    const nextEl = menuItemsEl.children[nextIndex];
    if (prevEl) { prevEl.classList.remove("active"); prevEl.classList.remove("cover"); }
    if (nextEl) nextEl.classList.add("active");
```

With defensive cleanup of ALL active elements:

```javascript
    // Clear ALL active classes — defensive against stale state after remount
    menuItemsEl.querySelectorAll(".menu-item.active").forEach(el => {
      el.classList.remove("active", "cover");
    });
    const nextEl = menuItemsEl.children[nextIndex];
    if (nextEl) nextEl.classList.add("active");
```

- [ ] **Step 2: Fix restore effect — guard empty items**

In the restore effect (line ~793), replace:

```javascript
    const clampedIndex = Math.min(savedIndex, items.length - 1);
```

With:

```javascript
    const clampedIndex = items.length > 0 ? Math.min(savedIndex, items.length - 1) : 0;
```

- [ ] **Step 3: Add scroll decision logging to `navigateTo`**

In `navigateTo`, after the scroll decision (line ~777), add a sampled log. The logger already exists at line ~614 as `logger`. Add AFTER the `translateY` is set (after the if/else block at lines 777-786):

```javascript
    // Diagnostic: log scroll decision for 2-row menu bug investigation
    const totalRows = Math.ceil(cache.positions.length / columns);
    logger.sampled('menu.scroll.decision', {
      totalRows,
      columns,
      positionsLength: cache.positions.length,
      scrollHeight: cache.scrollHeight,
      containerHeight: cache.containerHeight,
      nextIndex,
      didScroll: totalRows > 2 && cache.scrollHeight > cache.containerHeight && nextIndex >= columns,
    }, { maxPerMinute: 10 });
```

Note: the `totalRows` calculation already exists at line 778. Move it before the if/else block so it can be used in both the guard and the log. The log goes AFTER the if/else.

- [ ] **Step 4: Add restore effect diagnostic logging**

In the restore effect, after clearing stale actives and before setting the target (line ~803), add:

```javascript
    const staleActiveCount = menuItemsEl.querySelectorAll(".menu-item.active").length;
    if (staleActiveCount > 0) {
      logger.warn('menu.restore.staleActives', {
        staleActiveCount,
        savedIndex,
        clampedIndex,
        itemsLength: items.length,
      });
    }
```

This log fires BEFORE the `forEach` removal, so it captures how many stale actives existed. Use `warn` level since this indicates a bug if > 1.

- [ ] **Step 5: Verify no syntax errors**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds (no syntax errors in JSX)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "fix(menu): clear all active classes in navigateTo to prevent dual selection

Also guards restore effect against empty items producing index -1,
and adds diagnostic logging for scroll decisions and stale actives."
```

---

### Task 2: Build and deploy

- [ ] **Step 1: Pull latest**

```bash
git pull origin main
```

- [ ] **Step 2: Build Docker image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 3: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Verify container is running**

```bash
sudo docker logs daylight-station 2>&1 | tail -3
```

Expected: `server.started` log with port 3111
