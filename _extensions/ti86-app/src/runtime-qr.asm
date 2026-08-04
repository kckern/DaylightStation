; SchoolCalc reviewed outbound-QR runtime.
;
; SCQR reads the newest exact SCR1 record from the checksum-valid DSQ queue,
; BASE32-encodes it behind the canonical lowercase `sch:r1:` prefix, builds a
; fixed Version-5/EC-M/mask-0 QR symbol, and takes over the complete LCD. It
; never mutates or acknowledges the queue; F1 may only write its private SCO1
; optical-output receipt sidecar.

include "ti86asm.inc"

org _asm_exec_ram

        nop
        jp scqr_executor_entry
        defw 0
        defw scqr_runtime_name
        defb "SCX1"
        defb 1                 ; runtime ABI
        defb 2                 ; closed registry code: result-qr
        defb 0                 ; flags (none in ABI v1)
        defw 0                 ; complete code length, patched by builder
        defw 0                 ; payload CRC-16, patched by builder
        defw 0                 ; reserved

scqr_runtime_name: defb 0
scqr_executor_entry:
        jp scqr_start

SCQR_SIZE: equ 37
SCQR_ORIGIN_X: equ 45
SCQR_ORIGIN_Y: equ 13
SCQR_DATA_CODEWORDS: equ 86
SCQR_BLOCK_DATA_CODEWORDS: equ 43
SCQR_ECC_CODEWORDS: equ 24
SCQR_TOTAL_CODEWORDS: equ 134
SCQR_RESULT_MAX_BYTES: equ 69
SCQR_QUEUE_MAX_BYTES: equ 6144
SCQR_QUEUE_MAX_RECORDS: equ 170
SCQR_OUTPUT_RECEIPT_BYTES: equ 34
SCQR_OUTPUT_BITSET_BYTES: equ 22
SCQR_DATA_CAPACITY_BITS: equ SCQR_DATA_CODEWORDS * 8

scqr_start:
        ; Immutable SCX1 validation happens in SCHLCALC before TI-OS loads
        ; this mutable execution image.
        call _runindicoff
        call sc_input_init
        call scqr_load_latest_result
        jp c,scqr_render_error
        call scqr_build_payload
        jp c,scqr_render_error
        call scqr_encode_data
        jp c,scqr_render_error
        call scqr_build_ecc
        call _clrLCD
        call scqr_draw_function_modules
        call scqr_draw_data_modules
        call ui_mode_set
        call ui_select_compact
        ld hl,scqr_scan_instruction
        ld b,42
        ld c,3
        call ui_draw_text
        call scqr_draw_output_rail
scqr_wait:
        call sc_input_wait
        cp SC_SCAN_F1
        jp z,scqr_mark_output_done
        cp SC_SCAN_F5
        ret z
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        ret z
        jr scqr_wait

; ---------------------------------------------------------------------------
; Read the complete outer SCQ1 and copy only its newest nested SCR1.

scqr_load_latest_result:
        ld hl,scqr_dsq_name
        ld de,scqr_scq1_magic
        call sc_envelope_open
        jp c,scqr_fail
        ld hl,SCQR_QUEUE_MAX_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        jp c,scqr_fail

        ld de,7
        call sc_record_read_byte
        jp c,scqr_fail
        cp 4
        jp c,scqr_fail
        cp 17
        jp nc,scqr_fail
        ld (scqr_queue_device_length),a
        inc de
        ld hl,scqr_queue_device
        ld b,a
scqr_copy_queue_device:
        call sc_record_read_byte
        jp c,scqr_fail
        call scqr_validate_device_character
        jp c,scqr_fail
        ld (hl),a
        inc hl
        inc de
        djnz scqr_copy_queue_device

        call sc_record_read_byte
        jp c,scqr_fail
        ld (scqr_records_remaining),a
        ld (scqr_queue_count),a
        dec a
        ld (scqr_latest_index),a
        inc de
        call sc_record_read_byte
        jp c,scqr_fail
        or a
        jp nz,scqr_fail
        ld a,(scqr_records_remaining)
        or a
        jp z,scqr_fail
        cp SCQR_QUEUE_MAX_RECORDS + 1
        jp nc,scqr_fail
        inc de

scqr_find_last_record:
        call sc_record_read_byte
        jp c,scqr_fail
        ld l,a
        inc de
        call sc_record_read_byte
        jp c,scqr_fail
        ld h,a
        inc de
        ld (scqr_latest_length),hl
        push hl
        ld bc,9
        or a
        sbc hl,bc
        pop hl
        jp c,scqr_fail
        ld (scqr_latest_offset),de
        ld a,(scqr_records_remaining)
        ld b,a
        ld a,(scqr_queue_count)
        cp b
        jr nz,scqr_not_first_record
        ld (scqr_first_offset),de
