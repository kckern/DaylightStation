; SchoolCalc Adaptive Study v1 learning runtime.
;
; DSSTUDY/SCSP is immutable prescription identity. The existing alternating
; SCL1 slots hold one bounded 45-byte adaptive continuation. Every exposure,
; flip, rating, and quiz choice is committed before another item is shown.

include "ti86asm.inc"

AD_MAX_CARDS:          equ 12
AD_DRAFT_KIND:         equ 9
AD_DRAFT_BYTES:        equ 45
AD_PHASE_STUDY:        equ 0
AD_PHASE_SUMMARY:      equ 1
AD_PHASE_QUIZ:         equ 2
AD_PHASE_RESULT:       equ 3

AD_STATE:              equ SCSTATE_DRAFT_OFFSET
AD_MARKER:             equ AD_STATE + 0
AD_PHASE:              equ AD_STATE + 1
AD_CARD_COUNT:         equ AD_STATE + 2
AD_QUIZ_COUNT:         equ AD_STATE + 3
AD_EXPOSURE_CAP:       equ AD_STATE + 4
AD_CURRENT_CARD:       equ AD_STATE + 5
AD_ORDINAL:            equ AD_STATE + 6
AD_CURRENT_QUIZ:       equ AD_STATE + 7
AD_FACE:               equ AD_STATE + 8
AD_TELEMETRY:          equ AD_STATE + 9
AD_DUE:                equ AD_STATE + 21
AD_CHOICES:            equ AD_STATE + 33

AD_TELEMETRY_EXPOSED:  equ 0x20
AD_TELEMETRY_RETIRED:  equ 0x10
AD_RATING_AGAIN:       equ 0x04
AD_RATING_HARD:        equ 0x08
AD_RATING_KNOW:        equ 0x0C

org _asm_exec_ram

        nop
        jp adaptive_start
        defw 0
        defw adaptive_runtime_name
        defb "SCX1"
        defb 1
        defb 1
        defb 0
        defw 0
        defw 0
        defw 0

adaptive_runtime_name: defb 0

adaptive_start:
        call _runindicoff
        call sc_input_init
        call adaptive_open_prescription
        jp c,adaptive_error
        call adaptive_load_or_initialize
        jp c,adaptive_error
        call adaptive_validate_artifact
        jp c,adaptive_error
adaptive_dispatch:
        ld a,(scstate_record + AD_PHASE)
        cp AD_PHASE_STUDY
        jp z,adaptive_render_card
        cp AD_PHASE_SUMMARY
        jp z,adaptive_render_summary
        cp AD_PHASE_QUIZ
        jp z,adaptive_render_quiz
        cp AD_PHASE_RESULT
        jp z,adaptive_render_result
        jp adaptive_error

; ---------------------------------------------------------------------------
; Immutable SCSP prescription

