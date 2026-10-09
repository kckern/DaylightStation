; SchoolCalc one-bit runtime renderer.
;
; Public routines accept page-zero pointers and ASCII strings. Glyphs and
; icons are eight-byte fixed-stride records generated from the reviewable YAML
; sources. Drawing is clipped at the physical 128x64 framebuffer boundary.

; The including program defines UI_RENDER_PROFILE_FULL plus independent
; COMPACT/READER/DISPLAY/ICONS switches as zero or one. This is manual
; link-time dead-code elimination for bounded executables, not a second UI
; contract.

ui_mode_set:
        xor a
        ld (ui_draw_mode),a
        ret

ui_mode_clear:
        ld a,1
        ld (ui_draw_mode),a
        ret

if UI_RENDER_INCLUDE_COMPACT
ui_select_compact:
        ld hl,ui_font_compact_3x5
        ld (ui_font_base),hl
        ld a,3
        ld (ui_font_width),a
        ld a,5
        ld (ui_font_height),a
        ld a,4
        ld (ui_font_advance),a
        ld a,6
        ld (ui_font_advance_y),a
        ld a,UI_FONT_COMPACT_3X5_STRIDE
        ld (ui_font_stride),a
        ret
endif

if UI_RENDER_INCLUDE_READER
ui_select_reader:
        ld hl,ui_font_reader_4x6
        ld (ui_font_base),hl
        ld a,4
        ld (ui_font_width),a
        ld a,6
        ld (ui_font_height),a
        ld a,5
        ld (ui_font_advance),a
        ld a,7
        ld (ui_font_advance_y),a
        ld a,UI_FONT_READER_4X6_STRIDE
        ld (ui_font_stride),a
        ret
endif

if UI_RENDER_INCLUDE_DISPLAY
ui_select_display:
        ld hl,ui_font_display_5x7
        ld (ui_font_base),hl
        ld a,5
        ld (ui_font_width),a
        ld a,7
        ld (ui_font_height),a
        ld a,6
        ld (ui_font_advance),a
        ld a,8
        ld (ui_font_advance_y),a
        ld a,UI_FONT_DISPLAY_5X7_STRIDE
        ld (ui_font_stride),a
        ret
endif

; HL = zero-terminated text, B = x, C = y.
ui_draw_text:
        ld (ui_text_ptr),hl
        ld a,b
        ld (ui_text_x),a
        ld a,c
        ld (ui_text_y),a
ui_draw_text_loop:
        ld hl,(ui_text_ptr)
        ld a,(hl)
        or a
        ret z
        inc hl
        ld (ui_text_ptr),hl
        cp 128
        jr c,ui_draw_text_ascii
        ld a,63
ui_draw_text_ascii:
        push af
        ld a,(ui_text_x)
        ld b,a
        ld a,(ui_text_y)
        ld c,a
        pop af
        call ui_draw_glyph
        ld a,(ui_glyph_advance)
        ld b,a
        ld a,(ui_text_x)
        add a,b
        ret c
        cp 128
        ret nc
        ld (ui_text_x),a
        jr ui_draw_text_loop

if UI_RENDER_PROFILE_FULL
; HL = text, B/C = x/y, E = maximum characters. Stops early at zero.
ui_draw_text_count:
        ld (ui_count_text_ptr),hl
        ld a,b
        ld (ui_count_text_x),a
        ld a,c
        ld (ui_count_text_y),a
        ld a,e
        ld (ui_count_text_remaining),a
ui_draw_text_count_loop:
        ld a,(ui_count_text_remaining)
        or a
        ret z
        ld hl,(ui_count_text_ptr)
        ld a,(hl)
        or a
        ret z
        inc hl
        ld (ui_count_text_ptr),hl
        cp 128
        jr c,ui_draw_text_count_ascii
        ld a,63
