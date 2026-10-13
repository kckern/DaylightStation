; Minimal TI-86 definitions used by SchoolCalc hardware probes.
;
; The LCD framebuffer is 128 × 64 monochrome pixels: 16 bytes per row, held
; at $FC00. Addresses below were checked against the source-included TI-86
; development headers published by ticalc.org.

_asm_exec_ram:  equ $D748
_idle:           equ $405C
_apdSetup:       equ $4060
_clrLCD:        equ $4A7E
_JforceCmdNoChar: equ $409C
_memchk:        equ $46BB
_runindicoff:   equ $4AB1
_findsym:       equ $46CB
_createstrng:   equ $472F
_delvar:        equ $475F
_ex_ahl_bde:    equ $45F3
_ahl_plus_2_pg3: equ $4C3F
_set_abs_src:   equ $4647
_set_abs_dest:  equ $5285
_set_mm_bytes:  equ $464F
_mm_ldir:       equ $52ED
_get_word_ahl:  equ $521D
_exec_assembly: equ $5730
_plotSScreen:   equ $C9FA
VideoRam:       equ $FC00

; TI-86 hardware contrast. The operating system preserves its current level
; at $C008 and writes that byte (0..31) to the write-only contrast port. Use
; the OS-owned level rather than a runtime-local shadow so 2nd+Up/Down stays
; consistent across SchoolCalc's separately loaded assembly modules.
SC_OS_CONTRAST:    equ $C008
SC_CONTRAST_PORT:  equ $02
SC_CONTRAST_MAX:   equ $1F

; Raw event values emitted by SchoolCalc's shared input boundary.
SC_SCAN_NONE:   equ $00
SC_SCAN_DOWN:   equ $01
SC_SCAN_LEFT:   equ $02
SC_SCAN_RIGHT:  equ $03
SC_SCAN_UP:     equ $04
SC_SCAN_ENTER:  equ $09
SC_SCAN_CLEAR:  equ $0F
SC_SCAN_ON:     equ $29
SC_SCAN_F5:     equ $31
SC_SCAN_F4:     equ $32
SC_SCAN_F3:     equ $33
SC_SCAN_F2:     equ $34
SC_SCAN_F1:     equ $35
SC_SCAN_SECOND: equ $36
SC_SCAN_EXIT:   equ $37
SC_SCAN_MORE:   equ $38

; The ON interrupt flag is maintained by TI-OS's interrupt handler. Input code
; checks it independently of the direct keypad scan so ON remains an emergency
; escape.
SC_ON_FLAGS:     equ 9
SC_ON_INTERRUPT: equ 4
