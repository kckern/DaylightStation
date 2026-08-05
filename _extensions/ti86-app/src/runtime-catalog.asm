; SchoolCalc reviewed generic Catalog browser.
;
; SCCAT navigates only neutral Catalog/Subject/Course/Unit/Lesson/Module data.
; It never knows a school subject. Installed lesson selection records an
; immutable artifact key and module index in SCL1; install/remove/update intent
; is durably handed to the fixed SCREQ runtime.

include "ti86asm.inc"

; View 1 is retained only as the shell's coarse Catalog route.  It is never
; rendered: one SCC1 snapshot contains exactly one installed Catalog, so the
; first visible panel is that Catalog's Subject list.
CAT_VIEW_CATALOG: equ 1
CAT_VIEW_COURSE:  equ 2
CAT_VIEW_UNIT:    equ 3
CAT_VIEW_LESSON:  equ 4
CAT_VIEW_MODULE:  equ 5
CAT_VIEW_SYNC:    equ 7
CAT_VIEW_DELIVERY: equ 9
CAT_VIEW_SUBJECT: equ 10

CAT_ACTION_INSTALL: equ 1
CAT_ACTION_REMOVE:  equ 2
CAT_ACTION_UPDATE:  equ 3
CAT_VISIBLE_ROWS:   equ 6

CAT_ERROR_NONE:     equ 0
CAT_ERROR_STATE:    equ 1
CAT_ERROR_CATALOG:  equ 2
CAT_ERROR_ARTIFACT: equ 3
CAT_ERROR_SAVE:     equ 4
CAT_ERROR_REQUEST:  equ 5

org _asm_exec_ram

        nop
        jp catalog_runtime_start
        defw 0
        defw catalog_runtime_name
        defb "SCX1"
        defb 1
        defb 3                 ; closed registry code: catalog-browser
        defb 0
        defw 0
        defw 0
        defw 0

catalog_runtime_name: defb 0

catalog_runtime_start:
        ; SCHLCALC validates this immutable Program variable before TI-OS
        ; loads it into the shared execution window.
        call _runindicoff
        call sc_input_init
        call scstate_load
        jp c,cat_fail_state_load
        call cat_run_request_maintenance
        jp c,cat_fail_request
        call cat_normalize_view
        jp c,cat_fail_state_view
cat_render:
        call cat_open_array
        jp c,cat_fail_open
        ld a,(cat_count)
        or a
        jr z,cat_render_ready
        call cat_normalize_focus
        jp c,cat_fail_state_focus
        ; A user explicitly chose the parent list, so consecutive one-item
        ; hierarchy levels add no information.  Collapse Course, Unit, and
        ; installed Lesson levels before the next frame.  The pending bit is
        ; runtime-local: Back and a relaunch still expose the exact durable
        ; path instead of trapping a learner in a forward-only loop.
        call cat_auto_advance_singleton
        jp c,cat_fail_open
        ; A=2 means the singleton chain reached a single activity and saved
        ; MODULE. Return to the shell so it can launch SCLEARN through its
        ; normal verified dispatch instead of painting a throwaway one-row
        ; menu.
        cp 2
        ret z
        or a
        jp nz,cat_render
cat_render_ready:
        call _clrLCD
        call cat_render_header
        ; A non-root contextual header has already reopened its exact Catalog
        ; or artifact source. Only the root header ends on DSUSERS and needs
        ; to restore SCC1 before the Subject rows are read.
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr nz,cat_render_rows_source_ready
        call cat_open_array
        jp c,cat_fail_open
cat_render_rows_source_ready:
        call cat_render_rows
        call cat_render_empty
        call cat_render_rail
        call cat_render_softkeys

cat_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,cat_back
        cp SC_SCAN_LEFT
        jp z,cat_back
        cp SC_SCAN_UP
        jp z,cat_move_up
        cp SC_SCAN_DOWN
        jp z,cat_move_down
        cp SC_SCAN_RIGHT
        jp z,cat_activate
        cp SC_SCAN_ENTER
        jp z,cat_activate
        cp SC_SCAN_F1
        jp z,cat_activate
        cp SC_SCAN_F2
        jp z,cat_back
        cp SC_SCAN_F3
        jp z,cat_open_profile
        cp SC_SCAN_F4
        jp z,cat_remove
        cp SC_SCAN_F5
        jp z,cat_f5
        jp cat_wait

; Catalog-level Sync is useful at the root. Deeper list panels use the same
; physical F5 position to communicate More/EOM and page the viewport, rather
; than suggesting an unrelated transport action while the learner is reading.
cat_f5:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jp z,cat_sync
        call cat_has_pages
        or a
        jp z,cat_wait
        jp cat_page_down

; The Catalog owns the normal learning loop. Its USER softkey opens the
; selected learner's profile in-place, then returns here at the Subject root
; on EXIT. SCPROF remains the sole authority for selection and switch locks.
cat_open_profile:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jp nz,cat_wait
        ld a,12                    ; PROFILE_VIEW_USER
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,cat_fail_save
        ld hl,cat_scprof_name
        rst 0x20
        rst 0x10
        jp c,cat_fail_profile
        call _exec_assembly
        call sc_input_wait_release
        call scstate_load
        jp c,cat_fail_state_load
        ; A My Progress follow-up may deliberately hand control to the shell's
        ; Tutor runtime. Do not reinterpret that explicit route as a broken
        ; Catalog view merely because the Profile was opened from this child.
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp 11                    ; PROFILE_VIEW_TUTOR
        ret z
        call cat_normalize_view
        jp c,cat_fail_state_view
        jp cat_render
cat_fail_profile:
        ld a,CAT_VIEW_SUBJECT
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,cat_fail_save
        jp cat_render

cat_normalize_view:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_CATALOG
        jr z,cat_normalize_catalog_route
        cp CAT_VIEW_SUBJECT
        ret z
        cp CAT_VIEW_COURSE
        ret z
        cp CAT_VIEW_UNIT
        ret z
        cp CAT_VIEW_LESSON
        ret z
        cp CAT_VIEW_MODULE
        ret z
cat_normalize_catalog_route:
        ld a,CAT_VIEW_SUBJECT
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET),a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET + 1),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        ; SCPROF persists this coarse route after SELECT. Commit its precise
        ; Subject form first, then acknowledge the learner-scoped handoff
        ; before the first Catalog list paints.
        call scstate_save
        ret c
        call cat_transition
        ret

cat_move_down:
        ld a,(cat_focus)
        ld (cat_previous_focus),a
        ld a,(cat_scroll)
        ld (cat_previous_scroll),a
        ld a,(cat_focus)
        inc a
        ld b,a
        ld a,(cat_count)
        cp b
        jp c,cat_wait
        jp z,cat_wait
        ld a,b
        ld (cat_focus),a
        ld b,a
        ld a,(cat_scroll)
        add a,CAT_VISIBLE_ROWS
        cp b
        jr nz,cat_move_save
        ld a,(cat_scroll)
        inc a
        ld (cat_scroll),a
        jr cat_move_save

cat_move_up:
        ld a,(cat_focus)
        or a
        jp z,cat_wait
        ld (cat_previous_focus),a
        ld a,(cat_scroll)
        ld (cat_previous_scroll),a
        ld a,(cat_focus)
        dec a
        ld (cat_focus),a
        ld b,a
        ld a,(cat_scroll)
        cp b
        jr c,cat_move_save
        jr z,cat_move_save
        ld a,b
        ld (cat_scroll),a

cat_move_save:
        call cat_store_focus
        call scstate_save
        jp c,cat_fail_save
        ; A move inside the existing viewport is deliberately surgical: only
        ; the old and new chevrons change.  Reopening SCC1 and clearing the
        ; whole list body here made a simple Subject-list move visibly flash.
        ; The state transaction cannot affect the framebuffer or these fixed
        ; coordinates.  A scroll boundary is the one case that needs rows and
        ; rail redrawn, because their content/positions change.
        ld a,(cat_previous_scroll)
        ld b,a
        ld a,(cat_scroll)
        cp b
        jr nz,cat_move_redraw_body
        call cat_render_selection_delta
        jp cat_wait

