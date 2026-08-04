; SchoolCalc reviewed delivery-request runtime.
;
; SCREQ consumes only a durable SCL1 delivery continuation authored by SCCAT.
; It reconstructs the selected Catalog address (or installed artifact key),
; appends one atomic SCD1 intent batch through DSREQB, advances the independent
; request counter, and clears the pending continuation only after DSREQ verifies.

include "ti86asm.inc"

REQ_MAX_BYTES:          equ 2048
REQ_MAX_RECORDS:        equ 32
REQ_ENTRY_BUFFER_BYTES: equ 280

REQ_ACTION_INSTALL:     equ 1
REQ_ACTION_REMOVE:      equ 2
REQ_ACTION_UPDATE:      equ 3
REQ_VIEW_LESSON:        equ 4
REQ_VIEW_DELIVERY:      equ 9

REQ_ERROR_NONE:         equ 0
REQ_ERROR_STATE:        equ 1
REQ_ERROR_IDENTITY:     equ 2
REQ_ERROR_CATALOG:      equ 3
REQ_ERROR_QUEUE:        equ 4
REQ_ERROR_SAVE:         equ 5

org _asm_exec_ram

        nop
        jp request_runtime_start
        defw 0
        defw request_runtime_name
        defb "SCX1"
        defb 1                 ; runtime ABI
        defb 4                 ; closed registry code: delivery-request
        defb 0
        defw 0
        defw 0
        defw 0

request_runtime_name: defb 0

request_runtime_start:
        ; Immutable SCX1 verification is performed by SCHLCALC before this
        ; child is loaded into execution RAM.
        call scstate_load
        jp c,req_fail_state
        call req_load_identity
        jp c,req_fail_identity
        call req_recover
        jp c,req_fail_queue
        call req_retire_committed_batch
        jp c,req_fail_queue
        call req_pending_action
        ret z
        jp c,req_fail_state
        call req_build_entries
        jp c,req_fail_catalog
        call req_append_entries
        jp c,req_fail_queue
        call req_advance_state
        jp c,req_fail_save
        xor a
        ld (req_error),a
        ld hl,req_saved_text
        jp req_render_and_wait

req_fail_state:
        ld a,REQ_ERROR_STATE
        jr req_fail
req_fail_identity:
        ld a,REQ_ERROR_IDENTITY
        jr req_fail
req_fail_catalog:
        ld a,REQ_ERROR_CATALOG
        jr req_fail
req_fail_queue:
        ld a,REQ_ERROR_QUEUE
        jr req_fail
req_fail_save:
        ld a,REQ_ERROR_SAVE
req_fail:
        ld (req_error),a
        ld hl,req_error_text

req_render_and_wait:
        ld (req_message),hl
        call _runindicoff
        call sc_input_init
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,req_header
        ld b,1
        ld c,1
        call ui_draw_text
        call ui_mode_set
        ld hl,(req_message)
        ld b,3
        ld c,18
        call ui_draw_text
        ld hl,req_return_text
        ld b,3
        ld c,38
        call ui_draw_text
req_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        ret z
        jr req_wait

; Return Z when there is no pending action, carry for an inconsistent state.
req_pending_action:
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and SCSTATE_FLAG_DELIVERY_PENDING_HIGH
        jr nz,req_pending_flag_set
        ld a,(scstate_record + SCSTATE_DELIVERY_ACTION_OFFSET)
        or a
        jr nz,req_pending_invalid
        xor a
        ret
req_pending_flag_set:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp REQ_VIEW_DELIVERY
        jr nz,req_pending_invalid
        ld a,(scstate_record + SCSTATE_DELIVERY_ACTION_OFFSET)
        cp REQ_ACTION_INSTALL
        jr c,req_pending_invalid
        cp REQ_ACTION_UPDATE + 1
        jr nc,req_pending_invalid
        or a
        ret
req_pending_invalid:
        scf
        ret

; ---------------------------------------------------------------------------
; Identity and selected Catalog target

req_load_identity:
        ld hl,req_dsid_name
        ld de,req_sci1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,req_key_schema
        call sc_map_find_literal
        ret c
        ld hl,req_identity_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,req_identity_fail
        ld de,(sc_record_root_offset)
        ld hl,req_key_device_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,req_device_id
        ld b,0
