# Feed Design System

The Feed app (Headlines, Scroll, Reader, Search, Detail, player surfaces) shares one
dark design system. All values live as CSS custom properties on `.feed-app`
(`frontend/src/Apps/FeedApp.scss`); surface stylesheets consume tokens and contain no
raw hex colors.

## Tokens

| Group | Tokens | Notes |
|-------|--------|-------|
| Surfaces | `--feed-canvas`, `--feed-surface-1..3` | Darkest (page) → lightest (elevated panels) |
| Borders | `--feed-border`, `--feed-border-strong` | 8% / 16% white |
| Text | `--feed-text-1..3` | Primary → muted |
| Accent | `--feed-accent`, `--feed-accent-strong`, `--feed-accent-bg` | One blue family; `-bg` is the selected-state tint |
| Semantic | `--feed-danger-*`, `--feed-warning-*` | Error banners, sync status |
| Geometry | `--feed-radius-sm/md/lg` (4/8/12px), `--feed-control` (36px) | Pill (999px) is reserved for chips |
| Type | `--feed-font-ui`, `--feed-font-condensed` | Condensed (Roboto Condensed) is the Headlines matrix voice |
| Reading | `--feed-reading-surface/ink/link` | Set per reading theme (dark/sepia/light) |

## Controls

Exactly two button treatments, provided as mixins in
`frontend/src/modules/Feed/feedMixins.scss`:

- **Chip** (`feed-chip` / `feed-chip-active`): bordered pill on `surface-2`; the active
  state is accent-tinted, never solid blue. Used for filters, view switchers, actions.
  Coarse pointers get 44px height.
- **Quiet** (`feed-quiet`): borderless, muted; hover reveals surface + full text color.
  Used for icon and inline actions.

## Surface rules

- **Headlines** is a wire terminal: the Outlets matrix (default view) renders
  single-line condensed headlines at a fixed 0.68rem under colored outlet mastheads
  with 4px gaps. Density is the identity — nothing may reserve horizontal space in a
  headline row. Save/archive/read quick-actions overlay the line-end on hover/focus
  only, behind an opaque fade; they are hidden on touch (state actions live in
  Briefing and Reader there). Briefing is the secondary view.
- **Reader** is a dark inbox. Unread rows carry an accent dot and bright title; read
  rows dim. No background tints on rows.
- **The article body is the only "paper" surface.** Reading themes (dark/sepia/light)
  restyle `.article-expanded` / `.detail-article` via the `--feed-reading-*` tokens;
  the shell around them always stays dark. Controls that sit on the reading surface
  use `currentColor` borders so they work on every theme.
- **Scroll** uses one gap per breakpoint (8px mobile, 12px desktop) and one card
  radius (flush at mobile, `--feed-radius-md` on the desktop masonry). Skeletons match
  real card geometry.

Adding a Feed surface: consume the tokens, pick one of the two control treatments,
and keep accent usage to selection/highlight states.
