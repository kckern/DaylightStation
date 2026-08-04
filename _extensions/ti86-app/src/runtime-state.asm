; Shared crash-safe SCL1 state access for separately reviewed runtimes.
;
; The shell, SCCAT, and SCREQ all mutate one fixed-layout continuation through
; alternating DSLOCAL0/DSLOCAL1 slots. Callers edit scstate_record in RAM and
; invoke scstate_save; the active slot is never deleted before its replacement
; has been written and envelope-validated.

SCSTATE_RECORD_BYTES:              equ 124
SCSTATE_GENERATION_OFFSET:         equ 7
SCSTATE_FLAGS_OFFSET:              equ 11
SCSTATE_VIEW_OFFSET:               equ 13
SCSTATE_ARTIFACT_KEY_OFFSET:       equ 14
SCSTATE_CATALOG_INDEX_OFFSET:      equ 24
SCSTATE_SUBJECT_INDEX_OFFSET:      equ 26
SCSTATE_COURSE_INDEX_OFFSET:       equ 28
SCSTATE_UNIT_INDEX_OFFSET:         equ 30
SCSTATE_LESSON_INDEX_OFFSET:       equ 32
SCSTATE_MODULE_INDEX_OFFSET:       equ 34
SCSTATE_ITEM_INDEX_OFFSET:         equ 36
SCSTATE_FOCUS_OFFSET:              equ 38
SCSTATE_SCROLL_OFFSET:             equ 40
SCSTATE_CARD_FACE_OFFSET:          equ 42
SCSTATE_DRAFT_KIND_OFFSET:         equ 45
SCSTATE_DRAFT_LENGTH_OFFSET:       equ 46
SCSTATE_DRAFT_OFFSET:              equ 47
SCSTATE_NEXT_SEQUENCE_OFFSET:      equ 95
SCSTATE_NEXT_REQUEST_ID_OFFSET:    equ 98
SCSTATE_DELIVERY_ACTION_OFFSET:    equ 101
SCSTATE_CATALOG_KEY_OFFSET:        equ 108
SCSTATE_SELECTED_LEARNER_OFFSET:   equ 118
SCSTATE_SESSION_LEARNER_OFFSET:    equ 120
SCSTATE_CRC_OFFSET:                equ 122

SCSTATE_FLAG_SESSION:              equ 0x01
SCSTATE_FLAG_DRAFT:                equ 0x02
SCSTATE_FLAG_CATALOG_SLOT_ONE:     equ 0x20
SCSTATE_FLAG_INSTALL_SLOT_ONE:     equ 0x40
SCSTATE_FLAG_SYNC_SNAPSHOT:        equ 0x80
; The delivery-pending flag is bit zero of the high flags byte.
SCSTATE_FLAG_DELIVERY_PENDING_HIGH: equ 0x01
SCSTATE_FLAG_RESULT_PENDING_HIGH:   equ 0x02
; A selected key of zero means the explicit Guest profile.  Keep its
; first-boot acknowledgement separate from the key so Guest is remembered.
SCSTATE_FLAG_LEARNER_SELECTED_HIGH: equ 0x04

scstate_load:
        xor a
        ld (scstate_found),a
        ld (scstate_conflict),a
        ld (scstate_failure),a
        ld a,0xFF
        ld (scstate_active_slot),a

        xor a
        ld hl,scstate_local0_name
        call scstate_consider
        ld a,1
        ld hl,scstate_local1_name
        call scstate_consider

        ld a,(scstate_found)
        or a
        jr nz,scstate_load_found
        ld a,1                 ; neither recovery slot was valid
        jr scstate_load_failed
scstate_load_found:
        ld a,(scstate_conflict)
        or a
        jr z,scstate_load_selected
        ld a,2                 ; equally-new slots disagree
        jr scstate_load_failed
scstate_load_selected:

        ld hl,(scstate_descriptor)
        ld de,scstate_scl1_magic
        call sc_envelope_open
        jr nc,scstate_load_envelope_ok
        ld a,3                 ; selected envelope was no longer readable
        jr scstate_load_failed
scstate_load_envelope_ok:
        call scstate_require_length
        jr nc,scstate_load_length_ok
        ld a,4                 ; selected envelope has the wrong fixed size
        jr scstate_load_failed
scstate_load_length_ok:

        ld hl,scstate_record
        ld (scstate_copy_pointer),hl
        ld de,0
        ld a,SCSTATE_RECORD_BYTES
        ld (scstate_copy_remaining),a
scstate_copy_loop:
        call sc_record_read_byte
        jr nc,scstate_load_copy_byte
        ld a,5                 ; record became unreadable while copying
        jr scstate_load_failed
scstate_load_copy_byte:
        ld hl,(scstate_copy_pointer)
        ld (hl),a
        inc hl
        ld (scstate_copy_pointer),hl
        inc de
        ld a,(scstate_copy_remaining)
        dec a
        ld (scstate_copy_remaining),a
        jr nz,scstate_copy_loop
        or a
        ret
