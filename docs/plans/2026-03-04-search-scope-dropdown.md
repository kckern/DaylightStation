# Search Scope Dropdown — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat filter chip buttons with a config-driven, two-level scope dropdown that persists selection, supports favorites/recents, and enables result-based re-scoping.

**Architecture:** New `searchScopes` config in `media.yml` defines a two-level hierarchy (Video > Movies, TV, etc.). A `ScopeDropdown` component replaces the filter chips. Scope chips above results and clickable source badges let users narrow scope from results. localStorage persists last-used scope, recents, and favorites.

**Tech Stack:** React (hooks, refs), SCSS, YAML config, existing SSE search infrastructure

**Design doc:** `docs/plans/2026-03-04-search-scope-dropdown-design.md`

---

### Task 1: Add searchScopes to media config

**Files:**
- Modify: `data/household/config/media.yml`
- Modify: `backend/src/4_api/v1/routers/media.mjs:78-82`

**Step 1: Add searchScopes section to media.yml**

Add below the existing `browse` section in `data/household/config/media.yml`:

```yaml
searchScopes:
  - label: All
    key: all
    params: "capability=playable&take=25"
  - label: Video
    key: video
    icon: video
    params: "capability=playable&mediaType=video"
    children:
      - label: Movies
        key: video-movies
        params: "capability=playable&source=plex&mediaType=video&libraryType=movie"
      - label: TV Shows
        key: video-tv
        params: "capability=playable&source=plex&mediaType=video&libraryType=show"
      - label: Home Video
        key: video-home
        params: "capability=playable&source=immich&mediaType=video"
      - label: YouTube
        key: video-youtube
        params: "capability=playable&source=youtube&mediaType=video"
  - label: Music
    key: music
    icon: music
    params: "capability=playable&mediaType=audio"
    children:
      - label: Albums
        key: music-albums
        params: "capability=playable&source=plex&mediaType=audio"
      - label: Playlists
        key: music-playlists
        params: "capability=playable&source=plex&mediaType=audio&libraryType=playlist"
      - label: Hymns
        key: music-hymns
        params: "capability=playable&source=singalong"
  - label: Books
    key: books
    icon: book
    params: "capability=playable&source=abs"
    children:
      - label: Audiobooks
        key: books-audio
        params: "capability=playable&source=abs"
      - label: Comics
        key: books-comics
        params: "capability=readable&source=komga"
```

**Step 2: Expose searchScopes in the /config endpoint**

In `backend/src/4_api/v1/routers/media.mjs`, line 81, change:

```javascript
// FROM:
res.json({ browse: appConfig.browse || [] });

// TO:
res.json({
  browse: appConfig.browse || [],
  searchScopes: appConfig.searchScopes || [],
});
```

**Step 3: Verify endpoint returns new config**

Run: `curl -s http://localhost:3112/api/v1/media/config | jq '.searchScopes | length'`
Expected: a number > 0 (e.g. `4`)

**Step 4: Commit**

```bash
git add data/household/config/media.yml backend/src/4_api/v1/routers/media.mjs
git commit -m "feat(media): add searchScopes config and expose in /config endpoint"
```

---

### Task 2: Create useScopePrefs hook (localStorage persistence)

**Files:**
- Create: `frontend/src/hooks/media/useScopePrefs.js`

**Step 1: Write the hook**

