; SchoolCalc TI-86 shell
;
; This first production-shell slice owns the real executable name, creates a
; live checksum-valid DSINFO String through TI-OS, detects provisioned DSID,
; and runs a small subset of the canonical full-screen design system. It now
; delegates Catalog and lesson hydration to their bounded SCX1 runtimes;
; runtime capabilities remain unadvertised until execution gates pass.

include "ti86asm.inc"

SCREEN_HOME:    equ 0
SCREEN_CATALOG: equ 1
SCREEN_LESSON:  equ 2
SCREEN_SYNC:    equ 3
SCREEN_RESULT:  equ 4
SCREEN_TUTOR:   equ 5
SCREEN_CODE:    equ 6
HOME_ITEMS:     equ 4

org _asm_exec_ram

start:
        ; Adaptive Study v1 always begins at the six-digit agenda handoff.
        ; Profile and Catalog code remains linked for reference builds but is
        ; unreachable from the active learner route.
        call _runindicoff
        call sc_input_init
        call detect_identity
        call local_state_load
        call sync_commit_staged
        ; DSINFO is only consumed by the foreground Sync runtime.  Publishing
        ; it here used to CRC-scan every installed child program before the
        ; first visible frame, making the ASCHL launcher take roughly fifteen
        ; seconds.  Sync still rebuilds it immediately before it owns the
        ; cable, where the integrity work is both necessary and honest.
        jp show_code

render:
        call _clrLCD
        call shell_render_code
        call shell_render_softkeys

wait_key:
        call sc_input_wait
        ld b,a
        ld a,(current_screen)
        cp SCREEN_CODE
        jr nz,wait_key_regular
        ld a,b
        call shell_code_accept_digit
        or a
        jr z,wait_key_regular
        call shell_code_refresh
        call shell_code_refresh_f1
        jp wait_key
wait_key_regular:
        ld a,b
        cp SC_SCAN_EXIT
        jp z,go_back
        cp SC_SCAN_RIGHT
        jp z,activate_current
        cp SC_SCAN_ENTER
        jp z,activate_current
        cp SC_SCAN_DOWN
        jp z,move_focus_down
        cp SC_SCAN_LEFT
        jp z,go_back
        cp SC_SCAN_UP
        jp z,move_focus_up
        cp SC_SCAN_F1
        jp z,shell_f1
        cp SC_SCAN_F2
        jp z,shell_f2
        cp SC_SCAN_F3
        jp z,shell_f3
        cp SC_SCAN_F4
        jp z,shell_f4
        cp SC_SCAN_F5
        jp z,shell_f5
        jp wait_key

shell_f1:
        ld a,(current_screen)
        cp SCREEN_CODE
        jp z,shell_code_open
        cp SCREEN_RESULT
        jp z,launch_qr_runtime
        jp launch_profile_runtime

shell_f2:
        jp wait_key

shell_f3:
        ld a,(current_screen)
        or a
        jp nz,wait_key
        jp show_code

shell_f4:
        jp wait_key

shell_f5:
        ld a,(current_screen)
        cp SCREEN_CODE
        jp z,sc_input_force_exit
        jp show_sync

; A score result is a durable offline record, not a dead-end receipt. OPEN
; reopens the same module menu so the learner can immediately retry it.
move_focus_down:
move_focus_up:
        jp wait_key
activate_current:
        ld a,(current_screen)
        cp SCREEN_CODE
        jp z,shell_code_open
        jp wait_key
go_back:
show_home:
show_catalog:
        jp show_code
if 0
shell_review_result:
        ld a,5                    ; Catalog MODULE view
        ld (SCL_VIEW_ADDR),a
        ld a,SCREEN_CATALOG
        ld (current_screen),a
        call local_state_save
        jp launch_catalog_runtime

move_focus_down:
        ld a,(current_screen)
        or a
        jp nz,wait_key
        ld a,(current_focus)
        ld (previous_focus),a
        inc a
        cp HOME_ITEMS
        jr c,store_focus
        xor a
store_focus:
        ld (current_focus),a
        call local_state_save
        call shell_redraw_home_cursor
        jp wait_key

move_focus_up:
        ld a,(current_screen)
        or a
        jp nz,wait_key
        ld a,(current_focus)
        ld (previous_focus),a
        or a
        jr nz,decrement_focus
        ld a,HOME_ITEMS
decrement_focus:
        dec a
        jr store_focus

activate_current:
        ld a,(current_screen)
        or a
        jr z,activate_home
        cp SCREEN_CODE
        jp z,shell_code_open
        cp SCREEN_CATALOG
        jp z,show_lesson
        cp SCREEN_LESSON
        jp z,show_catalog
        cp SCREEN_RESULT
        jp z,show_home
        cp SCREEN_SYNC
        jp z,wait_key
        jp wait_key
activate_home:
        ld a,(current_focus)
        or a
        jr nz,activate_home_other
        ; Continue is meaningful only when the direct Subject path previously
        ; selected an immutable lesson artifact. A fresh installation must enter Catalog
        ; instead of launching SCLEARN with an all-zero artifact key.
        ld a,(SCL_ARTIFACT_KEY_ADDR)
        or a
        jp z,show_catalog
        jp show_lesson
activate_home_other:
        ld a,(current_focus)
        cp 3
        jp z,show_sync
        jp show_catalog

go_back:
        ld a,(current_screen)
        or a
        jp z,show_code
        cp SCREEN_LESSON
        jp z,show_code
        jp show_code

show_home:
        ld a,SCREEN_HOME
        jp store_screen
show_catalog:
        ; A paused assessment owns its immutable learner/artifact binding.
        ; Do not let Catalog activation silently discard that draft by opening
        ; another module; Continue the active runtime first.
        ld a,(SCL_FLAGS_ADDR)
        and 1
        jp nz,launch_standard_runtime
        ; A committed SCC1/SCM1 snapshot is now provisioned with the starter
        ; release, so Catalog is an executable browser rather than the old
        ; recovery placeholder. SCCAT owns its own deep durable continuation.
        jp launch_catalog_runtime
endif
show_code:
        ld a,SCREEN_CODE
        ld (current_screen),a
        xor a
        ld (shell_code_length),a
        ld (shell_code_status),a
        ld hl,shell_code_digits
        ld b,7
shell_code_clear:
        ld (hl),a
        inc hl
        djnz shell_code_clear
        jp render

; ---------------------------------------------------------------------------
; Offline six-digit continuation route
;
; DSCODE is a small fixed SCCO index built with the same domain permutation
; used by worksheets and the web School surface.  This shell does not treat a
; visible code as authentication: it opens only a route whose learner and
; artifact are present in this verified local record.

SCCO_ENTRY_BYTES: equ 30

; A holds the physical input event. The shared boundary returns direct TI-86
; matrix codes; translate only this one compact field to ASCII without adding
; a digit table to every independently loaded runtime.
shell_code_accept_digit:
        ld b,a
        ld hl,shell_code_digit_keys
        ld c,10
