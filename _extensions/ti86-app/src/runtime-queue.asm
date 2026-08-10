; Crash-safe SCQ1 append for one pending response or generic progress record.
;
; The exact SCR1 bytes are built in page-zero RAM. DSQB is always written and
; envelope-validated before DSQ is replaced. A valid DSQB from an interrupted
; prior attempt is promoted before another append; a corrupt backup is deleted
; only when canonical DSQ is valid. Outer SCQ1 CRC protects every nested byte,
; while fixed bounds/device/sequence checks prevent cross-device or conflicting
; reuse. Local success is rendered only after DSQ and the next SCL1 sequence
; have both committed.

QUEUE_MAX_BYTES:       equ 6144
QUEUE_MAX_RECORDS:     equ 170
QUEUE_RESULT_MAX_BYTES: equ 80
QUEUE_KIND_RESPONSES:   equ 0x00
QUEUE_KIND_PROGRESS:    equ 0x80
QUEUE_MODULE_MASK:      equ 0x7F
QUEUE_DRAFT_CHOICE:     equ 1
QUEUE_DRAFT_PROGRESS:   equ 6
QUEUE_DRAFT_SCORE:      equ 7
QUEUE_DRAFT_PROBE:      equ 8
QUEUE_DRAFT_ADAPTIVE:   equ 9
QUEUE_PROBE_MAX_ITEMS:  equ 12
QUEUE_FLAG_RESULT_PENDING_HIGH: equ 0x02

assessment_complete_commit:
result_queue_commit:
        call queue_build_result
        ret c
        call queue_recover
        ret c
        call queue_append_result
        ret c
        call queue_advance_local_state
        ret c
        ret

; Build compact SCR1 v1 from the durable SCL1 pending continuation.
queue_build_result:
        call queue_load_identity
        ret c
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        and QUEUE_FLAG_RESULT_PENDING_HIGH
        jp z,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp QUEUE_DRAFT_ADAPTIVE
        jp z,queue_build_adaptive
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0x03
        cp 0x03
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp QUEUE_DRAFT_CHOICE
        jr z,queue_build_responses_kind
        cp QUEUE_DRAFT_PROBE
        jr z,queue_build_responses_kind
        cp QUEUE_DRAFT_PROGRESS
        jp nz,queue_fail
        ld a,QUEUE_KIND_PROGRESS
        jr queue_build_kind_ready
queue_build_responses_kind:
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0x10
        jp z,queue_fail
        ld a,QUEUE_KIND_RESPONSES
queue_build_kind_ready:
        ld (queue_result_kind),a
        ld hl,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        ld a,(hl)
        inc hl
        and (hl)
        inc hl
        and (hl)
        cp 0xFF
        jp z,queue_fail

        ; Seed the mutable SCR1 record from its immutable envelope prefix.
        ; LDIR is source HL -> destination DE, then leaves DE at the record
        ; write cursor used by the payload builder below.
        ld hl,queue_scr1_prefix
        ld de,queue_scr1_record
        ld bc,8
        ldir
        ex de,hl
        ld a,(runtime_state_record + RUNTIME_SCL_MODULE_INDEX_OFFSET + 1)
        or a
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_MODULE_INDEX_OFFSET)
        cp QUEUE_MODULE_MASK + 1
        jp nc,queue_fail
        ld b,a
        ld a,(queue_result_kind)
        or b
        ld (queue_scr1_record + 7),a
        ld a,(queue_device_length)
        ld (hl),a
        inc hl
        ld de,queue_device_id
        ld a,(queue_device_length)
        ld b,a
queue_build_device_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_build_device_loop
        ld de,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        ld b,3
queue_build_sequence_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_build_sequence_loop
        ld de,runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET
        ld a,(de)
        ld c,a
        ld (hl),a
        inc de
        inc hl
        ld a,(de)
        ld b,a
        ld (hl),a
        inc hl
        or c
        jp z,queue_fail
        ld de,runtime_state_record + RUNTIME_SCL_ARTIFACT_KEY_OFFSET
        ld b,10