scqr_not_first_record:
        push de
        add hl,de
        jp c,scqr_find_last_overflow
        ex de,hl
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp c,scqr_find_last_overflow
        pop hl
        ld de,(scqr_latest_length)
        add hl,de
        ex de,hl
        ld a,(scqr_records_remaining)
        dec a
        ld (scqr_records_remaining),a
        jr nz,scqr_find_last_record

        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,scqr_fail
        ld hl,(scqr_latest_length)
        ld a,h
        or a
        jp nz,scqr_fail
        ld a,l
        cp 9
        jp c,scqr_fail
        cp SCQR_RESULT_MAX_BYTES + 1
        jp nc,scqr_fail
        ld (scqr_result_length),a
        ld de,(scqr_latest_offset)
        ld hl,scqr_result
        ld b,a
scqr_copy_latest_result:
        call sc_record_read_byte
        jp c,scqr_fail
        ld (hl),a
        inc hl
        inc de
        djnz scqr_copy_latest_result
        call scqr_validate_result
        jp c,scqr_fail
        jp scqr_capture_first_sequence

scqr_find_last_overflow:
        pop de
        jp scqr_fail

; Validate the copied compact v1 record independently of the outer queue CRC.
scqr_validate_result:
        ld hl,scqr_result
        ld de,scqr_scr1_magic
        ld b,4
scqr_validate_result_magic:
        ld a,(de)
        cp (hl)
        jp nz,scqr_fail
        inc de
        inc hl
        djnz scqr_validate_result_magic
        ld a,(hl)
        cp 1
        jp nz,scqr_fail
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)
        ex de,hl
        ld de,9
        add hl,de
        ld a,(scqr_result_length)
        ld e,a
        ld d,0
        or a
        sbc hl,de
        jp nz,scqr_fail

        ld a,(scqr_result_length)
        sub 2
        ld c,a
        ld b,0
        ld hl,scqr_result
        call crc16_ccitt_false
        ld a,(scqr_result_length)
        sub 2
        ld l,a
        ld h,0
        ld bc,scqr_result
        add hl,bc
        ld a,(hl)
        cp e
        jp nz,scqr_fail
        inc hl
        ld a,(hl)
        cp d
        jp nz,scqr_fail

        ld hl,scqr_result + 7
        ld a,(hl)
        ; SCR1 packs the result kind into bit 7 and the reviewed module index
        ; into bits 0..6. Keep only that kind bit here; the index is allowed
        ; to be any byte and must not make a valid queued result undisplayable.
        and 0x80
        ld (scqr_result_kind),a
        inc hl
        ld a,(hl)
        ld b,a
        ld a,(scqr_queue_device_length)
        cp b
        jp nz,scqr_fail
        inc hl
        ld de,scqr_queue_device
scqr_compare_result_device:
        ld a,(de)
        cp (hl)
        jp nz,scqr_fail
        inc de
        inc hl
        djnz scqr_compare_result_device

        ; Sequence 0xFFFFFF is the exhausted sentinel and is never a result.
        ; Keep the exact three bytes: DSQOUT indexes self-reported QR output
        ; by the immutable queue sequence without changing the SCR1 payload.
        ld de,scqr_current_sequence
        ld b,3
scqr_copy_current_sequence:
        ld a,(hl)
        ld (de),a
        inc de
        inc hl
        djnz scqr_copy_current_sequence
        ld a,(scqr_current_sequence)
        ld b,a
        ld a,(scqr_current_sequence + 1)
        and b
        ld b,a
        ld a,(scqr_current_sequence + 2)
        and b
        cp 0xFF
        jp z,scqr_fail
        ; The three-byte sequence is followed by the required non-Guest
        ; learner u16, then the fixed ten-byte artifact key.
        ld a,(hl)
        inc hl
        or (hl)
        jp z,scqr_fail
        inc hl
        ld b,10
scqr_validate_result_key:
        ld a,(hl)
        cp 'A'
        jr c,scqr_result_key_digit
        cp 'Z' + 1
        jr nc,scqr_result_key_digit
        jr scqr_result_key_ok
scqr_result_key_digit:
        cp '2'
        jp c,scqr_fail
        cp '7' + 1
        jp nc,scqr_fail
scqr_result_key_ok:
        inc hl
        djnz scqr_validate_result_key
        ld a,(scqr_result_kind)
        bit 7,a
        jr nz,scqr_validate_progress

        ld a,(hl)
        cp 1                       ; Z80 v0 emits packed ordered choices
        jp nz,scqr_fail
        inc hl
        ld a,(hl)
        or a
        jp z,scqr_fail
        cp 49
        jp nc,scqr_fail
        ld (scqr_choice_count),a
        inc hl
        ld b,a
        inc b
        srl b                      ; ceil(choiceCount / 2)
scqr_validate_choice_bytes:
        ld a,(hl)
        and 0xF0
        jp z,scqr_fail
        cp 0x60
        jp nc,scqr_fail
        ld a,(hl)
        and 0x0F
        jr nz,scqr_validate_choice_low_nonzero
        ld a,b
        cp 1
        jp nz,scqr_fail
        ld a,(scqr_choice_count)
        and 1
        jp z,scqr_fail
        jr scqr_validate_choice_low_zero
