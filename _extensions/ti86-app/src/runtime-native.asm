; SchoolCalc TI-86 native-plan guard runtime.
;
; This first SCNATIVE release deliberately performs no TI-OS settings write
; and no native launch. It independently reopens SCL1/SCP1, validates the
; complete closed plan down to operation payload tokens/reals, then presents a
; fail-closed status screen. Actual snapshot/apply/restore and OS entry points
; remain disabled until owned-ROM tests establish their ABI.

include "ti86asm.inc"

NATIVE_MODE_TOOL:                 equ 6
NATIVE_PLAN_MAP_FIELDS:           equ 6
NATIVE_MAX_PAYLOAD_BYTES:         equ 1152
NATIVE_MAX_EXPRESSION_BYTES:      equ 192
NATIVE_MAX_EXPRESSION_DEPTH:      equ 16
NATIVE_MAX_EQUATIONS:             equ 4
; Excess-$FC00 exponent bounds matching the adapter's exact Number round-trip
; subset: -308 ($FACC) through +307 ($FD33).
NATIVE_REAL_EXP_MIN_HIGH:         equ 0xFA
NATIVE_REAL_EXP_MIN_LOW:          equ 0xCC
NATIVE_REAL_EXP_MAX_HIGH:         equ 0xFD
NATIVE_REAL_EXP_MAX_LOW:          equ 0x33

NATIVE_OP_CALCULATOR:             equ 1
NATIVE_OP_GRAPH:                  equ 2
NATIVE_OP_TABLE:                  equ 3
NATIVE_OP_SOLVER:                 equ 4
NATIVE_OP_MATRIX:                 equ 5
NATIVE_OP_EQUATION_EDITOR:        equ 6
; Operation 7 (native BASIC program) is intentionally absent: the Z80 runtime
; allowlist is empty until a reviewed first-party helper is actually shipped.

NATIVE_TOKEN_LEFT_PAREN:          equ 0x10
NATIVE_TOKEN_RIGHT_PAREN:         equ 0x11
NATIVE_TOKEN_VARIABLE:            equ 0x32
NATIVE_TOKEN_EQUALS:              equ 0x3F
NATIVE_TOKEN_PI:                  equ 0x42
NATIVE_TOKEN_NUMBER:              equ 0x44
NATIVE_TOKEN_PLUS:                equ 0x60
NATIVE_TOKEN_MINUS:               equ 0x61
NATIVE_TOKEN_MULTIPLY:            equ 0x70
NATIVE_TOKEN_DIVIDE:              equ 0x71
NATIVE_TOKEN_NEGATE:              equ 0xA0
NATIVE_TOKEN_ABS:                 equ 0xA2
NATIVE_TOKEN_LN:                  equ 0xA6
NATIVE_TOKEN_EXP:                 equ 0xA7
NATIVE_TOKEN_LOG:                 equ 0xA8
NATIVE_TOKEN_POW10:               equ 0xA9
NATIVE_TOKEN_SIN:                 equ 0xAA
NATIVE_TOKEN_COS:                 equ 0xAC
NATIVE_TOKEN_TAN:                 equ 0xAE
NATIVE_TOKEN_POWER:               equ 0xF0

org _asm_exec_ram

        nop
        jp native_runtime_start
        defw 0
        defw native_runtime_name
        defb "SCX1"
        defb 1                 ; runtime ABI
        defb 7                 ; closed registry code: native-handoff
        defb 0                 ; flags
        defw 0                 ; complete length, patched by builder
        defw 0                 ; payload CRC, patched by builder
        defw 0                 ; reserved

native_runtime_name: defb 0

native_runtime_start:
        ; SCHLCALC validates the immutable SCX1 Program variable before this
        ; guard executes in TI-OS's shared mutable window.
        call _runindicoff
        call sc_input_init
        call runtime_open_selected_module
        jp c,native_runtime_invalid
        ld a,(runtime_mode)
        cp NATIVE_MODE_TOOL
        jp nz,native_runtime_invalid
        call native_validate_plan
        jp c,native_runtime_invalid
        xor a
        ld (native_status),a
        jp native_runtime_render
native_runtime_invalid:
        ld a,1
        ld (native_status),a

