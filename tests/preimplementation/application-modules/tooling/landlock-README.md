# Linux module baselines

From the worktree root, with existing installed dependency scopes:

```sh
PRE_TOOLCHAIN_ROOT=/path/to/installed/checkout node tests/preimplementation/application-modules/tooling/run-landlock.mjs gratitude
PRE_TOOLCHAIN_ROOT=/path/to/installed/checkout node tests/preimplementation/application-modules/tooling/run-landlock.mjs browser
PRE_TOOLCHAIN_ROOT=/path/to/installed/checkout node tests/preimplementation/application-modules/tooling/run-landlock.mjs stored-shape
```

Requires Linux x86_64, Landlock ABI >=6, seccomp, GCC, and Node with installed
root/backend/frontend dependencies. No install, daemon, container, privilege or
source migration is performed. Only fixed `gratitude`, `browser` and `stored-shape` baselines are accepted; candidate
mode fails closed. This is the Linux alternative to historical `sandbox-exec`
wrappers and supersedes container provisioning for these fixed baselines.

The adapter compiles the small C launcher into a fresh task directory. Landlock
allows writes only there and grants read access per tracked backend/src/shared code file for Gratitude, or frontend/src/shared
source and CSS/SVG asset file for browser, inspected driver/case file, explicit package manifests and canonical
installed node_modules directories. Runtime index/app/bootstrap are excluded by
both the source allowlist and existing loader. It does not grant repository-root,
.env, private-media, /etc or /proc content access. An empty scratch OpenSSL config
avoids host configuration. The dependency bridge uses the existing loader and
installed versions; it is not a future package-resolution proof.

Browser JSX uses installed esbuild with automatic JSX/ESM/ES2022 output; it
does not require an unavailable TypeScript install or launch a native browser.

Each run checks scratch read/write, outside read/write/truncate, source
write/truncate, host read, symlink escape, socket and cross-process/privileged syscall denials before importing the selected existing case. Gratitude proves fork/spawn denial.
Browser proves a spawned child inherits outside read/write and socket denials. Loader worker threads remain permitted. The test fixture creates its
0600 file before data writes instead of using chmod; its original mode/inode
assertions remain intact. No product source behavior is modified.

The filter permits a narrow syscall list and clone3 ENOSYS fallback. Gratitude
permits only thread clone flags and denies process creation/signals/ioctl.
Browser and stored-shape additionally permit confined child creation/wait, scoped signals,
FIONBIO for child pipe streams, and AF_UNIX socketpair (required by Node spawn).
It never permits socket creation or connect/bind/listen; sockets cannot reach
outside the inherited scope. FD/memory access, namespaces, mount, BPF, keys and
io_uring remain denied. Landlock
also restricts signals and abstract UNIX socket scope. Stdin is /dev/null;
stdout/stderr are task-owned files, all other inherited FDs close, and the child
gets a minimal fixed environment without DAYLIGHT variables.

