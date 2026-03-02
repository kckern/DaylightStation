# PWA Root Shortcuts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate the PWA to a single root-scoped installation with manifest shortcuts for Feed (3 views), Media, and Call — enabling each to be dragged to Android homescreen as independent icons.

**Architecture:** Replace the current dual-manifest setup (generic root + feed-scoped PWA) with a single root-scoped manifest that uses the `shortcuts` array. Move the service worker to root scope. Remove the dynamic manifest injection from FeedApp. The Vite `index.html` gets a static `<link rel="manifest">` since it currently has none (only the unused CRA `public/index.html` had one).

**Tech Stack:** PWA manifest (shortcuts API), minimal service worker, SVG shortcut icons

---

### Task 1: Add manifest link to Vite index.html

The active `frontend/index.html` (Vite entry point) has no `<link rel="manifest">`. The legacy `frontend/public/index.html` had one but is unused by Vite. We need to add it to the real entry point.

**Files:**
- Modify: `frontend/index.html:5` (add after the favicon link)

**Step 1: Add manifest link**

In `frontend/index.html`, add the manifest link inside `<head>`, after the existing favicon link (line 5):

```html
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#000000" />
```

Also add `theme-color` meta tag for mobile browser chrome coloring.

**Step 2: Verify in browser**

Open the app in Chrome, go to DevTools → Application → Manifest. Confirm the manifest loads and shows "Daylight Station".

**Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat(pwa): add manifest and theme-color to Vite entry point"
```

---

### Task 2: Create shortcut icons

Each shortcut needs a distinct icon. Create simple monochrome SVG icons (white on transparent) at 96x96 for each shortcut. SVG keeps things resolution-independent and avoids needing multiple PNGs.

**Files:**
- Create: `frontend/public/icons/shortcut-scroll.svg`
- Create: `frontend/public/icons/shortcut-reader.svg`
- Create: `frontend/public/icons/shortcut-headlines.svg`
- Create: `frontend/public/icons/shortcut-media.svg`
- Create: `frontend/public/icons/shortcut-call.svg`

**Step 1: Create icons directory**

```bash
mkdir -p frontend/public/icons
```

**Step 2: Create scroll icon (vertical lines suggesting a feed/scroll)**

Create `frontend/public/icons/shortcut-scroll.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#1a1a1a"/>
  <rect x="24" y="22" width="48" height="6" rx="3" fill="#f25b1e"/>
  <rect x="24" y="36" width="36" height="4" rx="2" fill="#999"/>
  <rect x="24" y="48" width="48" height="6" rx="3" fill="#f25b1e"/>
  <rect x="24" y="62" width="36" height="4" rx="2" fill="#999"/>
  <rect x="24" y="74" width="28" height="4" rx="2" fill="#666"/>
</svg>
```

**Step 3: Create reader icon (open book)**

Create `frontend/public/icons/shortcut-reader.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#1a1a1a"/>
  <path d="M48 28 C48 28 36 24 24 28 L24 68 C36 64 48 68 48 68 C48 68 60 64 72 68 L72 28 C60 24 48 28 48 28Z" fill="none" stroke="#f25b1e" stroke-width="3" stroke-linejoin="round"/>
  <line x1="48" y1="28" x2="48" y2="68" stroke="#f25b1e" stroke-width="2"/>
</svg>
```

**Step 4: Create headlines icon (newspaper grid)**

Create `frontend/public/icons/shortcut-headlines.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#1a1a1a"/>
  <rect x="20" y="22" width="56" height="10" rx="3" fill="#f25b1e"/>
  <rect x="20" y="38" width="24" height="18" rx="3" fill="#666"/>
  <rect x="50" y="38" width="26" height="4" rx="2" fill="#999"/>
  <rect x="50" y="46" width="20" height="4" rx="2" fill="#666"/>
  <rect x="50" y="54" width="22" height="2" rx="1" fill="#555"/>
  <rect x="20" y="62" width="56" height="4" rx="2" fill="#666"/>
  <rect x="20" y="70" width="40" height="4" rx="2" fill="#555"/>
</svg>
```

**Step 5: Create media icon (play button)**

Create `frontend/public/icons/shortcut-media.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#1a1a1a"/>
  <circle cx="48" cy="48" r="24" fill="none" stroke="#f25b1e" stroke-width="3"/>
  <polygon points="42,36 42,60 62,48" fill="#f25b1e"/>