ui_draw_text_count_ascii:
        push af
        ld a,(ui_count_text_x)
        ld b,a
        ld a,(ui_count_text_y)
        ld c,a
        pop af
        call ui_draw_glyph
        ld a,(ui_glyph_advance)
        ld b,a
        ld a,(ui_count_text_x)
        add a,b
        ld (ui_count_text_x),a
        ld a,(ui_count_text_remaining)
        dec a
        ld (ui_count_text_remaining),a
        jr ui_draw_text_count_loop

; B = left edge, D = inclusive right edge. Returns fitted glyph count in A.
ui_compute_text_capacity:
        ld a,d
        sub b
        jr c,ui_capacity_none
        inc a
        ld (ui_capacity_available),a
        xor a
        ld (ui_capacity_count),a
        ld (ui_capacity_width),a
ui_capacity_loop:
        ld a,(ui_capacity_count)
        or a
        jr nz,ui_capacity_more
        ld a,(ui_font_width)
        jr ui_capacity_candidate
ui_capacity_more:
        ld a,(ui_capacity_width)
        ld b,a
        ld a,(ui_font_advance)
        add a,b
        jr c,ui_capacity_done
ui_capacity_candidate:
        ld b,a
        ld a,(ui_capacity_available)
        cp b
        jr c,ui_capacity_done
        ld a,b
        ld (ui_capacity_width),a
        ld a,(ui_capacity_count)
        inc a
        ld (ui_capacity_count),a
        jr ui_capacity_loop
ui_capacity_done:
        ld a,(ui_capacity_count)
        ret
ui_capacity_none:
        xor a
        ret

; HL = text, B/C = x/y, D = inclusive right edge. Overflow becomes `...`.
ui_draw_text_clipped:
        ld (ui_clip_text_ptr),hl
        ld a,b
        ld (ui_clip_x),a
        ld a,c
        ld (ui_clip_y),a
        ld a,d
        ld (ui_clip_right),a
        xor a
        ld (ui_clip_total),a
ui_clip_count_loop:
        ld a,(hl)
        or a
        jr z,ui_clip_count_done
        inc hl
        ld a,(ui_clip_total)
        cp 255
        jr z,ui_clip_count_loop
        inc a
        ld (ui_clip_total),a
        jr ui_clip_count_loop
ui_clip_count_done:
        ld a,(ui_clip_x)
        ld b,a
        ld a,(ui_clip_right)
        ld d,a
        call ui_compute_text_capacity
        ld (ui_clip_capacity),a
        or a
        ret z
        ld b,a
        ld a,(ui_clip_total)
        cp b
        jr c,ui_clip_draw_full
        jr z,ui_clip_draw_full

        ld a,(ui_clip_capacity)
        cp 4
        jr nc,ui_clip_with_prefix
        ld e,a
        ld hl,ui_ellipsis_text
        ld a,(ui_clip_x)
        ld b,a
        ld a,(ui_clip_y)
        ld c,a
        jp ui_draw_text_count

ui_clip_with_prefix:
        sub 3
        ld (ui_clip_prefix),a
        ld e,a
        ld hl,(ui_clip_text_ptr)
        ld a,(ui_clip_x)
        ld b,a
        ld a,(ui_clip_y)
        ld c,a
        call ui_draw_text_count
        ld a,(ui_count_text_x)
        ld b,a
        ld a,(ui_clip_y)
        ld c,a
        ld hl,ui_ellipsis_text
        jp ui_draw_text

ui_clip_draw_full:
        ld hl,(ui_clip_text_ptr)
        ld a,(ui_clip_x)
        ld b,a
        ld a,(ui_clip_y)
        ld c,a
        jp ui_draw_text

; HL = text, B/C = x/y, D = right edge, E = bottom edge. Wraps at spaces,
; hard-wraps overlong words, and returns A=1 with HL at the next unread byte
; when the viewport overflows; A=0 means the text was exhausted.
ui_draw_wrapped_text:
        ld (ui_wrap_ptr),hl
        ld a,b
        ld (ui_wrap_x),a
        ld a,c
        ld (ui_wrap_y),a
        ld a,d
        ld (ui_wrap_right),a
        ld a,e
        ld (ui_wrap_bottom),a
        ld a,(ui_wrap_x)
        ld b,a
        ld a,(ui_wrap_right)
        ld d,a
        call ui_compute_text_capacity
        ld (ui_wrap_capacity),a
        or a
        jp z,ui_wrap_overflow