cat_move_redraw_body:
        ; Saving SCL1 may relocate Catalog Strings, so reopen the array before
        ; rebuilding a viewport whose rows have changed.  Header and softkeys
        ; remain untouched even on this boundary redraw.
        call cat_open_array
        jp c,cat_fail_open
        call ui_mode_clear
        ld b,0
        ld c,9
        ld d,128
        ld e,46
        call ui_fill_rect
        call ui_mode_set
        call ui_select_compact
        call cat_render_rows
        call cat_render_empty
        call cat_render_rail
        jp cat_wait

; Advance a deep Catalog panel by one viewport in one durable transaction.
; Keep the final selected item at the bottom of its refreshed viewport; this
; makes F5/MORE predictable while the arrow-key path remains cursor-only.
cat_page_down:
        ld a,(cat_focus)
        ld (cat_previous_focus),a
        ld a,(cat_scroll)
        ld (cat_previous_scroll),a
        ld b,CAT_VISIBLE_ROWS
cat_page_down_step:
        ld a,(cat_focus)
        inc a
        ld c,a
        ld a,(cat_count)
        cp c
        jr c,cat_page_down_finish
        jr z,cat_page_down_finish
        ld a,c
        ld (cat_focus),a
        djnz cat_page_down_step
cat_page_down_finish:
        ld a,(cat_previous_focus)
        ld b,a
        ld a,(cat_focus)
        cp b
        jp z,cat_wait
        ld a,(cat_focus)
        cp CAT_VISIBLE_ROWS
        jr c,cat_page_down_top_viewport
        sub CAT_VISIBLE_ROWS - 1
        ld (cat_scroll),a
        jp cat_move_save
cat_page_down_top_viewport:
        xor a
        ld (cat_scroll),a
        jp cat_move_save

cat_activate:
        ld a,(cat_count)
        or a
        jp z,cat_wait
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr z,cat_enter_subject
        cp CAT_VIEW_COURSE
        jr z,cat_enter_course
        cp CAT_VIEW_UNIT
        jr z,cat_enter_unit
        cp CAT_VIEW_LESSON
        jp z,cat_enter_lesson
        cp CAT_VIEW_MODULE
        jp z,cat_enter_module
        jp cat_wait

cat_enter_subject:
        ld hl,SCSTATE_SUBJECT_INDEX_OFFSET
        ld a,CAT_VIEW_COURSE
        jr cat_enter_level
cat_enter_course:
        ld hl,SCSTATE_COURSE_INDEX_OFFSET
        ld a,CAT_VIEW_UNIT
        jr cat_enter_level
cat_enter_unit:
        ld hl,SCSTATE_UNIT_INDEX_OFFSET
        ld a,CAT_VIEW_LESSON
cat_enter_level:
        ; Resolve a whole one-option chain before doing one transition/state
        ; write. Rendering and committing each empty structural panel makes
        ; an otherwise instant Subject→Lesson trip feel broken on hardware.
        ; Put the acknowledgement on the LCD before the first child-record
        ; lookup: a long auto-collapse must never look like a dropped ENTER.
        ; cat_transition uses HL for its loading label. Preserve both inputs:
        ; A is the next view and HL is the state offset for the parent the
        ; learner actually selected. Losing HL here silently persisted through
        ; subject zero after any animated forward transition.
        push af
        push hl
        call cat_transition
        ld a,1
        ld (cat_transition_seen),a
        pop hl
        pop af
        call cat_apply_enter_level
        jp cat_render

; HL = persistent parent-index offset, A = next view. Mutates only RAM; the
; outer fast-forward settles the route and commits it once.
cat_apply_enter_level:
        push af
        ld de,scstate_record
        add hl,de
        ld a,(cat_focus)
        ld (hl),a
        inc hl
        xor a
        ld (hl),a
        pop af
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET),a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET + 1),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        ; Auto-collapse is deliberately armed only by a forward action.  A
        ; Back render must retain the single-item parent as useful context.
        ld a,1
        ld (cat_auto_advance_pending),a
        ret

; Subject→Course, Course→Unit, Unit→Lesson, and Lesson→Module all save their
; new path through this one compact local-transition boundary.
cat_transition_render:
        call cat_transition
        call scstate_save
        jp c,cat_fail_save
        jp cat_render

cat_enter_lesson:
        call cat_current_item
        jp c,cat_fail_open
        ld (cat_item_offset),de
        call cat_item_authorized
        jp c,cat_fail_open
        or a
        jp z,cat_notice_unavailable
        call cat_lesson_state
        jp c,cat_fail_open
        cp 1
        jr z,cat_open_installed_lesson
        cp 2
        jp z,cat_stage_install
        cp 3
        jp z,cat_notice_requested
        cp 4
        jp z,cat_stage_update
        jp cat_show_incompatible

cat_notice_unavailable:
        ld hl,cat_unavailable_text
        jp cat_notice

cat_open_installed_lesson:
        call cat_apply_open_installed_lesson
        jp c,cat_fail_artifact
        jp cat_transition_render

; Select an installed Lesson's immutable artifact and initialize its first
; Module view without doing I/O. Used by direct open and chain fast-forward.
cat_apply_open_installed_lesson:
        call cat_capture_lesson_artifact
        ret c
        call cat_store_lesson_selection
        ld a,CAT_VIEW_MODULE
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_MODULE_INDEX_OFFSET),a
        ld (scstate_record + SCSTATE_MODULE_INDEX_OFFSET + 1),a
        ld (scstate_record + SCSTATE_ITEM_INDEX_OFFSET),a
        ld (scstate_record + SCSTATE_ITEM_INDEX_OFFSET + 1),a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET),a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET + 1),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        call cat_clear_learning_session
        ret

; ---------------------------------------------------------------------------
; Forward-only singleton collapse
;
; SCC1 is a generic hierarchy, but real starter content often has one Course,
; Unit, and Lesson beneath a selected Subject. Requiring ENTER on each empty
; intermediate list is slow and does not add a learner choice. Collapse only
; after a deliberate forward activation. A one-option Module panel is also
; opened immediately; a multi-option panel remains the explicit activity
; choice and status surface.
;
; Returns A=1 after one in-RAM forward step, A=0 when the route has reached a
; meaningful choice. The settled path performs exactly one transition and
; state write; carry cannot escape this helper because failures render their
; explicit state/error surface directly.
cat_auto_advance_singleton:
        ld a,(cat_auto_advance_pending)
        or a
        jr nz,cat_auto_pending
        xor a
        ret
cat_auto_pending:
        ld a,(cat_count)
        cp 1
        jr z,cat_auto_singleton
        jp cat_auto_finish
cat_auto_singleton:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_COURSE
        jr z,cat_auto_enter_unit
        cp CAT_VIEW_UNIT
        jr z,cat_auto_enter_lesson
        cp CAT_VIEW_LESSON
        jr z,cat_auto_open_lesson
        cp CAT_VIEW_MODULE
        jr z,cat_auto_open_module
        jp cat_auto_finish

cat_auto_enter_unit:
        ld hl,SCSTATE_COURSE_INDEX_OFFSET
        ld a,CAT_VIEW_UNIT
        jr cat_auto_enter_level
cat_auto_enter_lesson:
        ld hl,SCSTATE_UNIT_INDEX_OFFSET
        ld a,CAT_VIEW_LESSON
cat_auto_enter_level:
        call cat_apply_enter_level
        ld a,1
        ret

cat_auto_open_lesson:
        ; Do not silently pass an unavailable, requested, update, or
        ; incompatible lesson. Its status is the information the learner
        ; needs, so leave that single Lesson row on screen.
        call cat_current_item
        ret c
        ld (cat_item_offset),de
        call cat_item_authorized
        ret c
        or a
        jr z,cat_auto_stop
        call cat_lesson_state
        ret c
        cp 1
        jr nz,cat_auto_stop
        ; Installed is the only safe automatic forward state. Capture its
        ; immutable artifact, then continue resolving before one final save.
        call cat_apply_open_installed_lesson
        ret c
        ld a,1
        ret