</svg>
```

**Step 6: Create call icon (phone)**

Create `frontend/public/icons/shortcut-call.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="20" fill="#1a1a1a"/>
  <path d="M38 26c-1.6 0-3 1.4-3 3v4c0 12.7 10.3 23 23 23h4c1.6 0 3-1.4 3-3v-6.5c0-1.1-.6-2-1.5-2.4l-6-2.5c-1-.4-2.2-.1-2.8.7l-2.2 3c-4.4-2.2-7.9-5.7-10.1-10.1l3-2.2c.8-.6 1.1-1.8.7-2.8l-2.5-6c-.4-.9-1.3-1.5-2.4-1.5H38z" fill="#f25b1e"/>
</svg>
```

**Step 7: Commit**

```bash
git add frontend/public/icons/
git commit -m "feat(pwa): add shortcut icons for feed views, media, and call"
```

---

### Task 3: Update manifest.json with shortcuts and proper config

Replace the placeholder manifest with a proper root-scoped PWA manifest including shortcuts.

**Files:**
- Modify: `frontend/public/manifest.json` (full rewrite)

**Step 1: Rewrite manifest.json**

Replace the entire contents of `frontend/public/manifest.json`:

```json
{
  "short_name": "Daylight",
  "name": "Daylight Station",
  "icons": [
    {
      "src": "/icon-192.png",
      "type": "image/png",
      "sizes": "192x192"
    },
    {
      "src": "/icon-512.png",
      "type": "image/png",
      "sizes": "512x512"
    },
    {
      "src": "/icon.svg",
      "type": "image/svg+xml",
      "sizes": "any"
    }
  ],
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#000000",
  "shortcuts": [
    {
      "name": "Scroll",
      "short_name": "Scroll",
      "url": "/feed/scroll",
      "icons": [{ "src": "/icons/shortcut-scroll.svg", "sizes": "96x96", "type": "image/svg+xml" }]
    },
    {
      "name": "Reader",
      "short_name": "Reader",
      "url": "/feed/reader",
      "icons": [{ "src": "/icons/shortcut-reader.svg", "sizes": "96x96", "type": "image/svg+xml" }]
    },
    {
      "name": "Headlines",
      "short_name": "Headlines",
      "url": "/feed/headlines",
      "icons": [{ "src": "/icons/shortcut-headlines.svg", "sizes": "96x96", "type": "image/svg+xml" }]
    },
    {
      "name": "Media",
      "short_name": "Media",
      "url": "/media",
      "icons": [{ "src": "/icons/shortcut-media.svg", "sizes": "96x96", "type": "image/svg+xml" }]
    }
  ]
}
```

Note: 4 shortcuts (Android's typical max). Call is omitted since it's lower frequency — can be added later by swapping one out if needed.

Key changes from current manifest:
- Uses the newer `icon-*.png` / `icon.svg` icons (not the legacy `logo*.png`)
- `start_url: "/"` and `scope: "/"` — root-scoped
- `background_color: "#000000"` — matches the dark app theme
- `shortcuts` array with 4 entries

**Step 2: Verify in Chrome DevTools**

DevTools → Application → Manifest → Confirm shortcuts appear in the manifest panel.

**Step 3: Commit**

```bash
git add frontend/public/manifest.json
git commit -m "feat(pwa): root-scoped manifest with shortcuts for feed, media"
```

---

### Task 4: Move service worker to root scope

Rename `feed-sw.js` to `sw.js` so it covers the entire origin (all shortcuts need to be within the SW scope for full PWA installability).

**Files:**
- Create: `frontend/public/sw.js`
- Delete: `frontend/public/feed-sw.js` (after FeedApp cleanup in Task 5)

**Step 1: Create root-scoped service worker**

Create `frontend/public/sw.js`:

```javascript
// Minimal service worker for PWA installability
// Scoped to / — covers all app routes (feed, media, call, admin)
// No offline caching for now — just satisfies Chrome's install criteria

self.addEventListener('fetch', () => {});
```

**Step 2: Register SW from index.html**

Add a script tag at the end of `<body>` in `frontend/index.html`, before the closing `</body>`:

```html
    <script type="module" src="/src/main.jsx"></script>
    <script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }
    </script>
  </body>