```javascript
// frontend/src/hooks/media/useScopePrefs.js
import { useState, useCallback } from 'react';

const STORAGE_KEYS = {
  last: 'media-scope-last',
  recents: 'media-scope-recents',
  favorites: 'media-scope-favorites',
};

const MAX_RECENTS = 5;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Manages scope persistence in localStorage: last-used, recents, favorites.
 *
 * @returns {{
 *   lastScopeKey: string,
 *   recents: string[],
 *   favorites: string[],
 *   recordUsage: (key: string) => void,
 *   toggleFavorite: (key: string) => void,
 *   isFavorite: (key: string) => boolean,
 * }}
 */
export function useScopePrefs() {
  const [lastScopeKey] = useState(() => localStorage.getItem(STORAGE_KEYS.last) || 'all');
  const [recents, setRecents] = useState(() => readJSON(STORAGE_KEYS.recents, []));
  const [favorites, setFavorites] = useState(() => readJSON(STORAGE_KEYS.favorites, []));

  const recordUsage = useCallback((key) => {
    localStorage.setItem(STORAGE_KEYS.last, key);
    setRecents(prev => {
      const next = [key, ...prev.filter(k => k !== key)].slice(0, MAX_RECENTS);
      localStorage.setItem(STORAGE_KEYS.recents, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((key) => {
    setFavorites(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((key) => favorites.includes(key), [favorites]);

  return { lastScopeKey, recents, favorites, recordUsage, toggleFavorite, isFavorite };
}

export default useScopePrefs;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/media/useScopePrefs.js
git commit -m "feat(media): add useScopePrefs hook for scope localStorage persistence"
```

---

### Task 3: Create ScopeDropdown component

