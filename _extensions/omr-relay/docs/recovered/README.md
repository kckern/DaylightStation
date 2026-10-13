# Recovered vendor documentation — Chatsworth Data OMR-1100

None of this is available on the live web. Chatsworth Data's OMR business is
defunct, its old domains redirect elsewhere, and search results are swamped by
the unrelated Chatsworth Products rack company.

These files were recovered from the **Wayback Machine CDX index of the vendor's
dead domain** (`omrsys.com`, also `chatsworthdata.com`). The technique
generalizes: for any dead hardware vendor, query the CDX API across the whole
domain and grep the result for `.pdf`, `.exe`, and `.zip` rather than trusting
search engines.

## Installed, not tracked

The PDFs are third-party documents, so they are not in the repo. `npm run install:assets`
downloads them from the Wayback Machine (URLs and sha256 pinned in `assets.manifest.yml`)
into `media/vendor/omr/`.

| File | Contents |
|---|---|
| `OMR1100Manual.pdf` | operator guide for this exact model — installation, checkout, serial parameters, conversion mode list |
| `OMR1100commandsB.pdf` | factory command set, EEPROM flag definitions, status byte |
| `omr1102_techmanual.pdf` | 48 pp, the richest source — download commands §6, extended commands §7, utilities §8, **Appendix A card specification**, Hollerith and binary tables, factory defaults |

## Transcribed

Everything operationally relevant now lives in the main docs, which are the
working reference:

- `__docs/reference/omr/README.md` — protocol, troubleshooting, sourcing
- `__docs/reference/omr/command-reference.md` — full command set
- `__docs/reference/omr/card-specification.md` — Appendix A card spec

The PDFs stay available as primary source (installed at `media/vendor/omr/`) so transcription errors can be caught.

## Recovered but not kept

Retrieved during the same sweep and deliberately excluded to keep the repo
light. All are re-recoverable from the Wayback Machine by the same method.

| Item | Why dropped |
|---|---|
| `acp100_techmanual.pdf`, `acp100ds.pdf` | sibling model; command family already covered |
| `omr1102ds.pdf` | marketing datasheet, image-heavy; specs transcribed |
| `chatsworth-stock-cards-catalog.pdf` | 2006 stock cards; part numbers transcribed into `card-specification.md` |
| `ScantronCompatibleForms.pdf` | catalog of forms that do **not** fit this reader; the relevant dimensions are transcribed |
| `stockform_order_fax.pdf` | order form for a defunct catalog |
| `OMRCFG.EXE`, `OMRDETCT.EXE`, `OMRDISPLAY.EXE` | 16-bit DOS binaries; every function is reachable over the documented serial protocol, and `tools/omr-query.py` and `tools/omr-decode.py` reproduce the useful two |
