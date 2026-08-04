; Subject-neutral multiple-choice and flashcard interactions for SCLEARN.
;
; Compiler v2 guarantees at most 48 assessment items, 2..5 visible choices,
; complete prompt/answer pages, and printable ASCII. This runtime independently
; rechecks every bound before it uses an offset. Choice drafts live in the
; existing 48-byte SCL1 draft area and are committed before advancing.

RUNTIME_SCL_FLAGS_OFFSET:       equ 11
RUNTIME_SCL_SCROLL_OFFSET:      equ 40
RUNTIME_SCL_CARD_FACE_OFFSET:   equ 42
RUNTIME_SCL_DRAFT_KIND_OFFSET:  equ 45
RUNTIME_SCL_DRAFT_LENGTH_OFFSET: equ 46
RUNTIME_SCL_DRAFT_OFFSET:       equ 47
RUNTIME_SCL_NEXT_SEQUENCE_OFFSET: equ 95

RUNTIME_FLAG_SESSION_ACTIVE:    equ 0x01
RUNTIME_FLAG_DRAFT_PRESENT:     equ 0x02
RUNTIME_FLAG_ASSESSMENT_STARTED: equ 0x10
RUNTIME_FLAG_RESULT_PENDING_HIGH: equ 0x02
RUNTIME_DRAFT_CHOICE:           equ 1
RUNTIME_DRAFT_PROBE:            equ 8
RUNTIME_ASSESSMENT_MAX_ITEMS:   equ 48
RUNTIME_PROBE_MAX_ITEMS:        equ 12

assessment_runtime_start:
        ld a,(runtime_mode)
        cp RUNTIME_MODE_FLASHCARDS
        jp z,flashcard_prepare
        cp RUNTIME_MODE_PROBE
        jr z,probe_runtime_start
        call assessment_prepare_session
        jp c,standard_runtime_render_error
        jp assessment_render

probe_runtime_start:
        call probe_prepare_session
        jp c,standard_runtime_render_error
        ld a,(runtime_state_record + RUNTIME_SCL_VIEW_OFFSET)
        cp 6
        ret z
        jp assessment_render

; Restore a valid choice draft or initialize and durably commit a new one.
assessment_prepare_session:
        call assessment_require_item_count
        ret c
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and RUNTIME_FLAG_ASSESSMENT_STARTED
        jr z,assessment_initialize_session
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and RUNTIME_FLAG_DRAFT_PRESENT
        jr z,assessment_invalid
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp RUNTIME_DRAFT_CHOICE
        jp nz,assessment_invalid
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        ld b,a
        ld a,(runtime_content_count)
        cp b
        jp nz,assessment_invalid
        ld hl,(runtime_item_index)
        ld a,h
        or a
        jr nz,assessment_invalid
        ld a,l
        ld b,a
        ld a,(runtime_content_count)
        cp b
        jr c,assessment_invalid
        jp z,assessment_invalid
        call assessment_validate_draft
        ret

assessment_initialize_session:
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld b,RUNTIME_ASSESSMENT_MAX_ITEMS
        xor a
assessment_clear_draft:
        ld (hl),a
        inc hl
        djnz assessment_clear_draft
        ld a,(runtime_content_count)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld a,RUNTIME_DRAFT_CHOICE
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        or RUNTIME_FLAG_SESSION_ACTIVE | RUNTIME_FLAG_DRAFT_PRESENT | RUNTIME_FLAG_ASSESSMENT_STARTED
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        ld hl,0
        ld (runtime_item_index),hl
        call assessment_save_and_reopen
        ret

assessment_require_item_count:
        ld hl,(runtime_content_count)
        ld a,h
        or a
        jr nz,assessment_invalid
        ld a,l
        or a
        jr z,assessment_invalid
        cp RUNTIME_ASSESSMENT_MAX_ITEMS + 1
        jp nc,assessment_invalid
        or a
        ret

assessment_validate_draft:
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld a,(runtime_content_count)
        ld b,a
assessment_validate_draft_loop:
        ld a,(hl)
        cp 6
        jr nc,assessment_invalid
        inc hl
        djnz assessment_validate_draft_loop
        or a
        ret

assessment_invalid:
        ld a,RUNTIME_ERROR_MODULE
        ld (runtime_error),a
        scf
        ret

; Learning probes use two draft bytes per item:
;   byte 0: attempt 1 (high nibble), attempt 2 (low nibble)
;   byte 1: attempt 3 (high nibble), feedback-viewed bit 1, continued bit 0.
; The trace is append-only, so a retry can improve learning without replacing
; the score-bearing first answer.
probe_prepare_session:
        call probe_require_item_count
        ret c
        call probe_load_policy
        ret c
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and RUNTIME_FLAG_ASSESSMENT_STARTED
        jr z,probe_initialize_session
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and RUNTIME_FLAG_DRAFT_PRESENT
        jr z,assessment_invalid
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET)
        cp RUNTIME_DRAFT_PROBE
        jr nz,assessment_invalid
        ld a,(runtime_content_count)
        add a,a
        ld b,a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        cp b
        jr nz,assessment_invalid
        ld hl,(runtime_item_index)
        ld a,h
        or a
        jr nz,assessment_invalid
        ld a,(runtime_content_count)
        cp l
        jr c,assessment_invalid
        jr z,assessment_invalid
        call probe_validate_draft
        ret c
        call probe_current_trace_address
        inc hl
        bit 0,(hl)
        call nz,probe_advance_after_continue
        ret

