; SchoolCalc reviewed result/progress queue runtime.
;
; SCQUEUE is the single calculator-side writer for SCR1 records in DSQ. The
; learning runtime first commits a bounded pending continuation to SCL1. This
; fixed program then performs backup-first SCQ1 recovery/append, advances the
; device-global sequence, and clears the pending bit only after DSQ verifies.

include "ti86asm.inc"

org _asm_exec_ram

        nop
        jp result_queue_runtime_start
        defw 0
        defw result_queue_runtime_name
        defb "SCX1"
        defb 1
        defb 5                 ; closed registry code: result-queue
        defb 0
        defw 0
        defw 0
        defw 0

result_queue_runtime_name: defb 0

result_queue_runtime_start:
        ; SCHLCALC checks the immutable Program image before this child runs.
        call scstate_load
        ret c
        call result_queue_commit
        ret

result_queue_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,result_queue_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,result_queue_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,result_queue_scx_magic
        ld b,4
result_queue_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,result_queue_scx_fail
        inc de
        inc hl
        djnz result_queue_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,result_queue_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 5
        jr nz,result_queue_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,result_queue_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,result_queue_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,result_queue_scx_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,result_queue_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,result_queue_scx_fail
        or a
        ret
result_queue_scx_fail:
        scf
        ret

result_queue_scx_magic: defb "SCX1"
runtime_error: defb 0

include "crc16-ccitt.asm"
include "record-reader.asm"
include "runtime-state.asm"

RUNTIME_SCL_FLAGS_OFFSET:        equ SCSTATE_FLAGS_OFFSET
RUNTIME_SCL_VIEW_OFFSET:         equ SCSTATE_VIEW_OFFSET
RUNTIME_SCL_ARTIFACT_KEY_OFFSET: equ SCSTATE_ARTIFACT_KEY_OFFSET
RUNTIME_SCL_MODULE_INDEX_OFFSET: equ SCSTATE_MODULE_INDEX_OFFSET
RUNTIME_SCL_SCROLL_OFFSET:       equ SCSTATE_SCROLL_OFFSET
RUNTIME_SCL_CARD_FACE_OFFSET:    equ SCSTATE_CARD_FACE_OFFSET
RUNTIME_SCL_DRAFT_KIND_OFFSET:   equ SCSTATE_DRAFT_KIND_OFFSET
RUNTIME_SCL_DRAFT_LENGTH_OFFSET: equ SCSTATE_DRAFT_LENGTH_OFFSET
RUNTIME_SCL_DRAFT_OFFSET:        equ SCSTATE_DRAFT_OFFSET
RUNTIME_SCL_NEXT_SEQUENCE_OFFSET: equ SCSTATE_NEXT_SEQUENCE_OFFSET
RUNTIME_SCL_SESSION_LEARNER_OFFSET: equ SCSTATE_SESSION_LEARNER_OFFSET
RUNTIME_ERROR_SAVE:              equ 4
runtime_state_record:            equ scstate_record
runtime_state_save:              equ scstate_save

include "runtime-queue.asm"

end