scqr_validate_choice_low_nonzero:
        cp 6
        jp nc,scqr_fail
scqr_validate_choice_low_zero:
        inc hl
        djnz scqr_validate_choice_bytes
        ld a,(scqr_choice_count)
        and 1
        jr z,scqr_validate_response_score
        dec hl
        ld a,(hl)
        and 0x0F
        jp nz,scqr_fail
        inc hl
        jr scqr_validate_response_score

scqr_validate_response_score:
        ; The packed-choice bytes are followed by the embedded local correct
        ; count. It must fit the declared response count before the cursor
        ; may advance to the stored CRC.
        ld a,(hl)
        ld b,a
        ld a,(scqr_choice_count)
        cp b
        jp c,scqr_fail
        inc hl
        jr scqr_validate_result_end

scqr_validate_progress:
        ld a,(hl)
        or a
        jp z,scqr_fail
        cp 5
        jp nc,scqr_fail
        ld de,5
        add hl,de

scqr_validate_result_end:
        ld a,(scqr_result_length)
        sub 2
        ld e,a
        ld d,0
        ld bc,scqr_result
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jp nz,scqr_fail
        or a
        ret

; Capture the first immutable SCR1 sequence in the current append-only queue.
; DSQOUT's 170-bit receipt map is tied to this base sequence, so a later
; whole-batch relay ACK naturally makes an old receipt map inapplicable.
scqr_capture_first_sequence:
        ld de,(scqr_first_offset)
        ld a,(scqr_queue_device_length)
        add a,9
        ld c,a
        ld b,0
        ex de,hl
        add hl,bc
        ex de,hl
        ld hl,scqr_queue_base_sequence
        ld b,3
scqr_copy_queue_base_sequence:
        call sc_record_read_byte
        jp c,scqr_fail
        ld (hl),a
        inc hl
        inc de
        djnz scqr_copy_queue_base_sequence
        or a
        ret

; A = candidate device character. Carry means invalid.
scqr_validate_device_character:
        cp '0'
        jr c,scqr_device_invalid
        cp '9' + 1
        jr c,scqr_device_valid
        cp 'A'
        jr c,scqr_device_invalid
        cp 'Z' + 1
        jr nc,scqr_device_invalid
scqr_device_valid:
        or a
        ret
scqr_device_invalid:
        scf
        ret

; ---------------------------------------------------------------------------
; `sch:r1:` plus RFC 4648 BASE32 without padding.

scqr_build_payload:
        ld hl,scqr_payload_prefix
        ld de,scqr_payload
        ld bc,7
        ldir
        ld (scqr_payload_pointer),de
        xor a
        ld (scqr_base32_value),a
        ld (scqr_base32_bits),a
        ld hl,scqr_result
        ld a,(scqr_result_length)
        ld b,a
scqr_base32_byte:
        ld d,(hl)
        ld c,8
scqr_base32_bit:
        sla d
        ld a,(scqr_base32_value)
        rla
        and 0x1F
        ld (scqr_base32_value),a
        ld a,(scqr_base32_bits)
        inc a
        ld (scqr_base32_bits),a
        cp 5
        jr nz,scqr_base32_next_bit
        xor a
        ld (scqr_base32_bits),a
        ld a,(scqr_base32_value)
        call scqr_base32_emit
scqr_base32_next_bit:
        dec c
        jr nz,scqr_base32_bit
        inc hl
        djnz scqr_base32_byte
        ld a,(scqr_base32_bits)
        or a
        jr z,scqr_base32_done
        ld c,a
        ld a,5
        sub c
        ld c,a
        ld a,(scqr_base32_value)
scqr_base32_pad:
        add a,a
        dec c
        jr nz,scqr_base32_pad
        and 0x1F
        call scqr_base32_emit
scqr_base32_done:
        ld hl,(scqr_payload_pointer)
        ld de,scqr_payload
        or a
        sbc hl,de
        ld a,h
        or a
        jp nz,scqr_fail
        ld a,l
        cp 119
        jp nc,scqr_fail
        ld (scqr_payload_length),a
        or a
        ret

; A = 0..31.
scqr_base32_emit:
        push hl
        push de
        ld e,a
        ld d,0
        ld hl,scqr_base32_alphabet
        add hl,de
        ld a,(hl)
        ld hl,(scqr_payload_pointer)
        ld (hl),a
        inc hl
        ld (scqr_payload_pointer),hl
        pop de
        pop hl
        ret

; ---------------------------------------------------------------------------
; Fixed Version-5/M bitstream: Byte("sch:r") + Alphanumeric(rest).