native_runtime_render:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,native_title
        ld b,1
        ld c,1
        ld d,125
        call ui_draw_text_clipped
        call ui_mode_set
        ld a,(native_status)
        or a
        jp nz,native_render_rejected
        ld hl,native_valid_line_1
        ld b,2
        ld c,13
        call ui_draw_text
        ld hl,native_valid_line_2
        ld b,2
        ld c,23
        call ui_draw_text
        ld hl,native_valid_line_3
        ld b,2
        ld c,33
        call ui_draw_text
        ld hl,native_valid_line_4
        ld b,2
        ld c,43
        call ui_draw_text
        jp native_render_footer
native_render_rejected:
        ld hl,native_invalid_line_1
        ld b,2
        ld c,15
        call ui_draw_text
        ld hl,native_invalid_line_2
        ld b,2
        ld c,27
        call ui_draw_text
        ld hl,native_invalid_line_3
        ld b,2
        ld c,39
        call ui_draw_text
native_render_footer:
        ld hl,native_footer
        ld b,2
        ld c,57
        call ui_draw_text

native_runtime_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        ret z
        jp native_runtime_wait

; ---------------------------------------------------------------------------
; Closed typed-plan envelope

native_validate_plan:
        ld de,(runtime_native_plan_offset)
        call native_require_plan_map
        ret c

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_schema
        call sc_map_find_literal
        ret c
        ld hl,native_plan_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,native_fail

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_version
        call sc_map_find_literal
        ret c
        call native_read_u8_node
        ret c
        cp 1
        jp nz,native_fail

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_operation
        call sc_map_find_literal
        ret c
        call native_read_u8_node
        ret c
        cp NATIVE_OP_CALCULATOR
        jp c,native_fail
        cp NATIVE_OP_EQUATION_EDITOR + 1
        jp nc,native_fail
        ld (native_operation),a

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_launch
        call sc_map_find_literal
        ret c
        call native_read_u8_node
        ret c
        ld b,a
        ld a,(native_operation)
        cp b
        jp nz,native_fail

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_snapshot
        call sc_map_find_literal
        ret c
        call native_validate_snapshot
        ret c

        ld de,(runtime_native_plan_offset)
        ld hl,native_key_payload
        call sc_map_find_literal
        ret c
        call native_open_payload
        ret c
        call native_validate_payload
        ret c
        jp native_payload_require_end

; DE = plan node. Require an exact six-entry map. Because all six distinct
; required fields are subsequently found, duplicates cannot displace a field.
native_require_plan_map:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jp c,native_fail
        cp SC_TAG_MAP
        jp nz,native_fail
        call sc_cursor_read_word
        jp c,native_fail
        ld de,NATIVE_PLAN_MAP_FIELDS
        or a
        sbc hl,de
        ret z
native_fail:
        scf
        ret

; DE = INT32 node. Accept only canonical positive one-byte values.
native_read_u8_node:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jp c,native_fail
        cp SC_TAG_INT32
        jp nz,native_fail
        call sc_cursor_read_byte
        jp c,native_fail
        ld (native_u8_value),a
        ld b,3
native_read_u8_high:
        ; The record reader may use BC while refilling its cache. Preserve the
        ; canonical-INT32 byte counter across every paged read.
        push bc
        call sc_cursor_read_byte
        pop bc
        jp c,native_fail
        or a
        jp nz,native_fail
        djnz native_read_u8_high
        ld a,(native_u8_value)
        or a
        ret

; DE = snapshot array node.
native_validate_snapshot:
        ld (native_snapshot_offset),de
        call native_array_length
        ret c
        ld a,(native_operation)
        cp NATIVE_OP_TABLE
        jp z,native_snapshot_table
        ld de,1
        or a
        sbc hl,de
        jp nz,native_fail
        xor a
        call native_snapshot_item
        ret c
        ld b,a
        ld a,(native_operation)
        cp NATIVE_OP_CALCULATOR
        jp z,native_snapshot_expect_one
        cp NATIVE_OP_GRAPH
        jp z,native_snapshot_expect_two
        cp NATIVE_OP_SOLVER
        jp z,native_snapshot_expect_four
        cp NATIVE_OP_MATRIX
        jp z,native_snapshot_expect_five
        ; equation editor
