# Readalong Sticky Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked h2 (title) + h3 (subtitle) in ContentScroller with a single dynamic header that saves ~48px of vertical space and shows sticky section context as content scrolls.

**Architecture:** A single `<header>` element replaces the two headings. Title is always visible; when an in-body `<h4>` heading scrolls off-screen, its text appears on the right side of the header bar via CSS transitions. The current section is determined by comparing `yOffset` against measured h4 positions.

**Tech Stack:** React (JSX), CSS transitions, DOM measurement (`offsetTop`)

**Spec:** `docs/superpowers/specs/2026-03-22-readalong-sticky-header-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Player/renderers/ContentScroller.jsx:300-310` | Modify | Replace h2+h3 with single dynamic header; add h4 position tracking; derive current section from yOffset |
| `frontend/src/modules/Player/styles/ContentScroller.scss:14-39` | Modify | Replace h2+h3 styles with single `.scroller-header`; add transition styles for title centering and section fade/slide |

---

### Task 1: Replace h2+h3 JSX with single dynamic header

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.jsx`

- [ ] **Step 1: Add h4 position tracking ref and measurement effect**

After the existing `useDynamicDimensions` hook (line ~100), add:

```javascript
  // Track in-body heading positions for sticky header
  const headingPositionsRef = useRef([]);

  // Measure h4 positions after content renders
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    const h4s = contentEl.querySelectorAll('h4');
    headingPositionsRef.current = Array.from(h4s).map(el => ({
      top: el.offsetTop,
      text: el.textContent,
    }));
  }, [contentData]);
```

- [ ] **Step 2: Add currentSection derived from yOffset**

After the `yOffset` useMemo (line ~299), add:

```javascript
  // Determine which section heading has scrolled past
  const currentSection = useMemo(() => {
    const positions = headingPositionsRef.current;
    if (!positions.length || yOffset <= 0) return null;
    // Find the last heading whose top is <= yOffset
    let current = null;
    for (const pos of positions) {
      if (pos.top <= yOffset) current = pos.text;
      else break;
    }
    return current;
  }, [yOffset]);
```

- [ ] **Step 3: Replace h2+h3 render with single header**

Replace lines 305-310:
```jsx
        {(title || subtitle) && (
          <>
            {title && <h2>{title}</h2>}
            {subtitle && <h3>{subtitle}</h3>}
          </>
        )}
```

With:
```jsx
        {title && (
          <header className={`scroller-header${currentSection ? ' has-section' : ''}`}>
            <span className="scroller-header-title">{title}</span>
            {currentSection && (
              <span key={currentSection} className="scroller-header-section">
                {currentSection}
              </span>
            )}
          </header>
        )}
```

Note: The `key={currentSection}` on the section span forces React to remount it when the text changes, triggering the CSS fade-in animation each time.

- [ ] **Step 4: Verify build succeeds**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/renderers/ContentScroller.jsx
git commit -m "feat(scroller): replace h2+h3 with single dynamic sticky header

Track h4 positions in content, derive current section from yOffset,
render single header that shows section context when headings scroll past."
```

---

### Task 2: SCSS — replace h2+h3 styles with dynamic header

**Files:**
- Modify: `frontend/src/modules/Player/styles/ContentScroller.scss`

- [ ] **Step 1: Replace h2 and h3 style blocks**

Replace the h2 block (lines 14-25) and h3 block (lines 26-39) with:

```scss
  .scroller-header {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #222;
    height: 4rem;
    padding: 0 2rem;
    overflow: hidden;
    transition: justify-content 0.4s ease;

    &.has-section {
      justify-content: space-between;
    }
  }

  .scroller-header-title {
    color: #ffffff99;
    font-size: 3rem;
    line-height: 4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.4s ease;

    .has-section & {
      flex: 0 1 auto;
      max-width: 50%;
    }
  }

  .scroller-header-section {
    color: #ffffff66;
    font-size: 2rem;
    line-height: 4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 50%;
    text-align: right;

    // Fade+slide in animation on mount (triggered by key change)
    animation: sectionFadeIn 0.4s ease forwards;
  }

  @keyframes sectionFadeIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
```

- [ ] **Step 2: Update shader mode selectors**

Throughout the SCSS file, replace all instances of `h2, h3` with `.scroller-header`. These appear in shader variants:

Find and replace all occurrences of `h2, h3, .controls` with `.scroller-header, .controls` in these selectors:
- `.content-scroller` `&.night` (line ~308)
- `.content-scroller` `&.video` (line ~313)
- `.content-scroller` `&.text` (line ~318)
- `.content-scroller` `&.minimal` (line ~329)
- `.scriptures.content-scroller` variants (lines ~340, ~353)
- `.hymn.content-scroller, .singalong.content-scroller` variants (lines ~362, ~377)
- `.poetry.content-scroller` variants (lines ~386, ~401)

Use find-and-replace: `h2, h3` → `.scroller-header` (the `, .controls` part stays unchanged).

- [ ] **Step 3: Verify build succeeds**

Run: `npx vite build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/styles/ContentScroller.scss
git commit -m "style(scroller): single dynamic header with section fade-in animation

Replace stacked h2+h3 with flex .scroller-header that transitions
between centered title and split title+section layout. Update all
shader mode selectors."
```

---

### Task 3: Build and deploy

- [ ] **Step 1: Pull latest and build**

```bash
git pull origin main
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 2: Deploy and reload FKB**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Then clear FKB cache and reload:
```python
# Use Python to handle password escaping
sudo docker exec daylight-station sh -c 'cat data/household/auth/fullykiosk.yml' | python3 -c "
import sys, yaml, urllib.parse, urllib.request, time
data = yaml.safe_load(sys.stdin.read())
pw = urllib.parse.quote(str(data['password']))
urllib.request.urlopen(f'http://10.0.0.11:2323/?cmd=clearCache&password={pw}', timeout=15)
time.sleep(2)
urllib.request.urlopen(f'http://10.0.0.11:2323/?cmd=loadStartURL&password={pw}', timeout=15)
print('Cache cleared and reloaded.')
"
```

- [ ] **Step 3: Test with readalong content**

Play a talk or scripture reading that has `##` section headings. Verify:
1. On load: title is centered, no section text visible
2. As content scrolls past a `##` heading: title slides left, section heading fades in on right
3. When a new heading scrolls past: section text updates with fade animation
4. Seeking back above all headings: section disappears, title re-centers