probe_initialize_session:
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld b,RUNTIME_ASSESSMENT_MAX_ITEMS
        xor a
probe_clear_draft:
        ld (hl),a
        inc hl
        djnz probe_clear_draft
        ld a,(runtime_content_count)
        add a,a
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld a,RUNTIME_DRAFT_PROBE
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        or RUNTIME_FLAG_SESSION_ACTIVE | RUNTIME_FLAG_DRAFT_PRESENT | RUNTIME_FLAG_ASSESSMENT_STARTED
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        ld hl,0
        ld (runtime_item_index),hl
        call assessment_save_and_reopen
        ret

probe_require_item_count:
        ld hl,(runtime_content_count)
        ld a,h
        or a
        jp nz,assessment_invalid
        ld a,l
        or a
        jp z,assessment_invalid
        cp RUNTIME_PROBE_MAX_ITEMS + 1
        jp nc,assessment_invalid
        or a
        ret

probe_validate_draft:
        ld hl,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        ld a,(runtime_content_count)
        ld b,a
probe_validate_draft_loop:
        ld c,(hl)
        ld a,c
        and 0xF0
        cp 0x60
        jp nc,assessment_invalid
        ld a,c
        and 0x0F
        cp 6
        jp nc,assessment_invalid
        ld e,a
        ld a,c
        and 0xF0
        jr nz,probe_validate_first_present
        ld a,e
        or a
        jp nz,assessment_invalid
probe_validate_first_present:
        inc hl
        ld c,(hl)
        ld a,c
        and 0x0C
        jp nz,assessment_invalid
        ld a,c
        and 0xF0
        cp 0x60
        jp nc,assessment_invalid
        jr z,probe_validate_flags
        ld a,e
        or a
        jp z,assessment_invalid
probe_validate_flags:
        ld a,c
        and 0x03
        cp 1
        jp z,assessment_invalid       ; continued requires viewed feedback
        inc hl
        djnz probe_validate_draft_loop
        or a
        ret

probe_load_policy:
        ld de,(runtime_module_offset)
        ld hl,probe_key_feedback
        call sc_map_find_literal
        jp c,assessment_invalid
        ld (probe_policy_offset),de
        ld hl,probe_key_max_attempts
        call sc_map_find_literal
        jp c,assessment_invalid
        call probe_read_small_integer
        jp c,assessment_invalid
        or a
        jp z,assessment_invalid
        cp 4
        jp nc,assessment_invalid
        ld (probe_max_attempts),a
        ld de,(probe_policy_offset)
        ld hl,probe_key_on_incorrect
        call sc_map_find_literal
        jp c,assessment_invalid
        ld (probe_policy_action_offset),de
        ld hl,probe_action_retry
        call sc_node_string_equals_literal
        jp c,assessment_invalid
        ld (probe_retry_enabled),a
        or a
        ret nz
        ld de,(probe_policy_action_offset)
        ld hl,probe_action_continue
        call sc_node_string_equals_literal
        jp c,assessment_invalid
        or a
        jp z,assessment_invalid
        ret

; DE = compact int node. Return its positive low byte in A only when the
; remaining signed-int bytes are zero.
probe_read_small_integer:
        call sc_record_read_byte
        ret c
        cp SC_TAG_INT32
        jr nz,probe_integer_invalid
        inc de
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        ld b,3
probe_integer_high_loop:
        call sc_record_read_byte
        ret c
        or a
        jr nz,probe_integer_invalid
        inc de
        djnz probe_integer_high_loop
        ld a,c
        or a
        ret
probe_integer_invalid:
        scf
        ret

; Return HL = current item's first trace byte.
probe_current_trace_address:
        ld hl,(runtime_item_index)
        add hl,hl
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        add hl,de
        ret

; Reopen and validate the current v2 assessment item and its arrays.
assessment_open_current:
        ld de,(runtime_content_offset)
        ld hl,assessment_key_type
        call sc_map_find_literal
        jp c,assessment_invalid
        ld hl,assessment_type_multiple_choice
        call sc_node_string_equals_literal
        jp c,assessment_invalid
        or a
        jp z,assessment_invalid

        ld de,(runtime_content_offset)
        ld hl,assessment_key_prompt_pages
        call sc_map_find_literal
        jp c,assessment_invalid
        ld (assessment_prompt_pages_offset),de
        call assessment_capture_array_count
        jp c,assessment_invalid
        ld (assessment_prompt_page_count),a

        ld de,(runtime_content_offset)
        ld hl,assessment_key_choices
        call sc_map_find_literal
        jp c,assessment_invalid
        ld (assessment_choices_offset),de
        call assessment_capture_array_count
        jp c,assessment_invalid
        cp 2
        jp c,assessment_invalid
        cp 6
        jp nc,assessment_invalid
        ld (assessment_choice_count),a
        or a
        ret

