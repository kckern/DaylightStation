; SchoolCalc TI-86 input boundary.
;
; TI-OS `_getkey` is not safe after an SCX1 runtime handoff: it can retain a
; translated-key/ROM-page context rather than reading the freshly restored
; calculator keyboard. SchoolCalc therefore scans the physical key matrix
; itself. The matrix's key-bit/row order is the TI-86 raw-code order already
; used throughout the UI, including the normal 2nd-then-Up/Down contrast
; gesture.

sc_input_init:
        ei
        res SC_ON_INTERRUPT,(iy+SC_ON_FLAGS)
        xor a
        ld (sc_input_second_armed),a
        call _apdSetup
        ; The TI-OS launcher (and a returning child runtime) can leave its
        ; activating key physically down for several scans. Wait until it is
        ; released so a closing EXIT never closes the restored parent too.
        call sc_input_wait_release
        ret

; Wait until the physical scanner reports a stable no-key state. Callers use
; this after a runtime handoff, a regular UI event, and a contrast adjustment
; so an activating key cannot become the next UI action. A single no-key scan
; is not enough: the TI-86 keypad can bounce briefly after a press, which used
; to turn one Down press into two navigation events on a list.
sc_input_wait_release:
        call sc_input_read_raw
        jr nz,sc_input_release_wait
        call sc_input_debounce_delay
        call sc_input_read_raw
        ret z
sc_input_release_wait:
        ; Direct matrix reads do not produce the TI-OS translated-key wake
        ; event. Poll while a key is down so a short release cannot be missed
        ; between runtimes; the normal APD policy still owns idle shutdown.
        jr sc_input_wait_release

; Keep the direct matrix path independent from TI-OS's translated-key wake
; mechanism, but require a short quiet interval before rearming a key. One
; complete B-counter pass lets a transient open matrix line settle while
; keeping foreground navigation immediate. BC is scratch throughout the
; shared input boundary.
sc_input_debounce_delay:
        ld b,0
sc_input_debounce_loop:
        djnz sc_input_debounce_loop
        ret

; Nonblocking. Returns A=SC_SCAN_NONE or one raw scan code. A 2nd press arms
; exactly one following key. The direct scanner makes the modifier reliable in
; every runtime bank rather than relying on a TI-OS key translation context.
sc_input_poll:
        bit SC_ON_INTERRUPT,(iy+SC_ON_FLAGS)
        jp nz,sc_input_force_exit

        call sc_input_read_raw
        ret z
        cp SC_SCAN_SECOND
        jr z,sc_input_arm_second

        ld b,a
        ld a,(sc_input_second_armed)
        or a
        ld a,b
        jr z,sc_input_poll_raw
        xor a
        ld (sc_input_second_armed),a
        ld a,b
        cp SC_SCAN_UP
        jp z,sc_input_contrast_up
        cp SC_SCAN_DOWN
        jp z,sc_input_contrast_down
        cp SC_SCAN_EXIT
        jp z,sc_input_force_exit
        jr sc_input_event_ready

sc_input_poll_raw:
        cp SC_SCAN_EXIT
        jp z,sc_input_exit_or_quit

sc_input_event_ready:
        ; CLEAR deliberately maps to EXIT so it is a conventional Back/cancel
        ; key everywhere in SchoolCalc.
        cp SC_SCAN_CLEAR
        jr z,sc_input_clear_to_back
        push af
        call sc_input_wait_release
        call _apdSetup
        pop af
        ret

sc_input_arm_second:
        ld a,1
        ld (sc_input_second_armed),a
        xor a
        ret

sc_input_exit_or_quit:
        ld a,(sc_input_second_armed)
        or a
        jp nz,sc_input_force_exit
        ld a,SC_SCAN_EXIT
        ret

sc_input_clear_to_back:
        ld a,SC_SCAN_EXIT
        push af
        call sc_input_wait_release
        call _apdSetup
        pop af
        ret

; Read the first physical key that is down, in TI-86 raw scan-code order.
;
; The keypad chooses one of seven key-bit columns by writing $FE, $FD, ...
; $BF to port 1. A subsequent port-1 read exposes its eight rows as active-low
; bits. Advancing the column and row counters in this order yields precisely
; the raw scan values declared in ti86asm.inc: e.g. Down=$01, Enter=$09,
; F5=$31, 2nd=$36, Exit=$37. The routine deliberately returns one event until
; the caller's release fence observes an empty matrix; this avoids repeating a
; held navigation key while keeping the code compact enough for every runtime.
;
; Clobbers B, C, D. Returns A=0 when no key is pressed.
sc_input_read_raw:
        ld a,$FE
        ld d,1
        ld c,0
sc_input_scan_column:
        out (1),a
        ld b,8
        push af
sc_input_scan_row:
        inc c
        in a,(1)
        and d
        jr z,sc_input_scan_found
        rlc d
        djnz sc_input_scan_row
        pop af
        rlca
        cp $7F
        jr nz,sc_input_scan_column
        xor a
        ret
sc_input_scan_found:
        pop af
        ld a,c
        or a
        ret

; The physical contrast register is 0..31. Saturate at either edge; wrapping
; from dark to bright (or the reverse) would be disorienting in a lesson.
sc_input_contrast_up:
        ld a,(SC_OS_CONTRAST)
        cp SC_CONTRAST_MAX
        jr z,sc_input_apply_contrast
        inc a
        jr sc_input_apply_contrast

sc_input_contrast_down:
        ld a,(SC_OS_CONTRAST)
        or a
        jr z,sc_input_apply_contrast
        dec a

sc_input_apply_contrast:
        ld (SC_OS_CONTRAST),a
        out (SC_CONTRAST_PORT),a
        ; Consume the held arrow before returning to the regular raw scanner.
        call sc_input_wait_release
        jr sc_input_wait

; Poll the physical matrix directly. Unlike TI-OS `_idle`, this does not wait
; for the translated-key subsystem to announce an event (which SCX1 children
; intentionally bypass). The scanner is active only while a SchoolCalc view
; owns the foreground; `_apdSetup` is reset on meaningful input and the ON
; interrupt remains an immediate escape.
sc_input_wait:
        call sc_input_poll
        or a
        ret nz
        jr sc_input_wait

; This OS vector resets command execution state and does not depend on the
; assembly caller's return address. It is safer than RET for an emergency exit.
sc_input_force_exit:
        call _runindicoff
        call _clrLCD
        jp _JforceCmdNoChar

; Runtime-local: every executable calls sc_input_init before accepting input,
; so no 2nd modifier state can survive a runtime handoff.
sc_input_second_armed:
        defb 0
