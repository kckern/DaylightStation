; Durable SCL1 continuation and selected SCP1 hydration for SCLEARN.
;
; This module deliberately derives the TI variable locator from the immutable
; artifact key stored in SCL1. No program or String name is accepted from
; lesson content. Every SCL1/SCP1 record is reopened and CRC-validated through
; record-reader.asm before its offsets are used.

RUNTIME_SCL_RECORD_BYTES:         equ 124
RUNTIME_SCL_GENERATION_OFFSET:    equ 7
RUNTIME_SCL_VIEW_OFFSET:          equ 13
RUNTIME_SCL_ARTIFACT_KEY_OFFSET:  equ 14
RUNTIME_SCL_MODULE_INDEX_OFFSET:  equ 34
RUNTIME_SCL_ITEM_INDEX_OFFSET:    equ 36
RUNTIME_SCL_SELECTED_LEARNER_OFFSET: equ 118
RUNTIME_SCL_SESSION_LEARNER_OFFSET:  equ 120
RUNTIME_SCL_CRC_OFFSET:           equ 122

RUNTIME_ERROR_NONE:        equ 0
RUNTIME_ERROR_STATE:       equ 1
RUNTIME_ERROR_ARTIFACT:    equ 2
RUNTIME_ERROR_MODULE:      equ 3
RUNTIME_ERROR_SAVE:        equ 4

RUNTIME_MODE_READER:       equ 1
RUNTIME_MODE_EXAMPLES:     equ 2
RUNTIME_MODE_PROBLEMS:     equ 3
RUNTIME_MODE_FLASHCARDS:   equ 4
RUNTIME_MODE_QUIZ:         equ 5
RUNTIME_MODE_TOOL:         equ 6
RUNTIME_MODE_PROBE:        equ 7
RUNTIME_VIEW_LESSON:       equ 4
RUNTIME_VIEW_MODULE:       equ 5

; scan-action@1 stores one complete Version-1/EC-L QR symbol as three
; row-major bytes for each of 21 rows. The low three bits of every third byte
; are padding and must remain zero.
RUNTIME_ACTION_QR_ROWS:      equ 21
RUNTIME_ACTION_QR_ROW_BYTES: equ 3
RUNTIME_ACTION_QR_BYTES:     equ 63

; Load the newest unambiguous SCL1 slot and reopen its exact module.
runtime_open_selected_module:
        call runtime_load_local_state
        jr c,runtime_context_state_error
        call runtime_build_artifact_descriptor
        jr c,runtime_context_state_error
        call runtime_open_artifact_and_module
        ret nc
        ld a,RUNTIME_ERROR_ARTIFACT
        ld (runtime_error),a
        scf
        ret
runtime_context_state_error:
        ld a,RUNTIME_ERROR_STATE
        ld (runtime_error),a
        scf
        ret

; Select the highest unsigned generation. One bad slot is repairable; equal
; valid generations are impossible under alternating writes and fail closed.
runtime_load_local_state:
        xor a
        ld (runtime_state_found),a
        ld (runtime_state_conflict),a
        ld a,0xFF
        ld (runtime_state_active_slot),a

        xor a
        ld hl,runtime_local0_name
        call runtime_consider_state
        ld a,1
        ld hl,runtime_local1_name
        call runtime_consider_state

        ld a,(runtime_state_found)
        or a
        jr z,runtime_load_state_fail
        ld a,(runtime_state_conflict)
        or a
        jr nz,runtime_load_state_fail

        ld hl,(runtime_state_descriptor)
        ld de,runtime_scl1_magic
        call sc_envelope_open
        jr c,runtime_load_state_fail
        call runtime_require_scl_length
        jr c,runtime_load_state_fail

        ld hl,runtime_state_record
        ld (runtime_state_copy_pointer),hl
        xor a
        ld d,a
        ld e,a
        ld a,RUNTIME_SCL_RECORD_BYTES
        ld (runtime_state_copy_remaining),a