; DE = array. Return A=1..255 only when high count byte is zero.
assessment_capture_array_count:
        call sc_record_read_byte
        ret c
        cp SC_TAG_ARRAY
        jr nz,assessment_array_invalid
        inc de
        call sc_record_read_byte
        ret c
        ld b,a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr nz,assessment_array_invalid
        ld a,b
        or a
        jr z,assessment_array_invalid
        ret
assessment_array_invalid:
        scf
        ret

assessment_render:
        call assessment_open_current
        jp c,standard_runtime_render_error
        ld a,(runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET)
        cp 2
        jr nz,assessment_render_face_ready
        ld a,(runtime_mode)
        cp RUNTIME_MODE_PROBE
        jp nz,assessment_invalid_render
        call probe_open_feedback
        jp c,standard_runtime_render_error
        jp probe_render_feedback
assessment_render_face_ready:
        or a
        jp nz,assessment_render_choices

assessment_render_prompt:
        call assessment_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or a
        jp nz,assessment_invalid_render
        ld a,(assessment_prompt_page_count)
        cp l
        jp c,assessment_invalid_render
        jp z,assessment_invalid_render
        ld de,(assessment_prompt_pages_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld b,2
        ld c,11
        ld d,122
        ld e,50
        call ui_draw_wrapped_text
        ; A single short prompt with compact choices is answerable in one
        ; frame: put the actual answer text directly over F1–F5. This removes
        ; the hidden "press Down for choices" step for numeric/short answers.
        call assessment_prompt_all_choices_fit_softkeys
        or a
        jp z,assessment_render_prompt_navigation
        call assessment_render_direct_choice_softkeys
        jp assessment_direct_choice_wait

assessment_render_prompt_navigation:
        call assessment_render_prompt_softkeys
        jp assessment_prompt_wait

assessment_prompt_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,assessment_pause
        cp SC_SCAN_RIGHT
        jr z,assessment_prompt_forward
        cp SC_SCAN_ENTER
        jr z,assessment_prompt_forward
        cp SC_SCAN_DOWN
        jr z,assessment_prompt_forward
        cp SC_SCAN_LEFT
        jr z,assessment_prompt_back
        cp SC_SCAN_UP
        jr z,assessment_prompt_back
        cp SC_SCAN_F5
        jr z,assessment_prompt_forward
        jr assessment_prompt_wait

; One-page questions whose answers are at most four printable characters use
; their physical answer keys directly. F1 is choice A, F2 is B, and so on;
; the answer text itself is shown in the matching softkey cell.
assessment_direct_choice_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,assessment_pause
        cp SC_SCAN_LEFT
        jp z,assessment_pause
        cp SC_SCAN_F5
        jr c,assessment_direct_choice_wait
        cp SC_SCAN_F1 + 1
        jr nc,assessment_direct_choice_wait
        jp assessment_submit_function_choice

assessment_prompt_forward:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        inc hl
        ld a,(assessment_prompt_page_count)
        cp l
        jr nz,assessment_store_prompt_page
        ld a,1
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld hl,0
assessment_store_prompt_page:
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),hl
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        jp assessment_render

assessment_prompt_back:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or l
        jr z,assessment_prompt_wait
        dec hl
        jr assessment_store_prompt_page

assessment_render_choices:
        call assessment_render_header
        call ui_mode_set
        call ui_select_compact
        xor a
        ld (assessment_render_index),a
        ld a,11
        ld (assessment_render_y),a
