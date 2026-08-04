; SchoolCalc durable adaptive-tutoring runtime.
;
; SCTUTOR is generic: it knows learner-scoped follow-up actions, bounded text,
; A-E choices, cursors, and mastery percentages, but no school subject. The
; single SCTQ request is durable before SCREEN_SYNC is committed. A relay-
; staged SCTR response cannot replace DSTURN until its envelope, complete
; structure, calculator identity, learner, and request ID all validate.

include "ti86asm.inc"

TUTOR_REQUEST_MAX_BYTES:   equ 512
TUTOR_RESPONSE_MAX_BYTES:  equ 2048
TUTOR_PROGRESS_MAX_BYTES:  equ 4096
TUTOR_REQUEST_BUFFER_BYTES:equ 256
TUTOR_TEXT_BUFFER_BYTES:   equ 384
TUTOR_VIEW_CATALOG:        equ 1
TUTOR_VIEW_SYNC:           equ 7
TUTOR_DISP_COMPLETE:       equ 1
TUTOR_DISP_PROCESSING:     equ 2
TUTOR_DISP_UNAVAILABLE:    equ 3
TUTOR_DISP_RETRYABLE:      equ 4
TUTOR_ACTION_INVOKE:       equ 1
TUTOR_ACTION_CHOICE:       equ 2
TUTOR_ACTION_CANCEL:       equ 3
TUTOR_ACTION_SKIP:         equ 4
TUTOR_ACTION_EXPLAIN:      equ 5
TUTOR_ACTION_CHALLENGE:    equ 6
TUTOR_CONTROL_STOP:        equ 1
TUTOR_CONTROL_SKIP:        equ 2
TUTOR_CONTROL_EXPLAIN:     equ 4
TUTOR_CONTROL_CHALLENGE:   equ 8
TUTOR_PAGE_MESSAGE:        equ 1
TUTOR_PAGE_RATIONALE:      equ 2
TUTOR_PAGE_BODY:           equ 3
TUTOR_PAGE_PROMPT:         equ 4
TUTOR_PAGE_CHOICES:        equ 5
TUTOR_STAGE_NONE:          equ 0
TUTOR_STAGE_PROMOTED:      equ 1
TUTOR_STAGE_INVALID:       equ 2

org _asm_exec_ram

        nop
        jp tutor_runtime_start
        defw 0
        defw tutor_runtime_name
        defb "SCX1"
        defb 1
        defb 9                 ; closed registry code: realtime tutor
        defb 0
        defw 0
        defw 0
        defw 0

tutor_runtime_name: defb 0

tutor_runtime_start:
        ; SCHLCALC validates the immutable Program variable before this child
        ; is loaded into the shared execution window.
        call _runindicoff
        call sc_input_init
        xor a
        ld (tutor_state_ready),a
        call scstate_load
        jp c,tutor_fail_state
        ld a,1
        ld (tutor_state_ready),a
        call tutor_detect_identity
        jp c,tutor_fail_identity
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jp z,tutor_fail_learner

        call tutor_promote_stage
        call tutor_open_response
        jp nc,tutor_response_ready
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp nz,tutor_fail_response
        ld a,(tutor_stage_status)
        cp TUTOR_STAGE_INVALID
        jp z,tutor_fail_response

        ; A retained request is an exact retry, never a second logical turn.
        call tutor_open_request
        jp nc,tutor_route_existing_request
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jp nz,tutor_fail_request

        call tutor_find_progress_followup
        jp c,tutor_fail_unavailable
        call tutor_build_invoke_request
        jp c,tutor_fail_request
        jp tutor_commit_new_request

tutor_response_ready:
        call tutor_build_pages
        jp tutor_render

; ---------------------------------------------------------------------------
; Device identity

tutor_detect_identity:
        xor a
        ld (tutor_device_length),a
        ld hl,tutor_device_id
        ld b,17
tutor_identity_clear:
        ld (hl),a
        inc hl
        djnz tutor_identity_clear
        ld hl,tutor_identity_name
        ld de,tutor_sci1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,tutor_field_schema
        call sc_map_find_literal
        ret c
        ld hl,tutor_identity_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,tutor_identity_fail
        ld de,(sc_record_root_offset)
        ld hl,tutor_field_device_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,tutor_device_id
        ld b,0
tutor_identity_copy:
        ld a,(hl)
        or a
        jr z,tutor_identity_done
        ld c,a
        ld a,b
        cp 16
        jr nc,tutor_identity_fail
        ld a,c
        cp '0'
        jr c,tutor_identity_fail
        cp '9' + 1
        jr c,tutor_identity_store
        cp 'A'
        jr c,tutor_identity_fail
        cp 'Z' + 1
        jr nc,tutor_identity_fail
tutor_identity_store:
        ld a,c
        ld (de),a
        inc de
        inc hl
        inc b
        jr tutor_identity_copy
tutor_identity_done:
        ld a,b
        cp 4
        jr c,tutor_identity_fail
        ld (tutor_device_length),a
        or a
        ret
tutor_identity_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; SCTR validation. All offsets are relative to the String record, not RAM.

tutor_open_response:
        ld hl,tutor_response_name
        ld de,tutor_sctr_magic
        call sc_envelope_open
        ret c
        jp tutor_validate_response_open

tutor_validate_response_open:
        ld hl,TUTOR_RESPONSE_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,tutor_response_invalid
        call tutor_clear_response_fields
        ld de,7
        call tutor_validate_device_short
        jp c,tutor_response_invalid
        call tutor_read_u16_de
        jp c,tutor_response_invalid
        ld bc,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        or a
        sbc hl,bc
        jp nz,tutor_response_invalid

        call tutor_read_u24_de
        jp c,tutor_response_invalid
        ld (tutor_response_request_id),hl
        ld (tutor_response_request_id + 2),a
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp TUTOR_DISP_COMPLETE
        jp c,tutor_response_invalid
        cp TUTOR_DISP_RETRYABLE + 1
        jp nc,tutor_response_invalid
        ld (tutor_response_disposition),a
        inc de

        call sc_record_read_byte
        jp c,tutor_response_invalid
        ld l,a
        ld h,0
        ld (tutor_message_length),hl
        inc de
        ld (tutor_message_offset),de
        ld a,1
        call tutor_validate_text_hl
        jp c,tutor_response_invalid

        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 2
        jp nc,tutor_response_invalid
        ld (tutor_has_session),a
        inc de
        or a
        jp z,tutor_response_done

        call tutor_read_locator
        jp c,tutor_response_invalid
        ld (tutor_session_offset),bc
        ld (tutor_session_length),a
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 1
        jp c,tutor_response_invalid
        cp 7
        jp nc,tutor_response_invalid
        ld (tutor_session_status),a
        inc de
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 101
        jp nc,tutor_response_invalid
        ld (tutor_mastery_percent),a
        inc de
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 101
        jp nc,tutor_response_invalid
        ld (tutor_target_percent),a
        inc de
        call tutor_read_u16_de
        jp c,tutor_response_invalid
        ld (tutor_next_client_sequence),hl
        call tutor_read_u16_de
        jp c,tutor_response_invalid
        ld (tutor_latest_server_sequence),hl
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 1
        jp c,tutor_response_invalid
        cp 16
        jp nc,tutor_response_invalid
        ld (tutor_control_mask),a
        inc de

        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 2
        jp nc,tutor_response_invalid
        ld (tutor_has_answer),a
        inc de
        or a
        jr z,tutor_response_answer_done
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 1
        jp c,tutor_response_invalid
        cp 6
        jp nc,tutor_response_invalid
        ld (tutor_answer_choice),a
        inc de
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 2
        jp nc,tutor_response_invalid
        ld (tutor_answer_correct),a
        inc de
        call tutor_read_u16_de
        jp c,tutor_response_invalid
        push hl
        ld bc,361
        or a
        sbc hl,bc
        pop hl
        jp nc,tutor_response_invalid
        ld (tutor_rationale_length),hl
        ld (tutor_rationale_offset),de
        ld a,1
        call tutor_validate_text_hl
        jp c,tutor_response_invalid
