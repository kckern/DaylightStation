# QR Code Renderer Design

Styled SVG QR code generator with dot-style modules, center logo, frame, and auto-generated labels. Supports raw data encoding, content metadata resolution, and command icon auto-detection.

**Date:** 2026-03-30

---

## Overview

```
API Request
    │
    ├─► Raw mode:    ?data=office;plex;595104+shuffle
    ├─► Content mode: ?content=plex:595104&options=shuffle
    └─► Command auto: ?data=pause  (detected as known command)
           │
           ▼
    ┌─── Resolve context ───┐
    │ Content: /api/v1/info  │
    │ Command: icon lookup   │
    │ Raw: use as-is         │
    └────────┬───────────────┘
             ▼
    QRCodeRenderer.renderSvg(data, options)
             │
             ├─► QRCode.create() → binary matrix
             ├─► Render dots (circles) for data modules
             ├─► Render finder patterns (rounded squares)
             ├─► Mask center → embed logo (base64)
             ├─► Draw frame border
             ├─► Draw label + sublabel text
             └─► Draw option badges (shuffle, continuous icons)
             │
             ▼
    SVG string → Content-Type: image/svg+xml
```

---

## API

**Endpoint:** `GET /api/v1/qrcode`

### Modes

**Raw mode** — encode any string as-is:
```
GET /api/v1/qrcode?data=office;plex;595104+shuffle
```

**Content mode** — resolve contentId metadata, auto-generate label/logo:
```
GET /api/v1/qrcode?content=plex:595104&options=shuffle&screen=office
```
Encodes `office:plex:595104+shuffle` into the QR. Fetches metadata from `/api/v1/info/plex/595084` for title, thumbnail, type. Falls back to queue endpoint thumbnail if info has none.

**Command auto-detect** — when `data` matches a known command, uses the command icon as logo and command name as label:
```
GET /api/v1/qrcode?data=pause
GET /api/v1/qrcode?data=office;volume;30
```

### Query Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `data` | — | Raw string to encode into QR |
| `content` | — | ContentId to resolve (mutually exclusive with `data`) |
| `options` | — | Content options to append with `+` (e.g. `shuffle`, `shader=dark`) |
| `screen` | — | Screen prefix to prepend (e.g. `office`) |
| `label` | auto | Override label text |
| `sublabel` | auto | Override sublabel text |
| `logo` | favicon | Logo path, URL, or `false` to disable |
| `size` | 300 | QR code size in pixels (frame and label add to total height) |
| `style` | dots | `dots` (circles) or `squares` (standard) |
| `fg` | #000000 | Foreground/dot color |
| `bg` | #ffffff | Background color |

### Response

`Content-Type: image/svg+xml` — SVG string with all images base64-embedded for print/PDF compatibility.

---

## Rendering

### QR Matrix

Uses `qrcode` npm package (`QRCode.create(data, { errorCorrectionLevel: 'H' })`). Level H (30% error correction) allows the center logo to cover ~10-15% of modules without breaking scannability.

### Dot Style

Data modules are rendered as circles (`<circle>`) instead of standard squares. Radius is slightly smaller than half the module size to create visible spacing between dots.

### Finder Patterns

The three corner finder patterns (7x7 module squares) are rendered as concentric rounded rectangles — standard QR pattern with rounded corners for style consistency. These are NOT rendered as dots (they must remain recognizable for scanner alignment).

### Logo

A circular mask in the center of the QR matrix. Modules within the mask area are skipped (not rendered). The logo image is embedded as `<image href="data:image/...;base64,..."/>` inside a `<clipPath>` circle.

**Logo sources (in priority order):**
1. Explicit `logo` param (path or URL)
2. Command icon from `media/img/buttons/{command}.svg` (if command auto-detected)
3. Content thumbnail from `/api/v1/info/` or queue endpoint (if content mode)
4. Default favicon

### Frame

Rounded rectangle border around the QR code area. Provides visual containment and quiet zone.

### Label

Text below the QR code, inside the frame.

- **Label** — primary text (title, command name)
- **Sublabel** — secondary text (artist, episode info, option description)

**Auto-generated from content metadata:**

