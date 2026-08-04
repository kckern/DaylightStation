; Bounded SchoolCalc envelope and typed-document reader for TI-86 Strings.
;
; sc_record_open input:
;   HL = ten-byte TI String descriptor used by _Mov10ToOP1/_FindSym
;   DE = four-byte expected envelope magic in page-zero assembly RAM
; output:
;   carry clear = valid record and typed document
;   carry set   = rejected; sc_record_error contains SC_RECORD_ERROR_*
;
; Record offsets are 16-bit and relative to the first byte after the TI
; String's two-byte length word. Reads use a 256-byte page-aligned cache in
; _plotSScreen, so an SCP1 artifact never has to be copied into executable RAM.

SC_RECORD_MAX_BYTES:       equ 12288
SC_RECORD_NODE_BUDGET:     equ 4096

SC_RECORD_ERROR_NONE:      equ 0
SC_RECORD_ERROR_NOT_FOUND: equ 1
SC_RECORD_ERROR_SIZE:      equ 2
SC_RECORD_ERROR_MAGIC:     equ 3
SC_RECORD_ERROR_VERSION:   equ 4
SC_RECORD_ERROR_LENGTH:    equ 5
SC_RECORD_ERROR_CRC:       equ 6
SC_RECORD_ERROR_DOCUMENT:  equ 7

SC_TAG_NULL:               equ 0
SC_TAG_FALSE:              equ 1
SC_TAG_TRUE:               equ 2
SC_TAG_INT32:              equ 3
SC_TAG_FLOAT64:            equ 4
SC_TAG_STRING:             equ 5
SC_TAG_ARRAY:              equ 6
SC_TAG_MAP:                equ 7
SC_TAG_BYTES:              equ 8

sc_record_open:
        call sc_envelope_open
        ret c
        call sc_validate_document
        jp c,sc_record_fail_document
        xor a
        ld (sc_record_error),a
        ret

; Envelope-only entry point for fixed-layout shell-private records such as
; SCL1. It performs the same variable, bounds, magic, version, length, and CRC
; checks but deliberately does not interpret the payload as a typed document.
sc_envelope_open:
        ld (sc_record_descriptor),hl
        ld (sc_record_magic_ptr),de
        xor a
        ld (sc_record_error),a
        ld (sc_cache_valid),a
        ld hl,(sc_record_descriptor)
        rst 0x20
        rst 0x10
        jp c,sc_record_fail_not_found
        call _ex_ahl_bde
        call _get_word_ahl
        ld (sc_record_length),de
        ld (sc_record_base_addr),hl
        ld (sc_record_base_page),a

        push de
        pop hl
        ld bc,9
        or a
        sbc hl,bc
        jp c,sc_record_fail_size
        ld hl,SC_RECORD_MAX_BYTES
        or a
        sbc hl,de
        jp c,sc_record_fail_size
        push de
        pop hl
        dec hl
        dec hl
        ld (sc_record_body_end),hl

        xor a
        ld (sc_record_cursor),a
        ld (sc_record_cursor + 1),a
        ld b,4
sc_record_magic_loop:
        push bc
        call sc_cursor_read_byte
        pop bc
        jp c,sc_record_fail_length
        ld hl,(sc_record_magic_ptr)
        cp (hl)
        jp nz,sc_record_fail_magic
        inc hl
        ld (sc_record_magic_ptr),hl
        djnz sc_record_magic_loop

        call sc_cursor_read_byte
        jp c,sc_record_fail_length
        cp 1
        jp nz,sc_record_fail_version
        call sc_cursor_read_word
        jp c,sc_record_fail_length
        ld bc,9
        add hl,bc
        jp c,sc_record_fail_length
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp nz,sc_record_fail_length

        call sc_validate_crc
        jp c,sc_record_fail_crc
        xor a
        ld (sc_record_error),a
        ret

sc_record_fail_not_found:
        ld a,SC_RECORD_ERROR_NOT_FOUND
        jr sc_record_fail
sc_record_fail_size:
        ld a,SC_RECORD_ERROR_SIZE
        jr sc_record_fail
sc_record_fail_magic:
        ld a,SC_RECORD_ERROR_MAGIC
        jr sc_record_fail
sc_record_fail_version:
        ld a,SC_RECORD_ERROR_VERSION
        jr sc_record_fail