cat_auto_open_module:
        ; A one-option activity is a structural dead end, not a meaningful
        ; learner choice. Use the same persisted MODULE route as explicit
        ; OPEN so the shell retains its runtime verification boundary.
        call cat_auto_finish
        ld a,2
        ret
cat_auto_stop:
cat_auto_finish:
        xor a
        ld (cat_auto_advance_pending),a
        ld a,(cat_transition_seen)
        or a
        jr nz,cat_auto_finish_transition_seen
        call cat_transition
cat_auto_finish_transition_seen:
        xor a
        ld (cat_transition_seen),a
        call scstate_save
        jp c,cat_fail_save
        ret

cat_stage_install:
        ld a,CAT_ACTION_INSTALL
        jr cat_stage_action
cat_stage_update:
        call cat_capture_lesson_artifact
        jp c,cat_fail_artifact
        ld a,CAT_ACTION_UPDATE
cat_stage_action:
        ld (cat_pending_action),a
        call cat_store_lesson_selection
        call cat_mark_delivery_pending
        jp c,cat_fail_save
        call cat_run_request_maintenance
        jp c,cat_fail_request
        jp cat_render

cat_notice_requested:
        ld hl,cat_requested_text
        jp cat_notice

; Incompatible lessons are deliberately non-actionable. Display every
; adapter-supplied reason without ever entering install/update request code.
cat_show_incompatible:
        ld de,(cat_item_offset)
        ld hl,cat_key_reasons
        call sc_map_find_literal
        jr c,cat_incompatible_fallback
        ld (cat_reason_array_offset),de
        call sc_record_read_byte
        jr c,cat_incompatible_fallback
        cp SC_TAG_ARRAY
        jr nz,cat_incompatible_fallback
        inc de
        call sc_record_read_byte
        jr c,cat_incompatible_fallback
        or a
        jr z,cat_incompatible_fallback
        ld (cat_reason_count),a
        inc de
        call sc_record_read_byte
        jr c,cat_incompatible_fallback
        or a
        jr nz,cat_incompatible_fallback
        xor a
        ld (cat_reason_index),a
        jp cat_render_incompatible
cat_incompatible_fallback:
        ld hl,cat_incompatible_text
        jp cat_notice

cat_render_incompatible:
        ld de,(cat_reason_array_offset)
        ld a,(cat_reason_index)
        ld l,a
        ld h,0
        call sc_array_item
        jp c,cat_fail_open
        call sc_copy_node_string
        jp c,cat_fail_open
        ld (cat_reason_text),hl
        call _clrLCD
        call cat_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,cat_incompatible_title
        ld b,3
        ld c,11
        call ui_draw_text
        ld hl,(cat_reason_text)
        ld b,3
        ld c,19
        ld d,123
        ld e,46
        call ui_draw_wrapped_text
        ld hl,cat_reason_return
        ld b,3
        ld c,50
        ld d,123
        call ui_draw_text_clipped
        call cat_render_reason_rail
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
cat_incompatible_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        jp z,cat_render
        cp SC_SCAN_LEFT
        jp z,cat_render
        cp SC_SCAN_ENTER
        jp z,cat_render
        cp SC_SCAN_UP
        jr z,cat_reason_up
        cp SC_SCAN_DOWN
        jr nz,cat_incompatible_wait
        ld a,(cat_reason_index)
        inc a
        ld b,a
        ld a,(cat_reason_count)
        cp b
        jr c,cat_incompatible_wait
        jr z,cat_incompatible_wait
        ld a,b
        ld (cat_reason_index),a
        jp cat_render_incompatible
cat_reason_up:
        ld a,(cat_reason_index)
        or a
        jr z,cat_incompatible_wait
        dec a
        ld (cat_reason_index),a
        jp cat_render_incompatible

cat_render_reason_rail:
        ld a,(cat_reason_count)
        cp 2
        ret c
        call ui_mode_set
        ld b,127
        ld c,10
        ld d,1
        ld e,37
        call ui_fill_rect
        ld a,(cat_reason_index)
        cp 34
        jr c,cat_reason_rail_position_ready
        ld a,34
cat_reason_rail_position_ready:
        add a,11
        ld c,a
        call ui_mode_clear
        ld b,126
        ld d,2
        ld e,3
        call ui_fill_rect
        jp ui_mode_set

cat_remove:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_LESSON
        jp nz,cat_wait
        ; Never delete a pack on one F-key press. First show its exact title
        ; and a visible Cancel path; only a confirmed relay request can
        ; subsequently remove it.
        call cat_current_item
        jp c,cat_fail_open
        ld (cat_item_offset),de
        jp cat_render_remove_confirm

cat_render_remove_confirm:
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,cat_soft_remove
        ld b,1
        ld c,1
        call ui_draw_text
        call ui_mode_set
        ; Select the face before resolving the record text: ui_select_compact
        ; uses HL for its glyph-table pointer, whereas the reader returns the
        ; copied title in HL.
        call ui_select_compact
        ; Resolve the title from the Lesson record after the header paint.
        call cat_open_array
        jp c,cat_fail_open
        ld de,(cat_item_offset)
        ld hl,cat_key_title
        call sc_map_find_literal
        jp c,cat_fail_open
        call sc_copy_node_string
        jp c,cat_fail_open
        ld b,2
        ld c,17
        ld d,124
        call ui_draw_text_clipped
        ld hl,cat_remove_question
        ld b,2
        ld c,33
        call ui_draw_text
        call ui_mode_set
        ld b,0
        ld c,55
        ld d,128
        ld e,1
        call ui_fill_rect
        ld b,0
        ld c,56
        ld d,38
        ld e,8
        call ui_fill_rect
        ld b,96
        ld c,56
        ld d,32
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,cat_soft_cancel
        ld b,2
        ld c,57
        call ui_draw_text
        ld hl,cat_soft_request
        ld b,100
        ld c,57
        call ui_draw_text
        call ui_mode_set
cat_remove_confirm_wait:
        call sc_input_wait
        cp SC_SCAN_F1
        jp z,cat_render
        cp SC_SCAN_F2
        jp z,cat_render
        cp SC_SCAN_LEFT
        jp z,cat_render
        cp SC_SCAN_EXIT
        jp z,cat_render
        cp SC_SCAN_F5
        jr nz,cat_remove_confirm_wait
        ; This queues a durable REMOVE request. It does not erase the pack;
        ; the relay confirms and performs deletion when transport is present.
        call cat_capture_lesson_artifact
        jp c,cat_fail_artifact
        ld a,CAT_ACTION_REMOVE
        jp cat_stage_action

cat_enter_module:
        ld a,(cat_focus)
        ld (scstate_record + SCSTATE_MODULE_INDEX_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_MODULE_INDEX_OFFSET + 1),a
        ld (scstate_record + SCSTATE_ITEM_INDEX_OFFSET),a
        ld (scstate_record + SCSTATE_ITEM_INDEX_OFFSET + 1),a
        call cat_clear_learning_session
        call cat_store_focus
        call cat_transition
        call scstate_save
        jp c,cat_fail_save
        ret

cat_back:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        ret z
        cp CAT_VIEW_COURSE
        jr z,cat_back_to_subject
        cp CAT_VIEW_UNIT
        jr z,cat_back_to_course
        cp CAT_VIEW_LESSON
        jr z,cat_back_to_unit
        cp CAT_VIEW_MODULE
        jr z,cat_back_to_lesson
        ret
cat_back_to_subject:
        ld a,(scstate_record + SCSTATE_SUBJECT_INDEX_OFFSET)
        ld b,CAT_VIEW_SUBJECT
        jr cat_back_store
cat_back_to_course:
        ld a,(scstate_record + SCSTATE_COURSE_INDEX_OFFSET)
        ld b,CAT_VIEW_COURSE
        jr cat_back_store
cat_back_to_unit:
        ld a,(scstate_record + SCSTATE_UNIT_INDEX_OFFSET)
        ld b,CAT_VIEW_UNIT
        jr cat_back_store