native_snapshot_expect_two:
        ld a,2
        jp native_snapshot_compare
native_snapshot_expect_one:
        ld a,1
        jp native_snapshot_compare
native_snapshot_expect_four:
        ld a,4
        jp native_snapshot_compare
native_snapshot_expect_five:
        ld a,5
native_snapshot_compare:
        cp b
        ret z
        jp native_fail
native_snapshot_table:
        ld de,2
        or a
        sbc hl,de
        jp nz,native_fail
        xor a
        call native_snapshot_item
        ret c
        cp 2
        jp nz,native_fail
        ld a,1
        call native_snapshot_item
        ret c
        cp 3
        ret z
        jp native_fail

; A = zero-based index, returns A = u8 item.
native_snapshot_item:
        ld l,a
        ld h,0
        ld de,(native_snapshot_offset)
        call sc_array_item
        ret c
        jp native_read_u8_node

; DE = array node, returns HL count.
native_array_length:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        ret c
        cp SC_TAG_ARRAY
        jp nz,native_fail
        jp sc_cursor_read_word

; DE = bytes node. Establish a bounded payload cursor/end pair.
native_open_payload:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jp c,native_fail
        cp SC_TAG_BYTES
        jp nz,native_fail
        call sc_cursor_read_word
        jp c,native_fail
        push hl
        ld de,NATIVE_MAX_PAYLOAD_BYTES
        ex de,hl
        or a
        sbc hl,de
        pop hl
        jp c,native_fail
        ld de,(sc_record_cursor)
        ld (native_payload_cursor),de
        add hl,de
        jp c,native_fail
        ld (native_payload_end),hl
        ; Structural SCP1 validation already proved this byte node is in-bounds.
        or a
        ret

; ---------------------------------------------------------------------------
; Operation payloads

native_validate_payload:
        ld a,(native_operation)
        cp NATIVE_OP_CALCULATOR
        jp z,native_payload_calculator
        cp NATIVE_OP_GRAPH
        jp z,native_payload_graph
        cp NATIVE_OP_TABLE
        jp z,native_payload_table
        cp NATIVE_OP_SOLVER
        jp z,native_payload_solver
        cp NATIVE_OP_MATRIX
        jp z,native_payload_matrix
        cp NATIVE_OP_EQUATION_EDITOR
        jp z,native_payload_equation_editor
        jp native_fail

native_payload_calculator:
        call native_payload_read
        ret c
        cp 1
        jp nz,native_fail
        xor a
        ld (native_expression_equation),a
        ld (native_variable_mode),a
        jp native_validate_optional_expression

native_payload_graph:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EQUATIONS + 1
        jp nc,native_fail
        ld (native_loop_remaining),a
        xor a
        ld (native_slot_mask),a
native_graph_equation_loop:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EQUATIONS + 1
        jp nc,native_fail
        dec a
        ld e,a
        ld d,0
        ld hl,native_slot_bits
        add hl,de
        ld a,(hl)
        ld b,a
        ld a,(native_slot_mask)
        and b
        jp nz,native_fail
        ld a,(native_slot_mask)
        or b
        ld (native_slot_mask),a
        xor a
        ld (native_expression_equation),a
        ld (native_variable_mode),a
        call native_validate_required_expression
        ret c
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_graph_equation_loop
        call native_payload_read
        ret c
        or a
        ret z
        cp 0x0F
        jp nz,native_fail
        ld hl,native_real_a
        call native_read_real
        ret c
        ld hl,native_real_b
        call native_read_real
        ret c
        ld hl,native_real_c
        call native_read_real
        ret c
        ld hl,native_real_d
        call native_read_real
        ret c
        ld hl,native_real_a
        ld de,native_real_b
        call native_compare_reals
        cp 0xFF
        jp nz,native_fail
        ld hl,native_real_c
        ld de,native_real_d
        call native_compare_reals
        cp 0xFF
        ret z
        jp native_fail

native_payload_table:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EQUATIONS + 1
        jp nc,native_fail
        ld (native_loop_remaining),a