**Files:**
- Create: `frontend/src/modules/Media/ScopeDropdown.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Media/ScopeDropdown.jsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Two-level scope dropdown for search filtering.
 *
 * @param {{
 *   scopes: Array<{label, key, params, icon?, children?: Array<{label, key, params}>}>,
 *   activeKey: string,
 *   onSelect: (scope: {label, key, params}) => void,
 *   recents: string[],
 *   favorites: string[],
 *   onToggleFavorite: (key: string) => void,
 * }} props
 */
const ScopeDropdown = ({ scopes, activeKey, onSelect, recents, favorites, onToggleFavorite }) => {
  const logger = useMemo(() => getLogger().child({ component: 'ScopeDropdown' }), []);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Build flat lookup of all scopes (parents + children)
  const allScopes = useMemo(() => {
    const map = new Map();
    for (const scope of scopes) {
      map.set(scope.key, scope);
      if (scope.children) {
        for (const child of scope.children) {
          map.set(child.key, child);
        }
      }
    }
    return map;
  }, [scopes]);

  const activeScope = allScopes.get(activeKey) || scopes[0];

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSelect = useCallback((scope) => {
    logger.info('scope-dropdown.selected', { key: scope.key, label: scope.label });
    onSelect(scope);
    setOpen(false);
  }, [onSelect, logger]);

  const handleToggleFav = useCallback((e, key) => {
    e.stopPropagation();
    onToggleFavorite(key);
  }, [onToggleFavorite]);

  // Resolve recent/favorite keys to scope objects (skip missing)
  const recentScopes = recents
    .filter(k => k !== 'all' && allScopes.has(k))
    .map(k => allScopes.get(k))
    .slice(0, 3);
  const favoriteScopes = favorites
    .filter(k => allScopes.has(k))
    .map(k => allScopes.get(k));

  return (
    <div className="scope-dropdown" ref={dropdownRef}>
      <button
        className="scope-dropdown-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="scope-dropdown-label">{activeScope?.label || 'All'}</span>
        <span className="scope-dropdown-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="scope-dropdown-menu" role="listbox">
          {scopes.map((scope) => (
            <React.Fragment key={scope.key}>
              {scope.children ? (
                <>
                  <div className="scope-dropdown-group-header">{scope.label}</div>
                  {scope.children.map((child) => (
                    <button
                      key={child.key}
                      className={`scope-dropdown-item${child.key === activeKey ? ' active' : ''}`}
                      onClick={() => handleSelect(child)}
                      role="option"
                      aria-selected={child.key === activeKey}
                    >
                      <span className="scope-dropdown-item-label">{child.label}</span>
                      <span
                        className={`scope-dropdown-star${favorites.includes(child.key) ? ' starred' : ''}`}
                        onClick={(e) => handleToggleFav(e, child.key)}
                      >
                        {favorites.includes(child.key) ? '★' : '☆'}
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <button
                  className={`scope-dropdown-item scope-dropdown-item--top${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                  aria-selected={scope.key === activeKey}
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              )}
            </React.Fragment>
          ))}

          {recentScopes.length > 0 && (
            <>
              <div className="scope-dropdown-divider" />
              <div className="scope-dropdown-group-header">Recent</div>
              {recentScopes.map((scope) => (
                <button
                  key={`recent-${scope.key}`}
                  className={`scope-dropdown-item${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              ))}
            </>
          )}

          {favoriteScopes.length > 0 && (
            <>
              <div className="scope-dropdown-divider" />
              <div className="scope-dropdown-group-header">Favorites</div>
              {favoriteScopes.map((scope) => (
                <button
                  key={`fav-${scope.key}`}
                  className={`scope-dropdown-item${scope.key === activeKey ? ' active' : ''}`}
                  onClick={() => handleSelect(scope)}
                  role="option"
                >
                  <span className="scope-dropdown-item-label">{scope.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ScopeDropdown;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ScopeDropdown.jsx
git commit -m "feat(media): add ScopeDropdown component with two-level hierarchy"
```

---

### Task 4: Add ScopeDropdown and scope chips SCSS

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:436-475` (replace filter styles, add dropdown + chip styles)

**Step 1: Remove old filter styles and add new scope dropdown + chip styles**

In `MediaApp.scss`, find and replace the `.content-browser-filters` and `.filter-chip` blocks (lines 456-475) with:

```scss
// Scope Dropdown
.scope-dropdown {
  position: relative;
  flex-shrink: 0;
}

.scope-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px 0 0 8px;
  border-right: none;
  padding: 8px 10px;
  color: #e0e0e0;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  height: 100%;

  &:hover { border-color: #555; }
}

.scope-dropdown-chevron {
  font-size: 9px;
  color: #888;
}

.scope-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 200;
  min-width: 180px;
  max-height: 60vh;
  overflow-y: auto;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  margin-top: 4px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.scope-dropdown-group-header {
  padding: 6px 12px 2px;
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  user-select: none;
}

.scope-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  text-align: left;

  &:hover { background: #252525; }
  &.active { color: #1db954; }

  &--top {
    font-weight: 500;
    color: #e0e0e0;
  }
}

.scope-dropdown-item-label {
  flex: 1;
}

.scope-dropdown-star {
  font-size: 14px;
  color: #555;
  cursor: pointer;
  padding: 0 2px;

  &:hover { color: #e0c040; }
  &.starred { color: #e0c040; }
}

.scope-dropdown-divider {
  height: 1px;
  background: #333;
  margin: 4px 0;
}

// Scope suggestion chips (above results)
.scope-chips {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
  overflow-x: auto;
  flex-wrap: nowrap;
}

.scope-chip {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 14px;
  padding: 3px 10px;
  color: #aaa;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;

  &:hover { border-color: #1db954; color: #1db954; }

  .scope-chip-count {
    color: #666;
    margin-left: 4px;
  }
}
```

Also update `.content-browser-header` to accommodate the dropdown next to the search input. Change the existing `.content-browser-search` border-radius:

```scss
// When preceded by scope dropdown, flatten left border
.scope-dropdown + .content-browser-search {
  border-radius: 0 8px 8px 0;
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): add SCSS for ScopeDropdown, scope chips, and clickable source badges"
```

---

### Task 5: Create ScopeChips component (result re-scoping)

**Files:**
- Create: `frontend/src/modules/Media/ScopeChips.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Media/ScopeChips.jsx
import React, { useMemo } from 'react';

/**
 * Shows scope suggestion chips above results based on source distribution.
 * Only shown when current scope is broad (has children or is "all").
 *
 * @param {{
 *   results: Array<{source: string, mediaType?: string}>,
 *   scopes: Array<{key, label, params, children?}>,
 *   activeKey: string,
 *   onSelect: (scope) => void,
 * }} props
 */
const ScopeChips = ({ results, scopes, activeKey, onSelect }) => {
  const chips = useMemo(() => {
    if (!results.length) return [];

    // Build flat list of leaf scopes with their source/mediaType from params
    const leafScopes = [];
    for (const scope of scopes) {
      if (scope.children) {
        for (const child of scope.children) {
          leafScopes.push(child);
        }
      }
    }

    // Count results matching each leaf scope's source param
    const counts = [];
    for (const scope of leafScopes) {
      if (scope.key === activeKey) continue; // skip current scope
      const params = new URLSearchParams(scope.params);
      const scopeSource = params.get('source');
      const scopeMediaType = params.get('mediaType');

      const matchCount = results.filter(r => {
        if (scopeSource && r.source !== scopeSource) return false;
        if (scopeMediaType && r.mediaType && r.mediaType !== scopeMediaType) return false;
        return true;
      }).length;

      if (matchCount > 0) {
        counts.push({ scope, count: matchCount });
      }
    }

    return counts.sort((a, b) => b.count - a.count);
  }, [results, scopes, activeKey]);

  // Only show when scope is broad enough to have suggestions
  const activeScope = scopes.find(s => s.key === activeKey)
    || scopes.find(s => s.children?.some(c => c.key === activeKey));
  const isNarrow = activeScope && !activeScope.children && activeScope.key !== 'all';
  if (isNarrow || chips.length === 0) return null;

  return (
    <div className="scope-chips">
      {chips.map(({ scope, count }) => (
        <button
          key={scope.key}
          className="scope-chip"
          onClick={() => onSelect(scope)}
        >
          {scope.label}
          <span className="scope-chip-count">({count})</span>
        </button>
      ))}
    </div>
  );
};

export default ScopeChips;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ScopeChips.jsx
git commit -m "feat(media): add ScopeChips component for result-based re-scoping"
```

---

### Task 6: Wire everything into ContentBrowser

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

This is the main integration task. It replaces filter chip logic with scope dropdown logic.

**Step 1: Update imports**

At top of `ContentBrowser.jsx`, add new imports after the existing ones:

```javascript
import ScopeDropdown from './ScopeDropdown.jsx';
import ScopeChips from './ScopeChips.jsx';
import { useScopePrefs } from '../../hooks/media/useScopePrefs.js';
```

**Step 2: Replace filter state with scope state**

Remove these lines:
- `const [activeFilter, setActiveFilter] = useState(0);` (line 17)
- The `filters` useMemo block (lines 41-50)
- `const filterParams = filters[activeFilter]?.params || '';` (line 52)

Replace with:

```javascript
const [searchScopes, setSearchScopes] = useState([]);
const { lastScopeKey, recents, favorites, recordUsage, toggleFavorite } = useScopePrefs();
const [activeScopeKey, setActiveScopeKey] = useState(lastScopeKey);

// Find the active scope's params from the scopes config
const activeScopeParams = useMemo(() => {
  for (const scope of searchScopes) {
    if (scope.key === activeScopeKey) return scope.params || '';
    if (scope.children) {
      const child = scope.children.find(c => c.key === activeScopeKey);
      if (child) return child.params || '';
    }
  }
  return 'capability=playable&take=25';
}, [searchScopes, activeScopeKey]);
```

**Step 3: Update config fetch to include searchScopes**

In the existing `useEffect` that fetches `/api/v1/media/config` (lines 23-34), add after `setBrowseConfig(categories)`:

```javascript
const scopes = data.searchScopes || [];
setSearchScopes(scopes);
logger.info('content-browser.scopes-loaded', { scopeCount: scopes.length });
```

**Step 4: Update useStreamingSearch call**

Change the `useStreamingSearch` call to use `activeScopeParams` instead of `filterParams`:

```javascript
const { results, pending, isSearching, search } = useStreamingSearch(
  '/api/v1/content/query/search/stream',
  activeScopeParams
);
```

**Step 5: Add scope selection handler**

```javascript
const handleScopeSelect = useCallback((scope) => {
  logger.info('content-browser.scope-changed', { key: scope.key, label: scope.label });
  setActiveScopeKey(scope.key);
  recordUsage(scope.key);
  if (searchText.length >= 2) {
    search(searchText, scope.params);
  }
}, [logger, recordUsage, searchText, search]);
```

**Step 6: Add clickable source badge handler**

```javascript
const handleSourceBadgeClick = useCallback((source) => {
  // Find the narrowest scope matching this source
  for (const scope of searchScopes) {
    if (scope.children) {
      const match = scope.children.find(c => {
        const p = new URLSearchParams(c.params);
        return p.get('source') === source;
      });
      if (match) {
        handleScopeSelect(match);
        return;
      }
    }
  }
  logger.debug('content-browser.source-badge-no-scope', { source });
}, [searchScopes, handleScopeSelect, logger]);
```

**Step 7: Update the JSX — replace filter chips with dropdown**

Replace the entire `content-browser-header` div and `content-browser-filters` div with:

```jsx
<div className="content-browser-header">
  <ScopeDropdown
    scopes={searchScopes}
    activeKey={activeScopeKey}
    onSelect={handleScopeSelect}
    recents={recents}
    favorites={favorites}
    onToggleFavorite={toggleFavorite}
  />
  <input
    type="text"
    className="content-browser-search"
    placeholder="Search media..."
    value={searchText}
    onChange={handleSearch}
  />
</div>
```

Delete the entire `<div className="content-browser-filters">...</div>` block.

**Step 8: Add ScopeChips above results**

Inside `content-browser-results`, just before the loading spinner, add:

```jsx
<ScopeChips
  results={displayResults}
  scopes={searchScopes}
  activeKey={activeScopeKey}
  onSelect={handleScopeSelect}
/>
```

**Step 9: Make source badges clickable**

In the search result item rendering, change the source badge from:

```jsx
{item.source && <span className="source-badge">{item.source}</span>}
```

to:

```jsx
{item.source && (
  <span
    className="source-badge source-badge--clickable"
    onClick={(e) => { e.stopPropagation(); handleSourceBadgeClick(item.source); }}
    title={`Search only ${item.source}`}
  >
    {item.source}
  </span>
)}
```

**Step 10: Add clickable source badge SCSS**

In `MediaApp.scss`, after the existing `.source-badge` block, add:

```scss
.source-badge--clickable {
  cursor: pointer;
  &:hover { background: #333; color: #1db954; }
}
```

**Step 11: Verify the app renders correctly**

Start the dev server if not running: `npm run dev`
Open browser to `http://localhost:3112` and navigate to `/media`.
Verify:
- Scope dropdown appears left of search input
- Selecting a scope changes the label
- Searching with a scope active filters results
- Scope chips appear above results
- Source badges are clickable
- Scope persists on page refresh

**Step 12: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): wire ScopeDropdown and ScopeChips into ContentBrowser, remove filter chips"
```

---

### Task 7: Clean up dead code

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx` (verify no leftover filter references)
- Modify: `frontend/src/Apps/MediaApp.scss` (remove `.content-browser-filters` and `.filter-chip` if not already removed)

**Step 1: Search for leftover references**

Run: `grep -n 'activeFilter\|filter-chip\|content-browser-filters\|searchFilter' frontend/src/modules/Media/ContentBrowser.jsx frontend/src/Apps/MediaApp.scss`
Expected: No matches. If any remain, remove them.

**Step 2: Verify no console errors**

Open browser dev tools, navigate to `/media`, search for something. Check console for errors.

**Step 3: Commit (if changes needed)**

```bash
git add -u
git commit -m "chore(media): remove leftover filter chip references"
```

---

### Task 8: Verify full flow end-to-end

**Step 1: Test scope selection persistence**

1. Open `/media`
2. Open scope dropdown, select "Movies"
3. Search "star wars" — verify results are scoped to Plex video
4. Refresh page — verify "Movies" is still selected
5. Open dropdown — verify "Movies" appears in Recent section

**Step 2: Test favorites**

1. Open dropdown, star "Hymns"
2. Verify star turns gold
3. Verify "Hymns" appears in Favorites section at bottom
4. Refresh — verify favorite persists

**Step 3: Test scope chips**

1. Select "All" scope
2. Search "star wars"
3. Verify scope chips appear above results with counts (e.g. "Movies (5) | Home Video (12)")
4. Click "Movies" chip — verify scope changes and results narrow

**Step 4: Test source badge click**

1. In any results, click a source badge (e.g. "plex")
2. Verify dropdown switches to the narrowest scope matching that source

**Step 5: Test edge cases**

- Empty search scopes config: dropdown should show "All" fallback
- No results: no scope chips rendered
- Already on narrow scope: no scope chips shown