req_identity_copy:
        ld a,(hl)
        or a
        jr z,req_identity_done
        ld c,a
        ld a,b
        cp 16
        jr nc,req_identity_fail
        ld a,c
        cp '0'
        jr c,req_identity_fail
        cp '9' + 1
        jr c,req_identity_store
        cp 'A'
        jr c,req_identity_fail
        cp 'Z' + 1
        jr nc,req_identity_fail
req_identity_store:
        ld a,c
        ld (de),a
        inc de
        inc hl
        inc b
        jr req_identity_copy
req_identity_done:
        ld a,b
        cp 4
        jr c,req_identity_fail
        ld (req_device_length),a
        or a
        ret
req_identity_fail:
        scf
        ret

req_build_entries:
        ld hl,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET)
        ld a,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET + 2)
        ld (req_build_id),hl
        ld (req_build_id + 2),a
        ld (req_first_id),hl
        ld (req_first_id + 2),a
        and h
        and l
        cp 0xFF
        jr z,req_build_fail
        ld a,(scstate_record + SCSTATE_DELIVERY_ACTION_OFFSET)
        ld (req_action),a
        cp REQ_ACTION_UPDATE
        jr nz,req_build_action_bound_ready
        ld a,(req_first_id + 2)
        cp 0xFF
        jr nz,req_build_action_bound_ready
        ld a,(req_first_id + 1)
        cp 0xFF
        jr nz,req_build_action_bound_ready
        ld a,(req_first_id)
        cp 0xFE
        jr nc,req_build_fail
req_build_action_bound_ready:
        ld a,(req_action)
        cp REQ_ACTION_REMOVE
        jr z,req_build_remove_only
        call req_load_catalog_address
        jr c,req_build_fail
        call req_reset_entry_buffer
        call req_append_install_buffer
        jr c,req_build_fail
        ld a,(req_action)
        cp REQ_ACTION_UPDATE
        jr nz,req_build_one_ready
        call req_increment_build_id
        jr c,req_build_fail
        call req_load_artifact_key
        jr c,req_build_fail
        call req_append_remove_buffer
        jr c,req_build_fail
        ld a,2
        jr req_build_count_ready
req_build_remove_only:
        call req_load_artifact_key
        jr c,req_build_fail
        call req_reset_entry_buffer
        call req_append_remove_buffer
        jr c,req_build_fail
req_build_one_ready:
        ld a,1
req_build_count_ready:
        ld (req_entry_count),a
        ld hl,(req_entry_pointer)
        ld de,req_entry_buffer
        or a
        sbc hl,de
        ld (req_entries_length),hl
        or a
        ret
req_build_fail:
        scf
        ret

req_load_catalog_address:
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        bit 7,a
        jp z,req_catalog_fail
        bit 5,a
        ld hl,req_dscat0_name
        jr z,req_catalog_slot_ready
        ld hl,req_dscat1_name
req_catalog_slot_ready:
        ld de,req_scc1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,req_key_schema
        call sc_map_find_literal
        ret c
        ld hl,req_catalog_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,req_catalog_fail
        ld de,(sc_record_root_offset)
        ld hl,req_key_device_id
        call sc_map_find_literal
        ret c
        ld hl,req_device_id
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,req_catalog_fail
        ld de,(sc_record_root_offset)
        ld hl,req_key_generation_key
        call sc_map_find_literal
        ret c
        ld hl,scstate_record + SCSTATE_CATALOG_KEY_OFFSET
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,req_catalog_fail

        ld de,(sc_record_root_offset)
        ld hl,req_key_catalogs
        call sc_map_find_literal
        ret c
        ld hl,(scstate_record + SCSTATE_CATALOG_INDEX_OFFSET)
        call sc_array_item
        ret c
        ld hl,req_key_subjects
        call sc_map_find_literal
        ret c
        ld hl,(scstate_record + SCSTATE_SUBJECT_INDEX_OFFSET)
        call sc_array_item
        ret c
        ld hl,req_key_courses
        call sc_map_find_literal
        ret c
        ld hl,(scstate_record + SCSTATE_COURSE_INDEX_OFFSET)
        call sc_array_item
        ret c
        ld hl,req_key_units
        call sc_map_find_literal
        ret c
        ld hl,(scstate_record + SCSTATE_UNIT_INDEX_OFFSET)
        call sc_array_item
        ret c
        ld hl,req_key_lessons
        call sc_map_find_literal
        ret c
        ld hl,(scstate_record + SCSTATE_LESSON_INDEX_OFFSET)
        call sc_array_item
        ret c
        ld hl,req_key_address
        call sc_map_find_literal
        ret c
        jp req_copy_target_string