queue_build_key_loop:
        ld a,(de)
        ld c,a
        call queue_validate_key_character
        jp c,queue_fail
        ld a,c
        ld (hl),a
        inc de
        inc hl
        djnz queue_build_key_loop
        ld a,(queue_result_kind)
        cp QUEUE_KIND_PROGRESS
        jp z,queue_build_progress
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp QUEUE_DRAFT_PROBE
        jp z,queue_build_probe
        ld (hl),1                 ; packed ordered-choice mode
        inc hl
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        or a
        jp z,queue_fail
        cp 49
        jp nc,queue_fail
        ld (hl),a
        inc hl
        ld (queue_pack_remaining),a
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
queue_pack_loop:
        ld a,(queue_pack_remaining)
        or a
        jr z,queue_pack_done
        ld a,(de)
        or a
        jp z,queue_fail
        cp 6
        jp nc,queue_fail
        rlca
        rlca
        rlca
        rlca
        ld b,a
        inc de
        ld a,(queue_pack_remaining)
        dec a
        ld (queue_pack_remaining),a
        jr z,queue_pack_store
        ld a,(de)
        or a
        jp z,queue_fail
        cp 6
        jp nc,queue_fail
        or b
        inc de
        ld b,a
        ld a,(queue_pack_remaining)
        dec a
        ld (queue_pack_remaining),a
queue_pack_store:
        ld a,b
        ld (hl),a
        inc hl
        jr queue_pack_loop
queue_pack_done:
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        ld (queue_score_total),a
queue_append_score:
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld b,a
        ld a,(queue_score_total)
        cp b
        jp c,queue_fail
        ld a,b
        ld (hl),a
        inc hl
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1)
        cp 101
        jp nc,queue_fail
        jp queue_build_payload_done

; Compact formative evidence mode: two trace bytes per item, exactly matching
; the backend SCR1 mode-3 codec. Completed items must include both viewed and
; continued flags; retries remain ordered nibbles and the first nibble scores.
queue_build_probe:
        ld (hl),3
        inc hl
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        or a
        jp z,queue_fail
        bit 0,a
        jp nz,queue_fail
        cp QUEUE_PROBE_MAX_ITEMS * 2 + 1
        jp nc,queue_fail
        srl a
        ld (queue_pack_remaining),a
        ld (queue_score_total),a
        ld (hl),a
        inc hl
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
queue_probe_pack_loop:
        ld a,(queue_pack_remaining)
        or a
        jr z,queue_append_score
        ld a,(de)
        ld c,a
        and 0xF0
        jp z,queue_fail
        cp 0x60
        jp nc,queue_fail
        ld a,c
        and 0x0F
        cp 6
        jp nc,queue_fail
        ld b,a
        ld a,c
        ld (hl),a
        inc de
        inc hl
        ld a,(de)
        ld c,a
        and 0x0F
        cp 3
        jp nz,queue_fail
        ld a,c
        and 0xF0
        cp 0x60
        jp nc,queue_fail
        jr z,queue_probe_third_ready
        ld a,b
        or a
        jp z,queue_fail
queue_probe_third_ready:
        ld a,c
        ld (hl),a
        inc de
        inc hl
        ld a,(queue_pack_remaining)
        dec a
        ld (queue_pack_remaining),a
        jr queue_probe_pack_loop

queue_build_progress:
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        cp 5
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET)
        or a
        jp z,queue_fail
        cp 5
        jp nc,queue_fail
        ; The two u16 values are position and total; require position <= total.
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 2)
        ld b,a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 4)
        cp b
        jp c,queue_fail
        jr nz,queue_progress_bounds_ready
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 1)
        ld b,a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 3)
        cp b
        jp c,queue_fail
queue_progress_bounds_ready:
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld b,5
queue_progress_copy:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_progress_copy
queue_build_payload_done:
        push hl
        ld de,queue_scr1_record
        or a
        sbc hl,de
        ld (queue_scr1_without_crc),hl
        ld de,7
        or a
        sbc hl,de
        ld (queue_scr1_record + 5),hl
        pop hl
        push hl
        ld bc,(queue_scr1_without_crc)
        ld hl,queue_scr1_record
        call crc16_ccitt_false
        pop hl
        ld (hl),e
        inc hl
        ld (hl),d
        inc hl
        ld de,queue_scr1_record
        or a
        sbc hl,de
        ld (queue_scr1_length),hl
        ld de,QUEUE_RESULT_MAX_BYTES + 1
        or a
        sbc hl,de
        jp nc,queue_fail
        or a
        ret

