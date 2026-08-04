; Creates a real TI String, validates it through the paged SchoolCalc reader,
; then proves a one-byte-corrupted replacement is rejected by CRC.

include "ti86asm.inc"

org _asm_exec_ram

start:
        call _runindicoff
        call sc_input_init
        xor a
        ld (probe_valid_ok),a
        ld (probe_corrupt_ok),a
        ld hl,title_missing
        ld (probe_extracted_title),hl
        call create_probe_string
        ld hl,probe_string_name
        ld de,probe_magic
        call sc_record_open
        jr c,probe_corrupt
        ld de,(sc_record_root_offset)
        ld hl,key_lesson
        call sc_map_find_literal
        jr c,probe_corrupt
        ld hl,key_title
        call sc_map_find_literal
        jr c,probe_corrupt
        push de
        ld hl,expected_title
        call sc_node_string_equals_literal
        pop de
        jr c,probe_corrupt
        or a
        jr z,probe_corrupt
        call sc_copy_node_string
        jr c,probe_corrupt
        ld (probe_extracted_title),hl
        ld a,1
        ld (probe_valid_ok),a

probe_corrupt:
        ld a,(probe_record + 10)
        xor 1
        ld (probe_record + 10),a
        call create_probe_string
        ld a,(probe_record + 10)
        xor 1
        ld (probe_record + 10),a
        ld hl,probe_string_name
        ld de,probe_magic
        call sc_record_open
        jr nc,probe_cleanup
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_CRC
        jr nz,probe_cleanup
        ld a,1
        ld (probe_corrupt_ok),a

probe_cleanup:
        call delete_probe_string
        call render_probe
probe_wait:
        call sc_input_wait
        cp SC_SCAN_ENTER
        jr z,probe_exit
        cp SC_SCAN_EXIT
        jr nz,probe_wait
probe_exit:
        jp sc_input_force_exit

create_probe_string:
        call delete_probe_string
        ld hl,PROBE_RECORD_LENGTH
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,probe_record
        call _set_abs_src
        xor a
        ld hl,PROBE_RECORD_LENGTH
        call _set_mm_bytes
        jp _mm_ldir

delete_probe_string:
        ld hl,probe_string_name
        rst 0x20
        rst 0x10
        call nc,_delvar
        ret

render_probe:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,probe_title
        ld b,1
        ld c,1
        call ui_draw_text
        call ui_mode_set
        call ui_select_reader
        ld a,(probe_valid_ok)
        or a
        ld hl,valid_failed
        jr z,probe_valid_line
        ld hl,valid_passed
probe_valid_line:
        ld b,2
        ld c,14
        call ui_draw_text
        ld a,(probe_corrupt_ok)
        or a
        ld hl,corrupt_failed
        jr z,probe_corrupt_line
        ld hl,corrupt_passed
probe_corrupt_line:
        ld b,2
        ld c,25
        call ui_draw_text
        ld hl,title_label
        ld b,2
        ld c,36
        call ui_draw_text
        ld hl,(probe_extracted_title)
        ld b,32
        ld c,36
        call ui_draw_text
        call ui_select_compact
        ld hl,probe_instruction
        ld b,2
        ld c,45
        jp ui_draw_text

probe_valid_ok:          defb 0
probe_corrupt_ok:        defb 0
probe_extracted_title:   defw 0
probe_magic:             defb "SCP1"
probe_string_name:       defb 0x0C,6,"SCTEST",0,0
probe_title:             defb "PAGED RECORD READER",0
valid_passed:            defb "Valid SCP1 accepted",0
valid_failed:            defb "VALID RECORD FAILED",0
corrupt_passed:          defb "Corruption rejected",0
corrupt_failed:          defb "CORRUPTION NOT CAUGHT",0
probe_instruction:       defb "ENTER OR EXIT",0
key_lesson:              defb "lesson",0
key_title:               defb "title",0
expected_title:          defb "Reader probe",0
title_label:             defb "Title:",0
title_missing:           defb "<missing>",0

include "record-reader.asm"
UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 1
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/record-reader-probe-data.inc"
include "generated/ui-assets.inc"

end