scqr_encode_data:
        ld hl,scqr_data_codewords
        ld de,scqr_data_codewords + 1
        ld bc,SCQR_DATA_CODEWORDS - 1
        xor a
        ld (hl),a
        ldir
        ld (scqr_data_byte),a
        ld (scqr_data_bits),a
        ld (scqr_data_length),a
        ld (scqr_total_bits),a
        ld (scqr_total_bits + 1),a

        ld hl,4                    ; Byte mode
        ld b,4
        call scqr_append_bits
        ret c
        ld hl,5                    ; lowercase byte prefix length
        ld b,8
        call scqr_append_bits
        ret c
        ld hl,scqr_payload
        ld c,5
scqr_encode_byte_prefix:
        ld a,(hl)
        push hl
        push bc
        ld l,a
        ld h,0
        ld b,8
        call scqr_append_bits
        pop bc
        pop hl
        ret c
        inc hl
        dec c
        jr nz,scqr_encode_byte_prefix

        ld hl,2                    ; Alphanumeric mode
        ld b,4
        call scqr_append_bits
        ret c
        ld a,(scqr_payload_length)
        sub 5
        ld (scqr_alpha_remaining),a
        ld l,a
        ld h,0
        ld b,9
        call scqr_append_bits
        ret c
        ld hl,scqr_payload + 5
        ld (scqr_alpha_pointer),hl

scqr_encode_alpha_loop:
        ld a,(scqr_alpha_remaining)
        cp 2
        jr c,scqr_encode_alpha_tail
        ld hl,(scqr_alpha_pointer)
        ld a,(hl)
        call scqr_alpha_value
        ret c
        ld (scqr_alpha_first),a
        inc hl
        ld a,(hl)
        call scqr_alpha_value
        ret c
        ld (scqr_alpha_second),a
        inc hl
        ld (scqr_alpha_pointer),hl
        ld a,(scqr_alpha_remaining)
        sub 2
        ld (scqr_alpha_remaining),a

        ld a,(scqr_alpha_first)
        ld e,a
        ld d,0
        ld hl,0
        ld b,45
scqr_alpha_multiply:
        add hl,de
        djnz scqr_alpha_multiply
        ld a,(scqr_alpha_second)
        ld e,a
        ld d,0
        add hl,de
        ld b,11
        call scqr_append_bits
        ret c
        jr scqr_encode_alpha_loop

scqr_encode_alpha_tail:
        or a
        jr z,scqr_encode_terminator
        ld hl,(scqr_alpha_pointer)
        ld a,(hl)
        call scqr_alpha_value
        ret c
        ld l,a
        ld h,0
        ld b,6
        call scqr_append_bits
        ret c

scqr_encode_terminator:
        ld b,4
scqr_terminator_loop:
        ld hl,(scqr_total_bits)
        ld de,SCQR_DATA_CAPACITY_BITS
        or a
        sbc hl,de
        jr nc,scqr_align_data
        xor a
        call scqr_append_bit
        ret c
        djnz scqr_terminator_loop
scqr_align_data:
        ld a,(scqr_data_bits)
        or a
        jr z,scqr_pad_codewords
        xor a
        call scqr_append_bit
        ret c
        jr scqr_align_data

scqr_pad_codewords:
        xor a
        ld (scqr_pad_toggle),a
scqr_pad_codeword_loop:
        ld a,(scqr_data_length)
        cp SCQR_DATA_CODEWORDS
        jr z,scqr_encode_data_done
        ld e,a
        ld d,0
        ld hl,scqr_data_codewords
        add hl,de
        ld a,(scqr_pad_toggle)
        or a
        ld a,0xEC
        jr z,scqr_pad_value_ready
        ld a,0x11
scqr_pad_value_ready:
        ld (hl),a
        ld a,(scqr_pad_toggle)
        xor 1
        ld (scqr_pad_toggle),a
        ld a,(scqr_data_length)
        inc a
        ld (scqr_data_length),a
        jr scqr_pad_codeword_loop
scqr_encode_data_done:
        or a
        ret

; A = supported Alphanumeric character; return QR value in A.
scqr_alpha_value:
        cp '0'
        jr c,scqr_alpha_invalid
        cp '9' + 1
        jr nc,scqr_alpha_letter
        sub '0'
        or a
        ret
scqr_alpha_letter:
        cp 'A'
        jr c,scqr_alpha_colon
        cp 'Z' + 1
        jr nc,scqr_alpha_colon
        sub 'A' - 10
        or a
        ret
scqr_alpha_colon:
        cp ':'
        jr nz,scqr_alpha_invalid
        ld a,44
        or a
        ret
scqr_alpha_invalid:
        scf
        ret

; HL = value, B = width (1..16), MSB first.
scqr_append_bits:
        ld a,16
        sub b
        ld c,a
        jr z,scqr_append_bits_aligned
scqr_append_bits_shift:
        add hl,hl
        dec c
        jr nz,scqr_append_bits_shift
scqr_append_bits_aligned:
        xor a
        bit 7,h
        jr z,scqr_append_bits_value_ready
        inc a
scqr_append_bits_value_ready:
        push hl
        push bc
        call scqr_append_bit
        pop bc
        pop hl
        ret c
        add hl,hl
        djnz scqr_append_bits_aligned
        or a
        ret

