# Catalog PDF Generator — Design

## Endpoint

`GET /api/v1/catalog/:source/:id?screen=...&options=...`

Returns `application/pdf` — a printable grid of QR codes for every item in a Plex container.

## Flow

1. Call existing list service via HTTP: `GET /api/v1/list/:source/:id`
2. For each item, fetch QR SVG via HTTP: `GET /api/v1/qrcode?content={item.id}&screen={screen}&options={options}`
3. Convert each SVG to PNG via `sharp` (handles embedded base64 images)
4. Lay out on US Letter pages (8.5x11") via `pdf-lib`:
   - Page 1: title header (from list response `title`) + grid
   - Subsequent pages: grid only
   - Grid: 3 columns x 5 rows = 15 items per page
5. Return PDF with `Content-Type: application/pdf`

## Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `screen` | No | Screen prefix for QR encode string |
| `options` | No | Options passed through to QR endpoint (e.g., `shuffle`) |

## Files

| File | Purpose |
|------|---------|
| `backend/src/1_rendering/catalog/CatalogRenderer.mjs` | Takes title + PNG buffers, produces PDF bytes |
| `backend/src/4_api/v1/routers/catalog.mjs` | Route handler: orchestrates list fetch, QR fetch, SVG-to-PNG, render |
| `backend/src/4_api/v1/routers/api.mjs` | Add `/catalog` to route map |
| `backend/src/app.mjs` | Wire up catalog router in bootstrap |

## Dependencies

- `sharp` — add to main `package.json` (already in document-processor)
- `pdf-lib` — add to main `package.json`

## Layout

US Letter: 612 x 792 points. Title header ~50pt on first page. Grid cells sized to fit 3 wide x 5 tall with margins.
