; Physical probe for the SchoolCalc runtime glyph/icon/component renderer.

include "ti86asm.inc"

org _asm_exec_ram

start:
        call _runindicoff
        call sc_input_init
        xor a
        ld (probe_page),a
render:
        call _clrLCD
        ld a,(probe_page)
        or a
        jr z,render_type
        dec a
        jr z,render_icons
        call render_reader
        jr render_done
render_type:
        call render_type_page
        jr render_done
render_icons:
        call render_icon_page
render_done:
        call render_softkeys
wait_key:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jr z,probe_exit
        cp SC_SCAN_RIGHT
        jr z,next_page
        cp SC_SCAN_ENTER
        jr z,next_page
        cp SC_SCAN_LEFT
        jr z,previous_page
        cp SC_SCAN_F1
        jr z,page_zero
        cp SC_SCAN_F2
        jr z,page_one
        cp SC_SCAN_F3
        jr z,page_two
        jr wait_key

next_page:
        ld a,(probe_page)
        inc a
        cp 3
        jr c,store_page
page_zero:
        xor a
        jr store_page
page_one:
        ld a,1
        jr store_page
page_two:
        ld a,2
        jr store_page
previous_page:
        ld a,(probe_page)
        or a
        jr nz,previous_decrement
        ld a,3
previous_decrement:
        dec a
store_page:
        ld (probe_page),a
        jr render

probe_exit:
        jp sc_input_force_exit

render_type_page:
        ld hl,type_title
        ld de,type_position
        call render_header
        call ui_mode_set
        call ui_select_reader
        ld hl,mixed_case
        ld b,2
        ld c,11
        call ui_draw_text
        ld hl,alphabet
        ld b,2
        ld c,18
        call ui_draw_text
        call ui_select_compact
        ld hl,compact_label
        ld b,2
        ld c,27
        call ui_draw_text
        call ui_select_display
        ld hl,display_value
        ld b,2
        ld c,36
        call ui_draw_text
        call ui_select_compact
        ld hl,runtime_label
        ld b,2
        ld c,47
        ld d,124
        jp ui_draw_text_clipped

render_icon_page:
        ld hl,icon_title
        ld de,icon_position
        call render_header
        call ui_mode_set
        ld a,UI_ICON_HOME
        ld b,3
        ld c,12
        call ui_draw_icon
        ld a,UI_ICON_DOWNLOAD
        ld b,26
        ld c,12
        call ui_draw_icon
        ld a,UI_ICON_SYNC
        ld b,51
        ld c,12
        call ui_draw_icon
        ld a,UI_ICON_QR
        ld b,76
        ld c,12
        call ui_draw_icon
        ld a,UI_ICON_MARK
        ld b,101
        ld c,12
        call ui_draw_icon
        call ui_select_compact
        ld hl,home_label
        ld b,1
        ld c,22
        call ui_draw_text
        ld hl,get_label
        ld b,25
        ld c,22
        call ui_draw_text
        ld hl,sync_label
        ld b,47
        ld c,22
        call ui_draw_text
        ld hl,qr_label
        ld b,76
        ld c,22
        call ui_draw_text
        ld hl,mark_label
        ld b,96
        ld c,22
        call ui_draw_text
        call ui_select_reader
        ld hl,icon_help
        ld b,2
        ld c,35
        call ui_draw_text
        ld hl,icon_help_2
        ld b,2
        ld c,42
        jp ui_draw_text

render_reader:
        ld hl,reader_title
        ld de,reader_position
        call render_header
        call ui_mode_set
        call ui_select_reader
        ld hl,reader_paragraph
        ld b,2
        ld c,10
        ld d,123
        ld e,51
        call ui_draw_wrapped_text
        ; Overflow rail: one-pixel track and a three-pixel thumb.
        ld b,127
        ld c,9
        ld d,1
        ld e,46
        call ui_fill_rect
        ld b,125
        ld c,25
        ld d,3
        ld e,12
        jp ui_fill_rect

; HL = title and DE = right-side context.
render_header:
        ld (probe_header_title),hl
        ld (probe_header_context),de
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,(probe_header_title)
        ld b,1
        ld c,1
        call ui_draw_text
        ld hl,(probe_header_context)
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

render_softkeys:
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld b,26
        ld c,56
        ld d,24
        ld e,8
        call ui_fill_rect
        ld b,51
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,type_key
        ld b,5
        ld c,58
        call ui_draw_text
        ld hl,icon_key
        ld b,30
        ld c,58
        call ui_draw_text
        ld hl,read_key
        ld b,56
        ld c,58
        call ui_draw_text
        jp ui_mode_set

probe_page:             defb 0
probe_header_title:     defw 0
probe_header_context:   defw 0
type_title:             defb "TYPE SYSTEM",0
type_position:          defb "1/3",0
icon_title:             defb "ICONS",0
icon_position:          defb "2/3",0
reader_title:           defb "STUDY CARD",0
reader_position:        defb "3/3",0
mixed_case:             defb "Mixed-case reader text",0
alphabet:               defb "Aa Bb Cc 0123",0
compact_label:          defb "> COMPACT LIST LABEL",0
display_value:          defb "42.5%",0
runtime_label:          defb "RUNTIME GLYPHS - STRUCTURED CONTENT, NOT FRAMES",0
home_label:             defb "HOME",0
get_label:              defb "GET",0
sync_label:             defb "SYNC",0
qr_label:               defb "QR",0
mark_label:             defb "MARK",0
icon_help:              defb "Icons are reusable 7x7",0
icon_help_2:            defb "bitmap components.",0
reader_paragraph:       defb "A sticky header stays put while this mixed-case body wraps at word boundaries. The right rail shows that more lesson text exists outside this viewport.",0
type_key:               defb "TYPE",0
icon_key:               defb "ICON",0
read_key:               defb "READ",0

UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 1
UI_RENDER_INCLUDE_DISPLAY: equ 1
UI_RENDER_INCLUDE_ICONS: equ 1
UI_RENDER_COPIED_TEXT_LENGTH: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/ui-assets.inc"

end
