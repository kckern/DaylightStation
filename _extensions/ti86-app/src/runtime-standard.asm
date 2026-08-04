; SchoolCalc reviewed standard-learning runtime.
;
; This is an independently executable TI-86 assembly program invoked only by
; the shell's fixed SCLEARN dispatch entry. Its SCX1 header is patched and
; verified by the build tool. Ordinary SCP1 lesson artifacts cannot choose a
; program name and are never copied into executable RAM.

include "ti86asm.inc"

; A reader page advances several authored reading blocks.  It is deliberately
; smaller than the maximum array size so the final page clamps in place rather
; than accidentally completing the module.
STANDARD_READER_PAGE_STEP: equ 4

org _asm_exec_ram

        nop
        jp standard_runtime_start
        defw 0
        defw standard_runtime_name
        defb "SCX1"
        defb 1                 ; runtime ABI
        defb 1                 ; closed registry code: standard-learning
        defb 0                 ; flags (none in ABI v1)
        defw 0                 ; complete code length, patched by builder
        defw 0                 ; payload CRC-16, patched by builder
        defw 0                 ; reserved

standard_runtime_name: defb 0

standard_runtime_start:
        ; SCHLCALC validates the immutable Program variable (including SCX1
        ; CRC) before TI-OS loads this mutable execution image.
        call _runindicoff
        call sc_input_init
        call runtime_open_selected_module
        jp c,standard_runtime_render_error
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        and STANDARD_FLAG_RESULT_PENDING_HIGH
        jr z,standard_runtime_dispatch
        call standard_launch_result_queue
        jp c,standard_runtime_render_error
        ret
standard_runtime_dispatch:
        call standard_ensure_session_identity
        jp c,standard_runtime_render_error
        ld a,(runtime_mode)
        cp RUNTIME_MODE_TOOL
        jp z,standard_launch_native
        cp RUNTIME_MODE_PROBLEMS
        jp nc,assessment_runtime_start
        call standard_runtime_render
        jp standard_runtime_wait

; Freeze the selected profile at module entry. Later profile switching edits
; only SELECTED; every result reads SESSION, so queued work is immutable.
; Key zero is the explicit Guest session and is allowed to study locally.
standard_ensure_session_identity:
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and RUNTIME_FLAG_SESSION_ACTIVE
        ret nz
        ld hl,(runtime_state_record + RUNTIME_SCL_SELECTED_LEARNER_OFFSET)
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET),hl
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        or RUNTIME_FLAG_SESSION_ACTIVE
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        call runtime_state_save
        ret c
        jp runtime_open_artifact_and_module

standard_runtime_render:
        call _clrLCD
        ; Sticky inverse header with the design-system's one-pixel margin.
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        call runtime_copy_lesson_title
        jr nc,standard_runtime_header_ready
        ld hl,standard_runtime_title
standard_runtime_header_ready:
        ld b,1
        ld c,1
        ld d,125
        call ui_draw_text_clipped

        call ui_mode_set
        call ui_select_compact
        call runtime_copy_module_label
        jr nc,standard_runtime_module_ready
        ld hl,standard_runtime_module_fallback
standard_runtime_module_ready:
        ld b,2
        ld c,11
        ld d,122
        call ui_draw_text_clipped

        call ui_select_compact
        call runtime_copy_current_text
        jr nc,standard_runtime_content_ready
        ld hl,standard_runtime_block_fallback
standard_runtime_content_ready:
        ld b,2
        ld c,20
        ld d,122
        ld e,52
        call ui_draw_wrapped_text

        ; A minimal non-text scroll rail: content item zero is y=10, later
        ; items move down one pixel and cap near the bottom of the body.
        ld hl,(runtime_content_count)
        ld a,h
        or a
        jr nz,standard_runtime_draw_rail
        ld a,l
        cp 2
        jr c,standard_runtime_draw_separator