assessment_choice_render_loop:
        ld a,(assessment_render_index)
        ld b,a
        ld a,(assessment_choice_count)
        cp b
        jr z,assessment_choices_rendered
        ld a,b
        add a,'A'
        ld (assessment_letter),a
        ld hl,assessment_letter
        ld b,2
        ld a,(assessment_render_y)
        ld c,a
        call ui_draw_text
        ld a,(assessment_render_index)
        ld l,a
        ld h,0
        ld de,(assessment_choices_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld b,10
        ld a,(assessment_render_y)
        ld c,a
        ld d,124
        call ui_draw_text_clipped
        ld a,(assessment_render_index)
        inc a
        ld (assessment_render_index),a
        ld a,(assessment_render_y)
        add a,8
        ld (assessment_render_y),a
        jr assessment_choice_render_loop
assessment_choices_rendered:
        ; Five choices can occupy all five answer keys. Keep the route back to
        ; the question explicit in the otherwise unused bottom body line so
        ; answers are never detached from a multi-page prompt.
        ld hl,assessment_question_hint
        ld b,2
        ld c,49
        ld d,123
        call ui_draw_text_clipped
        call assessment_render_choice_softkeys
        jp assessment_choice_wait

assessment_choice_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,assessment_pause
        cp SC_SCAN_LEFT
        jr z,assessment_return_to_prompt
        cp SC_SCAN_F5
        jr c,assessment_choice_wait
        cp SC_SCAN_F1 + 1
        jr nc,assessment_choice_wait
        jp assessment_submit_function_choice

; A is one raw F-key scan. Convert it into one-based A–E and commit through
; the same durable answer path whether choices were shown in the body or
; directly on the softkey rail.
assessment_submit_function_choice:
        ld b,a
        ld a,0x36
        sub b
        ld b,a
        ld a,(assessment_choice_count)
        cp b
        jr c,assessment_choice_wait
        ld a,b
        ld c,a
        ld a,(runtime_mode)
        cp RUNTIME_MODE_PROBE
        ld a,c
        jr z,assessment_commit_probe_choice
        call assessment_commit_choice
        jp c,standard_runtime_render_error
        ld a,(runtime_state_record + RUNTIME_SCL_VIEW_OFFSET)
        cp 6
        ret z
        jp assessment_render
assessment_commit_probe_choice:
        call probe_commit_choice
        jp c,standard_runtime_render_error
        jp assessment_render

assessment_return_to_prompt:
        ; Reopen the final prompt page—the exact question context that led to
        ; these choices—rather than silently jumping to page 1. Up/Left still
        ; walks earlier pages when the question spans a screen.
        ld a,(assessment_prompt_page_count)
        dec a
        ld l,a
        ld h,0
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),hl
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        jp assessment_render

; A = one-based choice. Persist it before moving to another question.
assessment_commit_choice:
        ld b,a
        ld hl,(runtime_item_index)
        ld a,h
        or a
        jp nz,assessment_invalid
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        add hl,de
        ld (hl),b
        ld hl,(runtime_item_index)
        inc hl
        ld a,(runtime_content_count)
        cp l
        jr z,assessment_complete_pending
        ld (runtime_item_index),hl
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        jp assessment_save_and_reopen

; Persist the complete draft before the backup-first SCQ1 transaction.
assessment_complete_pending:
        ; The final answer must be durable before any DSQB/DSQ mutation. If a
        ; cut follows, relaunch reconstructs byte-identical SCR1 and recovery
        ; can idempotently finish the transaction.
        call assessment_calculate_local_score
        ret c
        ld hl,(runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET)
        ld a,h
        or l
        jr z,assessment_complete_guest
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1)
        or RUNTIME_FLAG_RESULT_PENDING_HIGH
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET + 1),a
        call runtime_state_save
        ret c
        call standard_launch_result_queue
        ret

assessment_complete_guest:
        ; Guest receives the exact local score but never consumes a durable
        ; sequence or creates an uploadable result.
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 1),a
        ld a,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1)
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET + 2),a
        ld a,7
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_KIND_OFFSET),a
        ld a,3
        ld (runtime_state_record + RUNTIME_SCL_DRAFT_LENGTH_OFFSET),a
        ld a,(runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET)
        and 0xEC
        or RUNTIME_FLAG_DRAFT_PRESENT
        ld (runtime_state_record + RUNTIME_SCL_FLAGS_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SESSION_LEARNER_OFFSET + 1),a
        ld a,6
        ld (runtime_state_record + RUNTIME_SCL_VIEW_OFFSET),a
        call runtime_state_save
        ret

; Score all committed answers against the one-based answer keys embedded in
; the immutable SCP1 item projection. The key is intentionally available to
; the calculator for honest offline feedback, but is never rendered during an
; active quiz. Save correct and rounded percent in the view-specific scroll
; word; SCQUEUE copies both into SCR1 and later replaces the answer draft with
; a compact result summary.
assessment_calculate_local_score:
        xor a
        ld (assessment_score_index),a
        ld (assessment_score_correct),a
assessment_score_item_loop:
        ld a,(assessment_score_index)
        ld b,a
        ld a,(runtime_content_count)
        cp b
        jr z,assessment_score_items_done
        ld a,b
        ld l,a
        ld h,0
        ld de,(runtime_content_array_offset)
        call sc_array_item
        jp c,assessment_invalid
        ld hl,assessment_key_correct_choice
        call sc_map_find_literal
        jp c,assessment_invalid
        call sc_record_read_byte
        jp c,assessment_invalid
        cp SC_TAG_INT32
        jp nz,assessment_invalid
        inc de
        call sc_record_read_byte
        jp c,assessment_invalid
        or a
        jp z,assessment_invalid
        cp 6
        jp nc,assessment_invalid
        ld (assessment_score_expected),a
        inc de
        ld b,3
assessment_score_high_bytes:
        call sc_record_read_byte
        jp c,assessment_invalid
        or a
        jp nz,assessment_invalid
        inc de
        djnz assessment_score_high_bytes
        ld a,(assessment_score_index)
        ld l,a
        ld h,0
        ld a,(runtime_mode)
        cp RUNTIME_MODE_PROBE
        jr nz,assessment_score_draft_address_ready
        add hl,hl
