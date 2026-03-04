# Barcode Photo Status for UPC Lookups

**Date:** 2026-02-13
**Status:** Approved

## Problem

When a user scans a UPC barcode, the "looking up barcode..." status message is plain text. We want it to be a photo message showing a system-generated barcode image with an animated caption (`. / .. / ...`).

## Design

### Components

**1. BarcodeImageAdapter** (`backend/src/1_adapters/nutribot/BarcodeImageAdapter.mjs`)
- Wraps `bwip-js` (already installed, v4.7.0) to generate UPC barcode images as PNG buffers
- Method: `generate(upc)` → `Promise<Buffer>`
- Uses UPC-A for 12-digit codes, Code 128 as fallback

**2. `createPhotoStatusIndicator` on IResponseContext** (new method)
- Signature: `createPhotoStatusIndicator(imageSource, initialCaption, options)`
- Sends photo with caption immediately
- Animates caption via `editMessageCaption` using frames/interval
- Returns `{ messageId, finish(), cancel() }` handle (same shape as text status indicator)

**3. TelegramResponseContext implementation**
- Implements `createPhotoStatusIndicator` using `sendPhoto` + caption animation loop
- Animation updates use `{ caption: ... }` in `updateMessage`

**4. LogFoodFromUPC changes** (lines 82-92)
- If `barcodeGenerator` available: generate barcode PNG, use `createPhotoStatusIndicator`
- Falls back to existing text status indicator if no barcode generator
- Rest of flow unchanged: `status.cancel()` deletes barcode photo, then sends product photo

**5. NutribotContainer wiring**
- Create `BarcodeImageAdapter` instance
- Pass as `barcodeGenerator` to `LogFoodFromUPC`

### Data Flow

```
User scans UPC
  → LogFoodFromUPC.execute()
    → barcodeGenerator.generate(upc) → PNG Buffer
    → createPhotoStatusIndicator(buffer, caption, {frames})
      → sendPhoto(buffer, "🔍 Looking up barcode 012345.")
      → setInterval: editMessageCaption cycling . / .. / ...
    → upcGateway.lookup(upc)
    → status.cancel() — deletes barcode photo
    → sendPhoto(product.imageUrl, productCaption, {portionButtons})
```

### Lifecycle

After UPC lookup succeeds: barcode photo is deleted and replaced by a new product photo message with portion buttons (existing behavior preserved).