standard_runtime_draw_rail:
        call ui_mode_set
        ld b,127
        ld c,9
        ld d,1
        ld e,46
        call ui_fill_rect
        ld a,(runtime_item_index)
        cp 42
        jr c,standard_runtime_marker_ready
        ld a,42
standard_runtime_marker_ready:
        add a,10
        ld c,a
        call ui_mode_clear
        ld b,126
        ld d,2
        ld e,3
        call ui_fill_rect
standard_runtime_draw_separator:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        jp standard_runtime_render_softkeys

; Reader chrome uses the four most valuable physical actions: Top, Back,
; Page Up, and More.  F5 explicitly becomes EOM when the final block is on
; screen, so there is never ambiguity about whether more reading exists. An
; authored scan action temporarily replaces Top with QR; its presenter remains
; a separate full-frame view.
standard_runtime_render_softkeys:
        call ui_mode_set
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld b,26
        ld c,56
        ld d,24
        ld e,8
        call ui_fill_rect
        ld b,77
        ld c,56
        ld d,24
        ld e,8
        call ui_fill_rect
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld a,(runtime_action_page)
        ld hl,standard_runtime_qr_label
        or a
        jr nz,standard_runtime_softkey_f1_ready
        ld hl,standard_runtime_top_label
standard_runtime_softkey_f1_ready:
        ld b,5
        ld c,57
        call ui_draw_text
        ld hl,standard_runtime_back_label
        ld b,30
        ld c,57
        call ui_draw_text
        ld hl,standard_runtime_page_up_label
        ld b,79
        ld c,57
        call ui_draw_text
        call standard_runtime_has_more
        ld hl,standard_runtime_eom_label
        or a
        jr z,standard_runtime_softkey_f5_ready
        ld hl,standard_runtime_more_label
standard_runtime_softkey_f5_ready:
        ld b,104
        ld c,57
        call ui_draw_text
        jp ui_mode_set

standard_runtime_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,standard_runtime_leave_viewed
        cp SC_SCAN_LEFT
        jp z,standard_runtime_leave_viewed
        cp SC_SCAN_DOWN
        jp z,standard_runtime_next
        cp SC_SCAN_RIGHT
        jp z,standard_runtime_next
        cp SC_SCAN_ENTER
        jp z,standard_runtime_next
        cp SC_SCAN_UP
        jp z,standard_runtime_previous
        cp SC_SCAN_F1
        jp z,standard_runtime_f1
        cp SC_SCAN_F2
        jp z,standard_runtime_leave_viewed
        cp SC_SCAN_F4
        jp z,standard_runtime_page_up
        cp SC_SCAN_F5
        jp z,standard_runtime_page_down
        jr standard_runtime_wait

standard_runtime_f1:
        ld a,(runtime_action_page)
        or a
        jp nz,standard_runtime_show_action_qr
        jp standard_runtime_top

standard_runtime_top:
        ld hl,(runtime_item_index)
        ld a,h
        or l
        jp z,standard_runtime_wait
        ld hl,0
        jp standard_runtime_move_to_index

standard_runtime_page_up:
        ld hl,(runtime_item_index)
        ld de,STANDARD_READER_PAGE_STEP
        or a
        sbc hl,de
        jr nc,standard_runtime_page_target_ready
        ld hl,0
        jr standard_runtime_page_target_ready

standard_runtime_page_down:
        ld hl,(runtime_item_index)
        ld de,STANDARD_READER_PAGE_STEP
        add hl,de
        ld de,(runtime_content_count)
        or a
        sbc hl,de
        jr c,standard_runtime_page_target_below_end
        push de
        pop hl
        dec hl
        jr standard_runtime_page_target_ready
standard_runtime_page_target_below_end:
        add hl,de
standard_runtime_page_target_ready:
        ld (standard_runtime_page_target),hl
        ld de,(runtime_item_index)
        or a
        sbc hl,de
        jp z,standard_runtime_wait
        ld hl,(standard_runtime_page_target)