assessment_score_draft_address_ready:
        ld de,runtime_state_record + RUNTIME_SCL_DRAFT_OFFSET
        add hl,de
        ld a,(hl)
        ld b,a
        ld a,(runtime_mode)
        cp RUNTIME_MODE_PROBE
        ld a,b
        jr nz,assessment_score_given_ready
        rrca
        rrca
        rrca
        rrca
        and 0x0F
assessment_score_given_ready:
        ld b,a
        ld a,(assessment_score_expected)
        cp b
        jr nz,assessment_score_next
        ld a,(assessment_score_correct)
        inc a
        ld (assessment_score_correct),a
assessment_score_next:
        ld a,(assessment_score_index)
        inc a
        ld (assessment_score_index),a
        jp assessment_score_item_loop

assessment_score_items_done:
        ld a,(assessment_score_correct)
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld b,a
        ld hl,0
        ld de,100
assessment_score_multiply:
        ld a,b
        or a
        jr z,assessment_score_round
        add hl,de
        djnz assessment_score_multiply
assessment_score_round:
        ld a,(runtime_content_count)
        srl a
        ld e,a
        ld d,0
        add hl,de
        ld a,(runtime_content_count)
        ld e,a
        ld d,0
        ld b,0
assessment_score_divide:
        or a
        sbc hl,de
        jr c,assessment_score_divide_done
        inc b
        jr assessment_score_divide
assessment_score_divide_done:
        ld a,b
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        or a
        ret

assessment_save_and_reopen:
        call runtime_state_save
        ret c
        call runtime_open_artifact_and_module
        ret c
        jp assessment_open_current

; ---------------------------------------------------------------------------
; Immediate formative feedback with bounded retry. The first response remains
; the score-bearing answer; later responses are separate evidence in SCR1.

probe_open_feedback:
        ld de,(runtime_content_offset)
        ld hl,probe_key_feedback_pages
        call sc_map_find_literal
        jp c,assessment_invalid
        ld (probe_feedback_pages_offset),de
        call assessment_capture_array_count
        jp c,assessment_invalid
        ld (probe_feedback_page_count),a
        or a
        ret

; A = one-based choice. Append it to the current trace and durably enter the
; feedback face before anything corrective is shown.
probe_commit_choice:
        ld (probe_selected_choice),a
        call probe_current_attempt_count
        ld (probe_attempt_number),a
        ld b,a
        ld a,(probe_max_attempts)
        cp b
        jp c,assessment_invalid
        jp z,assessment_invalid
        call probe_current_trace_address
        ld a,(probe_attempt_number)
        or a
        jr nz,probe_commit_later_attempt
        ld a,(probe_selected_choice)
        rlca
        rlca
        rlca
        rlca
        ld (hl),a
        jr probe_choice_committed
probe_commit_later_attempt:
        cp 1
        jr nz,probe_commit_third_attempt
        ld a,(hl)
        and 0xF0
        ld b,a
        ld a,(probe_selected_choice)
        or b
        ld (hl),a
        jr probe_choice_committed
probe_commit_third_attempt:
        inc hl
        ld a,(hl)
        and 0x0F
        ld b,a
        ld a,(probe_selected_choice)
        rlca
        rlca
        rlca
        rlca
        or b
        ld (hl),a
probe_choice_committed:
        ld a,2
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        jp assessment_save_and_reopen

; A = number of recorded attempts (0..3).
probe_current_attempt_count:
        call probe_current_trace_address
        ld a,(hl)
        ld c,a
        and 0xF0
        jr z,probe_attempt_count_zero
        ld a,c
        and 0x0F
        jr z,probe_attempt_count_one
        inc hl
        ld a,(hl)
        and 0xF0
        jr z,probe_attempt_count_two
        ld a,3
        ret
probe_attempt_count_zero:
        xor a
        ret
probe_attempt_count_one:
        ld a,1
        ret
probe_attempt_count_two:
        ld a,2
        ret

; Return the most recently recorded one-based choice in A.
probe_current_attempt_choice:
        call probe_current_attempt_count
        ld (probe_attempt_number),a
        call probe_current_trace_address
        ld a,(probe_attempt_number)
        cp 1
        jr z,probe_choice_first
        cp 2
        jr z,probe_choice_second
        cp 3
        jp nz,assessment_invalid
        inc hl
        ld a,(hl)
        rrca
        rrca
        rrca
        rrca
        and 0x0F
        ret
probe_choice_first:
        ld a,(hl)
        rrca
        rrca
        rrca
        rrca
        and 0x0F
        ret
probe_choice_second:
        ld a,(hl)
        and 0x0F
        ret

; Return A=1 iff the latest response matches the immutable embedded key.
probe_current_is_correct:
        call probe_current_attempt_choice
        ret c
        ld (probe_selected_choice),a
        ld de,(runtime_content_offset)
        ld hl,assessment_key_correct_choice
        call sc_map_find_literal
        jp c,assessment_invalid
        call probe_read_small_integer
        jp c,assessment_invalid
        ld b,a
        ld a,(probe_selected_choice)
        cp b
        ld a,0
        ret nz
        inc a
        ret

