; SchoolCalc learner-profile and compact progress runtime.
;
; v0 owns only the learner-profile slice. It promotes a complete device-bound
; SCU1 from DSUSRNEW to DSUSERS, lists configured learners plus synthetic
; Guest, and persists the selected 16-bit learner key in alternating SCL1.
; An active learning session locks switching; its separately snapshotted key
; remains immutable until that session finishes.

include "ti86asm.inc"

PROFILE_MAX_RECORD_BYTES:  equ 512
PROFILE_MAX_RECORDS:       equ 16
PROGRESS_MAX_RECORD_BYTES: equ 4096
PROGRESS_MAX_RECENT:       equ 1
PROGRESS_MAX_FOLLOWUPS:    equ 2
PROGRESS_MAX_HISTORY:      equ 12
PROFILE_VISIBLE_ROWS:      equ 6
PROFILE_VIEW_CATALOG:      equ 1
PROFILE_VIEW_TUTOR:        equ 11
; A Catalog-owned entry to the selected learner's Profile. It is intentionally
; not a persisted user-facing destination: EXIT restores the Catalog root.
PROFILE_VIEW_USER:         equ 12
PROFILE_SWITCH_BLOCK_HIGH: equ 3
PROFILE_STAGE_NONE:        equ 0
PROFILE_STAGE_PROMOTED:    equ 1
PROFILE_STAGE_INVALID:     equ 2

