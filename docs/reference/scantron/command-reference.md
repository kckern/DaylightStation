# Chatsworth OMR-1100 — command reference

Transcribed from vendor documentation recovered via the Wayback Machine:
*OMR1100 Commands Rev. B* (Chatsworth Data, "For Factory Use Only") and
*Technical Manual for OMR 1102* §6–8. Both PDFs are retained alongside this file
in `_extensions/scantron-relay/docs/recovered/` as primary source.

Verified against the live unit 2026-07-21 (firmware `OMR-1100 - Version 1.04,
Wed Oct 2 1996`) for the queries and the binary mode; the rest is transcription
and is **not** independently confirmed on hardware.

---

## Framing

Three command families share the line, and they are **not** framed identically.
`0x12` is Ctrl-R, `0x1B` is ESC.

| Family | Bytes | Purpose |
|---|---|---|
| Download | `0x12` `<cmd>` `0x12` `E` | conversion modes, tables, row enable |
| Factory / extended | `0x12` `ESC` `<cmd>` `0x12` `E` | configuration, queries, transport |

Multiple download commands may be concatenated in one transmission; the whole
string is terminated by the End-of-Transmission command `E`.

**Responses.** `G` + CR means accepted. If a command is not executable the
reader echoes the download string up to and including the offending character,
followed by `?` + CR.

**Timing.** Host-to-reader commands must only be sent while the reader is idle —
no form being scanned, transport stopped. The reader will not accept commands
while its processor is busy.

---

## Download commands — conversion modes

These set how marks become bytes. **Stored in volatile memory: they are lost at
power-off and must be re-sent.** This is the single most important operational
fact about the device — with no mode loaded, scanning produces no output at all.

| Cmd | Syntax | Meaning |
|---|---|---|
| `E` | `E` | End of transmission. Alone, clears all conversion modes (H, I, S, T). Does **not** clear loaded tables or masks (L, R, X). |
| `H` | `H##` | Hollerith-to-ASCII, one character per column |
| `I` | `I##` | Binary-to-ASCII, two bytes per column |
| `S` | `S##` | Split translate mode |
| `T` | `T##` | Translate mode |
| `L` | `L########` | Load split-translate table (8 chars) |
| `X` | `X##############` | Load translate table (14 chars) |
| `R` | `R####` | Row enable / channel select |

`##` is the number of columns to translate, `01`–`99`; `00` means all remaining
columns up to 126.

### `I##` — Binary to ASCII (what this project uses)

Returns **two bytes per column**, record terminated by CR. Bit 5 (`0x20`) is
forced high in both bytes so no byte falls below 32 and no control characters
are transmitted; a blank column reads `0x20 0x20`. Values range 32 (blank) to
127 (all twelve channels marked).

| | `0x01` | `0x02` | `0x04` | `0x08` | `0x10` | `0x20` | `0x40` |
|---|---|---|---|---|---|---|---|
| **byte 1** | row 12 | row 11 | row 0 | row 1 | row 2 | always on | row 3 |
| **byte 2** | row 4 | row 5 | row 6 | row 7 | row 8 | always on | row 9 |

The manual describes byte 1 as the right side of the card and byte 2 as the
left; in physical terms rows run 12, 11, 0, 1…9 from the far edge toward the
strobe edge, so **row 9 is the channel nearest the timing track**.

Example (BASIC, as printed): `DwnLd$ = Chr$(18) + "I00" + Chr$(18) + "E"`

### `H##` — Hollerith to ASCII

One ASCII character per column, per the punched-card convention: twelve
channels, top three are zone channels (`12` = `&`, `11` = `-`, `0` = `0`) and
the lower nine are field channels `1`–`9`. A mark combination with no Hollerith
equivalent returns `?`. Full 128-entry table is in the retained technical
manual, Appendix C; the useful subset:

```
0-9   → rows 0-9 singly            A-I → 1-9 with zone 12
J-R   → 1-9 with zone 11           S-Z → 2-9 with zone 0
space → no mark                    &   → 12        -  → 11
```

### `T##` + `X…` — Translate