tutor_response_answer_done:
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 2
        jp nc,tutor_response_invalid
        ld (tutor_has_turn),a
        inc de
        or a
        jp z,tutor_response_done

        call tutor_read_locator
        jp c,tutor_response_invalid
        ld (tutor_turn_offset),bc
        ld (tutor_turn_length),a
        call tutor_read_u16_de
        jp c,tutor_response_invalid
        ld a,h
        or l
        jp z,tutor_response_invalid
        ld (tutor_turn_server_sequence),hl

        call tutor_read_u16_de
        jp c,tutor_response_invalid
        push hl
        ld bc,361
        or a
        sbc hl,bc
        pop hl
        jp nc,tutor_response_invalid
        ld (tutor_body_length),hl
        ld (tutor_body_offset),de
        ld a,1
        call tutor_validate_text_hl
        jp c,tutor_response_invalid

        call tutor_read_u16_de
        jp c,tutor_response_invalid
        push hl
        ld bc,241
        or a
        sbc hl,bc
        pop hl
        jp nc,tutor_response_invalid
        ld (tutor_prompt_length),hl
        ld (tutor_prompt_offset),de
        ld a,1
        call tutor_validate_text_hl
        jp c,tutor_response_invalid

        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 2
        jp c,tutor_response_invalid
        cp 6
        jp nc,tutor_response_invalid
        ld (tutor_choice_count),a
        inc de
        xor a
        ld (tutor_parse_index),a
tutor_response_choice_loop:
        ld a,(tutor_parse_index)
        ld b,a
        ld a,(tutor_choice_count)
        cp b
        jr z,tutor_response_done
        call sc_record_read_byte
        jp c,tutor_response_invalid
        cp 24
        jp nc,tutor_response_invalid
        ld (tutor_field_length_byte),a
        inc de
        push de
        call tutor_store_choice_field
        pop de
        ld a,(tutor_field_length_byte)
        ld l,a
        ld h,0
        xor a
        call tutor_validate_text_hl
        jp c,tutor_response_invalid
        ld a,(tutor_parse_index)
        inc a
        ld (tutor_parse_index),a
        jr tutor_response_choice_loop

tutor_response_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr nz,tutor_response_invalid
        or a
        ret
tutor_response_invalid:
        scf
        ret

tutor_clear_response_fields:
        xor a
        ld hl,tutor_response_fields_start
        ld b,tutor_response_fields_end - tutor_response_fields_start
tutor_clear_response_loop:
        ld (hl),a
        inc hl
        djnz tutor_clear_response_loop
        ret

; Validate the response/request short device ID and advance DE.
tutor_validate_device_short:
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(tutor_device_length)
        cp b
        jr nz,tutor_device_short_fail
        inc de
        ld hl,tutor_device_id
tutor_device_short_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jr nz,tutor_device_short_fail
        inc hl
        inc de
        djnz tutor_device_short_loop
        or a
        ret
tutor_device_short_fail:
        scf
        ret

; Read a 1..95 printable locator. Returns A=length, BC=offset, advances DE.
tutor_read_locator:
        call sc_record_read_byte
        ret c
        or a
        jr z,tutor_locator_fail
        cp 96
        jr nc,tutor_locator_fail
        ld (tutor_field_length_byte),a
        inc de
        push de
        pop bc
        ld l,a
        ld h,0
        xor a
        call tutor_validate_text_hl
        ret c
        ld a,(tutor_field_length_byte)
        or a
        ret
tutor_locator_fail:
        scf
        ret

; HL=length, DE=offset, A=1 allows LF in addition to printable ASCII.
; Advances DE exactly length bytes.
tutor_validate_text_hl:
        ld (tutor_text_allow_newline),a
        ld (tutor_text_remaining),hl
tutor_validate_text_loop:
        ld hl,(tutor_text_remaining)
        ld a,h
        or l
        ret z
        call sc_record_read_byte
        ret c
        cp 10
        jr nz,tutor_validate_printable
        ld a,(tutor_text_allow_newline)
        or a
        jr z,tutor_text_invalid
        jr tutor_validate_text_next
tutor_validate_printable:
        cp 0x20
        jr c,tutor_text_invalid
        cp 0x7F
        jr nc,tutor_text_invalid
tutor_validate_text_next:
        inc de
        ld hl,(tutor_text_remaining)
        dec hl
        ld (tutor_text_remaining),hl
        jr tutor_validate_text_loop
tutor_text_invalid:
        scf
        ret

tutor_read_u16_de:
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

; Returns low 16 bits in HL and high byte in A; advances DE.
tutor_read_u24_de:
        call tutor_read_u16_de
        ret c
        push hl
        call sc_record_read_byte
        jr c,tutor_read_u24_fail
        inc de
        ld b,a
        pop hl
        ld a,b
        or a
        ret
tutor_read_u24_fail:
        pop hl
        scf
        ret

