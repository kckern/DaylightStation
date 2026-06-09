# Footer Zoom Navigation

The fitness player footer lets a viewer scrub a long video by zooming the seek
strip into progressively smaller time windows, then selecting a moment to jump
to. Zoom is navigation only — it never moves the playhead by itself.

## States

- **Root** — the full timeline is shown as ten evenly-spaced thumbnails.
- **Zoomed** — one of the ten segments has been opened into its own ten
  thumbnails. Zooming again drills further. The left controls expose ⏪/⏩ to pan
  the window within the current level; the X button becomes a Back button.

## Selecting a moment

Tapping a thumbnail seeks the playhead to that segment's start. Selecting does
not immediately collapse the zoom: a **grace window** keeps the current zoom
level open so the viewer can pick an adjacent segment without losing their
place. Each new interaction (another selection, a pan, or a deeper zoom) extends
the grace window. After the viewer goes idle for the grace window, the strip
returns to root on its own.

## Returning to root

The Back button (the X, while zoomed) returns to the full timeline immediately,
discarding the zoom history. This is the explicit way out; the grace window is
the implicit one.