ui_wrap_line:
        call ui_wrap_skip_spaces
        ld hl,(ui_wrap_ptr)
        ld a,(hl)
        or a
        jp z,ui_wrap_complete
        ld a,(ui_wrap_y)
        ld b,a
        ld a,(ui_font_height)
        dec a
        add a,b
        jp c,ui_wrap_overflow
        ld b,a
        ld a,(ui_wrap_bottom)
        cp b
        jp c,ui_wrap_overflow

        ld hl,(ui_wrap_ptr)
        ld (ui_wrap_scan_ptr),hl
        xor a
        ld (ui_wrap_scan_count),a
        ld a,255
        ld (ui_wrap_last_space),a
ui_wrap_scan:
        ld a,(ui_wrap_scan_count)
        ld b,a
        ld a,(ui_wrap_capacity)
        cp b
        jr z,ui_wrap_capacity_reached
        ld hl,(ui_wrap_scan_ptr)
        ld a,(hl)
        or a
        jr z,ui_wrap_terminal_line
        cp 10
        jr z,ui_wrap_newline
        cp 32
        jr nz,ui_wrap_scan_advance
        ld a,(ui_wrap_scan_count)
        ld (ui_wrap_last_space),a
ui_wrap_scan_advance:
        inc hl
        ld (ui_wrap_scan_ptr),hl
        ld a,(ui_wrap_scan_count)
        inc a
        ld (ui_wrap_scan_count),a
        jr ui_wrap_scan

ui_wrap_capacity_reached:
        ld hl,(ui_wrap_scan_ptr)
        ld a,(hl)
        or a
        jr z,ui_wrap_terminal_line
        ld a,(ui_wrap_last_space)
        cp 255
        jr z,ui_wrap_hard_line
        ld (ui_wrap_line_count),a
        inc a
        ld e,a
        ld d,0
        ld hl,(ui_wrap_ptr)
        add hl,de
        ld (ui_wrap_next_ptr),hl
        jr ui_wrap_draw_line
ui_wrap_hard_line:
        ld a,(ui_wrap_capacity)
        ld (ui_wrap_line_count),a
        ld hl,(ui_wrap_scan_ptr)
        ld (ui_wrap_next_ptr),hl
        jr ui_wrap_draw_line

ui_wrap_newline:
        ld a,(ui_wrap_scan_count)
        ld (ui_wrap_line_count),a
        inc hl
        ld (ui_wrap_next_ptr),hl
        jr ui_wrap_draw_line

ui_wrap_terminal_line:
        ld a,(ui_wrap_scan_count)
        ld (ui_wrap_line_count),a
        ld hl,(ui_wrap_scan_ptr)
        ld (ui_wrap_next_ptr),hl
        ld a,1
        ld (ui_wrap_terminal),a
        jr ui_wrap_draw_line

ui_wrap_draw_line:
        ld a,(ui_wrap_line_count)
        or a
        jr z,ui_wrap_after_draw
        ld e,a
        ld hl,(ui_wrap_ptr)
        ld a,(ui_wrap_x)
        ld b,a
        ld a,(ui_wrap_y)
        ld c,a
        call ui_draw_text_count
ui_wrap_after_draw:
        ld hl,(ui_wrap_next_ptr)
        ld (ui_wrap_ptr),hl
        ld a,(ui_wrap_terminal)
        or a
        jr nz,ui_wrap_complete
        ld a,(ui_wrap_y)
        ld b,a
        ld a,(ui_font_advance_y)
        add a,b
        ld (ui_wrap_y),a
        jp ui_wrap_line