Limits: Gratitude 2 GiB address space/64 MiB Node old-space; browser/stored-shape 4 GiB/256 MiB
(required to load their tools without allocation failure). Both: 20 CPU seconds, 45-second
alarm, 50-second outer watchdog, 4 MiB per file, 128 descriptors, no core dumps.
Landlock protects handled content access and filesystem effects; it does not
hide filesystem metadata. There is no PID namespace or dedicated aggregate
disk/thread quota. Exact installed Node/runtime files and dependency directories
remain host dependencies. This trusted-repository baseline is not an audit of
arbitrary hostile native code. See the [kernel Landlock documentation](https://docs.kernel.org/userspace-api/landlock.html).

Fresh `read-allowlist.tsv`, TAP output and `receipt.json` live under
`.superpowers/sdd/2026-10-08-gratitude-module-proof/landlock-runs/`. Receipts include
exact commands, source/input hashes before execution, an unchanged-input check,
named case outcomes, controls and limitations. Failed attempts remain recorded.
No deleted baseline/test-population packet is reconstructed. The baseline does
not exercise real printers, deployed configuration, provider credentials or
household-controller startup, and makes no candidate parity claim.

The selected stored-shape pack executes the six original Vitest assertions with
its existing dedicated config. Discovery grants READ_DIR alone along that test's
ancestor directories; it grants no additional file-content access. Rollup's
verified librt.so.1 dependency is allowed as one read-only file. Numeric loopback
in the test config avoids DNS; socket creation remains denied. Disabling Node's
Wasm trap handler permits bounded-memory WebAssembly without raising the limit.
Selected config modes no longer read the deleted discovery population packet.

Current authoritative baselines: Gratitude 59, browser 25, stored-shape 6 passing
assertions. Browser characterization now matches the current source: Piano
preserves msg.t as a fourth callback argument (usePianoBridgeNotes.js:118/120),
Portal volume suppresses key-up (usePortalKeys.js:97-108), and FamilySelector
records its structured warning (FamilySelector.jsx:455). Error DOM, no-retry,
callback payload, volume/rerender and warning payload assertions remain covered.
These fresh receipts do not claim parity with obsolete characterization oracles.

The candidate drivers consume the owner entries and require a prior green selected
baseline receipt with exact named parity. Ordinary Node ESM also imports the server
public entry without the characterization loader and proves backend UUID ESM and
moment identity; the historical loader's require-resolution receipt is separate.

`PRE_TOOLCHAIN_ROOT=/opt/Code/DaylightStation node tests/preimplementation/application-modules/tooling/run-landlock-build.mjs`
runs the real production Vite build against a tracked, secret-free read-only snapshot.
No original `.env` is granted. Generated assets/cache remain scratch-only. It uses
16 GiB virtual address space, a 4096 MiB Node heap,180 CPU seconds,190-second watchdog,
64 MiB per-file and256 descriptors. Rollup parallel file operations are bounded at64.
Public assets are staged using read/write: a tiny confined copy trace proved libuv's
copyFile requires `utimensat`, which remains denied because Landlock does not mediate
source timestamp changes. Vite uses `copyPublicDir:false,emptyOutDir:false`; every
copied public asset has byte parity except filenames actually overwritten by Rollup
output (notably generated index.html). The receipt proves owner chunks and icons.

The fixed `integration` pack runs ten selected original suites (61 assertions).
Its DOM-only tests stub SCSS loading; the actual production build separately compiles
all moved styles. It permits exact libuuid/libresolv/runtime files and the bundled
Gratitude font for the real native rendering assertion. A scratch-only fontconfig
avoids host font/config reads. Inherited fork IPC uses AF_UNIX socketpairs and
sendmsg/recvmsg; socket creation/connect/listen remain denied. Infrastructure's
TCP supertest suite is not run: its relevant custom-item contract is covered by
CASE-GR-HTTP-14, including response/publication and exactly-once payload behavior.

`run-landlock-hook.mjs` accepts no command arguments and launches the unchanged
`.githooks/pre-commit` under the inherited child profile. It uses the actual index,
HEAD, refs and object storage read-only; exact repository config was authorized
and checked for credential/include/header fields without printing values. Global
config, private working-tree files and credentials remain excluded. `/dev/null`
read/write is the only additional device grant Git requires. Source contents remain
read-only; scratch holds npm/Vite caches. Hook limits are16 GiB virtual address
space,180 CPU seconds per process,1800-second alarm,1810-second outer watchdog,
64 MiB per-file and256 descriptors. C socket/outside-read/host-read/symlink/source-
write/truncate controls are mandatory, and protected source/index hashes must match.
The temporary core.hooksPath wrapper executes this adapter; parent Git writes its
normal index/commit outside confinement. Failure blocks the commit. No hook command
is replaced or skipped. The first190-second feasibility run passed FS/layer/UI/CSS/
ESM gates, then expired while the real parser was working; it is not a green hook
receipt. Final certification requires the controller's staged commit hook execution.

Original-hook composition startup also requires inheriting
`NODE_OPTIONS=--disable-wasm-trap-handler` through npm/Vitest children (the initial
Node CLI flag alone does not reach the shell-launched commands). Numeric loopback
in root Vitest config avoids denied localhost DNS. Canvas needs the same exact
read-only libuuid/libresolv files used by selected rendering tests. The scratch
composition-only diagnostic proves the inherited flag and all15 original registry
assertions with the same confinement; it does not replace the final full hook.

Piano/playback contributor baseline (M2):

```sh
PRE_TOOLCHAIN_ROOT=/opt/Code/DaylightStation node tests/preimplementation/application-modules/tooling/run-landlock.mjs m2
```

The fixed15-suite inventory is `configs/m2-selected.mjs`: widget registration and
panel rendering, the session bridge/control path, actual Player session-port
integration, Piano lecture policy/resume/remount, backend course queries, and
playback session/report lifecycle. It passes145 original named assertions plus a published Piano keyboard/host
embedding check using
synthetic roster/course/media/session boundaries, requiring no household, MIDI
hardware, speakers, credentials or running backend. It reuses the repository's
synthetic frontend environment (including inert same-origin WebSocket/fetch),
frontend dependency identity and existing shared aliases. Tracked shader files
are explicit read-only inputs. DOM styles are stubbed as in the existing selected
integration lane; this is behavioral contributor evidence, not a browser/device
or production-build claim. Kernel denial controls and protected-input hashes are
mandatory. The original pre-move baseline is m2-MH0NZP. Candidate mode requires a prior
green145-case receipt through PRE_BASELINE_EVIDENCE, compares the exact named
original assertions, and separately requires the embedding assertion. Default
contributor mode runs146 assertions without historical receipts. Failed harness-wiring attempts remain recorded;
no product fixtures or assertion expectations were changed.