; Return A=1 only when policy, correctness, and attempt bound allow retry.
probe_can_retry:
        ld a,(probe_retry_enabled)
        or a
        ret z
        call probe_current_is_correct
        ret c
        or a
        jr nz,probe_retry_unavailable
        call probe_current_attempt_count
        ld b,a
        ld a,(probe_max_attempts)
        cp b
        jr c,probe_retry_unavailable
        jr z,probe_retry_unavailable
        ld a,1
        ret
probe_retry_unavailable:
        xor a
        ret

probe_render_feedback:
        ; Do not claim feedback-view evidence until the durable transition to
        ; this face has succeeded. A restart safely repeats this idempotently.
        call probe_current_trace_address
        inc hl
        bit 1,(hl)
        jr nz,probe_feedback_viewed
        set 1,(hl)
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        call probe_open_feedback
        jp c,standard_runtime_render_error
probe_feedback_viewed:
        call assessment_render_header
        call ui_mode_set
        call ui_select_compact
        call probe_current_is_correct
        jp c,standard_runtime_render_error
        or a
        ld hl,probe_not_yet_label
        jr z,probe_feedback_status_ready
        ld hl,probe_correct_label
probe_feedback_status_ready:
        ld b,2
        ld c,11
        call ui_draw_text
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or a
        jp nz,assessment_invalid_render
        ld a,(probe_feedback_page_count)
        cp l
        jp c,assessment_invalid_render
        jp z,assessment_invalid_render
        ld de,(probe_feedback_pages_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld b,2
        ld c,20
        ld d,122
        ld e,50
        call ui_draw_wrapped_text
        call probe_render_feedback_softkeys
        jp probe_feedback_wait

probe_render_feedback_softkeys:
        call assessment_render_separator
        call probe_can_retry
        jp c,standard_runtime_render_error
        or a
        jr z,probe_render_next_softkey
        call ui_mode_set
        ld b,0
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,probe_retry_label
        ld b,2
        ld c,57
        call ui_draw_text
probe_render_next_softkey:
        call ui_mode_set
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,probe_next_label
        ld b,107
        ld c,57
        jp ui_draw_text

probe_feedback_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,assessment_pause
        cp SC_SCAN_UP
        jr z,probe_feedback_previous
        cp SC_SCAN_DOWN
        jr z,probe_feedback_next
        cp SC_SCAN_F1
        jr z,probe_retry
        cp SC_SCAN_F5
        jr z,probe_continue
        cp SC_SCAN_ENTER
        jr z,probe_continue
        jr probe_feedback_wait

probe_feedback_next:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        inc hl
        ld a,(probe_feedback_page_count)
        cp l
        jr z,probe_feedback_wait
        jr probe_store_feedback_page
probe_feedback_previous:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or l
        jr z,probe_feedback_wait
        dec hl
probe_store_feedback_page:
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),hl
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        jp assessment_render

probe_retry:
        call probe_can_retry
        jp c,standard_runtime_render_error
        or a
        jr z,probe_feedback_wait
        ld a,1
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        jp assessment_render

probe_continue:
        call probe_current_trace_address
        inc hl
        set 0,(hl)
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        call probe_advance_after_continue
        jp c,standard_runtime_render_error
        ld a,(runtime_state_record + RUNTIME_SCL_VIEW_OFFSET)
        cp 6
        ret z
        jp assessment_render

; Advance only after the continuation bit is durable. This makes a cut after
; NEXT resumable: probe_prepare_session observes the bit and finishes exactly
; the same transition on relaunch.
probe_advance_after_continue:
        ld hl,(runtime_item_index)
        inc hl
        ld a,(runtime_content_count)
        cp l
        jr z,probe_complete_pending
        ld (runtime_item_index),hl
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        jp assessment_save_and_reopen
probe_complete_pending:
        call assessment_complete_pending
        ret

; A partially answered assessment remains durable and resumable. Return to
; Home with Continue available; routing to Catalog would let another module
; clear the active session and draft.
assessment_pause:
        xor a
        ld (runtime_state_record + RUNTIME_SCL_VIEW_OFFSET),a
        call runtime_state_save
        jp c,standard_runtime_render_error
        ret

; ---------------------------------------------------------------------------
; Flashcard front/back reader. It uses the same immutable item address, page
; cursor, and copy-on-write SCL1 save but intentionally has no answer draft.

flashcard_prepare:
        call assessment_require_item_count
        jp c,standard_runtime_render_error
        jp flashcard_render

flashcard_render:
        call assessment_open_current
        jp c,standard_runtime_render_error
        call assessment_render_header
        call ui_mode_set
        call ui_select_compact
        ld a,(runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET)
        or a
        ld hl,assessment_key_prompt_pages
        jr z,flashcard_pages_key_ready
        ld hl,assessment_key_answer_pages