```

**Step 3: Verify SW registration**

DevTools → Application → Service Workers → Confirm `sw.js` is registered with scope `/`.

**Step 4: Commit**

```bash
git add frontend/public/sw.js frontend/index.html
git commit -m "feat(pwa): root-scoped service worker registration"
```

---

### Task 5: Remove feed-scoped PWA

Remove `useFeedPWA()` from FeedApp and delete the feed-specific manifest and service worker.

**Files:**
- Modify: `frontend/src/Apps/FeedApp.jsx:19-40` (delete `useFeedPWA` function)
- Modify: `frontend/src/Apps/FeedApp.jsx:48` (remove `useFeedPWA()` call from `FeedLayout`)
- Delete: `frontend/public/feed-manifest.json`
- Delete: `frontend/public/feed-sw.js`

**Step 1: Remove useFeedPWA function from FeedApp.jsx**

Delete the entire `useFeedPWA()` function (lines 18-40):

```javascript
// DELETE these lines (18-40):
// PWA: inject feed-scoped manifest and register service worker
function useFeedPWA() {
  useEffect(() => {
    // Inject manifest link
    let link = document.querySelector('link[rel="manifest"][data-feed-pwa]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/feed-manifest.json';
      link.setAttribute('data-feed-pwa', '');
      document.head.appendChild(link);
    }

    // Register service worker scoped to /feed
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/feed-sw.js', { scope: '/feed' });
    }

    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, []);
}
```

**Step 2: Remove useFeedPWA() call from FeedLayout**

In the `FeedLayout` function, remove the `useFeedPWA();` call (line 48). The function body should start with the `useEffect` that follows it.

**Step 3: Delete feed-specific PWA files**

```bash
rm frontend/public/feed-manifest.json
rm frontend/public/feed-sw.js
```

**Step 4: Unregister old feed SW (if lingering)**

Browsers cache service workers. Users who previously installed the feed PWA will still have the old `/feed`-scoped SW. The new root SW at `/` will take precedence for new navigations, but to be clean, verify in DevTools → Application → Service Workers that only `sw.js` with scope `/` is listed. If `feed-sw.js` lingers, it will be harmless (empty fetch handler) and will eventually be garbage collected.

**Step 5: Commit**

```bash
git add frontend/src/Apps/FeedApp.jsx
git add -u frontend/public/feed-manifest.json frontend/public/feed-sw.js
git commit -m "refactor(pwa): remove feed-scoped PWA in favor of root shortcuts"
```

---

### Task 6: Clean up legacy PWA files

Remove the unused legacy CRA `public/index.html` manifest reference and the old `logo*.png` icons that are no longer referenced by the manifest.

**Files:**
- Modify: `frontend/public/index.html` (remove manifest link if this file is still used for anything)
- Evaluate: `frontend/public/logo192.png`, `frontend/public/logo512.png` — check if referenced elsewhere

**Step 1: Check if legacy icons are referenced anywhere**

```bash
grep -r "logo192\|logo512" frontend/src/ frontend/public/ --include='*.jsx' --include='*.js' --include='*.html' --include='*.json'
```

If only referenced from the old `public/index.html` (legacy CRA) and nowhere else, they can be deleted. If referenced elsewhere, leave them.

**Step 2: Clean up as appropriate**

Delete unreferenced legacy icons:

```bash
# Only if grep confirms no references beyond public/index.html:
rm frontend/public/logo192.png frontend/public/logo512.png
```

**Step 3: Commit**

```bash
git add -u frontend/public/
git commit -m "chore(pwa): remove unused legacy icon files"
```

---

### Task 7: End-to-end verification

Test the full PWA on an Android device (or Chrome DevTools mobile emulation).

**Verification checklist:**
1. Open the app in Chrome on Android (or desktop with mobile emulation)
2. DevTools → Application → Manifest: confirm `start_url: "/"`, `scope: "/"`, 4 shortcuts listed
3. DevTools → Application → Service Workers: confirm `sw.js` registered at scope `/`
4. Install the PWA (Chrome menu → "Install Daylight Station" or "Add to Home Screen")
5. Long-press the installed icon on Android homescreen: verify 4 shortcuts appear (Scroll, Reader, Headlines, Media)
6. Tap each shortcut: verify it opens directly to the correct path
7. Drag a shortcut (e.g., "Media") to the homescreen: verify it creates a standalone icon
8. Tap the dragged shortcut: verify it opens directly to `/media` in standalone mode
9. Navigate to `/feed` in the app: verify no console errors about missing `feed-manifest.json` or `feed-sw.js`

**No commit for this task — it's verification only.**
