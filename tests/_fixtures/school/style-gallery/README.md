# School style gallery

Before/after renders of real School activities at Portal size, for styling work
on the Portal design system (`__docs/reference/school/portal-design-system.md`).

1. **Capture DOM** from the real components, mocked as their unit tests mock them:
   `npx vitest run --config tests/_fixtures/school/style-gallery/vitest.gallery.config.mjs`
   (writes `snapshots/*.html`, gitignored)
2. **Serve** the gallery (mounts each snapshot inside `SchoolSurfaceProvider` +
   `SchoolActivityFrame` with the real stylesheets):
   `./node_modules/.bin/vite --config tests/_fixtures/school/style-gallery/vite.config.mjs --host 127.0.0.1 --port 43188 --strictPort`
3. **Shoot** 1280x800 PNGs: `node tests/_fixtures/school/style-gallery/shoot.mjs <outDir>`

Shoot once before a change and once after, then look at the pairs. Add a state by
adding an `it(...)` to `capture.gallery.jsx` and a stylesheet import to `main.jsx`.
Piece/asset images do not load here; the gallery judges styling, not assets.