; A = bit. Pack directly into the 86-byte data-codeword buffer.
scqr_append_bit:
        ld c,a
        ld hl,(scqr_total_bits)
        ld de,SCQR_DATA_CAPACITY_BITS
        or a
        sbc hl,de
        jp nc,scqr_fail
        ld hl,(scqr_total_bits)
        inc hl
        ld (scqr_total_bits),hl
        ld a,(scqr_data_byte)
        add a,a
        or c
        ld (scqr_data_byte),a
        ld a,(scqr_data_bits)
        inc a
        ld (scqr_data_bits),a
        cp 8
        jr z,scqr_append_bit_flush
        or a
        ret
scqr_append_bit_flush:
        ld a,(scqr_data_length)
        ld e,a
        ld d,0
        ld hl,scqr_data_codewords
        add hl,de
        ld a,(scqr_data_byte)
        ld (hl),a
        xor a
        ld (scqr_data_byte),a
        ld (scqr_data_bits),a
        ld a,(scqr_data_length)
        inc a
        ld (scqr_data_length),a
        or a
        ret

; ---------------------------------------------------------------------------
; Two 43-data/24-ECC Reed-Solomon blocks over GF(256), polynomial 0x11D.

scqr_build_ecc:
        ld hl,scqr_data_codewords
        ld de,scqr_ecc_codewords
        call scqr_rs_block
        ld hl,scqr_data_codewords + SCQR_BLOCK_DATA_CODEWORDS
        ld de,scqr_ecc_codewords + SCQR_ECC_CODEWORDS
        jp scqr_rs_block

; HL = 43-byte data block, DE = 24-byte remainder destination.
scqr_rs_block:
        ld (scqr_rs_data_pointer),hl
        ld (scqr_rs_ecc_pointer),de
        push de
        pop hl
        inc de
        ld bc,SCQR_ECC_CODEWORDS - 1
        xor a
        ld (hl),a
        ldir
        ld b,SCQR_BLOCK_DATA_CODEWORDS
scqr_rs_data_loop:
        push bc
        ld hl,(scqr_rs_data_pointer)
        ld a,(hl)
        inc hl
        ld (scqr_rs_data_pointer),hl
        ld hl,(scqr_rs_ecc_pointer)
        xor (hl)
        ld (scqr_rs_factor),a

        ld de,(scqr_rs_ecc_pointer)
        push de
        pop hl
        inc hl
        ld bc,SCQR_ECC_CODEWORDS - 1
        ldir
        xor a
        ld (de),a

        ld hl,scqr_rs_generator_tail
        ld de,(scqr_rs_ecc_pointer)
        ld b,SCQR_ECC_CODEWORDS
scqr_rs_mix_loop:
        ld a,(scqr_rs_factor)
        ld c,a
        ld a,(hl)
        push hl
        push de
        push bc
        call scqr_gf_multiply
        pop bc
        pop de
        pop hl
        ld c,a
        ld a,(de)
        xor c
        ld (de),a
        inc hl
        inc de
        djnz scqr_rs_mix_loop
        pop bc
        djnz scqr_rs_data_loop
        ret

; A × C in GF(256), return A. Reduction uses x^8+x^4+x^3+x^2+1.
scqr_gf_multiply:
        ld e,a
        ld d,0
        ld b,8
scqr_gf_loop:
        bit 0,c
        jr z,scqr_gf_no_add
        ld a,d
        xor e
        ld d,a
scqr_gf_no_add:
        sla e
        jr nc,scqr_gf_reduced
        ld a,e
        xor 0x1D
        ld e,a
scqr_gf_reduced:
        srl c
        djnz scqr_gf_loop
        ld a,d
        ret

; ---------------------------------------------------------------------------
; Render fixed function modules, then interleaved data under mask pattern 0.

scqr_draw_function_modules:
        xor a
        ld (scqr_draw_row),a
        ld (scqr_draw_column),a
scqr_draw_function_loop:
        ld a,(scqr_draw_row)
        cp SCQR_SIZE
        ret z
        ld b,a
        ld a,(scqr_draw_column)
        ld c,a
        ld hl,scqr_function_dark_bits
        call scqr_test_bitset
        call nz,scqr_set_module
        ld a,(scqr_draw_column)
        inc a
        cp SCQR_SIZE
        jr c,scqr_draw_function_store_column
        xor a
        ld (scqr_draw_column),a
        ld a,(scqr_draw_row)
        inc a
        ld (scqr_draw_row),a
        jr scqr_draw_function_loop
scqr_draw_function_store_column:
        ld (scqr_draw_column),a
        jr scqr_draw_function_loop

scqr_draw_data_modules:
        xor a
        ld (scqr_codeword_index),a
        ld (scqr_codeword_mask),a
        ld a,SCQR_SIZE - 1
        ld (scqr_data_row),a
        ld (scqr_data_column),a
        ld a,0xFF
        ld (scqr_data_direction),a