tutor_store_choice_field:
        ld a,(tutor_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,tutor_choice_offsets
        add hl,bc
        ld (hl),e
        inc hl
        ld (hl),d
        ld a,(tutor_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld bc,tutor_choice_lengths
        add hl,bc
        ld a,(tutor_field_length_byte)
        ld (hl),a
        ret

; ---------------------------------------------------------------------------
; SCTQ validation and exact retry identity.

tutor_open_request:
        ld hl,tutor_request_name
        ld de,tutor_sctq_magic
        call sc_envelope_open
        ret c
        jp tutor_validate_request_open

tutor_validate_request_open:
        ld hl,TUTOR_REQUEST_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,tutor_request_invalid
        ld de,7
        call tutor_validate_device_short
        jp c,tutor_request_invalid
        call tutor_read_u16_de
        jp c,tutor_request_invalid
        ld bc,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        or a
        sbc hl,bc
        jp nz,tutor_request_invalid
        call tutor_read_u24_de
        jp c,tutor_request_invalid
        ld (tutor_request_id),hl
        ld (tutor_request_id + 2),a
        call sc_record_read_byte
        jp c,tutor_request_invalid
        cp 1
        jp c,tutor_request_invalid
        cp 7
        jp nc,tutor_request_invalid
        ld (tutor_request_action),a
        inc de
        call tutor_read_u16_de
        jp c,tutor_request_invalid
        ld (tutor_request_client_sequence),hl
        call tutor_read_u16_de
        jp c,tutor_request_invalid
        ld (tutor_request_server_sequence),hl
        ld a,(tutor_request_action)
        cp TUTOR_ACTION_INVOKE
        jr z,tutor_validate_request_invoke
        call tutor_read_locator
        jp c,tutor_request_invalid
        ld a,(tutor_request_action)
        cp TUTOR_ACTION_CANCEL
        jr z,tutor_validate_request_done
        call tutor_read_locator
        jp c,tutor_request_invalid
        ld a,(tutor_request_action)
        cp TUTOR_ACTION_CHOICE
        jr nz,tutor_validate_request_done
        call sc_record_read_byte
        jp c,tutor_request_invalid
        cp 1
        jp c,tutor_request_invalid
        cp 6
        jp nc,tutor_request_invalid
        inc de
        jr tutor_validate_request_done
tutor_validate_request_invoke:
        call sc_record_read_byte
        jp c,tutor_request_invalid
        cp 10
        jp nz,tutor_request_invalid
        inc de
        ld hl,tutor_followup_key
        ld b,10
tutor_validate_request_key_loop:
        call sc_record_read_byte
        jp c,tutor_request_invalid
        ld (hl),a
        inc hl
        inc de
        djnz tutor_validate_request_key_loop
        ld hl,tutor_followup_key
        call tutor_validate_base32_key
        jp c,tutor_request_invalid
tutor_validate_request_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr nz,tutor_request_invalid
        or a
        ret
tutor_request_invalid:
        scf
        ret

tutor_validate_base32_key:
        ld b,10
tutor_base32_loop:
        ld a,(hl)
        cp '2'
        jr c,tutor_base32_alpha
        cp '7' + 1
        jr c,tutor_base32_next
tutor_base32_alpha:
        cp 'A'
        jr c,tutor_base32_fail
        cp 'Z' + 1
        jr nc,tutor_base32_fail
tutor_base32_next:
        inc hl
        djnz tutor_base32_loop
        or a
        ret
tutor_base32_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Recoverable DSTNEW -> DSTURN promotion.

tutor_promote_stage:
        xor a
        ld (tutor_stage_status),a
        ld hl,tutor_stage_name
        ld de,tutor_sctr_magic
        call sc_envelope_open
        jr nc,tutor_stage_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        jr tutor_stage_invalid
tutor_stage_present:
        call tutor_validate_response_open
        jr c,tutor_stage_invalid
        call tutor_cache_stage_identity

        ; Normal path: require the exact durable request being answered.
        call tutor_open_request
        jr c,tutor_stage_without_request
        call tutor_stage_matches_request
        jr c,tutor_stage_invalid
        jr tutor_stage_copy

        ; Recovery path for a cut after acknowledged-request deletion but
        ; before staged-response deletion: a valid canonical with the same
        ; request identity proves this is the already-committed transaction.
tutor_stage_without_request:
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        jr nz,tutor_stage_invalid
        call tutor_open_response
        jr c,tutor_stage_invalid
        call tutor_stage_matches_response
        jr c,tutor_stage_invalid

tutor_stage_copy:
        call tutor_copy_stage
        jr c,tutor_stage_invalid
        call tutor_open_response
        jr c,tutor_stage_invalid
        call tutor_stage_matches_response
        jr c,tutor_stage_invalid
        ld a,(tutor_stage_disposition)
        cp TUTOR_DISP_COMPLETE
        jr z,tutor_stage_acknowledge
        cp TUTOR_DISP_UNAVAILABLE
        jr nz,tutor_stage_delete_staging
tutor_stage_acknowledge:
        ld hl,tutor_request_name
        call tutor_delete_if_present
tutor_stage_delete_staging:
        ld hl,tutor_stage_name
        call tutor_delete_if_present
        ld a,TUTOR_STAGE_PROMOTED
        ld (tutor_stage_status),a
        or a
        ret
tutor_stage_invalid:
        ld a,TUTOR_STAGE_INVALID
        ld (tutor_stage_status),a
        or a
        ret

tutor_cache_stage_identity:
        ld hl,(sc_record_length)
        ld (tutor_copy_length),hl
        ld hl,(tutor_response_request_id)
        ld (tutor_stage_request_id),hl
        ld a,(tutor_response_request_id + 2)
        ld (tutor_stage_request_id + 2),a
        ld a,(tutor_response_disposition)
        ld (tutor_stage_disposition),a
        ret

tutor_stage_matches_request:
        ld hl,(tutor_stage_request_id)
        ld de,(tutor_request_id)
        or a
        sbc hl,de
        jr nz,tutor_stage_match_fail
        ld a,(tutor_stage_request_id + 2)
        ld b,a
        ld a,(tutor_request_id + 2)
        cp b
        ret z
tutor_stage_match_fail:
        scf
        ret

tutor_stage_matches_response:
        ld hl,(tutor_stage_request_id)
        ld de,(tutor_response_request_id)
        or a
        sbc hl,de
        jr nz,tutor_stage_match_fail
        ld a,(tutor_stage_request_id + 2)
        ld b,a
        ld a,(tutor_response_request_id + 2)
        cp b
        ret z
        scf
        ret

tutor_copy_stage:
        ld hl,(tutor_copy_length)
        call _memchk
        or a
        jr nz,tutor_copy_memory_ready
        ld de,(tutor_copy_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jr c,tutor_copy_fail
tutor_copy_memory_ready:
        ld hl,tutor_response_name
        call tutor_delete_if_present
        ld hl,tutor_response_name
        rst 0x20
        ld hl,(tutor_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (tutor_copy_dest_addr),hl
        ld (tutor_copy_dest_page),a
        ld hl,tutor_stage_name
        ld de,tutor_sctr_magic
        call sc_envelope_open
        jr c,tutor_copy_delete_target
        call tutor_validate_response_open
        jr c,tutor_copy_delete_target
        call tutor_stage_matches_response
        jr c,tutor_copy_delete_target
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(tutor_copy_dest_page)
        ld hl,(tutor_copy_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(tutor_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret
tutor_copy_delete_target:
        ld hl,tutor_response_name
        call tutor_delete_if_present
tutor_copy_fail:
        scf
        ret

tutor_delete_if_present:
        rst 0x20
        rst 0x10
        ret c
        call _delvar
        ret

; ---------------------------------------------------------------------------
; Resolve the first connected remediation follow-up for the selected learner
; from the complete, CRC-checked SCG1 projection. Subjects remain opaque.

tutor_find_progress_followup:
        xor a
        ld (tutor_followup_found),a
        ld (tutor_progress_profile_found),a
        ld hl,tutor_progress_name
        ld de,tutor_scg1_magic
        call sc_envelope_open
        jp c,tutor_progress_fail
        ld hl,TUTOR_PROGRESS_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,tutor_progress_fail
        ld de,7
        call tutor_validate_device_short
        jp c,tutor_progress_fail
        ld hl,10
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
        call sc_record_read_byte
        jp c,tutor_progress_fail
        cp 17
        jp nc,tutor_progress_fail
        ld (tutor_progress_remaining),a
        inc de
tutor_progress_profile_loop:
        ld a,(tutor_progress_remaining)
        or a
        jp z,tutor_progress_done
        call tutor_read_u16_de
        jp c,tutor_progress_fail
        ld bc,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        or a
        sbc hl,bc
        ld a,0
        jr nz,tutor_progress_selected_ready
        inc a
        ld (tutor_progress_profile_found),a
tutor_progress_selected_ready:
        ld (tutor_progress_selected),a
        ld hl,39                    ; counters + score + profile key
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
        call sc_record_read_byte
        jp c,tutor_progress_fail
        cp 2
        jp nc,tutor_progress_fail
        ld (tutor_progress_recent),a
        inc de
        or a
        jr z,tutor_progress_recent_done
        ld hl,16                    ; correct,total,score,verification,key
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
        call sc_record_read_byte
        jp c,tutor_progress_fail
        cp 13
        jp nc,tutor_progress_fail
        ld l,a
        ld h,0
        inc de
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
tutor_progress_recent_done:
        call sc_record_read_byte
        jp c,tutor_progress_fail
        cp 3
        jp nc,tutor_progress_fail
        ld (tutor_progress_followups),a
        inc de
tutor_progress_followup_loop:
        ld a,(tutor_progress_followups)
        or a
        jr z,tutor_progress_profile_done
        ld hl,tutor_progress_temp_key
        ld b,10
tutor_progress_key_loop:
        call sc_record_read_byte
        jp c,tutor_progress_fail
        ld (hl),a
        inc hl
        inc de
        djnz tutor_progress_key_loop
        ld hl,tutor_progress_temp_key
        call tutor_validate_base32_key
        jp c,tutor_progress_fail
        call sc_record_read_byte
        jp c,tutor_progress_fail
        ld b,a
        inc de
        call sc_record_read_byte
        jp c,tutor_progress_fail
        ld c,a
        inc de
        ld hl,2                    ; priority
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
        ld a,(tutor_progress_selected)
        or a
        jr z,tutor_progress_action_done
        ld a,(tutor_followup_found)
        or a
        jr nz,tutor_progress_action_done
        ld a,b
        cp 5                       ; remediation
        jr nz,tutor_progress_action_done
        ld a,c
        cp 2                       ; requires_connection
        jr nz,tutor_progress_action_done
        push de
        ld hl,tutor_progress_temp_key
        ld de,tutor_followup_key
        ld bc,10
        ldir
        pop de
        ld a,1
        ld (tutor_followup_found),a
tutor_progress_action_done:
        call sc_record_read_byte
        jp c,tutor_progress_fail
        cp 21
        jp nc,tutor_progress_fail
        ld l,a
        ld h,0
        inc de
        call tutor_skip_de_hl
        jp c,tutor_progress_fail
        ld a,(tutor_progress_followups)
        dec a
        ld (tutor_progress_followups),a
        jr tutor_progress_followup_loop
tutor_progress_profile_done:
        ld a,(tutor_progress_remaining)
        dec a
        ld (tutor_progress_remaining),a
        jp tutor_progress_profile_loop
tutor_progress_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr nz,tutor_progress_fail
        ld a,(tutor_progress_profile_found)
        or a
        jr z,tutor_progress_fail
        ld a,(tutor_followup_found)
        or a
        jr z,tutor_progress_fail
        or a
        ret
tutor_progress_fail:
        scf
        ret

; Advance DE by HL without crossing body_end.
tutor_skip_de_hl:
        add hl,de
        jr c,tutor_skip_fail
        ex de,hl
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr c,tutor_skip_fail
        or a
        ret
tutor_skip_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Build one fixed SCTQ record in executable RAM.

tutor_build_invoke_request:
        call tutor_request_begin
        call tutor_emit_common_request
        ret c
        ld a,TUTOR_ACTION_INVOKE
        call tutor_emit_byte
        xor a
        ld h,a
        ld l,a
        call tutor_emit_word
        call tutor_emit_word
        ld a,10
        call tutor_emit_byte
        ld hl,tutor_followup_key
        ld b,10
tutor_emit_followup_key_loop:
        ld a,(hl)
        call tutor_emit_byte
        inc hl
        djnz tutor_emit_followup_key_loop
        jp tutor_request_finish

; A = one-based choice code. The canonical SCTR must still be open.
tutor_build_choice_request:
        ld (tutor_selected_choice),a
        ld a,TUTOR_ACTION_CHOICE
        jr tutor_build_session_action_request

; A = skip/explain/challenge. Cancel enters at the label below. The canonical
; SCTR must still be open so the compact locators can be copied exactly.
tutor_build_control_request:
        jr tutor_build_session_action_request
tutor_build_cancel_request:
        ld a,TUTOR_ACTION_CANCEL
tutor_build_session_action_request:
        ld (tutor_selected_action),a
        call tutor_request_begin
        call tutor_emit_common_request
        ret c
        ld a,(tutor_selected_action)
        call tutor_emit_byte
        ld hl,(tutor_next_client_sequence)
        call tutor_emit_word
        ld hl,(tutor_latest_server_sequence)
        call tutor_emit_word
        ld a,(tutor_session_length)
        call tutor_emit_byte
        ld de,(tutor_session_offset)
        ld a,(tutor_session_length)
        call tutor_emit_record_bytes
        ret c
        ld a,(tutor_selected_action)
        cp TUTOR_ACTION_CANCEL
        jp z,tutor_request_finish
        ld a,(tutor_turn_length)
        call tutor_emit_byte
        ld de,(tutor_turn_offset)
        ld a,(tutor_turn_length)
        call tutor_emit_record_bytes
        ret c
        ld a,(tutor_selected_action)
        cp TUTOR_ACTION_CHOICE
        jp nz,tutor_request_finish
        ld a,(tutor_selected_choice)
        call tutor_emit_byte
        jp tutor_request_finish

tutor_request_begin:
        ld hl,tutor_request_buffer
        ld (tutor_request_pointer),hl
        ld hl,tutor_sctq_magic
        ld b,4
tutor_request_magic_loop:
        ld a,(hl)
        call tutor_emit_byte
        inc hl
        djnz tutor_request_magic_loop
        ld a,1
        call tutor_emit_byte
        xor a
        call tutor_emit_byte
        call tutor_emit_byte
        ret

; Emit device, learner, and the current u24 request ID. Action/cursors follow.
tutor_emit_common_request:
        ld hl,scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET
        ld a,(hl)
        inc hl
        and (hl)
        inc hl
        and (hl)
        cp 0xFF
        jr z,tutor_emit_common_fail
        ld a,(tutor_device_length)
        call tutor_emit_byte
        ld hl,tutor_device_id
        ld b,a
tutor_emit_device_loop:
        ld a,(hl)
        call tutor_emit_byte
        inc hl
        djnz tutor_emit_device_loop
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        call tutor_emit_word
        ld hl,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET)
        ld a,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET + 2)
        ld (tutor_new_request_id),hl
        ld (tutor_new_request_id + 2),a
        ld a,l
        call tutor_emit_byte
        ld a,h
        call tutor_emit_byte
        ld a,(tutor_new_request_id + 2)
        call tutor_emit_byte
        or a
        ret
tutor_emit_common_fail:
        scf
        ret

tutor_emit_byte:
        push hl
        ld hl,(tutor_request_pointer)
        ld (hl),a
        inc hl
        ld (tutor_request_pointer),hl
        pop hl
        ret

tutor_emit_word:
        ld a,l
        call tutor_emit_byte
        ld a,h
        jp tutor_emit_byte

; A bytes from the currently open record at DE.
tutor_emit_record_bytes:
        ld (tutor_field_length_byte),a
tutor_emit_record_loop:
        ld a,(tutor_field_length_byte)
        or a
        ret z
        call sc_record_read_byte
        ret c
        call tutor_emit_byte
        inc de
        ld a,(tutor_field_length_byte)
        dec a
        ld (tutor_field_length_byte),a
        jr tutor_emit_record_loop

tutor_request_finish:
        ld hl,(tutor_request_pointer)
        ld de,tutor_request_buffer + 7
        or a
        sbc hl,de
        ld (tutor_request_buffer + 5),hl
        ld hl,(tutor_request_pointer)
        ld de,tutor_request_buffer
        or a
        sbc hl,de
        ld b,h
        ld c,l
        ld hl,tutor_request_buffer
        call crc16_ccitt_false
        ld a,e
        call tutor_emit_byte
        ld a,d
        call tutor_emit_byte
        ld hl,(tutor_request_pointer)
        ld de,tutor_request_buffer
        or a
        sbc hl,de
        ld (tutor_request_length),hl
        ld de,TUTOR_REQUEST_BUFFER_BYTES + 1
        or a
        sbc hl,de
        jr nc,tutor_request_build_fail
        or a
        ret
tutor_request_build_fail:
        scf
        ret

; Persist DSTREQ, verify it through the independent reader, then advance the
; shared request counter and commit SCREEN_SYNC in one alternating SCL1 write.
tutor_commit_new_request:
        ld hl,tutor_request_name
        rst 0x20
        rst 0x10
        jp nc,tutor_fail_request
        call _memchk
        or a
        jr nz,tutor_request_memory_ready
        ld de,(tutor_request_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jp c,tutor_fail_request
tutor_request_memory_ready:
        ld hl,tutor_request_name
        rst 0x20
        ld hl,(tutor_request_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,tutor_request_buffer
        call _set_abs_src
        xor a
        ld hl,(tutor_request_length)
        call _set_mm_bytes
        call _mm_ldir
        call tutor_open_request
        jp c,tutor_fail_request
        ld hl,(tutor_request_id)
        ld de,(tutor_new_request_id)
        or a
        sbc hl,de
        jp nz,tutor_fail_request
        ld a,(tutor_request_id + 2)
        ld b,a
        ld a,(tutor_new_request_id + 2)
        cp b
        jp nz,tutor_fail_request
        call tutor_advance_request_id
        jp c,tutor_fail_request
        jp tutor_route_sync_save

tutor_route_existing_request:
        ; A power cut after DSTREQ creation but before SCL1 save is repaired by
        ; advancing the counter exactly once. Any other divergence fails closed.
        call tutor_request_id_relation
        jp c,tutor_fail_request
        or a
        jr nz,tutor_route_existing_advanced
        call tutor_advance_request_id
        jp c,tutor_fail_request
tutor_route_existing_advanced:
        jp tutor_route_sync_save

; A=0 state equals request ID, A=1 state equals request ID+1, carry otherwise.
tutor_request_id_relation:
        ld hl,(tutor_request_id)
        ld a,(tutor_request_id + 2)
        ld (tutor_compare_request_id),hl
        ld (tutor_compare_request_id + 2),a
        call tutor_compare_state_request_id
        ret z
        ld hl,(tutor_compare_request_id)
        ld a,(tutor_compare_request_id + 2)
        inc hl
        jr nz,tutor_request_plus_one_ready
        inc a
        jr z,tutor_request_relation_fail
tutor_request_plus_one_ready:
        ld (tutor_compare_request_id),hl
        ld (tutor_compare_request_id + 2),a
        call tutor_compare_state_request_id
        jr nz,tutor_request_relation_fail
        ld a,1
        or a
        ret
tutor_request_relation_fail:
        scf
        ret

tutor_compare_state_request_id:
        ld hl,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET)
        ld de,(tutor_compare_request_id)
        or a
        sbc hl,de
        ret nz
        ld a,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET + 2)
        ld b,a
        ld a,(tutor_compare_request_id + 2)
        cp b
        ret

tutor_advance_request_id:
        ld hl,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET)
        ld a,(scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET + 2)
        inc hl
        jr nz,tutor_advance_request_ready
        inc a
        jr z,tutor_advance_request_fail
tutor_advance_request_ready:
        ld (scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET),hl
        ld (scstate_record + SCSTATE_NEXT_REQUEST_ID_OFFSET + 2),a
        or a
        ret
tutor_advance_request_fail:
        scf
        ret

tutor_route_sync_save:
        ld a,TUTOR_VIEW_SYNC
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,tutor_fail_state
        ret

; ---------------------------------------------------------------------------
; Sticky-header, scrollable-body tutor UI.

tutor_build_pages:
        xor a
        ld (tutor_page_count),a
        ld (tutor_page_index),a
        ld (tutor_control_mode),a
        ld (tutor_text_offset),a
        ld (tutor_text_offset + 1),a
        ld hl,(tutor_message_length)
        call tutor_add_page_if_text
        ld a,TUTOR_PAGE_MESSAGE
        call nz,tutor_add_page
        ld a,(tutor_has_answer)
        or a
        jr z,tutor_pages_no_rationale
        ld hl,(tutor_rationale_length)
        ld a,h
        or l
        jr z,tutor_pages_no_rationale
        ld a,TUTOR_PAGE_RATIONALE
        call tutor_add_page
tutor_pages_no_rationale:
        ld a,(tutor_has_turn)
        or a
        jr z,tutor_pages_done
        ld hl,(tutor_body_length)
        ld a,h
        or l
        jr z,tutor_pages_no_body
        ld a,TUTOR_PAGE_BODY
        call tutor_add_page
tutor_pages_no_body:
        ld hl,(tutor_prompt_length)
        ld a,h
        or l
        jr z,tutor_pages_no_prompt
        ld a,TUTOR_PAGE_PROMPT
        call tutor_add_page
tutor_pages_no_prompt:
        ld a,(tutor_choice_count)
        or a
        jr z,tutor_pages_done
        ld a,TUTOR_PAGE_CHOICES
        call tutor_add_page
tutor_pages_done:
        ld a,(tutor_page_count)
        or a
        ret nz
        ld a,TUTOR_PAGE_MESSAGE
        jp tutor_add_page

; Preserve Z from HL==0 for the compact message-page call above.
tutor_add_page_if_text:
        ld a,h
        or l
        ret

tutor_add_page:
        ld b,a
        ld a,(tutor_page_count)
        ld l,a
        ld h,0
        ld de,tutor_pages
        add hl,de
        ld (hl),b
        ld a,(tutor_page_count)
        inc a
        ld (tutor_page_count),a
        ret

tutor_render:
        call _clrLCD
        call tutor_render_header
        call tutor_prepare_page_text
        jp c,tutor_fail_response
        call ui_mode_set
        call ui_select_compact
        ld hl,tutor_text_buffer
        ld de,(tutor_text_offset)
        add hl,de
        ld b,2
        ld c,10
        ld d,123
        ld e,48
        call tutor_draw_wrapped_text
        ld (tutor_next_text_pointer),hl
        ld (tutor_page_overflow),a
        call tutor_render_rail
        call tutor_render_softkeys
        jp tutor_wait

tutor_render_header:
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,tutor_title
        ld b,1
        ld c,1
        call ui_draw_text
        ld a,(tutor_has_turn)
        or a
        jr z,tutor_render_header_value
        ld hl,tutor_more_label
        ld b,31
        ld c,1
        call ui_draw_text
tutor_render_header_value:
        call tutor_format_mastery
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

tutor_format_mastery:
        ld a,(tutor_has_session)
        or a
        ld hl,tutor_connected_label
        ret z
        ld a,(tutor_mastery_percent)
        ld l,a
        ld h,0
        ld de,tutor_header_value
        xor a
        ld (tutor_digit_started),a
        ld bc,100
        call tutor_emit_decimal_digit
        ld bc,10
        call tutor_emit_decimal_digit
        ld a,l
        add a,'0'
        ld (de),a
        inc de
        ld a,'%'
        ld (de),a
        inc de
        xor a
        ld (de),a
        ld hl,tutor_header_value
        ret

tutor_emit_decimal_digit:
        xor a
tutor_decimal_loop:
        or a
        sbc hl,bc
        jr c,tutor_decimal_done
        inc a
        jr tutor_decimal_loop
tutor_decimal_done:
        add hl,bc
        ld b,a
        ld a,(tutor_digit_started)
        or b
        ret z
        ld a,1
        ld (tutor_digit_started),a
        ld a,b
        add a,'0'
        ld (de),a
        inc de
        ret

tutor_prepare_page_text:
        ld a,(tutor_page_index)
        ld l,a
        ld h,0
        ld de,tutor_pages
        add hl,de
        ld a,(hl)
        cp TUTOR_PAGE_MESSAGE
        jr z,tutor_prepare_message
        cp TUTOR_PAGE_RATIONALE
        jr z,tutor_prepare_rationale
        cp TUTOR_PAGE_BODY
        jr z,tutor_prepare_body
        cp TUTOR_PAGE_PROMPT
        jr z,tutor_prepare_prompt
        cp TUTOR_PAGE_CHOICES
        jp z,tutor_prepare_choices
        scf
        ret
tutor_prepare_message:
        ld de,(tutor_message_offset)
        ld hl,(tutor_message_length)
        jp tutor_copy_text_field
tutor_prepare_rationale:
        ld de,(tutor_rationale_offset)
        ld hl,(tutor_rationale_length)
        jp tutor_copy_text_field
tutor_prepare_body:
        ld de,(tutor_body_offset)
        ld hl,(tutor_body_length)
        jp tutor_copy_text_field
tutor_prepare_prompt:
        ld de,(tutor_prompt_offset)
        ld hl,(tutor_prompt_length)
        jp tutor_copy_text_field

tutor_copy_text_field:
        ld (tutor_copy_remaining),hl
        ld hl,tutor_text_buffer
        ld (tutor_text_pointer),hl
tutor_copy_text_loop:
        ld hl,(tutor_copy_remaining)
        ld a,h
        or l
        jr z,tutor_copy_text_done
        call sc_record_read_byte
        ret c
        ld hl,(tutor_text_pointer)
        ld (hl),a
        inc hl
        ld (tutor_text_pointer),hl
        inc de
        ld hl,(tutor_copy_remaining)
        dec hl
        ld (tutor_copy_remaining),hl
        jr tutor_copy_text_loop
tutor_copy_text_done:
        ld hl,(tutor_text_pointer)
        ld (hl),0
        or a
        ret

tutor_prepare_choices:
        ld hl,tutor_text_buffer
        ld (tutor_text_pointer),hl
        xor a
        ld (tutor_parse_index),a
tutor_prepare_choice_loop:
        ld a,(tutor_parse_index)
        ld b,a
        ld a,(tutor_choice_count)
        cp b
        jr z,tutor_prepare_choices_done
        ld hl,(tutor_text_pointer)
        ld a,(tutor_parse_index)
        add a,'A'
        ld (hl),a
        inc hl
        ld (hl),'.'
        inc hl
        ld (hl),' '
        inc hl
        ld (tutor_text_pointer),hl
        call tutor_choice_field_at_index
        ld (tutor_field_length_byte),a
tutor_prepare_choice_copy:
        ld a,(tutor_field_length_byte)
        or a
        jr z,tutor_prepare_choice_newline
        call sc_record_read_byte
        ret c
        ld hl,(tutor_text_pointer)
        ld (hl),a
        inc hl
        ld (tutor_text_pointer),hl
        inc de
        ld a,(tutor_field_length_byte)
        dec a
        ld (tutor_field_length_byte),a
        jr tutor_prepare_choice_copy
tutor_prepare_choice_newline:
        ld hl,(tutor_text_pointer)
        ld (hl),10
        inc hl
        ld (tutor_text_pointer),hl
        ld a,(tutor_parse_index)
        inc a
        ld (tutor_parse_index),a
        jr tutor_prepare_choice_loop
tutor_prepare_choices_done:
        ld hl,(tutor_text_pointer)
        ld (hl),0
        or a
        ret

; Current parse index -> DE offset and A length.
tutor_choice_field_at_index:
        ld a,(tutor_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld de,tutor_choice_offsets
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld a,(tutor_parse_index)
        ld l,a
        ld h,0
        ld bc,tutor_choice_lengths
        add hl,bc
        ld a,(hl)
        ret

tutor_render_rail:
        call ui_mode_set
        ld b,127
        ld c,9
        ld d,1
        ld e,46
        call ui_fill_rect
        ld a,(tutor_page_index)
        ld b,a
        add a,a
        add a,b
        add a,10
        ld c,a
        ld b,125
        ld d,3
        ld e,6
        jp ui_fill_rect

tutor_render_softkeys:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ld a,(tutor_response_disposition)
        cp TUTOR_DISP_PROCESSING
        jr z,tutor_render_retry_key
        cp TUTOR_DISP_RETRYABLE
        jr z,tutor_render_retry_key
        ld a,(tutor_has_turn)
        or a
        jr nz,tutor_render_choice_keys
        ret
tutor_render_retry_key:
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,tutor_retry_label
        ld b,2
        ld c,57
        call ui_draw_text
        jp ui_mode_set
tutor_render_choice_keys:
        ld a,(tutor_control_mode)
        or a
        jp nz,tutor_render_control_keys
        xor a
        ld (tutor_parse_index),a
tutor_render_choice_key_loop:
        ld a,(tutor_parse_index)
        ld b,a
        ld a,(tutor_choice_count)
        cp b
        jr z,tutor_render_choice_labels
        ld a,b
        call tutor_softkey_x
        ld b,a
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld a,(tutor_parse_index)
        inc a
        ld (tutor_parse_index),a
        jr tutor_render_choice_key_loop
tutor_render_choice_labels:
        call ui_mode_clear
        call ui_select_compact
        xor a
        ld (tutor_parse_index),a
tutor_render_choice_label_loop:
        ld a,(tutor_parse_index)
        ld b,a
        ld a,(tutor_choice_count)
        cp b
        jr z,tutor_render_choice_done
        ld a,b
        call tutor_softkey_x
        add a,10
        ld b,a
        ld a,(tutor_parse_index)
        add a,a
        ld l,a
        ld h,0
        ld de,tutor_choice_letters
        add hl,de
        ld c,57
        call ui_draw_text
        ld a,(tutor_parse_index)
        inc a
        ld (tutor_parse_index),a
        jr tutor_render_choice_label_loop
tutor_render_choice_done:
        jp ui_mode_set

; MORE swaps the A-E palette for learner-owned controls without consuming a
; content row. Only controls authorized by the server-projected policy appear.
tutor_render_control_keys:
        ld a,(tutor_control_mask)
        bit 2,a
        call nz,tutor_fill_control_f1
        ld a,(tutor_control_mask)
        bit 1,a
        call nz,tutor_fill_control_f2
        ld a,(tutor_control_mask)
        bit 3,a
        call nz,tutor_fill_control_f3
        ld a,(tutor_control_mask)
        bit 0,a
        call nz,tutor_fill_control_f5
        call ui_mode_clear
        call ui_select_compact
        ld a,(tutor_control_mask)
        bit 2,a
        call nz,tutor_label_control_f1
        ld a,(tutor_control_mask)
        bit 1,a
        call nz,tutor_label_control_f2
        ld a,(tutor_control_mask)
        bit 3,a
        call nz,tutor_label_control_f3
        ld a,(tutor_control_mask)
        bit 0,a
        call nz,tutor_label_control_f5
        jp ui_mode_set

tutor_fill_control_f1:
        ld b,0
        jr tutor_fill_control_key
tutor_fill_control_f2:
        ld b,26
        jr tutor_fill_control_key
tutor_fill_control_f3:
        ld b,51
        jr tutor_fill_control_key
tutor_fill_control_f5:
        ld b,102
tutor_fill_control_key:
        ld c,56
        ld d,25
        ld e,8
        jp ui_fill_rect

tutor_label_control_f1:
        ld hl,tutor_explain_label
        ld b,5
        jr tutor_label_control_key
tutor_label_control_f2:
        ld hl,tutor_skip_label
        ld b,30
        jr tutor_label_control_key
tutor_label_control_f3:
        ld hl,tutor_challenge_label
        ld b,54
        jr tutor_label_control_key
tutor_label_control_f5:
        ld hl,tutor_stop_label
        ld b,106
tutor_label_control_key:
        ld c,57
        jp ui_draw_text

; A=index 0..4 -> x = 0,26,51,77,102.
tutor_softkey_x:
        or a
        ret z
        cp 1
        jp z,tutor_softkey_26
        cp 2
        jp z,tutor_softkey_51
        cp 3
        jp z,tutor_softkey_77
        ld a,102
        ret

; Compact reader wrapper used only by SCTUTOR. It word-wraps 24-cell lines,
; hard-wraps one overlong word, honors LF, and returns the next unread byte on
; viewport overflow without pulling the larger full renderer profile into the
; 8 KiB execution window.
tutor_draw_wrapped_text:
        ld (tutor_wrap_pointer),hl
        ld a,b
        ld (tutor_wrap_x),a
        ld a,c
        ld (tutor_wrap_y),a
        ld a,e
        ld (tutor_wrap_bottom),a
tutor_wrap_line:
        ld hl,(tutor_wrap_pointer)
tutor_wrap_skip_spaces:
        ld a,(hl)
        cp ' '
        jr nz,tutor_wrap_space_done
        inc hl
        jr tutor_wrap_skip_spaces
tutor_wrap_space_done:
        ld (tutor_wrap_pointer),hl
        or a
        jp z,tutor_wrap_complete
        ld a,(tutor_wrap_y)
        add a,5
        jp c,tutor_wrap_overflow
        ld b,a
        ld a,(tutor_wrap_bottom)
        cp b
        jp c,tutor_wrap_overflow
        ld hl,(tutor_wrap_pointer)
        ld (tutor_wrap_scan),hl
        xor a
        ld (tutor_wrap_count),a
        ld (tutor_wrap_last_space),a
        ld (tutor_wrap_last_space + 1),a
        ld (tutor_wrap_terminal),a
tutor_wrap_scan_loop:
        ld a,(tutor_wrap_count)
        cp 24
        jr z,tutor_wrap_capacity
        ld hl,(tutor_wrap_scan)
        ld a,(hl)
        or a
        jr z,tutor_wrap_terminal_line
        cp 10
        jr z,tutor_wrap_newline
        cp ' '
        jr nz,tutor_wrap_scan_next
        ld (tutor_wrap_last_space),hl
tutor_wrap_scan_next:
        inc hl
        ld (tutor_wrap_scan),hl
        ld a,(tutor_wrap_count)
        inc a
        ld (tutor_wrap_count),a
        jr tutor_wrap_scan_loop
tutor_wrap_capacity:
        ld hl,(tutor_wrap_last_space)
        ld a,h
        or l
        jr z,tutor_wrap_hard_line
        ld (tutor_wrap_end),hl
        inc hl
        ld (tutor_wrap_next),hl
        jr tutor_wrap_draw
tutor_wrap_hard_line:
        ld hl,(tutor_wrap_scan)
        ld (tutor_wrap_end),hl
        ld (tutor_wrap_next),hl
        jr tutor_wrap_draw
tutor_wrap_newline:
        ld hl,(tutor_wrap_scan)
        ld (tutor_wrap_end),hl
        inc hl
        ld (tutor_wrap_next),hl
        jr tutor_wrap_draw
tutor_wrap_terminal_line:
        ld hl,(tutor_wrap_scan)
        ld (tutor_wrap_end),hl
        ld (tutor_wrap_next),hl
        ld a,1
        ld (tutor_wrap_terminal),a
tutor_wrap_draw:
        ld hl,(tutor_wrap_end)
        ld a,(hl)
        ld (tutor_wrap_saved_byte),a
        ld (hl),0
        ld hl,(tutor_wrap_pointer)
        ld a,(tutor_wrap_x)
        ld b,a
        ld a,(tutor_wrap_y)
        ld c,a
        call ui_draw_text
        ld hl,(tutor_wrap_end)
        ld a,(tutor_wrap_saved_byte)
        ld (hl),a
        ld hl,(tutor_wrap_next)
        ld (tutor_wrap_pointer),hl
        ld a,(tutor_wrap_terminal)
        or a
        jr nz,tutor_wrap_complete
        ld a,(tutor_wrap_y)
        add a,7
        ld (tutor_wrap_y),a
        jp tutor_wrap_line
tutor_wrap_complete:
        ld hl,(tutor_wrap_pointer)
        xor a
        ret
tutor_wrap_overflow:
        ld hl,(tutor_wrap_pointer)
        ld a,1
        or a
        ret
tutor_softkey_26:
        ld a,26
        ret
tutor_softkey_51:
        ld a,51
        ret
tutor_softkey_77:
        ld a,77
        ret

tutor_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,tutor_pause
        cp SC_SCAN_DOWN
        jp z,tutor_next_page
        cp SC_SCAN_RIGHT
        jp z,tutor_next_page
        cp SC_SCAN_UP
        jp z,tutor_previous_page
        cp SC_SCAN_LEFT
        jp z,tutor_previous_page
        cp SC_SCAN_ENTER
        jp z,tutor_retry_if_pending
        cp SC_SCAN_MORE
        jp z,tutor_toggle_control_mode
        cp SC_SCAN_F1
        jr z,tutor_choose_f1
        cp SC_SCAN_F2
        jr z,tutor_choose_f2
        cp SC_SCAN_F3
        jr z,tutor_choose_f3
        cp SC_SCAN_F4
        jr z,tutor_choose_f4
        cp SC_SCAN_F5
        jr z,tutor_choose_f5
        jp tutor_wait
tutor_choose_f1:
        ld a,1
        jr tutor_choose
tutor_choose_f2:
        ld a,2
        jr tutor_choose
tutor_choose_f3:
        ld a,3
        jr tutor_choose
tutor_choose_f4:
        ld a,4
        jr tutor_choose
tutor_choose_f5:
        ld a,5
tutor_choose:
        ld b,a
        ld a,(tutor_response_disposition)
        cp TUTOR_DISP_COMPLETE
        jp nz,tutor_retry_if_pending
        ld a,(tutor_has_turn)
        or a
        jp z,tutor_retry_if_pending
        ld a,(tutor_control_mode)
        or a
        jr nz,tutor_choose_control
        ld a,(tutor_choice_count)
        cp b
        jp c,tutor_wait
        ld a,b
        push af
        call tutor_open_response
        jp c,tutor_fail_response
        pop af
        call tutor_build_choice_request
        jp c,tutor_fail_request
        jp tutor_commit_new_request

tutor_choose_control:
        ld a,b
        cp 1
        jr z,tutor_choose_explain
        cp 2
        jr z,tutor_choose_skip
        cp 3
        jr z,tutor_choose_challenge
        cp 5
        jp nz,tutor_wait
        ld a,(tutor_control_mask)
        bit 0,a
        jp z,tutor_wait
        call tutor_open_response
        jp c,tutor_fail_response
        call tutor_build_cancel_request
        jp c,tutor_fail_request
        jp tutor_commit_new_request
tutor_choose_explain:
        ld a,(tutor_control_mask)
        bit 2,a
        jp z,tutor_wait
        ld a,TUTOR_ACTION_EXPLAIN
        jr tutor_commit_control
tutor_choose_skip:
        ld a,(tutor_control_mask)
        bit 1,a
        jp z,tutor_wait
        ld a,TUTOR_ACTION_SKIP
        jr tutor_commit_control
tutor_choose_challenge:
        ld a,(tutor_control_mask)
        bit 3,a
        jp z,tutor_wait
        ld a,TUTOR_ACTION_CHALLENGE
tutor_commit_control:
        push af
        call tutor_open_response
        jp c,tutor_fail_response
        pop af
        call tutor_build_control_request
        jp c,tutor_fail_request
        jp tutor_commit_new_request

tutor_toggle_control_mode:
        ld a,(tutor_response_disposition)
        cp TUTOR_DISP_COMPLETE
        jp nz,tutor_retry_if_pending
        ld a,(tutor_has_turn)
        or a
        jp z,tutor_wait
        ld a,(tutor_control_mode)
        xor 1
        ld (tutor_control_mode),a
        jp tutor_render

tutor_retry_if_pending:
        ld a,(tutor_response_disposition)
        cp TUTOR_DISP_PROCESSING
        jp z,tutor_retry_request
        cp TUTOR_DISP_RETRYABLE
        jp nz,tutor_wait
tutor_retry_request:
        call tutor_open_request
        jp c,tutor_fail_request
        jp tutor_route_existing_request

tutor_next_page:
        ld a,(tutor_page_overflow)
        or a
        jr z,tutor_next_logical_page
        ld hl,(tutor_next_text_pointer)
        ld de,tutor_text_buffer
        or a
        sbc hl,de
        ld (tutor_text_offset),hl
        jp tutor_render
tutor_next_logical_page:
        ld a,(tutor_page_index)
        inc a
        ld b,a
        ld a,(tutor_page_count)
        cp b
        jp z,tutor_wait
        jp c,tutor_wait
        ld a,b
        ld (tutor_page_index),a
        xor a
        ld (tutor_text_offset),a
        ld (tutor_text_offset + 1),a
        jp tutor_render

tutor_previous_page:
        ld hl,(tutor_text_offset)
        ld a,h
        or l
        jr z,tutor_previous_logical_page
        xor a
        ld (tutor_text_offset),a
        ld (tutor_text_offset + 1),a
        jp tutor_render
tutor_previous_logical_page:
        ld a,(tutor_page_index)
        or a
        jp z,tutor_wait
        dec a
        ld (tutor_page_index),a
        jp tutor_render

; EXIT is a pause, not a cancellation. DSTURN remains resumable and no server
; state is silently changed; My Progress can invoke the same current session.
tutor_pause:
        ld a,TUTOR_VIEW_CATALOG
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,tutor_fail_state
        ret

; ---------------------------------------------------------------------------
; Fail-closed diagnostics. Durable request/response variables are untouched.

tutor_fail_state:
        ld hl,tutor_error_state
        jr tutor_render_error
tutor_fail_identity:
        ld hl,tutor_error_identity
        jr tutor_render_error
tutor_fail_learner:
        ld hl,tutor_error_learner
        jr tutor_render_error
tutor_fail_request:
        ld hl,tutor_error_request
        jr tutor_render_error
tutor_fail_response:
        ld hl,tutor_error_response
        jr tutor_render_error
tutor_fail_unavailable:
        ld hl,tutor_error_unavailable
tutor_render_error:
        ld (tutor_error_detail),hl
        call _clrLCD
        ld hl,tutor_error_title
        ld de,tutor_error_context
        call tutor_render_message_header
        call ui_mode_set
        call ui_select_compact
        ld hl,(tutor_error_detail)
        ld b,2
        ld c,18
        ld d,122
        ld e,48
        call tutor_draw_wrapped_text
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
tutor_error_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jr z,tutor_error_exit
        cp SC_SCAN_LEFT
        jr z,tutor_error_exit
        cp SC_SCAN_ENTER
        jr z,tutor_error_exit
        jr tutor_error_wait
tutor_error_exit:
        ld a,(tutor_state_ready)
        or a
        ret z
        ld a,TUTOR_VIEW_CATALOG
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        ret

tutor_render_message_header:
        ld (tutor_header_title),hl
        ld (tutor_header_context),de
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,(tutor_header_title)
        ld b,1
        ld c,1
        call ui_draw_text
        ld hl,(tutor_header_context)
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

; ---------------------------------------------------------------------------
; Validate this loaded program before touching shared state or variables.

tutor_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,tutor_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,tutor_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,tutor_scx_magic
        ld b,4
tutor_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,tutor_scx_fail
        inc de
        inc hl
        djnz tutor_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,tutor_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 9
        jr nz,tutor_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,tutor_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,tutor_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,tutor_scx_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,tutor_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,tutor_scx_fail
        or a
        ret
tutor_scx_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Runtime storage and literals.

tutor_stage_status:             defb 0
tutor_state_ready:              defb 0
tutor_device_length:            defb 0
tutor_device_id:                defs 17,0
tutor_copy_length:              defw 0
tutor_copy_dest_addr:           defw 0
tutor_copy_dest_page:           defb 0
tutor_stage_request_id:         defs 3,0
tutor_stage_disposition:        defb 0
tutor_request_id:               defs 3,0
tutor_new_request_id:           defs 3,0
tutor_compare_request_id:       defs 3,0
tutor_request_action:           defb 0
tutor_request_client_sequence:  defw 0
tutor_request_server_sequence:  defw 0
tutor_request_pointer:          defw 0
tutor_request_length:           defw 0
tutor_selected_choice:          defb 0
tutor_selected_action:          defb 0

; Cleared as one bounded block before each SCTR parse.
tutor_response_fields_start:
tutor_response_request_id:      defs 3,0
tutor_response_disposition:     defb 0
tutor_message_offset:           defw 0
tutor_message_length:           defw 0
tutor_has_session:              defb 0
tutor_session_offset:           defw 0
tutor_session_length:           defb 0
tutor_session_status:           defb 0
tutor_mastery_percent:          defb 0
tutor_target_percent:           defb 0
tutor_next_client_sequence:     defw 0
tutor_latest_server_sequence:   defw 0
tutor_control_mask:             defb 0
tutor_has_answer:               defb 0
tutor_answer_choice:            defb 0
tutor_answer_correct:           defb 0
tutor_rationale_offset:         defw 0
tutor_rationale_length:         defw 0
tutor_has_turn:                 defb 0
tutor_turn_offset:              defw 0
tutor_turn_length:              defb 0
tutor_turn_server_sequence:     defw 0
tutor_body_offset:              defw 0
tutor_body_length:              defw 0
tutor_prompt_offset:            defw 0
tutor_prompt_length:            defw 0
tutor_choice_count:             defb 0
tutor_choice_offsets:           defs 10,0
tutor_choice_lengths:           defs 5,0
tutor_response_fields_end:

tutor_text_allow_newline:       defb 0
tutor_text_remaining:           defw 0
tutor_field_length_byte:        defb 0
tutor_parse_index:              defb 0
tutor_progress_remaining:       defb 0
tutor_progress_recent:          defb 0
tutor_progress_followups:       defb 0
tutor_progress_selected:        defb 0
tutor_progress_profile_found:   defb 0
tutor_followup_found:           defb 0
tutor_progress_temp_key:        defs 10,0
tutor_followup_key:             defs 10,0
tutor_copy_remaining:           defw 0
tutor_text_pointer:             defw 0
tutor_pages:                    defs 5,0
tutor_page_count:               defb 0
tutor_page_index:               defb 0
tutor_page_overflow:            defb 0
tutor_control_mode:             defb 0
tutor_text_offset:              defw 0
tutor_next_text_pointer:        defw 0
tutor_digit_started:            defb 0
tutor_header_value:             defs 5,0
tutor_error_detail:             defw 0
tutor_header_title:             defw 0
tutor_header_context:           defw 0
tutor_text_buffer:              defs TUTOR_TEXT_BUFFER_BYTES,0
tutor_request_buffer:           equ tutor_text_buffer
tutor_wrap_pointer:             defw 0
tutor_wrap_scan:                defw 0
tutor_wrap_last_space:          defw 0
tutor_wrap_end:                 defw 0
tutor_wrap_next:                defw 0
tutor_wrap_x:                   defb 0
tutor_wrap_y:                   defb 0
tutor_wrap_bottom:              defb 0
tutor_wrap_count:               defb 0
tutor_wrap_terminal:            defb 0
tutor_wrap_saved_byte:          defb 0

tutor_scx_magic:                defb "SCX1"
tutor_sci1_magic:               defb "SCI1"
tutor_scg1_magic:               defb "SCG1"
tutor_sctq_magic:               defb "SCTQ"
tutor_sctr_magic:               defb "SCTR"
tutor_field_schema:             defb "schema",0
tutor_field_device_id:          defb "deviceId",0
tutor_identity_schema:          defb "school.calc.device-identity/v1",0
tutor_title:                    defb "Tutor",0
tutor_connected_label:          defb "SYNCED",0
tutor_more_label:               defb "MORE:OPT",0
tutor_retry_label:              defb "RETRY",0
tutor_choice_letters:           defb "A",0,"B",0,"C",0,"D",0,"E",0
tutor_explain_label:            defb "WHY",0
tutor_skip_label:               defb "SKIP",0
tutor_challenge_label:          defb "KNOW",0
tutor_stop_label:               defb "STOP",0
tutor_error_title:              defb "Tutor stopped",0
tutor_error_context:            defb "SAFE",0
tutor_error_state:              defb "Local state unreadable. Requests are saved.",0
tutor_error_identity:           defb "Calculator identity missing or invalid.",0
tutor_error_learner:            defb "Choose a learner before tutoring.",0
tutor_error_request:            defb "Tutor request invalid or not saved.",0
tutor_error_response:           defb "Tutor response invalid. Prior data is safe.",0
tutor_error_unavailable:        defb "No connected follow-up is available.",0

tutor_identity_name:            defb 0x0C,4,"DSID",0,0,0,0
tutor_progress_name:            defb 0x0C,6,"DSPROG",0,0
tutor_request_name:             defb 0x0C,6,"DSTREQ",0,0
tutor_stage_name:               defb 0x0C,6,"DSTNEW",0,0
tutor_response_name:            defb 0x0C,6,"DSTURN",0,0

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
include "generated/ui-tutor-runtime-assets.inc"

end