native_table_expression_loop:
        xor a
        ld (native_expression_equation),a
        ld (native_variable_mode),a
        call native_validate_required_expression
        ret c
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_table_expression_loop
        ld hl,native_real_a
        call native_read_real
        ret c
        ld hl,native_real_b
        call native_read_real
        ret c
        ld hl,native_real_b
        call native_real_is_zero
        jp z,native_fail
        or a
        ret

native_payload_solver:
        call native_payload_read
        ret c
        cp 1
        jp nz,native_fail
        ; Stage the expression boundaries; the allowed variable is encoded
        ; later in this payload, so grammar validation follows that field.
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EXPRESSION_BYTES + 1
        jp nc,native_fail
        call native_stage_expression
        ret c
        ld hl,(native_expression_end)
        ld (native_payload_cursor),hl

        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp 9
        jp nc,native_fail
        ld (native_solver_variable_length),a
        ld (native_loop_remaining),a
        ld hl,native_solver_variable
        ld (native_copy_pointer),hl
native_solver_variable_loop:
        call native_payload_read
        ret c
        ld b,a
        ld hl,(native_copy_pointer)
        ld (hl),a
        inc hl
        ld (native_copy_pointer),hl
        ld a,(native_solver_variable_length)
        cp 1
        jp nz,native_solver_named_character
        ld a,b
        cp 'x'
        jp nz,native_fail
        jp native_solver_variable_character_ok
native_solver_named_character:
        ld a,(native_loop_remaining)
        ld c,a
        ld a,(native_solver_variable_length)
        cp c
        ld a,b
        jp nz,native_solver_named_tail
        cp 'A'
        jp c,native_fail
        cp 'Z' + 1
        jp nc,native_fail
        jp native_solver_variable_character_ok
native_solver_named_tail:
        cp '0'
        jp c,native_solver_tail_alpha
        cp '9' + 1
        jp c,native_solver_variable_character_ok
native_solver_tail_alpha:
        cp 'A'
        jp c,native_fail
        cp 'Z' + 1
        jp nc,native_fail
native_solver_variable_character_ok:
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_solver_variable_loop

        call native_payload_read
        ret c
        cp 2
        jp nc,native_fail
        or a
        jp z,native_solver_initial_done
        ld hl,native_real_a
        call native_read_real
        ret c
native_solver_initial_done:
        ld hl,(native_payload_cursor)
        ld (native_payload_after_solver),hl
        ld hl,(native_expression_start)
        ld (native_payload_cursor),hl
        ld a,1
        ld (native_expression_equation),a
        ld (native_variable_mode),a
        call native_parse_staged_expression
        ret c
        ld hl,(native_payload_after_solver)
        ld (native_payload_cursor),hl
        or a
        ret

native_payload_matrix:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp 4
        jp nc,native_fail
        ld (native_matrix_remaining),a
        ld a,1
        ld (native_matrix_slot),a
native_matrix_loop:
        call native_payload_read
        ret c
        ld b,a
        ld a,(native_matrix_slot)
        cp b
        jp nz,native_fail
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp 7
        jp nc,native_fail
        ld (native_matrix_rows),a
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp 7
        jp nc,native_fail
        ld b,a
        ld a,(native_matrix_rows)
        ld c,a
        xor a
native_matrix_multiply:
        add a,b
        dec c
        jp nz,native_matrix_multiply
        ld (native_loop_remaining),a
native_matrix_cell_loop:
        ld hl,native_real_a
        call native_read_real
        ret c
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_matrix_cell_loop
        ld a,(native_matrix_slot)
        inc a
        ld (native_matrix_slot),a
        ld a,(native_matrix_remaining)
        dec a
        ld (native_matrix_remaining),a
        jp nz,native_matrix_loop
        or a
        ret

native_payload_equation_editor:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EQUATIONS + 1
        jp nc,native_fail
        ld (native_loop_remaining),a
native_editor_expression_loop:
        xor a
        ld (native_expression_equation),a
        ld (native_variable_mode),a
        call native_validate_required_expression
        ret c
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_editor_expression_loop
        or a
        ret

; ---------------------------------------------------------------------------
; Bounded payload and expression grammar

native_payload_read:
        ld de,(native_payload_cursor)
        ld hl,(native_payload_end)
        or a
        sbc hl,de
        jp z,native_payload_oob
        jp c,native_payload_oob
        call sc_record_read_byte
        ret c
        push af
        inc de
        ld (native_payload_cursor),de
        pop af
        or a
        ret