scqr_data_column_loop:
        ld a,(scqr_data_column)
        cp SCQR_SIZE
        ret nc
        cp 6
        jr nz,scqr_data_column_ready
        dec a
        ld (scqr_data_column),a
scqr_data_column_ready:
scqr_data_row_loop:
        ld a,(scqr_data_column)
        ld c,a
        ld a,(scqr_data_row)
        ld b,a
        call scqr_place_data_module
        ld a,(scqr_data_column)
        dec a
        ld c,a
        ld a,(scqr_data_row)
        ld b,a
        call scqr_place_data_module

        ld a,(scqr_data_direction)
        ld b,a
        ld a,(scqr_data_row)
        add a,b
        cp 0xFF
        jr z,scqr_data_bottom_turn
        cp SCQR_SIZE
        jr z,scqr_data_top_turn
        ld (scqr_data_row),a
        jr scqr_data_row_loop
scqr_data_bottom_turn:
        xor a
        ld (scqr_data_row),a
        inc a
        ld (scqr_data_direction),a
        jr scqr_data_next_column
scqr_data_top_turn:
        ld a,SCQR_SIZE - 1
        ld (scqr_data_row),a
        ld a,0xFF
        ld (scqr_data_direction),a
scqr_data_next_column:
        ld a,(scqr_data_column)
        sub 2
        ld (scqr_data_column),a
        jr scqr_data_column_loop

; B = row, C = column.
scqr_place_data_module:
        ld hl,scqr_reserved_bits
        call scqr_test_bitset
        ret nz
        push bc
        call scqr_next_codeword_bit
        ld d,a
        pop bc
        ld a,b
        add a,c
        and 1
        ld a,d
        jr nz,scqr_data_mask_ready
        xor 1
scqr_data_mask_ready:
        or a
        ret z
        jp scqr_set_module

; Return the next interleaved data/ECC bit, then zero remainder bits.
scqr_next_codeword_bit:
        ld a,(scqr_codeword_mask)
        or a
        jr nz,scqr_codeword_bit_ready
        ld a,(scqr_codeword_index)
        cp SCQR_TOTAL_CODEWORDS
        jr nc,scqr_codeword_remainder
        cp SCQR_DATA_CODEWORDS
        jr c,scqr_codeword_data
        sub SCQR_DATA_CODEWORDS
        ld e,a
        and 1
        ld c,a
        ld a,e
        srl a
        ld e,a
        ld d,0
        ld hl,scqr_ecc_codewords
        add hl,de
        ld a,c
        or a
        jr z,scqr_codeword_loaded
        ld de,SCQR_ECC_CODEWORDS
        add hl,de
        jr scqr_codeword_loaded
scqr_codeword_data:
        ld e,a
        and 1
        ld c,a
        ld a,e
        srl a
        ld e,a
        ld d,0
        ld hl,scqr_data_codewords
        add hl,de
        ld a,c
        or a
        jr z,scqr_codeword_loaded
        ld de,SCQR_BLOCK_DATA_CODEWORDS
        add hl,de
scqr_codeword_loaded:
        ld a,(hl)
        ld (scqr_codeword_byte),a
        ld a,0x80
        ld (scqr_codeword_mask),a
scqr_codeword_bit_ready:
        ld b,a
        ld a,(scqr_codeword_byte)
        and b
        jr z,scqr_codeword_bit_zero
        ld c,1
        jr scqr_codeword_advance
scqr_codeword_bit_zero:
        ld c,0
scqr_codeword_advance:
        ld a,(scqr_codeword_mask)
        srl a
        ld (scqr_codeword_mask),a
        jr nz,scqr_codeword_return
        ld a,(scqr_codeword_index)
        inc a
        ld (scqr_codeword_index),a
scqr_codeword_return:
        ld a,c
        ret
scqr_codeword_remainder:
        xor a
        ret

; HL = packed row-major bitset; B = row; C = column. Returns NZ when set.
scqr_test_bitset:
        ld (scqr_bitset_base),hl
        push bc
        ld l,b
        ld h,0
        add hl,hl                   ; row * 2
        add hl,hl                   ; row * 4
        push hl
        add hl,hl                   ; row * 8
        add hl,hl                   ; row * 16
        add hl,hl                   ; row * 32
        pop de
        add hl,de                   ; row * 36
        ld e,b
        ld d,0
        add hl,de                   ; row * 37
        ld e,c
        ld d,0
        add hl,de
        ld a,l
        and 7
        ld c,a
        srl h
        rr l
        srl h
        rr l
        srl h
        rr l
        ld de,(scqr_bitset_base)
        add hl,de
        ld a,(hl)
        ld hl,scqr_bit_masks
        ld e,c
        ld d,0
        add hl,de
        and (hl)
        pop bc
        ret