sc_record_fail_length:
        ld a,SC_RECORD_ERROR_LENGTH
        jr sc_record_fail
sc_record_fail_crc:
        ld a,SC_RECORD_ERROR_CRC
        jr sc_record_fail
sc_record_fail_document:
        ld a,SC_RECORD_ERROR_DOCUMENT
sc_record_fail:
        ld (sc_record_error),a
        scf
        ret

; DE = record offset. Returns A = byte and preserves BC/DE/HL; carry means
; out of bounds. Callers use B as a bounded loop counter and HL as their
; destination/expected-byte pointer while walking fixed records, so a cache
; refill or TI-OS memory move may not change either.
sc_record_read_byte:
        push hl
        push bc
        push de
        ld hl,(sc_record_length)
        or a
        sbc hl,de
        jr c,sc_record_read_oob
        jr z,sc_record_read_oob
        ld a,(sc_cache_valid)
        or a
        jr z,sc_record_fill_cache
        ld a,(sc_cache_page)
        cp d
        jr z,sc_record_read_cached

sc_record_fill_cache:
        ld a,d
        ld (sc_cache_page),a
        ld e,0
        ld hl,(sc_record_base_addr)
        add hl,de
        ld a,(sc_record_base_page)
        adc a,0
        call _set_abs_src
        xor a
        ld hl,_plotSScreen
        call _set_abs_dest

        ld a,(sc_cache_page)
        ld d,a
        ld e,0
        ld hl,(sc_record_length)
        or a
        sbc hl,de
        ld a,h
        or a
        jr z,sc_record_cache_short
        ld hl,256
sc_record_cache_short:
        xor a
        call _set_mm_bytes
        call _mm_ldir
        ld a,1
        ld (sc_cache_valid),a

sc_record_read_cached:
        pop de
        push de
        ld d,0
        ld hl,_plotSScreen
        add hl,de
        ld a,(hl)
        pop de
        pop bc
        pop hl
        or a
        ret
sc_record_read_oob:
        pop de
        pop bc
        pop hl
        scf
        ret

; Cursor helpers operate on sc_record_cursor and never pass sc_record_body_end.
sc_cursor_read_byte:
        ld de,(sc_record_cursor)
        call sc_record_read_byte
        ret c
        push af
        ld hl,(sc_record_cursor)
        inc hl
        ld (sc_record_cursor),hl
        pop af
        or a
        ret

; Returns little-endian word in HL.
sc_cursor_read_word:
        call sc_cursor_read_byte
        ret c
        ld (sc_word_low),a
        call sc_cursor_read_byte
        ret c
        ld h,a
        ld a,(sc_word_low)
        ld l,a
        or a
        ret

; HL = bytes to skip. Equality with body_end is valid.
sc_cursor_skip:
        ld de,(sc_record_cursor)
        add hl,de
        jr c,sc_cursor_skip_oob
        push hl
        ld de,(sc_record_body_end)
        or a
        sbc hl,de
        pop hl
        jr c,sc_cursor_skip_store
        jr z,sc_cursor_skip_store
sc_cursor_skip_oob:
        scf
        ret
sc_cursor_skip_store:
        ld (sc_record_cursor),hl
        or a
        ret

sc_validate_crc:
        ld hl,0xFFFF
        ld (sc_record_crc),hl
        ld de,0
sc_crc_byte_loop:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jr z,sc_crc_compare
        jr c,sc_crc_invalid
        call sc_record_read_byte
        jr c,sc_crc_invalid
        ld hl,(sc_record_crc)
        xor h
        ld h,a
        ld b,8
sc_crc_bit_loop:
        bit 7,h
        jr z,sc_crc_shift_only
        sla l
        rl h
        ld a,h
        xor 0x10
        ld h,a
        ld a,l
        xor 0x21
        ld l,a
        jr sc_crc_bit_done
sc_crc_shift_only:
        sla l
        rl h
sc_crc_bit_done:
        djnz sc_crc_bit_loop
        ld (sc_record_crc),hl
        inc de
        jr sc_crc_byte_loop