native_payload_oob:
        scf
        ret

native_payload_require_end:
        ld hl,(native_payload_cursor)
        ld de,(native_payload_end)
        or a
        sbc hl,de
        ret z
        scf
        ret

native_validate_required_expression:
        call native_payload_read
        ret c
        or a
        jp z,native_fail
        cp NATIVE_MAX_EXPRESSION_BYTES + 1
        jp nc,native_fail
        jp native_validate_expression_length
native_validate_optional_expression:
        call native_payload_read
        ret c
        or a
        ret z
        cp NATIVE_MAX_EXPRESSION_BYTES + 1
        jp nc,native_fail
native_validate_expression_length:
        call native_stage_expression
        ret c
        jp native_parse_staged_expression

; A = expression byte length. Leaves payload cursor at expression start and
; records a checked expression end.
native_stage_expression:
        ld l,a
        ld h,0
        ld de,(native_payload_cursor)
        ld (native_expression_start),de
        add hl,de
        jp c,native_fail
        ld (native_expression_end),hl
        ld de,(native_payload_end)
        ex de,hl
        or a
        sbc hl,de
        jp c,native_fail
        or a
        ret

native_parse_staged_expression:
        xor a
        ld (native_expression_depth),a
        call native_parse_additive
        ret c
        call native_expression_peek
        jp c,native_expression_require_end
        cp NATIVE_TOKEN_EQUALS
        jp nz,native_fail
        ld a,(native_expression_equation)
        or a
        jp z,native_fail
        call native_expression_take
        ret c
        call native_parse_additive
        ret c
        call native_expression_peek
        jp nc,native_fail
native_expression_require_end:
        ld hl,(native_payload_cursor)
        ld de,(native_expression_end)
        or a
        sbc hl,de
        ret z
        scf
        ret

native_parse_additive:
        call native_parse_multiplicative
        ret c
native_parse_additive_loop:
        call native_expression_peek
        jp c,native_parse_success
        cp NATIVE_TOKEN_PLUS
        jp z,native_parse_additive_operator
        cp NATIVE_TOKEN_MINUS
        jp nz,native_parse_success
native_parse_additive_operator:
        call native_expression_take
        ret c
        call native_parse_multiplicative
        ret c
        jp native_parse_additive_loop

native_parse_multiplicative:
        call native_parse_power
        ret c
native_parse_multiplicative_loop:
        call native_expression_peek
        jp c,native_parse_success
        cp NATIVE_TOKEN_MULTIPLY
        jp z,native_parse_multiplicative_operator
        cp NATIVE_TOKEN_DIVIDE
        jp nz,native_parse_success
native_parse_multiplicative_operator:
        call native_expression_take
        ret c
        call native_parse_power
        ret c
        jp native_parse_multiplicative_loop

native_parse_power:
        call native_parse_unary
        ret c
        call native_expression_peek
        jp c,native_parse_success
        cp NATIVE_TOKEN_POWER
        jp nz,native_parse_success
        call native_expression_take
        ret c
        call native_depth_enter
        ret c
        call native_parse_power
        jp c,native_parse_power_fail
        call native_depth_leave
        or a
        ret
native_parse_power_fail:
        call native_depth_leave
        scf
        ret

native_parse_unary:
        call native_expression_peek
        ret c
        cp NATIVE_TOKEN_NEGATE
        jp nz,native_parse_primary
        call native_expression_take
        ret c
        call native_depth_enter
        ret c
        call native_parse_unary
        jp c,native_parse_unary_fail
        call native_depth_leave
        or a
        ret
native_parse_unary_fail:
        call native_depth_leave
        scf
        ret

native_parse_primary:
        call native_expression_take
        ret c
        cp NATIVE_TOKEN_NUMBER
        jp z,native_parse_number
        cp NATIVE_TOKEN_PI
        jp z,native_parse_success
        cp NATIVE_TOKEN_VARIABLE
        jp z,native_parse_x_variable
        cp NATIVE_TOKEN_VARIABLE + 1
        jp c,native_parse_primary_not_named
        cp NATIVE_TOKEN_VARIABLE + 9
        jp c,native_parse_named_variable