req_catalog_fail:
        scf
        ret

; DE = typed string node. Copy 1..255 printable bytes and require five address
; segments (exactly four slash separators).
req_copy_target_string:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        ret c
        cp SC_TAG_STRING
        jr nz,req_catalog_fail
        call sc_cursor_read_word
        ret c
        call sc_string_locate
        ret c
        ld a,b
        or a
        jr nz,req_catalog_fail
        ld a,c
        or a
        jr z,req_catalog_fail
        ld (req_target_length),a
        ld (req_target_source),de
        ld hl,req_target
        ld (req_target_pointer),hl
        xor a
        ld (req_target_slashes),a
        ld a,(req_target_length)
        ld b,a
req_target_copy_loop:
        push bc
        ld de,(req_target_source)
        call sc_record_read_byte
        pop bc
        ret c
        cp 0x20
        jr c,req_catalog_fail
        cp 0x7F
        jr nc,req_catalog_fail
        cp '/'
        jr nz,req_target_not_slash
        ld a,(req_target_slashes)
        inc a
        ld (req_target_slashes),a
        ld a,'/'
req_target_not_slash:
        ld hl,(req_target_pointer)
        ld (hl),a
        inc hl
        ld (req_target_pointer),hl
        ld hl,(req_target_source)
        inc hl
        ld (req_target_source),hl
        djnz req_target_copy_loop
        ld a,(req_target_slashes)
        cp 4
        jr nz,req_catalog_fail
        or a
        ret

req_load_artifact_key:
        ld hl,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld de,req_artifact_key
        ld b,10
req_artifact_key_loop:
        ld a,(hl)
        ld c,a
        cp '2'
        jr c,req_artifact_key_alpha
        cp '7' + 1
        jr c,req_artifact_key_store
req_artifact_key_alpha:
        cp 'A'
        jr c,req_artifact_key_fail
        cp 'Z' + 1
        jr nc,req_artifact_key_fail
req_artifact_key_store:
        ld a,c
        ld (de),a
        inc hl
        inc de
        djnz req_artifact_key_loop
        or a
        ret
req_artifact_key_fail:
        scf
        ret

req_reset_entry_buffer:
        ld hl,req_entry_buffer
        ld (req_entry_pointer),hl
        ret

req_append_install_buffer:
        call req_append_id
        ret c
        call req_append_learner_key
        ret c
        ld a,REQ_ACTION_INSTALL
        call req_entry_put_byte
        ret c
        ld a,(req_target_length)
        call req_entry_put_byte
        ld hl,req_target
        ld a,(req_target_length)
        ld b,a
        jr req_entry_copy

req_append_remove_buffer:
        call req_append_id
        ret c
        call req_append_learner_key
        ret c
        ld a,REQ_ACTION_REMOVE
        call req_entry_put_byte
        ret c
        ld a,10
        call req_entry_put_byte
        ld hl,req_artifact_key
        ld b,10
req_entry_copy:
        ld a,(hl)
        inc hl
        call req_entry_put_byte
        djnz req_entry_copy
        or a
        ret

req_append_id:
        ld hl,req_build_id
        ld b,3
req_entry_id_loop:
        ld a,(hl)
        inc hl
        call req_entry_put_byte
        djnz req_entry_id_loop
        or a
        ret

req_append_learner_key:
        ld hl,scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET
        ld b,2
req_entry_learner_loop:
        ld a,(hl)
        inc hl
        call req_entry_put_byte
        djnz req_entry_learner_loop
        or a
        ret

req_entry_put_byte:
        push af
        ld hl,(req_entry_pointer)
        ld de,req_entry_buffer + REQ_ENTRY_BUFFER_BYTES
        push hl
        or a
        sbc hl,de
        pop hl
        jr nc,req_entry_put_fail
        pop af
        ld (hl),a
        inc hl
        ld (req_entry_pointer),hl
        or a
        ret
req_entry_put_fail:
        pop af
        scf
        ret

req_increment_build_id:
        ld hl,req_build_id
        inc (hl)
        ret nz
        inc hl
        inc (hl)
        ret nz
        inc hl
        inc (hl)
        ret nz
        scf
        ret

; ---------------------------------------------------------------------------
; Fixed SCD1 validation, recovery, append, and promotion