adaptive_open_prescription:
        ld hl,adaptive_dsstudy_name
        ld de,adaptive_scsp_magic
        call sc_envelope_open
        ret c
        ld de,7
        ld hl,adaptive_device_id
        ld c,17
        call adaptive_copy_short
        ret c
        ld hl,adaptive_request_id
        ld b,3
        call adaptive_copy_fixed
        ret c
        ld hl,adaptive_session_code
        ld b,6
        call adaptive_copy_fixed
        ret c
        xor a
        ld (hl),a
        call adaptive_skip_short             ; prescriptionId
        ret c
        call adaptive_skip_short             ; studySessionId
        ret c
        call sc_record_read_byte
        ret c
        ld (adaptive_learner_key),a
        inc de
        call sc_record_read_byte
        ret c
        ld (adaptive_learner_key + 1),a
        inc de
        ld hl,adaptive_artifact_id
        ld c,31
        call adaptive_copy_short
        ret c
        ld hl,adaptive_artifact_name + 2
        ld c,9
        call adaptive_copy_short_exact_eight
        ret c
        call sc_record_read_byte
        ret c
        ld (adaptive_artifact_length),a
        inc de
        call sc_record_read_byte
        ret c
        ld (adaptive_artifact_length + 1),a
        inc de
        ld hl,32
        add hl,de
        ret c
        ex de,hl
        call sc_record_read_byte
        ret c
        cp 1                              ; v1 client accepts prescription ABI 1 exactly
        jp nz,adaptive_invalid
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp z,adaptive_invalid
        cp AD_MAX_CARDS + 1
        jp nc,adaptive_invalid
        ld (adaptive_card_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp z,adaptive_invalid
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jp c,adaptive_invalid
        ld a,b
        ld (adaptive_quiz_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp z,adaptive_invalid
        cp 5
        jp nc,adaptive_invalid
        ld (adaptive_exposure_cap),a
        inc de
        call sc_record_read_byte             ; passing percent
        ret c
        cp 101
        jp nc,adaptive_invalid
        ld (adaptive_passing_percent),a
        inc de
        call adaptive_skip_short             ; bank revision
        ret c
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,adaptive_invalid
        call adaptive_validate_artifact_identity
        ret

adaptive_copy_short_exact_eight:
        call sc_record_read_byte
        ret c
        cp 8
        jr nz,adaptive_invalid
        ld b,a
        inc de
        jr adaptive_copy_fixed

; DE record cursor, HL destination, C exclusive maximum. Adds a NUL.
adaptive_copy_short:
        call sc_record_read_byte
        ret c
        or a
        jr z,adaptive_invalid
        cp c
        jr nc,adaptive_invalid
        ld b,a
        inc de
        call adaptive_copy_fixed
        ret c
        xor a
        ld (hl),a
        or a
        ret

adaptive_copy_fixed:
        ld a,b
        or a
        ret z
adaptive_copy_fixed_loop:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        djnz adaptive_copy_fixed_loop
        or a
        ret

adaptive_skip_short:
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

adaptive_validate_artifact_identity:
        ld hl,adaptive_artifact_id
        ld de,adaptive_artifact_prefix
        ld b,8
adaptive_artifact_prefix_loop:
        ld a,(de)
        cp (hl)
        jr nz,adaptive_invalid
        inc de
        inc hl
        djnz adaptive_artifact_prefix_loop
        push hl
        ld de,adaptive_artifact_name + 4
        ld b,6
adaptive_artifact_name_loop:
        ld a,(de)
        cp (hl)
        jr nz,adaptive_artifact_identity_pop_invalid
        inc hl
        inc de
        djnz adaptive_artifact_name_loop
        pop hl
        ld de,adaptive_artifact_key
        ld b,10
adaptive_artifact_key_loop:
        ld a,(hl)
        or a
        jp z,adaptive_invalid
        ld (de),a
        inc hl
        inc de
        djnz adaptive_artifact_key_loop
        ld a,(hl)
        or a
        jp nz,adaptive_invalid
        ret
adaptive_artifact_identity_pop_invalid:
        pop hl
adaptive_invalid:
        scf
        ret

; ---------------------------------------------------------------------------
; Alternating durable continuation

adaptive_load_or_initialize:
        call scstate_load
        jr c,adaptive_initialize
        ld a,(scstate_record + SCSTATE_DRAFT_KIND_OFFSET)
        cp AD_DRAFT_KIND
        jr nz,adaptive_initialize
        ld a,(scstate_record + SCSTATE_DRAFT_LENGTH_OFFSET)
        cp AD_DRAFT_BYTES
        jr nz,adaptive_initialize
        ld a,(scstate_record + AD_MARKER)
        cp 'A'
        jr nz,adaptive_initialize
        ld hl,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld de,adaptive_artifact_key
        ld b,10
adaptive_resume_key_loop:
        ld a,(de)
        cp (hl)
        jr nz,adaptive_initialize
        inc de
        inc hl
        djnz adaptive_resume_key_loop
        ld hl,(scstate_record + SCSTATE_SESSION_LEARNER_OFFSET)
        ld de,(adaptive_learner_key)
        or a
        sbc hl,de
        jr nz,adaptive_initialize
        ld a,(scstate_record + AD_CARD_COUNT)
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jr nz,adaptive_initialize
        ld a,(scstate_record + AD_QUIZ_COUNT)
        ld b,a
        ld a,(adaptive_quiz_count)
        cp b
        jr nz,adaptive_initialize
        or a
        ret

adaptive_initialize:
        ld hl,scstate_record
        ld b,SCSTATE_RECORD_BYTES
        xor a
adaptive_initialize_clear:
        ld (hl),a
        inc hl
        djnz adaptive_initialize_clear
        ld hl,adaptive_scl1_prefix
        ld de,scstate_record
        ld bc,7
        ldir
        ld a,1
        ld (scstate_record + SCSTATE_FLAGS_OFFSET),a
        ld a,AD_DRAFT_KIND
        ld (scstate_record + SCSTATE_DRAFT_KIND_OFFSET),a
        ld a,AD_DRAFT_BYTES
        ld (scstate_record + SCSTATE_DRAFT_LENGTH_OFFSET),a
        ld a,'A'
        ld (scstate_record + AD_MARKER),a
        xor a
        ld (scstate_record + AD_PHASE),a
        ld a,(adaptive_card_count)
        ld (scstate_record + AD_CARD_COUNT),a
        ld a,(adaptive_quiz_count)
        ld (scstate_record + AD_QUIZ_COUNT),a
        ld a,(adaptive_exposure_cap)
        ld (scstate_record + AD_EXPOSURE_CAP),a
        ld a,0xFF
        ld (scstate_record + AD_CURRENT_CARD),a
        xor a
        ld (adaptive_scan_index),a
adaptive_initialize_due_loop:
        ld a,(adaptive_scan_index)
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jr z,adaptive_initialize_due_ready
        ld a,b
        push af
        call adaptive_due_address
        pop af
        inc a
        ld (hl),a
        ld a,(adaptive_scan_index)
        inc a
        ld (adaptive_scan_index),a
        jr adaptive_initialize_due_loop
adaptive_initialize_due_ready:
        ld hl,adaptive_artifact_key
        ld de,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld bc,10
        ldir
        ld hl,(adaptive_learner_key)
        ld (scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET),hl
        ld (scstate_record + SCSTATE_SESSION_LEARNER_OFFSET),hl
        ld a,1
        ld (scstate_active_slot),a
        call adaptive_choose_next
        ret

adaptive_save:
        call scstate_save
        ret

; Choose the earliest due active card. If all are cooling, advance directly
; to the earliest due ordinal. Showing the selected card increments exposure
; exactly once before the frame is drawn.
adaptive_choose_next:
        ld a,0xFF
        ld (adaptive_best_card),a
        ld (adaptive_best_due),a
        ld (adaptive_min_due),a
        xor a
        ld (adaptive_scan_index),a
adaptive_choose_scan:
        ld a,(adaptive_scan_index)
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jr z,adaptive_choose_scanned
        ld a,b
        call adaptive_telemetry_address
        ld a,(hl)
        and AD_TELEMETRY_RETIRED
        jr nz,adaptive_choose_next_index
        ld a,(adaptive_scan_index)
        call adaptive_due_address
        ld a,(hl)
        ld c,a
        ld a,(adaptive_min_due)
        cp c
        jr c,adaptive_choose_eligible
        jr z,adaptive_choose_eligible
        ld a,c
        ld (adaptive_min_due),a
adaptive_choose_eligible:
        ld a,(scstate_record + AD_ORDINAL)
        inc a
        cp c
        jr c,adaptive_choose_next_index
        ld a,(adaptive_best_due)
        cp c
        jr c,adaptive_choose_next_index
        jr z,adaptive_choose_next_index
        ld a,c
        ld (adaptive_best_due),a
        ld a,(adaptive_scan_index)
        ld (adaptive_best_card),a
adaptive_choose_next_index:
        ld a,(adaptive_scan_index)
        inc a
        ld (adaptive_scan_index),a
        jr adaptive_choose_scan

adaptive_choose_scanned:
        ld a,(adaptive_min_due)
        cp 0xFF
        jr z,adaptive_study_complete
        ld a,(adaptive_best_card)
        cp 0xFF
        jr nz,adaptive_choose_show
        ld a,(adaptive_min_due)
        dec a
        ld (scstate_record + AD_ORDINAL),a
        jr adaptive_choose_next
adaptive_choose_show:
        ld (scstate_record + AD_CURRENT_CARD),a
        call adaptive_telemetry_address
        ld a,(hl)
        bit 5,a
        jr z,adaptive_first_exposure
        ld b,a
        and 3
        cp 3
        jp z,adaptive_invalid
        inc a
        ld c,a
        ld a,b
        and 0xFC
        or c
        jr adaptive_exposure_ready
adaptive_first_exposure:
        or AD_TELEMETRY_EXPOSED
adaptive_exposure_ready:
        ld (hl),a
        ld a,(scstate_record + AD_ORDINAL)
        inc a
        ld (scstate_record + AD_ORDINAL),a
        xor a
        ld (scstate_record + AD_FACE),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        jp adaptive_save

adaptive_study_complete:
        ld a,AD_PHASE_SUMMARY
        ld (scstate_record + AD_PHASE),a
        xor a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        jp adaptive_save

adaptive_telemetry_address:
        ld e,a
        ld d,0
        ld hl,scstate_record + AD_TELEMETRY
        add hl,de
        ret
adaptive_due_address:
        ld e,a
        ld d,0
        ld hl,scstate_record + AD_DUE
        add hl,de
        ret
adaptive_choice_address:
        ld e,a
        ld d,0
        ld hl,scstate_record + AD_CHOICES
        add hl,de
        ret

; ---------------------------------------------------------------------------
; Artifact navigation

adaptive_validate_artifact:
        xor a
        call adaptive_open_module
        ret c
        ld a,(adaptive_content_count)
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jp nz,adaptive_invalid
        ld a,1
        call adaptive_open_module
        ret c
        ld a,(adaptive_content_count)
        ld b,a
        ld a,(adaptive_quiz_count)
        cp b
        jp nz,adaptive_invalid
        or a
        ret

; A = module index. Opens the immutable SCP1 and captures its bank items.
adaptive_open_module:
        ld (adaptive_module_index),a
        ld hl,adaptive_artifact_name
        ld de,adaptive_scp1_magic
        call sc_record_open
        ret c
        ld hl,(sc_record_length)
        ld de,(adaptive_artifact_length)
        or a
        sbc hl,de
        jp nz,adaptive_invalid
        ld de,(sc_record_root_offset)
        ld hl,adaptive_key_schema
        call sc_map_find_literal
        ret c
        ld hl,adaptive_package_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,adaptive_invalid
        ld de,(sc_record_root_offset)
        ld hl,adaptive_key_artifact_id
        call sc_map_find_literal
        ret c
        ld hl,adaptive_artifact_id
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,adaptive_invalid
        ld de,(sc_record_root_offset)
        ld hl,adaptive_key_lesson
        call sc_map_find_literal
        ret c
        ld hl,adaptive_key_modules
        call sc_map_find_literal
        ret c
        ld a,(adaptive_module_index)
        ld l,a
        ld h,0
        call sc_array_item
        ret c
        ld (adaptive_module_offset),de
        ld hl,adaptive_key_type
        call sc_map_find_literal
        ret c
        ld a,(adaptive_module_index)
        or a
        ld hl,adaptive_type_flashcards
        jr z,adaptive_module_type_ready
        ld hl,adaptive_type_quiz
adaptive_module_type_ready:
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,adaptive_invalid
        ld de,(adaptive_module_offset)
        ld hl,adaptive_key_bank
        call sc_map_find_literal
        ret c
        ld hl,adaptive_key_items
        call sc_map_find_literal
        ret c
        ld (adaptive_content_array),de
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        ret c
        cp SC_TAG_ARRAY
        jp nz,adaptive_invalid
        call sc_cursor_read_word
        ret c
        ld a,h
        or a
        jp nz,adaptive_invalid
        ld a,l
        ld (adaptive_content_count),a
        or a
        ret

; A item index, module already selected by B (0/1).
adaptive_open_item:
        ld (adaptive_item_index),a
        ld a,b
        call adaptive_open_module
        ret c
        ld a,(adaptive_item_index)
        ld l,a
        ld h,0
        ld de,(adaptive_content_array)
        call sc_array_item
        ret c
        ld (adaptive_item_offset),de
        or a
        ret

; ---------------------------------------------------------------------------
; Card interaction

adaptive_render_card:
        ld a,(scstate_record + AD_CURRENT_CARD)
        ld b,0
        call adaptive_open_item
        jp c,adaptive_error
        call adaptive_render_header
        ld de,(adaptive_item_offset)
        ld a,(scstate_record + AD_FACE)
        or a
        ld hl,adaptive_key_prompt_pages
        jr z,adaptive_card_pages_ready
        ld hl,adaptive_key_answer_pages
adaptive_card_pages_ready:
        call sc_map_find_literal
        jp c,adaptive_error
        ld (adaptive_pages_offset),de
        call adaptive_read_array_count
        jp c,adaptive_error
        ld (adaptive_page_count),a
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET + 1)
        or a
        jp nz,adaptive_error
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        ld b,a
        ld a,(adaptive_page_count)
        cp b
        jp c,adaptive_error
        jp z,adaptive_error
        ld a,b
        ld l,a
        ld h,0
        ld de,(adaptive_pages_offset)
        call sc_array_item
        jp c,adaptive_error
        call sc_copy_node_string
        jp c,adaptive_error
        call ui_mode_set
        call ui_select_compact
        ld b,2
        ld c,12
        ld d,122
        ld e,42
        call ui_draw_wrapped_text
        call adaptive_render_card_rail
adaptive_card_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_F1
        jp z,adaptive_flip
        cp SC_SCAN_ENTER
        jp z,adaptive_flip
        cp SC_SCAN_UP
        jp z,adaptive_page_previous
        cp SC_SCAN_DOWN
        jp z,adaptive_page_next
        ld b,a
        ld a,(scstate_record + AD_FACE)
        or a
        ld a,b
        jr z,adaptive_card_wait
        cp SC_SCAN_F3
        ld b,AD_RATING_AGAIN
        jp z,adaptive_rate
        cp SC_SCAN_F4
        ld b,AD_RATING_HARD
        jp z,adaptive_rate
        cp SC_SCAN_F5
        ld b,AD_RATING_KNOW
        jp z,adaptive_rate
        jr adaptive_card_wait

adaptive_flip:
        ld a,(scstate_record + AD_FACE)
        xor 1
        ld (scstate_record + AD_FACE),a
        xor a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_card

adaptive_page_previous:
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        or a
        jr z,adaptive_card_wait
        dec a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_card

adaptive_page_next:
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        inc a
        ld b,a
        ld a,(adaptive_page_count)
        cp b
        jr z,adaptive_card_wait
        ld a,b
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_card

; B rating nibble. Persist final rating and retirement/due before selecting.
adaptive_rate:
        ld a,(scstate_record + AD_CURRENT_CARD)
        push af
        call adaptive_telemetry_address
        ld a,(hl)
        and 0xF3
        or b
        ld c,a
        ld a,b
        cp AD_RATING_KNOW
        jr z,adaptive_rate_retire
        ld a,c
        and 3
        inc a
        ld b,a
        ld a,(adaptive_exposure_cap)
        cp b
        jr z,adaptive_rate_retire
        ld a,c
        ld (hl),a
        pop af
        call adaptive_due_address
        ld a,c
        and 0x0C
        cp AD_RATING_HARD
        ld a,(scstate_record + AD_ORDINAL)
        jr z,adaptive_rate_hard_due
        add a,3
        jr adaptive_rate_due_ready
adaptive_rate_hard_due:
        add a,5
adaptive_rate_due_ready:
        ld (hl),a
        call adaptive_choose_next
        jp c,adaptive_error
        jp adaptive_dispatch
adaptive_rate_retire:
        ld a,c
        or AD_TELEMETRY_RETIRED
        ld (hl),a
        pop af
        call adaptive_choose_next
        jp c,adaptive_error
        jp adaptive_dispatch

adaptive_render_card_rail:
        call adaptive_clear_rail
        ld hl,adaptive_label_flip
        ld b,4
        ld c,57
        call ui_draw_text
        ld a,(scstate_record + AD_FACE)
        or a
        jp z,ui_mode_set
        ld hl,adaptive_label_again
        ld b,54
        ld c,57
        call ui_draw_text
        ld hl,adaptive_label_hard
        ld b,80
        ld c,57
        call ui_draw_text
        ld hl,adaptive_label_know
        ld b,105
        ld c,57
        call ui_draw_text
        jp ui_mode_set

; ---------------------------------------------------------------------------
; Summary and quiz

adaptive_render_summary:
        call _clrLCD
        ld hl,adaptive_summary_title
        call adaptive_header_text
        xor a
        ld (adaptive_known_count),a
        ld (adaptive_hard_count),a
        ld (adaptive_again_count),a
        ld (adaptive_unresolved_count),a
        ld (adaptive_scan_index),a
adaptive_summary_scan:
        ld a,(adaptive_scan_index)
        ld b,a
        ld a,(adaptive_card_count)
        cp b
        jr z,adaptive_summary_ready
        ld a,b
        call adaptive_telemetry_address
        ld a,(hl)
        ld b,a
        and 0x0C
        cp AD_RATING_KNOW
        jr z,adaptive_summary_known
        ld a,(adaptive_unresolved_count)
        inc a
        ld (adaptive_unresolved_count),a
        ld a,b
        and 0x0C
        cp AD_RATING_HARD
        jr z,adaptive_summary_hard
        ld a,(adaptive_again_count)
        inc a
        ld (adaptive_again_count),a
        jr adaptive_summary_next
adaptive_summary_hard:
        ld a,(adaptive_hard_count)
        inc a
        ld (adaptive_hard_count),a
        jr adaptive_summary_next
adaptive_summary_known:
        ld a,(adaptive_known_count)
        inc a
        ld (adaptive_known_count),a
adaptive_summary_next:
        ld a,(adaptive_scan_index)
        inc a
        ld (adaptive_scan_index),a
        jr adaptive_summary_scan
adaptive_summary_ready:
        ld hl,adaptive_summary_known_text
        ld a,(adaptive_known_count)
        ld c,14
        call adaptive_render_count_line
        ld hl,adaptive_summary_hard_text
        ld a,(adaptive_hard_count)
        ld c,23
        call adaptive_render_count_line
        ld hl,adaptive_summary_again_text
        ld a,(adaptive_again_count)
        ld c,32
        call adaptive_render_count_line
        ld hl,adaptive_summary_unresolved_text
        ld a,(adaptive_unresolved_count)
        ld c,41
        call adaptive_render_count_line
        call adaptive_clear_rail
        ld hl,adaptive_label_quiz
        ld b,104
        ld c,57
        call ui_draw_text
        call ui_mode_set
adaptive_summary_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_F5
        jr nz,adaptive_summary_wait
        ld a,AD_PHASE_QUIZ
        ld (scstate_record + AD_PHASE),a
        xor a
        ld (scstate_record + AD_CURRENT_QUIZ),a
        ld (scstate_record + AD_FACE),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz

adaptive_render_count_line:
        push af
        ld b,2
        call ui_draw_text
        pop af
        call adaptive_format_byte
        ld hl,adaptive_number
        ld b,108
        jp ui_draw_text

adaptive_render_quiz:
        ld a,(scstate_record + AD_CURRENT_QUIZ)
        ld b,1
        call adaptive_open_item
        jp c,adaptive_error
        call adaptive_render_header
        ld a,(scstate_record + AD_FACE)
        or a
        jp nz,adaptive_render_choices
        ld de,(adaptive_item_offset)
        ld hl,adaptive_key_prompt_pages
        call sc_map_find_literal
        jp c,adaptive_error
        ld (adaptive_pages_offset),de
        call adaptive_read_array_count
        jp c,adaptive_error
        ld (adaptive_page_count),a
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        ld l,a
        ld h,0
        ld de,(adaptive_pages_offset)
        call sc_array_item
        jp c,adaptive_error
        call sc_copy_node_string
        jp c,adaptive_error
        call ui_mode_set
        call ui_select_compact
        ld b,2
        ld c,12
        ld d,122
        ld e,42
        call ui_draw_wrapped_text
        call adaptive_clear_rail
        ld hl,adaptive_label_answers
        ld b,102
        ld c,57
        call ui_draw_text
        call ui_mode_set
adaptive_quiz_prompt_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_UP
        jp z,adaptive_quiz_page_previous
        cp SC_SCAN_DOWN
        jp z,adaptive_quiz_page_next
        cp SC_SCAN_RIGHT
        jr z,adaptive_quiz_show_choices
        cp SC_SCAN_ENTER
        jr z,adaptive_quiz_show_choices
        cp SC_SCAN_F5
        jr nz,adaptive_quiz_prompt_wait
adaptive_quiz_show_choices:
        ld a,1
        ld (scstate_record + AD_FACE),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz

adaptive_quiz_page_previous:
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        or a
        jr z,adaptive_quiz_prompt_wait
        dec a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz
adaptive_quiz_page_next:
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        inc a
        ld b,a
        ld a,(adaptive_page_count)
        cp b
        jr z,adaptive_quiz_show_choices
        ld a,b
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz

adaptive_render_choices:
        ld de,(adaptive_item_offset)
        ld hl,adaptive_key_choices
        call sc_map_find_literal
        jp c,adaptive_error
        ld (adaptive_choices_offset),de
        call adaptive_read_array_count
        jp c,adaptive_error
        cp 2
        jp c,adaptive_error
        cp 6
        jp nc,adaptive_error
        ld (adaptive_choice_count),a
        xor a
        ld (adaptive_scan_index),a
        ld a,12
        ld (adaptive_render_y),a
adaptive_choice_render_loop:
        ld a,(adaptive_scan_index)
        ld b,a
        ld a,(adaptive_choice_count)
        cp b
        jr z,adaptive_choices_rendered
        ld a,b
        add a,'A'
        ld (adaptive_choice_label),a
        ld hl,adaptive_choice_label
        ld b,2
        ld a,(adaptive_render_y)
        ld c,a
        call ui_draw_text
        ld a,(adaptive_scan_index)
        ld l,a
        ld h,0
        ld de,(adaptive_choices_offset)
        call sc_array_item
        jp c,adaptive_error
        call sc_copy_node_string
        jp c,adaptive_error
        ld b,12
        ld a,(adaptive_render_y)
        ld c,a
        ld d,112
        call ui_draw_text_clipped
        ld a,(adaptive_scan_index)
        inc a
        ld (adaptive_scan_index),a
        ld a,(adaptive_render_y)
        add a,8
        ld (adaptive_render_y),a
        jr adaptive_choice_render_loop
adaptive_choices_rendered:
        call adaptive_render_choice_rail
adaptive_choice_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        jr z,adaptive_quiz_back_prompt
        cp SC_SCAN_UP
        jr z,adaptive_quiz_back_prompt
        cp SC_SCAN_F1
        ld b,1
        jr z,adaptive_choice_selected
        cp SC_SCAN_F2
        ld b,2
        jr z,adaptive_choice_selected
        cp SC_SCAN_F3
        ld b,3
        jr z,adaptive_choice_selected
        cp SC_SCAN_F4
        ld b,4
        jr z,adaptive_choice_selected
        cp SC_SCAN_F5
        ld b,5
        jr nz,adaptive_choice_wait
adaptive_choice_selected:
        ld a,(adaptive_choice_count)
        cp b
        jr c,adaptive_choice_wait
        ld a,b
        jp adaptive_commit_quiz_choice
adaptive_quiz_back_prompt:
        xor a
        ld (scstate_record + AD_FACE),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz

adaptive_commit_quiz_choice:
        ld b,a
        ld a,(scstate_record + AD_CURRENT_QUIZ)
        call adaptive_choice_address
        ld (hl),b
        ld a,(scstate_record + AD_CURRENT_QUIZ)
        inc a
        ld b,a
        ld a,(adaptive_quiz_count)
        cp b
        jr z,adaptive_quiz_complete
        ld a,b
        ld (scstate_record + AD_CURRENT_QUIZ),a
        xor a
        ld (scstate_record + AD_FACE),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_save
        jp c,adaptive_error
        jp adaptive_render_quiz

adaptive_quiz_complete:
        call adaptive_calculate_score
        jp c,adaptive_error
        ld a,AD_PHASE_RESULT
        ld (scstate_record + AD_PHASE),a
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        or SCSTATE_FLAG_RESULT_PENDING_HIGH
        ld (scstate_record + SCSTATE_FLAGS_OFFSET + 1),a
        call adaptive_save
        jp c,adaptive_error
        call adaptive_launch_queue
        jp c,adaptive_error
        jp adaptive_render_result

adaptive_calculate_score:
        xor a
        ld (adaptive_score_correct),a
        ld (adaptive_scan_index),a
adaptive_score_loop:
        ld a,(adaptive_scan_index)
        ld b,a
        ld a,(adaptive_quiz_count)
        cp b
        jr z,adaptive_score_done
        ld a,b
        push af
        ld b,1
        call adaptive_open_item
        jr c,adaptive_score_open_failed
        pop af
        ld de,(adaptive_item_offset)
        ld hl,adaptive_key_correct_choice
        call sc_map_find_literal
        ret c
        call adaptive_read_int_byte
        ret c
        ld b,a
        ld a,(adaptive_scan_index)
        call adaptive_choice_address
        ld a,(hl)
        cp b
        jr nz,adaptive_score_next
        ld a,(adaptive_score_correct)
        inc a
        ld (adaptive_score_correct),a
adaptive_score_next:
        ld a,(adaptive_scan_index)
        inc a
        ld (adaptive_scan_index),a
        jr adaptive_score_loop
adaptive_score_open_failed:
        pop af
        scf
        ret
adaptive_score_done:
        ld a,(adaptive_score_correct)
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        call adaptive_percent
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        or a
        ret

adaptive_percent:
        ld a,(adaptive_score_correct)
        ld b,a
        ld hl,0
        ld de,100
adaptive_percent_multiply:
        ld a,b
        or a
        jr z,adaptive_percent_round
        add hl,de
        djnz adaptive_percent_multiply
adaptive_percent_round:
        ld a,(adaptive_quiz_count)
        srl a
        ld e,a
        ld d,0
        add hl,de
        ld a,(adaptive_quiz_count)
        ld e,a
        ld d,0
        ld b,0
adaptive_percent_divide:
        or a
        sbc hl,de
        jr c,adaptive_percent_done
        inc b
        jr adaptive_percent_divide
adaptive_percent_done:
        ld a,b
        ret

adaptive_launch_queue:
        ld hl,adaptive_scqueue_name
        rst 0x20
        rst 0x10
        ret c
        call _exec_assembly
        call sc_input_wait_release
        call scstate_load
        ret

adaptive_render_result:
        call _clrLCD
        ld hl,adaptive_result_title
        call adaptive_header_text
        ld hl,adaptive_result_score
        ld b,2
        ld c,18
        call ui_draw_text
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        call adaptive_format_byte
        ld hl,adaptive_number
        ld b,50
        ld c,18
        call ui_draw_text
        ld hl,adaptive_result_of
        ld b,66
        ld c,18
        call ui_draw_text
        ld a,(adaptive_quiz_count)
        call adaptive_format_byte
        ld hl,adaptive_number
        ld b,78
        ld c,18
        call ui_draw_text
        ld hl,adaptive_result_queued
        ld b,2
        ld c,32
        call ui_draw_text
        call adaptive_clear_rail
        ld hl,adaptive_label_qr
        ld b,5
        ld c,57
        call ui_draw_text
        ld hl,adaptive_label_done
        ld b,104
        ld c,57
        call ui_draw_text
        call ui_mode_set
adaptive_result_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_F1
        jr z,adaptive_launch_qr
        cp SC_SCAN_F5
        ret z
        jr adaptive_result_wait

adaptive_launch_qr:
        ld hl,adaptive_scqr_name
        rst 0x20
        rst 0x10
        jp c,adaptive_result_wait
        call _exec_assembly
        call sc_input_wait_release
        jp adaptive_render_result

; ---------------------------------------------------------------------------
; Shared rendering and typed values

adaptive_render_header:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,adaptive_title
        ld b,1
        ld c,1
        call ui_draw_text
        ld a,(scstate_record + AD_PHASE)
        cp AD_PHASE_QUIZ
        ld a,(scstate_record + AD_CURRENT_CARD)
        jr nz,adaptive_position_ready
        ld a,(scstate_record + AD_CURRENT_QUIZ)
adaptive_position_ready:
        inc a
        call adaptive_format_byte
        ld hl,adaptive_number
        ld b,107
        ld c,1
        call ui_draw_text
        ret

adaptive_header_text:
        push hl
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        pop hl
        ld b,1
        ld c,1
        jp ui_draw_text

adaptive_clear_rail:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ret

adaptive_render_choice_rail:
        call adaptive_clear_rail
        ld hl,adaptive_choice_letters
        ld b,5
        ld c,57
        call ui_draw_text
        ld hl,adaptive_choice_letters + 2
        ld b,31
        ld c,57
        call ui_draw_text
        ld hl,adaptive_choice_letters + 4
        ld b,57
        ld c,57
        call ui_draw_text
        ld hl,adaptive_choice_letters + 6
        ld b,83
        ld c,57
        call ui_draw_text
        ld hl,adaptive_choice_letters + 8
        ld b,109
        ld c,57
        call ui_draw_text
        jp ui_mode_set

adaptive_read_array_count:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        ret c
        cp SC_TAG_ARRAY
        jp nz,adaptive_invalid
        call sc_cursor_read_word
        ret c
        ld a,h
        or a
        jp nz,adaptive_invalid
        ld a,l
        or a
        ret

adaptive_read_int_byte:
        call sc_record_read_byte
        ret c
        cp SC_TAG_INT32
        jp nz,adaptive_invalid
        inc de
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        ld b,3
adaptive_int_high_loop:
        call sc_record_read_byte
        ret c
        or a
        jp nz,adaptive_invalid
        inc de
        djnz adaptive_int_high_loop
        ld a,c
        or a
        ret

adaptive_format_byte:
        ld hl,adaptive_number
        ld (hl),' '
        inc hl
        ld b,0
adaptive_format_tens:
        cp 10
        jr c,adaptive_format_units
        sub 10
        inc b
        jr adaptive_format_tens
adaptive_format_units:
        ld c,a
        ld a,b
        or a
        jr z,adaptive_format_no_tens
        add a,'0'
        ld (adaptive_number),a
adaptive_format_no_tens:
        ld a,c
        add a,'0'
        ld (hl),a
        inc hl
        xor a
        ld (hl),a
        ret

adaptive_error:
        call _clrLCD
        ld hl,adaptive_error_title
        call adaptive_header_text
        ld hl,adaptive_error_text
        ld b,2
        ld c,20
        ld d,122
        ld e,36
        call ui_draw_wrapped_text
adaptive_error_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        jr adaptive_error_wait

; ---------------------------------------------------------------------------

adaptive_device_id:          defs 17,0
adaptive_request_id:         defs 3,0
adaptive_session_code:       defs 7,0
adaptive_learner_key:        defw 0
adaptive_artifact_id:        defs 32,0
adaptive_artifact_key:       defs 10,0
adaptive_artifact_length:    defw 0
adaptive_card_count:         defb 0
adaptive_quiz_count:         defb 0
adaptive_exposure_cap:       defb 0
adaptive_passing_percent:    defb 0
adaptive_module_index:       defb 0
adaptive_module_offset:      defw 0
adaptive_content_array:      defw 0
adaptive_content_count:      defb 0
adaptive_item_index:         defb 0
adaptive_item_offset:        defw 0
adaptive_pages_offset:       defw 0
adaptive_page_count:         defb 0
adaptive_choices_offset:     defw 0
adaptive_choice_count:       defb 0
adaptive_scan_index:         defb 0
adaptive_best_card:          defb 0
adaptive_best_due:           defb 0
adaptive_min_due:            defb 0
adaptive_render_y:           defb 0
adaptive_score_correct:      defb 0
adaptive_known_count:        defb 0
adaptive_hard_count:         defb 0
adaptive_again_count:        defb 0
adaptive_unresolved_count:   defb 0
adaptive_choice_label:       defb 'A',':',0
adaptive_number:             defb ' ','0',0

adaptive_scl1_prefix:        defb "SCL1",1,115,0
adaptive_scsp_magic:         defb "SCSP"
adaptive_scp1_magic:         defb "SCP1"
adaptive_artifact_prefix:    defb "sc:ti86:"
adaptive_package_schema:     defb "school.calc.ti86-package/v2",0
adaptive_key_schema:         defb "schema",0
adaptive_key_artifact_id:    defb "artifactId",0
adaptive_key_lesson:         defb "lesson",0
adaptive_key_modules:        defb "modules",0
adaptive_key_type:           defb "type",0
adaptive_key_bank:           defb "bank",0
adaptive_key_items:          defb "items",0
adaptive_key_prompt_pages:   defb "promptPages",0
adaptive_key_answer_pages:   defb "answerPages",0
adaptive_key_choices:        defb "choices",0
adaptive_key_correct_choice: defb "correctChoice",0
adaptive_type_flashcards:    defb "flashcards",0
adaptive_type_quiz:          defb "quiz",0

adaptive_title:              defb "ADAPTIVE STUDY",0
adaptive_summary_title:      defb "STUDY SUMMARY",0
adaptive_result_title:       defb "RESULT",0
adaptive_error_title:        defb "STUDY UNAVAILABLE",0
adaptive_error_text:         defb "Prescription, state, or artifact is invalid. Return to Enter Code and sync again.",0
adaptive_label_flip:         defb "FLIP",0
adaptive_label_again:        defb "AGAIN",0
adaptive_label_hard:         defb "HARD",0
adaptive_label_know:         defb "KNOW",0
adaptive_label_quiz:         defb "QUIZ",0
adaptive_label_answers:      defb "ANSWERS",0
adaptive_label_qr:           defb "QR",0
adaptive_label_done:         defb "DONE",0
adaptive_summary_known_text:      defb "KNOWN",0
adaptive_summary_hard_text:       defb "HARD",0
adaptive_summary_again_text:      defb "AGAIN",0
adaptive_summary_unresolved_text: defb "UNRESOLVED",0
adaptive_result_score:       defb "SCORE",0
adaptive_result_of:          defb "OF",0
adaptive_result_queued:      defb "Result saved offline.",0
adaptive_choice_letters:     defb "A",0,"B",0,"C",0,"D",0,"E",0

adaptive_dsstudy_name:       defb 0x0C,7,"DSSTUDY",0
adaptive_artifact_name:      defb 0x0C,8,0,0,0,0,0,0,0,0
adaptive_scqueue_name:       defb 0x12,7,"SCQUEUE",0
adaptive_scqr_name:          defb 0x12,4,"SCQR",0,0,0,0

runtime_error:               defb 0
UI_RENDER_PROFILE_FULL:      equ 1
UI_RENDER_INCLUDE_COMPACT:   equ 1
UI_RENDER_INCLUDE_READER:    equ 0
UI_RENDER_INCLUDE_DISPLAY:   equ 0
UI_RENDER_INCLUDE_ICONS:     equ 0
UI_RENDER_COPIED_TEXT_LENGTH: equ 0

include "ui-renderer.asm"
include "input.asm"
include "crc16-ccitt.asm"
include "record-reader.asm"
include "runtime-state.asm"
include "generated/ui-standard-runtime-assets.inc"

end