native_parse_primary_not_named:
        cp NATIVE_TOKEN_LEFT_PAREN
        jp z,native_parse_parenthesized
        call native_is_function_token
        jp c,native_fail
        or a
        jp z,native_fail
        jp native_parse_function

native_parse_success:
        or a
        ret

; Numeric literal: 1..24 ASCII bytes, at least one digit, at most one dot,
; terminated by zero within this expression.
native_parse_number:
        xor a
        ld (native_number_length),a
        ld (native_number_digit),a
        ld (native_number_dot),a
native_parse_number_loop:
        call native_expression_take
        ret c
        or a
        jp z,native_parse_number_done
        ld b,a
        ld a,(native_number_length)
        inc a
        cp 25
        jp nc,native_fail
        ld (native_number_length),a
        ld a,b
        cp '.'
        jp z,native_parse_number_dot
        cp '0'
        jp c,native_fail
        cp '9' + 1
        jp nc,native_fail
        ld a,1
        ld (native_number_digit),a
        jp native_parse_number_loop
native_parse_number_dot:
        ld a,(native_number_dot)
        or a
        jp nz,native_fail
        inc a
        ld (native_number_dot),a
        jp native_parse_number_loop
native_parse_number_done:
        ld a,(native_number_length)
        or a
        jp z,native_fail
        ld a,(native_number_digit)
        or a
        jp z,native_fail
        ret

native_parse_x_variable:
        call native_expression_take
        ret c
        cp 1
        jp nz,native_fail
        call native_expression_take
        ret c
        cp 'x'
        jp nz,native_fail
        ld a,(native_variable_mode)
        or a
        ret z
        ld a,(native_solver_variable_length)
        cp 1
        jp nz,native_fail
        ld a,(native_solver_variable)
        cp 'x'
        ret z
        jp native_fail

; Entry A is 0x33..0x3A, encoding a 1..8-byte uppercase variable.
native_parse_named_variable:
        sub NATIVE_TOKEN_VARIABLE
        ld (native_named_length),a
        ld b,a
        ld a,(native_variable_mode)
        or a
        jp z,native_fail
        ld a,(native_solver_variable_length)
        cp b
        jp nz,native_fail
        ld hl,native_solver_variable
        ld (native_copy_pointer),hl
        ld a,b
        ld (native_loop_remaining),a
native_parse_named_loop:
        call native_expression_take
        ret c
        ld b,a
        ld hl,(native_copy_pointer)
        ld a,(hl)
        cp b
        jp nz,native_fail
        inc hl
        ld (native_copy_pointer),hl
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_parse_named_loop
        or a
        ret

native_parse_parenthesized:
        call native_depth_enter
        ret c
        call native_parse_additive
        jp c,native_parse_nested_fail
        call native_expression_take
        jp c,native_parse_nested_fail
        cp NATIVE_TOKEN_RIGHT_PAREN
        jp nz,native_parse_nested_fail
        call native_depth_leave
        or a
        ret

native_parse_function:
        call native_expression_take
        ret c
        cp NATIVE_TOKEN_LEFT_PAREN
        jp nz,native_fail
        call native_depth_enter
        ret c
        call native_parse_additive
        jp c,native_parse_nested_fail
        call native_expression_take
        jp c,native_parse_nested_fail
        cp NATIVE_TOKEN_RIGHT_PAREN
        jp nz,native_parse_nested_fail
        call native_depth_leave
        or a
        ret
native_parse_nested_fail:
        call native_depth_leave
        scf
        ret

; A = candidate token. Return A=1 for reviewed function, A=0 otherwise.
native_is_function_token:
        cp NATIVE_TOKEN_ABS
        jp z,native_function_yes
        cp NATIVE_TOKEN_LN
        jp z,native_function_yes
        cp NATIVE_TOKEN_EXP
        jp z,native_function_yes
        cp NATIVE_TOKEN_LOG
        jp z,native_function_yes
        cp NATIVE_TOKEN_POW10
        jp z,native_function_yes
        cp NATIVE_TOKEN_SIN
        jp z,native_function_yes
        cp NATIVE_TOKEN_COS
        jp z,native_function_yes
        cp NATIVE_TOKEN_TAN
        jp z,native_function_yes
        xor a
        ret