| Content Type | Label | Sublabel |
|-------------|-------|----------|
| Movie | Movie title | Year |
| TV Episode | Show name | S##E## — Episode title |
| Music/Album | Album title | Artist — track count |
| Artist | Artist name | Library section |
| Playlist/Queue | Queue name | Item count |
| Command | Command name (uppercase) | Argument if parameterized |

### Option Badges

When content options are present (`shuffle`, `continuous`), small icons from `media/img/buttons/` are rendered next to the sublabel. The SVG icon path data is embedded inline.

---

## Content Resolution

When `content` param is provided:

1. Call `GET /api/v1/info/{source}/{id}` (internal, via adapter) for lightweight metadata: title, type, thumbnail, parent info
2. If no thumbnail in info response, use the queue endpoint's top-level thumbnail
3. Fetch thumbnail image, convert to base64 for embedding
4. Build label/sublabel from metadata fields
5. Construct encoded data string: `[screen:][action:]source:id[+options]`

---

## Command Auto-Detection

When `data` param is provided, the router checks if the parsed segments contain a known command (using `KNOWN_COMMANDS` from `BarcodeCommandMap`). If detected:

- Logo → `media/img/buttons/{command}.svg` (read and embed inline)
- Label → command name uppercase (e.g. "PAUSE", "VOLUME 30")
- No content resolution needed

Command icon mapping:

| Command | Icon file |
|---------|-----------|
| `pause` | `pause.svg` |
| `play` | `play.svg` |
| `next` | `next.svg` |
| `prev` | `prev.svg` |
| `ffw` | `ffw.svg` |
| `rew` | `rew.svg` |
| `stop` | `stop.svg` |
| `off` | `off.svg` |
| `blackout` | `blackout.svg` |
| `volume` | `vol_up.svg` |
| `speed` | `speed.svg` |

---

## File Structure

| Layer | File | Purpose |
|-------|------|---------|
| Rendering | `backend/src/1_rendering/qrcode/index.mjs` | Export `createQRCodeRenderer` |
| Rendering | `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` | Factory function — matrix → SVG with dots, finder patterns, logo, frame, label |
| Rendering | `backend/src/1_rendering/qrcode/qrcodeTheme.mjs` | Default theme — colors, sizes, spacing, font config |
| API | `backend/src/4_api/v1/routers/qrcode.mjs` | Express router — raw/content/command modes, metadata resolution |
| System | `backend/src/0_system/bootstrap.mjs` | Create renderer instance, wire to router |
| System | `backend/src/app.mjs` | Mount `/api/v1/qrcode` route |
| Dependency | `qrcode` (npm) | QR matrix generation via `QRCode.create()` |

---

## Dependencies

- **New:** `qrcode` npm package — lightweight, MIT licensed, ~50KB. Used only for `QRCode.create()` to get the raw module matrix. All SVG rendering is custom.
- **Existing:** `media/img/buttons/*.svg` — command icons, read at render time

---

## SVG Structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="340" height="420" viewBox="0 0 340 420">
  <!-- Background -->
  <rect width="340" height="420" rx="12" fill="#ffffff" stroke="#e0e0e0" stroke-width="2"/>

  <!-- QR code area (centered, with margin) -->
  <g transform="translate(20, 20)">
    <!-- Data modules as dots -->
    <circle cx="..." cy="..." r="3.5" fill="#000"/>
    <!-- ... more dots ... -->

    <!-- Finder patterns (rounded rects) -->
    <rect x="..." y="..." width="..." height="..." rx="4" fill="#000"/>
    <!-- ... finder pattern layers ... -->

    <!-- Center logo (clipped circle) -->
    <clipPath id="logo-clip">
      <circle cx="150" cy="150" r="30"/>
    </clipPath>
    <circle cx="150" cy="150" r="32" fill="#ffffff"/>
    <image href="data:image/png;base64,..." clip-path="url(#logo-clip)"
           x="120" y="120" width="60" height="60"/>
  </g>

  <!-- Label area -->
  <text x="170" y="355" text-anchor="middle" font-size="16" font-weight="bold">Happy, Happy, Joy, Joy, Joy</text>
  <text x="170" y="375" text-anchor="middle" font-size="12" fill="#666">Melanie Hoffman</text>

  <!-- Option badges -->
  <g transform="translate(250, 365)">
    <!-- shuffle icon inline SVG -->
  </g>
</svg>
```
