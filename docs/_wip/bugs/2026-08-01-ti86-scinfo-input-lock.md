# TI-86 SCINFO input lock and RAM loss

**Date:** 2026-08-01  
**Status:** software cause corrected; emulator and replacement-hardware proof pending

## Impact

The physical TI-86 successfully executed `SCINFO` and displayed the SchoolCalc
Sync screen, proving that the generated program container, TI-OS String
creation path, and framebuffer copy reached real hardware. The program could
not be exited from the keypad. Removing one AAA battery stopped execution, but
the calculator's old lithium backup cell did not retain RAM. The TI-86 reset to
defaults and all unbacked RAM variables were lost.

The calculator ROM was not modified and the calculator was not bricked. The
TI-86 has no user-writable Flash archive; SchoolCalc programs and data are
ordinary RAM variables. The loss was nevertheless material and avoidable.

## Direct cause

The probe called the nonblocking raw scanner `_get_key` (`_GetCSC`) at `$4068`
but compared its accumulator result to translated `_getkey` values:

| Physical key | Raw `_get_key` scan code | Incorrect translated value used |
| --- | ---: | ---: |
| ENTER | `$09` | `$06` |
| EXIT | `$37` | `$07` |

Consequently, neither physical key could satisfy the loop's exit condition.
The same mismatch existed in the initial production-shell and runtime-renderer
probe sources. Arrow and F-key behavior would also have been incorrect.

The corrected contract is centralized in
`_extensions/ti86-app/src/ti86asm.inc` and
`_extensions/ti86-app/src/input.asm`. Raw codes are named `SC_SCAN_*` so they
cannot be mistaken for translated `k*` codes. Interactive programs use the
shared boundary instead of calling `_get_key` directly.

## Contributing causes

1. Z80 code was assembled but not executed in an emulator before transfer.
2. Container, codec, memory-bound, and source-level tests were described too
   broadly; they did not prove keypad behavior or safe program return.
3. No complete calculator backup was captured before novel assembly ran.
4. The lithium backup cell's age was not established. TI specifies replacement
   about every three or four years; this cell was reportedly about ten years
   old.
5. The probe had no independent ON/CLEAR emergency return path.

## Corrective implementation

- Raw codes now match the published TI-86 `_GetCSC` table.
- `input.asm` checks the TI-OS ON-interrupt flag independently of the scan-call
  result.
- ON and CLEAR jump through `_JforceCmdNoChar` (`$409C`), which returns to a
  clean command context without relying on the assembly caller's stack.
- EXIT remains a view event so nested views can implement Back; at Home it
  takes the same forced OS-return path.
- The idle path calls TI-OS `_idle` instead of spinning at full speed.
- All interactive assembly artifacts include the shared input boundary.
- The generated `SCINFO` probe contains equivalent ON/CLEAR/EXIT/ENTER handling.
- Automated tests compare the JavaScript emitter and assembly equates and
  inspect the packaged program for the emergency-return sequence.
- The native Graph Link utility now supports full backup, restore, and legal
  ROM-dump operations.

## Mandatory remaining proof

No corrected SchoolCalc assembly may be executed on a physical calculator
until all of the following are true:

1. Four healthy AAA batteries and a healthy `CR1616` or `CR1620` backup cell
   are installed.
2. A complete `.86b` backup has been received and its file/container validated.
3. This calculator's ROM has been dumped and loaded into a TI-86 emulator.
4. The exact binary passes automated ENTER, EXIT, CLEAR, and ON exit tests in
   the emulator.
5. The physical smoke test starts with a minimal exit-only probe, not the
   production shell.
6. A timed recovery plan and untouched backup are available before execution.

## Evidence

- Physical `SCINFO` Sync frame displayed on the connected TI-86.
- Physical EXIT/ENTER/ON attempts did not leave the old build.
- AAA removal recovered TI-OS and produced a memory-clear/defaults message.
- Published TI-86 includes identify `_get_key=$4068`, `_getkey=$55AA`, raw
  `K_ENTER=$09`, raw `K_EXIT=$37`, and `_JforceCmdNoChar=$409C`.
- Corrected extension suite: 12 test files / 27 tests passing on 2026-08-01.