flashcard_pages_key_ready:
        ld de,(runtime_content_offset)
        call sc_map_find_literal
        jp c,assessment_invalid_render
        ld (assessment_flash_pages_offset),de
        call assessment_capture_array_count
        jp c,assessment_invalid_render
        ld (assessment_flash_page_count),a
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or a
        jp nz,assessment_invalid_render
        ld a,(assessment_flash_page_count)
        cp l
        jp c,assessment_invalid_render
        jp z,assessment_invalid_render
        ld de,(assessment_flash_pages_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld b,2
        ld c,11
        ld d,122
        ld e,50
        call ui_draw_wrapped_text
        call assessment_render_flip_softkey

flashcard_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,standard_runtime_leave_viewed
        cp SC_SCAN_F1
        jr z,flashcard_flip
        cp SC_SCAN_ENTER
        jr z,flashcard_flip
        cp SC_SCAN_DOWN
        jr z,flashcard_page_next
        cp SC_SCAN_UP
        jr z,flashcard_page_previous
        cp SC_SCAN_RIGHT
        jr z,flashcard_item_next
        cp SC_SCAN_LEFT
        jr z,flashcard_item_previous
        jr flashcard_wait

flashcard_flip:
        ld a,(runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET)
        xor 1
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        xor a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        jr flashcard_save

flashcard_page_next:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        inc hl
        ld a,(assessment_flash_page_count)
        cp l
        jr z,flashcard_wait
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),hl
        jr flashcard_save
flashcard_page_previous:
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        ld a,h
        or l
        jr z,flashcard_wait
        dec hl
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),hl
flashcard_save:
        call assessment_save_and_reopen
        jp c,standard_runtime_render_error
        jp flashcard_render

flashcard_item_next:
        ld hl,(runtime_item_index)
        inc hl
        ld a,(runtime_content_count)
        cp l
        jp z,standard_runtime_leave_completed
        jr flashcard_store_item
flashcard_item_previous:
        ld hl,(runtime_item_index)
        ld a,h
        or l
        jr z,flashcard_wait
        dec hl
flashcard_store_item:
        ld (runtime_item_index),hl
        xor a
        ld (runtime_state_record + RUNTIME_SCL_CARD_FACE_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET),a
        ld (runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET + 1),a
        jr flashcard_save

; ---------------------------------------------------------------------------
; Shared assessment presentation.

assessment_render_header:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        call runtime_copy_lesson_title
        jr nc,assessment_header_title_ready
        ld hl,standard_runtime_title
assessment_header_title_ready:
        ld b,1
        ld c,1
        ld d,98
        call ui_draw_text_clipped
        call assessment_format_position
        ld b,101
        ld c,1
        call ui_draw_text
        ret

assessment_format_position:
        ld hl,assessment_position_text
        ld (hl),'Q'
        inc hl
        ld a,(runtime_item_index)
        inc a
        call assessment_format_byte
        ld (hl),'/'
        inc hl
        ld a,(runtime_content_count)
        call assessment_format_byte
        ld (hl),0
        ld hl,assessment_position_text
        ret

; A=1..99, HL destination; returns advanced HL.
assessment_format_byte:
        ld b,0
assessment_format_tens:
        cp 10
        jr c,assessment_format_units
        sub 10
        inc b
        jr assessment_format_tens
assessment_format_units:
        ld c,a
        ld a,b
        or a
        jr z,assessment_format_one_digit
        add a,'0'
        ld (hl),a
        inc hl
assessment_format_one_digit:
        ld a,c
        add a,'0'
        ld (hl),a
        inc hl
        ret

assessment_render_separator:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        jp ui_fill_rect

assessment_render_choice_softkeys:
        xor a
        ld (assessment_render_index),a
assessment_softkey_loop:
        ld a,(assessment_render_index)
        ld b,a
        ld a,(assessment_choice_count)
        cp b
        ret z
        ld a,b
        ld e,a
        ld d,0
        ld hl,assessment_softkey_x
        add hl,de
        ld b,(hl)
        ld hl,assessment_softkey_width
        add hl,de
        ld d,(hl)
        call ui_mode_set
        ld c,56
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld a,(assessment_render_index)
        add a,'A'
        ld (assessment_letter),a
        ld hl,assessment_softkey_label_x
        ld a,(assessment_render_index)
        ld e,a
        ld d,0
        add hl,de
        ld b,(hl)
        ld c,57
        ld hl,assessment_letter
        call ui_draw_text
        ld a,(assessment_render_index)
        inc a
        ld (assessment_render_index),a
        jr assessment_softkey_loop

; Return A=1 only for a one-page prompt whose every choice fits visibly in a
; four-character compact softkey label. Longer answer text retains the full
; body-choice view rather than relying on an ambiguous truncation.
assessment_prompt_all_choices_fit_softkeys:
        ld a,(assessment_prompt_page_count)
        cp 1
        jr nz,assessment_choices_do_not_fit_softkeys
        xor a
        ld (assessment_render_index),a