runtime_copy_state_loop:
        call sc_record_read_byte
        jr c,runtime_load_state_fail
        ld hl,(runtime_state_copy_pointer)
        ld (hl),a
        inc hl
        ld (runtime_state_copy_pointer),hl
        inc de
        ld a,(runtime_state_copy_remaining)
        dec a
        ld (runtime_state_copy_remaining),a
        jr nz,runtime_copy_state_loop
        or a
        ret
runtime_load_state_fail:
        scf
        ret

; A = slot number, HL = ten-byte String descriptor.
runtime_consider_state:
        ld (runtime_candidate_slot),a
        ld (runtime_candidate_descriptor),hl
        ld de,runtime_scl1_magic
        call sc_envelope_open
        ret c
        call runtime_require_scl_length
        ret c

        ld de,RUNTIME_SCL_GENERATION_OFFSET
        call sc_record_read_byte
        ret c
        ld (runtime_candidate_generation),a
        inc de
        call sc_record_read_byte
        ret c
        ld (runtime_candidate_generation + 1),a
        inc de
        call sc_record_read_byte
        ret c
        ld (runtime_candidate_generation + 2),a
        inc de
        call sc_record_read_byte
        ret c
        ld (runtime_candidate_generation + 3),a

        ld a,(runtime_state_found)
        or a
        jr z,runtime_select_candidate
        ; Compare candidate/current from the most significant byte.
        ld hl,runtime_candidate_generation + 3
        ld de,runtime_state_generation + 3
        ld b,4
runtime_compare_generation:
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jr c,runtime_candidate_older
        jr nz,runtime_select_candidate
        dec hl
        dec de
        djnz runtime_compare_generation
        ld a,1
        ld (runtime_state_conflict),a
runtime_candidate_older:
        or a
        ret

runtime_select_candidate:
        ld hl,(runtime_candidate_descriptor)
        ld (runtime_state_descriptor),hl
        ld a,(runtime_candidate_slot)
        ld (runtime_state_active_slot),a
        ld hl,runtime_candidate_generation
        ld de,runtime_state_generation
        ld bc,4
        ldir
        ld a,1
        ld (runtime_state_found),a
        or a
        ret

runtime_require_scl_length:
        ld hl,(sc_record_length)
        ld de,RUNTIME_SCL_RECORD_BYTES
        or a
        sbc hl,de
        ret z
        scf
        ret

; Validate the ten-character base32 artifact key, construct both the dynamic
; package identity and the deterministic DP + first-six-key variable name,
; and load the durable module/item indices.
runtime_build_artifact_descriptor:
        ld hl,runtime_state_record + RUNTIME_SCL_ARTIFACT_KEY_OFFSET
        ld de,runtime_artifact_id + 8
        ld b,10
runtime_copy_artifact_key:
        ld a,(hl)
        ld c,a
        cp '2'
        jr c,runtime_artifact_key_alpha
        cp '7' + 1
        jr c,runtime_artifact_key_valid
runtime_artifact_key_alpha:
        cp 'A'
        jr c,runtime_artifact_key_invalid
        cp 'Z' + 1
        jr nc,runtime_artifact_key_invalid
runtime_artifact_key_valid:
        ld a,c
        ld (de),a
        inc hl
        inc de
        djnz runtime_copy_artifact_key

        ld hl,runtime_artifact_id + 8
        ld de,runtime_artifact_name + 4
        ld bc,6
        ldir

        ld hl,(runtime_state_record + RUNTIME_SCL_MODULE_INDEX_OFFSET)
        ld a,h
        and l
        cp 0xFF
        jr z,runtime_artifact_key_invalid
        ld (runtime_module_index),hl
        ld hl,(runtime_state_record + RUNTIME_SCL_ITEM_INDEX_OFFSET)
        ld a,h
        and l
        cp 0xFF
        jr nz,runtime_item_index_ready
        ld hl,0