req_recover:
        ld hl,req_dsqb_name
        ld de,req_scd1_magic
        call sc_envelope_open
        jr nc,req_recover_backup_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jr z,req_recover_canonical
        call req_validate_canonical
        ret c
        ld hl,req_dsqb_name
        call req_delete_if_present
        or a
        ret
req_recover_backup_present:
        call req_validate_open
        jr c,req_recover_bad_backup
        jp req_replace_from_backup
req_recover_bad_backup:
        call req_validate_canonical
        ret c
        ld hl,req_dsqb_name
        call req_delete_if_present
        or a
        ret
req_recover_canonical:
        call req_validate_canonical
        ret nc
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        scf
        ret

req_validate_canonical:
        ld hl,req_dsq_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        jp req_validate_open

req_validate_open:
        ld hl,REQ_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,req_validate_fail
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(req_device_length)
        cp b
        jp nz,req_validate_fail
        inc de
        ld hl,req_device_id
req_validate_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,req_validate_fail
        inc de
        inc hl
        djnz req_validate_device_loop
        call sc_record_read_byte
        ret c
        ld (req_existing_count),a
        cp REQ_MAX_RECORDS + 1
        jp nc,req_validate_fail
        inc de
        ld (req_records_remaining),a
        xor a
        ld (req_have_last),a
req_validate_entry_loop:
        ld a,(req_records_remaining)
        or a
        jr z,req_validate_entries_done
        ld hl,req_current_id
        ld b,3
req_validate_id_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        djnz req_validate_id_loop
        call req_require_increasing_id
        ret c
        ; Each queued intent snapshots the soft profile independently. Zero is
        ; Guest; nonzero keys are resolved against durable backend bindings.
        call sc_record_read_byte
        ret c
        inc de
        call sc_record_read_byte
        ret c
        inc de
        call sc_record_read_byte
        ret c
        cp REQ_ACTION_INSTALL
        jr z,req_validate_action_ok
        cp REQ_ACTION_REMOVE
        jr nz,req_validate_fail
req_validate_action_ok:
        ld (req_current_action),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr z,req_validate_fail
        ld (req_current_target_length),a
        inc de
        ld b,a
        ld a,(req_current_action)
        cp REQ_ACTION_REMOVE
        jr nz,req_validate_target_loop
        ld a,b
        cp 10
        jr nz,req_validate_fail
req_validate_target_loop:
        call sc_record_read_byte
        ret c
        ld c,a
        cp 0x20
        jr c,req_validate_fail
        cp 0x7F
        jr nc,req_validate_fail
        ld a,(req_current_action)
        cp REQ_ACTION_REMOVE
        jr nz,req_validate_target_next
        ld a,c
        call req_validate_key_character
        jr c,req_validate_fail
req_validate_target_next:
        inc de
        djnz req_validate_target_loop
        ld hl,req_current_id
        ld bc,3
        ld de,req_last_id
        ldir
        ld a,1
        ld (req_have_last),a
        ld a,(req_records_remaining)
        dec a
        ld (req_records_remaining),a
        jr req_validate_entry_loop
req_validate_entries_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr nz,req_validate_fail
        or a
        ret
req_validate_fail:
        scf
        ret

req_require_increasing_id:
        ld a,(req_have_last)
        or a
        ret z
        ld hl,req_current_id + 2
        ld de,req_last_id + 2
        ld b,3
req_compare_id_loop:
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jr c,req_compare_id_fail
        jr nz,req_compare_id_ok
        dec hl
        dec de
        djnz req_compare_id_loop
req_compare_id_fail:
        scf
        ret
req_compare_id_ok:
        or a
        ret

req_validate_key_character:
        cp '2'
        jr c,req_key_character_alpha
        cp '7' + 1
        jr c,req_key_character_ok
req_key_character_alpha:
        cp 'A'
        jr c,req_key_character_fail
        cp 'Z' + 1
        jr nc,req_key_character_fail
req_key_character_ok:
        or a
        ret
req_key_character_fail:
        scf
        ret

req_append_entries:
        call req_validate_canonical
        jr nc,req_append_existing
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp nz,req_append_fail
        xor a
        ld (req_existing_present),a
        ld (req_existing_count),a
        jr req_append_size_missing
