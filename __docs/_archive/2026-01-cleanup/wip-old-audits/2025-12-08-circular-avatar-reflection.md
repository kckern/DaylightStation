# Reflection: Retiring `CircularUserAvatar` from the Race Chart

## Context
- The race chart originally embedded `CircularUserAvatar` inside an SVG via `foreignObject` to render avatars with zone rings.
- We needed consistent circular avatars, readable coin labels, and predictable scaling inside an SVG chart that resizes with its viewBox.

## Problems Encountered
- **Oval distortion:** `foreignObject` content did not respect the SVG viewBox scaling; aspect-ratio mismatches caused avatars to stretch horizontally when the chart resized.
- **CSS dependency inside SVG:** `CircularUserAvatar` relied on external CSS and layout assumptions (divs, pseudo-elements) that don’t map cleanly inside an SVG coordinate system.
- **Interaction/pointer noise:** The component’s structure introduced nested wrappers that complicated hit testing and layering in the chart overlay.
- **Theme coupling:** The component bundled gauge/indicator behaviors we didn’t need for the chart, making it harder to tune stroke widths, shadows, and spacing specific to the race layout.
- **Label collision:** Keeping labels aligned while juggling `foreignObject` sizing and overflow rules proved brittle; moving labels to the right exposed further misalignment.

## Resolution
- Replaced `foreignObject` + `CircularUserAvatar` with **pure SVG primitives**:
  - `clipPath` circle to guarantee a perfect circle for the image.
  - Backdrop, ring, and zone stroke drawn as SVG circles sized to the chart’s coordinate system.
  - Clipped `<image>` with `preserveAspectRatio="xMidYMid slice"` to keep faces centered.
  - Text labels rendered directly in SVG, anchored to the right with added right margin.
- Adjusted chart viewBox/CSS aspect ratio to stay in sync (420×390 with 14/13 CSS ratio) so the SVG remains proportional.

## Why Removal Was Necessary
- `CircularUserAvatar` is great for DOM contexts, but `foreignObject` inside SVG is inherently fragile across browsers and responsive scaling.
- Pure SVG keeps sizing, clipping, and strokes in the same coordinate space as the chart, eliminating cross-context layout bugs.
- The chart now controls all visual primitives (rings, shadows, labels) without inherited CSS side-effects, restoring predictable rendering.

## Lessons
- Avoid `foreignObject` for critical visuals in scalable SVGs; prefer native SVG shapes + clipPaths.
- Keep chart visuals self-contained in SVG to maintain consistent geometry and styling.
- Align viewBox and CSS `aspect-ratio` to prevent implicit stretching.

## Alternative: DOM Overlay Driven by SVG Geometry
If we wanted to keep `CircularUserAvatar` (DOM-based) while avoiding SVG `foreignObject`, we could render the avatars in a positioned DOM layer that sits on top of the SVG:
- **Compute positions in SVG space:** Reuse the existing `avatars` array (with `x`, `y`) from the chart layout.
- **Map to screen coordinates:** Use the SVG element’s `getBoundingClientRect()` plus the viewBox scale to convert each `(x, y)` into pixel coordinates relative to the page.
- **Absolutely position avatars:** Render a sibling/overlay `<div class="chart-avatar-layer">` above the SVG, and place each `CircularUserAvatar` with `style={{ left: xPx, top: yPx, transform: 'translate(-50%, -50%)' }}`.
- **Sync on resize/zoom:** Attach a resize observer on the chart container and recalc positions on window resize or data changes; throttle with `requestAnimationFrame`.
- **Pros:** Full fidelity of `CircularUserAvatar` (CSS, indicators, gauges) without `foreignObject` quirks.
- **Cons:** Two coordinate systems to keep in sync; potential overlap with other UI layers; needs careful pointer-event handling so overlays don’t block chart interactions.