; B = QR row, C = QR column. Set the corresponding one-bit LCD pixel.
scqr_set_module:
        push bc
        ld a,c
        add a,SCQR_ORIGIN_X
        ld e,a
        and 7
        ld c,a
        ld a,e
        srl a
        srl a
        srl a
        ld e,a
        ld d,0
        ld a,b
        add a,SCQR_ORIGIN_Y
        ld l,a
        ld h,0
        add hl,hl
        add hl,hl
        add hl,hl
        add hl,hl
        add hl,de
        ld de,VideoRam
        add hl,de
        push hl
        ld hl,scqr_bit_masks
        ld e,c
        ld d,0
        add hl,de
        ld a,(hl)
        pop hl
        or (hl)
        ld (hl),a
        pop bc
        ret

; ---------------------------------------------------------------------------

; The result QR owns the optical frame above y=55.  A sparse F-key rail below
; it leaves the mandatory quiet zone intact: MARK records only the learner's
; self-reported scan receipt; LATER keeps the item for a later batch scan.
scqr_draw_output_rail:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        call ui_mode_set
        call ui_select_compact
        ld hl,scqr_done_label
        ld b,5
        ld c,58
        call ui_draw_text
        ld hl,scqr_later_label
        ld b,104
        ld c,58
        call ui_draw_text
        jp ui_mode_set

; F1 is an advisory optical receipt, never a server acknowledgement.  A torn
; or full DSQOUT is safe: it can only make a result appear pending again; DSQ
; remains byte-for-byte intact until the foreground-link ACK commit.
scqr_mark_output_done:
        call scqr_open_or_reset_output_receipt
        jp c,scqr_fail
        ld a,(scqr_latest_index)
        ld b,a
        srl a
        srl a
        srl a
        ld e,a
        ld d,0
        ld hl,scqr_output_receipt + 10
        add hl,de
        ld a,b
        and 7
        ld b,a
        ld a,1
scqr_output_bit_loop:
        ld c,a
        ld a,b
        or a
        ld a,c
        jr z,scqr_output_bit_ready
        add a,a
        dec b
        jr scqr_output_bit_loop
scqr_output_bit_ready:
        or (hl)
        ld (hl),a
        call scqr_finish_output_receipt
        jp c,scqr_fail
        call scqr_store_output_receipt
        ret

; Load an existing SCO1 map only when it belongs to this queue's first
; sequence.  A missing, malformed, stale, or partially-written receipt is
; deliberately reset; it is UI evidence, not delivery authority.
scqr_open_or_reset_output_receipt:
        ld hl,scqr_dsqout_name
        ld de,scqr_sco1_magic
        call sc_envelope_open
        jr c,scqr_reset_output_receipt
        ld hl,(sc_record_length)
        ld de,SCQR_OUTPUT_RECEIPT_BYTES
        or a
        sbc hl,de
        jr nz,scqr_reset_output_receipt
        xor a
        ld (scqr_output_offset),a
        ld (scqr_output_offset + 1),a
        ld hl,scqr_output_receipt
        ld b,SCQR_OUTPUT_RECEIPT_BYTES
scqr_copy_output_receipt:
        ld de,(scqr_output_offset)
        call sc_record_read_byte
        jr c,scqr_reset_output_receipt
        ld (hl),a
        inc hl
        ld de,(scqr_output_offset)
        inc de
        ld (scqr_output_offset),de
        djnz scqr_copy_output_receipt
        ld hl,scqr_output_receipt + 7
        ld de,scqr_queue_base_sequence
        ld b,3
scqr_output_base_matches:
        ld a,(de)
        cp (hl)
        jr nz,scqr_reset_output_receipt
        inc de
        inc hl
        djnz scqr_output_base_matches
        or a
        ret

scqr_reset_output_receipt:
        ld hl,scqr_output_prefix
        ld de,scqr_output_receipt
        ld bc,7
        ldir
        ld hl,scqr_queue_base_sequence
        ld de,scqr_output_receipt + 7
        ld bc,3
        ldir
        ld hl,scqr_output_receipt + 10
        xor a
        ld b,SCQR_OUTPUT_BITSET_BYTES
scqr_clear_output_bits:
        ld (hl),a
        inc hl
        djnz scqr_clear_output_bits
        jp scqr_finish_output_receipt

scqr_finish_output_receipt:
        ld hl,scqr_output_receipt
        ld bc,SCQR_OUTPUT_RECEIPT_BYTES - 2
        call crc16_ccitt_false
        ld a,e
        ld (scqr_output_receipt + SCQR_OUTPUT_RECEIPT_BYTES - 2),a
        ld a,d
        ld (scqr_output_receipt + SCQR_OUTPUT_RECEIPT_BYTES - 1),a
        or a
        ret

scqr_store_output_receipt:
        call _memchk
        or a
        jr nz,scqr_output_memory_ready
        ld de,SCQR_OUTPUT_RECEIPT_BYTES + 32
        or a
        sbc hl,de
        jr c,scqr_output_store_fail