sc_crc_compare:
        call sc_record_read_byte
        jr c,sc_crc_invalid
        ld (sc_expected_crc_low),a
        inc de
        call sc_record_read_byte
        jr c,sc_crc_invalid
        ld hl,(sc_record_crc)
        cp h
        jr nz,sc_crc_invalid
        ld a,(sc_expected_crc_low)
        cp l
        jr nz,sc_crc_invalid
        or a
        ret
sc_crc_invalid:
        scf
        ret

; Validate the deterministic string table and exactly one typed root node.
sc_validate_document:
        ld hl,7
        ld (sc_record_cursor),hl
        call sc_cursor_read_word
        ret c
        ld (sc_string_count),hl
        ld (sc_strings_remaining),hl
sc_string_table_loop:
        ld hl,(sc_strings_remaining)
        ld a,h
        or l
        jr z,sc_string_table_done
        dec hl
        ld (sc_strings_remaining),hl
        call sc_cursor_read_word
        ret c
        call sc_cursor_skip
        ret c
        call sc_cursor_read_byte
        ret c
        jr sc_string_table_loop
sc_string_table_done:
        ld hl,(sc_record_cursor)
        ld (sc_record_root_offset),hl
        ld hl,SC_RECORD_NODE_BUDGET
        ld (sc_nodes_remaining),hl
        xor a
        ld (sc_validation_depth),a
        call sc_validate_node
        ret c
        ld hl,(sc_record_cursor)
        ld de,(sc_record_body_end)
        or a
        sbc hl,de
        ret z
        scf
        ret

; Recursive structural walk using the global cursor. Maximum source nesting is
; 32 (33 active calls including the root), matching the adapter codec.
sc_validate_node:
        ld a,(sc_validation_depth)
        cp 33
        jp nc,sc_validate_too_deep
        inc a
        ld (sc_validation_depth),a
        ld hl,(sc_nodes_remaining)
        ld a,h
        or l
        jp z,sc_validate_fail
        dec hl
        ld (sc_nodes_remaining),hl
        call sc_cursor_read_byte
        jp c,sc_validate_fail
        cp SC_TAG_NULL
        jp z,sc_validate_ok
        cp SC_TAG_FALSE
        jp z,sc_validate_ok
        cp SC_TAG_TRUE
        jp z,sc_validate_ok
        cp SC_TAG_INT32
        jp z,sc_validate_int32
        cp SC_TAG_FLOAT64
        jp z,sc_validate_float64
        cp SC_TAG_STRING
        jp z,sc_validate_string
        cp SC_TAG_ARRAY
        jp z,sc_validate_array
        cp SC_TAG_MAP
        jp z,sc_validate_map
        cp SC_TAG_BYTES
        jp z,sc_validate_bytes
        jp sc_validate_fail

sc_validate_int32:
        ld hl,4
        jr sc_validate_fixed
sc_validate_float64:
        ld hl,8
sc_validate_fixed:
        call sc_cursor_skip
        jr c,sc_validate_fail
        jr sc_validate_ok

sc_validate_string:
        call sc_cursor_read_word
        jr c,sc_validate_fail
        ld de,(sc_string_count)
        or a
        sbc hl,de
        jr nc,sc_validate_fail
        jr sc_validate_ok

sc_validate_bytes:
        call sc_cursor_read_word
        jr c,sc_validate_fail
        call sc_cursor_skip
        jr c,sc_validate_fail
        jr sc_validate_ok

sc_validate_array:
        call sc_cursor_read_word
        jr c,sc_validate_fail
sc_validate_array_loop:
        ld a,h
        or l
        jr z,sc_validate_ok
        dec hl
        push hl
        call sc_validate_node
        jr c,sc_validate_array_fail
        pop hl
        jr sc_validate_array_loop
sc_validate_array_fail:
        pop hl
        jr sc_validate_fail

sc_validate_map:
        call sc_cursor_read_word
        jr c,sc_validate_fail
sc_validate_map_loop:
        ld a,h
        or l
        jr z,sc_validate_ok
        dec hl
        push hl
        call sc_cursor_read_word
        jr c,sc_validate_map_fail
        ld de,(sc_string_count)
        or a
        sbc hl,de
        jr nc,sc_validate_map_fail
        call sc_validate_node
        jr c,sc_validate_map_fail
        pop hl
        jr sc_validate_map_loop
sc_validate_map_fail:
        pop hl
        jr sc_validate_fail