assessment_choice_fit_loop:
        ld a,(assessment_render_index)
        ld b,a
        ld a,(assessment_choice_count)
        cp b
        jr z,assessment_choices_fit_softkeys
        ld l,b
        ld h,0
        ld de,(assessment_choices_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld b,5
assessment_choice_fit_length_loop:
        ld a,(hl)
        or a
        jr z,assessment_choice_fit_next
        inc hl
        djnz assessment_choice_fit_length_loop
        jr assessment_choices_do_not_fit_softkeys
assessment_choice_fit_next:
        ld a,(assessment_render_index)
        inc a
        ld (assessment_render_index),a
        jr assessment_choice_fit_loop
assessment_choices_fit_softkeys:
        ld a,1
        ret
assessment_choices_do_not_fit_softkeys:
        xor a
        ret

; Render direct answer text over its corresponding F key. The preceding fit
; gate guarantees no answer is silently shortened; clipping remains a final
; physical-LCD safety guard only.
assessment_render_direct_choice_softkeys:
        call assessment_render_separator
        xor a
        ld (assessment_render_index),a
assessment_direct_softkey_loop:
        ld a,(assessment_render_index)
        ld b,a
        ld a,(assessment_choice_count)
        cp b
        ret z
        ld e,b
        ld d,0
        ld hl,assessment_softkey_x
        add hl,de
        ld b,(hl)
        ld hl,assessment_softkey_width
        add hl,de
        ld d,(hl)
        call ui_mode_set
        ld c,56
        ld e,8
        call ui_fill_rect
        ld a,(assessment_render_index)
        ld l,a
        ld h,0
        ld de,(assessment_choices_offset)
        call sc_array_item
        jp c,assessment_invalid_render
        call sc_copy_node_string
        jp c,assessment_invalid_render
        ld a,(assessment_render_index)
        ld e,a
        ld d,0
        ld hl,assessment_softkey_x
        add hl,de
        ld b,(hl)
        inc b
        inc b
        inc b
        ld c,57
        call ui_mode_clear
        call ui_draw_text
        ld a,(assessment_render_index)
        inc a
        ld (assessment_render_index),a
        jr assessment_direct_softkey_loop

; Long/multi-page questions keep their answer view separate. Physical Up/Left
; walks earlier prompt pages; F5 states the forward action: MORE advances and
; ANSWERS appears only after the final question page.
assessment_render_prompt_softkeys:
        call assessment_render_separator
        call ui_mode_set
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        ld hl,(runtime_state_record + RUNTIME_SCL_SCROLL_OFFSET)
        inc hl
        ld a,(assessment_prompt_page_count)
        cp l
        ld hl,assessment_answers_label
        jr z,assessment_prompt_navigation_label_ready
        ld hl,assessment_more_label
assessment_prompt_navigation_label_ready:
        call ui_mode_clear
        ld b,104
        ld c,57
        jp ui_draw_text

assessment_render_flip_softkey:
        call assessment_render_separator
        call ui_mode_set
        ld b,0
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,assessment_flip_label
        ld b,5
        ld c,57
        jp ui_draw_text

assessment_invalid_render:
        ld a,RUNTIME_ERROR_MODULE
        ld (runtime_error),a
        jp standard_runtime_render_error

assessment_prompt_pages_offset: defw 0
assessment_prompt_page_count:   defb 0
assessment_choices_offset:      defw 0
assessment_choice_count:        defb 0
assessment_flash_pages_offset:  defw 0
assessment_flash_page_count:    defb 0
assessment_render_index:        defb 0
assessment_render_y:            defb 0
assessment_letter:              defb 'A',0
assessment_position_text:       defs 7,0
assessment_softkey_x:           defb 0,26,51,77,102
assessment_softkey_width:       defb 26,25,26,25,26
assessment_softkey_label_x:     defb 11,37,63,88,113
assessment_flip_label:          defb "FLIP",0
assessment_more_label:          defb "MORE",0
assessment_answers_label:       defb "ANS",0
assessment_question_hint:       defb "LEFT: Q",0
assessment_key_type:            defb "type",0
assessment_key_prompt_pages:    defb "promptPages",0
assessment_key_answer_pages:    defb "answerPages",0
assessment_key_choices:         defb "choices",0
assessment_key_correct_choice:  defb "correctChoice",0
assessment_type_multiple_choice: defb "multiple_choice",0
assessment_score_index:         defb 0
assessment_score_correct:       defb 0
assessment_score_expected:      defb 0
probe_key_feedback:              defb "feedback",0
probe_key_on_incorrect:          defb "onIncorrect",0
probe_key_max_attempts:          defb "maxAttemptsPerItem",0
probe_key_feedback_pages:        defb "feedbackPages",0
probe_action_retry:              defb "explain_then_retry",0
probe_action_continue:           defb "explain_then_continue",0
probe_correct_label:             defb "CORRECT",0
probe_not_yet_label:             defb "NOT YET",0
probe_retry_label:               defb "RETRY",0
probe_next_label:                defb "NEXT",0
probe_policy_offset:             defw 0
probe_policy_action_offset:      defw 0
probe_feedback_pages_offset:     defw 0
probe_feedback_page_count:       defb 0
probe_max_attempts:              defb 0
probe_retry_enabled:             defb 0
probe_attempt_number:            defb 0
probe_selected_choice:           defb 0