shell_code_digit_find:
        ld a,b
        cp (hl)
        jr z,shell_code_digit_found
        inc hl
        inc hl
        dec c
        jr nz,shell_code_digit_find
        jr shell_code_not_digit
shell_code_digit_found:
        inc hl
        ld b,(hl)
        ld a,(shell_code_length)
        cp 6
        jr nc,shell_code_not_digit
        ld e,a
        ld d,0
        ld hl,shell_code_digits
        add hl,de
        ld a,b
        ld (hl),a
        ld a,(shell_code_length)
        inc a
        ld (shell_code_length),a
        xor a
        ld (shell_code_status),a
        inc a
        ret
shell_code_not_digit:
        xor a
        ret

shell_code_open:
        ld a,(shell_code_length)
        cp 6
        jp nz,wait_key
shell_code_open_ready:
        ; Acknowledge activation on the LCD before opening an envelope,
        ; creating DSENTRY, or handing control to a child runtime. These
        ; operations can take visible time on physical hardware; a pressed
        ; ENTER/F1 must never look lost.
        ld a,4
        ld (shell_code_status),a
        call shell_code_refresh
        call shell_code_matches_study
        jp nc,launch_standard_runtime
        call publish_study_entry
        jp c,shell_code_unavailable
        jp launch_sync_runtime

; Carry clear only when the six entered digits equal canonical SCSP. This
; reopens paused study or its queued Result without contacting the relay.
shell_code_matches_study:
        ld hl,sync_dsstudy_name
        ld de,scsp_magic
        call sc_envelope_open
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        add a,11
        ld e,a
        ld d,0
        ld hl,shell_code_digits
        ld b,6
shell_code_match_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jr nz,shell_code_match_failed
        inc de
        inc hl
        djnz shell_code_match_loop
        or a
        ret
shell_code_match_failed:
        scf
        ret

; Build the durable calculator-owned DSENTRY/SCE1 claim from the enrolled
; device identity and the six visible digits. The request ID is the current
; durable SCL1 generation (24 low bits); the exact DSENTRY is retained until
; a later SCSP/DSSYNC commit acknowledges all three identity fields.
publish_study_entry:
        ld a,(device_enrolled)
        or a
        scf
        ret z
        ld hl,dsentry_name
        rst 0x20
        rst 0x10
        call nc,_delvar

        ld hl,sce1_record
        ld (hl),'S'
        inc hl
        ld (hl),'C'
        inc hl
        ld (hl),'E'
        inc hl
        ld (hl),'1'
        inc hl
        ld (hl),1
        inc hl
        ld a,(device_id_length)
        add a,10                  ; id length byte + request(3) + code(6)
        ld (hl),a
        inc hl
        xor a
        ld (hl),a                 ; body length high byte
        inc hl
        ld a,(device_id_length)
        ld (hl),a
        inc hl
        ld de,device_id_value
        ld b,a
publish_study_entry_device:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz publish_study_entry_device
        ld de,local_generation
        ld b,3
publish_study_entry_request:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz publish_study_entry_request
        ld de,shell_code_digits
        ld b,6
