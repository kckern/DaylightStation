; SchoolCalc TI-86 input boundary.
;
; _get_key ($4068) returns raw scan codes and is nonblocking. It must never be
; compared with the translated k* values from _getkey ($55AA). The ON
; interrupt remains the hardware emergency exit. Ordinary EXIT and CLEAR are
; both returned as Back to the active view; the explicit 2nd + EXIT chord is
; the sole user-requested application quit gesture.

sc_input_init:
        ei
        res SC_ON_INTERRUPT,(iy+SC_ON_FLAGS)
        xor a
        ld (sc_input_second_armed),a
        call _apdSetup
        ; The TI-OS launcher (and a returning child runtime) can leave its
        ; activating key physically down for several scans.  Do not merely
        ; read it once: wait until it is released so an EXIT that closed a
        ; child view cannot immediately close the parent shell as well.
        call sc_input_wait_release
        ret

; Wait until no raw key is present.  This is intentionally separate from the
; translated polling boundary below: callers use it after _exec_assembly
; returns, before they interpret a new user action in the restored view.
sc_input_wait_release:
        call _get_key
        or a
        ret z
        call _idle
        jr sc_input_wait_release

; Nonblocking. Returns A=SC_SCAN_NONE or one raw scan code. ON forces a clean
; TI-OS command-screen transition. CLEAR deliberately maps to EXIT so it is a
; conventional Back/cancel key everywhere in SchoolCalc. Pressing 2nd arms
; one following key; only 2nd + EXIT forces a TI-OS command-screen return.
sc_input_poll:
        bit SC_ON_INTERRUPT,(iy+SC_ON_FLAGS)
        jp nz,sc_input_force_exit
        call _get_key
        cp SC_SCAN_ON
        jp z,sc_input_force_exit
        cp SC_SCAN_SECOND
        jr z,sc_input_arm_second
        or a
        ret z
        cp SC_SCAN_EXIT
        jp z,sc_input_exit_or_quit
        push af
        xor a
        ld (sc_input_second_armed),a
        pop af
        cp SC_SCAN_CLEAR
        jr z,sc_input_clear_to_back
        push af
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
        ret

; Wait without a full-speed busy loop. TI-OS interrupts wake _idle, update the
; keyboard scanner, handle APD, and set the independent ON interrupt flag.
sc_input_wait:
        call sc_input_poll
        or a
        ret nz
        call _idle
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
