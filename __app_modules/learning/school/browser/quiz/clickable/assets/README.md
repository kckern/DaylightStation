# Clickable assets

SVGs consumed by `ClickableAsset.jsx`. Each region path (or callout puck) carries
`data-region-id`; the component is asset-agnostic and globs everything in this folder.

## us-states.svg

- **Source:** https://commons.wikimedia.org/wiki/Special:FilePath/Blank_US_Map_(states_only).svg
  (Wikimedia Commons, "Blank US Map (states only)")
- **License:** Public domain
- **Prepared by:** `../prepare-us-states.mjs` — adds a `viewBox`, strips the embedded
  `<style>` block (decorative default fills only; `School.scss` drives real styling —
  also works around a jsdom bug where an SVG `<style>` set via `dangerouslySetInnerHTML`
  swallows every sibling that follows it), removes the raw asset's DC marker `<circle
  class="... dccircle dc">` (no `data-region-id` — dead click target, and unstyled
  once `<style>` is stripped it rendered as a stray black dot on DC, a region this
  states deck doesn't quiz), tags each state fill path (`class="xx"`, lowercase
  postal code) with `data-region-id="XX"`, and appends tappable callout pucks for the
  small Northeast states that are hard to tap directly on the map
  (NH, VT, MA, RI, CT, NJ, DE, MD).
