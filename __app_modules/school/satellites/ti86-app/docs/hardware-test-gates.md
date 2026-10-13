# SchoolCalc TI-86 hardware test gates

These gates apply to every new Z80 binary, including diagnostic probes. A
successful assembly or transfer is not evidence that the binary is safe to
execute.

## Calculator preflight

- Install healthy AAA batteries.
- Replace the lithium backup cell every three or four years. The TI-86 accepts
  `CR1616` or `CR1620`; replace it only while four fresh AAAs remain installed.
- Start at the ordinary Home screen and prove `2nd` + `OFF`, contrast control,
  ENTER, EXIT, CLEAR, and ON work before a test.
- Create a timestamped full `.86b` backup before the first run of each build.
- Keep that backup immutable until the entire test session has passed.
- List calculator variables after backup and record free RAM and ROM version.

## Software gates

1. Build from checked-in source with no locally patched/generated dependency.
2. Validate the `.86p` signature, lengths, checksum, executable origin, video
   RAM boundary, and declared memory budget.
3. Run all host codec, storage, queue, UI-asset, and build tests.
4. Execute the exact `.86p` in the supported TI-86 emulator using a ROM dumped
   from a calculator in the fleet.
5. Exercise every terminating key and all navigation keys in the emulator.
6. Prove ON emergency return; prove one physical UP or DOWN press moves exactly
   one list item and never stalls the foreground input loop; prove EXIT and
   CLEAR each move one in-app level without leaving Home; prove `2nd` +
   UP/DOWN changes LCD contrast without moving the selected item; prove only
   `2nd` + EXIT returns to TI-OS.
7. Inspect post-run variables and framebuffer; do not infer success only from
   the absence of an emulator crash.
8. Record the binary digest so the physically transferred bytes are the tested
   bytes.

## Physical test ladder

Each rung must pass before moving to the next:

1. Exit-only input canary with no variable writes.
2. Framebuffer/type/icon renderer probe.
3. Temporary String create/read/delete probe.
4. Read-only packaged-content parser probe.
5. Crash-safe local-state probe using disposable variables.
6. Queue transaction probe using disposable variables.
7. Exact independently transferred client: `SCHLCALC` caller → `_exec_assembly` → `SCLEARN`
   child → caller, including missing/corrupt child and retained SCL1 state.
8. `SCHLCALC` → `SCQR` → shell with a disposable maximum result in DSQ;
   scan the dynamic QR, then prove DSQ is byte-identical after return.
9. `SCLEARN` → read-only `SCNATIVE` → caller with valid and corrupt disposable
   tool plans; prove every TI variable and native setting is byte-identical.
10. Production shell with a disposable content pack and assessment queue.
11. Relay-attached sync and induced disconnects.

Repeat rungs 7–9 on every ROM revision represented in the calculator fleet. Record
the ROM version, client-release SHA-256 values, normal EXIT/CLEAR/LEFT return,
`2nd` + EXIT quit, ON behavior, APD/wake, child absence, and a deliberately invalid SCX1
header. A returned screen alone is insufficient: receive SCL1 afterward and
verify the saved continuation was not altered.

At each rung, test ENTER, EXIT, CLEAR, ON, `2nd` + `OFF`, APD/wake, and link
behavior. Receive and compare any test variables before deleting them.

## Stop conditions

Stop immediately and do not transfer another binary if:

- a key behaves differently from the emulator;
- the calculator cannot return to Home through two independent paths;
- contrast, APD, or OFF no longer works;
- the link becomes unresponsive while the program should be idle;
- any variable differs from the expected transaction set;
- a checksum, generation, or backup validation fails.

Recovery must start with the least destructive route: forced OS return, ON,
then a main-battery interruption only if a verified live backup cell is
installed. Removing batteries is never the first-line recovery method.