; Adaptive Study result mode 4. The continuation stores card telemetry at
; draft bytes 9..20 and quiz choices at bytes 33..44. Only prescribed counts
; are packed, keeping the exact SCR1 within the 69-byte Version-5/M ceiling.
queue_build_adaptive:
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        cp 45
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET)
        cp 'A'
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 1)
        cp 3
        jp nz,queue_fail
        call queue_adaptive_load_prescription
        ret c
        ld hl,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        ld a,(hl)
        inc hl
        and (hl)
        inc hl
        and (hl)
        cp 0xFF
        jp z,queue_fail
        xor a
        ld (queue_result_kind),a

        ld hl,queue_scr1_prefix
        ld de,queue_scr1_record
        ld bc,8
        ldir
        ex de,hl
        ld a,1                            ; responses, quiz module index 1
        ld (queue_scr1_record + 7),a
        ld a,(queue_device_length)
        ld (hl),a
        inc hl
        ld de,queue_device_id
        ld b,a
queue_adaptive_device_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_adaptive_device_loop
        ld de,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        ld b,3
queue_adaptive_sequence_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_adaptive_sequence_loop
        ld de,runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        ld a,(de)
        ld (hl),a
        inc hl
        ld de,runtime_state_record + RUNTIME_SCL_ARTIFACT_KEY_OFFSET
        ld b,10
queue_adaptive_key_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_adaptive_key_loop
        ld (hl),4
        inc hl
        ld a,(queue_adaptive_quiz_count)
        ld (hl),a
        inc hl
        ld de,queue_adaptive_code
        ld b,6
queue_adaptive_code_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_adaptive_code_loop
        ld a,(queue_adaptive_card_count)
        ld (hl),a
        inc hl
        xor a
        ld (queue_adaptive_index),a
queue_adaptive_card_loop:
        ld a,(queue_adaptive_index)
        ld b,a
        ld a,(queue_adaptive_card_count)
        cp b
        jr z,queue_adaptive_cards_done
        ld a,b
        ld e,a
        ld d,0
        push hl
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 9
        add hl,de
        ld a,(hl)
        pop hl
        ld c,a
        and 0x10
        jp z,queue_fail
        ld a,c
        and 0x0C
        jp z,queue_fail
        cp 0x0C
        jr z,queue_adaptive_card_valid
        ld a,c
        and 3
        ld b,a
        ld a,(queue_adaptive_exposure_cap)
        dec a
        cp b
        jp nz,queue_fail
queue_adaptive_card_valid:
        ld a,c
        and 0x0F
        ld c,a
        ld a,(queue_adaptive_index)
        and 1
        jr nz,queue_adaptive_card_low
        ld a,c
        rlca
        rlca
        rlca
        rlca
        ld (hl),a
        jr queue_adaptive_card_next
queue_adaptive_card_low:
        ld a,(hl)
        or c
        ld (hl),a
        inc hl
queue_adaptive_card_next:
        ld a,(queue_adaptive_index)
        inc a
        ld (queue_adaptive_index),a
        jr queue_adaptive_card_loop
queue_adaptive_cards_done:
        ld a,(queue_adaptive_card_count)
        and 1
        jr z,queue_adaptive_choice_begin
        inc hl
queue_adaptive_choice_begin:
        xor a
        ld (queue_adaptive_index),a
queue_adaptive_choice_loop:
        ld a,(queue_adaptive_index)
        ld b,a
        ld a,(queue_adaptive_quiz_count)
        cp b
        jr z,queue_adaptive_choices_done
        ld a,b
        ld e,a
        ld d,0
        push hl
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 33
        add hl,de
        ld a,(hl)
        pop hl
        or a
        jp z,queue_fail
        cp 6
        jp nc,queue_fail
        ld c,a
        ld a,(queue_adaptive_index)
        and 1
        jr nz,queue_adaptive_choice_low
        ld a,c
        rlca
        rlca
        rlca
        rlca
        ld (hl),a
        jr queue_adaptive_choice_next
queue_adaptive_choice_low:
        ld a,(hl)
        or c
        ld (hl),a
        inc hl
queue_adaptive_choice_next:
        ld a,(queue_adaptive_index)
        inc a
        ld (queue_adaptive_index),a
        jr queue_adaptive_choice_loop
queue_adaptive_choices_done:
        ld a,(queue_adaptive_quiz_count)
        and 1
        jr z,queue_adaptive_score
        inc hl
queue_adaptive_score:
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld b,a
        ld a,(queue_adaptive_quiz_count)
        cp b
        jp c,queue_fail
        ld a,b
        ld (hl),a
        inc hl
        jp queue_build_payload_done