ui_wrap_skip_spaces:
        xor a
        ld (ui_wrap_terminal),a
ui_wrap_skip_space_loop:
        ld hl,(ui_wrap_ptr)
        ld a,(hl)
        cp 32
        ret nz
        inc hl
        ld (ui_wrap_ptr),hl
        jr ui_wrap_skip_space_loop

ui_wrap_complete:
        ld hl,(ui_wrap_ptr)
        xor a
        ret
ui_wrap_overflow:
        ld hl,(ui_wrap_ptr)
        ld a,1
        or a
        ret
endif

; HL = zero-terminated text. Returns its exact proportional pixel width in A.
ui_measure_text:
        xor a
        ld (ui_measure_width),a
ui_measure_text_loop:
        ld a,(hl)
        or a
        jr z,ui_measure_text_done
        inc hl
        push hl
        call ui_glyph_pointer
        ld a,(hl)
        and 7
        ld b,a
        pop hl
        ld a,(ui_measure_width)
        add a,b
        jr nc,ui_measure_text_store
        ld a,255
ui_measure_text_store:
        ld (ui_measure_width),a
        jr ui_measure_text_loop
ui_measure_text_done:
        ld a,(ui_measure_width)
        or a
        ret z
        dec a
        ret

; HL = text, C = y, D = inclusive right edge. Text starts no earlier than x=0.
ui_draw_text_right:
        ld (ui_right_text_ptr),hl
        ld a,c
        ld (ui_right_text_y),a
        ld a,d
        ld (ui_right_text_edge),a
        call ui_measure_text
        ld b,a
        ld a,(ui_right_text_edge)
        inc a
        sub b
        jr nc,ui_draw_text_right_x
        xor a
ui_draw_text_right_x:
        ld b,a
        ld a,(ui_right_text_y)
        ld c,a
        ld hl,(ui_right_text_ptr)
        jp ui_draw_text

if UI_RENDER_INCLUDE_ICONS
; A = icon table index, B = x, C = y.
ui_draw_icon:
        cp UI_ICON_COUNT
        ret nc
        ld (ui_bitmap_index),a
        ld a,b
        ld (ui_saved_x),a
        ld a,c
        ld (ui_saved_y),a
        ld a,(ui_bitmap_index)
        ld l,a
        ld h,0
        add hl,hl
        add hl,hl
        add hl,hl
        ld de,ui_icon_table
        add hl,de
        ld a,(ui_saved_x)
        ld b,a
        ld a,(ui_saved_y)
        ld c,a
        ld d,UI_ICON_WIDTH
        ld e,UI_ICON_HEIGHT
        jp ui_draw_bitmap
endif

; A = ASCII code, B = x, C = y.
ui_draw_glyph:
        push af
        ld a,b
        ld (ui_saved_x),a
        ld a,c
        ld (ui_saved_y),a
        pop af
        call ui_glyph_pointer
        ld a,(hl)
        and 7
        ld (ui_glyph_advance),a
        ld a,(ui_saved_x)
        ld b,a
        ld a,(ui_saved_y)
        ld c,a
        ld a,(ui_font_width)
        ld d,a
        ld a,(ui_font_height)
        ld e,a
        jp ui_draw_bitmap

; A = ASCII code. Returns HL at its packed glyph. The low three bits of the
; first row hold the 1..7 pixel advance below every visible font bit.
ui_glyph_pointer:
        cp UI_ASCII_FIRST
        jr nc,ui_glyph_check_high
        ld a,63
        jr ui_glyph_printable
ui_glyph_check_high:
        cp UI_ASCII_LAST + 1
        jr c,ui_glyph_printable
        ld a,63
