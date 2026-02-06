# Content Scroller Abstraction Wiring Audit

**Date:** 2026-02-06
**Status:** Active defects identified
**Triggered by:** User reports of missing type-specific CSS (hymn, scripture) and mismatched/empty h1/h2 values

---

## Executive Summary

The Feb 2, 2026 abstraction that replaced domain-specific components (`<Scriptures>`, `<Hymns>`, `<Talk>`, `<Poetry>`) with abstract scrollers (`<SingingScroller>`, `<NarratedScroller>`) introduced **five categories of regression**:

1. **CSS type-class mismatch** — New scrollers emit `type="singing"` / `type="narrated"` but all SCSS rules target old type names (`hymn`, `scriptures`, `talk`, `poetry`)
2. **CSS variables defined but never consumed** — Inline `--font-family`, `--font-size`, etc. are set on wrapper divs but no SCSS rule references them via `var()`
3. **Content class name mismatch** — New scrollers emit `.singing-text` / `.narrated-text` but SCSS targets `.hymn-text` / `.scripture-text` / `.talk-text` / `.poetry-text`
4. **Title/subtitle data mismatch** — NarratedScroller shows a section heading as h2 instead of the scripture reference; subtitle (h3) is empty
5. **Missing shader rules** — Night, minimal, screensaver, dark shader variants have no rules for the new type names

---

## Runtime Evidence

**Test URL:** `http://localhost:3111/tv?scripture=dc88`
**Screenshot:** Captured via Playwright (1920x1080), Feb 6 2026

### DOM State Captured