scstate_load_fail:
        ld a,5
scstate_load_failed:
        ld (scstate_failure),a
        scf
        ret

; A = slot index, HL = TI String descriptor.
scstate_consider:
        ld (scstate_candidate_slot),a
        ld (scstate_candidate_descriptor),hl
        ld de,scstate_scl1_magic
        call sc_envelope_open
        ret c
        call scstate_require_length
        ret c

        ld de,SCSTATE_GENERATION_OFFSET
        call sc_record_read_byte
        ret c
        ld (scstate_candidate_generation),a
        inc de
        call sc_record_read_byte
        ret c
        ld (scstate_candidate_generation + 1),a
        inc de
        call sc_record_read_byte
        ret c
        ld (scstate_candidate_generation + 2),a
        inc de
        call sc_record_read_byte
        ret c
        ld (scstate_candidate_generation + 3),a

        ld a,(scstate_found)
        or a
        jr z,scstate_select
        ld hl,scstate_candidate_generation + 3
        ld de,scstate_generation + 3
        ld b,4
scstate_compare_generation:
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jr c,scstate_candidate_older
        jr nz,scstate_select
        dec hl
        dec de
        djnz scstate_compare_generation
        ld a,1
        ld (scstate_conflict),a
scstate_candidate_older:
        or a
        ret

scstate_select:
        ld hl,(scstate_candidate_descriptor)
        ld (scstate_descriptor),hl
        ld a,(scstate_candidate_slot)
        ld (scstate_active_slot),a
        ld hl,scstate_candidate_generation
        ld de,scstate_generation
        ld bc,4
        ldir
        ld a,1
        ld (scstate_found),a
        or a
        ret

scstate_require_length:
        ld hl,(sc_record_length)
        ld de,SCSTATE_RECORD_BYTES
        or a
        sbc hl,de
        ret z
        scf
        ret

scstate_save:
        ld hl,(scstate_record + SCSTATE_GENERATION_OFFSET)
        ld de,(scstate_record + SCSTATE_GENERATION_OFFSET + 2)
        inc hl
        ; INC rr does not change Z on Z80. Test the low word explicitly so
        ; the high word advances only on an actual 16-bit wrap.
        ld a,h
        or l
        jr nz,scstate_generation_ready
        inc de
        ld a,d
        or e
        jr z,scstate_save_fail
scstate_generation_ready:
        ld (scstate_record + SCSTATE_GENERATION_OFFSET),hl
        ld (scstate_record + SCSTATE_GENERATION_OFFSET + 2),de
        ld hl,scstate_record
        ld bc,SCSTATE_CRC_OFFSET
        call crc16_ccitt_false
        ld a,e
        ld (scstate_record + SCSTATE_CRC_OFFSET),a
        ld a,d
        ld (scstate_record + SCSTATE_CRC_OFFSET + 1),a

        ld a,(scstate_active_slot)
        xor 1
        ld (scstate_target_slot),a
        or a
        ld hl,scstate_local0_name
        jr z,scstate_target_ready
        ld hl,scstate_local1_name
scstate_target_ready:
        ld (scstate_target_descriptor),hl
        rst 0x20
        rst 0x10
        call nc,_delvar

        call _memchk
        or a
        jr nz,scstate_memory_ready
        ld de,SCSTATE_RECORD_BYTES + 32
        or a
        sbc hl,de
        jr c,scstate_save_fail
scstate_memory_ready:
        ld hl,(scstate_target_descriptor)
        rst 0x20
        ld hl,SCSTATE_RECORD_BYTES
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,scstate_record
        call _set_abs_src
        xor a
        ld hl,SCSTATE_RECORD_BYTES
        call _set_mm_bytes
        call _mm_ldir

        ld hl,(scstate_target_descriptor)
        ld de,scstate_scl1_magic
        call sc_envelope_open
        jr c,scstate_save_fail
        call scstate_require_length
        jr c,scstate_save_fail
        ld a,(scstate_target_slot)
        ld (scstate_active_slot),a
        or a
        ret
scstate_save_fail:
        scf
        ret

scstate_found:                defb 0
scstate_conflict:             defb 0
scstate_active_slot:          defb 0xFF
scstate_target_slot:          defb 0
scstate_candidate_slot:       defb 0
scstate_candidate_descriptor: defw 0
scstate_descriptor:           defw 0
scstate_target_descriptor:    defw 0
scstate_generation:           defs 4,0
scstate_candidate_generation: defs 4,0
scstate_copy_pointer:         defw 0
scstate_copy_remaining:       defb 0
; 0 is success; nonzero values are stable, UI-safe load diagnostics.
scstate_failure:              defb 0
scstate_record:               defs SCSTATE_RECORD_BYTES,0

scstate_scl1_magic: defb "SCL1"
scstate_local0_name: defb 0x0C,8,"DSLOCAL0"
scstate_local1_name: defb 0x0C,8,"DSLOCAL1"