runtime_item_index_ready:
        ld (runtime_item_index),hl
        or a
        ret
runtime_artifact_key_invalid:
        scf
        ret

; Open and authenticate the selected package identity, locate the exact module,
; and admit only the standard reader/example shapes implemented in this build.
runtime_open_artifact_and_module:
        ld hl,runtime_artifact_name
        ld de,runtime_scp1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,runtime_key_schema
        call sc_map_find_literal
        ret c
        ld hl,runtime_package_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,runtime_open_artifact_fail
        ld de,(sc_record_root_offset)
        ld hl,runtime_key_artifact_id
        call sc_map_find_literal
        ret c
        ld hl,runtime_artifact_id
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,runtime_open_artifact_fail

        ld de,(sc_record_root_offset)
        ld hl,runtime_key_lesson
        call sc_map_find_literal
        ret c
        ld (runtime_lesson_offset),de
        ld hl,runtime_key_modules
        call sc_map_find_literal
        ret c
        ld (runtime_modules_offset),de
        ld hl,(runtime_module_index)
        call sc_array_item
        jr c,runtime_module_fail
        ld (runtime_module_offset),de

        ld hl,runtime_key_type
        call sc_map_find_literal
        jr c,runtime_module_fail
        ld (runtime_module_type_offset),de
        ld hl,runtime_type_lecture_notes
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_lecture_notes
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_examples
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_examples
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_problems
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_problems
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_flashcards
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_flashcards
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_quiz
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_quiz
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_tool
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_tool
        ld de,(runtime_module_type_offset)
        ld hl,runtime_type_learning_probe
        call sc_node_string_equals_literal
        jr c,runtime_module_fail
        or a
        jr nz,runtime_open_probe
runtime_module_fail:
        ld a,RUNTIME_ERROR_MODULE
        ld (runtime_error),a
runtime_open_artifact_fail:
        scf
        ret

runtime_open_lecture_notes:
        ld a,RUNTIME_MODE_READER
        ld (runtime_mode),a
        jr runtime_open_pages
runtime_open_examples:
        ld a,RUNTIME_MODE_EXAMPLES
        ld (runtime_mode),a
runtime_open_pages:
        ld de,(runtime_module_offset)
        ld hl,runtime_key_pages
        call sc_map_find_literal
        jr c,runtime_module_fail
        jr runtime_capture_content_array

runtime_open_problems:
        ld a,RUNTIME_MODE_PROBLEMS
        jr runtime_open_bank_mode
runtime_open_flashcards:
        ld a,RUNTIME_MODE_FLASHCARDS
        jr runtime_open_bank_mode
runtime_open_quiz:
        ld a,RUNTIME_MODE_QUIZ
runtime_open_bank_mode:
        ld (runtime_mode),a
        ld de,(runtime_module_offset)
        ld hl,runtime_key_bank
        call sc_map_find_literal
        jr c,runtime_module_fail
        ld hl,runtime_key_items
        call sc_map_find_literal
        jr c,runtime_module_fail
        jr runtime_capture_content_array

runtime_open_probe:
        ld a,RUNTIME_MODE_PROBE
        jr runtime_open_bank_mode

runtime_open_tool:
        ld a,RUNTIME_MODE_TOOL
        ld (runtime_mode),a
        ld de,(runtime_module_offset)
        ld hl,runtime_key_native_plan
        call sc_map_find_literal
        jr c,runtime_module_fail
        ld (runtime_native_plan_offset),de
        xor a
        ld (runtime_error),a
        ret

runtime_capture_content_array:
        ld (runtime_content_array_offset),de
        call sc_record_read_byte
        jr c,runtime_module_fail
        cp SC_TAG_ARRAY
        jr nz,runtime_module_fail
        inc de
        call sc_record_read_byte
        jr c,runtime_module_fail
        ld (runtime_content_count),a
        inc de
        call sc_record_read_byte
        jr c,runtime_module_fail
        ld (runtime_content_count + 1),a
        ld hl,(runtime_content_count)
        ld a,h
        or l
        jp z,runtime_module_fail
        ld de,(runtime_content_array_offset)
        ld hl,(runtime_item_index)
        call sc_array_item
        jp c,runtime_module_fail
        ld (runtime_content_offset),de