ui_glyph_printable:
        sub UI_ASCII_FIRST
        ; Font records store only their actual rows (5/6/7), rather than the
        ; old padded eight-byte stride. These fixed shift/add paths avoid a
        ; per-character multiplication loop on the 6 MHz Z80.
        ld l,a
        ld h,0
        ld e,a
        ld d,0
        ld a,(ui_font_stride)
        cp 5
        jr z,ui_glyph_stride_five
        cp 6
        jr z,ui_glyph_stride_six
        ; Display face: 7n = 8n - n.
        add hl,hl
        add hl,hl
        add hl,hl
        or a
        sbc hl,de
        jr ui_glyph_offset_ready
ui_glyph_stride_five:
        add hl,hl
        add hl,hl
        add hl,de
        jr ui_glyph_offset_ready
ui_glyph_stride_six:
        add hl,hl
        add hl,de
        add hl,hl
ui_glyph_offset_ready:
        ld de,(ui_font_base)
        add hl,de
        ret

; HL = rows (one left-aligned byte each), B/C = x/y, D/E = width/height.
ui_draw_bitmap:
        ld (ui_bitmap_ptr),hl
        ld a,b
        ld (ui_bitmap_x),a
        ld a,c
        ld (ui_bitmap_y),a
        ld a,d
        ld (ui_bitmap_width),a
        ld a,e
        ld (ui_bitmap_height),a
        xor a
        ld (ui_bitmap_row),a
ui_bitmap_row_loop:
        ld a,(ui_bitmap_row)
        ld b,a
        ld a,(ui_bitmap_height)
        cp b
        jr nz,ui_bitmap_row_load
        ; Reader glyphs pack an optional seventh-row descender into the low
        ; nibble of row six. Four column shifts leave it ready to draw here.
        ld a,(ui_bitmap_width)
        cp 4
        ret nz
        ld a,(ui_bitmap_bits)
        or a
        ret z
        ld a,7
        ld (ui_bitmap_height),a
        xor a
        ld (ui_bitmap_col),a
        jr ui_bitmap_col_loop
ui_bitmap_row_load:
        ld hl,(ui_bitmap_ptr)
        ld a,(hl)
        inc hl
        ld (ui_bitmap_ptr),hl
        ld (ui_bitmap_bits),a
        xor a
        ld (ui_bitmap_col),a
ui_bitmap_col_loop:
        ld a,(ui_bitmap_col)
        ld b,a
        ld a,(ui_bitmap_width)
        cp b
        jr z,ui_bitmap_row_done
        ld a,(ui_bitmap_bits)
        bit 7,a
        jr z,ui_bitmap_pixel_done
        ld a,(ui_bitmap_x)
        add a,b
        ld b,a
        ld a,(ui_bitmap_row)
        ld c,a
        ld a,(ui_bitmap_y)
        add a,c
        ld c,a
        call ui_plot_pixel
ui_bitmap_pixel_done:
        ld a,(ui_bitmap_bits)
        add a,a
        ld (ui_bitmap_bits),a
        ld a,(ui_bitmap_col)
        inc a
        ld (ui_bitmap_col),a
        jr ui_bitmap_col_loop
ui_bitmap_row_done:
        ld a,(ui_bitmap_row)
        inc a
        ld (ui_bitmap_row),a
        jr ui_bitmap_row_loop

; B/C = x/y, D/E = width/height. Uses the current set/clear mode.
ui_fill_rect:
        ld a,b
        ld (ui_rect_x),a
        ld a,c
        ld (ui_rect_y),a
        ld a,d
        ld (ui_rect_width),a
        ld a,e
        ld (ui_rect_height),a
        xor a
        ld (ui_rect_row),a
ui_rect_row_loop:
        ld a,(ui_rect_row)
        ld b,a
        ld a,(ui_rect_height)
        cp b
        ret z
        xor a
        ld (ui_rect_col),a
ui_rect_col_loop:
        ld a,(ui_rect_col)
        ld b,a
        ld a,(ui_rect_width)
        cp b
        jr z,ui_rect_row_done
        ld a,(ui_rect_x)
        add a,b
        ld b,a
        ld a,(ui_rect_row)
        ld c,a
        ld a,(ui_rect_y)
        add a,c
        ld c,a
        call ui_plot_pixel
        ld a,(ui_rect_col)
        inc a
        ld (ui_rect_col),a
        jr ui_rect_col_loop