scqr_output_memory_ready:
        ld hl,scqr_dsqout_name
        rst 0x20
        rst 0x10
        call nc,_delvar
        ld hl,scqr_dsqout_name
        rst 0x20
        ld hl,SCQR_OUTPUT_RECEIPT_BYTES
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (scqr_output_dest_addr),hl
        ld (scqr_output_dest_page),a
        xor a
        ld hl,scqr_output_receipt
        call _set_abs_src
        ld a,(scqr_output_dest_page)
        ld hl,(scqr_output_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,SCQR_OUTPUT_RECEIPT_BYTES
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret
scqr_output_store_fail:
        scf
        ret

scqr_render_error:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,scqr_error_title
        ld b,1
        ld c,1
        call ui_draw_text
        call ui_mode_set
        call ui_select_compact
        ld hl,scqr_error_text
        ld b,2
        ld c,15
        ld d,122
        ld e,48
        call ui_draw_wrapped_text
scqr_error_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        ret z
        jr scqr_error_wait

scqr_fail:
        scf
        ret

; Validate the loaded SCX1 header before any OS call or variable access.
scqr_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,scqr_self_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,scqr_self_fail
        ld hl,_asm_exec_ram + 3
        ld de,scqr_expected_magic
        ld b,4
scqr_self_magic:
        ld a,(de)
        cp (hl)
        jr nz,scqr_self_fail
        inc de
        inc hl
        djnz scqr_self_magic
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,scqr_self_fail
        ld a,(_asm_exec_ram + 8)
        cp 2
        jr nz,scqr_self_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,scqr_self_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,scqr_self_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,scqr_self_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,scqr_self_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,scqr_self_fail
        or a
        ret
scqr_self_fail:
        scf
        ret

scqr_expected_magic: defb "SCX1"
scqr_scq1_magic: defb "SCQ1"
scqr_scr1_magic: defb "SCR1"
scqr_sco1_magic: defb "SCO1"
scqr_payload_prefix: defb "sch:r1:"
scqr_base32_alphabet: defb "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
scqr_bit_masks: defb 0x80,0x40,0x20,0x10,0x08,0x04,0x02,0x01
scqr_error_title: defb "SCHOOLCALC / QR",0
scqr_error_text: defb "NO QR RESULT. FINISH A QUIZ.",0
scqr_dsq_name: defb 0x0C,3,"DSQ",0,0,0,0,0
scqr_dsqout_name: defb 0x0C,6,"DSQOUT",0,0
scqr_scan_instruction: defb "QR RESULT F1=SCANNED",0
scqr_done_label: defb "MARK",0
scqr_later_label: defb "LATER",0
; SCO1: fixed envelope header, queue-base sequence, 170 receipt bits, CRC.
scqr_output_prefix: defb "SCO1",1,25,0

scqr_queue_device_length: defb 0
scqr_queue_device: defs 16,0
scqr_records_remaining: defb 0
scqr_queue_count: defb 0
scqr_latest_index: defb 0
scqr_latest_length: defw 0
scqr_latest_offset: defw 0
scqr_first_offset: defw 0
scqr_result_length: defb 0
scqr_result_kind: defb 0
scqr_choice_count: defb 0
scqr_result: defs SCQR_RESULT_MAX_BYTES,0
scqr_current_sequence: defs 3,0
scqr_queue_base_sequence: defs 3,0
scqr_output_receipt: defs SCQR_OUTPUT_RECEIPT_BYTES,0
scqr_output_offset: defw 0
scqr_output_dest_addr: defw 0
scqr_output_dest_page: defb 0
scqr_payload_pointer: defw 0
scqr_payload_length: defb 0
scqr_payload: defs 118,0
scqr_base32_value: defb 0
scqr_base32_bits: defb 0
scqr_alpha_pointer: defw 0
scqr_alpha_remaining: defb 0
scqr_alpha_first: defb 0
scqr_alpha_second: defb 0
scqr_data_codewords: defs SCQR_DATA_CODEWORDS,0
scqr_ecc_codewords: defs SCQR_ECC_CODEWORDS * 2,0
scqr_data_byte: defb 0
scqr_data_bits: defb 0
scqr_data_length: defb 0
scqr_total_bits: defw 0
scqr_pad_toggle: defb 0
scqr_rs_data_pointer: defw 0
scqr_rs_ecc_pointer: defw 0
scqr_rs_factor: defb 0
scqr_draw_row: defb 0
scqr_draw_column: defb 0
scqr_data_row: defb 0
scqr_data_column: defb 0
scqr_data_direction: defb 0
scqr_codeword_index: defb 0
scqr_codeword_mask: defb 0
scqr_codeword_byte: defb 0
scqr_bitset_base: defw 0

UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
UI_RENDER_COPIED_TEXT_LENGTH: equ 0
include "ui-renderer.asm"
include "input.asm"
include "crc16-ccitt.asm"
include "record-reader.asm"
include "generated/qr-v5-assets.inc"
include "generated/ui-qr-runtime-assets.inc"

end