`T` selects the mode; `X` loads a 14-character table. Argument order: first
character = no-mark indicator, next twelve = channels 12, 11, 0, 1…9 in that
order, fourteenth = multiple-mark indicator. ASCII 32–127 permitted.

Example — first nine columns as a numeric ID, `*` for blank, `#` for double
mark, `x` for unused channels:

```
Chr$(18) + "T09" + Chr$(18) + "X*9876543210xx#" + Chr$(18) + "E"
```

### `S##` + `L…` — Split translate

Splits the card lengthwise into two halves of up to six responses each. `L`
loads an 8-character table: first = no-mark, next six = channel pairs
(`12&4`, `11&5`, `0&6`, `1&7`, `2&8`, `3&9`), eighth = double mark. ASCII 33–127.

```
Chr$(18) + "S25" + Chr$(18) + "L*EDCBAx##" + Chr$(18) + "E"
```

### `R####` — Row enable

Disables channels so stray marks, doodles, or pre-printed question numbers are
not translated. Four octal digits, each covering three channels:

| Argument | Channels |
|---|---|
| 1st | 9, 8, 7 |
| 2nd | 6, 5, 4 |
| 3rd | 3, 2, 1 |
| 4th | 0, 11, 12 |

Within each group the three channels carry octal weights 4, 2, 1 read left to
right; sum the enabled ones. `R3257` enables channels 12, 11, 0, 1, 3, 5, 7, 8.

### Combining modes

Each mode may be used once per card definition, and most real forms need
several — for example a translate-mode numeric ID area followed by a
split-translate multiple-choice body. Worked examples are in the retained
technical manual §6.2.

---

## Factory and configuration commands

Framing `0x12 ESC <cmd> 0x12 E`. **Commands marked ⚠️ write EEPROM and persist
across power cycles.** Several can cost you the link entirely; do not send them
casually.

### Queries — safe, read-only

| Command | Returns |
|---|---|
| `GETCONFIG` | configuration string, see below |
| `GETTBLS` | threshold and decay, e.g. `80 1.5` |
| `S` | status byte |
| `V` | version string |

`GETCONFIG` on this unit returns `22 00 80 EVEINL80 1.5`:

| Field | Meaning |
|---|---|
| `2` | baud prescaler (2 = 9.8304 MHz) |
| `2` | baud index — `0`=38400 `1`=19200 `2`=9600 `3`=4800 `4`=2400 `5`=1200 `6`=600 `7`=300 |
| `00` | EEPROM flags byte (see table below) |
| `80` | bottom timing |
| `EVEINL80` | even parity, inline timing, 80% threshold |
| `1.5` | 1.5% decay |

**Status byte** (`S`) — bit 0 is LSB:

| Bit | Meaning |
|---|---|
| 0 | document at throat |
| 1 | document jam — *documented as non-functional, always 0* |
| 2 | power-on self-test failure — *documented as not checkable* |
| 3 | unused |
| 4 | transport cleared |
| 5 | transport enabled |
| 6 | QC test mode |
| 7 | parity bit — *always 0* |

**Version** (`V`) returns two CR-terminated strings: model and version, then
firmware build date as `DayOfWeek|Month|DayOfMonth|Year|Hour:Min`. This unit:
`OMR-1100 - Version 1.04` / `Wed Oct  2 1996 16:15`.

### Transport control

| Command | Action |
|---|---|
| `E` | enable OMR |
| `D` | disable OMR |
| `ER` | eject ticket out the rear — only when exit control is enabled |
| `EF` | eject ticket out the front — only when exit control is enabled |
| `R` | retransmit the data buffer before the next document |
| `SHOE` | enter shoeshine mode |
| `STOP` | exit shoeshine mode |
| `RESET` | reset the reader — also commits pending EEPROM writes |

Exit control holds the form past the read head until an eject command arrives.
All data must be received by the host before ejecting, since the reader ignores
commands while busy.

### Configuration ⚠️

Each takes effect after a `CHECKSUM` command; those noted also require `RESET`
to persist.

