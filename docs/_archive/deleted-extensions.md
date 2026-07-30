# Deleted Extensions

Extensions removed from `_extensions/`. Recorded here for potential restoration,
mirroring the convention in [`deleted-branches.md`](./deleted-branches.md).

To restore: `git checkout <commit-hash> -- _extensions/<name>`

| Date | Extension | Last commit containing it | Description |
|------|-----------|---------------------------|-------------|
| 2026-07-29 | `kitchen-scanner` | `4b233c115` | Zebra **DS6878** over Classic Bluetooth SPP (Bluedroid, ESP-IDF 5.x, `m5-atom-idf5`). Existed only because one ESP32 cannot run BLE scale discovery while holding a Classic-BT link (HCI `0x08` supervision timeout). Retired when the DS6878 was replaced by a **DS2278 over BLE HID**, which shares the kitchen board with the scale as a second LE link — see `_extensions/kitchen-relay`. The DS6878 never worked here anyway: it opened the HID channel and tore it down ~16 ms later, every time, while pairing to macOS and typing barcodes fine. Its own source header said to delete the extension rather than re-merge it if the scanner was retired. The DS6878 pairing tools (`gen-pairing-barcode.py`, `pair-scanner.mjs`) went with it. `platformio.ini` also hardcoded absolute local toolchain paths, so it was not portable regardless. |

## Restoring `kitchen-scanner`

The scanner half is dead, but the board and the Bluedroid/Classic scaffolding are
the only worked example of Classic BT in this repo. If a future Classic-BT device
needs a host:

```bash
git checkout 4b233c115 -- _extensions/kitchen-scanner
```

Note the `scales.yml` entry it was flashed from is still present in the household
SSOT, commented out and labelled `RETIRED 2026-07-28`. Restoring the extension
means uncommenting that entry too.

Prior art worth reading before reopening Classic BT: the DS6878 write-up in
`docs/` and the `reference_ds6878_classic_hid` notes — the pairing bar codes are
SPP-only, the scanner is a HID *Slave* (the host pages it), and
`ESP_HIDH_OPEN_EVT` fires twice.
