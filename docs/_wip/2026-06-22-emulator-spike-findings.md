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

## Options to enable memory-watch (the in-game-hooks "moonshot")

1. **Custom core build (proper fix).** Rebuild the EmulatorJS cores with `_retro_get_memory_data` + `_retro_get_memory_size` added to `EXPORTED_FUNCTIONS`. EmulatorJS has a Dockerized core build; the patch is small and additive, per-core. Once done, our `MemoryProbe` works unchanged against `Module.HEAPU8[ptr + offset]`. This is what browser RetroAchievements-style integrations do.
2. **Save-state parsing.** Periodically `saveState` to a buffer and parse WRAM out of the (core-specific) state blob. Fragile, format-coupled, expensive at 10 Hz. Not recommended.
3. **Separate GB engine for reads** (WasmBoy/binjgb expose memory). Breaks the unified multi-console EmulatorJS approach. Not recommended.

## Decision-gate outcome (per the design doc)

- The **playable baseline** — governed play (gate/credit), library browser, per-user saves, dot-matrix shader, JSX bezel — needs **none** of this and proceeds on stock EmulatorJS.
- The **memory-watch framework code is already built and unit-tested** (`memoryPredicates`, `addressMap`, `HookDispatcher`); only its live RAM *source* is blocked. It stays "framework present, source disabled" until a custom core (Option 1) lands.