publish_study_entry_code:
        ld a,(de)
        ld (hl),a
        inc de
        inc hl
        djnz publish_study_entry_code
        ld (sce1_crc_pointer),hl

        ld de,sce1_record
        or a
        sbc hl,de
        ld b,h
        ld c,l
        push bc
        ld hl,sce1_record
        call crc16_ccitt_false
        pop bc
        ld hl,(sce1_crc_pointer)
        ld (hl),e
        inc hl
        ld (hl),d
        ld h,b
        ld l,c
        inc hl
        inc hl
        ld (sce1_record_length),hl

        ld hl,(sce1_record_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,sce1_record
        call _set_abs_src
        xor a
        ld hl,(sce1_record_length)
        call _set_mm_bytes
        call _mm_ldir
        or a
        ret

; Retained in source as the superseded v0 continuation-code resolver. Adaptive
; v1 publishes DSENTRY/SCE1 and lets the relay return an immutable SCSP
; prescription, so this code is intentionally absent from the installed shell.
if 0
shell_code_resolve:
        ld hl,dscode_name
        ld de,scco_magic
        call sc_envelope_open
        jp c,shell_code_unavailable
        ; body[0] is a compact device ID length, then ID and the bound SCC1
        ; generation key. Validate that key before trusting an entry offset.
        ld de,7
        call sc_record_read_byte
        jp c,shell_code_unavailable
        or a
        jp z,shell_code_unavailable
        cp 17
        jp nc,shell_code_unavailable
        ld c,a
        ld a,8
        add a,c
        ld e,a
        ld d,0
        ld hl,SCL_CATALOG_KEY_ADDR
        ld b,10
shell_code_generation_loop:
        call sc_record_read_byte
        jp c,shell_code_unavailable
        cp (hl)
        jp nz,shell_code_unavailable
        inc de
        inc hl
        djnz shell_code_generation_loop
        call sc_record_read_byte
        jp c,shell_code_unavailable
        ld (shell_code_entries_left),a
        inc de
        ld (shell_code_entry_offset),de

shell_code_entry_loop:
        ld a,(shell_code_entries_left)
        or a
        jp z,shell_code_unavailable
        ld de,(shell_code_entry_offset)
        ld hl,shell_code_digits
        ld b,6
shell_code_compare_loop:
        call sc_record_read_byte
        jp c,shell_code_unavailable
        cp (hl)
        jr nz,shell_code_next_entry
        inc de
        inc hl
        djnz shell_code_compare_loop
        jp shell_code_apply_entry
shell_code_next_entry:
        ld hl,(shell_code_entry_offset)
        ld de,SCCO_ENTRY_BYTES
        add hl,de
        ld (shell_code_entry_offset),hl
        ld a,(shell_code_entries_left)
        dec a
        ld (shell_code_entries_left),a
        jr shell_code_entry_loop

; DE enters at the learner-key bytes, immediately after the matched six digits.
; Copy exactly the state fields that normally result from a Catalog module
; activation, then use the regular SCLEARN launch boundary.
shell_code_apply_entry:
        ld hl,SCL_SELECTED_LEARNER_ADDR
        ld b,2
shell_code_copy_learner:
        call sc_record_read_byte
        jr c,shell_code_unavailable
        ld (hl),a
        inc de
        inc hl
        djnz shell_code_copy_learner
        ld hl,SCL_ARTIFACT_KEY_ADDR
        ld b,10
shell_code_copy_artifact:
        call sc_record_read_byte
        jr c,shell_code_unavailable
        ld (hl),a
        inc de
        inc hl
        djnz shell_code_copy_artifact
        ld hl,SCL_CATALOG_INDEX_ADDR
        ld b,12
shell_code_copy_indexes:
        call sc_record_read_byte
        jr c,shell_code_unavailable
        ld (hl),a
        inc de
        inc hl
        djnz shell_code_copy_indexes
        xor a
        ld (SCL_ITEM_INDEX_ADDR),a
        ld (SCL_ITEM_INDEX_ADDR + 1),a
        ld (SCL_FOCUS_ADDR),a
        ld (SCL_FOCUS_ADDR + 1),a
        ld (SCL_SCROLL_ADDR),a
        ld (SCL_SCROLL_ADDR + 1),a
        ld (SCL_SESSION_LEARNER_ADDR),a
        ld (SCL_SESSION_LEARNER_ADDR + 1),a
        ld (SCL_DRAFT_KIND_ADDR),a
        ld (SCL_DRAFT_LENGTH_ADDR),a
        ld a,(SCL_FLAGS_ADDR)
        and 0xE0
        ld (SCL_FLAGS_ADDR),a
        ld a,(SCL_FLAGS_HIGH_ADDR)
        and 0xFC
        or 0x04                    ; explicit learner-selection acknowledgement
        ld (SCL_FLAGS_HIGH_ADDR),a
        ld a,SCREEN_LESSON
        ld (current_screen),a
        xor a
        ld (current_focus),a
        call local_state_save
        jp launch_standard_runtime
endif

shell_code_unavailable:
        ld a,2
        ld (shell_code_status),a
        call shell_code_refresh
        jp wait_key
show_lesson:
        jp launch_standard_runtime
show_sync:
        ld a,SCREEN_SYNC
        ld (current_screen),a
        jp launch_sync_runtime
store_screen:
        ld (current_screen),a
        call local_state_save
        jp render

; Standard lesson content may select only this build-owned runtime name. The
; artifact never contains a TI program name or executable bytes. Save the
; durable continuation in the selecting runtime; TI-OS _exec_assembly restores
; this caller after SCLEARN returns. The shell must not save its coarse
; SCREEN_LESSON mapping here because that would overwrite Catalog's exact
; MODULE view before the content runtime opens it.
launch_standard_runtime:
        ld hl,sclearn_name
        rst 0x20
        rst 0x10
        jp c,render
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        ld a,(current_screen)
        cp SCREEN_CATALOG
        jp z,launch_catalog_runtime
        cp SCREEN_LESSON
        jp z,launch_catalog_runtime
        cp SCREEN_SYNC
        jp z,launch_sync_runtime
        cp SCREEN_TUTOR
        jp z,launch_tutor_runtime
        jp render

; QR is a separate reviewed code-release module. It reads DSQ but never owns
; or mutates queue state, so returning or losing power cannot acknowledge a
; result. The result view remains the durable continuation on either path.
launch_qr_runtime:
        call local_state_save
        ld hl,scqr_name
        rst 0x20
        rst 0x10
        jp c,render
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        jp render

; Learner selection and roster recovery live outside the core shell. SCPROF
; receives no content-selected executable name; it may change only the
; selected learner key through the shared alternating SCL1 boundary.
; Adaptive v1 keeps these labels as safe compatibility targets for retained
; source paths, but omits the inactive Profile/Tutor/Catalog launchers.
launch_profile_runtime:
launch_tutor_runtime:
launch_catalog_runtime:
launch_catalog_missing:
        jp show_code
if 0
launch_profile_runtime:
        ld hl,scprof_name
        rst 0x20
        rst 0x10
        jp c,render
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        ld a,(current_screen)
        cp SCREEN_CATALOG
        jp z,launch_catalog_runtime
        cp SCREEN_LESSON
        jp z,launch_standard_runtime
        cp SCREEN_SYNC
        jp z,launch_sync_runtime
        cp SCREEN_TUTOR
        jp z,launch_tutor_runtime
        jp render

; The generic adaptive tutor owns durable SCTQ/SCTR interaction records and
; the connected multiple-choice UI. It returns with SCREEN_SYNC only after a
; complete request is durable, allowing the shell to hand cable ownership to
; SCSYNC without either runtime knowing the other's executable internals.
launch_tutor_runtime:
        ld hl,sctutor_name
        rst 0x20
        rst 0x10
        jp c,launch_profile_runtime
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        ld a,(current_screen)
        cp SCREEN_SYNC
        jp z,launch_sync_runtime
        jp launch_profile_runtime

; Catalog hierarchy and delivery intents live in a separately reviewed
; runtime. Do not save the shell's coarse SCREEN_CATALOG mapping before this
; call: the durable SCL1 view may be a deeper Subject/Course/Unit continuation.
launch_catalog_runtime:
        ld hl,sccat_name
        rst 0x20
        rst 0x10
        jr c,launch_catalog_missing
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        ld a,(current_screen)
        cp SCREEN_LESSON
        jp z,launch_standard_runtime
        cp SCREEN_SYNC
        jp z,launch_sync_runtime
        cp SCREEN_TUTOR
        jp z,launch_tutor_runtime
        cp SCREEN_CATALOG
        jp z,show_home
        jp render
launch_catalog_missing:
        ld a,SCREEN_CATALOG
        jp store_screen
endif

; Cooperative foreground sync is a separately reviewed executable because
; the shell has neither the memory window nor the authority to own port 7.
; Publish DSINFO immediately before the transfer, preserve the Sync
; continuation, then validate and atomically commit any staged DSSYNC only
; after SCSYNC has released the cable and returned through TI-OS.
launch_sync_runtime:
        call publish_device_info
        call local_state_save
        ld hl,scsync_name
        rst 0x20
        rst 0x10
        jp c,render
        call _exec_assembly
        call sc_input_wait_release
        call local_state_load
        call sync_commit_staged
        call publish_device_info
        ; Adaptive v1 always returns to its code-first landing page. A valid
        ; SCSP commit exposes Resume there; inactive Profile/Catalog routes
        ; are never selected by the default shell.
        jp show_code

; Set device_enrolled only when DSID is a bounded, checksum-valid identity
; document. Keep its compact ID for cross-record transaction validation.
detect_identity:
        xor a
        ld (device_enrolled),a
        ld (device_id_length),a
        ld hl,device_id_value
        ld b,17
detect_identity_clear:
        ld (hl),a
        inc hl
        djnz detect_identity_clear
        ld hl,dsid_name
        ld de,sci1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,field_schema
        call sc_map_find_literal
        ret c
        ld hl,identity_schema
        call sc_node_string_equals_literal
        ret c
        or a
        ret z
        ld de,(sc_record_root_offset)
        ld hl,field_device_id
        call sc_map_find_literal
        ret c
        call sc_copy_node_string
        ret c
        ld de,device_id_value
        ld b,0
detect_identity_copy:
        ld a,(hl)
        or a
        jr z,detect_identity_length_ready
        ld c,a
        ld a,b
        cp 16
        ret nc
        ld a,c
        cp '0'
        ret c
        cp '9' + 1
        jr c,detect_identity_character_ok
        cp 'A'
        ret c
        cp 'Z' + 1
        ret nc
detect_identity_character_ok:
        ld a,c
        ld (de),a
        inc de
        inc hl
        inc b
        jr detect_identity_copy
detect_identity_length_ready:
        ld a,b
        cp 4
        ret c
        ld (device_id_length),a
        ld a,1
        ld (device_enrolled),a
        ret

; Delete the prior DSINFO, patch live free memory into the deterministic SCI1
; template, recompute CRC-16/CCITT-FALSE, then create and copy a new TI String.
publish_device_info:
        call discover_runtime_modules
        ld a,(runtime_module_mask)
        ld (DSINFO_RUNTIME_MASK_ADDR),a
        ld a,(runtime_module_mask + 1)
        ld (DSINFO_RUNTIME_MASK_ADDR_1),a
        xor a
        ld (DSINFO_RUNTIME_MASK_ADDR_2),a
        ld (DSINFO_RUNTIME_MASK_ADDR_3),a

        ld hl,dsinfo_name
        ; _Mov10ToOP1, then _FindSym.
        rst 0x20
        rst 0x10
        call nc,_delvar

        ; AHL = free bytes after old DSINFO delete.
        call _memchk
        ld (DSINFO_FREE_ADDR),hl
        ld (DSINFO_FREE_ADDR_2),a
        xor a
        ld (DSINFO_FREE_ADDR_3),a

        ld hl,dsinfo_record
        ld bc,DSINFO_CRC_OFFSET
        call crc16_ccitt_false
        ld a,e
        ld (DSINFO_CRC_ADDR),a
        ld a,d
        ld (DSINFO_CRC_ADDR_1),a

        ld hl,DSINFO_RECORD_LENGTH
        ; BDE points to the new String's storage.
        call _createstrng
        call _ex_ahl_bde
        ; Skip the TI String's length word.
        call _ahl_plus_2_pg3
        call _set_abs_dest
        ; Source is page-zero assembly RAM.
        xor a
        ld hl,dsinfo_record
        call _set_abs_src
        xor a
        ld hl,DSINFO_RECORD_LENGTH
        call _set_mm_bytes
        call _mm_ldir
        ret

; Independently inspect every fixed SCX1 Program variable before describing
; the installed client. A bit is set only when the TI Program wrapper, SCX1
; header, registry code/ceiling, declared length, reserved bytes, and payload
; CRC all agree. This is corruption/presence evidence, not authentication;
; portable capability promotion remains gated in the TI-86 adapter.
discover_runtime_modules:
        xor a
        ld (runtime_module_mask),a
        ld (runtime_module_mask + 1),a
        ld hl,runtime_module_table
        ld (runtime_module_pointer),hl
        ld b,RUNTIME_MODULE_COUNT
discover_runtime_loop:
        push bc
        ld hl,(runtime_module_pointer)
        rst 0x20
        rst 0x10
        jr c,discover_runtime_next
        call validate_installed_runtime
        jr c,discover_runtime_next
        ld hl,(runtime_module_pointer)
        ld de,13
        add hl,de
        ld a,(runtime_module_mask)
        or (hl)
        ld (runtime_module_mask),a
        inc hl
        ld a,(runtime_module_mask + 1)
        or (hl)
        ld (runtime_module_mask + 1),a
discover_runtime_next:
        ld hl,(runtime_module_pointer)
        ld de,RUNTIME_MODULE_ENTRY_BYTES
        add hl,de
        ld (runtime_module_pointer),hl
        pop bc
        djnz discover_runtime_loop
        ret

; Entry: _FindSym succeeded for the current table descriptor.
validate_installed_runtime:
        call _ex_ahl_bde
        call _get_word_ahl
        ld (runtime_code_length),de
        ld (sc_record_base_page),a
        ld (sc_record_base_addr),hl
        push de
        pop hl
        inc hl
        inc hl
        ld (sc_record_length),hl
        xor a
        ld (sc_cache_valid),a

        ; The SCX1 executor envelope is 21 executable bytes (NOP/JP,
        ; _exec_assembly input word, title pointer, SCX1 metadata, and
        ; reserved word).  The Program wrapper's two Asm( bytes are read
        ; through sc_record_read_byte but are not in this declared length.
        ld hl,(runtime_code_length)
        ld de,21
        or a
        sbc hl,de
        jp c,validate_installed_runtime_fail
        ld hl,(runtime_module_pointer)
        ld de,11
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld hl,(runtime_code_length)
        ex de,hl
        or a
        sbc hl,de
        jp c,validate_installed_runtime_fail

        ld hl,runtime_header_prefix
        ld de,0
        ld b,15
validate_installed_runtime_prefix:
        push bc
        push hl
        call sc_record_read_byte
        pop hl
        pop bc
        jp c,validate_installed_runtime_fail
        cp (hl)
        jp nz,validate_installed_runtime_fail
        inc hl
        inc de
        djnz validate_installed_runtime_prefix

        ; SCX1 module code must match this build-owned table row.
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        ld c,a
        ld hl,(runtime_module_pointer)
        ld de,10                 ; registry code byte within table row
        add hl,de
        ld a,(hl)
        cp c
        jp nz,validate_installed_runtime_fail

        ld de,16
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        or a
        jp nz,validate_installed_runtime_fail
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        ld hl,(runtime_code_length)
        cp l
        jp nz,validate_installed_runtime_fail
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        cp h
        jp nz,validate_installed_runtime_fail
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        ld (runtime_expected_crc),a
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        ld (runtime_expected_crc + 1),a
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        or a
        jp nz,validate_installed_runtime_fail
        inc de
        call sc_record_read_byte
        jp c,validate_installed_runtime_fail
        or a
        jp nz,validate_installed_runtime_fail

        ld hl,(runtime_code_length)
        ld de,21
        or a
        sbc hl,de
        ld (runtime_crc_remaining),hl
        ; Program wrapper (2) + executor envelope (21) = first CRC byte.
        ld hl,23
        ld (runtime_crc_offset),hl
        ld hl,0xFFFF
        ld (runtime_crc_value),hl
validate_installed_runtime_crc_byte:
        ld hl,(runtime_crc_remaining)
        ld a,h
        or l
        jr z,validate_installed_runtime_crc_compare
        ld de,(runtime_crc_offset)
        call sc_record_read_byte
        jr c,validate_installed_runtime_fail
        ld hl,(runtime_crc_value)
        xor h
        ld h,a
        ld b,8
validate_installed_runtime_crc_bit:
        bit 7,h
        jr z,validate_installed_runtime_crc_shift
        sla l
        rl h
        ld a,h
        xor 0x10
        ld h,a
        ld a,l
        xor 0x21
        ld l,a
        jr validate_installed_runtime_crc_bit_done
validate_installed_runtime_crc_shift:
        sla l
        rl h
validate_installed_runtime_crc_bit_done:
        djnz validate_installed_runtime_crc_bit
        ld (runtime_crc_value),hl
        ld hl,(runtime_crc_offset)
        inc hl
        ld (runtime_crc_offset),hl
        ld hl,(runtime_crc_remaining)
        dec hl
        ld (runtime_crc_remaining),hl
        jr validate_installed_runtime_crc_byte

validate_installed_runtime_crc_compare:
        ld hl,(runtime_crc_value)
        ld de,(runtime_expected_crc)
        or a
        sbc hl,de
        ret z
validate_installed_runtime_fail:
        scf
        ret

; ---------------------------------------------------------------------------
; Crash-safe shell-private continuation. DSLOCAL0 and DSLOCAL1 alternate;
; a write never deletes the currently active generation.

local_state_load:
        xor a
        ld (current_screen),a
        ld (current_focus),a
        ld (local_state_found_any),a
        ld (local_state_error),a
        ld (local_generation),a
        ld (local_generation + 1),a
        ld (local_generation + 2),a
        ld (local_generation + 3),a
        ld a,0xFF
        ld (local_active_slot),a
        ld hl,local0_name
        xor a
        call local_state_consider
        ld hl,local1_name
        ld a,1
        call local_state_consider
        ld a,(local_active_slot)
        cp 0xFF
        ret nz
        ld a,(local_state_found_any)
        or a
        ret nz
        ; First launch: establish generation one in DSLOCAL0.
        jp local_state_save

; HL = slot descriptor and A = slot index.
local_state_consider:
        ld (local_candidate_slot),a
        ld de,scl1_magic
        call sc_envelope_open
        jr nc,local_state_candidate_present
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        ld a,1
        ld (local_state_found_any),a
        ld (local_state_error),a
        ret

local_state_candidate_present:
        ld a,1
        ld (local_state_found_any),a
        ld hl,(sc_record_length)
        ld de,SCL_RECORD_LENGTH
        or a
        sbc hl,de
        jp nz,local_state_candidate_invalid

        ld de,SCL_GENERATION_ADDR - local_state_record
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        ld (local_candidate_generation),a
        inc de
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        ld (local_candidate_generation + 1),a
        inc de
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        ld (local_candidate_generation + 2),a
        inc de
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        ld (local_candidate_generation + 3),a

        ld de,SCL_VIEW_ADDR - local_state_record
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        or a
        jr z,local_candidate_home
        cp 1
        jr z,local_candidate_catalog
        cp 2
        jr z,local_candidate_catalog
        cp 3
        jr z,local_candidate_catalog
        cp 4
        jr z,local_candidate_catalog
        cp 5
        jr z,local_candidate_lesson
        cp 6
        jr z,local_candidate_result
        cp 7
        jr z,local_candidate_sync
        cp 9
        jr z,local_candidate_catalog
        cp 10
        jr z,local_candidate_catalog
        cp 11
        jr z,local_candidate_tutor
        jp local_state_candidate_invalid
local_candidate_home:
        xor a
        jr local_candidate_view_ready
local_candidate_catalog:
        ld a,SCREEN_CATALOG
        jr local_candidate_view_ready
local_candidate_lesson:
        ld a,SCREEN_LESSON
        jr local_candidate_view_ready
local_candidate_result:
        ld a,SCREEN_RESULT
        jr local_candidate_view_ready
local_candidate_sync:
        ld a,SCREEN_SYNC
        jr local_candidate_view_ready
local_candidate_tutor:
        ld a,SCREEN_TUTOR
local_candidate_view_ready:
        ld (local_candidate_screen),a

        ld de,SCL_FOCUS_ADDR - local_state_record
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        ld b,a
        inc de
        call sc_record_read_byte
        jp c,local_state_candidate_invalid
        or a
        jp nz,local_state_candidate_invalid
        ld a,(local_candidate_screen)
        or a
        jr nz,local_candidate_nonhome_focus
        ld a,b
        cp HOME_ITEMS
        jp nc,local_state_candidate_invalid
        ld (local_candidate_focus),a
        jr local_candidate_focus_ready
local_candidate_nonhome_focus:
        xor a
        ld (local_candidate_focus),a
local_candidate_focus_ready:

        ld a,(local_active_slot)
        cp 0xFF
        jr z,local_state_select_candidate
        ; Compare unsigned little-endian generations from most significant byte.
        ld a,(local_candidate_generation + 3)
        ld b,a
        ld a,(local_generation + 3)
        cp b
        jr c,local_state_select_candidate
        ret nz
        ld a,(local_candidate_generation + 2)
        ld b,a
        ld a,(local_generation + 2)
        cp b
        jr c,local_state_select_candidate
        ret nz
        ld a,(local_candidate_generation + 1)
        ld b,a
        ld a,(local_generation + 1)
        cp b
        jr c,local_state_select_candidate
        ret nz
        ld a,(local_candidate_generation)
        ld b,a
        ld a,(local_generation)
        cp b
        jr c,local_state_select_candidate
        ret nz
        ; Equal generations are impossible under alternating writes.
        ld a,2
        ld (local_state_error),a
        ld a,0xFF
        ld (local_active_slot),a
        xor a
        ld (current_screen),a
        ld (current_focus),a
        ret

local_state_select_candidate:
        ; Keep the complete selected SCL1 image as the next copy-on-write
        ; template. Navigation edits only its owned view/focus fields; sync,
        ; draft, sequence, and native-continuation fields must survive.
        call local_state_copy_candidate
        jp c,local_state_candidate_invalid
        ld a,(local_candidate_slot)
        ld (local_active_slot),a
        ld hl,(local_candidate_generation)
        ld (local_generation),hl
        ld hl,(local_candidate_generation + 2)
        ld (local_generation + 2),hl
        ld a,(local_candidate_screen)
        ld (current_screen),a
        ld a,(local_candidate_focus)
        ld (current_focus),a
        ret

local_state_copy_candidate:
        ld hl,local_state_record
        ld (local_copy_destination),hl
        ld de,0
local_state_copy_candidate_loop:
        call sc_record_read_byte
        ret c
        ld hl,(local_copy_destination)
        ld (hl),a
        inc hl
        ld (local_copy_destination),hl
        inc de
        ld hl,SCL_RECORD_LENGTH
        or a
        sbc hl,de
        jr nz,local_state_copy_candidate_loop
        or a
        ret

local_state_candidate_invalid:
        ld a,1
        ld (local_state_error),a
        ret

local_state_save:
        ld a,(local_active_slot)
        cp 0xFF
        jr nz,local_state_choose_inactive
        ld a,(local_state_found_any)
        or a
        ret nz
        xor a
        jr local_state_target_ready
local_state_choose_inactive:
        xor 1
local_state_target_ready:
        ld (local_target_slot),a
        or a
        ld hl,local0_name
        jr z,local_state_target_name_ready
        ld hl,local1_name
local_state_target_name_ready:
        ld (local_target_name),hl
        rst 0x20
        rst 0x10
        call nc,_delvar

        ; Leave room for the String, its VAT entry, and allocator overhead.
        call _memchk
        or a
        jr nz,local_state_memory_ready
        ld de,SCL_RECORD_LENGTH + 32
        or a
        sbc hl,de
        jp c,local_state_save_failed
local_state_memory_ready:
        ld hl,(local_generation)
        ld de,(local_generation + 2)
        inc hl
        ld a,h
        or l
        jr nz,local_state_generation_ready
        inc de
        ld a,d
        or e
        jp z,local_state_save_failed
local_state_generation_ready:
        ld (local_next_generation),hl
        ld (local_next_generation + 2),de
        ld (SCL_GENERATION_ADDR),hl
        ld (SCL_GENERATION_ADDR + 2),de
        ld a,(current_screen)
        ld e,a
        ld d,0
        ld hl,local_view_codes
        add hl,de
        ld a,(hl)
        ld (SCL_VIEW_ADDR),a
        ld a,(current_focus)
        ld (SCL_FOCUS_ADDR),a
        xor a
        ld (SCL_FOCUS_ADDR + 1),a
        ; A learner is remembered independently of a learning session.  Any
        ; saved state without the active-session bit must clear its immutable
        ; session binding, otherwise the next child runtime rejects SCL1.
        ld a,(SCL_FLAGS_ADDR)
        and 1
        jr nz,local_state_session_identity_ready
        ld hl,0
        ld (SCL_SESSION_LEARNER_ADDR),hl
local_state_session_identity_ready:
        ld hl,local_state_record
        ld bc,SCL_CRC_OFFSET
        call crc16_ccitt_false
        ld a,e
        ld (SCL_CRC_ADDR),a
        ld a,d
        ld (SCL_CRC_ADDR_1),a

        ; Reload OP1 because allocator checks are not part of its contract.
        ld hl,(local_target_name)
        rst 0x20
        ld hl,SCL_RECORD_LENGTH
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        call _set_abs_dest
        xor a
        ld hl,local_state_record
        call _set_abs_src
        xor a
        ld hl,SCL_RECORD_LENGTH
        call _set_mm_bytes
        call _mm_ldir

        ld hl,(local_target_name)
        ld de,scl1_magic
        call sc_envelope_open
        jr c,local_state_save_failed
        ld a,(local_target_slot)
        ld (local_active_slot),a
        ld hl,(local_next_generation)
        ld (local_generation),hl
        ld hl,(local_next_generation + 2)
        ld (local_generation + 2),hl
        ld a,1
        ld (local_state_found_any),a
        xor a
        ld (local_state_error),a
        ret
local_state_save_failed:
        ld a,3
        ld (local_state_error),a
        ret

include "crc16-ccitt.asm"

; ---------------------------------------------------------------------------
; Runtime SchoolCalc design-system composition

; Superseded v0 screen renderers are retained as source research but omitted
; from the adaptive v1 shell binary.
if 0
shell_render_home:
        ld hl,shell_title
        ld de,home_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,home_continue
        xor a
        call shell_draw_home_row
        ld hl,home_courses
        ld a,1
        call shell_draw_home_row
        ld hl,home_catalog
        ld a,2
        call shell_draw_home_row
        ld hl,home_sync
        ld a,3
        jp shell_draw_home_row

shell_render_catalog:
        ld hl,catalog_title
        ld de,empty_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,catalog_line_1
        ld b,2
        ld c,11
        call ui_draw_text
        ld hl,catalog_line_2
        ld b,2
        ld c,18
        call ui_draw_text
        ld hl,catalog_line_3
        ld b,2
        ld c,25
        jp ui_draw_text

shell_render_lesson:
        ld hl,lesson_title
        ld de,empty_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,lesson_line_1
        ld b,2
        ld c,11
        call ui_draw_text
        ld hl,lesson_line_2
        ld b,2
        ld c,18
        call ui_draw_text
        ld hl,lesson_line_3
        ld b,2
        ld c,25
        jp ui_draw_text

shell_render_sync:
        ld hl,sync_title
        ld de,sync_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        ld a,(device_enrolled)
        or a
        ld hl,sync_identity_missing
        jr z,shell_sync_identity_ready
        ld hl,sync_identity_ready
shell_sync_identity_ready:
        ld b,2
        ld c,11
        call ui_draw_text
        ld hl,sync_info_ready
        ld b,2
        ld c,18
        call ui_draw_text
        ld a,(sync_status)
        or a
        ld hl,sync_status_idle
        jr z,shell_sync_status_ready
        cp SC_SYNC_COMMITTED
        ld hl,sync_status_committed
        jr z,shell_sync_status_ready
        ld hl,sync_status_rejected
shell_sync_status_ready:
        ld b,2
        ld c,25
        call ui_draw_text
        ld a,(sync_status)
        or a
        ld hl,sync_presence_idle
        jr z,shell_sync_presence_ready
        cp SC_SYNC_COMMITTED
        ld hl,sync_presence_committed
        jr z,shell_sync_presence_ready
        ld hl,sync_presence_rejected
shell_sync_presence_ready:
        ld b,2
        ld c,32
        call ui_draw_text
        ld hl,sync_safety_safe
        ld b,2
        ld c,39
        jp ui_draw_text
endif

; Retained v0 shell-owned result route. Adaptive v1 renders and resumes Result
; inside SCLEARN, so this route is intentionally absent from the release.
if 0
shell_render_result:
        ld hl,result_title
        ld de,result_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        call shell_build_result_score
        ld hl,shell_result_score
        ld b,2
        ld c,13
        call ui_draw_text
        call shell_result_status
        ld b,2
        ld c,27
        call ui_draw_text
        ld hl,result_line_3
        ld b,2
        ld c,41
        jp ui_draw_text
endif

shell_render_code:
        ld hl,code_title
        ld de,code_context
        call shell_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,code_instruction
        ld b,32
        ld c,15
        call ui_draw_text
        call shell_draw_code_display
        jp shell_draw_code_status

; Code entry owns two small mutable regions. Never clear the full LCD for a
; digit: erase only the six-glyph field and status row, then redraw them over
; the stable header, instructions, border, and soft-key rail.
shell_code_refresh:
        call ui_mode_clear
        ld b,36
        ld c,25
        ld d,56
        ld e,10
        call ui_fill_rect
        ld b,0
        ld c,39
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_set
        call shell_draw_code_display
        ; Fall through and redraw the centered status label.
shell_draw_code_status:
        ld a,(shell_code_status)
        ld hl,code_prompt
        ld b,36
        or a
        jr nz,shell_code_status_nonidle
        ld a,(shell_code_length)
        cp 6
        jr nz,shell_code_status_ready
        ld hl,code_ready
        ld b,38
        jr shell_code_status_ready
shell_code_status_nonidle:
        cp 2
        ld hl,code_missing
        ld b,24
        jr z,shell_code_status_ready
        cp 3
        ld hl,code_busy
        ld b,26
        jr z,shell_code_status_ready
        cp 4
        ld hl,code_opening
        ld b,46
shell_code_status_ready:
        ld c,40
        jp ui_draw_text

; The first rail slot is intentionally empty until the editor holds exactly
; six digits. Repaint only that slot when digit six makes OPEN available.
shell_code_refresh_f1:
        call ui_mode_set
        ld b,0
        ld c,56
        ld d,25
        ld e,8
        call ui_fill_rect
        ld a,(shell_code_length)
        cp 6
        ret nz
        call ui_mode_clear
        call ui_select_compact
        ld hl,softkey_open
        ld b,2
        ld c,58
        call ui_draw_text
        jp ui_mode_set

shell_draw_code_display:
        ld hl,shell_code_digits
        ld (shell_code_font_pointer),hl
        ld a,38
        ld (shell_code_font_x),a
        ld a,6
        ld (shell_code_font_remaining),a
shell_draw_code_loop:
        ld hl,(shell_code_font_pointer)
        ld a,(hl)
        or a
        jr nz,shell_draw_code_char
        ld a,'-'
shell_draw_code_char:
        call shell_code_glyph_pointer
        ld a,(shell_code_font_x)
        ld b,a
        ld c,26
        ld d,SHELL_CODE_FONT_WIDTH
        ld e,SHELL_CODE_FONT_HEIGHT
        call ui_draw_bitmap
        ld hl,(shell_code_font_pointer)
        inc hl
        ld (shell_code_font_pointer),hl
        ld a,(shell_code_font_x)
        add a,8
        ld b,a
        ld a,(shell_code_font_remaining)
        dec a
        ld (shell_code_font_remaining),a
        jr z,shell_draw_code_done
        cp 3
        jr nz,shell_draw_code_store_x
        inc b
        inc b
        inc b
        inc b
shell_draw_code_store_x:
        ld a,b
        ld (shell_code_font_x),a
        jr shell_draw_code_loop
shell_draw_code_done:
        ret

; A = dash or digit. The compact table order is -0123456789.
shell_code_glyph_pointer:
        cp '-'
        jr nz,shell_code_glyph_digit
        xor a
        jr shell_code_glyph_index_ready
shell_code_glyph_digit:
        sub '0' - 1
shell_code_glyph_index_ready:
        ld l,a
        ld h,0
        add hl,hl
        add hl,hl
        add hl,hl
        ld de,shell_code_font
        add hl,de
        ret

; Result Queue replaces the answer draft with correct, total, and rounded
; percent at local-state offsets 47..49. Format it at render time so scores
; remain exact after a cold relaunch and are never guessed from QR output.
if 0
shell_build_result_score:
        ld de,shell_result_score
        ld hl,result_score_prefix
        call shell_copy_result_text
        ld a,(local_state_record + 47)
        call shell_emit_result_number
        ld a,'/'
        ld (de),a
        inc de
        ld a,(local_state_record + 48)
        call shell_emit_result_number
        ld a,' '
        ld (de),a
        inc de
        ld a,(local_state_record + 49)
        call shell_emit_result_number
        ld a,'%'
        ld (de),a
        inc de
        xor a
        ld (de),a
        ret

; HL source, DE destination. Copy a short zero-terminated UI literal.
shell_copy_result_text:
        ld a,(hl)
        or a
        ret z
        ld (de),a
        inc hl
        inc de
        jr shell_copy_result_text

; A is 0..100. Emit an ASCII decimal into DE and return the next position.
shell_emit_result_number:
        cp 100
        jr nz,shell_emit_result_under_hundred
        ld a,'1'
        ld (de),a
        inc de
        ld a,'0'
        ld (de),a
        inc de
        ld (de),a
        inc de
        ret
shell_emit_result_under_hundred:
        ld b,0
shell_emit_result_tens:
        cp 10
        jr c,shell_emit_result_units
        sub 10
        inc b
        jr shell_emit_result_tens
shell_emit_result_units:
        ld c,a
        ld a,b
        or a
        jr z,shell_emit_result_one
        add a,'0'
        ld (de),a
        inc de
shell_emit_result_one:
        ld a,c
        add a,'0'
        ld (de),a
        inc de
        ret

shell_result_status:
        ld a,(local_state_record + 49)
        cp 80
        ld hl,result_review_line
        ret c
        ld hl,result_mastered_line
        ret
endif

; HL = row text and A = zero-based row index.
shell_draw_home_row:
        ld (shell_row_text),hl
        ld (shell_row_index),a
        ld b,a
        add a,a
        add a,b
        add a,a
        add a,10
        ld (shell_row_y),a
        ld a,(current_focus)
        ld b,a
        ld a,(shell_row_index)
        cp b
        jr nz,shell_home_row_text
        ld hl,focus_chevron
        ld b,0
        ld a,(shell_row_y)
        ld c,a
        call ui_draw_text
shell_home_row_text:
        ld hl,(shell_row_text)
        ld b,5
        ld a,(shell_row_y)
        ld c,a
        jp ui_draw_text

; Cursor movement must not clear and redraw the entire LCD. The prior chevron
; is erased in-place, then the next one is drawn; row labels stay untouched.
shell_redraw_home_cursor:
        call ui_select_compact
        call ui_mode_clear
        ld a,(previous_focus)
        call shell_draw_focus_chevron
        call ui_mode_set
        ld a,(current_focus)
        call shell_draw_focus_chevron
        ret

; A = zero-based Home row index.
shell_draw_focus_chevron:
        ld b,a
        add a,a
        add a,b
        add a,a
        add a,10
        ld c,a
        ld b,0
        ld hl,focus_chevron
        jp ui_draw_text

; HL = title and DE = right-side context.
shell_render_header:
        ld (shell_header_title),hl
        ld (shell_header_context),de
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,(shell_header_title)
        ld b,1
        ld c,1
        call ui_draw_text
        ld hl,(shell_header_context)
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

shell_render_softkeys:
        call ui_mode_set
        ; y=55 is the fixed separator. One blank pixel separates key slots.
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
        ld b,102
        ld c,56
        ld d,26
        ld e,8
        call ui_fill_rect
        ld b,77
        ld c,56
        ld d,24
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,softkey_home
        ld a,(current_screen)
        cp SCREEN_CODE
        jr nz,shell_softkey_f1_not_code
        ld hl,softkey_empty
        ld a,(shell_code_length)
        cp 6
        jr nz,shell_softkey_f1_ready
        ld hl,softkey_open
        jr shell_softkey_f1_ready
shell_softkey_f1_not_code:
        cp SCREEN_RESULT
        jr nz,shell_softkey_f1_ready
        ld hl,softkey_qr
shell_softkey_f1_ready:
        ld b,2
        ld c,58
        call ui_draw_text
        ld hl,softkey_empty
        ld b,30
        ld c,58
        call ui_draw_text
        ld hl,softkey_empty
        ld a,(current_screen)
        or a
        jr nz,shell_softkey_f3_ready
        ld hl,softkey_code
shell_softkey_f3_ready:
        ld b,56
        ld c,58
        call ui_draw_text
        ld hl,softkey_sync
        ld a,(current_screen)
        cp SCREEN_CODE
        ld hl,softkey_empty
        jr z,shell_softkey_f4_ready
        cp SCREEN_RESULT
        jr nz,shell_softkey_f4_ready
        ld hl,softkey_cable
shell_softkey_f4_ready:
        ld b,81
        ld c,58
        call ui_draw_text
        ld hl,softkey_sync
        ld a,(current_screen)
        cp SCREEN_CODE
        ld hl,softkey_exit
        jr z,shell_softkey_f5_ready
        cp SCREEN_RESULT
        jr nz,shell_softkey_f5_ready
        ld hl,softkey_cable
shell_softkey_f5_ready:
        ld b,107
        ld c,58
        call ui_draw_text
        ld hl,softkey_user
        ld a,(current_screen)
        cp SCREEN_CODE
        jr z,shell_softkeys_done
        ld b,81
        ld c,58
        call ui_draw_text
shell_softkeys_done:
        jp ui_mode_set

current_screen:         defb 0
current_focus:          defb 0
previous_focus:         defb 0
device_enrolled:        defb 0
device_id_length:       defb 0
device_id_value:        defs 17,0
shell_code_length:       defb 0
shell_code_status:       defb 0
shell_code_entries_left: defb 0
shell_code_entry_offset: defw 0
sce1_crc_pointer:       defw 0
sce1_record_length:     defw 0
sce1_record:            defs 40,0
shell_code_digits:       defs 7,0
shell_code_font_pointer: defw 0
shell_code_font_x:       defb 0
shell_code_font_remaining:defb 0
shell_row_text:         defw 0
shell_row_index:        defb 0
shell_row_y:            defb 0
shell_header_title:     defw 0
shell_header_context:   defw 0
local_active_slot:      defb 0xFF
local_candidate_slot:   defb 0
local_target_slot:      defb 0
local_state_found_any:  defb 0
local_state_error:      defb 0
local_generation:       defb 0,0,0,0
local_candidate_generation: defb 0,0,0,0
local_next_generation:  defb 0,0,0,0
local_candidate_screen: defb 0
local_candidate_focus:  defb 0
local_target_name:      defw 0
local_copy_destination: defw 0
runtime_module_mask:    defw 0
runtime_module_pointer: defw 0
runtime_code_length:    defw 0
runtime_expected_crc:   defw 0
runtime_crc_value:      defw 0
runtime_crc_offset:     defw 0
runtime_crc_remaining:  defw 0
sci1_magic:             defb "SCI1"
scl1_magic:             defb "SCL1"
scco_magic:             defb "SCCO"
; Exact reviewed TI-86 Program + executor header through SCX1 ABI.  Every
; shipped child begins at D75E after this fixed 21-byte executable envelope.
runtime_header_prefix:  defb 0x8E,0x28,0x00,0xC3,0x5E,0xD7,0x00,0x00,0x5D,0xD7,"SCX1",1
field_schema:           defb "schema",0
field_device_id:        defb "deviceId",0
identity_schema:        defb "school.calc.device-identity/v1",0
local_view_codes:       defb 0,1,4,7,6,11

; OP1 descriptors: type 0x0C, length, name, then zero padding to ten bytes.
dsid_name:      defb 0x0C,4,"DSID",0,0,0,0
dsinfo_name:    defb 0x0C,6,"DSINFO",0,0
dscode_name:    defb 0x0C,6,"DSCODE",0,0
dsentry_name:   defb 0x0C,7,"DSENTRY",0
local0_name:    defb 0x0C,8,"DSLOCAL0"
local1_name:    defb 0x0C,8,"DSLOCAL1"
sclearn_name:   defb 0x12,7,"SCLEARN",0
scqr_name:      defb 0x12,4,"SCQR",0,0,0,0
sccat_name:     defb 0x12,5,"SCCAT",0,0,0
scsync_name:    defb 0x12,6,"SCSYNC",0,0
scprof_name:    defb 0x12,6,"SCPROF",0,0
sctutor_name:   defb 0x12,7,"SCTUTOR",0
tutor_stage_name:defb 0x0C,6,"DSTNEW",0,0

shell_title:            defb "SCHOOLCALC",0
home_context:           defb "HOME",0
catalog_title:          defb "CATALOG",0
lesson_title:           defb "LESSON",0
sync_title:             defb "SYNC",0
sync_context:           defb "OFFLINE",0
result_title:           defb "RESULT",0
result_context:         defb "OFFLINE",0
code_title:              defb "CODE",0
code_context:            defb "OPEN",0
empty_context:          defb 0
home_continue:          defb "CONTINUE LESSON",0
home_courses:           defb "MY COURSES",0
home_catalog:           defb "CATALOG",0
home_sync:              defb "SYNC",0
result_score_prefix:    defb "SCORE ",0
result_review_line:     defb "REVIEW: RETRY QUIZ",0
result_mastered_line:   defb "MASTERED: NEXT",0
result_line_3:          defb "QR QUEUED / CABLE OFF",0
code_instruction:        defb "CONTINUE ON CALC",0
code_prompt:             defb "ENTER 6 DIGITS",0
code_ready:              defb "ENTER TO OPEN",0
code_missing:            defb "NOT INSTALLED - SYNC",0
code_busy:               defb "FINISH CURRENT WORK",0
code_opening:            defb "OPENING...",0
catalog_line_1:         defb "Catalog not installed.",0
catalog_line_2:         defb "Sync package required.",0
catalog_line_3:         defb "EXIT returns Home.",0
lesson_line_1:          defb "Module selected.",0
lesson_line_2:          defb "ENTER starts lesson.",0
lesson_line_3:          defb "EXIT returns to Catalog.",0
sync_identity_missing:  defb "Identity: required",0
sync_identity_ready:    defb "Identity: ready",0
sync_info_ready:        defb "LINK: OFFLINE",0
sync_status_idle:       defb "Safe recovery screen",0
sync_status_committed:  defb "Transfer: complete",0
sync_status_rejected:   defb "Transfer: stopped",0
sync_presence_idle:     defb "NO RELAY DETECTED",0
sync_presence_committed:defb "Relay session finished",0
sync_presence_rejected: defb "Queue/content preserved",0
sync_safety_safe:       defb "Safe to unplug",0
focus_chevron:          defb ">",0
softkey_home:           defb "HOME",0
softkey_qr:             defb " QR",0
softkey_sync:           defb "OFF",0
softkey_cable:          defb "CABLE",0
softkey_user:           defb "USER",0
softkey_code:           defb "CODE",0
softkey_open:           defb " OPEN",0
softkey_exit:           defb "EXIT",0
softkey_empty:          defb 0
; Direct-input scan code pairs for the TI-86's physical numeric keypad.
; Source groups: Arrow=$FE, KG5=$FD, KG4=$FB, KG3=$F7, KG2=$EF.
shell_code_digit_keys:
        defb 0x21,'0',0x22,'1',0x1A,'2',0x12,'3',0x23,'4'
        defb 0x1B,'5',0x13,'6',0x24,'7',0x1C,'8',0x14,'9'
shell_result_score:     defs 20,0

UI_RENDER_COPIED_TEXT_LENGTH: equ 0
include "record-reader.asm"
include "sync-commit.asm"
UI_RENDER_PROFILE_FULL: equ 0
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/schoolcalc-shell-data.inc"
include "generated/ui-shell-assets.inc"

end