cat_back_to_lesson:
        ld a,(scstate_record + SCSTATE_LESSON_INDEX_OFFSET)
        ld b,CAT_VIEW_LESSON
cat_back_store:
        ld (scstate_record + SCSTATE_FOCUS_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET + 1),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        ld a,b
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,cat_fail_save
        jp cat_render

cat_sync:
        ld a,CAT_VIEW_SYNC
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        jp c,cat_fail_save
        ret

cat_store_focus:
        ld a,(cat_focus)
        ld (scstate_record + SCSTATE_FOCUS_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_FOCUS_OFFSET + 1),a
        ld a,(cat_scroll)
        ld (scstate_record + SCSTATE_SCROLL_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_SCROLL_OFFSET + 1),a
        ret

cat_store_lesson_selection:
        ld a,(cat_focus)
        ld (scstate_record + SCSTATE_LESSON_INDEX_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_LESSON_INDEX_OFFSET + 1),a
        ret

cat_clear_learning_session:
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        and 0xE0
        ld (scstate_record + SCSTATE_FLAGS_OFFSET),a
        xor a
        ld (scstate_record + SCSTATE_DRAFT_KIND_OFFSET),a
        ld (scstate_record + SCSTATE_DRAFT_LENGTH_OFFSET),a
        ld (scstate_record + SCSTATE_SESSION_LEARNER_OFFSET),a
        ld (scstate_record + SCSTATE_SESSION_LEARNER_OFFSET + 1),a
        ret

cat_mark_delivery_pending:
        call cat_clear_learning_session
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        or SCSTATE_FLAG_DELIVERY_PENDING_HIGH
        ld (scstate_record + SCSTATE_FLAGS_OFFSET + 1),a
        ld a,(cat_pending_action)
        ld (scstate_record + SCSTATE_DELIVERY_ACTION_OFFSET),a
        ld a,CAT_VIEW_DELIVERY
        ld (scstate_record + SCSTATE_VIEW_OFFSET),a
        call scstate_save
        ret

; Run SCREQ for acknowledgement cleanup and, when present, the pending action.
cat_run_request_maintenance:
        ; Do not cross the executable boundary during ordinary Catalog startup.
        ; SCREQ is required only for an explicit durable delivery continuation;
        ; launching it unconditionally caused Catalog to disappear before its
        ; first frame on physical hardware.
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and SCSTATE_FLAG_DELIVERY_PENDING_HIGH
        ret z
        ld hl,cat_screq_name
        rst 0x20
        rst 0x10
        jr c,cat_request_missing
        call _exec_assembly
        call scstate_load
        ret c
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and SCSTATE_FLAG_DELIVERY_PENDING_HIGH
        jr nz,cat_request_fail
        or a
        ret
cat_request_missing:
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET + 1)
        and SCSTATE_FLAG_DELIVERY_PENDING_HIGH
        ret z
cat_request_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Catalog and artifact navigation

cat_open_array:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        jp z,cat_open_module_array
        call cat_open_catalog
        ret c
        ld de,(sc_record_root_offset)
        ld hl,cat_key_catalogs
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        ; SCC1 is a device snapshot, not a calculator-side Catalog chooser.
        ; The adapter admits exactly one Catalog. Resolve its wrapper now and
        ; present Subjects as the root panel.
        call cat_read_raw_count
        ret c
        ld a,(cat_raw_count)
        cp 1
        jp nz,cat_open_fail
        ld de,(cat_array_offset)
        ld hl,0
        call sc_array_item
        ret c
        ; Authorization walks the nested access map and advances DE. Keep the
        ; one assigned Catalog node intact so the next lookup enters its
        ; `subjects` array rather than searching inside `access`.
        push de
        call cat_item_authorized
        pop de
        jp c,cat_open_fail
        or a
        jp z,cat_open_fail
        ld hl,cat_key_subjects
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jp z,cat_capture_array_count

        ld hl,(scstate_record + SCSTATE_SUBJECT_INDEX_OFFSET)
        call cat_visible_array_item
        ret c
        ; The header names the parent content, never just the structural
        ; list.  Keep this resolved node while opening its child array.
        ld (cat_context_offset),de
        ld hl,cat_key_courses
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_COURSE
        jp z,cat_capture_array_count

        ld hl,(scstate_record + SCSTATE_COURSE_INDEX_OFFSET)
        call cat_visible_array_item
        ret c
        ld (cat_context_offset),de
        ld hl,cat_key_units
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_UNIT
        jp z,cat_capture_array_count

        ld hl,(scstate_record + SCSTATE_UNIT_INDEX_OFFSET)
        call cat_visible_array_item
        ret c
        ld (cat_context_offset),de
        ld hl,cat_key_lessons
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        jp cat_capture_array_count

cat_open_catalog:
        ; SCL1 compact keys are fixed-width, not terminated.  The typed
        ; document matcher uses zero-terminated literals, so do not let the
        ; selected learner bytes become a bogus eleventh key character.
        call cat_prepare_catalog_key
        ld a,(scstate_record + SCSTATE_FLAGS_OFFSET)
        bit 7,a
        jr z,cat_open_catalog_no_snapshot
        bit 5,a
        ld hl,cat_dscat0_name
        jr z,cat_catalog_slot_ready
        ld hl,cat_dscat1_name
cat_catalog_slot_ready:
        ld de,cat_scc1_magic
        call sc_record_open
        jr c,cat_open_catalog_record_failed
        ld de,(sc_record_root_offset)
        ld hl,cat_key_schema
        call sc_map_find_literal
        jr c,cat_open_catalog_schema_missing
        ld hl,cat_catalog_schema
        call sc_node_string_equals_literal
        jr c,cat_open_catalog_schema_missing
        or a
        jr z,cat_open_catalog_schema_mismatch
        ld de,(sc_record_root_offset)
        ld hl,cat_key_generation_key
        call sc_map_find_literal
        jr c,cat_open_catalog_generation_missing
        ld hl,cat_catalog_key
        call sc_node_string_equals_literal
        jr c,cat_open_catalog_generation_missing
        or a
        jr z,cat_open_catalog_generation_mismatch
        or a
        ret
cat_prepare_catalog_key:
        ld hl,scstate_record + SCSTATE_CATALOG_KEY_OFFSET
        ld de,cat_catalog_key
        ld bc,10
        ldir
        xor a
        ld (de),a
        ret
cat_open_catalog_no_snapshot:
        ld a,1
        jr cat_open_catalog_failed
cat_open_catalog_record_failed:
        ld a,2
        jr cat_open_catalog_failed
cat_open_catalog_schema_missing:
        ld a,3
        jr cat_open_catalog_failed
cat_open_catalog_schema_mismatch:
        ld a,4
        jr cat_open_catalog_failed
cat_open_catalog_generation_missing:
        ld a,5
        jr cat_open_catalog_failed
cat_open_catalog_generation_mismatch:
        ld a,6
cat_open_catalog_failed:
        ld (cat_catalog_failure),a
        scf
        ret
cat_open_fail:
        scf
        ret

cat_open_module_array:
        call cat_build_artifact_descriptor
        ret c
        ld hl,cat_artifact_name
        ld de,cat_scp1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,cat_key_schema
        call sc_map_find_literal
        ret c
        ld hl,cat_package_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,cat_open_fail
        ld de,(sc_record_root_offset)
        ld hl,cat_key_artifact_id
        call sc_map_find_literal
        ret c
        ld hl,cat_artifact_id
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,cat_open_fail
        ld de,(sc_record_root_offset)
        ld hl,cat_key_lesson
        call sc_map_find_literal
        ret c
        ; A module list belongs to its artifact's lesson, not an anonymous
        ; runtime.  Retain this node for the sticky context header.
        ld (cat_context_offset),de
        ld hl,cat_key_modules
        call sc_map_find_literal
        ret c
        ld (cat_array_offset),de
        jp cat_capture_array_count

cat_build_artifact_descriptor:
        ld hl,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld de,cat_artifact_id + 8
        ld b,10
