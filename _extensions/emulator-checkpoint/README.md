# Protected emulator cores

These bundles add a paused, synchronous restore acknowledgment to the installed
EmulatorJS 4.2.3 integration. Stock `load_state(path, rv)` returns `rv` after
queueing a task, even when that task will fail. `restore-contract.patch` instead
calls the existing `content_deserialize_state` boundary and returns its actual
result with a monotonically identified request. Battery restoration checks the
native SRAM against the supplied bytes. Invalid files and incompatible state
containers are rejected. No gameplay frame runs during either operation.

Once enabled, the native guard rejects unmanaged state load/undo, SRAM refresh,
reset and rewind. An explicit application reset creates a revision and boots a
new instance. The browser verifies the actual ROM and core archive hashes before
boot, passes owned files to EJS, disables its asset databases and cancels its late
reset timer before restoring. A failed native restore cannot enable saving.

## Build

Build on a machine with Python 3, Git, Make and Emscripten **3.1.74** activated.
Use an empty scratch directory outside tracked application files:

```sh
python3 _extensions/emulator-checkpoint/build.py /tmp/emulator-native-build /tmp/emulator-protected-output
```

The script uses two compilation jobs. It clones and pins the source commits
declared in `build.py`, applies the exact checked-in patch, and produces both
normal and legacy bundles for Gambatte, mGBA and Genesis Plus GX. Each archive
includes original license files, core/build metadata and the source/patch pins.
The neighboring JSON manifest records its SHA-256. `cores.json` comes from
EmulatorJS/build `76e0858f2212ae`, bundle 2.0.2/minimum frontend 4.2.2. The source
pins follow each fork's first-parent history preceding the shipped June 2025
build. Exact provenance of the original shipped binary is unknown; compatibility
must be demonstrated with real original snapshots before rollout.

The source repositories are [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch),
[EmulatorJS/gambatte-libretro](https://github.com/EmulatorJS/gambatte-libretro),
[EmulatorJS/mgba](https://github.com/EmulatorJS/mgba) and
[EmulatorJS/Genesis-Plus-GX](https://github.com/EmulatorJS/Genesis-Plus-GX).
RetroArch modifications remain under its GPLv3-or-later license. Preserve the
source pins, patch and bundled licenses with any distributed binaries.

## Verify and install

Stage files without modifying the live engine. Run
`tests/live/flow/fitness/emulator-native-restore.runtime.test.mjs` with
`EMULATOR_NATIVE_ASSET_ROOT` pointing to the output directory and the normal
runtime test frontend URL configuration. The test reads configured ROMs and
engine assets, intercepts an isolated browser origin and never accesses player
save endpoints. All six variants must pass actual state/RAM and battery/SRAM
postconditions, request identity, missing/corrupt/incompatible payload rejection,
the legacy-load guard and unchanged frame count.

After those checks, copy the six `*.protected-v1.data` files and their JSON
manifests beside the original files in `emulation/_engine/cores/`. Preserve the
original files. The protected protocol hashes these new filenames; it never
overwrites the stock assets. Follow the instance's deployment gate and kiosk
reload procedure when deploying the application. Keep verified backups of the
emulation directory and kiosk origin storage before rollout.