; Extract the session code and policy from canonical SCSP and bind its learner
; and artifact key to the continuation before any queue mutation.
queue_adaptive_load_prescription:
        ld hl,queue_dsstudy_name
        ld de,queue_scsp_magic
        call sc_envelope_open
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(queue_device_length)
        cp b
        jp nz,queue_fail
        inc de
        ld hl,queue_device_id
queue_adaptive_prescription_device:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_adaptive_prescription_device
        inc de
        inc de
        inc de
        ld hl,queue_adaptive_code
        ld b,6
queue_adaptive_prescription_code:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        djnz queue_adaptive_prescription_code
        call queue_adaptive_skip_short
        ret c
        call queue_adaptive_skip_short
        ret c
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        call sc_record_read_byte
        ret c
        ld b,a
        inc de
        ld hl,(runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET)
        ld a,l
        cp c
        jp nz,queue_fail
        ld a,h
        cp b
        jp nz,queue_fail
        call sc_record_read_byte
        ret c
        cp 18
        jp nz,queue_fail
        inc de
        ld hl,queue_artifact_prefix
        ld b,8
queue_adaptive_prefix_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_adaptive_prefix_loop
        ld hl,runtime_state_record + RUNTIME_SCL_ARTIFACT_KEY_OFFSET
        ld b,10
queue_adaptive_artifact_key_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_adaptive_artifact_key_loop
        call queue_adaptive_skip_short       ; artifact variable
        ret c
        ld hl,35                            ; u16 length + digest + client
        add hl,de
        ret c
        ex de,hl
        call sc_record_read_byte
        ret c
        ld (queue_adaptive_card_count),a
        or a
        jp z,queue_fail
        cp 13
        jp nc,queue_fail
        inc de
        call sc_record_read_byte
        ret c
        ld (queue_adaptive_quiz_count),a
        or a
        jp z,queue_fail
        cp 13
        jp nc,queue_fail
        inc de
        call sc_record_read_byte
        ret c
        ld (queue_adaptive_exposure_cap),a
        ld b,a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 2)
        ld c,a
        ld a,(queue_adaptive_card_count)
        cp c
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 3)
        ld c,a
        ld a,(queue_adaptive_quiz_count)
        cp c
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 4)
        cp b
        jp nz,queue_fail
        or a
        ret

queue_adaptive_skip_short:
        call sc_record_read_byte
        ret c
        ld l,a
        ld h,0
        inc de
        add hl,de
        ret c
        ex de,hl
        or a
        ret

queue_validate_key_character:
        cp '2'
        jr c,queue_key_character_alpha
        cp '7' + 1
        jr c,queue_key_character_ok
queue_key_character_alpha:
        cp 'A'
        jr c,queue_key_character_fail
        cp 'Z' + 1
        jr nc,queue_key_character_fail
queue_key_character_ok:
        or a
        ret
queue_key_character_fail:
        scf
        ret

queue_load_identity:
        ld hl,queue_dsid_name
        ld de,queue_sci1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,queue_key_schema
        call sc_map_find_literal
        ret c
        ld hl,queue_identity_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,queue_fail
        ld de,(sc_record_root_offset)
        ld hl,queue_key_device_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,queue_device_id
        ld b,0
queue_identity_copy:
        ld a,(hl)
        or a
        jr z,queue_identity_done
        ld c,a
        ld a,b
        cp 16
        jp nc,queue_fail
        ld a,c
        cp '0'
        jp c,queue_fail
        cp '9' + 1
        jr c,queue_identity_store
        cp 'A'
        jp c,queue_fail
        cp 'Z' + 1
        jp nc,queue_fail
queue_identity_store:
        ld a,c
        ld (de),a
        inc de
        inc hl
        inc b
        jr queue_identity_copy
queue_identity_done:
        ld a,b
        cp 4
        jp c,queue_fail
        ld (queue_device_length),a
        or a
        ret

; Resolve an interrupted backup before reading or changing canonical DSQ.
queue_recover:
        ld hl,queue_dsqb_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        jr nc,queue_recover_backup_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jr z,queue_recover_canonical
        call queue_validate_canonical
        ret c
        ld hl,queue_dsqb_name
        call queue_delete_if_present
        or a
        ret
queue_recover_backup_present:
        call queue_validate_open
        jr c,queue_recover_bad_backup
        call queue_replace_from_backup
        ret