cat_build_key_loop:
        ld a,(hl)
        ld c,a
        call cat_validate_key_character
        ret c
        ld a,c
        ld (de),a
        inc hl
        inc de
        djnz cat_build_key_loop
        ld hl,cat_artifact_id + 8
        ld de,cat_artifact_name + 4
        ld bc,6
        ldir
        or a
        ret

cat_capture_array_count:
        call cat_read_raw_count
        ret c
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        jr nz,cat_capture_visible_count
        ld a,(cat_raw_count)
        ld (cat_count),a
        or a
        jp z,cat_open_fail
        ret

cat_read_raw_count:
        ld de,(cat_array_offset)
        call sc_record_read_byte
        ret c
        cp SC_TAG_ARRAY
        jp nz,cat_open_fail
        inc de
        call sc_record_read_byte
        ret c
        ld (cat_raw_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp nz,cat_open_fail
        ret

cat_capture_visible_count:
        xor a
        ld (cat_visible_count),a
        ld (cat_scan_index),a
cat_count_visible_loop:
        ld a,(cat_scan_index)
        ld b,a
        ld a,(cat_raw_count)
        cp b
        jr z,cat_count_visible_done
        jp c,cat_open_fail
        ld de,(cat_array_offset)
        ld a,(cat_scan_index)
        ld l,a
        ld h,0
        call sc_array_item
        jp c,cat_open_fail
        call cat_item_authorized
        jp c,cat_open_fail
        or a
        jr z,cat_count_visible_next
        ld a,(cat_visible_count)
        inc a
        ld (cat_visible_count),a
cat_count_visible_next:
        ld a,(cat_scan_index)
        inc a
        ld (cat_scan_index),a
        jr cat_count_visible_loop
cat_count_visible_done:
        ld a,(cat_visible_count)
        ld (cat_count),a
        or a
        ret

; HL = profile-visible item index in cat_array_offset. Returns the raw item
; node in DE. Catalog hierarchy indexes remain profile-visible in SCL1, so
; Back and restart retain the same selection while a profile is unchanged.
cat_visible_array_item:
        ld a,h
        or a
        jr nz,cat_visible_item_fail
        ld a,l
        ld (cat_visible_target),a
        call cat_read_raw_count
        jr c,cat_visible_item_fail
        xor a
        ld (cat_scan_index),a
cat_visible_item_loop:
        ld a,(cat_scan_index)
        ld b,a
        ld a,(cat_raw_count)
        cp b
        jr z,cat_visible_item_fail
        jr c,cat_visible_item_fail
        ld de,(cat_array_offset)
        ld a,(cat_scan_index)
        ld l,a
        ld h,0
        call sc_array_item
        jr c,cat_visible_item_fail
        push de
        call cat_item_authorized
        pop de
        jr c,cat_visible_item_fail
        or a
        jr z,cat_visible_item_next
        ld a,(cat_visible_target)
        or a
        ret z
        dec a
        ld (cat_visible_target),a
cat_visible_item_next:
        ld a,(cat_scan_index)
        inc a
        ld (cat_scan_index),a
        jr cat_visible_item_loop
cat_visible_item_fail:
        scf
        ret

; DE = Catalog/Subject/Course/Unit/Lesson map. Access is a required server
; projection. Return A=1 when selectedLearnerKey is present, or Guest is true;
; A=0 when hidden; carry means malformed and fails the Catalog closed.
cat_item_authorized:
        ld hl,cat_key_access
        call sc_map_find_literal
        ret c
        ld (cat_access_offset),de
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jr nz,cat_access_learner
        ld de,(cat_access_offset)
        ld hl,cat_key_guest
        call sc_map_find_literal
        ret c
        call sc_record_read_byte
        ret c
        cp SC_TAG_TRUE
        jr z,cat_access_yes
        cp SC_TAG_FALSE
        jr z,cat_access_no
        scf
        ret

cat_access_learner:
        ld de,(cat_access_offset)
        ld hl,cat_key_learner_keys
        call sc_map_find_literal
        ret c
        call sc_record_read_byte
        ret c
        cp SC_TAG_ARRAY
        jr nz,cat_access_invalid
        inc de
        call sc_record_read_byte
        ret c
        ld (cat_access_remaining),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr nz,cat_access_invalid
        inc de
cat_access_key_loop:
        ld a,(cat_access_remaining)
        or a
        jr z,cat_access_no
        call sc_record_read_byte
        ret c
        cp SC_TAG_INT32
        jr nz,cat_access_invalid
        inc de
        call sc_record_read_byte
        ret c
        ld (cat_access_key_low),a
        inc de
        call sc_record_read_byte
        ret c
        ld (cat_access_key_high),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr nz,cat_access_invalid
        inc de
        call sc_record_read_byte
        ret c
        or a
        jr nz,cat_access_invalid
        inc de
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,(cat_access_key_low)
        cp l
        jr nz,cat_access_key_next
        ld a,(cat_access_key_high)
        cp h
        jr z,cat_access_yes
cat_access_key_next:
        ld a,(cat_access_remaining)
        dec a
        ld (cat_access_remaining),a
        jr cat_access_key_loop

cat_access_yes:
        ld a,1
        or a
        ret
cat_access_no:
        xor a
        ret
cat_access_invalid:
        scf
        ret

cat_normalize_focus:
        ld a,(scstate_record + SCSTATE_FOCUS_OFFSET + 1)
        or a
        jr nz,cat_focus_reset
        ld a,(scstate_record + SCSTATE_FOCUS_OFFSET)
        ld b,a
        ld a,(cat_count)
        cp b
        jr c,cat_focus_reset
        jr z,cat_focus_reset
        ld a,b
        ld (cat_focus),a
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET + 1)
        or a
        jr nz,cat_scroll_reset
        ld a,(scstate_record + SCSTATE_SCROLL_OFFSET)
        ld (cat_scroll),a
        ld b,a
        ld a,(cat_focus)
        cp b
        jr c,cat_scroll_reset
        ld a,b
        add a,CAT_VISIBLE_ROWS
        ld b,a
        ld a,(cat_focus)
        cp b
        jr nc,cat_scroll_follow_focus
        or a
        ret
cat_scroll_follow_focus:
        sub CAT_VISIBLE_ROWS - 1
        ld (cat_scroll),a
        jr cat_focus_store_normalized
cat_scroll_reset:
        xor a
        ld (cat_scroll),a
        jr cat_focus_store_normalized
cat_focus_reset:
        xor a
        ld (cat_focus),a
        ld (cat_scroll),a
        ; An empty, access-filtered Catalog already has the canonical focus.
        ; Do not create a needless state transaction just to persist zero.
        ld a,(cat_count)
        or a
        ret z
cat_focus_store_normalized:
        ; Rendering may repair an out-of-range focus after content has been
        ; filtered for this learner.  That is transient UI state: do not make
        ; the first Catalog frame depend on an immediate SCL1 transaction.
        ; The next user navigation persists the normalized focus together
        ; with the actual action.  This keeps a valid offline Catalog usable
        ; even when its inactive recovery slot is unavailable.
        or a
        ret

cat_current_item:
        ld de,(cat_array_offset)
        ld a,(cat_focus)
        ld l,a
        ld h,0
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        jp z,sc_array_item
        jp cat_visible_array_item

; Return A: 1 installed, 2 available, 3 requested, 4 update, 5 incompatible.
cat_lesson_state:
        ld de,(cat_item_offset)
        ld hl,cat_key_state
        call sc_map_find_literal
        ret c
        ld (cat_state_offset),de
        ld hl,cat_state_installed
        call sc_node_string_equals_literal
        ret c
        or a
        jr nz,cat_state_is_installed
        ld de,(cat_state_offset)
        ld hl,cat_state_available
        call sc_node_string_equals_literal
        ret c
        or a
        jr nz,cat_state_is_available
        ld de,(cat_state_offset)
        ld hl,cat_state_requested
        call sc_node_string_equals_literal
        ret c
        or a
        jr nz,cat_state_is_requested
        ld de,(cat_state_offset)
        ld hl,cat_state_update
        call sc_node_string_equals_literal
        ret c
        or a
        jr nz,cat_state_is_update
        ld de,(cat_state_offset)
        ld hl,cat_state_incompatible
        call sc_node_string_equals_literal
        ret c
        or a
        jr z,cat_state_invalid
        ld a,5
        ret