if RUNTIME_CONTENT_MUTABLE
        call runtime_capture_action_page
        jp c,runtime_module_fail
endif
        xor a
        ld (runtime_error),a
        ret

if RUNTIME_CONTENT_MUTABLE
; Detect and validate the optional action-page extension on one reader page.
; Ordinary pages have no `kind` and return with runtime_action_page clear.
; A page that declares a kind must be the complete closed scan_action shape;
; malformed or future kinds fail the entire module instead of degrading into
; misleading text with a missing QR affordance.
runtime_capture_action_page:
        xor a
        ld (runtime_action_page),a
        ld de,(runtime_content_offset)
        ld hl,runtime_key_kind
        call sc_map_find_literal
        jr c,runtime_action_page_none
        ld hl,runtime_kind_scan_action
        call sc_node_string_equals_literal
        jr c,runtime_action_page_fail
        or a
        jr z,runtime_action_page_fail

        ; The token is not decoded on the calculator, but its exact opaque
        ; profile is checked so a malformed payload can never be presented as
        ; a School action.
        ld de,(runtime_content_offset)
        ld hl,runtime_key_action_token
        call sc_map_find_literal
        jr c,runtime_action_page_fail
        call sc_copy_node_string
        jr c,runtime_action_page_fail
        call runtime_validate_action_token
        jr c,runtime_action_page_fail

        ld de,(runtime_content_offset)
        ld hl,runtime_key_qr_modules
        call sc_map_find_literal
        jr c,runtime_action_page_fail
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jr c,runtime_action_page_fail
        cp SC_TAG_BYTES
        jr nz,runtime_action_page_fail
        call sc_cursor_read_word
        jr c,runtime_action_page_fail
        ld de,RUNTIME_ACTION_QR_BYTES
        or a
        sbc hl,de
        jr nz,runtime_action_page_fail
        ld hl,(sc_record_cursor)
        ld (runtime_action_qr_offset),hl

        ; Twenty-one rows consume exactly three bytes each. Only bits 7..3
        ; of the final byte belong to the 21-module row.
        ex de,hl
        ld b,RUNTIME_ACTION_QR_ROWS
runtime_action_padding_loop:
        inc de
        inc de
        call sc_record_read_byte
        jr c,runtime_action_page_fail
        and 0x07
        jr nz,runtime_action_page_fail
        inc de
        djnz runtime_action_padding_loop
        ld a,1
        ld (runtime_action_page),a
runtime_action_page_none:
        or a
        ret
runtime_action_page_fail:
        scf
        ret

; HL = zero-terminated token copied into record-reader stable text storage.
runtime_validate_action_token:
        ld de,runtime_action_prefix
        ld b,4
runtime_action_prefix_loop:
        ld a,(de)
        cp (hl)
        jr nz,runtime_action_token_fail
        inc de
        inc hl
        djnz runtime_action_prefix_loop
        ld b,16
runtime_action_body_loop:
        ld a,(hl)
        call runtime_validate_action_character
        jr c,runtime_action_token_fail
        inc hl
        djnz runtime_action_body_loop
        ld a,(hl)
        or a
        ret z
runtime_action_token_fail:
        scf
        ret

; A = one character from the unambiguous School token alphabet.
runtime_validate_action_character:
        cp '2'
        jr c,runtime_action_character_alpha
        cp '9' + 1
        jr c,runtime_action_character_valid