req_append_existing:
        call req_existing_has_pending_suffix
        ret nc
        call req_require_tail_successor
        jp c,req_append_fail
        ld a,1
        ld (req_existing_present),a
        ld hl,(sc_record_length)
        ld (req_existing_length),hl
        ld a,(req_existing_count)
        ld b,a
        ld a,(req_entry_count)
        add a,b
        cp REQ_MAX_RECORDS + 1
        jp nc,req_append_fail
        ld hl,(req_existing_length)
        ld de,(req_entries_length)
        add hl,de
        jr req_append_size_ready
req_append_size_missing:
        ld a,(req_device_length)
        ld l,a
        ld h,0
        ld de,11
        add hl,de
        ld de,(req_entries_length)
        add hl,de
req_append_size_ready:
        ld (req_candidate_length),hl
        ld de,REQ_MAX_BYTES + 1
        or a
        sbc hl,de
        jp nc,req_append_fail
        call req_create_candidate
        ret c
        ld a,(req_existing_present)
        or a
        jr z,req_write_empty_prefix
        ld hl,req_dsq_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        ld hl,(req_existing_length)
        dec hl
        dec hl
        ld (req_append_offset),hl
        call req_copy_open_to_candidate
        ret c
        jr req_write_entries
req_write_empty_prefix:
        call req_build_empty_prefix
        ld de,0
        ld bc,(req_prefix_length)
        ld hl,req_prefix
        call req_copy_page_zero_to_candidate
        ret c
        ld hl,(req_prefix_length)
        ld (req_append_offset),hl
req_write_entries:
        ld de,(req_append_offset)
        ld bc,(req_entries_length)
        ld hl,req_entry_buffer
        call req_copy_page_zero_to_candidate
        ret c
        ; Patch outer body length and fixed queue count.
        ld hl,(req_candidate_length)
        ld de,9
        or a
        sbc hl,de
        ld (req_patch),hl
        ld de,5
        ld bc,2
        ld hl,req_patch
        call req_copy_page_zero_to_candidate
        ret c
        ld a,(req_existing_count)
        ld b,a
        ld a,(req_entry_count)
        add a,b
        ld (req_patch),a
        ld a,(req_device_length)
        add a,8
        ld e,a
        ld d,0
        ld bc,1
        ld hl,req_patch
        call req_copy_page_zero_to_candidate
        ret c
        call req_finish_candidate_crc
        ret c
        ld hl,req_dsqb_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        call req_validate_open
        ret c
        call req_existing_has_pending_suffix
        ret c
        jp req_replace_from_backup
req_append_fail:
        scf
        ret

; Carry clear only when the already-open record ends in the exact pending batch.
req_existing_has_pending_suffix:
        ld a,(req_existing_count)
        ld b,a
        ld a,(req_entry_count)
        cp b
        jr c,req_suffix_count_ok
        jr z,req_suffix_count_ok
        scf
        ret
req_suffix_count_ok:
        ld hl,(sc_record_length)
        dec hl
        dec hl
        ld de,(req_entries_length)
        or a
        sbc hl,de
        jr c,req_suffix_fail
        push hl
        pop de
        ld hl,req_entry_buffer
        ld bc,(req_entries_length)
req_suffix_compare_loop:
        ld a,b
        or c
        jr z,req_suffix_exact
        call sc_record_read_byte
        ret c
        cp (hl)
        jr nz,req_suffix_fail
        inc de
        inc hl
        dec bc
        jr req_suffix_compare_loop
req_suffix_exact:
        or a
        ret
req_suffix_fail:
        scf
        ret

; A nonempty queue may accept only the exact successor of its validated tail.
; An empty queue relies on SCL1's persistent nextRequestId, which deliberately
; survives complete acknowledgement and DSREQ deletion.
req_require_tail_successor:
        ld a,(req_existing_count)
        or a
        ret z
        ld hl,(req_last_id)
        ld a,(req_last_id + 2)
        ld c,a
        and h
        and l
        cp 0xFF
        jr z,req_tail_invalid
        inc hl
        jr nz,req_tail_increment_ready
        inc c
req_tail_increment_ready:
        ld de,(req_first_id)
        or a
        sbc hl,de
        jr nz,req_tail_invalid
        ld a,(req_first_id + 2)
        cp c
        jr nz,req_tail_invalid
        or a
        ret
req_tail_invalid:
        scf
        ret

