; CRC-16/CCITT-FALSE over a contiguous page-zero byte range.
;
; Input:  HL = first byte, BC = byte length
; Output: DE = CRC (poly 0x1021, init 0xFFFF)
; Clobbers: AF, BC, HL

crc16_ccitt_false:
        ld de,0xFFFF
crc16_ccitt_byte:
        ld a,b
        or c
        ret z
        ld a,(hl)
        inc hl
        xor d
        ld d,a
        push bc
        ld b,8
crc16_ccitt_bit:
        bit 7,d
        jr z,crc16_ccitt_shift_only
        sla e
        rl d
        ld a,d
        xor 0x10
        ld d,a
        ld a,e
        xor 0x21
        ld e,a
        jr crc16_ccitt_bit_done
crc16_ccitt_shift_only:
        sla e
        rl d
crc16_ccitt_bit_done:
        djnz crc16_ccitt_bit
        pop bc
        dec bc
        jr crc16_ccitt_byte
