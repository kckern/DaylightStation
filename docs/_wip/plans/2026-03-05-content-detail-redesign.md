# Content Detail View Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the full-width hero banner in ContentDetailView with a horizontal poster+info layout and add a list/grid toggle for children.

**Architecture:** Single-component restructure of `ContentDetailView.jsx` and its SCSS block in `MediaApp.scss`. No new files, no API changes, no new dependencies. All existing callbacks stay intact.

**Tech Stack:** React, SCSS, localStorage for view toggle persistence

---

### Task 1: Restructure ContentDetailView JSX — Header Section

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:95-158`

**Step 1: Replace hero banner with poster+info horizontal layout**

Replace lines 95-158 (everything from `const heroImage` through the summary section closing) with:

```jsx
  const heroImage = data.thumbnail || data.image || data.imageUrl || ContentDisplayUrl(contentId);
  const isContainer = children.length > 0;
  const capabilities = data.capabilities || [];

  // Metadata chips — render only what exists
  const metaChips = [
    data.year,
    data.studio || data.metadata?.artist || data.metadata?.albumArtist,
    data.duration ? `${Math.floor(data.duration / 3600) > 0 ? Math.floor(data.duration / 3600) + 'h ' : ''}${Math.floor((data.duration % 3600) / 60)}m` : null,
    data.type,
  ].filter(Boolean);

  return (
    <div className="content-detail-view">
      {/* Header: poster + info side by side */}
      <div className="detail-header">
        <div className="detail-poster">
          <img src={heroImage} alt="" />
        </div>
        <div className="detail-info">
          <h2 className="detail-title">{data.title}</h2>
          {metaChips.length > 0 && (
            <div className="detail-meta">
              {metaChips.map((chip, i) => (
                <span key={i} className="detail-chip">{chip}</span>
              ))}
              {data.source && <span className="source-badge">{data.source}</span>}
              {data.format && <span className={`format-badge format-badge--${data.format}`}>{data.format}</span>}
            </div>
          )}
          {data.subtitle && <div className="detail-subtitle">{data.subtitle}</div>}
          <DetailSummary tagline={data.tagline || data.metadata?.tagline} summary={data.summary || data.metadata?.summary} />
          <div className="detail-actions">
            {capabilities.includes('playable') && (
              <button className="action-btn action-btn--primary" onClick={() => handlePlayNow(null)}>
                &#9654; Play
              </button>
            )}
            {isContainer && (
              <button className="action-btn action-btn--primary" onClick={() => {
                const items = children.map(c => ({
                  contentId: c.id || c.contentId,
                  title: c.title,
                  format: c.format,
                  thumbnail: c.thumbnail || c.image,
                })).filter(c => c.contentId);
                queue.playNow(items);
              }}>
                &#9654; Play All
              </button>
            )}
            {(capabilities.includes('playable') || isContainer) && (
              <>
                <button className="action-btn" onClick={() => handlePlayNext(null)}>&#10549; Next</button>
                <button className="action-btn" onClick={() => handleAddToQueue(null)}>+ Queue</button>
              </>
            )}
            {isContainer && (
              <button className="action-btn" onClick={handleShuffle}>&#8645; Shuffle</button>
            )}
            <CastButton contentId={contentId} className="action-btn" />
          </div>
        </div>
      </div>
```

**Step 2: Add the DetailSummary sub-component above the main component**

Add this above `const ContentDetailView = ...` (around line 10):

```jsx
const DetailSummary = ({ tagline, summary }) => {
  const [expanded, setExpanded] = React.useState(false);
  if (!tagline && !summary) return null;
  return (
    <div className={`detail-summary${expanded ? ' detail-summary--expanded' : ''}`}>
      {tagline && <p className="detail-tagline">{tagline}</p>}
      {summary && <p className="detail-summary-text">{summary}</p>}
      {summary && summary.length > 150 && (
        <button className="detail-summary-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
};
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "refactor(media): restructure detail view header to poster+info layout"
```

---

### Task 2: Add Children List/Grid Toggle

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx:160-196`

**Step 1: Add view toggle state at the top of the component**

Add after `const playingRef = useRef(false);` (line 15):

```jsx
  const [childrenView, setChildrenView] = useState(() => {
    try { return localStorage.getItem('media:childrenView') || 'list'; } catch { return 'list'; }
  });
  const toggleChildrenView = useCallback(() => {
    setChildrenView(prev => {
      const next = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem('media:childrenView', next); } catch {}
      return next;
    });
  }, []);
```

Note: add `useState` and `useCallback` to the existing React import if not already present (they are — line 1).

**Step 2: Replace children section JSX**

Replace the current children block (from `{isContainer && (` to its closing `)}`) with:

```jsx
      {isContainer && (
        <>
          <div className="detail-children-header">
            <span className="detail-children-count">
              {children.length} {data.type === 'show' ? 'Episodes' : data.type === 'artist' ? 'Albums' : 'Items'}
            </span>
            <div className="detail-children-toggle">
              <button
                className={`toggle-btn${childrenView === 'list' ? ' active' : ''}`}
                onClick={() => childrenView !== 'list' && toggleChildrenView()}
                aria-label="List view"
              >&#9776;</button>
              <button
                className={`toggle-btn${childrenView === 'grid' ? ' active' : ''}`}
                onClick={() => childrenView !== 'grid' && toggleChildrenView()}
                aria-label="Grid view"
              >&#9638;</button>
            </div>
          </div>
          <div className={`detail-children detail-children--${childrenView}`}>
            {children.map((child, i) => {
              const childId = child.id || child.contentId;
              const childThumb = child.thumbnail || child.image || (childId ? ContentDisplayUrl(childId) : null);
              return (
                <div key={childId || i} className="detail-child-item">
                  <div className="child-item-thumb" onClick={() => handleChildClick(child)}>
                    {childThumb && <img src={childThumb} alt="" loading="lazy" />}
                  </div>
                  <div className="child-item-info" onClick={() => handleChildClick(child)}>
                    <div className="child-item-title">
                      {child.itemIndex !== undefined && <span className="child-item-index">{child.itemIndex}.</span>}
                      {child.title}
                    </div>
                    <div className="child-item-meta">
                      {child.type && <span className="type-badge">{child.type}</span>}
                      {child.duration && <span>{Math.round(child.duration / 60)}m</span>}
                      {child.artist && <span>{child.artist}</span>}
                    </div>
                    {child.watchProgress > 0 && (
                      <div className="child-item-progress">
                        <div className="child-item-progress-bar" style={{ width: `${child.watchProgress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="child-item-actions">
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNow(child); }} title="Play">&#9654;</button>}
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNext(child); }} title="Play Next">&#10549;</button>}
                    {child.play && <button onClick={(e) => { e.stopPropagation(); handleAddToQueue(child); }} title="Add to Queue">+</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
```

**Step 3: Close the component and commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): add children list/grid toggle with localStorage persistence"
```

---

### Task 3: Replace SCSS — Detail Header Styles

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:1132-1255`

**Step 1: Replace the hero, title-bar, actions, and summary SCSS blocks**

Delete lines 1132-1255 (from `/* ========== Content Detail View */` through `.content-detail-summary` closing brace) and replace with:

```scss
/* ========== Content Detail View ========== */

.content-detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: #121212;
  color: #e0e0e0;
}

.content-detail-back {
  background: rgba(0,0,0,0.5);
  border: none;
  color: #fff;
  font-size: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { background: rgba(255,255,255,0.2); }
}

.content-detail-loading,
.content-detail-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #888;
}

