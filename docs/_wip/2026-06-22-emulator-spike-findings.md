# EmulatorJS Spike Findings (2026-06-22)

Headless verification of the self-hosted EmulatorJS path for the Emulator Console.
Harness: `tests/_scratch/emulator-spike/` (in-process static server + Playwright headless Chromium, probing a real gambatte boot of Pokémon Red).

## Engine delivery — CONFIRMED working

- Self-hosted EmulatorJS works. Vendored the **minimal GB subset** (~1.7 MB) into `media/emulation/_engine/`: `loader.js`, `emulator.min.js`, `emulator.min.css`, `version.json`, `cores/gambatte-wasm.data`, `compression/{extract7z,extractzip}.js`. `EJS_pathtodata` points at the served `_engine/`.
- **gambatte is the default GB/GBC core** (`EJS_core='gb'`); it boots and runs headless (`EJS_ready` + `EJS_onGameStart` both fire; `Module` + `HEAPU8` present).
- `EJS_threads=false` (single-thread core) → no COOP/COEP cross-origin-isolation requirement. Good for a simple served page.
- **Gotcha:** `EJS_DEBUG_XX=true` forces loading unminified `src/*` — keep it OFF or the loader 404s on files we don't vendor.
- Non-fatal 404s (safe to ignore): `localization/en-US.json` (English is built-in), `cores/reports/gambatte.json` (telemetry), `cores/gambatte-legacy-wasm.data` (fallback core).

## RAM read for memory-watch hooks — NOT available on stock cores

The whole point of the memory-watch framework is reading console RAM (e.g. Pokémon Red battle flag `$D057`). **Stock EmulatorJS cores do not expose it:**

- `Module._retro_get_memory_data` / `_retro_get_memory_size`: **not exported.** `Module.cwrap('retro_get_memory_data', …)` → "getData is not a function" (symbol absent).
- `gameManager.functions` cwraps a fixed set (restart, loadState, screenshot, **setCheat**, simulateInput, getCoreOptions, save-files, fast-forward/rewind, …) — **no memory read.**
- Only memory-related Module exports are `_set_cheat` / `_reset_cheat` — the libretro cheat API, which **writes** memory (Game Genie/GameShark), it cannot read state.
- Save-file access (`getSaveFilePath`/`saveSaveFiles`) reaches **cartridge SRAM** (`0xA000–0xBFFF`), NOT **WRAM** (`0xC000–0xDFFF`) where `$D057` lives. So it can't read battle state.

Conclusion: switching cores (mgba) won't help — EmulatorJS builds every core with the same `EXPORTED_FUNCTIONS` template, which omits the memory getters.

## SOLUTION — build-free WRAM read via cheat-write + HEAPU8 scan (CONFIRMED)

No custom core build is needed. The full WASM linear memory is exposed as
`Module.HEAPU8`; the only missing piece is *where* WRAM sits in it. We discover
that at runtime:

1. **Calibrate once at boot:** write a unique multi-byte signature into a WRAM
   scratch region using the cheat API (`gameManager.functions.setCheat(i, 1, code)`),
   GB GameShark format `01 DD AAAA` where `DD`=data and `AAAA`=address **little-endian**,
   and the **code string MUST be UPPERCASE** (lowercase is silently rejected — this
   was the whole reason the first attempt wrote nothing).
2. **Run a few frames** (cheats re-apply every frame), then **scan `HEAPU8`** for the
   signature run. Require exactly ONE full-length match → that gives `wramBase`.
3. **`resetCheat()`** to remove the calibration writes.
4. **Read directly thereafter:** `HEAPU8[wramBase + (cpuAddr - 0xC000)]`. No cheats
   needed for reads; reads are non-invasive.

**Verified headless:** signature wrote a clean 24-byte run, located uniquely
(`fullRuns: 1`) at `wramBase = 0x821868`, and reading through it gave
`$D057 = 0` (no battle at the intro — correct) and `$D35E = 0` (map id). End-to-end.

### Production notes for `MemoryProbe`
- **Re-fetch `Module.HEAPU8` on every read** — WASM `memory.grow` swaps the view object
  (the byte *offset* of WRAM is stable; the typed-array wrapper is not).
- **Calibrate during boot/load** (before meaningful gameplay) and `resetCheat()` — the
  signature briefly corrupts the scratch region; harmless pre-game.
- Use a long/rare signature (≥24 bytes) and assert a single full match for a safe base.
- **GBC banked WRAM caveat:** `0xC000–0xCFFF` (bank 0) + flat-8KB DMG games (e.g. Pokémon
  Red, where `0xD000–0xDFFF` maps to offset `0x1000–0x1FFF`) are reliable. GBC games with
  *banked* `0xD000` WRAM need the active bank to disambiguate — a per-game nuance to
  document, not a blocker for the seed.
- Cache `wramBase` per session; re-calibrate on core reload.

This keeps everything on stock EmulatorJS and unblocks the memory-watch hooks WITHOUT a
custom core build — the custom-build detour is **not needed**.