req_create_candidate:
        ld hl,req_dsqb_name
        call req_delete_if_present
        call _memchk
        or a
        jr nz,req_candidate_memory_ready
        ld de,(req_candidate_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        ret c
req_candidate_memory_ready:
        ld hl,req_dsqb_name
        rst 0x20
        ld hl,(req_candidate_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (req_candidate_addr),hl
        ld (req_candidate_page),a
        or a
        ret

req_build_empty_prefix:
        ld hl,req_prefix
        ld de,req_scd1_prefix
        ld bc,7
        ldir
        ld a,(req_device_length)
        ld (hl),a
        inc hl
        ld de,req_device_id
        ld b,a
req_prefix_device_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz req_prefix_device_loop
        xor a
        ld (hl),a
        inc hl
        ld de,req_prefix
        or a
        sbc hl,de
        ld (req_prefix_length),hl
        ret

req_copy_open_to_candidate:
        ld (req_copy_length),hl
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(req_candidate_page)
        ld hl,(req_candidate_addr)
        call _set_abs_dest
        xor a
        ld hl,(req_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret

; HL page-zero source, BC length, DE candidate offset.
req_copy_page_zero_to_candidate:
        ld (req_copy_source),hl
        ld (req_copy_length),bc
        ld (req_copy_offset),de
        xor a
        ld hl,(req_copy_source)
        call _set_abs_src
        ld hl,(req_candidate_addr)
        ld de,(req_copy_offset)
        add hl,de
        ld a,(req_candidate_page)
        adc a,0
        call _set_abs_dest
        xor a
        ld hl,(req_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret

req_finish_candidate_crc:
        ld a,(req_candidate_page)
        ld (sc_record_base_page),a
        ld hl,(req_candidate_addr)
        ld (sc_record_base_addr),hl
        ld hl,(req_candidate_length)
        ld (sc_record_length),hl
        dec hl
        dec hl
        ld (req_crc_remaining),hl
        xor a
        ld (sc_cache_valid),a
        ld (req_crc_offset),a
        ld (req_crc_offset + 1),a
        ld hl,0xFFFF
        ld (req_crc),hl
req_crc_byte_loop:
        ld hl,(req_crc_remaining)
        ld a,h
        or l
        jr z,req_crc_done
        dec hl
        ld (req_crc_remaining),hl
        ld de,(req_crc_offset)
        call sc_record_read_byte
        ret c
        ld hl,(req_crc)
        xor h
        ld h,a
        ld b,8
req_crc_bit_loop:
        bit 7,h
        jr z,req_crc_shift
        sla l
        rl h
        ld a,h
        xor 0x10
        ld h,a
        ld a,l
        xor 0x21
        ld l,a
        jr req_crc_bit_done
req_crc_shift:
        sla l
        rl h
req_crc_bit_done:
        djnz req_crc_bit_loop
        ld (req_crc),hl
        ld hl,(req_crc_offset)
        inc hl
        ld (req_crc_offset),hl
        jr req_crc_byte_loop
req_crc_done:
        ld hl,(req_crc)
        ld (req_patch),hl
        ld de,(req_candidate_length)
        dec de
        dec de
        ld bc,2
        ld hl,req_patch
        jp req_copy_page_zero_to_candidate

req_replace_from_backup:
        ld hl,req_dsqb_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        call req_validate_open
        ret c
        ld hl,(sc_record_length)
        ld (req_copy_length),hl
        ld hl,req_dsq_name
        call req_delete_if_present
        ld hl,req_dsq_name
        rst 0x20
        ld hl,(req_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (req_dest_addr),hl
        ld (req_dest_page),a
        ld hl,req_dsqb_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(req_dest_page)
        ld hl,(req_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(req_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        call req_validate_canonical
        ret c
        ld hl,req_dsqb_name
        call req_delete_if_present
        or a
        ret

; ---------------------------------------------------------------------------
; Conservative whole-batch delivery acknowledgement from committed DSINST.

req_retire_committed_batch:
        xor a
        ld (req_ack_count),a
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        bit 7,a
        ret z
        bit 6,a
        ld hl,req_dsinst0_name
        jr z,req_ack_slot_ready
        ld hl,req_dsinst1_name
req_ack_slot_ready:
        ld de,req_scm1_magic
        call sc_envelope_open
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(req_device_length)
        cp b
        jp nz,req_ack_fail
        inc de
        ld hl,req_device_id
        ld b,16
req_ack_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,req_ack_fail
        inc de
        inc hl
        djnz req_ack_device_loop

        ld de,47
        call sc_record_read_byte
        ret c
        inc de
        ld b,a
req_ack_skip_installed:
        ld a,b
        or a
        jr z,req_ack_installed_done
        ld hl,52
        add hl,de
        push hl
        pop de
        djnz req_ack_skip_installed
req_ack_installed_done:
        call sc_record_read_byte
        ret c
        inc de
        ld b,a
req_ack_skip_removals:
        ld a,b
        or a
        jr z,req_ack_removals_done
        ld hl,18
        add hl,de
        push hl
        pop de
        djnz req_ack_skip_removals
req_ack_removals_done:
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr nz,req_ack_fail
        inc de
        ld b,c
req_ack_skip_results:
        ld a,b
        or a
        jr z,req_ack_results_done
        ld hl,3
        add hl,de
        push hl
        pop de
        djnz req_ack_skip_results
req_ack_results_done:
        call sc_record_read_byte
        ret c
        cp REQ_MAX_RECORDS + 1
        jr nc,req_ack_fail
        ld (req_ack_count),a
        inc de
        ld hl,req_ack_ids
        ld (req_ack_pointer),hl
        ld b,a
req_ack_copy_loop:
        ld a,b
        or a
        jr z,req_ack_copy_done
        push bc
        ld b,3
req_ack_copy_id:
        call sc_record_read_byte
        jp c,req_ack_copy_fail
        ld hl,(req_ack_pointer)
        ld (hl),a
        inc hl
        ld (req_ack_pointer),hl
        inc de
        djnz req_ack_copy_id
        pop bc
        djnz req_ack_copy_loop
req_ack_copy_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr nz,req_ack_fail
        call req_validate_ack_ids
        ret c
        ld a,(req_ack_count)
        or a
        ret z
        call req_validate_canonical
        jr nc,req_ack_queue_ready
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        scf
        ret
req_ack_queue_ready:
        ld a,(req_existing_count)
        ld b,a
        ld a,(req_ack_count)
        cp b
        ret nz
        call req_queue_ids_match_ack
        ret c
        ld hl,req_dsq_name
        call req_delete_if_present
        or a
        ret
req_ack_copy_fail:
        pop bc
req_ack_fail:
        scf
        ret

req_validate_ack_ids:
        ld a,(req_ack_count)
        cp 2
        ret c
        dec a
        ld b,a
        ld hl,req_ack_ids
        ld de,req_ack_ids + 3
req_ack_order_loop:
        push bc
        push hl
        push de
        inc hl
        inc hl
        inc de
        inc de
        ld b,3
req_ack_order_bytes:
        ld a,(hl)
        ld c,a
        ld a,(de)
        cp c
        jr c,req_ack_order_bad_pop
        jr nz,req_ack_order_good_pop
        dec hl
        dec de
        djnz req_ack_order_bytes
req_ack_order_bad_pop:
        pop de
        pop hl
        pop bc
        scf
        ret
req_ack_order_good_pop:
        pop de
        pop hl
        pop bc
        ld de,3
        add hl,de
        push hl
        pop de
        ld hl,3
        add hl,de
        ex de,hl
        djnz req_ack_order_loop
        or a
        ret

req_queue_ids_match_ack:
        ; Reopen because validation leaves the cursor at the record end.
        ld hl,req_dsq_name
        ld de,req_scd1_magic
        call sc_envelope_open
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        inc de
        ld b,a
req_ack_match_skip_device:
        inc de
        djnz req_ack_match_skip_device
        inc de                    ; request count
        ld hl,req_ack_ids
        ld a,(req_ack_count)
        ld (req_records_remaining),a
req_ack_match_entry:
        ld a,(req_records_remaining)
        or a
        jr z,req_ack_match_done
        ld b,3
req_ack_match_id:
        call sc_record_read_byte
        ret c
        cp (hl)
        jr nz,req_ack_match_fail
        inc de
        inc hl
        djnz req_ack_match_id
        inc de                    ; action
        call sc_record_read_byte
        ret c
        inc de
        ld b,a
req_ack_match_skip_target:
        inc de
        djnz req_ack_match_skip_target
        ld a,(req_records_remaining)
        dec a
        ld (req_records_remaining),a
        jr req_ack_match_entry
req_ack_match_done:
        or a
        ret
req_ack_match_fail:
        scf
        ret

req_advance_state:
        ld a,(req_entry_count)
        ld b,a
        ld hl,scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET
req_advance_id_loop:
        inc (hl)
        jr nz,req_advance_id_next
        inc hl
        inc (hl)
        jr nz,req_advance_id_restore
        inc hl
        inc (hl)
        jr z,req_advance_fail
        dec hl
req_advance_id_restore:
        dec hl
req_advance_id_next:
        djnz req_advance_id_loop
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and 0xFE
        ld (scstate_record + SCSTATE_FLAGS_OFFSET + 1),a
        xor a
        ld (scstate_record + SCSTATE_DELIVERY_ACTION_OFFSET),a
        ld a,REQ_VIEW_LESSON
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        ret
req_advance_fail:
        scf
        ret

req_delete_if_present:
        rst 0x20
        rst 0x10
        ret c
        call _delvar
        ret

; ---------------------------------------------------------------------------
; Self-authentication and data

req_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,req_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,req_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,req_scx_magic
        ld b,4
req_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,req_scx_fail
        inc de
        inc hl
        djnz req_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,req_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 4
        jr nz,req_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,req_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,req_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,req_scx_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,req_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,req_scx_fail
        or a
        ret
req_scx_fail:
        scf
        ret

req_error:                 defb REQ_ERROR_NONE
req_message:               defw 0
req_action:                defb 0
req_device_length:         defb 0
req_device_id:             defs 17,0
req_target_length:         defb 0
req_target:                defs 255,0
req_target_source:         defw 0
req_target_pointer:        defw 0
req_target_slashes:        defb 0
req_artifact_key:          defs 10,0
req_build_id:              defs 3,0
req_first_id:              defs 3,0
req_entry_count:           defb 0
req_entry_buffer:          defs REQ_ENTRY_BUFFER_BYTES,0
req_entry_pointer:         defw 0
req_entries_length:        defw 0
req_existing_present:      defb 0
req_existing_count:        defb 0
req_existing_length:       defw 0
req_records_remaining:     defb 0
req_have_last:             defb 0
req_last_id:               defs 3,0
req_current_id:            defs 3,0
req_current_action:        defb 0
req_current_target_length: defb 0
req_candidate_length:      defw 0
req_candidate_addr:        defw 0
req_candidate_page:        defb 0
req_dest_addr:             defw 0
req_dest_page:             defb 0
req_append_offset:         defw 0
req_prefix:                defs 26,0
req_prefix_length:         defw 0
req_patch:                 defw 0
req_copy_source:           defw 0
req_copy_length:           defw 0
req_copy_offset:           defw 0
req_crc:                   defw 0
req_crc_offset:            defw 0
req_crc_remaining:         defw 0
req_ack_count:             defb 0
req_ack_ids:               defs REQ_MAX_RECORDS * 3,0
req_ack_pointer:           defw 0

req_scx_magic:          defb "SCX1"
req_sci1_magic:         defb "SCI1"
req_scc1_magic:         defb "SCC1"
req_scd1_magic:         defb "SCD1"
req_scm1_magic:         defb "SCM1"
req_scd1_prefix:        defb "SCD1",1,0,0
req_key_schema:         defb "schema",0
req_key_device_id:      defb "deviceId",0
req_key_generation_key: defb "generationKey",0
req_key_catalogs:       defb "catalogs",0
req_key_subjects:       defb "subjects",0
req_key_courses:        defb "courses",0
req_key_units:          defb "units",0
req_key_lessons:        defb "lessons",0
req_key_address:        defb "address",0
req_identity_schema:    defb "school.calc.device-identity/v1",0
req_catalog_schema:     defb "school.calc.catalog-projection/v1",0

req_header:             defb "CATALOG REQUEST",0
req_saved_text:         defb "Saved for next sync.",0
req_error_text:         defb "Request not changed.",0
req_return_text:        defb "ENTER returns safely.",0

req_dsid_name:    defb 0x0C,4,"DSID",0,0,0,0
req_dscat0_name:  defb 0x0C,6,"DSCAT0",0,0
req_dscat1_name:  defb 0x0C,6,"DSCAT1",0,0
req_dsinst0_name: defb 0x0C,7,"DSINST0",0
req_dsinst1_name: defb 0x0C,7,"DSINST1",0
req_dsq_name:     defb 0x0C,5,"DSREQ",0,0,0
req_dsqb_name:    defb 0x0C,6,"DSREQB",0,0

include "crc16-ccitt.asm"
UI_RENDER_COPIED_TEXT_LENGTH: equ 0
include "record-reader.asm"
include "runtime-state.asm"
UI_RENDER_PROFILE_FULL: equ 0
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/ui-request-runtime-assets.inc"

end