runtime_action_character_alpha:
        cp 'A'
        jr c,runtime_action_character_invalid
        cp 'H' + 1
        jr c,runtime_action_character_valid
        cp 'J'
        jr c,runtime_action_character_invalid
        cp 'N' + 1
        jr c,runtime_action_character_valid
        cp 'P'
        jr c,runtime_action_character_invalid
        cp 'Z' + 1
        jr c,runtime_action_character_valid
runtime_action_character_invalid:
        scf
        ret
runtime_action_character_valid:
        or a
        ret
endif

; Copy one display string into record-reader's stable text buffer.
runtime_copy_lesson_title:
        ld de,(runtime_lesson_offset)
        ld hl,runtime_key_title
        call sc_map_find_literal
        ret c
        jp sc_copy_node_string

runtime_copy_module_label:
        ld de,(runtime_module_offset)
        ld hl,runtime_key_title
        call sc_map_find_literal
        jr nc,runtime_copy_module_label_found
        ld de,(runtime_module_offset)
        ld hl,runtime_key_type
        call sc_map_find_literal
        ret c
runtime_copy_module_label_found:
        jp sc_copy_node_string

runtime_copy_current_text:
        ld de,(runtime_content_offset)
        ld hl,runtime_key_text
        call sc_map_find_literal
        ret c
        jp sc_copy_node_string

; SCNATIVE links the authenticated read path above but physically excludes
; every write/move routine below. This keeps its first release parser-only at
; the executable boundary, independently of call-graph assumptions.
if RUNTIME_CONTENT_MUTABLE

; Persist a changed item index to the inactive SCL1 slot before showing it.
runtime_state_save:
        ld hl,(runtime_item_index)
        ld (runtime_state_record + RUNTIME_SCL_ITEM_INDEX_OFFSET),hl
        ld hl,(runtime_state_record + RUNTIME_SCL_GENERATION_OFFSET)
        ld de,(runtime_state_record + RUNTIME_SCL_GENERATION_OFFSET + 2)
        inc hl
        ld a,h
        or l
        jr nz,runtime_generation_ready
        inc de
        ld a,d
        or e
        jr z,runtime_state_save_fail
runtime_generation_ready:
        ld (runtime_state_record + RUNTIME_SCL_GENERATION_OFFSET),hl
        ld (runtime_state_record + RUNTIME_SCL_GENERATION_OFFSET + 2),de
        ld hl,runtime_state_record
        ld bc,RUNTIME_SCL_CRC_OFFSET
        call crc16_ccitt_false
        ld a,e
        ld (runtime_state_record + RUNTIME_SCL_CRC_OFFSET),a
        ld a,d
        ld (runtime_state_record + RUNTIME_SCL_CRC_OFFSET + 1),a

        ld a,(runtime_state_active_slot)
        xor 1
        ld (runtime_state_target_slot),a
        or a
        ld hl,runtime_local0_name
        jr z,runtime_state_target_ready
        ld hl,runtime_local1_name
runtime_state_target_ready:
        ld (runtime_state_target_descriptor),hl
        rst 0x20
        rst 0x10
        call nc,_delvar

        call _memchk
        or a
        jr nz,runtime_state_memory_ready
        ld de,RUNTIME_SCL_RECORD_BYTES + 32
        or a
        sbc hl,de
        jr c,runtime_state_save_fail
runtime_state_memory_ready:
        ld hl,(runtime_state_target_descriptor)
        rst 0x20
        ld hl,RUNTIME_SCL_RECORD_BYTES
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,runtime_state_record
        call _set_abs_src
        xor a
        ld hl,RUNTIME_SCL_RECORD_BYTES
        call _set_mm_bytes
        call _mm_ldir

        ld hl,(runtime_state_target_descriptor)
        ld de,runtime_scl1_magic
        call sc_envelope_open
        jr c,runtime_state_save_fail
        call runtime_require_scl_length
        jr c,runtime_state_save_fail
        ld a,(runtime_state_target_slot)
        ld (runtime_state_active_slot),a
        or a
        ret