native_function_yes:
        ld a,1
        or a
        ret

native_expression_peek:
        ld de,(native_payload_cursor)
        ld hl,(native_expression_end)
        or a
        sbc hl,de
        jp z,native_expression_oob
        jp c,native_expression_oob
        jp sc_record_read_byte
native_expression_take:
        call native_expression_peek
        ret c
        push af
        ld hl,(native_payload_cursor)
        inc hl
        ld (native_payload_cursor),hl
        pop af
        or a
        ret
native_expression_oob:
        scf
        ret

native_depth_enter:
        ld a,(native_expression_depth)
        cp NATIVE_MAX_EXPRESSION_DEPTH
        jp nc,native_fail
        inc a
        ld (native_expression_depth),a
        or a
        ret
native_depth_leave:
        ld a,(native_expression_depth)
        or a
        ret z
        dec a
        ld (native_expression_depth),a
        ret

; ---------------------------------------------------------------------------
; Canonical TI-86 ten-byte real validation and comparison

; HL = destination buffer (10 bytes).
native_read_real:
        ld (native_real_destination),hl
        ld a,10
        ld (native_loop_remaining),a
native_read_real_loop:
        call native_payload_read
        ret c
        ld hl,(native_real_destination)
        ld (hl),a
        inc hl
        ld (native_real_destination),hl
        ld a,(native_loop_remaining)
        dec a
        ld (native_loop_remaining),a
        jp nz,native_read_real_loop
        ld hl,(native_real_destination)
        ld de,10
        or a
        sbc hl,de
        jp native_validate_real

; HL = ten-byte buffer.
native_validate_real:
        ld (native_real_pointer),hl
        ld a,(hl)
        or a
        jp z,native_real_sign_ok
        cp 0x80
        jp nz,native_fail
native_real_sign_ok:
        inc hl
        ld a,(hl)
        ld (native_real_exponent_low),a
        inc hl
        ld a,(hl)
        cp NATIVE_REAL_EXP_MIN_HIGH
        jp c,native_fail
        jp nz,native_real_exponent_check_high
        ld a,(native_real_exponent_low)
        cp NATIVE_REAL_EXP_MIN_LOW
        jp c,native_fail
native_real_exponent_check_high:
        ld a,(hl)
        cp NATIVE_REAL_EXP_MAX_HIGH
        jp c,native_real_exponent_ok
        jp nz,native_fail
        ld a,(native_real_exponent_low)
        cp NATIVE_REAL_EXP_MAX_LOW + 1
        jp nc,native_fail
native_real_exponent_ok:
        inc hl
        xor a
        ld (native_real_nonzero),a
        ld (native_real_first_high),a
        ld b,7
native_real_bcd_loop:
        ld a,(hl)
        ld c,a
        and 0x0F
        cp 10
        jp nc,native_fail
        ld a,c
        and 0xF0
        rrca
        rrca
        rrca
        rrca
        cp 10
        jp nc,native_fail
        ld c,a
        ld a,b
        cp 7
        jp nz,native_real_not_first
        ld a,c
        ld (native_real_first_high),a
native_real_not_first:
        ld a,(hl)
        or a
        jp z,native_real_bcd_next
        ld a,1
        ld (native_real_nonzero),a
native_real_bcd_next:
        inc hl
        djnz native_real_bcd_loop
        ld a,(native_real_nonzero)
        or a
        jp z,native_real_validate_zero
        ld a,(native_real_first_high)
        or a
        jp z,native_fail
        ret
native_real_validate_zero:
        ld hl,(native_real_pointer)
        ld a,(hl)
        or a
        jp nz,native_fail
        inc hl
        ld a,(hl)
        or a
        jp nz,native_fail
        inc hl
        ld a,(hl)
        cp 0xFC
        ret z
        jp native_fail

; HL = real. Z means canonical zero.
native_real_is_zero:
        ld de,3
        add hl,de
        xor a
        ld b,7
native_real_zero_loop:
        or (hl)
        inc hl
        djnz native_real_zero_loop
        ret

