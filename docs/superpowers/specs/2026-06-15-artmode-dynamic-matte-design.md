# ArtMode Dynamic Matte — Design

**Date:** 2026-06-15
**Status:** Approved design (validated visually), ready for implementation plan

## Purpose

The ArtMode screensaver currently shows every painting on a fixed cream matte.
This feature derives the matte color from the painting itself — a muted color
that either harmonizes with the art (colorful paintings) or falls back to warm
neutrals (near-greyscale paintings) — including the beveled "cut" edge. The
result is always muted and tasteful; vibrant mattes are impossible by construction.

## Scope

In scope:
- Backend color analysis of the selected painting (average color → HSV).
- A pure `deriveMatte(avgRGB)` function that produces a muted matte palette
  (paper plane + beveled cut), guardrailed against vibrancy.
- API additions: `/api/v1/art/featured` returns `color` + `matte`.
- ArtMode applies the matte palette via CSS custom properties (fallback to the
  current static cream when absent).

Deferred (YAGNI; not in this work):
- Accent-color palettes / upper-lower lightness ranges. The matte needs only the
  average color and its value; richer dynamics can be added behind the same
  endpoint later.

## Decisions (locked, validated on real paintings)

- **Relationship:** **Match** for colorful paintings (matte = painting's own hue,
  muted); **warm-neutral browns** for near-greyscale paintings.
- **Mat brightness tracks the painting:** a dark canvas gets a darker mat, a
  light one a lighter mat (within the muted band).
- **Muting guardrail:** matte saturation ≤ 0.18; matte value ∈ [0.30, 0.52]
  (match branch) / [0.30, 0.60] (neutral branch). Nothing vibrant escapes.

## Color Analysis (backend)

Use `jimp` (already a dependency; pure JS, no native deps). For the selected
painting: read the image, downscale to ~40×40, average the pixels to one RGB
triple, convert to HSV. Cache the result **per folder** in the existing
in-memory eligibility index, so repeated picks / shuffles don't recompute.

Output: `{ average: "#rrggbb", hue: 0–360, saturation: 0–1, value: 0–1 }`.

## `deriveMatte(avgRGB)` — pure function (the core)

```
HSV(h,s,v) from avgRGB            // h in [0,1)
mapValue(v, lo, hi):              // tracks painting lightness into the band
    vc = clamp(v, 0.20, 0.85)
    return lo + (vc - 0.20)/(0.85 - 0.20) * (hi - lo)

if s < 0.10:                      // near-greyscale → warm neutral (browns/cream)
    H = 30/360                    // warm amber/brown hue
    S = 0.13
    V = mapValue(v, 0.30, 0.60)
    branch = "neutral"
else:                             // Match — painting's own hue, muted
    H = h
    S = min(s, 0.18)
    V = mapValue(v, 0.30, 0.52)
    branch = "match"

base = RGB(HSV(H, S, V))
```

**Palette derivation** (from `base`, adjusting HSL lightness by a factor):

| Token        | Factor | Role |
|--------------|--------|------|
| `glow`       | L×1.18 | radial highlight (paper center) |
| `base`       | L×1.00 | mat plane color |
| `edge`       | L×0.72 | radial outer / vignette |
| `bevelTop`   | L×0.80 | cut wall — top (shadow, lit from top-left) |
| `bevelLeft`  | L×0.88 | cut wall — left (shadow) |
| `bevelRight` | L×1.12 | cut wall — right (lit) |
| `bevelBottom`| L×1.20 | cut wall — bottom (lit) |

All factors clamp lightness to [0,1]. This preserves the recessed,
light-from-top-left look, now tinted to the mat.

Placement: a pure module (no I/O), e.g. `backend/src/2_domains/art/deriveMatte.mjs`,
unit-tested independently.

## API

`GET /api/v1/art/featured` response gains two fields (existing `image`/`meta`
unchanged):

```json
{
  "image": "/media/img/art/classic/.../Painting.jpg",
  "meta": { "...": "...", "width": 3000, "height": 2180 },
  "color": { "average": "#75879c", "hue": 212, "saturation": 0.25, "value": 0.61 },
  "matte": {
    "branch": "match",
    "base": "#58616b", "glow": "#6b7682", "edge": "#3f464d",
    "bevelTop": "#474e56", "bevelLeft": "#4e555d",
    "bevelRight": "#626c77", "bevelBottom": "#6b7682"
  }
}
```

## Frontend

`ArtMode` reads `art.matte` and sets CSS custom properties on the root
(`--matte-base`, `--matte-glow`, `--matte-edge`, `--cut-top`, `--cut-left`,
`--cut-right`, `--cut-bottom`). `ArtMode.css` uses these vars with the current
static creams as fallbacks (`var(--matte-base, #e7dcc1)`, etc.), so a missing
`matte` (or older cached response) degrades to today's look. The paper grain
(noise) and gradient structure stay; only the colors become dynamic.

## Data Flow

```
art/featured → adapter selects folder
  → (cached per folder) analyzeColor(image) via jimp → { average, hue, sat, value }
  → deriveMatte(avg) → { base, glow, edge, bevel* , branch }
  → respond { image, meta, color, matte }
ArtMode → set --matte-*/--cut-* CSS vars → CSS paints the tinted mat + bevel
```

## Testing

- **`deriveMatte` (pure, unit):**
  - near-greyscale input → `branch: "neutral"`, warm hue (~30°), `sat ≈ 0.13`.
  - saturated cool input (`[117,135,156]`) → `branch: "match"`, hue preserved,
    `sat ≤ 0.18`, `value ∈ [0.30, 0.52]`.
  - guardrail: for arbitrary vivid input, result never exceeds the sat ceiling /
    value band.
  - lightness tracking: a dark avg yields a lower base value than a light avg.
  - bevel ordering: `bevelBottom` lighter than `base` lighter than `bevelTop`.
- **Color analysis (adapter):** feed a generated solid-color image through `jimp`
  → predictable average → assert `color` and `matte` on the response.
- **ArtMode (component):** given a response with `matte`, the root element gets
  the `--matte-*`/`--cut-*` custom properties; without `matte`, none are set
  (CSS fallback applies).

## Open Items / Future

- Accent palette + lightness-range dynamics (deferred).
- Persisted per-painting matte cache across restarts (currently in-memory only).