cat_state_is_installed:
        ld a,1
        ret
cat_state_is_available:
        ld a,2
        ret
cat_state_is_requested:
        ld a,3
        ret
cat_state_is_update:
        ld a,4
        ret
cat_state_invalid:
        scf
        ret

cat_capture_lesson_artifact:
        ld de,(cat_item_offset)
        ld hl,cat_key_artifact_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,cat_artifact_prefix
        ld b,8
cat_capture_prefix_loop:
        ld a,(de)
        cp (hl)
        jr nz,cat_capture_fail
        inc de
        inc hl
        djnz cat_capture_prefix_loop
        ld de,scstate_record + SCSTATE_ARTIFACT_KEY_OFFSET
        ld b,10
cat_capture_key_loop:
        ld a,(hl)
        or a
        jr z,cat_capture_fail
        ld c,a
        call cat_validate_key_character
        jr c,cat_capture_fail
        ld a,c
        ld (de),a
        inc hl
        inc de
        djnz cat_capture_key_loop
        ld a,(hl)
        or a
        jr nz,cat_capture_fail
        ret
cat_capture_fail:
        scf
        ret

cat_validate_key_character:
        cp '2'
        jr c,cat_key_alpha
        cp '7' + 1
        jr c,cat_key_ok
cat_key_alpha:
        cp 'A'
        jr c,cat_key_fail
        cp 'Z' + 1
        jr nc,cat_key_fail
cat_key_ok:
        or a
        ret
cat_key_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Full-canvas list renderer

; A short local transition separates a full repaint from a hard cut without
; claiming that hierarchy navigation is downloading data.  Its destination
; header and .→..→... pulse are merely an immediate UI acknowledgement.  The
; pause yields to the OS instead of busy-waiting or accepting stray input.
cat_transition:
        call _clrLCD
        call ui_mode_set
        call ui_select_compact
        ld hl,cat_loading_label
        ; The title is centered independently; its loader lives on a second
        ; centered line so animation never makes the word appear to drift.
        ld bc,0x3818
        call ui_draw_text
        ; Four equally spaced positions form a bounded, non-trailing pulse.
        ; Each dot is erased before the next one appears, avoiding the old
        ; Pac-Man-like growing trail while still acknowledging local work.
        ld bc,0x3A22
cat_transition_pulse:
        push bc
        push bc
        ld a,'.'
        call ui_draw_glyph
        ld b,24
cat_transition_pulse_wait:
        call _idle
        djnz cat_transition_pulse_wait
        pop bc
        call ui_mode_clear
        ld a,'.'
        call ui_draw_glyph
        call ui_mode_set
        pop bc
        inc b
        inc b
        inc b
        inc b
        ld a,b
        cp 74
        jr nz,cat_transition_pulse
        ret

cat_render_header:
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ; Resolve the learner label first. The record reader shares one text
        ; scratch buffer, so a subsequent context title lookup must be the
        ; final reader call before drawing the breadcrumb.
        call cat_copy_selected_label
        jr c,cat_header_user_fallback
        jr cat_header_user_ready
cat_header_user_fallback:
        ld hl,cat_user_label
cat_header_user_ready:
        push hl
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr z,cat_header_root
        ; The one header line is a content breadcrumb.  "MODULES" or
        ; "LESSONS" says only how the list is shaped; its containing title
        ; tells a learner what the choices are actually about.
        call cat_copy_context_title
        jr c,cat_header_root
        ld b,1
        ld c,1
        ld d,98
        call ui_draw_text_clipped
        jr cat_header_context_ready
cat_header_root:
        ld hl,cat_header_subjects
        ld b,1
        ld c,1
        call ui_draw_text
cat_header_context_ready:
        ; The Catalog is learner scoped. Make that ownership visible in the
        ; shared inverse header without consuming a seventh list row.
        pop hl
        ld d,124
        ld c,1
        call ui_draw_text_right
        jp ui_mode_set

; The immediately containing Subject/Course/Unit/Lesson is the usable
; one-line breadcrumb for the Catalog's current child list. The offset was
; resolved through the exact learner-filtered path in cat_open_array.
; Returns HL = stable record-reader text or carry for a root/invalid context.
cat_copy_context_title:
        ; cat_copy_selected_label opens DSUSERS, whose record-reader root
        ; cannot interpret this Catalog/artifact offset. Reopen the source
        ; before dereferencing the persisted context node.
        call cat_open_array
        ret c
        ld de,(cat_context_offset)
        ld a,d
        or e
        jr nz,cat_context_offset_ready
        scf
        ret
cat_context_offset_ready:
        ; Authored short titles are the compact breadcrumb contract. A content
        ; pack that omits one remains compatible and uses its full title.
        ld hl,cat_key_short_title
        call sc_map_find_literal
        jr nc,cat_context_title_found
        ld de,(cat_context_offset)
        ld hl,cat_key_title
        call sc_map_find_literal
        ret c
cat_context_title_found:
        jp sc_copy_node_string

; Return HL = the configured selected learner label in a local bounded buffer.
; SCU1 has a compact fixed body (device label, 10-byte generation, count,
; then key/short-label tuples), so Catalog can read decorative identity text
; without duplicating SCPROF's roster promotion or selection authority.
cat_copy_selected_label:
        ld hl,(scstate_record + SCSTATE_SELECTED_LEARNER_OFFSET)
        ld a,h
        or l
        jr nz,cat_copy_named_label
        ld hl,cat_guest_label
        or a
        ret
cat_copy_named_label:
        ld (cat_label_key),hl
        ld hl,cat_dsusers_name
        ld de,cat_scu1_magic
        call sc_envelope_open
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        inc de
        add a,e
        ld e,a
        jr nc,cat_copy_label_after_device
        inc d
cat_copy_label_after_device:
        ld hl,10
        add hl,de
        ex de,hl
        call sc_record_read_byte
        ret c
        ld b,a
        inc de
cat_copy_label_record:
        ld a,b
        or a
        jr z,cat_copy_label_fail
        call sc_record_read_byte
        ret c
        ld c,a
        inc de
        call sc_record_read_byte
        ret c
        ld h,a
        inc de
        call sc_record_read_byte
        ret c
        ld a,(cat_label_key + 1)
        cp h
        jr nz,cat_copy_label_skip
        ld a,(cat_label_key)
        cp c
        jr nz,cat_copy_label_skip
        call sc_record_read_byte
        ret c
        cp 21
        jr nc,cat_copy_label_fail
        ld c,a
        inc de
        ld hl,cat_selected_label
cat_copy_label_chars:
        ld a,c
        or a
        jr z,cat_copy_label_done
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        dec c
        jr cat_copy_label_chars
cat_copy_label_done:
        xor a
        ld (hl),a
        ld hl,cat_selected_label
        ret
cat_copy_label_skip:
        call sc_record_read_byte
        ret c
        cp 21
        jr nc,cat_copy_label_fail
        inc de
        add a,e
        ld e,a
        jr nc,cat_copy_label_next
        inc d
cat_copy_label_next:
        djnz cat_copy_label_record
cat_copy_label_fail:
        scf
        ret

cat_render_rows:
        xor a
        ld (cat_row),a
cat_row_loop:
        ld a,(cat_row)
        cp CAT_VISIBLE_ROWS
        ret z
        ld b,a
        ld a,(cat_scroll)
        add a,b
        ld (cat_row_item),a
        ld b,a
        ld a,(cat_count)
        cp b
        ret c
        ret z
        ld de,(cat_array_offset)
        ld a,(cat_row_item)
        ld l,a
        ld h,0
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        jr z,cat_render_raw_item
        call cat_visible_array_item
        jr cat_render_item_ready
cat_render_raw_item:
        call sc_array_item