standard_runtime_move_to_index:
        call runtime_move_to_candidate
        jp standard_runtime_move_result

; Return A=1 when another reading block follows the current one, A=0 at the
; end (or for a damaged zero-length module). The label and F5 action share
; this exact boundary so an EOM display can never page to hidden content.
standard_runtime_has_more:
        ld hl,(runtime_item_index)
        inc hl
        ld de,(runtime_content_count)
        or a
        sbc hl,de
        jr c,standard_runtime_has_more_yes
        xor a
        ret
standard_runtime_has_more_yes:
        ld a,1
        ret

standard_runtime_show_action_qr:
        ld a,(runtime_action_page)
        or a
        jp z,standard_runtime_wait
        call standard_runtime_draw_action_qr
        jp c,standard_runtime_render_error
standard_runtime_action_qr_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jr z,standard_runtime_action_qr_return
        cp SC_SCAN_LEFT
        jr z,standard_runtime_action_qr_return
        cp SC_SCAN_ENTER
        jr z,standard_runtime_action_qr_return
        cp SC_SCAN_F1
        jr nz,standard_runtime_action_qr_wait
standard_runtime_action_qr_return:
        call standard_runtime_render
        jp standard_runtime_wait

; Expand the validated 21x21 packed symbol to 2x2 LCD modules. Clearing
; the whole LCD supplies the four-module quiet zone: the 58x58 occupied frame
; is centered at (35,3), and its data begins eight pixels inward at (43,11).
; No text or chrome is permitted on this full-frame presenter.
standard_runtime_draw_action_qr:
        ld a,(runtime_action_page)
        or a
        jp z,standard_runtime_action_qr_fail
        call _clrLCD
        call ui_mode_set
        xor a
        ld (standard_action_qr_row),a
        ld hl,(runtime_action_qr_offset)
        ld (standard_action_qr_source),hl
standard_runtime_action_qr_row_loop:
        ld a,(standard_action_qr_row)
        cp STANDARD_ACTION_QR_MODULES
        jr z,standard_runtime_action_qr_done
        xor a
        ld (standard_action_qr_column),a
        ld a,RUNTIME_ACTION_QR_ROW_BYTES
        ld (standard_action_qr_bytes_remaining),a
standard_runtime_action_qr_byte_loop:
        ld de,(standard_action_qr_source)
        call sc_record_read_byte
        jr c,standard_runtime_action_qr_fail
        ld (standard_action_qr_byte),a
        inc de
        ld (standard_action_qr_source),de
        ld a,0x80
        ld (standard_action_qr_mask),a
standard_runtime_action_qr_bit_loop:
        ld a,(standard_action_qr_column)
        cp STANDARD_ACTION_QR_MODULES
        jr z,standard_runtime_action_qr_row_done
        ld a,(standard_action_qr_byte)
        ld b,a
        ld a,(standard_action_qr_mask)
        and b
        jr z,standard_runtime_action_qr_skip_module
        ld a,(standard_action_qr_column)
        add a,a
        add a,STANDARD_ACTION_QR_DATA_X
        ld b,a
        ld a,(standard_action_qr_row)
        add a,a
        add a,STANDARD_ACTION_QR_DATA_Y
        ld c,a
        ld d,2
        ld e,2
        call ui_fill_rect
standard_runtime_action_qr_skip_module:
        ld a,(standard_action_qr_mask)
        srl a
        ld (standard_action_qr_mask),a
        ld a,(standard_action_qr_column)
        inc a
        ld (standard_action_qr_column),a
        ld a,(standard_action_qr_mask)
        or a
        jr nz,standard_runtime_action_qr_bit_loop
        ld a,(standard_action_qr_bytes_remaining)
        dec a
        ld (standard_action_qr_bytes_remaining),a
        jr nz,standard_runtime_action_qr_byte_loop