| Element | Expected (Legacy) | Actual (New) | Verdict |
|---------|-------------------|--------------|---------|
| `.content-scroller` class | `content-scroller scriptures regular` | `content-scroller narrated  regular` | MISMATCH |
| `h2` text | `"D&C 88"` or `"Doctrine and Covenants 88"` | `"Faithful Saints Receive That Comforter, Which Is the Promise of Eternal Life"` | WRONG SOURCE |
| `h3` text | Section heading / subtitle | `null` (not rendered) | EMPTY |
| Verse text font-size | `2.8rem` (44.8px) | `16px` (1rem default) | REGRESSION |
| Verse text color | `#5d3408` (brown) | `rgb(0, 0, 0)` (black) | REGRESSION |
| Verse number styling | `.verse-number` with `font-size: 1rem`, color `#5d340855` | `.verse-num` — no matching CSS rules | UNSTYLED |
| Background color | `#fdf0d588` (warm parchment, on hymn) | `transparent` | MISSING |
| CSS variables on wrapper | N/A (legacy didn't use them) | `--font-family: serif; --font-size: 1.3rem; --text-align: left` — set but unused | DEAD CODE |
| `data-visual-type` | N/A | `"narrated"` — present but nothing consumes it | UNUSED |

### Visual Assessment

The rendered page shows:
- Title bar with a section heading instead of scripture reference
- No subtitle bar
- Very small black text (16px) on a plain background
- No scripture-specific typography (missing brown color, serif sizing, verse number superscripts)
- No parchment-like background coloring on the text panel
- Seek bar and controls render correctly (unaffected by abstraction)

---

## Defect Inventory

### DEFECT 1: CSS Type-Class Mismatch (Critical)

**Root cause:** The new abstract scrollers pass generic type names to ContentScroller, but ALL existing SCSS rules target the old domain-specific type names.

**Wiring:**
```
SingingScroller → type="singing"  → generates class: .content-scroller.singing
NarratedScroller → type="narrated" → generates class: .content-scroller.narrated
```

**SCSS rules that exist (ContentScroller.scss):**
```scss
.content-scroller.scriptures { ... }   // lines 112-167 — verse styling
.content-scroller.hymn { ... }         // lines 170-193 — stanza styling
.content-scroller.song { ... }         // lines 196-202
.content-scroller.poetry { ... }       // lines 205-233
.content-scroller.audiobook { ... }    // lines 236-242
.talk .textpanel { ... }               // lines 245-316
```

**SCSS rules that DON'T exist:**
```scss
.content-scroller.singing { ... }   // MISSING
.content-scroller.narrated { ... }  // MISSING
```

**Impact:** All type-specific styling (font sizes, colors, padding, background colors, verse layouts) is completely absent. The content renders with only base `.content-scroller` styles.

**Affected shader rules also missing:**
```scss
.scriptures.content-scroller { &.night { ... } &.dark { ... } ... }  // lines 318-339
.hymn.content-scroller { &.night { ... } &.dark { ... } ... }        // lines 341-363
.poetry.content-scroller { &.night { ... } &.dark { ... } ... }      // lines 365-387
.talk.content-scroller { &.night { ... } &.dark { ... } ... }        // lines 284-316
```
None of these fire for `type="singing"` or `type="narrated"`.

---

### DEFECT 2: CSS Variables Defined But Never Consumed (Medium)

**Root cause:** The design intent was for the backend API to provide style values as CSS variables, allowing per-collection customization. However, nothing in `ContentScroller.scss` references these variables.

**What's set (inline on wrapper div):**
```javascript
// SingingScroller.jsx:68-74
const cssVars = {
  '--font-family': data.style?.fontFamily || 'serif',
  '--font-size': data.style?.fontSize || '1.4rem',
  '--text-align': data.style?.textAlign || 'center',
  '--background': data.style?.background || 'transparent',
  '--color': data.style?.color || 'inherit'
};
```

**What's consumed in SCSS:** Nothing. Zero references to `var(--font-family)`, `var(--font-size)`, etc. anywhere in ContentScroller.scss.

**The textpanel still uses hardcoded:**
```scss
.textpanel {
  font-family: "Scripture", serif;  // hardcoded, ignores --font-family
  color: #000;                       // hardcoded, ignores --color
}
```

**Impact:** The API-driven styling system is entirely non-functional. All per-collection style customization from manifests is silently discarded.

---

### DEFECT 3: Content Element Class Name Mismatch (Critical)

**Root cause:** The new scrollers' `parseContent` functions generate different class names than what the SCSS targets.

| Scroller | Generated Classes | SCSS Expects |
|----------|-------------------|--------------|
| SingingScroller | `.singing-text > .stanza > p.line` | `.hymn-text > .stanza > p` |
| NarratedScroller (verses) | `.narrated-text.verses > p.verse > span.verse-num + span.verse-text` | `.scripture-text > .verse-number + .verse-text` |
| NarratedScroller (paragraphs) | `.narrated-text.paragraphs > p, h4` | `.talk-text > p, h4` |

**Specific mismatches:**

For **scripture** content:
- Generated: `.verse-num` — SCSS expects: `.verse-number`
- Generated: `.narrated-text` — SCSS expects: `.scripture-text`
- No `.verse-headings`, `.heading`, `.background`, `.summary` classes generated by NarratedScroller (the legacy Scriptures component used `convertVersesToScriptureData()` + `scriptureDataToJSX()` which produced these)

For **hymn** content:
- Generated: `.singing-text` — SCSS expects: `.hymn-text`
- Both use `.stanza > p` structure (this part matches)

For **talk** content:
- Generated: `.narrated-text.paragraphs` — SCSS expects: `.talk-text`

**Impact:** Per-type font sizes, colors, margins, padding, and structural layouts are all broken.

---

### DEFECT 4: Title/Subtitle Data Source Mismatch (High)

**Root cause:** The NarratedAdapter provides title/subtitle from different metadata fields than the legacy `localContent` router.

**Legacy Scriptures component (ContentScroller.jsx:447-456):**
```javascript
DaylightAPI(`api/v1/local-content/scripture/${scripture}`).then(({reference, assetId, mediaUrl, verses}) => {
  setTitleHeader(reference);          // h2 = "D&C 88" (the scripture reference)
  if (verses && verses[0]?.headings) {
    const { title, subtitle: st } = verses[0].headings;
    setSubtitle([title, st].filter(Boolean).join(" • "));  // h3 = section heading
  }
});
```

**NarratedAdapter (backend):**
```javascript
const title = titleSource?.title
  || titleSource?.headings?.heading
  || titleSource?.headings?.title
  || textPath;
const subtitle = titleSource?.speaker
  || titleSource?.author
  || titleSource?.headings?.section_title
  || null;
```

**Result for D&C 88:**
- Legacy h2: `"D&C 88"` (from `reference` field)
- Legacy h3: `"Faithful Saints Receive That Comforter..."` (from `headings.title`)
- New h2: `"Faithful Saints Receive That Comforter..."` (from `title` or `headings.title` — the section heading got promoted to title)
- New h3: `null` (no `speaker`, `author`, or `section_title` field matched)

**Impact:** The scripture reference (what the user expects to see — "D&C 88") is nowhere in the h2/h3 display. The section heading has been promoted to h2, and h3 is empty.

---

### DEFECT 5: Scripture Content Parsing Regression (High)

**Root cause:** The legacy Scriptures component used specialized parsing (`convertVersesToScriptureData` + `scriptureDataToJSX` from `scripture-guide.jsx`) that handled headings, blockquotes, italic markers, verse groups, and section breaks. The NarratedScroller has a generic parser that doesn't understand scripture-specific markup.

**Legacy parsing (ContentScroller.jsx:465-473):**
```javascript
const parseScriptureContent = useCallback((allVerses) => {
  const data = convertVersesToScriptureData(allVerses);
  return <div className="scripture-text">{scriptureDataToJSX(data)}</div>;
}, []);
```

**New parsing (NarratedScroller.jsx:48-59):**
```javascript
if (contentData.type === 'verses') {
  return (
    <div className="narrated-text verses">
      {contentData.data.map((verse, idx) => (
        <p key={idx} className="verse">
          <span className="verse-num">{verse.verse}</span>
          <span className="verse-text">{verse.text}</span>
        </p>
      ))}
    </div>
  );
}
```

**What's lost:**
- Section headings within chapters (`.heading` class)
- Background/summary verse styling (italic, different color)
- Blockquote formatting for poetic sections
- Verse grouping by section
- The `§¶` and `｟｠` markup characters visible in raw text are NOT being processed (see DOM capture: `"§¶｟Verily｠, thus saith the Lord..."`)

---

## Architecture Diagram: Before vs After

### Before (Legacy — Working)

```
/tv?scripture=dc88
  └─ SinglePlayer: scripture="dc88" → no contentId → falls through to legacy
     └─ <Scriptures scripture="dc88">
        ├─ API: GET /api/v1/local-content/scripture/dc88
        │  └─ Returns: { reference: "D&C 88", verses: [...with headings...] }
        ├─ Title: setTitleHeader("D&C 88")               → <h2>D&C 88</h2>
        ├─ Subtitle: setSubtitle("Faithful Saints...")    → <h3>Faithful Saints...</h3>
        ├─ parseContent: convertVersesToScriptureData()   → rich JSX with headings, blockquotes
        │  └─ Outputs: <div class="scripture-text">       → SCSS matches ✓
        │     ├─ <span class="verse-number">              → SCSS matches ✓
        │     └─ <span class="verse-text">                → SCSS matches ✓
        └─ <ContentScroller type="scriptures">            → SCSS matches ✓
           └─ class="content-scroller scriptures regular" → All rules fire ✓
```

### After (New — Broken)

```
/tv?scripture=dc88
  └─ SinglePlayer: scripture="dc88"
     └─ contentId = "narrated:scripture/dc88" → category = "narrated"
        └─ <NarratedScroller contentId="narrated:scripture/dc88">
           ├─ API: GET /api/v1/item/narrated/scripture/dc88
           │  └─ Returns: { title: "Faithful Saints...", subtitle: null, style: {...} }
           ├─ Title: data.title                           → <h2>Faithful Saints...</h2> WRONG
           ├─ Subtitle: data.subtitle                     → null (not rendered) EMPTY
           ├─ parseContent: generic verse renderer         → flat list, no headings/blockquotes
           │  └─ Outputs: <div class="narrated-text verses"> → NO SCSS matches ✗
           │     ├─ <span class="verse-num">               → NO SCSS matches ✗
           │     └─ <span class="verse-text">              → inherits base only ✗
           ├─ cssVars: --font-family: serif; --font-size: 1.3rem → SET but UNUSED ✗
           └─ <ContentScroller type="narrated">            → NO SCSS matches ✗
              └─ class="content-scroller narrated regular" → No rules fire ✗
```

---

## Affected Routing Paths

| URL Pattern | Legacy Route | New Route | CSS Working? |
|-------------|-------------|-----------|-------------|
| `/tv?scripture=dc88` | Would use `<Scriptures>` | Uses `<NarratedScroller>` | NO |
| `/tv?scripture=bom` | Would use `<Scriptures>` | Uses `<NarratedScroller>` | NO |
| `/tv?hymn=2` | Would use `<Hymns>` | Uses `<SingingScroller>` | NO |
| `/tv?primary=5` | Would use `<Hymns>` | Uses `<SingingScroller>` | NO |
| `/tv?talk=...` | Uses `<Talk>` (legacy) | Uses `<Talk>` (legacy) | YES (not converted yet) |
| `/tv?poem=...` | Uses `<Poetry>` (legacy) | Uses `<Poetry>` (legacy) | YES (not converted yet) |
| `contentId=singing:hymn/2` | N/A | Uses `<SingingScroller>` | NO |
| `contentId=narrated:scripture/...` | N/A | Uses `<NarratedScroller>` | NO |

**Note:** `talk` and `poem` are NOT converted to the new system (see SinglePlayer.jsx:88 comment: "talk and poem use LocalContentAdapter and use legacy fallback"). They still work correctly via the legacy path.

---

## Files Involved

### Frontend

| File | Role | Issue |
|------|------|-------|
| `frontend/src/modules/ContentScroller/SingingScroller.jsx` | New singing wrapper | Emits wrong CSS type, unused CSS vars |
| `frontend/src/modules/ContentScroller/NarratedScroller.jsx` | New narrated wrapper | Emits wrong CSS type, wrong class names, wrong title source, generic parser |
| `frontend/src/modules/ContentScroller/ContentScroller.jsx` | Base component + legacy wrappers | Legacy wrappers still present and working; base renders `type` into class name |
| `frontend/src/modules/ContentScroller/ContentScroller.scss` | All styling | Has rules for old types only; no rules for `singing`/`narrated`; CSS variables unused |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Routing | Constructs contentId from legacy props, routes to new scrollers |
| `frontend/src/lib/queryParamResolver.js` | Category detection | Works correctly (`getCategoryFromId`) |
| `frontend/src/lib/scripture-guide.jsx` | Rich scripture parsing | NOT used by NarratedScroller (regression) |

### Backend

| File | Role | Issue |
|------|------|-------|
| `backend/src/4_api/v1/routers/item.mjs` | New item endpoints | Returns style object, but frontend doesn't consume it |
| `backend/src/2_adapters/content/narrated/NarratedAdapter.mjs` | Narrated data adapter | Title/subtitle field resolution differs from legacy |
| `backend/src/2_adapters/content/singing/SingingAdapter.mjs` | Singing data adapter | Style defaults present but unused |
| `backend/src/4_api/v1/routers/localContent.mjs` | Legacy endpoints | Still functional, still returns correct data shape |

---

## Recommendations

### Option A: Bridge the SCSS (Quick Fix)

Add alias rules in `ContentScroller.scss` that map new type names to existing styles:

```scss
// Bridge abstract types to existing style rules
.content-scroller.narrated { @extend .content-scroller.scriptures; }
.content-scroller.singing { @extend .content-scroller.hymn; }
.narrated.content-scroller { @extend .scriptures.content-scroller; }
.singing.content-scroller { @extend .hymn.content-scroller; }
```

**Problem:** This doesn't distinguish narrated:scripture from narrated:talk — both get scripture styling.

### Option B: Pass the Collection as Subtype (Recommended)

Have the abstract scrollers pass the **collection** (e.g., `scripture`, `hymn`, `talk`) as a secondary class or as the `type` prop, preserving all existing SCSS:

```javascript
// NarratedScroller: extract collection from contentId
const collection = path.split('/')[0]; // "scripture", "talks", "poetry"
const typeMap = { scripture: 'scriptures', talks: 'talk', poetry: 'poetry' };
// ...
<ContentScroller type={typeMap[collection] || 'narrated'} ... />
```

```javascript
// SingingScroller: extract collection from contentId
const collection = path.split('/')[0]; // "hymn", "primary"
const typeMap = { hymn: 'hymn', primary: 'hymn' };
// ...
<ContentScroller type={typeMap[collection] || 'singing'} ... />
```

This reuses ALL existing SCSS rules with zero new CSS needed.

### Option C: Complete the CSS Variable System (Thorough)

Actually consume the CSS variables in SCSS for the new type names, AND have the backend provide ALL necessary style values (not just font/color, but also verse-specific sizing, padding, background colors):

```scss
.content-scroller.narrated {
  .textpanel { font-family: var(--font-family); font-size: var(--font-size); ... }
  .narrated-text .verse-text { font-size: var(--verse-font-size); color: var(--verse-color); ... }
}
```

**Problem:** Requires significant backend work to provide all the values currently hardcoded in SCSS, and still doesn't address the title/subtitle or scripture markup parsing issues.

### Title/Subtitle Fix (Required for All Options)

The NarratedAdapter needs to return `reference` for scripture content so the frontend can use it as h2, with the section heading as h3 — matching legacy behavior:

```javascript
// NarratedAdapter: for scripture collection
return {
  title: metadata.reference || textPath,     // "D&C 88"
  subtitle: metadata.headings?.title || null, // section heading
  ...
};
```

### Scripture Parsing Fix (Required for All Options)

NarratedScroller needs to use `convertVersesToScriptureData()` + `scriptureDataToJSX()` for verse-type content from the scripture collection, or the NarratedAdapter needs to pre-process the markup so the generic renderer produces equivalent output.

---

## Verification Checklist

After fixes are applied, verify each of these:

- [ ] `/tv?scripture=dc88` — h2 shows "D&C 88" (reference), h3 shows section heading
- [ ] `/tv?scripture=dc88` — verse text is brown (#5d3408), ~2.8rem font size
- [ ] `/tv?scripture=dc88` — verse numbers are superscript, small, faded
- [ ] `/tv?scripture=dc88` — section headings render within the text body
- [ ] `/tv?scripture=dc88` — blockquotes render for poetic sections
- [ ] `/tv?scripture=dc88` — night/dark/minimal/screensaver shaders work
- [ ] `/tv?hymn=2` — hymn-specific background color (#fdf0d588)
- [ ] `/tv?hymn=2` — stanza text is 3rem, correct indentation
- [ ] `/tv?hymn=2` — h2 shows hymn title, h3 shows hymn number
- [ ] `/tv?hymn=2` — night/dark/minimal/screensaver shaders work
- [ ] `contentId=singing:hymn/2` — same visual result as `/tv?hymn=2`
- [ ] `contentId=narrated:scripture/dc88` — same visual result as legacy scripture rendering
- [ ] `/tv?talk=...` — still works (legacy path, should be unaffected)
- [ ] `/tv?poem=...` — still works (legacy path, should be unaffected)