cat_render_item_ready:
        ret c
        ld (cat_item_offset),de

        ld a,(cat_row)
        ld b,a
        add a,a
        add a,b
        add a,a
        add a,10
        ld (cat_row_y),a
        ld a,(cat_focus)
        ld b,a
        ld a,(cat_row_item)
        cp b
        jr nz,cat_row_marker
        ld hl,cat_chevron
        ld b,0
        ld a,(cat_row_y)
        ld c,a
        call ui_draw_text
cat_row_marker:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_LESSON
        jr nz,cat_row_title
        call cat_lesson_state
        ret c
        ld hl,cat_status_chars - 1
        ld e,a
        ld d,0
        add hl,de
        ld a,(hl)
        call ui_draw_glyph_at_row_marker
cat_row_title:
        ld de,(cat_item_offset)
        ld hl,cat_key_title
        call sc_map_find_literal
        jr nc,cat_row_title_found
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        ret nz
        ld de,(cat_item_offset)
        ld hl,cat_key_type
        call sc_map_find_literal
        ret c
cat_row_title_found:
        call sc_copy_node_string
        ret c
        ld b,10
        ld a,(cat_row_y)
        ld c,a
        ld d,124
        call ui_draw_text_clipped
        ld a,(cat_row)
        inc a
        ld (cat_row),a
        jp cat_row_loop

; Move list focus without disturbing labels, status marks, chrome, or the
; framebuffer outside the two 3×5 chevron cells.  Call only when scroll is
; unchanged, so both focus values are guaranteed to be visible row indices.
cat_render_selection_delta:
        call ui_select_compact
        call ui_mode_clear
        ld a,(cat_previous_focus)
        ld b,a
        ld a,(cat_previous_scroll)
        ld b,a
        ld a,(cat_previous_focus)
        sub b
        ; A now contains previousFocus - previousScroll.  Rows begin at y=10
        ; and use the compact font's five-pixel glyph height.
        add a,a
        ld b,a
        add a,a
        add a,b
        add a,10
        ld c,a
        ld b,0
        ld d,3
        ld e,5
        call ui_fill_rect

        call ui_mode_set
        ld a,(cat_focus)
        ld b,a
        ld a,(cat_scroll)
        ld b,a
        ld a,(cat_focus)
        sub b
        add a,a
        ld b,a
        add a,a
        add a,b
        add a,10
        ld c,a
        ld hl,cat_chevron
        ld b,0
        call ui_draw_text
        ret

cat_render_empty:
        ld a,(cat_count)
        or a
        ret nz
        call ui_mode_set
        call ui_select_compact
        ld hl,cat_empty_text
        ld b,3
        ld c,18
        call ui_draw_text
        jp ui_mode_set

; A = one marker glyph.
ui_draw_glyph_at_row_marker:
        push af
        ld b,5
        ld a,(cat_row_y)
        ld c,a
        pop af
        jp ui_draw_glyph

cat_render_rail:
        ld a,(cat_count)
        cp CAT_VISIBLE_ROWS + 1
        ret c
        call ui_mode_set
        ld b,127
        ld c,9
        ld d,1
        ld e,45
        call ui_fill_rect
        ld a,(cat_focus)
        cp 42
        jr c,cat_rail_position_ready
        ld a,42
cat_rail_position_ready:
        add a,10
        ld c,a
        call ui_mode_clear
        ld b,126
        ld d,2
        ld e,3
        call ui_fill_rect
        jp ui_mode_set

cat_render_softkeys:
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
        ld d,25
        ld e,8
        call ui_fill_rect
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr nz,cat_softkey_no_user
        ld b,51
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
cat_softkey_no_user:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_LESSON
        jr nz,cat_softkey_no_delete
        ld b,77
        ld c,56
        ; A Lesson has no F5 paging action, so F4 may use that otherwise empty
        ; rail span. This keeps REMOVE fully legible rather than clipping it.
        ld d,51
        ld e,8
        call ui_fill_rect
cat_softkey_no_delete:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr z,cat_softkey_draw_f5
        call cat_has_pages
        or a
        jr z,cat_softkey_no_f5
cat_softkey_draw_f5:
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
cat_softkey_no_f5:
        call ui_mode_clear
        call ui_select_compact
        ld hl,cat_soft_open
        ld b,4
        ld c,58
        call ui_draw_text
        ld hl,cat_soft_back
        ld b,30
        ld c,58
        call ui_draw_text
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr nz,cat_softkey_not_user
        ld hl,cat_soft_user
        ld b,55
        ld c,58
        call ui_draw_text
cat_softkey_not_user:
        cp CAT_VIEW_LESSON
        jr nz,cat_softkey_sync
        ld hl,cat_soft_remove
        ld b,82
        ld c,58
        call ui_draw_text
cat_softkey_sync:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_SUBJECT
        jr z,cat_softkey_root_sync
        call cat_has_pages
        or a
        jp z,ui_mode_set
        call cat_has_more
        ld hl,cat_soft_eom
        or a
        jr z,cat_softkey_f5_ready
        ld hl,cat_soft_more
        jr cat_softkey_f5_ready
cat_softkey_root_sync:
        ld hl,cat_soft_sync
cat_softkey_f5_ready:
        ld b,104
        ld c,58
        call ui_draw_text
        jp ui_mode_set

; Return A=1 when the current deep list has a following row, A=0 at EOM.
cat_has_more:
        ld a,(cat_focus)
        inc a
        ld b,a
        ld a,(cat_count)
        cp b
        jr c,cat_has_more_no
        jr z,cat_has_more_no
        ld a,1
        ret
cat_has_more_no:
        xor a
        ret

; F5 is a viewport affordance, not a decorative fourth action. Short lists
; already expose every choice, so leave that rail cell empty.
cat_has_pages:
        ld a,(cat_count)
        cp CAT_VISIBLE_ROWS + 1
        jr c,cat_has_pages_no
        ld a,1
        ret
cat_has_pages_no:
        xor a
        ret

cat_notice:
        ld (cat_notice_message),hl
        call _clrLCD
        call cat_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,(cat_notice_message)
        ld b,3
        ld c,20
        ld d,124
        call ui_draw_text_clipped
        ld hl,cat_notice_return
        ld b,3
        ld c,40
        call ui_draw_text
cat_notice_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        jr nz,cat_notice_wait
        jp cat_render

cat_fail_state_load:
        ld a,1
        ld (cat_state_failure),a
        jr cat_fail_state
cat_fail_state_view:
        ld a,2
        ld (cat_state_failure),a
        jr cat_fail_state
cat_fail_state_focus:
        ld a,3
        ld (cat_state_failure),a
cat_fail_state:
        ld a,CAT_ERROR_STATE
        jr cat_fail
cat_fail_open:
        ld a,(scstate_record + SCSTATE_VIEW_OFFSET)
        cp CAT_VIEW_MODULE
        jr z,cat_fail_artifact
        ld a,CAT_ERROR_CATALOG
        jr cat_fail
cat_fail_artifact:
        ld a,CAT_ERROR_ARTIFACT
        jr cat_fail
cat_fail_save:
        ld a,CAT_ERROR_SAVE
        jr cat_fail
cat_fail_request:
        ld a,CAT_ERROR_REQUEST
cat_fail:
        ld (cat_error),a
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,cat_error_header
        ld b,1
        ld c,1
        call ui_draw_text
        call ui_mode_set
        ld hl,cat_error_state_text
        ld a,(cat_error)
        cp CAT_ERROR_CATALOG
        ld hl,cat_error_catalog_text
        jr nz,cat_error_not_catalog
        ld a,(cat_catalog_failure)
        cp 1
        ld hl,cat_error_catalog_snapshot_text
        jr z,cat_error_text_ready
        cp 2
        ld hl,cat_error_catalog_record_text
        jr z,cat_error_text_ready
        cp 3
        ld hl,cat_error_catalog_schema_missing_text
        jr z,cat_error_text_ready
        cp 4
        ld hl,cat_error_catalog_schema_text
        jr z,cat_error_text_ready
        cp 5
        ld hl,cat_error_catalog_generation_missing_text
        jr z,cat_error_text_ready
        cp 6
        ld hl,cat_error_catalog_generation_text
        jr z,cat_error_text_ready
        ld hl,cat_error_catalog_text
        jr cat_error_text_ready