standard_runtime_action_qr_row_done:
        ld a,(standard_action_qr_row)
        inc a
        ld (standard_action_qr_row),a
        jr standard_runtime_action_qr_row_loop
standard_runtime_action_qr_done:
        or a
        ret
standard_runtime_action_qr_fail:
        ld a,RUNTIME_ERROR_MODULE
        ld (runtime_error),a
        scf
        ret

standard_runtime_next:
        call runtime_move_next
        jr standard_runtime_move_result
standard_runtime_previous:
        call runtime_move_previous
standard_runtime_move_result:
        jr nc,standard_runtime_moved
        ld a,(runtime_error)
        or a
        jr z,standard_runtime_leave_completed
        jp standard_runtime_render_error
standard_runtime_moved:
        call standard_runtime_render
        jp standard_runtime_wait

; Queue one timestamp-free module progress record. A is the protocol status:
; 2=viewed, 3=completed. Position is one-based; SCL1 retains only ordering.
standard_runtime_leave_viewed:
        ld a,2
        jr standard_runtime_stage_progress
standard_runtime_leave_completed:
        ld a,3
standard_runtime_stage_progress:
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld (hl),a
        inc hl
        ld de,(runtime_item_index)
        inc de
        ld (hl),e
        inc hl
        ld (hl),d
        inc hl
        ld de,(runtime_content_count)
        ld (hl),e
        inc hl
        ld (hl),d
        ; Returning from an ordinary reader/example/flashcard module resumes
        ; the containing lesson in Catalog. Leaving the durable view at
        ; MODULE would make the shell reopen or display a dead lesson husk.
        ld a,RUNTIME_VIEW_LESSON
        ld (runtime_state_record + RUNTIME_SCL_VIEW_OFFSET),a
        ld a,RUNTIME_DRAFT_PROGRESS
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld a,5
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0xEC
        or RUNTIME_FLAG_SESSION_ACTIVE | RUNTIME_FLAG_DRAFT_PRESENT
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        ld hl,(runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET)
        ld a,h
        or l
        jr z,standard_runtime_finish_guest_progress
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        or STANDARD_FLAG_RESULT_PENDING_HIGH
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1),a
        call runtime_state_save
        jp c,standard_runtime_render_error
        call standard_launch_result_queue
        jp c,standard_runtime_render_error
        ret

standard_runtime_finish_guest_progress:
        ; Guest gets the local interaction, but no SCR1, sequence, or upload.
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0xEC
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET + 1),a
        call runtime_state_save
        jp c,standard_runtime_render_error
        ret

; Only this fixed build-owned program descriptor can cross the executable
; boundary. Content bytes never select or construct a TI program name.
standard_launch_result_queue:
        ld hl,standard_scqueue_name
        rst 0x20
        rst 0x10
        jr c,standard_queue_missing
        call _exec_assembly
        call runtime_open_selected_module
        ret c
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        and STANDARD_FLAG_RESULT_PENDING_HIGH
        jr nz,standard_queue_missing
        or a
        ret
standard_queue_missing:
        ld a,RUNTIME_ERROR_SAVE
        ld (runtime_error),a
        scf
        ret

; Tool modules cross one more fixed code-release boundary. SCNATIVE reopens
; SCL1/SCP1 and validates the complete native plan itself; no content field can
; choose this Program name. Its current build refuses before TI-OS mutation.
standard_launch_native:
        ld hl,standard_scnative_name
        rst 0x20
        rst 0x10
        jr c,standard_native_missing
        call _exec_assembly
        ret
standard_native_missing:
        ld a,RUNTIME_ERROR_MODULE
        ld (runtime_error),a
        jp standard_runtime_render_error

