# School Agenda Preview — dry-run PNG with real QR

**Date:** 2026-07-30
**Status:** Draft for review
**Builds on:** [`2026-07-29-school-agenda-v2-design.md`](2026-07-29-school-agenda-v2-design.md)

## 1. What this is

`GET /api/v1/school/lifecycle/learners/:learnerId/agenda/preview` returns an
`image/png` of exactly the paper a card tap would print — sections, labels,
grade lines, and **real QR modules** — without printing anything and without
mutating any state. It is the household's established preview pattern
(gratitude `GET /card`, fitness `GET /receipt/:sessionId`): preview is a
side-effect-free GET; printing stays the card tap's job (there is no `/print`
sibling — the tap IS the print path).

## 2. Decisions (agreed with the household)

1. **Dry run.** Same `BuildAgenda` computation, zero writes. A GET must be
   safe to hit on every refresh.
2. **Real QR from day one.** The preview draws actual QR modules, not a
   placeholder box — pixel-faithful to the tape.
3. **Route lives in the lifecycle router**, beside the JSON `/agenda` route.
   NOT under `/school/print/*` (that namespace is the laser quota/approval
   system and must not leak semantics).

## 3. Dry-run mechanics

Composition (`schoolLifecycle.mjs`) constructs a SECOND `BuildAgenda`
instance, `previewAgenda`, sharing every real read-side dependency
(curriculum, assignments, launchers, timezone, clock, rng, newSessionId,
logger) with two injected write-side stand-ins:

- **Sessions:** a wrapper over the real repository — `listForLearner` and
  `readEvents` pass through; `appendEvent` is an async no-op.
  `ensureSession` still reduces the would-be `created` event locally, so
  labels and states come out byte-identical to a real tap; nothing persists.
- **Tokens:** `{ put: async () => {} }`. Tokens still mint through the real
  rng, so the drawn QRs are structurally real — but unregistered: scanning
  one off a screen resolves to the existing friendly "unknown ticket" slip.

No `BuildAgenda` code changes. The dry run is pure composition.

## 4. Rendering — real QR in the receipt PNG

`DocumentReceiptRenderer` (the tape's PNG twin, currently test-only) gains a
constructor option `scanCodes: 'box' | 'qr'`, default `'box'` (existing
behavior — golden tests untouched):

- `'qr'`: the action block's code area draws real QR modules —
  `QRCode.create(code, { errorCorrectionLevel: 'M' })` (the repo's existing
  `qrcode` dependency, same encoder the QR sheet renderer uses) → fill dark
  modules as rects scaled into `theme.action.codeAreaPx` with a quiet zone.
  Synchronous, no rasterizer round-trip. The readable token text stays
  printed beneath the symbol, exactly as on the tape path.
- The composition constructs the preview renderer with `scanCodes: 'qr'`.

Output: the renderer's existing `{ canvas }` → `canvas.toBuffer('image/png')`
(the gratitude/fitness pattern), served with
`Content-Type: image/png` and `Content-Disposition: inline;
filename="agenda-<learnerId>.png"`.

## 5. Route behavior

- `GET /learners/:learnerId/agenda/preview[?name=<display name>]` — 200 PNG.
- Unknown/blank learner: still 200 PNG — the "Whose card is this?" notice
  renders as an image, same as the paper path (a preview that 404s where the
  printer prints a slip would misrepresent the system).
- Lifecycle wired but PNG renderer unavailable: 501
  `{ error: 'agenda preview not configured' }` (gratitude's posture).
- Mounted only when the lifecycle is wired, like every sibling route.

## 6. Testing

1. **Renderer unit** (`tests/isolated/rendering/school/`): `'qr'` mode draws
   dark pixels inside the code area for a `scan_action` (sample the canvas;
   `'box'` mode's area stays empty except the border) — and the default stays
   `'box'` so existing goldens prove themselves unchanged.
2. **Dry-run proof** (`tests/isolated/application/school/` or e2e harness):
   render a preview for a learner with an assignment → assert the PNG magic
   bytes AND that afterwards the session store has no new sessions and the
   token registry has no new records; then a real tap still behaves normally.
3. **Route test**: 200 + `image/png` for a known learner; notice-PNG for an
   unknown one; 501 when renderer absent.

## 7. Out of scope

- Any `/print` sibling (the tap prints).
- Serving previews anywhere but this endpoint (no frontend surface yet).
- QR-in-box on the LASER worksheet path (different renderer family).