cat_error_not_catalog:
        ld hl,cat_error_artifact_text
        cp CAT_ERROR_ARTIFACT
        jr z,cat_error_text_ready
        ld hl,cat_error_save_text
        cp CAT_ERROR_SAVE
        jr z,cat_error_text_ready
        ld hl,cat_error_request_text
        cp CAT_ERROR_REQUEST
        jr z,cat_error_text_ready
        ld hl,cat_error_state_text
        ld a,(cat_state_failure)
        cp 1
        jr nz,cat_error_state_stage_two
        ld a,(scstate_failure)
        cp 1
        ld hl,cat_error_state_missing_text
        jr z,cat_error_text_ready
        cp 2
        ld hl,cat_error_state_conflict_text
        jr z,cat_error_text_ready
        cp 3
        ld hl,cat_error_state_envelope_text
        jr z,cat_error_text_ready
        cp 4
        ld hl,cat_error_state_length_text
        jr z,cat_error_text_ready
        ld hl,cat_error_state_read_text
        jr cat_error_text_ready
cat_error_state_stage_two:
        ld hl,cat_error_view_text
        cp 2
        jr z,cat_error_text_ready
        ld hl,cat_error_focus_text
cat_error_text_ready:
        ld b,3
        ld c,20
        ld d,124
        call ui_draw_text_clipped
        ld hl,cat_notice_return
        ld b,3
        ld c,40
        call ui_draw_text
cat_error_wait:
        call sc_input_wait
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        cp SC_SCAN_ENTER
        jr nz,cat_error_wait
        ret

cat_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,cat_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,cat_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,cat_scx_magic
        ld b,4
cat_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,cat_scx_fail
        inc de
        inc hl
        djnz cat_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,cat_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 3
        jr nz,cat_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,cat_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,cat_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,cat_scx_fail
        push hl
        ld de,8320 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,cat_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,cat_scx_fail
        or a
        ret
cat_scx_fail:
        scf
        ret

cat_error:          defb CAT_ERROR_NONE
cat_state_failure:  defb 0
cat_catalog_failure: defb 0
cat_catalog_key:    defs 11,0
cat_pending_action: defb 0
cat_focus:          defb 0
cat_scroll:         defb 0
cat_previous_focus: defb 0
cat_previous_scroll: defb 0
cat_auto_advance_pending: defb 0
cat_transition_seen: defb 0
cat_count:          defb 0
cat_raw_count:      defb 0
cat_visible_count:  defb 0
cat_visible_target: defb 0
cat_scan_index:     defb 0
cat_row:            defb 0
cat_row_item:       defb 0
cat_row_y:          defb 0
cat_array_offset:   defw 0
cat_context_offset: defw 0
cat_item_offset:    defw 0
cat_state_offset:   defw 0
cat_access_offset:  defw 0
cat_access_remaining: defb 0
cat_access_key_low: defb 0
cat_access_key_high: defb 0
cat_notice_message: defw 0
cat_reason_array_offset: defw 0
cat_reason_text:    defw 0
cat_reason_count:   defb 0
cat_reason_index:   defb 0
cat_label_key:      defw 0
cat_selected_label: defs 21,0

cat_scx_magic:          defb "SCX1"
cat_scc1_magic:         defb "SCC1"
cat_scp1_magic:         defb "SCP1"
cat_scu1_magic:         defb "SCU1"
cat_key_schema:         defb "schema",0
cat_key_generation_key: defb "generationKey",0
cat_key_catalogs:       defb "catalogs",0
cat_key_subjects:       defb "subjects",0
cat_key_courses:        defb "courses",0
cat_key_units:          defb "units",0
cat_key_lessons:        defb "lessons",0
cat_key_lesson:         defb "lesson",0
cat_key_modules:        defb "modules",0
cat_key_title:          defb "title",0
cat_key_short_title:    defb "shortTitle",0
cat_key_type:           defb "type",0
cat_key_state:          defb "state",0
cat_key_access:         defb "access",0
cat_key_learner_keys:   defb "learnerKeys",0
cat_key_guest:          defb "guest",0
cat_key_reasons:        defb "reasons",0
cat_key_artifact_id:    defb "artifactId",0
cat_catalog_schema:     defb "school.calc.catalog-projection/v1",0
cat_package_schema:     defb "school.calc.ti86-package/v2",0
cat_state_installed:    defb "installed",0
cat_state_available:    defb "available",0
cat_state_requested:    defb "requested",0
cat_state_update:       defb "update_available",0
cat_state_incompatible: defb "incompatible",0
cat_artifact_prefix:    defb "sc:ti86:"
cat_artifact_id:        defb "sc:ti86:",0,0,0,0,0,0,0,0,0,0,0
cat_artifact_name:      defb 0x0C,8,"DP",0,0,0,0,0,0

cat_header_subjects: defb "SUBJECTS",0
cat_chevron:         defb ">",0
cat_status_chars:    defb "*+~^!"
cat_soft_open:       defb "OPEN",0
cat_soft_back:       defb "BACK",0
cat_soft_user:       defb "USER",0
cat_soft_remove:     defb "REMOVE",0
cat_soft_cancel:     defb "CANCEL",0
cat_soft_request:    defb "REQUEST",0
cat_soft_sync:       defb "OFF",0
cat_soft_more:       defb "NEXT",0
cat_soft_eom:        defb "END",0
cat_loading_label:   defb "LOAD",0
; The action is queued until the next sync; name that directly instead of
; spending scarce pixels on the transport implementation.
cat_remove_question: defb "REMOVE LATER?",0
cat_requested_text:  defb "QUEUED",0
cat_unavailable_text: defb "NO ACCESS",0
cat_empty_text:      defb "NO CONTENT.",0
cat_guest_label:     defb "Guest",0
cat_user_label:      defb "User",0
cat_incompatible_title: defb "UNSUPPORTED",0
cat_incompatible_text: equ cat_incompatible_title
cat_reason_return:    defb "ENTER",0
cat_notice_return:    equ cat_reason_return
cat_error_header:    defb "CAT ERROR",0
cat_error_state_text: defb "STATE ERROR.",0
cat_error_catalog_text: defb "CATALOG ERROR.",0
cat_error_catalog_snapshot_text: defb "No Catalog.",0
cat_error_catalog_record_text: defb "BAD DATA.",0
cat_error_catalog_schema_missing_text: defb "BAD SCHEMA.",0
cat_error_catalog_schema_text: defb "BAD FORMAT.",0
cat_error_catalog_generation_missing_text: defb "BAD KEY.",0
cat_error_catalog_generation_text: defb "CATALOG STALE.",0
cat_error_state_missing_text:  defb "NO STATE.",0
cat_error_state_conflict_text: defb "CONFLICT.",0
cat_error_state_envelope_text: defb "STATE CRC.",0
cat_error_state_length_text:   defb "STATE LENGTH.",0
cat_error_state_read_text:     defb "STATE READ.",0
cat_error_view_text:  defb "BAD VIEW.",0
cat_error_focus_text: defb "BAD FOCUS.",0
cat_error_artifact_text: defb "BAD LESSON.",0
cat_error_save_text: defb "SAVE FAILED.",0
cat_error_request_text: defb "SYNC PENDING.",0

cat_dscat0_name: defb 0x0C,6,"DSCAT0",0,0
cat_dscat1_name: defb 0x0C,6,"DSCAT1",0,0
cat_screq_name:  defb 0x12,5,"SCREQ",0,0,0
cat_scprof_name: defb 0x12,6,"SCPROF",0,0
cat_dsusers_name:defb 0x0C,7,"DSUSERS",0

include "crc16-ccitt.asm"
UI_RENDER_COPIED_TEXT_LENGTH: equ 1
include "record-reader.asm"
include "runtime-state.asm"
UI_RENDER_PROFILE_FULL: equ 1
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/ui-catalog-runtime-assets.inc"

end
