# Local TI-86 ROM

The calculator-owned ROM used for local SchoolCalc emulator acceptance is
stored here as `ti86.rom`. ROM binaries are intentionally gitignored.

Captured from the connected calculator on 2026-08-10:

- Size: 262,144 bytes
- TI-86 ROM version: 1.4
- CRC-32: `fe6e2986`
- SHA-1: `23e0fb9a1763d5b9a7b0e593f09c2ff30c760866`
- SHA-256: `151ade0dc15e1d79b65cd0cc74c74d9c16946ab2deb2fad5ef748b1346b7b1a0`

Do not commit or redistribute `ti86.rom`.

The host utility that captured it is built reproducibly with:

```sh
_extensions/ticalc-relay/tools/build-ti86-graph-link.sh
```

This writes `_extensions/ticalc-relay/bin/ti86-graph-link`; both its local
tilibs toolchain and the executable are intentionally gitignored.