standard_runtime_render_error:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,standard_runtime_title
        ld b,1
        ld c,1
        ld d,125
        call ui_draw_text_clipped
        call ui_mode_set
        call ui_select_compact
        ld hl,standard_runtime_error_line_1
        ld b,2
        ld c,13
        call ui_draw_text
        ld a,(runtime_error)
        cp RUNTIME_ERROR_STATE
        ld hl,standard_runtime_error_state
        jr z,standard_runtime_error_detail_ready
        cp RUNTIME_ERROR_MODULE
        ld hl,standard_runtime_error_module
        jr z,standard_runtime_error_detail_ready
        cp RUNTIME_ERROR_SAVE
        ld hl,standard_runtime_error_save
        jr z,standard_runtime_error_detail_ready
        ld hl,standard_runtime_error_artifact
standard_runtime_error_detail_ready:
        ld b,2
        ld c,27
        ld d,122
        ld e,48
        call ui_draw_wrapped_text
standard_runtime_error_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        jr nz,standard_runtime_error_wait
        call runtime_open_selected_module
        jr c,standard_runtime_render_error
        call standard_runtime_render
        jp standard_runtime_wait

; Validate this loaded program's fixed header and CRC before doing work.
; Carry set rejects the runtime without mutating SchoolCalc state.
scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,scx_validate_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,scx_validate_fail

        ld hl,_asm_exec_ram + 3
        ld de,scx_expected_magic
        ld b,4
scx_validate_magic:
        ld a,(de)
        cp (hl)
        jr nz,scx_validate_fail
        inc de
        inc hl
        djnz scx_validate_magic
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,scx_validate_fail
        ld a,(_asm_exec_ram + 8)
        cp 1
        jr nz,scx_validate_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,scx_validate_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,scx_validate_fail

        ; Convert complete length to payload length and enforce 16..9216.
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,scx_validate_fail
        push hl
        ld de,9216 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,scx_validate_fail

        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,scx_validate_fail
        or a
        ret
scx_validate_fail:
        scf
        ret

scx_expected_magic: defb "SCX1"

STANDARD_FLAG_RESULT_PENDING_HIGH: equ 0x02
RUNTIME_DRAFT_PROGRESS: equ 6
STANDARD_ACTION_QR_MODULES: equ 21
STANDARD_ACTION_QR_DATA_X: equ 43
STANDARD_ACTION_QR_DATA_Y: equ 11
standard_scqueue_name: defb 0x12,7,"SCQUEUE",0
standard_scnative_name: defb 0x12,8,"SCNATIVE"

standard_runtime_title:  defb "SCHOOLCALC / LEARN",0
standard_runtime_module_fallback: defb "LEARNING MODULE",0
standard_runtime_block_fallback: defb "This content block needs another reviewed renderer.",0
standard_runtime_qr_label: defb "QR",0
standard_runtime_top_label: defb "TOP",0
standard_runtime_back_label: defb "BACK",0
standard_runtime_page_up_label: defb "PGUP",0
standard_runtime_more_label: defb "MORE",0
standard_runtime_eom_label:  defb "EOM",0
standard_runtime_error_line_1: defb "Content unavailable.",0
standard_runtime_error_state: defb "Local state is missing or ambiguous. EXIT and reopen SchoolCalc.",0
standard_runtime_error_artifact: defb "The lesson is missing or damaged. Sync or reinstall it.",0
standard_runtime_error_module: defb "This module is not supported by the installed client.",0
standard_runtime_error_save: defb "Progress could not be saved. Existing state was preserved.",0
standard_action_qr_source:          defw 0
standard_action_qr_row:             defb 0
standard_action_qr_column:          defb 0
standard_action_qr_bytes_remaining: defb 0
standard_action_qr_byte:            defb 0
standard_action_qr_mask:            defb 0
standard_runtime_page_target:       defw 0

UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
RUNTIME_CONTENT_MUTABLE: equ 1
include "ui-renderer.asm"
include "input.asm"
include "crc16-ccitt.asm"
include "record-reader.asm"
include "runtime-content.asm"
include "runtime-assessment.asm"
include "generated/ui-standard-runtime-assets.inc"

end