runtime_state_save_fail:
        ld a,RUNTIME_ERROR_SAVE
        ld (runtime_error),a
        scf
        ret

runtime_move_next:
        ld hl,(runtime_item_index)
        inc hl
        jr z,runtime_move_unavailable
        jr runtime_move_to_candidate
runtime_move_previous:
        ld hl,(runtime_item_index)
        ld a,h
        or l
        jr z,runtime_move_unavailable
        dec hl
runtime_move_to_candidate:
        push hl
        ld de,(runtime_content_array_offset)
        call sc_array_item
        pop hl
        jr c,runtime_move_unavailable
        ld (runtime_item_index),hl
        call runtime_state_save
        ret c
        call runtime_open_artifact_and_module
        ret
runtime_move_unavailable:
        scf
        ret

endif

runtime_error:                 defb RUNTIME_ERROR_NONE
runtime_mode:                  defb 0
runtime_state_found:           defb 0
runtime_state_conflict:        defb 0
runtime_state_active_slot:     defb 0xFF
if RUNTIME_CONTENT_MUTABLE
runtime_state_target_slot:     defb 0
endif
runtime_candidate_slot:        defb 0
runtime_candidate_descriptor: defw 0
runtime_state_descriptor:     defw 0
if RUNTIME_CONTENT_MUTABLE
runtime_state_target_descriptor: defw 0
endif
runtime_state_generation:     defs 4,0
runtime_candidate_generation: defs 4,0
runtime_state_copy_pointer:    defw 0
runtime_state_copy_remaining:  defb 0
runtime_state_record:          defs RUNTIME_SCL_RECORD_BYTES,0
runtime_module_index:          defw 0
runtime_item_index:            defw 0
runtime_lesson_offset:         defw 0
runtime_modules_offset:        defw 0
runtime_module_offset:         defw 0
runtime_module_type_offset:    defw 0
runtime_content_array_offset:  defw 0
runtime_content_count:         defw 0
runtime_content_offset:        defw 0
runtime_native_plan_offset:    defw 0
if RUNTIME_CONTENT_MUTABLE
runtime_action_page:           defb 0
runtime_action_qr_offset:      defw 0
endif

runtime_scl1_magic: defb "SCL1"
runtime_scp1_magic: defb "SCP1"
runtime_key_schema: defb "schema",0
runtime_key_artifact_id: defb "artifactId",0
runtime_key_lesson: defb "lesson",0
runtime_key_modules: defb "modules",0
runtime_key_title: defb "title",0
runtime_key_type: defb "type",0
runtime_key_pages: defb "pages",0
runtime_key_bank: defb "bank",0
runtime_key_items: defb "items",0
runtime_key_text: defb "text",0
runtime_key_native_plan: defb "nativePlan",0
if RUNTIME_CONTENT_MUTABLE
runtime_key_kind: defb "kind",0
runtime_key_action_token: defb "actionToken",0
runtime_key_qr_modules: defb "qrModules",0
endif
runtime_type_lecture_notes: defb "lecture_notes",0
runtime_type_examples: defb "examples",0
runtime_type_problems: defb "problems",0
runtime_type_flashcards: defb "flashcards",0
runtime_type_quiz: defb "quiz",0
runtime_type_tool: defb "tool",0
runtime_type_learning_probe: defb "learning_probe",0
if RUNTIME_CONTENT_MUTABLE
runtime_kind_scan_action: defb "scan_action",0
runtime_action_prefix: defb "sch:"
endif
runtime_package_schema: defb "school.calc.ti86-package/v2",0
runtime_artifact_id: defb "sc:ti86:",0,0,0,0,0,0,0,0,0,0,0

; TI String descriptors: type, name length, then eight name bytes.
runtime_local0_name: defb 0x0C,8,"DSLOCAL0"
runtime_local1_name: defb 0x0C,8,"DSLOCAL1"
runtime_artifact_name: defb 0x0C,8,"DP",0,0,0,0,0,0