org _asm_exec_ram

        ; _exec_assembly child programs use the TI-86's conventional execution
        ; envelope: NOP, entry jump, input kind, and title pointer.  Direct
        ; Asm( entry does not require it, which is why the shell has no such
        ; prefix.  SCX1 begins only after TI-OS's eight-byte envelope.
        nop
        jp profile_runtime_start
        defw 0
        defw profile_runtime_name
        defb "SCX1"
        defb 1
        defb 8                 ; closed registry code: learner-profile
        defb 0
        defw 0
        defw 0
        defw 0

profile_runtime_name: defb 0

profile_runtime_start:
        call profile_scx_validate_self
        jp c,profile_render_error
        call _runindicoff
        call sc_input_init
        call scstate_load
        jp c,profile_render_state_error
        call profile_detect_identity
        jp c,profile_render_identity_error
        call profile_promote_stage
        call progress_promote_stage
        call profile_open_canonical
        jr nc,profile_roster_ready
        ld a,(sc_record_error)
        or a
        jp nz,profile_render_roster_error
        ; A complete SCU1 envelope opened, but a field-level invariant failed.
        ; profile_validate_open returns the precise safe diagnostic in HL.
        jp profile_render_error
        xor a
        ld (profile_count),a
profile_roster_ready:
        call profile_normalize_selection
        jp c,profile_render_state_error
        call profile_focus_selected
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp PROFILE_VIEW_USER
        jp z,profile_open_user

profile_render:
        call _clrLCD
        call profile_render_header
        call profile_render_rows
        call profile_render_rail
        call profile_render_softkeys

profile_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,profile_cancel
        cp SC_SCAN_LEFT
        jp z,profile_cancel
        cp SC_SCAN_UP
        jp z,profile_move_up
        cp SC_SCAN_DOWN
        jp z,profile_move_down
        cp SC_SCAN_RIGHT
        jp z,profile_select_focus
        cp SC_SCAN_ENTER
        jp z,profile_select_focus
        cp SC_SCAN_F1
        jp z,profile_select_focus
        cp SC_SCAN_F2
        jp z,progress_open_view
        cp SC_SCAN_F5
        jp z,profile_select_guest
        jp profile_wait

; Back must return to a neutral shell route. Reusing the prior durable view
; can immediately relaunch Catalog or SCLEARN, making EXIT appear broken.
profile_cancel:
        ; View 12 means this picker was reached from Catalog's User action.
        ; Cancelling it returns to the stable Subject root rather than
        ; relaunching the temporary profile view.  The durable view itself is
        ; the marker—no volatile return flag may survive a child handoff.
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp PROFILE_VIEW_USER
        jr nz,profile_cancel_shell
        ld a,PROFILE_VIEW_CATALOG
        jr profile_cancel_store
profile_cancel_shell:
        xor a
profile_cancel_store:
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,profile_render_state_error
        ret

profile_move_down:
        ld a,(profile_focus)
        ld (profile_previous_focus),a
        ld b,a
        ld a,(profile_scroll)
        ld (profile_previous_scroll),a
        ld a,(profile_previous_focus)
        ld b,a
        ld a,(profile_count)
        cp b
        jp z,profile_wait
        ld a,b
        inc a
        ld (profile_focus),a
        ld b,a
        ld a,(profile_scroll)
        add a,PROFILE_VISIBLE_ROWS
        cp b
        jr nz,profile_move_done
        ld a,(profile_scroll)
        inc a
        ld (profile_scroll),a
profile_move_done:
        call profile_redraw_focus
        jp profile_wait

profile_move_up:
        ld a,(profile_focus)
        or a
        jp z,profile_wait
        ld (profile_previous_focus),a
        ld a,(profile_scroll)
        ld (profile_previous_scroll),a
        ld a,(profile_previous_focus)
        dec a
        ld (profile_focus),a
        ld b,a
        ld a,(profile_scroll)
        cp b
        jr c,profile_move_done
        jr z,profile_move_done
        ld a,b
        ld (profile_scroll),a
        jr profile_move_done

profile_select_focus:
        ld a,(profile_focus)
        ld b,a
        ld a,(profile_count)
        cp b
        jr z,profile_select_guest
        ld a,b
        call profile_key_at_index
        jp c,profile_render_roster_error
        jr profile_commit_selection

profile_select_guest:
        ld hl,0
        ld (profile_target_key),hl

profile_commit_selection:
        ld hl,(profile_target_key)
        ld de,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        or a
        sbc hl,de
        jr z,profile_open_catalog
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        and SCSTATE_FLAG_SESSION
        jp nz,profile_render_locked
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and PROFILE_SWITCH_BLOCK_HIGH
        jp nz,profile_render_locked
        ld hl,(profile_target_key)
        ld (scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET),hl
        call profile_reset_navigation
profile_open_catalog:
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        or SCSTATE_FLAG_LEARNER_SELECTED_HIGH
        ld (scstate_record + SCSTATE_FLAGS_OFFSET + 1),a
        ld a,PROFILE_VIEW_CATALOG
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,profile_render_state_error
        ret

; Catalog hierarchy indexes are profile-visible indexes. A profile switch
; invalidates that navigation context, so return to the Catalog root while
; preserving the committed Catalog slot/generation and durable queues.
profile_reset_navigation:
        ld a,PROFILE_VIEW_CATALOG
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        xor a
        ld hl,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld b,SCSTATE_CARD_FACE_OFFSET - SCSTATE_ARTIFACT_KEY_OFFSET
profile_reset_navigation_loop:
        ld (hl),a
        inc hl
        djnz profile_reset_navigation_loop
        ret

; Retired/nonexistent selections fall back to Guest only between sessions.
; During an active session the selected key remains untouched and the separate
; session key continues to own result attribution.
profile_normalize_selection:
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        ret z
        ld (profile_target_key),hl
        call profile_find_key
        ret nc
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        and SCSTATE_FLAG_SESSION
        ret nz
        ld hl,0
        ld (scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET),hl
        jp scstate_save

profile_focus_selected:
        xor a
        ld (profile_focus),a
        ld (profile_scroll),a
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jr z,profile_focus_guest
        ld (profile_target_key),hl
        call profile_find_key
        jr c,profile_focus_guest
        ld a,(profile_found_index)
        ld (profile_focus),a
        cp PROFILE_VISIBLE_ROWS
        ret c
        sub PROFILE_VISIBLE_ROWS - 1
        ld (profile_scroll),a
        ret
profile_focus_guest:
        ld a,(profile_count)
        ld (profile_focus),a
        cp PROFILE_VISIBLE_ROWS
        ret c
        sub PROFILE_VISIBLE_ROWS - 1
        ld (profile_scroll),a
        ret

; Return HL = a stable, zero-terminated label for the selected learner.
; A zero key is the explicit Guest identity.  Do not rely on profile_label's
; previous render value: list-row drawing reuses that scratch buffer and could
; otherwise put a different student's name in a subsequent view header.
profile_copy_selected_label:
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jr nz,profile_copy_selected_named
        ld hl,profile_guest
        or a
        ret
profile_copy_selected_named:
        ld (profile_target_key),hl
        call profile_find_key
        ret c
        ld a,(profile_found_index)
        call profile_item_at_index
        ret

; ---------------------------------------------------------------------------
; SCU1 validation and recoverable DSUSRNEW -> DSUSERS promotion.

profile_promote_stage:
        xor a
        ld (profile_stage_status),a
        ld hl,profile_stage_name
        ld de,profile_scu1_magic
        call sc_envelope_open
        jr nc,profile_stage_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        jr profile_stage_invalid
profile_stage_present:
        call profile_validate_open
        jr c,profile_stage_invalid
        call profile_copy_stage
        jr c,profile_stage_invalid
        ld a,PROFILE_STAGE_PROMOTED
        ld (profile_stage_status),a
        ret
profile_stage_invalid:
        ld a,PROFILE_STAGE_INVALID
        ld (profile_stage_status),a
        or a
        ret

profile_open_canonical:
        ld hl,profile_canonical_name
        ld de,profile_scu1_magic
        call sc_envelope_open
        ret c
        jp profile_validate_open

; The source is fully validated before the canonical name is touched. Require
; enough memory for a second complete record, then resolve the source again
; after every allocator operation because TI-OS may relocate variables.
profile_copy_stage:
        ld hl,(sc_record_length)
        ld (profile_copy_length),hl
        call _memchk
        or a
        jr nz,profile_copy_memory_ready
        ld de,(profile_copy_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jr c,profile_copy_fail
profile_copy_memory_ready:
        ld hl,profile_canonical_name
        call profile_delete_if_present
        ld hl,profile_canonical_name
        rst 0x20
        ld hl,(profile_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (profile_copy_dest_addr),hl
        ld (profile_copy_dest_page),a
        ld hl,profile_stage_name
        ld de,profile_scu1_magic
        call sc_envelope_open
        jr c,profile_copy_delete_target
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(profile_copy_dest_page)
        ld hl,(profile_copy_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(profile_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        call profile_open_canonical
        jr c,profile_copy_delete_target
        ld hl,(sc_record_length)
        ld de,(profile_copy_length)
        or a
        sbc hl,de
        jr nz,profile_copy_delete_target
        ld hl,profile_stage_name
        call profile_delete_if_present
        or a
        ret
profile_copy_delete_target:
        ld hl,profile_canonical_name
        call profile_delete_if_present
profile_copy_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; SCG1 validation and recoverable DSPRGNEW -> DSPROG promotion.

progress_promote_stage:
        xor a
        ld (progress_stage_status),a
        ld hl,progress_stage_name
        ld de,progress_scg1_magic
        call sc_envelope_open
        jr nc,progress_stage_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        jr progress_stage_invalid
progress_stage_present:
        call progress_validate_open
        jr c,progress_stage_invalid
        call progress_copy_stage
        jr c,progress_stage_invalid
        ld a,PROFILE_STAGE_PROMOTED
        ld (progress_stage_status),a
        ret
progress_stage_invalid:
        ld a,PROFILE_STAGE_INVALID
        ld (progress_stage_status),a
        or a
        ret

progress_open_canonical:
        ld hl,progress_canonical_name
        ld de,progress_scg1_magic
        call sc_envelope_open
        ret c
        jp progress_validate_open

progress_copy_stage:
        ld hl,(sc_record_length)
        ld (profile_copy_length),hl
        call _memchk
        or a
        jr nz,progress_copy_memory_ready
        ld de,(profile_copy_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jr c,progress_copy_fail
progress_copy_memory_ready:
        ld hl,progress_canonical_name
        call profile_delete_if_present
        ld hl,progress_canonical_name
        rst 0x20
        ld hl,(profile_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (profile_copy_dest_addr),hl
        ld (profile_copy_dest_page),a
        ld hl,progress_stage_name
        ld de,progress_scg1_magic
        call sc_envelope_open
        jr c,progress_copy_delete_target
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(profile_copy_dest_page)
        ld hl,(profile_copy_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(profile_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        call progress_open_canonical
        jr c,progress_copy_delete_target
        ld hl,(sc_record_length)
        ld de,(profile_copy_length)
        or a
        sbc hl,de
        jr nz,progress_copy_delete_target
        ld hl,progress_stage_name
        call profile_delete_if_present
        or a
        ret
progress_copy_delete_target:
        ld hl,progress_canonical_name
        call profile_delete_if_present
progress_copy_fail:
        scf
        ret

; Validate fixed SCU1 layout, bind it to DSID, and build bounded offset/key
; indexes for UI access. Labels remain in the immutable record.
profile_validate_open:
        ld hl,profile_error_roster_length
        ld (profile_validation_detail),hl
        ld hl,PROFILE_MAX_RECORD_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,profile_validation_fail
        ld hl,profile_error_roster_device
        ld (profile_validation_detail),hl
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(profile_device_length)
        cp b
        jp nz,profile_validation_fail
        inc de
        ld hl,profile_device_id
profile_validate_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,profile_validation_fail
        inc de
        inc hl
        djnz profile_validate_device_loop
        ld hl,profile_error_roster_generation
        ld (profile_validation_detail),hl
        ld hl,profile_generation_key
        ld b,10
profile_validate_generation_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc de
        inc hl
        djnz profile_validate_generation_loop
        ld hl,profile_generation_key
        call profile_validate_base32_key
        ret c
        call sc_record_read_byte
        ret c
        cp PROFILE_MAX_RECORDS + 1
        jp nc,profile_validation_fail
        ld (profile_count),a
        inc de
        ld (profile_records_offset),de
        ld hl,profile_error_roster_items
        ld (profile_validation_detail),hl
        xor a
        ld (profile_parse_index),a

profile_validate_item_loop:
        ld a,(profile_parse_index)
        ld b,a
        ld a,(profile_count)
        cp b
        jr z,profile_validate_items_done
        push de
        ld a,b
        add a,a
        ld l,a
        ld h,0
        ld bc,profile_offsets
        add hl,bc
        pop de
        ld (hl),e
        inc hl
        ld (hl),d
        call sc_record_read_byte
        ret c
        ld (profile_target_key),a
        inc de
        call sc_record_read_byte
        ret c
        ld (profile_target_key + 1),a
        inc de
        ld hl,(profile_target_key)
        ld a,h
        or l
        jp z,profile_validation_fail
        call profile_require_unique_key
        ret c
        call profile_store_parse_key
        call sc_record_read_byte
        ret c
        or a
        jp z,profile_validation_fail
        cp 21
        jp nc,profile_validation_fail
        ld (profile_label_remaining),a
        inc de
profile_validate_label_loop:
        call sc_record_read_byte
        ret c
        cp 0x20
        jp c,profile_validation_fail
        cp 0x7F
        jp nc,profile_validation_fail
        inc de
        ld a,(profile_label_remaining)
        dec a
        ld (profile_label_remaining),a
        jr nz,profile_validate_label_loop
        ld a,(profile_parse_index)
        inc a
        ld (profile_parse_index),a
        jr profile_validate_item_loop

profile_validate_items_done:
        ld hl,profile_error_roster_end
        ld (profile_validation_detail),hl
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,profile_validation_fail
        or a
        ret
profile_validation_fail:
        ld hl,(profile_validation_detail)
        scf
        ret

profile_require_unique_key:
        ld a,(profile_parse_index)
        or a
        ret z
        ld b,a
        ld hl,profile_keys
profile_unique_key_loop:
        ld a,(profile_target_key)
        cp (hl)
        jr nz,profile_unique_key_next
        inc hl
        ld a,(profile_target_key + 1)
        cp (hl)
        jp z,profile_validation_fail
        dec hl
profile_unique_key_next:
        inc hl
        inc hl
        djnz profile_unique_key_loop
        or a
        ret

profile_store_parse_key:
        ; DE is the immutable SCU1 record offset used by the caller for the
        ; following label-length read. Keep it while indexing page-zero keys.
        push de
        ld a,(profile_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld de,profile_keys
        add hl,de
        ld a,(profile_target_key)
        ld (hl),a
        inc hl
        ld a,(profile_target_key + 1)
        ld (hl),a
        pop de
        ret

; Validate the complete fixed SCG1 layout and index each profile. No staged
; projection can replace DSPROG unless every bounded field reaches body_end
; exactly and the record belongs to this calculator's DSID.
progress_validate_open:
        ld hl,PROGRESS_MAX_RECORD_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,progress_validation_fail
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(profile_device_length)
        cp b
        jp nz,progress_validation_fail
        inc de
        ld hl,profile_device_id
progress_validate_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,progress_validation_fail
        inc de
        inc hl
        djnz progress_validate_device_loop
        ld hl,progress_generation_key
        ld b,10
progress_validate_generation_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc de
        inc hl
        djnz progress_validate_generation_loop
        ld hl,progress_generation_key
        call profile_validate_base32_key
        ret c
        call sc_record_read_byte
        ret c
        cp PROFILE_MAX_RECORDS + 1
        jp nc,progress_validation_fail
        ld (progress_count),a
        inc de
        xor a
        ld (progress_parse_index),a

progress_validate_profile_loop:
        ld a,(progress_parse_index)
        ld b,a
        ld a,(progress_count)
        cp b
        jp z,progress_validate_profiles_done
        call progress_store_profile_offset
        ld hl,0
        call progress_store_followup_offset
        ld hl,0
        call progress_store_history_offset
        call progress_read_word_de
        ret c
        ld (profile_target_key),hl
        ld a,h
        or l
        jp z,progress_validation_fail
        call progress_require_unique_key
        ret c
        call progress_store_parse_key

        ld hl,28              ; seven u32 summary counters
        call progress_skip_de
        ret c
        call sc_record_read_byte
        ret c
        cp 101
        jr c,progress_score_valid
        cp 0xFF
        jp nz,progress_validation_fail
progress_score_valid:
        inc de
        ld b,10
        call progress_validate_printable
        ret c

        call sc_record_read_byte
        ret c
        cp PROGRESS_MAX_RECENT + 1
        jp nc,progress_validation_fail
        ld (progress_recent_count),a
        inc de
        or a
        jr z,progress_recent_done
        call progress_read_word_de
        ret c
        ld (progress_recent_correct),hl
        call progress_read_word_de
        ret c
        ld (progress_recent_total),hl
        ld a,h
        or l
        jp z,progress_validation_fail
        ld bc,(progress_recent_correct)
        or a
        sbc hl,bc
        jp c,progress_validation_fail
        call sc_record_read_byte
        ret c
        cp 101
        jp nc,progress_validation_fail
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp z,progress_validation_fail
        cp 4
        jp nc,progress_validation_fail
        inc de
        ld b,10
        call progress_validate_printable
        ret c
        call sc_record_read_byte
        ret c
        or a
        jp z,progress_validation_fail
        cp 13
        jp nc,progress_validation_fail
        ld b,a
        inc de
        call progress_validate_printable
        ret c
progress_recent_done:
        call sc_record_read_byte
        ret c
        cp PROGRESS_MAX_FOLLOWUPS + 1
        jp nc,progress_validation_fail
        ld (progress_loop_remaining),a
        inc de
        or a
        jr z,progress_followups_done
        push de
        pop hl
        call progress_store_followup_offset

progress_validate_followup_loop:
        ld hl,progress_action_key
        ld b,10
progress_validate_action_key_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc de
        inc hl
        djnz progress_validate_action_key_loop
        ld hl,progress_action_key
        call profile_validate_base32_key
        ret c
        call sc_record_read_byte
        ret c
        or a
        jp z,progress_validation_fail
        cp 7
        jp nc,progress_validation_fail
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp z,progress_validation_fail
        cp 5
        jp nc,progress_validation_fail
        inc de
        call progress_read_word_de
        ret c
        push de
        ld de,1001
        or a
        sbc hl,de
        pop de
        jp nc,progress_validation_fail
        call sc_record_read_byte
        ret c
        or a
        jp z,progress_validation_fail
        cp 21
        jp nc,progress_validation_fail
        ld b,a
        inc de
        call progress_validate_printable
        ret c
        ld a,(progress_loop_remaining)
        dec a
        ld (progress_loop_remaining),a
        jr nz,progress_validate_followup_loop
progress_followups_done:
        push de
        pop hl
        call progress_store_history_offset
        call sc_record_read_byte
        ret c
        cp PROGRESS_MAX_HISTORY + 1
        jp nc,progress_validation_fail
        ld (progress_loop_remaining),a
        xor a
        ld (progress_history_index),a
        inc de
progress_validate_history_loop:
        ld a,(progress_loop_remaining)
        or a
        jr z,progress_history_done
        call sc_record_read_byte       ; parent index or 0xFF root
        ret c
        cp 0xFF
        jr z,progress_history_parent_valid
        ld b,a
        ld a,(progress_history_index)
        cp b
        jp c,progress_validation_fail
        jp z,progress_validation_fail
progress_history_parent_valid:
        inc de
        call sc_record_read_byte       ; kind in low nibble, pending in bit 7
        ret c
        ld b,a
        and 0x70
        jp nz,progress_validation_fail
        ld a,b
        and 0x0F
        or a
        jp z,progress_validation_fail
        cp 7
        jp nc,progress_validation_fail
        inc de
        call sc_record_read_byte       ; score or 0xFF
        ret c
        cp 101
        jr c,progress_history_score_valid
        cp 0xFF
        jp nz,progress_validation_fail
progress_history_score_valid:
        inc de
        ld hl,4                        ; activity/completion u16 counters
        call progress_skip_de
        ret c
        call sc_record_read_byte       ; compact label
        ret c
        or a
        jp z,progress_validation_fail
        cp 13
        jp nc,progress_validation_fail
        ld b,a
        inc de
        call progress_validate_printable
        ret c
        ld a,(progress_history_index)
        inc a
        ld (progress_history_index),a
        ld a,(progress_loop_remaining)
        dec a
        ld (progress_loop_remaining),a
        jr progress_validate_history_loop
progress_history_done:
        ld a,(progress_parse_index)
        inc a
        ld (progress_parse_index),a
        jp progress_validate_profile_loop

progress_validate_profiles_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,progress_validation_fail
        or a
        ret
progress_validation_fail:
        scf
        ret

progress_store_profile_offset:
        ld a,(progress_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,progress_offsets
        add hl,bc
        ld (hl),e
        inc hl
        ld (hl),d
        ret

; HL = offset or zero.
progress_store_followup_offset:
        push de
        ld d,h
        ld e,l
        ld a,(progress_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,progress_followup_offsets
        add hl,bc
        ld (hl),e
        inc hl
        ld (hl),d
        pop de
        ret

; HL = offset of the per-profile history count byte, or zero.
progress_store_history_offset:
        push de
        ld d,h
        ld e,l
        ld a,(progress_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,progress_history_offsets
        add hl,bc
        ld (hl),e
        inc hl
        ld (hl),d
        pop de
        ret

progress_require_unique_key:
        ld a,(progress_parse_index)
        or a
        ret z
        ld b,a
        ld hl,progress_keys
progress_unique_key_loop:
        ld a,(profile_target_key)
        cp (hl)
        jr nz,progress_unique_key_next
        inc hl
        ld a,(profile_target_key + 1)
        cp (hl)
        jp z,progress_validation_fail
        dec hl
progress_unique_key_next:
        inc hl
        inc hl
        djnz progress_unique_key_loop
        or a
        ret

progress_store_parse_key:
        ld a,(progress_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,progress_keys
        add hl,bc
        ld a,(profile_target_key)
        ld (hl),a
        inc hl
        ld a,(profile_target_key + 1)
        ld (hl),a
        ret

; Read a little-endian u16 at DE, advance DE, return HL.
progress_read_word_de:
        call sc_record_read_byte
        ret c
        ld l,a
        inc de
        call sc_record_read_byte
        ret c
        ld h,a
        inc de
        or a
        ret

; Advance DE by HL without crossing the body/CRC boundary.
progress_skip_de:
        add hl,de
        jp c,progress_validation_fail
        ex de,hl
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp c,progress_validation_fail
        or a
        ret

; B printable ASCII bytes at DE; advances DE.
progress_validate_printable:
        call sc_record_read_byte
        ret c
        cp 0x20
        jp c,progress_validation_fail
        cp 0x7F
        jp nc,progress_validation_fail
        inc de
        djnz progress_validate_printable
        or a
        ret

; A = zero-based configured learner index. Return HL/key and cache target key.
profile_key_at_index:
        ld b,a
        ld a,(profile_count)
        cp b
        jr c,profile_key_invalid
        jr z,profile_key_invalid
        ld a,b
        add a,a
        ld l,a
        ld h,0
        ld de,profile_keys
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        push de
        pop hl
        ld (profile_target_key),hl
        or a
        ret
profile_key_invalid:
        scf
        ret

; target key -> found index, or carry when not present.
profile_find_key:
        xor a
        ld (profile_found_index),a
        ld a,(profile_count)
        ld (profile_loop_remaining),a
        ld hl,profile_keys
profile_find_key_loop:
        ld a,(profile_loop_remaining)
        or a
        jr z,profile_find_key_missing
        ld a,(profile_target_key)
        cp (hl)
        jr nz,profile_find_key_next
        inc hl
        ld a,(profile_target_key + 1)
        cp (hl)
        jr z,profile_find_key_found
        dec hl
profile_find_key_next:
        inc hl
        inc hl
        ld a,(profile_found_index)
        inc a
        ld (profile_found_index),a
        ld a,(profile_loop_remaining)
        dec a
        ld (profile_loop_remaining),a
        jr profile_find_key_loop
profile_find_key_found:
        or a
        ret
profile_find_key_missing:
        scf
        ret

; target key -> indexed SCG1 profile or carry.
progress_find_key:
        xor a
        ld (progress_found_index),a
        ld a,(progress_count)
        ld (progress_loop_remaining),a
        ld hl,progress_keys
progress_find_key_loop:
        ld a,(progress_loop_remaining)
        or a
        jr z,progress_find_key_missing
        ld a,(profile_target_key)
        cp (hl)
        jr nz,progress_find_key_next
        inc hl
        ld a,(profile_target_key + 1)
        cp (hl)
        jr z,progress_find_key_found
        dec hl
progress_find_key_next:
        inc hl
        inc hl
        ld a,(progress_found_index)
        inc a
        ld (progress_found_index),a
        ld a,(progress_loop_remaining)
        dec a
        ld (progress_loop_remaining),a
        jr progress_find_key_loop
progress_find_key_found:
        or a
        ret
progress_find_key_missing:
        scf
        ret

; A = configured index. Copy its validated label to profile_label and key to
; profile_target_key. Canonical SCU1 must still be open.
profile_item_at_index:
        ld (profile_item_index),a
        call profile_key_at_index
        ret c
        ld a,(profile_item_index)
        add a,a
        ld l,a
        ld h,0
        ld de,profile_offsets
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        inc de
        inc de
        call sc_record_read_byte
        ret c
        ld (profile_label_remaining),a
        inc de
        ld hl,profile_label
profile_copy_label_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        ld a,(profile_label_remaining)
        dec a
        ld (profile_label_remaining),a
        jr nz,profile_copy_label_loop
        ld (hl),0
        or a
        ret

profile_validate_base32_key:
        ld b,10
profile_base32_loop:
        ld a,(hl)
        cp '2'
        jr c,profile_base32_alpha
        cp '7' + 1
        jr c,profile_base32_next
profile_base32_alpha:
        cp 'A'
        jp c,profile_validation_fail
        cp 'Z' + 1
        jp nc,profile_validation_fail
profile_base32_next:
        inc hl
        djnz profile_base32_loop
        or a
        ret

profile_delete_if_present:
        rst 0x20
        rst 0x10
        ret c
        call _delvar
        ret

; ---------------------------------------------------------------------------
; Provisioned identity validation. SCU1 is never accepted for another device.

profile_detect_identity:
        xor a
        ld (profile_device_length),a
        ld hl,profile_device_id
        ld b,17
profile_identity_clear:
        ld (hl),a
        inc hl
        djnz profile_identity_clear
        ld hl,profile_identity_name
        ld de,profile_sci1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,profile_field_schema
        call sc_map_find_literal
        ret c
        ld hl,profile_identity_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,profile_identity_fail
        ld de,(sc_record_root_offset)
        ld hl,profile_field_device_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,profile_device_id
        ld b,0
profile_identity_copy:
        ld a,(hl)
        or a
        jr z,profile_identity_length_ready
        ld c,a
        ld a,b
        cp 16
        jr nc,profile_identity_fail
        ld a,c
        cp '0'
        jr c,profile_identity_fail
        cp '9' + 1
        jr c,profile_identity_character_ok
        cp 'A'
        jr c,profile_identity_fail
        cp 'Z' + 1
        jr nc,profile_identity_fail
profile_identity_character_ok:
        ld a,c
        ld (de),a
        inc de
        inc hl
        inc b
        jr profile_identity_copy
profile_identity_length_ready:
        ld a,b
        cp 4
        jr c,profile_identity_fail
        ld (profile_device_length),a
        or a
        ret
profile_identity_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Full 128x64 SchoolCalc profile UI.

profile_render_header:
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,profile_title
        ld b,1
        ld c,1
        call ui_draw_text
        ld a,(profile_stage_status)
        cp PROFILE_STAGE_INVALID
        ld hl,profile_context_sync
        jr z,profile_header_context_ready
        call profile_copy_selected_label
        jr nc,profile_header_context_ready
        ld hl,profile_context_user
profile_header_context_ready:
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

profile_render_rows:
        xor a
        ld (profile_render_row),a
profile_render_row_loop:
        ld a,(profile_render_row)
        cp PROFILE_VISIBLE_ROWS
        ret z
        ld b,a
        ld a,(profile_scroll)
        add a,b
        ld (profile_render_index),a
        ld b,a
        ld a,(profile_count)
        inc a
        cp b
        ret c
        ret z
        ld a,(profile_render_row)
        ld b,a
        add a,a
        add a,b
        add a,a
        add a,10
        ld (profile_render_y),a
        ld a,(profile_render_index)
        ld b,a
        ld a,(profile_focus)
        cp b
        jr nz,profile_render_selected_marker
        ld hl,profile_chevron
        ld b,0
        ld a,(profile_render_y)
        ld c,a
        call ui_draw_text
profile_render_selected_marker:
        ld a,(profile_render_index)
        ld b,a
        ld a,(profile_count)
        cp b
        jr z,profile_render_guest_item
        ld a,b
        call profile_item_at_index
        jp c,profile_render_roster_error
        ld hl,profile_label
        jr profile_render_item_ready
profile_render_guest_item:
        ld hl,0
        ld (profile_target_key),hl
        ld hl,profile_guest
profile_render_item_ready:
        ld (profile_render_label),hl
        ld hl,(profile_target_key)
        ld de,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        or a
        sbc hl,de
        jr nz,profile_render_label_ready
        ld hl,profile_selected_marker
        ld b,4
        ld a,(profile_render_y)
        ld c,a
        call ui_draw_text
profile_render_label_ready:
        ld hl,(profile_render_label)
        ld b,9
        ld a,(profile_render_y)
        ld c,a
        call ui_draw_text
        ld a,(profile_render_row)
        inc a
        ld (profile_render_row),a
        jp profile_render_row_loop

; Cursor-only moves redraw two tiny chevron cells. When scrolling changes the
; visible row mapping, redraw only the list body—not the header or softkeys.
; This prevents the full-screen flash that made profile selection unpleasant
; on physical TI-86 LCDs.
profile_redraw_focus:
        ld a,(profile_previous_scroll)
        ld b,a
        ld a,(profile_scroll)
        cp b
        jr nz,profile_redraw_body

        ld a,(profile_previous_focus)
        sub b
        call profile_row_y_from_a
        ld c,a
        call ui_mode_clear
        ld b,0
        ld d,4
        ld e,5
        call ui_fill_rect

        ld a,(profile_focus)
        ld b,a
        ld a,(profile_scroll)
        ld c,a
        ld a,b
        sub c
        call profile_row_y_from_a
        ld c,a
        call ui_mode_set
        call ui_select_compact
        ld hl,profile_chevron
        ld b,0
        jp ui_draw_text

profile_row_y_from_a:
        ld b,a
        add a,a
        add a,b
        add a,a
        add a,10
        ret

profile_redraw_body:
        call ui_mode_clear
        ld b,0
        ld c,9
        ld d,128
        ld e,46
        call ui_fill_rect
        call ui_mode_set
        call ui_select_compact
        call profile_render_rows
        jp profile_render_rail

profile_render_rail:
        call ui_mode_set
        ld b,127
        ld c,9
        ld d,1
        ld e,46
        call ui_fill_rect
        ld a,(profile_scroll)
        ld b,a
        add a,a
        add a,b
        add a,9
        ld c,a
        ld b,125
        ld d,3
        ld e,8
        jp ui_fill_rect

profile_render_softkeys:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld b,26
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,profile_select_label
        ld b,1
        ld c,57
        call ui_draw_text
        ld hl,profile_guest_label
        ld b,105
        ld c,57
        call ui_draw_text
        ld hl,profile_progress_label
        ld b,31
        ld c,57
        call ui_draw_text
        jp ui_mode_set

; ---------------------------------------------------------------------------
; Compact, learner-keyed My Progress view.

progress_open_view:
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jp z,progress_render_guest
        ld (profile_target_key),hl
        call progress_open_canonical
        jr nc,progress_canonical_ready
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp z,progress_render_unavailable
        jp progress_render_invalid
progress_canonical_ready:
        ; Validation walks every SCG1 profile and uses profile_target_key as a
        ; bounded parsing scratch word. Restore the durable selection before
        ; resolving the projection; otherwise My Progress would always show
        ; the final record in DSPROG rather than the learner who opened it.
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld (profile_target_key),hl
        call progress_find_key
        jp c,progress_render_unavailable
        call profile_copy_selected_label
        jp c,progress_render_unavailable
        xor a
        ld (progress_history_focus),a

progress_render:
        call _clrLCD
        ld hl,progress_title
        ld de,profile_label
        call profile_render_message_header
        call ui_mode_set
        call ui_select_compact
        call progress_load_history_focus
        jr c,progress_render_overall

        call ui_select_compact
        ld hl,profile_label
        ld b,2
        ld c,10
        call ui_draw_text
        call ui_select_compact
        ld hl,progress_type_label
        ld b,2
        ld c,19
        call ui_draw_text
        ld a,(progress_history_kind)
        call progress_set_kind_char
        ld b,24
        ld c,19
        call ui_draw_text
        ld a,(progress_history_score)
        call progress_format_percent
        ld c,19
        call progress_draw_value_right

        ld hl,progress_activities_short
        ld b,2
        ld c,26
        call ui_draw_text
        ld hl,(progress_history_activities)
        call progress_format_small
        ld b,25
        ld c,26
        call ui_draw_text
        ld hl,progress_completed_short
        ld b,58
        ld c,26
        call ui_draw_text
        ld hl,(progress_history_completed)
        call progress_format_small
        ld b,88
        ld c,26
        call ui_draw_text
        call progress_render_history_overview
        jr progress_render_finish

progress_render_overall:
        ld hl,progress_score_label
        ld b,2
        ld c,13
        call ui_draw_text
        call progress_selected_offset
        ld hl,30
        add hl,de
        ex de,hl
        call sc_record_read_byte
        jp c,progress_render_invalid
        call progress_format_percent
        ld c,13
        call progress_draw_value_right
        ld hl,progress_activities_label
        ld b,2
        ld c,25
        call ui_draw_text
        ld a,22
        call progress_format_counter
        ld c,25
        call progress_draw_value_right
        ld hl,progress_completed_label
        ld b,2
        ld c,37
        call ui_draw_text
        ld a,18
        call progress_format_counter
        ld c,37
        call progress_draw_value_right
progress_render_finish:
        call progress_copy_followup_label
        call progress_render_separator

progress_wait:
        call sc_input_wait
        cp SC_SCAN_F1
        jp z,progress_begin_followup
        cp SC_SCAN_F5
        jp z,progress_open_picker
        cp SC_SCAN_LEFT
        jp z,progress_history_move_left
        cp SC_SCAN_RIGHT
        jp z,progress_history_move_right
        cp SC_SCAN_UP
        jp z,progress_history_move_up
        cp SC_SCAN_DOWN
        jp z,progress_history_move_down
        cp SC_SCAN_EXIT
        jp z,progress_return_profiles
        jp progress_wait

progress_history_move_left:
        ld a,(progress_history_focus)
        or a
        jp z,progress_wait
        dec a
        ld (progress_history_focus),a
        jp progress_render

progress_history_move_right:
        ld a,(progress_history_focus)
        inc a
        ld b,a
        ld a,(progress_history_count)
        cp b
        jp c,progress_wait
        jp z,progress_wait
        ld a,b
        ld (progress_history_focus),a
        jp progress_render

progress_history_move_up:
        ld a,(progress_history_focus)
        cp 6
        jp c,progress_wait
        sub 6
        ld (progress_history_focus),a
        jp progress_render

progress_history_move_down:
        ld a,(progress_history_focus)
        add a,6
        ld b,a
        ld a,(progress_history_count)
        cp b
        jp c,progress_wait
        jp z,progress_wait
        ld a,b
        ld (progress_history_focus),a
        jp progress_render

progress_begin_followup:
        ld a,(progress_followup_actionable)
        or a
        jp z,progress_wait
        ld a,PROFILE_VIEW_TUTOR
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,profile_render_state_error
        ret

progress_return_profiles:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp PROFILE_VIEW_USER
        jr nz,progress_return_picker
        ld a,PROFILE_VIEW_CATALOG
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,profile_render_state_error
        ret
progress_return_picker:
        call profile_open_canonical
        jp c,profile_render_roster_error
        jp profile_render

; Catalog enters this compact profile landing page. My Progress already holds
; the learner's most useful recent evidence; F5 exposes the explicit switcher
; without making every normal launch pay for an identity decision.
profile_open_user:
        jp progress_open_view

progress_open_picker:
        call profile_open_canonical
        jp c,profile_render_roster_error
        call profile_focus_selected
        jp profile_render

progress_render_guest:
        ld hl,progress_guest_line_1
        ld (progress_message_line_1),hl
        ld hl,progress_guest_line_2
        ld (progress_message_line_2),hl
        ld de,profile_guest
        jr progress_render_message
progress_render_unavailable:
        ld hl,progress_unavailable_line_1
        ld (progress_message_line_1),hl
        ld hl,progress_unavailable_line_2
        ld (progress_message_line_2),hl
        ld de,profile_context_sync
        jr progress_render_message
progress_render_invalid:
        ld hl,progress_invalid_line_1
        ld (progress_message_line_1),hl
        ld hl,progress_invalid_line_2
        ld (progress_message_line_2),hl
        ld de,profile_context_stop
progress_render_message:
        xor a
        ld (progress_followup_actionable),a
        push de
        call _clrLCD
        pop de
        ld hl,progress_title
        call profile_render_message_header
        call ui_mode_set
        call ui_select_compact
        ld hl,(progress_message_line_1)
        ld b,2
        ld c,18
        call ui_draw_text
        ld hl,(progress_message_line_2)
        ld b,2
        ld c,34
        call ui_draw_text
        call progress_render_separator
progress_message_wait:
        call sc_input_wait
        cp SC_SCAN_LEFT
        jp z,progress_return_profiles
        cp SC_SCAN_EXIT
        jp z,progress_return_profiles
        cp SC_SCAN_ENTER
        jp z,progress_return_profiles
        jp progress_message_wait

; Load the focused compact history node into inspector scratch. Carry means
; the selected learner has evidence but no curriculum-classified history.
progress_load_history_focus:
        call progress_history_offset
        ld a,d
        or e
        scf
        ret z
        call sc_record_read_byte
        ret c
        ld (progress_history_count),a
        or a
        scf
        ret z
        ld b,a
        ld a,(progress_history_focus)
        cp b
        jr c,progress_history_focus_valid
        xor a
        ld (progress_history_focus),a
progress_history_focus_valid:
        inc de
        ld a,(progress_history_focus)
        ld (progress_history_scan),a
progress_history_seek_loop:
        ld a,(progress_history_scan)
        or a
        jr z,progress_history_read_node
        call progress_history_advance
        ret c
        ld a,(progress_history_scan)
        dec a
        ld (progress_history_scan),a
        jr progress_history_seek_loop
progress_history_read_node:
        call sc_record_read_byte
        ret c
        inc de
        call sc_record_read_byte
        ret c
        ld (progress_history_kind),a
        inc de
        call sc_record_read_byte
        ret c
        ld (progress_history_score),a
        inc de
        call progress_read_word_de
        ret c
        ld (progress_history_activities),hl
        call progress_read_word_de
        ret c
        ld (progress_history_completed),hl
        call sc_record_read_byte
        ret c
        ld (profile_label_remaining),a
        inc de
        ld hl,profile_label
progress_history_copy_label:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        ld a,(profile_label_remaining)
        dec a
        ld (profile_label_remaining),a
        jr nz,progress_history_copy_label
        ld (hl),0
        or a
        ret

; DE = one node start. Return DE = next variable-length node.
progress_history_advance:
        ld hl,7
        add hl,de
        ex de,hl
        call sc_record_read_byte
        ret c
        ld l,a
        ld h,0
        add hl,de
        inc hl
        ex de,hl
        or a
        ret

progress_history_offset:
        ld a,(progress_found_index)
        add a,a
        ld l,a
        ld h,0
        ld de,progress_history_offsets
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ret

progress_set_kind_char:
        and 0x0F
        dec a
        ld e,a
        ld d,0
        ld hl,progress_kind_chars
        add hl,de
        ld a,(hl)
        ld (progress_kind_char_buffer),a
        xor a
        ld (progress_kind_char_buffer + 1),a
        ld hl,progress_kind_char_buffer
        ret

; Twelve compact topology cells keep the complete bounded set visible. The
; focused cell is inverted; kind initials carry semantic level, and ! marks
; evidence still pending reconciliation.
progress_render_history_overview:
        call progress_history_offset
        inc de
        ld (progress_history_render_offset),de
        ld a,(progress_history_count)
        ld (progress_loop_remaining),a
        xor a
        ld (progress_history_render_index),a
        ld (progress_history_render_column),a
        ld a,2
        ld (progress_history_render_x),a
        ld a,36
        ld (progress_history_render_y),a
progress_history_render_loop:
        ld a,(progress_loop_remaining)
        or a
        ret z
        ld de,(progress_history_render_offset)
        push de
        ld hl,1
        add hl,de
        ex de,hl
        call sc_record_read_byte
        jp c,progress_render_invalid
        ld (progress_history_render_kind),a
        pop de
        call progress_history_advance
        jp c,progress_render_invalid
        ld (progress_history_render_offset),de

        ld a,(progress_history_render_index)
        ld b,a
        ld a,(progress_history_focus)
        cp b
        jr nz,progress_history_cell_text
        call ui_mode_set
        ld a,(progress_history_render_x)
        ld b,a
        ld a,(progress_history_render_y)
        ld c,a
        ld d,18
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        jr progress_history_cell_draw
progress_history_cell_text:
        call ui_mode_set
progress_history_cell_draw:
        ld a,(progress_history_render_kind)
        call progress_set_kind_char
        ld a,(progress_history_render_x)
        add a,6
        ld b,a
        ld a,(progress_history_render_y)
        inc a
        ld c,a
        call ui_draw_text
        ld a,(progress_history_render_kind)
        and 0x80
        jr z,progress_history_cell_done
        ld hl,progress_pending_char
        ld a,(progress_history_render_x)
        add a,13
        ld b,a
        ld a,(progress_history_render_y)
        inc a
        ld c,a
        call ui_draw_text
progress_history_cell_done:
        call ui_mode_set
        ld a,(progress_history_render_index)
        inc a
        ld (progress_history_render_index),a
        ld a,(progress_loop_remaining)
        dec a
        ld (progress_loop_remaining),a
        ld a,(progress_history_render_column)
        inc a
        cp 6
        jr z,progress_history_next_row
        ld (progress_history_render_column),a
        ld a,(progress_history_render_x)
        add a,21
        ld (progress_history_render_x),a
        jp progress_history_render_loop
progress_history_next_row:
        xor a
        ld (progress_history_render_column),a
        ld a,2
        ld (progress_history_render_x),a
        ld a,46
        ld (progress_history_render_y),a
        jp progress_history_render_loop

progress_render_separator:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ; A Profile opened from Catalog always offers its switcher, even when
        ; no adaptive follow-up is available for this learner. View 12 is the
        ; durable route marker, so no volatile child-return flag is needed.
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp PROFILE_VIEW_USER
        jr nz,progress_separator_tutor
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
progress_separator_tutor:
        ld a,(progress_followup_actionable)
        or a
        jr z,progress_separator_labels
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,progress_tutor_label
        ld b,3
        ld c,57
        call ui_draw_text
        call ui_mode_set
progress_separator_labels:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp PROFILE_VIEW_USER
        ret nz
        call ui_mode_clear
        call ui_select_compact
        ld hl,progress_switch_label
        ld b,104
        ld c,57
        call ui_draw_text
        jp ui_mode_set

progress_draw_value_right:
        ld d,124
        jp ui_draw_text_right

; A = summary counter offset from the selected profile record.
progress_format_counter:
        ld (progress_counter_offset),a
        call progress_selected_offset
        ld a,(progress_counter_offset)
        ld l,a
        ld h,0
        add hl,de
        ex de,hl
        call progress_read_counter
        jp progress_format_small

; Read u32 at DE, clamp values above 999 to sentinel 1000.
progress_read_counter:
        call progress_read_word_de
        ret c
        ld (progress_counter_low),hl
        call progress_read_word_de
        ret c
        ld a,h
        or l
        jr nz,progress_counter_large
        ld hl,(progress_counter_low)
        push hl
        ld de,1000
        or a
        sbc hl,de
        pop hl
        ret c
progress_counter_large:
        ld hl,1000
        or a
        ret

progress_format_percent:
        cp 0xFF
        jr z,progress_format_none
        ld l,a
        ld h,0
        call progress_format_small
        ld de,(progress_number_end)
        ld a,'%'
        ld (de),a
        inc de
        xor a
        ld (de),a
        ld hl,progress_number_buffer
        ret
progress_format_none:
        ld hl,progress_none_value
        ret

; HL = 0..1000. Returns HL -> NUL-terminated decimal (1000 => "999+").
progress_format_small:
        push hl
        ld de,1000
        or a
        sbc hl,de
        pop hl
        jr c,progress_format_digits
        ld hl,progress_large_value
        ret
progress_format_digits:
        ld de,progress_number_buffer
        xor a
        ld (progress_digit_started),a
        ld bc,100
        call progress_emit_digit
        ld bc,10
        call progress_emit_digit
        ld a,l
        add a,'0'
        ld (de),a
        inc de
        xor a
        ld (de),a
        ld (progress_number_end),de
        ld hl,progress_number_buffer
        ret

; Divide HL by BC through at most nine subtractions and emit non-leading digit.
progress_emit_digit:
        xor a
progress_emit_digit_loop:
        or a
        sbc hl,bc
        jr c,progress_emit_digit_done
        inc a
        jr progress_emit_digit_loop
progress_emit_digit_done:
        add hl,bc
        ld b,a
        ld a,(progress_digit_started)
        or b
        ret z
        ld a,1
        ld (progress_digit_started),a
        ld a,b
        add a,'0'
        ld (de),a
        inc de
        ret

progress_selected_offset:
        ld a,(progress_found_index)
        add a,a
        ld l,a
        ld h,0
        ld de,progress_offsets
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ret

progress_copy_followup_label:
        xor a
        ld (progress_followup_actionable),a
        ld a,(progress_found_index)
        add a,a
        ld l,a
        ld h,0
        ld de,progress_followup_offsets
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld a,d
        or e
        scf
        ret z
        ld hl,progress_selected_action_key
        ld b,10
progress_copy_action_key_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        djnz progress_copy_action_key_loop
        call sc_record_read_byte
        ret c
        ld b,a
        inc de
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        ld a,b
        cp 5                       ; remediation
        jr nz,progress_action_checked
        ld a,c
        cp 2                       ; requires_connection
        jr nz,progress_action_checked
        ld a,1
        ld (progress_followup_actionable),a
progress_action_checked:
        ld hl,2                    ; priority
        add hl,de
        ex de,hl
        call sc_record_read_byte
        ret c
        or a
        scf
        ret z
        ld (profile_label_remaining),a
        inc de
        ld hl,profile_label
progress_copy_followup_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        ld a,(profile_label_remaining)
        dec a
        ld (profile_label_remaining),a
        jr nz,progress_copy_followup_loop
        ld (hl),0
        or a
        ret

profile_render_locked:
        call _clrLCD
        ld hl,profile_locked_title
        ld de,profile_context_user
        call profile_render_message_header
        call ui_mode_set
        call ui_select_compact
        ld hl,profile_locked_line_1
        ld b,2
        ld c,15
        call ui_draw_text
        ld hl,profile_locked_line_2
        ld b,2
        ld c,29
        call ui_draw_text
        ld hl,profile_locked_line_3
        ld b,2
        ld c,43
        call ui_draw_text
        call profile_render_ok_softkey
profile_locked_wait:
        call sc_input_wait
        cp SC_SCAN_ENTER
        jp z,profile_render
        cp SC_SCAN_F1
        jp z,profile_render
        cp SC_SCAN_EXIT
        jp z,profile_render
        jp profile_locked_wait

profile_render_state_error:
        ld hl,profile_error_state
        jr profile_render_error
profile_render_identity_error:
        ld hl,profile_error_identity
        jr profile_render_error
profile_render_roster_error:
        ld hl,profile_error_roster
        jr profile_render_error
profile_render_runtime_error:
        ld hl,profile_error_runtime
profile_render_error:
        ld (profile_error_detail),hl
        call _clrLCD
        ld hl,profile_error_title
        ld de,profile_context_stop
        call profile_render_message_header
        call ui_mode_set
        call ui_select_compact
        ld hl,profile_error_line_1
        ld b,2
        ld c,15
        call ui_draw_text
        ld hl,(profile_error_detail)
        ld b,2
        ld c,29
        call ui_draw_text
        ld hl,profile_error_line_3
        ld b,2
        ld c,43
        call ui_draw_text
        call profile_render_ok_softkey
profile_error_wait:
        call sc_input_wait
        cp SC_SCAN_ENTER
        ret z
        cp SC_SCAN_F1
        ret z
        cp SC_SCAN_EXIT
        ret z
        jp profile_error_wait

profile_render_message_header:
        ld (profile_header_title),hl
        ld (profile_header_context),de
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,(profile_header_title)
        ld b,1
        ld c,1
        call ui_draw_text
        ld hl,(profile_header_context)
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

profile_render_ok_softkey:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,profile_ok_label
        ld b,9
        ld c,57
        call ui_draw_text
        jp ui_mode_set

; Validate this fixed runtime image before reading or mutating any variable.
profile_scx_validate_self:
        ld a,(_asm_exec_ram)
        or a
        jp nz,profile_scx_fail_header
        ld a,(_asm_exec_ram + 1)
        cp 0xC3
        jp nz,profile_scx_fail_header
        ld hl,(_asm_exec_ram + 2)
        ld de,_asm_exec_ram + 22
        or a
        sbc hl,de
        jp nz,profile_scx_fail_header
        ld hl,_asm_exec_ram + 8
        ld de,profile_scx_magic
        ld b,4
profile_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jp nz,profile_scx_fail_magic
        inc de
        inc hl
        djnz profile_scx_magic_loop
        ld a,(_asm_exec_ram + 12)
        cp 1
        jp nz,profile_scx_fail_version
        ld a,(_asm_exec_ram + 13)
        cp 8
        jp nz,profile_scx_fail_version
        ld a,(_asm_exec_ram + 14)
        or a
        jp nz,profile_scx_fail_version
        ld hl,(_asm_exec_ram + 19)
        ld a,h
        or l
        jr nz,profile_scx_fail_version
        ld bc,(_asm_exec_ram + 15)
        push bc
        pop hl
        ld de,21
        or a
        sbc hl,de
        jp c,profile_scx_fail_bounds
        push hl
        ld de,8192 - 21
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jp c,profile_scx_fail_bounds
        ; TI-OS executes this child in the shared assembly window, which it
        ; may use while loading and calling it. The full SCX payload CRC is
        ; therefore verified by SCHLCALC against the immutable Program
        ; variable before this call, not against mutable execution RAM here.
        or a
        ret
profile_scx_fail_header:
        ld hl,profile_error_runtime_header
        jr profile_scx_fail
profile_scx_fail_magic:
        ld hl,profile_error_runtime_magic
        jr profile_scx_fail
profile_scx_fail_version:
        ld hl,profile_error_runtime_version
        jr profile_scx_fail
profile_scx_fail_bounds:
        ld hl,profile_error_runtime_bounds
        jr profile_scx_fail
profile_scx_fail:
        scf
        ret

profile_stage_status:      defb 0
profile_device_length:     defb 0
profile_device_id:         defs 17,0
profile_generation_key:    defs 10,0
profile_count:             defb 0
profile_records_offset:    defw 0
profile_offsets:           defs 32,0
profile_keys:              defs 32,0
profile_parse_index:       defb 0
profile_label_remaining:   defb 0
profile_loop_remaining:    defb 0
profile_found_index:       defb 0
profile_item_index:        defb 0
profile_target_key:        defw 0
profile_focus:             defb 0
profile_scroll:            defb 0
profile_previous_focus:    defb 0
profile_previous_scroll:   defb 0
profile_render_row:        defb 0
profile_render_index:      defb 0
profile_render_y:          defb 0
profile_render_label:      defw 0
profile_label:             defs 21,0
profile_copy_length:       defw 0
profile_copy_dest_addr:    defw 0
profile_copy_dest_page:    defb 0
profile_error_detail:      defw 0
profile_validation_detail: defw 0
profile_header_title:      defw 0
profile_header_context:    defw 0
progress_stage_status:     defb 0
progress_generation_key:  defs 10,0
progress_count:            defb 0
progress_offsets:          defs 32,0
progress_followup_offsets: defs 32,0
progress_history_offsets:  defs 32,0
progress_keys:             defs 32,0
progress_parse_index:      defb 0
progress_loop_remaining:   defb 0
progress_recent_count:     defb 0
progress_recent_correct:   defw 0
progress_recent_total:     defw 0
progress_history_index:    defb 0
progress_history_focus:    defb 0
progress_history_count:    defb 0
progress_history_scan:     defb 0
progress_history_kind:     defb 0
progress_history_score:    defb 0
progress_history_activities:defw 0
progress_history_completed:defw 0
progress_history_render_offset:defw 0
progress_history_render_index:defb 0
progress_history_render_column:defb 0
progress_history_render_kind:defb 0
progress_history_render_x: defb 0
progress_history_render_y: defb 0
progress_kind_char_buffer: defs 2,0
progress_action_key:       defs 10,0
progress_selected_action_key:defs 10,0
progress_followup_actionable:defb 0
progress_found_index:      defb 0
progress_counter_offset:   defb 0
progress_counter_low:      defw 0
progress_digit_started:    defb 0
progress_number_end:       defw 0
progress_number_buffer:    defs 8,0
progress_message_line_1:   defw 0
progress_message_line_2:   defw 0
profile_scx_magic:         defb "SCX1"
profile_sci1_magic:        defb "SCI1"
profile_scu1_magic:        defb "SCU1"
progress_scg1_magic:       defb "SCG1"
profile_field_schema:      defb "schema",0
profile_field_device_id:   defb "deviceId",0
profile_identity_schema:   defb "school.calc.device-identity/v1",0

profile_title:             defb "Who is studying?",0
profile_context_user:      defb "USER",0
profile_context_sync:      defb "SYNC!",0
profile_context_stop:      defb "STOP",0
profile_guest:             defb "Guest",0
profile_chevron:           defb ">",0
profile_selected_marker:   defb "*",0
profile_select_label:      defb "SELECT",0
profile_guest_label:       defb "GUEST",0
profile_progress_label:    defb "PROG",0
profile_ok_label:          defb "OK",0
profile_locked_title:      defb "Profile locked",0
profile_locked_line_1:     defb "Work is still active.",0
profile_locked_line_2:     defb "Finish or save it",0
profile_locked_line_3:     defb "before switching.",0
; Error strings are intentionally compact: SCPROF shares an 8 KiB TI-OS child
; execution window with every other runtime. The stable title/detail/action
; structure remains clear without spending lesson-content memory on prose.
profile_error_title:       defb "PROFILE ERROR",0
profile_error_line_1:      defb "DATA IS SAFE.",0
profile_error_line_3:      defb "SYNC / RETRY.",0
profile_error_state:       defb "STATE ERROR.",0
profile_error_identity:    defb "NO DEVICE ID.",0
profile_error_roster:      defb "ROSTER ERROR.",0
profile_error_roster_length:defb "ROSTER LENGTH.",0
profile_error_roster_device:defb "ROSTER DEVICE.",0
profile_error_roster_generation:defb "ROSTER KEY.",0
profile_error_roster_items:defb "ROSTER ITEM.",0
profile_error_roster_end: defb "ROSTER END.",0
profile_error_runtime:     defb "RUNTIME ERROR.",0
profile_error_runtime_header:defb "RUNTIME HEADER.",0
profile_error_runtime_magic:defb "RUNTIME MAGIC.",0
profile_error_runtime_version:defb "RUNTIME VERSION.",0
profile_error_runtime_bounds:defb "RUNTIME BOUNDS.",0

progress_title:            defb "My Progress",0
progress_score_label:      defb "Score",0
progress_activities_label: defb "Activity",0
progress_completed_label:  defb "Done",0
progress_activities_short: defb "A",0
progress_completed_short:  defb "D",0
progress_type_label:       defb "Type",0
progress_tutor_label:      defb "TUTOR",0
progress_switch_label:     defb "SWITCH",0
progress_none_value:       defb "--",0
progress_large_value:      defb "999+",0
progress_pending_char:     defb "!",0
progress_kind_chars:       defb "#SCULM"
progress_guest_line_1:     defb "Guest work is local.",0
progress_guest_line_2:     defb "Progress is not saved.",0
progress_unavailable_line_1:defb "No progress snapshot.",0
progress_unavailable_line_2:defb "Connect and sync.",0
progress_invalid_line_1:   defb "Progress is unreadable.",0
progress_invalid_line_2:   defb "Old data stays safe.",0

profile_identity_name:     defb 0x0C,4,"DSID",0,0,0,0
profile_stage_name:        defb 0x0C,8,"DSUSRNEW"
profile_canonical_name:    defb 0x0C,7,"DSUSERS",0
progress_stage_name:       defb 0x0C,8,"DSPRGNEW"
progress_canonical_name:   defb 0x0C,6,"DSPROG",0,0

include "crc16-ccitt.asm"
include "record-reader.asm"
include "runtime-state.asm"
UI_RENDER_PROFILE_FULL: equ 0
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/ui-profile-runtime-assets.inc"

end