| Command | Values |
|---|---|
| ⚠️ `SETBAUDxx` | `00`=38400 `01`=19200 `02`=9600 `03`=4800 `04`=2400 `05`=1200 `06`=600 `07`=300 — then `CHECKSUM`, then `RESET` |
| ⚠️ `SETPARITYx` | `0`=even `1`=odd `2`=none |
| ⚠️ `SETTHRESHx` | `0`–`9` = 64%, 66%, 68%, 70%, 72%, 74%, 76%, 78%, 80%, 82% |
| ⚠️ `SETDECAYx` | `0`=0.025% `1`=0.05% `2`=1.0% `3`=1.5% `4`=2% `5`=4% |
| ⚠️ `SETTMTYPEx` | `0`=inline `1`=offset |
| ⚠️ `SETTMCHx` | `0`=bottom `1`=top `2`=both — then `CHECKSUM`, then `RESET` |
| ⚠️ `SETFLAGSxx` | EEPROM flags byte, see below |
| ⚠️ `SETFACTORY` | restore factory defaults |
| ⚠️ `PROGRAMxxxxxx` | write arbitrary EEPROM byte — factory use only |
| `EXAMINExxxxxx` | read memory: `xx` bytes from hex address `xxxx` |
| `STA` | temporarily force timing channel to bottom; not saved, cleared by reset |

**EEPROM flags byte** — `SETFLAGSxx` takes a hex value; bits OR together:

| Bit | Value | Name | Set = |
|---|---|---|---|
| 0 | `01` | exit control | eject command required to release media |
| 1 | `02` | feed control | enable command required before each feed |
| 2 | `04` | flow control | enabled — also pick a type via bit 3 |
| 3 | `08` | flow type | 1 = RTS/CTS, 0 = XON/XOFF |
| 4 | `10` | Hollerith mode | enabled; clearing returns to binary |
| 5 | `20` | initial XON | enabled; requires bit 2 set and bit 3 clear |
| 6 | `40` | true data | enabled; clearing returns to binary |
| 7 | `80` | reciprocate | enabled |

This unit reads `00` — every option off. That is why it feeds through without
waiting for host permission, and why no flow control is in play.

Flow control notes: with XON/XOFF, Ctrl-Q resumes and Ctrl-S halts. With
RTS/CTS the host holds CTS low to stop the reader transmitting or transporting,
and the reader holds RTS low while busy. **RTS/CTS additionally requires
swapping the supplied Chatsworth cable for a standard null-modem cable** — the
stock cable only supports XON/XOFF.

### Extended commands (documented for the 1102)

Same `Ctrl-R ESC … Ctrl-R E` framing.

| Command | Action |
|---|---|
| `E` / `D` | feed control enable / disable |
| `ER` / `EF` | exit rear / front |
| `ST` / `SB` | timing track: top (right side entering) / bottom (left side entering) |
| `R` | retransmit |
| `S` | status byte |
| `V` | version |

> **Discrepancy worth knowing:** the OMR-1100 command set documents `STA` as
> *temporarily force bottom timing*, while the 1102 manual documents `ST` as
> *select top timing*. These are different models and the encodings appear to
> differ. Do not assume one from the other; both are transcribed as printed.

Three options have no dynamic command and are configuration-only: data flow
control, data mark alignment, and parity format.

---

## Original DOS utilities

The distribution disk carried four programs. The binaries were recovered but are
**not** kept in this repo — they are 16-bit DOS executables of no practical use
here, and their functions are all reachable over the serial protocol documented
above. Recorded for identification only:

| Program | Function |
|---|---|
| `OMRCFG.EXE` | configuration: baud rate and translation mode. `/P1`,`/P2` port; `/B<rate>`; `/Q` download `OMRCFG.CFG`; `/?` help. Menu: F5 restore factory defaults, F7 configure, F10 save and exit. |
| `OMRDEMO.EXE` | card image display — renders detected marks as a grid. Our `omr-decode.py` reproduces this. |
| `OMRDETECT.EXE` | detects COM port, baud rate, and cable type. Our `omr-query.py` reproduces this. |
| `OMRDNLD.EXE` | download interface for evaluating configuration strings against a form. |