// ── Detail Header (poster + info) ────────────────────────────
.detail-header {
  display: flex;
  gap: 16px;
  padding: 16px;
  flex-shrink: 0;

  @include mobile-only {
    flex-direction: column;
    align-items: center;
  }
}

.detail-poster {
  flex-shrink: 0;
  width: 33%;
  max-width: 200px;

  img {
    width: 100%;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 8px;
    background: #222;
  }

  @include mobile-only {
    width: 60%;
    max-width: 240px;
  }
}

.detail-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  color: #fff;
  line-height: 1.2;
}

.detail-subtitle {
  font-size: 14px;
  color: #aaa;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}

.detail-chip {
  color: #aaa;
  &::after {
    content: '\00b7';
    margin-left: 6px;
    color: #555;
  }
  &:last-of-type::after { content: none; }
}

// ── Summary with clamp ───────────────────────────────────────
.detail-summary {
  font-size: 13px;
  line-height: 1.5;
  color: #aaa;
  margin-top: 4px;
}

.detail-tagline {
  font-style: italic;
  color: #ccc;
  margin: 0 0 4px;
}

.detail-summary-text {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;

  .detail-summary--expanded & {
    -webkit-line-clamp: unset;
    overflow: visible;
  }
}

.detail-summary-toggle {
  background: none;
  border: none;
  color: #1db954;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
  &:hover { text-decoration: underline; }
}

// ── Actions ──────────────────────────────────────────────────
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;

  .action-btn {
    background: #282828;
    border: 1px solid #333;
    color: #e0e0e0;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;

    &:hover { background: #333; border-color: #1db954; color: #fff; }

    &--primary {
      background: #1db954;
      border-color: #1db954;
      color: #000;
      font-weight: 600;
      &:hover { background: #1ed760; }
    }
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "style(media): replace hero banner with poster+info header layout"
```

---

### Task 4: Replace SCSS — Children Section Styles

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss:1257-1348`

**Step 1: Replace the children and child-item SCSS blocks**

Delete lines 1257-1348 (from `.content-detail-children` through the last `.content-detail-child-item` closing) and replace with:

```scss
// ── Children Header + Toggle ─────────────────────────────────
.detail-children-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 8px;
  border-top: 1px solid #222;
}

.detail-children-count {
  font-size: 13px;
  color: #888;
  font-weight: 500;
}

.detail-children-toggle {
  display: flex;
  gap: 2px;

  .toggle-btn {
    background: none;
    border: 1px solid #333;
    color: #666;
    font-size: 14px;
    width: 30px;
    height: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:first-child { border-radius: 4px 0 0 4px; }
    &:last-child { border-radius: 0 4px 4px 0; }
    &.active { background: #282828; color: #e0e0e0; border-color: #555; }
    &:hover:not(.active) { border-color: #555; color: #aaa; }
  }
}

// ── Children: List Mode ──────────────────────────────────────
.detail-children--list {
  padding: 0 8px;

  .detail-child-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;

    &:hover { background: #1a1a1a; }

    .child-item-thumb {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 4px;
      overflow: hidden;
      background: #222;
      img { width: 100%; height: 100%; object-fit: cover; }
    }

    .child-item-info {
      flex: 1;
      min-width: 0;
    }

    .child-item-title {
      font-size: 13px;
      color: #e0e0e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      .child-item-index { color: #666; margin-right: 6px; font-variant-numeric: tabular-nums; }
    }

    .child-item-meta {
      display: flex;
      gap: 8px;
      font-size: 11px;
      color: #888;
      margin-top: 2px;
    }

    .child-item-progress {
      height: 3px;
      background: #333;
      border-radius: 2px;
      margin-top: 4px;
      overflow: hidden;

      .child-item-progress-bar { height: 100%; background: #1db954; border-radius: 2px; }
    }

    .child-item-actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;

      button {
        background: transparent;
        border: none;
        color: #888;
        font-size: 14px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        &:hover { color: #1db954; background: #282828; }
      }
    }

    &:hover .child-item-actions { opacity: 1; }
  }
}

// ── Children: Grid Mode ──────────────────────────────────────
.detail-children--grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 8px 12px;

  @include mobile-only {
    grid-template-columns: repeat(2, 1fr);
  }

  .detail-child-item {
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    background: #1a1a1a;
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: #252525; }

    .child-item-thumb {
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      background: #222;
      position: relative;
      img { width: 100%; height: 100%; object-fit: cover; }
    }

    .child-item-info {
      padding: 8px 10px;
      min-width: 0;
    }

    .child-item-title {
      font-size: 12px;
      color: #e0e0e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      .child-item-index { color: #666; margin-right: 4px; font-variant-numeric: tabular-nums; }
    }

    .child-item-meta {
      display: flex;
      gap: 6px;
      font-size: 10px;
      color: #888;
      margin-top: 2px;
    }

    .child-item-progress {
      height: 3px;
      background: #333;
      margin-top: 4px;
      .child-item-progress-bar { height: 100%; background: #1db954; }
    }

    .child-item-actions { display: none; }
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "style(media): add children list/grid view styles"
```

---

### Task 5: Verify and Final Commit

**Step 1: Check dev server compiles without errors**

```bash
ss -tlnp | grep 3112
# If not running, start: ./dev --background
```

Then check for build errors in the browser or dev log.

**Step 2: Visual verification checklist**

- [ ] Movie detail: poster on left (portrait), title/year/studio/duration on right, summary clamped
- [ ] "more" toggle expands summary
- [ ] Action buttons visible below summary
- [ ] Children list view works (default)
- [ ] Toggle to grid view — 3 column cards
- [ ] Toggle persists across navigation
- [ ] Mobile: poster stacks on top, grid goes to 2 columns
- [ ] No hero banner anywhere

**Step 3: Squash or final commit if needed**

```bash
git push origin main
```

---

Plan complete and saved. **Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?