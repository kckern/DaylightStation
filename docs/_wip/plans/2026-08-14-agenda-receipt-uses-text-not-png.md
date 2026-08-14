# The agenda prints as ESC/POS text, not the designed PNG

**Date:** 2026-08-14
**Type:** Wiring change, with a stale-premise finding
**Status:** Diagnosed, not implemented

## Symptom

Scanning a personal card prints an agenda successfully on the thermal printer, but
it is the plain ESC/POS text layout with a firmware QR — not the designed receipt
produced by the print design system. Observed on Felix's card, 2026-08-14
(`09:28:31` and `09:36:39`).

Confirmed in the log: `thermalPrinter.job.start {"target":"10.0.0.50:9100","itemCount":11,"upsideDown":true}`.
Eleven ESC/POS items is the item-based text path; an image job would be one raster item.

**Nothing failed.** `school.card.agenda-printed` reports success both times. This is
the wired behaviour, not a fallback.

## Why it happens

`backend/src/5_composition/modules/schoolLifecycle.mjs` builds **two** receipt
renderers and prints through the text one:

| Line | What |
|---|---|
| `:215` | `receiptRenderer = createDocumentEscPosRenderer({ symbology: 'QR' })` — text + firmware QR |
| `:412` | `const receipts = new ReceiptPrinting({ renderer: receiptRenderer, printer: receiptPrinter, logger })` — **the agenda prints through this** |
| `:490` | `receiptPngRenderer = createDocumentReceiptRenderer({ scanCodes: 'qr' })` — the designed renderer |
| `:750` | `renderers: { …, receiptPng: receiptPngRenderer }` — exposed for a preview route, never printed through |

`ResolvePersonalCard.execute` calls `this.#receipts.print(agenda.document)`
(`backend/src/3_applications/school/usecases/ResolvePersonalCard.mjs:54`), so it gets
whatever renderer `ReceiptPrinting` was constructed with — the ESC/POS one.

**Construction order makes this structural, not a toggle.** `receipts` is built at
`:412`; `receiptPngRenderer` does not exist until `:485`. The PNG renderer cannot be
passed to `ReceiptPrinting` without moving its construction earlier.

## The stale premise

The choice is documented at `schoolLifecycle.mjs:199-210`:

> ESC/POS text + barcode items, NOT the canvas renderer's PNG.
> The canvas draws an empty square where the code belongs — it renders no barcode at
> all — so an image job handed a child a receipt with nothing scannable on it, and
> left the printer's text transcript (the operator's record of what a child was told)
> empty. […] `DocumentReceiptRenderer` stays the probe that proves a document CAN be
> drawn on 58mm tape.

**The barcode half of that is no longer true.**
`backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs` imports the
`qrcode` package (`:30`) and rasterizes real QR modules (`:738-748`) when
`scanCodes === 'qr'`. The "empty square" is the **default `scanCodes: 'box'`** mode,
and the comment dates from when the symbology was Code128. Line `:490` already
constructs the renderer with `scanCodes: 'qr'`, so it would draw a scannable code today.

**The transcript half still stands.** The ESC/POS path emits a text transcript — the
operator's record of what a child was told. A pure image job leaves that empty.

## Work

1. Move `receiptPngRenderer`'s construction (`:485-493`) above the `receipts`
   construction at `:412`.
2. Pass it to `ReceiptPrinting` as the render path for agenda/notice documents.
3. **Preserve the operator transcript.** Either have `ReceiptPrinting` emit a short
   text summary alongside the raster, or have the PNG path return transcript text as
   well as bytes. Do not drop it silently — it is the only remaining valid objection
   in the original comment.
4. **Update the comment at `:199-210`.** It currently justifies the decision with a
   premise that is false. Whatever the outcome, that comment must stop asserting the
   canvas renders no barcode.
5. Keep the ESC/POS renderer reachable as a fallback: if the raster path throws, a
   text receipt beats no receipt. `ReceiptPrinting` already reports unprinted rather
   than lying — preserve that.

## Verification

- Scan a personal card; the tape shows the designed layout with a scannable QR.
- Scan the QR with a phone — it must resolve, not just look like a code.
- The operator transcript is still populated.
- With the raster renderer forced to throw, a text receipt still prints.

## Cost note

The two observed ESC/POS jobs took **1086ms** and **1054ms** end to end. A raster job
will be slower — measure it. On 58mm tape a child is standing at the printer waiting,
so if the raster path pushes this materially past ~2s, that is worth knowing before
committing to it.

## Unrelated, found while investigating

`school.agenda.plan-errors` fires on every one of Felix's prints:

```
math-fractions: assigned but no published units belong to it
language-daily:  assigned but not in the published catalog
```

His agenda is being built from a partly-broken plan regardless of how it is rendered.
Worth its own task.