ui_rect_row_done:
        ld a,(ui_rect_row)
        inc a
        ld (ui_rect_row),a
        jr ui_rect_row_loop

; B/C = x/y. Pixels outside the physical LCD are discarded.
ui_plot_pixel:
        ld a,b
        cp 128
        ret nc
        ld a,c
        cp 64
        ret nc
        push bc
        ld l,c
        ld h,0
        add hl,hl
        add hl,hl
        add hl,hl
        add hl,hl
        ld de,(ui_video_base)
        add hl,de
        ld a,b
        rrca
        rrca
        rrca
        and 0x1F
        ld e,a
        ld d,0
        add hl,de
        ld a,b
        and 7
        ld e,a
        ld d,0
        push hl
        ld hl,ui_bit_masks
        add hl,de
        ld e,(hl)
        pop hl
        ld a,(ui_draw_mode)
        or a
        jr nz,ui_plot_clear
        ld a,(hl)
        or e
        ld (hl),a
        pop bc
        ret
ui_plot_clear:
        ld a,e
        cpl
        and (hl)
        ld (hl),a
        pop bc
        ret

ui_bit_masks:          defb 0x80,0x40,0x20,0x10,0x08,0x04,0x02,0x01
; Defaults to the physical LCD. Adaptive Study temporarily redirects drawing
; to its offscreen verso buffer, then restores this pointer before input.
ui_video_base:         defw VideoRam
ui_ellipsis_text:      defb "...",0
ui_draw_mode:          defb 0
ui_font_base:          defw 0
ui_font_width:         defb 0
ui_font_height:        defb 0
ui_font_advance:       defb 0
ui_glyph_advance:      defb 0
ui_font_advance_y:     defb 0
ui_font_stride:        defb 0
ui_text_ptr:           defw 0
ui_text_x:             defb 0
ui_text_y:             defb 0
ui_measure_width:      defb 0
ui_right_text_ptr:     defw 0
ui_right_text_y:       defb 0
ui_right_text_edge:    defb 0
ui_saved_x:            defb 0
ui_saved_y:            defb 0
ui_bitmap_index:       defb 0
ui_bitmap_ptr:         defw 0
ui_bitmap_x:           defb 0
ui_bitmap_y:           defb 0
ui_bitmap_width:       defb 0
ui_bitmap_height:      defb 0
ui_bitmap_row:         defb 0
ui_bitmap_col:         defb 0
ui_bitmap_bits:        defb 0
ui_rect_x:             defb 0
ui_rect_y:             defb 0
ui_rect_width:         defb 0
ui_rect_height:        defb 0
ui_rect_row:           defb 0
ui_rect_col:           defb 0
if UI_RENDER_PROFILE_FULL
ui_count_text_ptr:     defw 0
ui_count_text_x:       defb 0
ui_count_text_y:       defb 0
ui_count_text_remaining: defb 0
ui_capacity_available: defb 0
ui_capacity_count:     defb 0
ui_capacity_width:     defb 0
ui_clip_text_ptr:      defw 0
ui_clip_x:             defb 0
ui_clip_y:             defb 0
ui_clip_right:         defb 0
ui_clip_total:         defb 0
ui_clip_capacity:      defb 0
ui_clip_prefix:        defb 0
ui_wrap_ptr:           defw 0
ui_wrap_scan_ptr:      defw 0
ui_wrap_next_ptr:      defw 0
ui_wrap_x:             defb 0
ui_wrap_y:             defb 0
ui_wrap_right:         defb 0
ui_wrap_bottom:        defb 0
ui_wrap_capacity:      defb 0
ui_wrap_scan_count:    defb 0
ui_wrap_last_space:    defb 0
ui_wrap_line_count:    defb 0
ui_wrap_terminal:      defb 0
endif