; HL=left, DE=right. A=0xFF left<right, 0 equal, 1 left>right.
native_compare_reals:
        ld (native_real_left),hl
        ld (native_real_right),de
        ld a,(hl)
        and 0x80
        ld b,a
        ld a,(de)
        and 0x80
        ld c,a
        ld a,b
        cp c
        jp z,native_compare_same_sign
        or a
        jp nz,native_compare_less
        ld a,1
        ret
native_compare_same_sign:
        push bc
        call native_compare_magnitude
        pop bc
        ld d,a
        ld a,b
        or a
        ld a,d
        ret z
        cpl
        inc a
        ret

native_compare_magnitude:
        ld hl,(native_real_left)
        ld de,2
        add hl,de
        ld de,(native_real_right)
        inc de
        inc de
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jp c,native_compare_less
        jp nz,native_compare_greater
        dec hl
        dec de
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jp c,native_compare_less
        jp nz,native_compare_greater
        ld hl,(native_real_left)
        ld de,3
        add hl,de
        ld de,(native_real_right)
        inc de
        inc de
        inc de
        ld b,7
native_compare_digits:
        ld a,(de)
        ld c,a
        ld a,(hl)
        cp c
        jp c,native_compare_less
        jp nz,native_compare_greater
        inc hl
        inc de
        djnz native_compare_digits
        xor a
        ret
native_compare_less:
        ld a,0xFF
        ret
native_compare_greater:
        ld a,1
        ret

; ---------------------------------------------------------------------------
; Runtime self-integrity

native_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jp nz,native_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jp nz,native_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,native_scx_magic
        ld b,4
native_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jp nz,native_scx_fail
        inc de
        inc hl
        djnz native_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jp nz,native_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 7
        jp nz,native_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jp nz,native_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jp nz,native_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jp c,native_scx_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jp c,native_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jp nz,native_scx_fail
        or a
        ret
native_scx_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Fixed data and scratch

native_status:                  defb 0
native_operation:               defb 0
native_u8_value:                defb 0
native_loop_remaining:          defb 0
native_slot_mask:               defb 0
native_snapshot_offset:         defw 0
native_payload_cursor:          defw 0
native_payload_end:             defw 0
native_payload_after_solver:    defw 0
native_expression_start:        defw 0
native_expression_end:          defw 0
native_expression_depth:        defb 0
native_expression_equation:     defb 0
native_variable_mode:           defb 0
native_number_length:           defb 0
native_number_digit:            defb 0
native_number_dot:              defb 0
native_named_length:            defb 0
native_solver_variable_length:  defb 0
native_solver_variable:         defs 8,0
native_matrix_remaining:        defb 0
native_matrix_slot:             defb 0
native_matrix_rows:             defb 0
native_copy_pointer:            defw 0
native_real_destination:        defw 0
native_real_pointer:            defw 0
native_real_left:               defw 0
native_real_right:              defw 0
native_real_exponent_low:       defb 0
native_real_nonzero:            defb 0
native_real_first_high:         defb 0
native_real_a:                  defs 10,0
native_real_b:                  defs 10,0
native_real_c:                  defs 10,0
native_real_d:                  defs 10,0

native_slot_bits:       defb 1,2,4,8
native_scx_magic:       defb "SCX1"
native_key_schema:      defb "schema",0
native_key_version:     defb "version",0
native_key_operation:   defb "operation",0
native_key_launch:      defb "launch",0
native_key_snapshot:    defb "snapshot",0
native_key_payload:     defb "payload",0
native_plan_schema:     defb "school.calc.ti86-native-plan/v1",0

native_title:           defb "SCHOOLCALC / NATIVE",0
native_valid_line_1:    defb "Plan validated.",0
native_valid_line_2:    defb "Settings unchanged.",0
native_valid_line_3:    defb "OS launch is locked.",0
native_valid_line_4:    defb "ROM proof required.",0
native_invalid_line_1:  defb "Plan rejected.",0
native_invalid_line_2:  defb "Nothing was changed.",0
native_invalid_line_3:  defb "Sync compatible content.",0
native_footer:          defb "ENTER / EXIT returns",0

UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
RUNTIME_CONTENT_MUTABLE: equ 0
include "ui-renderer.asm"
include "input.asm"
include "crc16-ccitt.asm"
include "record-reader.asm"
include "runtime-content.asm"
include "generated/ui-native-runtime-assets.inc"

end