sc_validate_ok:
        ld a,(sc_validation_depth)
        dec a
        ld (sc_validation_depth),a
        or a
        ret
sc_validate_fail:
        ld a,(sc_validation_depth)
        dec a
        ld (sc_validation_depth),a
sc_validate_too_deep:
        scf
        ret

; ---------------------------------------------------------------------------
; Offset-oriented typed-document navigation

; HL = string-table index. Returns DE = record offset, BC = byte length.
sc_string_locate:
        ld de,(sc_string_count)
        push hl
        or a
        sbc hl,de
        pop hl
        jr nc,sc_string_locate_invalid
        ld (sc_string_target),hl
        ld hl,9
        ld (sc_record_cursor),hl
sc_string_locate_loop:
        call sc_cursor_read_word
        jr c,sc_string_locate_invalid
        ld (sc_string_length),hl
        ld hl,(sc_string_target)
        ld a,h
        or l
        jr z,sc_string_locate_found
        dec hl
        ld (sc_string_target),hl
        ld hl,(sc_string_length)
        call sc_cursor_skip
        jr c,sc_string_locate_invalid
        call sc_cursor_read_byte
        jr c,sc_string_locate_invalid
        jr sc_string_locate_loop
sc_string_locate_found:
        ld de,(sc_record_cursor)
        ld bc,(sc_string_length)
        or a
        ret
sc_string_locate_invalid:
        scf
        ret

; HL = string-table index, DE = zero-terminated ASCII literal.
; Returns A=1 for exact equality, A=0 for inequality, carry for invalid data.
sc_string_equals_literal:
        ld (sc_literal_ptr),de
        call sc_string_locate
        ret c
sc_string_equals_loop:
        ld a,b
        or c
        jr z,sc_string_equals_end
        call sc_record_read_byte
        ret c
        ld hl,(sc_literal_ptr)
        cp (hl)
        jr nz,sc_string_not_equal
        inc hl
        ld (sc_literal_ptr),hl
        inc de
        dec bc
        jr sc_string_equals_loop
sc_string_equals_end:
        ld hl,(sc_literal_ptr)
        ld a,(hl)
        or a
        jr nz,sc_string_not_equal
        ld a,1
        or a
        ret
sc_string_not_equal:
        xor a
        ret

; DE = map node offset, HL = literal key. Returns DE = value node offset.
sc_map_find_literal:
        ld (sc_map_key_ptr),hl
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jr c,sc_map_not_found
        cp SC_TAG_MAP
        jr nz,sc_map_not_found
        call sc_cursor_read_word
        jr c,sc_map_not_found
        ld (sc_map_remaining),hl
sc_map_find_loop:
        ld hl,(sc_map_remaining)
        ld a,h
        or l
        jr z,sc_map_not_found
        dec hl
        ld (sc_map_remaining),hl
        call sc_cursor_read_word
        jr c,sc_map_not_found
        ld de,(sc_map_key_ptr)
        push hl
        ld hl,(sc_record_cursor)
        push hl
        pop bc
        pop hl
        push bc
        call sc_string_equals_literal
        pop bc
        ld (sc_record_cursor),bc
        jr c,sc_map_not_found
        or a
        jr nz,sc_map_found
        call sc_skip_current_node
        jr c,sc_map_not_found
        jr sc_map_find_loop
sc_map_found:
        ld de,(sc_record_cursor)
        or a
        ret
sc_map_not_found:
        scf
        ret

; DE = array node offset, HL = zero-based item index. Returns DE = item offset.
sc_array_item:
        ld (sc_array_target),hl
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jr c,sc_array_not_found
        cp SC_TAG_ARRAY
        jr nz,sc_array_not_found
        call sc_cursor_read_word
        jr c,sc_array_not_found
        ld de,(sc_array_target)
        push hl
        or a
        sbc hl,de
        pop hl
        jr c,sc_array_not_found
        jr z,sc_array_not_found
sc_array_item_loop:
        ld hl,(sc_array_target)
        ld a,h
        or l
        jr z,sc_array_item_found
        dec hl
        ld (sc_array_target),hl
        call sc_skip_current_node
        jr c,sc_array_not_found
        jr sc_array_item_loop
sc_array_item_found:
        ld de,(sc_record_cursor)
        or a
        ret
sc_array_not_found:
        scf
        ret

