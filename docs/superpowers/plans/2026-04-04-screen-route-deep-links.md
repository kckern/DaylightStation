# Screen Route Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `/screens/living-room/games` to load RetroArch games with arcade-style selector, using a `routes` map in the screen config YAML.

**Architecture:** ScreenAutoplay receives the screen config's `routes` map as a prop. When a URL suffix matches a route key, it pushes that route's content ID and properties onto the menu navigation stack instead of defaulting to `menu:{suffix}`.

**Tech Stack:** React, Playwright (live flow tests), Jest (isolated tests)

**Spec:** `docs/superpowers/specs/2026-04-04-screen-route-deep-links-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Modify (lines 43-76, 260) | Pass `routes` prop to ScreenAutoplay; add route lookup before `menu:{suffix}` fallback |
| `data/household/screens/living-room.yml` | Modify (inside Docker) | Add `routes.games` entry |
| `tests/isolated/screen-framework/screenAutoplayRoutes.test.mjs` | Create | Unit test for route lookup logic |

---

### Task 1: Add route lookup to ScreenAutoplay and wire up the prop

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx:43-76, 260`
- Create: `tests/isolated/screen-framework/screenAutoplayRoutes.test.mjs`

- [ ] **Step 1: Write the isolated test for route lookup logic**

Create `tests/isolated/screen-framework/screenAutoplayRoutes.test.mjs`:

```javascript
import { describe, test, expect } from '@jest/globals';

/**
 * Test the route resolution logic extracted from ScreenAutoplay.
 * Given a subPath and a routes map, determine what to push onto the nav stack.
 */
function resolveScreenRoute(subPath, routes) {
  if (routes?.[subPath]) {
    const { contentId, ...routeProps } = routes[subPath];
    return { type: 'menu', props: { list: { contentId }, ...routeProps } };
  }
  return { type: 'menu', props: { list: { contentId: `menu:${subPath}` } } };
}

describe('resolveScreenRoute', () => {
  const routes = {
    games: { contentId: 'retroarch/launchable', menuStyle: 'arcade' },
    music: { contentId: 'menu:music' },
  };

  test('matched route uses contentId and spreads extra props', () => {
    const result = resolveScreenRoute('games', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'retroarch/launchable' }, menuStyle: 'arcade' },
    });
  });

  test('matched route without extra props works', () => {
    const result = resolveScreenRoute('music', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:music' } },
    });
  });

  test('unmatched route falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', routes);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });

  test('null routes falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', null);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });

  test('undefined routes falls back to menu:{subPath}', () => {
    const result = resolveScreenRoute('fhe', undefined);
    expect(result).toEqual({
      type: 'menu',
      props: { list: { contentId: 'menu:fhe' } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest tests/isolated/screen-framework/screenAutoplayRoutes.test.mjs --verbose`
Expected: 5/5 pass (these test the extracted logic function directly)

- [ ] **Step 3: Modify ScreenAutoplay to accept routes prop and use route lookup**

In `frontend/src/screen-framework/ScreenRenderer.jsx`, change the `ScreenAutoplay` function signature (line 43) from:

```javascript
function ScreenAutoplay() {
```

To:

```javascript
function ScreenAutoplay({ routes }) {
```

Then replace lines 65-69 (the `else` branch for non-app subPaths):

```javascript
      } else {
        // Otherwise treat as submenu
        setTimeout(() => {
          push({ type: 'menu', props: { list: { contentId: `menu:${subPath}` } } });
        }, 500);
      }
```

With:

```javascript
      } else if (routes?.[subPath]) {
        // Route defined in screen config — use its content ID and props
        const { contentId, ...routeProps } = routes[subPath];
        logger.info('screen-autoplay.route', { subPath, contentId });
        setTimeout(() => {
          push({ type: 'menu', props: { list: { contentId }, ...routeProps } });
        }, 500);
      } else {
        // Default: treat suffix as menu name
        setTimeout(() => {
          push({ type: 'menu', props: { list: { contentId: `menu:${subPath}` } } });
        }, 500);
      }
```

- [ ] **Step 4: Pass routes prop from ScreenRenderer**

In the same file, change line 260 from:

```jsx
              <ScreenAutoplay />
```

To:

```jsx
              <ScreenAutoplay routes={config.routes} />
```

- [ ] **Step 5: Run isolated tests**

Run: `npx jest tests/isolated/screen-framework/ --verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/ScreenRenderer.jsx tests/isolated/screen-framework/screenAutoplayRoutes.test.mjs
git commit -m "$(cat <<'EOF'
feat(screen): add route-based deep links via screen config

ScreenAutoplay now accepts a routes map from the screen config.
URL suffixes matching a route key use that route's contentId and
properties (e.g., menuStyle) instead of defaulting to menu:{suffix}.

Enables /screens/living-room/games → retroarch/launchable with
arcade selector, configured via routes: in screen YAML.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add games route to living-room screen config

**Files:**
- Modify: `data/household/screens/living-room.yml` (inside Docker container)

- [ ] **Step 1: Read current living-room.yml**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/screens/living-room.yml'
```

- [ ] **Step 2: Add routes section to living-room.yml**

Append the `routes` block after the existing `fkb` section. Write the complete file via heredoc:

```bash
sudo docker exec daylight-station sh -c "cat >> data/household/screens/living-room.yml << 'EOF'

routes:
  games:
    contentId: retroarch/launchable
    menuStyle: arcade
EOF"
```

- [ ] **Step 3: Verify the file is valid**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/screens/living-room.yml'
```

Confirm `routes:` section appears at the end with correct indentation.

- [ ] **Step 4: Verify the API returns routes**

```bash
curl -s http://localhost:3111/api/v1/screens/living-room | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('routes'), indent=2))"
```

Expected output:
```json
{
  "games": {
    "contentId": "retroarch/launchable",
    "menuStyle": "arcade"
  }
}
```

---

### Task 3: End-to-end verification

**Files:**
- None (manual verification against running system)

- [ ] **Step 1: Run isolated tests to confirm no regressions**

Run: `npx jest tests/isolated/screen-framework/ --verbose`
Expected: All pass

- [ ] **Step 2: Verify existing FHE deep-link still works**

```bash
curl -s "http://localhost:3111/api/v1/list/menu/fhe" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('title'), len(d.get('items',[])), 'items')"
```

Expected: `FHE` with items (confirms existing menu:{suffix} fallback is intact)

- [ ] **Step 3: Build and deploy (user action)**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .

sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Test the games deep-link in browser**

Navigate to `https://daylightlocal.kckern.net/screens/living-room/games`

Verify:
1. Arcade-style selector appears (not standard menu grid)
2. RetroArch consoles/games are listed
3. URL is cleaned to `/screens/living-room` after load
4. No console errors related to missing routes or undefined props