queue_recover_bad_backup:
        call queue_validate_canonical
        ret c
        ld hl,queue_dsqb_name
        call queue_delete_if_present
        or a
        ret
queue_recover_canonical:
        call queue_validate_canonical
        jr nc,queue_recover_done
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp nz,queue_fail
queue_recover_done:
        or a
        ret

queue_validate_canonical:
        ld hl,queue_dsq_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        jp queue_validate_open

; Validate current SCQ1 fixed body and detect exact target-sequence replay.
queue_validate_open:
        ld hl,QUEUE_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,queue_fail
        xor a
        ld (queue_record_exists),a
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(queue_device_length)
        cp b
        jp nz,queue_fail
        inc de
        ld hl,queue_device_id
queue_validate_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_validate_device_loop
        call sc_record_read_byte
        ret c
        ld (queue_existing_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp nz,queue_fail
        inc de
        ld a,(queue_existing_count)
        cp QUEUE_MAX_RECORDS + 1
        jp nc,queue_fail
        ld (queue_records_remaining),a
        xor a
        ld (queue_have_last),a
queue_validate_record_loop:
        ld a,(queue_records_remaining)
        or a
        jr z,queue_validate_records_done
        call sc_record_read_byte
        ret c
        ld l,a
        inc de
        call sc_record_read_byte
        ret c
        ld h,a
        inc de
        ld (queue_nested_length),hl
        ld (queue_nested_start),de
        ld bc,20
        or a
        sbc hl,bc
        jp c,queue_fail
        ld hl,(queue_nested_length)
        add hl,de
        jp c,queue_fail
        ld (queue_nested_end),hl
        push hl
        ld de,(sc_record_body_end)
        or a
        sbc hl,de
        pop hl
        jp c,queue_validate_nested_bounds
        jp nz,queue_fail
queue_validate_nested_bounds:
        call queue_validate_nested_header
        ret c
        call queue_require_increasing_sequence
        ret c
        ld a,(queue_record_exists)
        or a
        jr nz,queue_validate_record_next
        call queue_compare_target_sequence
        ret c
queue_validate_record_next:
        ld hl,queue_current_sequence
        ld de,queue_last_sequence
        ld bc,3
        ldir
        ld a,1
        ld (queue_have_last),a
        ld de,(queue_nested_end)
        ld a,(queue_records_remaining)
        dec a
        ld (queue_records_remaining),a
        jr queue_validate_record_loop
queue_validate_records_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,queue_fail
        ld a,(queue_record_exists)
        or a
        ret nz
        ld a,(queue_have_last)
        or a
        ret z
        ; New records must use exactly the successor of the last queue record.
        ld hl,(queue_last_sequence)
        ld a,(queue_last_sequence + 2)
        ld c,a
        inc hl
        jr nz,queue_expected_sequence_ready
        inc c
queue_expected_sequence_ready:
        ld de,(runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET)
        or a
        sbc hl,de
        jp nz,queue_fail
        ld a,(runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET + 2)
        cp c
        jp nz,queue_fail
        or a
        ret

queue_validate_nested_header:
        ld de,(queue_nested_start)
        ld hl,queue_scr1_magic
        ld b,4
queue_nested_magic_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_nested_magic_loop
        call sc_record_read_byte
        ret c
        cp 1
        jp nz,queue_fail
        inc de
        call sc_record_read_byte
        ret c
        ld l,a
        inc de
        call sc_record_read_byte
        ret c
        ld h,a
        ld bc,9
        add hl,bc
        ld de,(queue_nested_length)
        or a
        sbc hl,de
        jp nz,queue_fail
        ld de,(queue_nested_start)
        ld hl,7
        add hl,de
        push hl
        pop de
        call sc_record_read_byte
        ret c
        and 0x80
        cp QUEUE_KIND_RESPONSES
        jr z,queue_nested_kind_ready
        cp QUEUE_KIND_PROGRESS
        jp nz,queue_fail
queue_nested_kind_ready:
        inc de
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(queue_device_length)
        cp b
        jp nz,queue_fail
        inc de
        ld hl,queue_device_id
queue_nested_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        djnz queue_nested_device_loop
        ld hl,queue_current_sequence
        ld b,3
queue_nested_sequence_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc de
        inc hl
        djnz queue_nested_sequence_loop
        or a
        ret

; Existing canonical records must be strictly increasing by their u24
; identity, matching the backend/relay SCQ1 decoder. Compare most-significant
; bytes first; equality and regression are both corruption.
queue_require_increasing_sequence:
        ld a,(queue_have_last)
        or a
        ret z
        ld hl,queue_current_sequence + 2
        ld de,queue_last_sequence + 2
        ld b,3
queue_compare_increasing_sequence:
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jp c,queue_fail
        jr nz,queue_sequence_is_increasing
        dec hl
        dec de
        djnz queue_compare_increasing_sequence
        jp queue_fail
queue_sequence_is_increasing:
        or a
        ret

queue_compare_target_sequence:
        ld hl,queue_current_sequence
        ld de,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        ld b,3
queue_target_sequence_loop:
        ld a,(de)
        cp (hl)
        jr nz,queue_target_sequence_different
        inc de
        inc hl
        djnz queue_target_sequence_loop
        ld hl,(queue_nested_length)
        ld de,(queue_scr1_length)
        or a
        sbc hl,de
        jp nz,queue_fail
        ld de,(queue_nested_start)
        ld hl,queue_scr1_record
        ld bc,(queue_scr1_length)
queue_compare_exact_loop:
        ld a,b
        or c
        jr z,queue_compare_exact_done
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,queue_fail
        inc de
        inc hl
        dec bc
        jr queue_compare_exact_loop
queue_compare_exact_done:
        ld a,1
        ld (queue_record_exists),a
        or a
        ret
queue_target_sequence_different:
        or a
        ret

queue_append_result:
        call queue_validate_canonical
        jr nc,queue_append_existing
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp nz,queue_fail
        xor a
        ld (queue_existing_present),a
        ld hl,0
        ld (queue_existing_count),hl
        jr queue_append_size_missing
queue_append_existing:
        ld a,(queue_record_exists)
        or a
        ret nz
        ld a,1
        ld (queue_existing_present),a
        ld hl,(sc_record_length)
        ld (queue_existing_length),hl
        ld de,(queue_scr1_length)
        add hl,de
        inc hl
        inc hl
        jr queue_append_size_ready
queue_append_size_missing:
        ld a,(queue_device_length)
        ld l,a
        ld h,0
        ld de,14
        add hl,de
        ld de,(queue_scr1_length)
        add hl,de
queue_append_size_ready:
        ld (queue_candidate_length),hl
        ld de,QUEUE_MAX_BYTES + 1
        or a
        sbc hl,de
        jp nc,queue_fail
        call queue_create_candidate
        ret c
        ld a,(queue_existing_present)
        or a
        jr z,queue_write_empty_prefix
        ld hl,queue_dsq_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        ld hl,(queue_existing_length)
        dec hl
        dec hl
        ld (queue_append_offset),hl
        call queue_copy_open_to_candidate
        ret c
        jr queue_write_append
queue_write_empty_prefix:
        call queue_build_empty_prefix
        ld de,0
        ld bc,(queue_prefix_length)
        ld hl,queue_prefix
        call queue_copy_page_zero_to_candidate
        ret c
        ld hl,(queue_prefix_length)
        ld (queue_append_offset),hl
queue_write_append:
        ld hl,(queue_scr1_length)
        ld (queue_patch),hl
        ld de,(queue_append_offset)
        ld bc,2
        ld hl,queue_patch
        call queue_copy_page_zero_to_candidate
        ret c
        ld de,(queue_append_offset)
        inc de
        inc de
        ld bc,(queue_scr1_length)
        ld hl,queue_scr1_record
        call queue_copy_page_zero_to_candidate
        ret c
        ; Patch envelope payload length and queue count.
        ld hl,(queue_candidate_length)
        ld de,9
        or a
        sbc hl,de
        ld (queue_patch),hl
        ld de,5
        ld bc,2
        ld hl,queue_patch
        call queue_copy_page_zero_to_candidate
        ret c
        ld hl,(queue_existing_count)
        inc hl
        ld (queue_patch),hl
        ld a,(queue_device_length)
        add a,8
        ld e,a
        ld d,0
        ld bc,2
        ld hl,queue_patch
        call queue_copy_page_zero_to_candidate
        ret c
        call queue_finish_candidate_crc
        ret c
        ld hl,queue_dsqb_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        call queue_validate_open
        ret c
        ld a,(queue_record_exists)
        or a
        jp z,queue_fail
        jp queue_replace_from_backup

queue_create_candidate:
        ld hl,queue_dsqb_name
        call queue_delete_if_present
        call _memchk
        or a
        jr nz,queue_candidate_memory_ready
        ld de,(queue_candidate_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jp c,queue_fail
queue_candidate_memory_ready:
        ld hl,queue_dsqb_name
        rst 0x20
        ld hl,(queue_candidate_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (queue_candidate_addr),hl
        ld (queue_candidate_page),a
        or a
        ret

queue_build_empty_prefix:
        ; LDIR copies (HL) to (DE): seed the mutable candidate prefix from
        ; the immutable SCQ1 envelope, never the reverse.  Reversing these
        ; operands leaves DSQB zero-filled apart from later length patches.
        ld hl,queue_scq1_prefix
        ld de,queue_prefix
        ld bc,7
        ldir
        ; LDIR leaves HL at the immutable source and DE at the mutable
        ; prefix. Continue building through the destination buffer.
        ex de,hl
        ld a,(queue_device_length)
        ld (hl),a
        inc hl
        ld de,queue_device_id
        ld b,a
queue_prefix_device_loop:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz queue_prefix_device_loop
        ld (hl),1
        inc hl
        xor a
        ld (hl),a
        inc hl
        ld de,queue_prefix
        or a
        sbc hl,de
        ld (queue_prefix_length),hl
        ret

; Copy current open record bytes 0..HL-1 into candidate offset zero.
queue_copy_open_to_candidate:
        ld (queue_copy_length),hl
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(queue_candidate_page)
        ld hl,(queue_candidate_addr)
        call _set_abs_dest
        xor a
        ld hl,(queue_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret

; HL page-zero source, BC length, DE candidate offset.
queue_copy_page_zero_to_candidate:
        ld (queue_copy_source),hl
        ld (queue_copy_length),bc
        ld (queue_copy_offset),de
        xor a
        ld hl,(queue_copy_source)
        call _set_abs_src
        ld hl,(queue_candidate_addr)
        ld de,(queue_copy_offset)
        add hl,de
        ld a,(queue_candidate_page)
        adc a,0
        call _set_abs_dest
        xor a
        ld hl,(queue_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret

queue_finish_candidate_crc:
        ld a,(queue_candidate_page)
        ld (sc_record_base_page),a
        ld hl,(queue_candidate_addr)
        ld (sc_record_base_addr),hl
        ld hl,(queue_candidate_length)
        ld (sc_record_length),hl
        dec hl
        dec hl
        ld (queue_crc_remaining),hl
        xor a
        ld (sc_cache_valid),a
        ld (queue_crc_offset),a
        ld (queue_crc_offset + 1),a
        ld hl,0xFFFF
        ld (queue_crc),hl
queue_candidate_crc_loop:
        ld hl,(queue_crc_remaining)
        ld a,h
        or l
        jr z,queue_candidate_crc_done
        dec hl
        ld (queue_crc_remaining),hl
        ld de,(queue_crc_offset)
        call sc_record_read_byte
        ret c
        ld hl,(queue_crc)
        xor h
        ld h,a
        ld b,8
queue_candidate_crc_bit:
        bit 7,h
        jr z,queue_candidate_crc_shift
        sla l
        rl h
        ld a,h
        xor 0x10
        ld h,a
        ld a,l
        xor 0x21
        ld l,a
        jr queue_candidate_crc_bit_done
queue_candidate_crc_shift:
        sla l
        rl h
queue_candidate_crc_bit_done:
        djnz queue_candidate_crc_bit
        ld (queue_crc),hl
        ld hl,(queue_crc_offset)
        inc hl
        ld (queue_crc_offset),hl
        jr queue_candidate_crc_loop
queue_candidate_crc_done:
        ld hl,(queue_crc)
        ld (queue_patch),hl
        ld de,(queue_candidate_length)
        dec de
        dec de
        ld bc,2
        ld hl,queue_patch
        jp queue_copy_page_zero_to_candidate

; Promote verified DSQB to DSQ, validate canonical, then remove backup.
queue_replace_from_backup:
        ld hl,queue_dsqb_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        call queue_validate_open
        ret c
        ld hl,(sc_record_length)
        ld (queue_copy_length),hl
        ld hl,queue_dsq_name
        call queue_delete_if_present
        ld hl,queue_dsq_name
        rst 0x20
        ld hl,(queue_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (queue_dest_addr),hl
        ld (queue_dest_page),a
        ld hl,queue_dsqb_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(queue_dest_page)
        ld hl,(queue_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(queue_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        ld hl,queue_dsq_name
        ld de,queue_scq1_magic
        call sc_envelope_open
        ret c
        call queue_validate_open
        ret c
        ld hl,queue_dsqb_name
        call queue_delete_if_present
        or a
        ret

queue_advance_local_state:
        ld hl,runtime_state_record + RUNTIME_SCL_NEXT_SEQUENCE_OFFSET
        inc (hl)
        jr nz,queue_sequence_advanced
        inc hl
        inc (hl)
        jr nz,queue_sequence_advanced
        inc hl
        inc (hl)
        jr z,queue_fail
queue_sequence_advanced:
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        and 0xFD
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1),a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp QUEUE_DRAFT_ADAPTIVE
        jr z,queue_advance_adaptive
        ld a,(queue_result_kind)
        cp QUEUE_KIND_PROGRESS
        jr z,queue_advance_clear_draft
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 1),a
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 2),a
        ld a,QUEUE_DRAFT_SCORE
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld a,3
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0xEC
        or 0x02
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        jr queue_advance_common
queue_advance_clear_draft:
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0xEC
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
queue_advance_common:
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET + 1),a
        ld a,(queue_result_kind)
        cp QUEUE_KIND_PROGRESS
        jr z,queue_advance_view_ready
        ld a,6
        ld (runtime_state_record + RUNTIME_SCL_VIEW_OFFSET),a
queue_advance_view_ready:
        jp runtime_state_save
queue_advance_adaptive:
        ; Retain the completed continuation so the same code can reopen Result
        ; while its immutable queue record awaits cable acknowledgement.
        ld a,3
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 1),a
        jp runtime_state_save

queue_delete_if_present:
        rst 0x20
        rst 0x10
        ret c
        call _delvar
        ret

queue_fail:
        ld a,RUNTIME_ERROR_SAVE
        ld (runtime_error),a
        scf
        ret

queue_device_length:     defb 0
queue_device_id:         defs 16,0
queue_scr1_record:       defs QUEUE_RESULT_MAX_BYTES,0
queue_scr1_without_crc:  defw 0
queue_scr1_length:       defw 0
queue_result_kind:       defb 0
queue_pack_remaining:    defb 0
queue_score_total:        defb 0
queue_adaptive_card_count: defb 0
queue_adaptive_quiz_count: defb 0
queue_adaptive_exposure_cap: defb 0
queue_adaptive_index:      defb 0
queue_adaptive_code:       defs 6,0
queue_record_exists:     defb 0
queue_existing_present:  defb 0
queue_existing_count:    defw 0
queue_existing_length:   defw 0
queue_records_remaining: defb 0
queue_have_last:         defb 0
queue_last_sequence:     defs 3,0
queue_current_sequence:  defs 3,0
queue_nested_length:     defw 0
queue_nested_start:      defw 0
queue_nested_end:        defw 0
queue_candidate_length:  defw 0
queue_candidate_addr:    defw 0
queue_candidate_page:    defb 0
queue_dest_addr:         defw 0
queue_dest_page:         defb 0
queue_append_offset:     defw 0
queue_prefix:            defs 26,0
queue_prefix_length:     defw 0
queue_patch:             defw 0
queue_copy_source:       defw 0
queue_copy_length:       defw 0
queue_copy_offset:       defw 0
queue_crc:               defw 0
queue_crc_offset:        defw 0
queue_crc_remaining:     defw 0

queue_scr1_prefix: defb "SCR1",1,0,0,0
queue_scq1_prefix: defb "SCQ1",1,0,0,0
queue_scr1_magic:  defb "SCR1"
queue_scq1_magic:  defb "SCQ1"
queue_sci1_magic:  defb "SCI1"
queue_scsp_magic:  defb "SCSP"
queue_artifact_prefix: defb "sc:ti86:"
queue_key_schema:  defb "schema",0
queue_key_device_id: defb "deviceId",0
queue_identity_schema: defb "school.calc.device-identity/v1",0

queue_dsid_name: defb 0x0C,4,"DSID",0,0,0,0
queue_dsstudy_name: defb 0x0C,7,"DSSTUDY",0
queue_dsq_name:  defb 0x0C,3,"DSQ",0,0,0,0,0
queue_dsqb_name: defb 0x0C,4,"DSQB",0,0,0,0