; DE = string node offset, HL = literal. Returns A as string equality does.
sc_node_string_equals_literal:
        ld (sc_literal_ptr_saved),hl
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jr c,sc_node_string_invalid
        cp SC_TAG_STRING
        jr nz,sc_node_string_invalid
        call sc_cursor_read_word
        jr c,sc_node_string_invalid
        ld de,(sc_literal_ptr_saved)
        jp sc_string_equals_literal
sc_node_string_invalid:
        scf
        ret

; DE = string node offset. Copies 0..120 ASCII bytes into a stable buffer
; outside the 256-byte paging cache and returns HL = zero-terminated buffer.
; Longer input is rejected rather than silently truncated. Non-ASCII UTF-8
; bytes currently render as '?' pending the target text codec; production
; artifact projection rejects them before they reach the calculator.
sc_copy_node_string:
        ld (sc_record_cursor),de
        call sc_cursor_read_byte
        jr c,sc_copy_string_invalid
        cp SC_TAG_STRING
        jr nz,sc_copy_string_invalid
        call sc_cursor_read_word
        jr c,sc_copy_string_invalid
        call sc_string_locate
        jr c,sc_copy_string_invalid
        ld a,b
        or a
        jr nz,sc_copy_string_invalid
        ld a,c
        inc a
        cp 122
        jr nc,sc_copy_string_invalid
sc_copy_string_length:
        ld (sc_text_remaining),a
        ld (sc_text_source),de
        ld hl,_plotSScreen + 256
if UI_RENDER_COPIED_TEXT_LENGTH
        ; Catalog rows reuse one scratch buffer. Clear its bounded span before
        ; each visible label so a shorter title can never inherit glyphs from
        ; the preceding artifact identifier or title.
        ld b,121
        xor a
sc_copy_string_clear:
        ld (hl),a
        inc hl
        djnz sc_copy_string_clear
        ld hl,_plotSScreen + 256
endif
sc_copy_string_loop:
        ld a,(sc_text_remaining)
        or a
        jr z,sc_copy_string_done
        ld de,(sc_text_source)
        ; Keep the destination independently on the stack. TI-OS's absolute
        ; memory helpers are permitted to use HL while the record byte is
        ; being paged, but copied text must advance exactly one byte per
        ; source byte.
        push hl
        call sc_record_read_byte
        pop hl
        jr c,sc_copy_string_invalid
        or a
        jr z,sc_copy_string_done
        cp 128
        jr c,sc_copy_string_ascii
        ld a,63
sc_copy_string_ascii:
        ld (hl),a
        inc hl
        inc de
        ld (sc_text_source),de
        ld a,(sc_text_remaining)
        dec a
        ld (sc_text_remaining),a
        jr sc_copy_string_loop
sc_copy_string_done:
        ld (sc_text_destination),hl
        ld (hl),0
        ld hl,_plotSScreen + 256
        or a
        ret
sc_copy_string_invalid:
        scf
        ret

; Structurally skip exactly one node at the current global cursor.
sc_skip_current_node:
        ld hl,SC_RECORD_NODE_BUDGET
        ld (sc_nodes_remaining),hl
        xor a
        ld (sc_validation_depth),a
        jp sc_validate_node

sc_record_error:         defb 0
sc_record_descriptor:    defw 0
sc_record_magic_ptr:     defw 0
sc_record_base_page:     defb 0
sc_record_base_addr:     defw 0
sc_record_length:        defw 0
sc_record_body_end:      defw 0
sc_record_cursor:        defw 0
sc_record_root_offset:   defw 0
sc_string_count:         defw 0
sc_strings_remaining:    defw 0
sc_nodes_remaining:      defw 0
sc_validation_depth:     defb 0
sc_cache_valid:          defb 0
sc_cache_page:           defb 0
sc_record_crc:           defw 0
sc_expected_crc_low:     defb 0
sc_word_low:             defb 0
sc_string_target:        defw 0
sc_string_length:        defw 0
sc_literal_ptr:          defw 0
sc_literal_ptr_saved:    defw 0
sc_map_key_ptr:          defw 0
sc_map_remaining:        defw 0
sc_array_target:         defw 0
sc_text_source:          defw 0
sc_text_destination:     defw 0
sc_text_remaining:       defb 0
