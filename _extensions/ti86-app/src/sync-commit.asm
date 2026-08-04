; Calculator-side SchoolCalc staged-sync transaction.
;
; The relay writes immutable artifacts and DSCATNEW first, then DSSYNC last.
; This module validates the complete fixed-layout SCM1 manifest, all installed
; SCP1 envelopes, and the selected SCC1 Catalog before mutating calculator
; state. Catalog and install snapshots are copied to inactive slots; one SCL1
; generation selects both and is the durable commit point.

SC_SYNC_NONE:                  equ 0
SC_SYNC_COMMITTED:             equ 1
SC_SYNC_REJECTED:              equ 2

SCM_DEVICE_LENGTH_OFFSET:      equ 7
SCM_DEVICE_OFFSET:             equ 8
SCM_GENERATION_KEY_OFFSET:     equ 24
SCM_CATALOG_KEY_OFFSET:        equ 34
SCM_FLAGS_OFFSET:              equ 44
SCM_BLOCKER_MASK_OFFSET:       equ 45
SCM_INSTALLED_COUNT_OFFSET:    equ 47
SCM_INSTALLED_FIRST_OFFSET:    equ 48
SCM_ARTIFACT_DESCRIPTOR_BYTES: equ 52
SCM_REMOVAL_DESCRIPTOR_BYTES:  equ 18
SCM_MAX_RECORD_BYTES:          equ 6144
SCA_MAX_RECORD_BYTES:          equ 544
SCQ_MAX_RECORD_BYTES:          equ 6144
SCQ_MAX_RECORDS:               equ 170
SCD_MAX_RECORDS:               equ 32
SYNC_ACK_BUFFER:               equ _plotSScreen + 256

SCL_FLAG_CATALOG_SLOT_ONE:     equ 0x20
SCL_FLAG_INSTALL_SLOT_ONE:     equ 0x40
SCL_FLAG_SYNC_SNAPSHOT:        equ 0x80

sync_commit_staged:
        xor a
        ld (sync_status),a
        ld a,(device_enrolled)
        or a
        ret z
        call sync_validate_manifest
        jr nc,sync_commit_manifest_ready
        ; No DSSYNC is the ordinary steady state after a successful cleanup.
        ; It is not a stopped transfer and must leave the awareness UI idle.
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        jr sync_commit_rejected
sync_commit_manifest_ready:
        call sync_detect_committed
        jr c,sync_commit_rejected
        or a
        jr nz,sync_commit_cleanup
        call sync_validate_acknowledgement
        jr c,sync_commit_rejected
        call sync_validate_queue_ack
        jr c,sync_commit_rejected
        call sync_validate_catalog_source
        jr c,sync_commit_rejected
        call sync_commit_catalog
        jr c,sync_commit_rejected
        call sync_commit_installed
        jr c,sync_commit_rejected
        call sync_commit_queue
        jr c,sync_commit_rejected
        call sync_commit_local_state
        jr c,sync_commit_rejected

sync_commit_cleanup:
        ; DSINST is a repairable relay-facing copy. The selected DSINST0/1
        ; remains authoritative if this replacement is interrupted.
        ld hl,dssync_name
        ld de,dsinst_name
        ld bc,scm1_magic
        call sync_copy_record
        jr c,sync_commit_rejected
        ld a,(sync_manifest_flags)
        bit 0,a
        call nz,sync_apply_removals
        jr c,sync_commit_rejected
        ld hl,dscatnew_name
        call sync_delete_if_present
        ld hl,dsacknew_name
        call sync_delete_if_present
        ; The final marker is deliberately the last staging variable removed.
        ld hl,dssync_name
        call sync_delete_if_present
        ld a,SC_SYNC_COMMITTED
        ld (sync_status),a
        ret

sync_commit_rejected:
        ld a,(sync_status)
        or a
        ret nz
        ld a,SC_SYNC_REJECTED
        ld (sync_status),a
        ret

; Validate fixed SCM1 layout and every artifact in its complete installed set.
; No calculator variable is changed on this path.
sync_validate_manifest:
        ld hl,dssync_name
        ld de,scm1_magic
        call sc_envelope_open
        ret c
        ld hl,SCM_MAX_RECORD_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        ret c

        ld de,SCM_DEVICE_LENGTH_OFFSET
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(device_id_length)
        cp b
        jp nz,sync_validation_fail
        ld de,SCM_DEVICE_OFFSET
        ld hl,device_id_value
        ld b,16
sync_manifest_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_manifest_device_loop

        ld de,SCM_GENERATION_KEY_OFFSET
        ld hl,sync_generation_key
        call sync_copy_ten_record_bytes
        ret c
        ld hl,sync_generation_key
        call sync_validate_base32_key
        ret c
        ld de,SCM_CATALOG_KEY_OFFSET
        ld hl,sync_catalog_key
        call sync_copy_ten_record_bytes
        ret c
        ld hl,sync_catalog_key
        call sync_validate_base32_key
        ret c
        ld de,SCM_FLAGS_OFFSET
        call sc_record_read_byte
        ret c
        ld (sync_manifest_flags),a
        and 0xFC
        jp nz,sync_validation_fail
        ld de,SCM_BLOCKER_MASK_OFFSET
        call sc_record_read_byte
        ret c
        ld b,a
        inc de
        call sc_record_read_byte
        ret c
        or b
        ld b,a
        ld a,(sync_manifest_flags)
        bit 0,a
        jr z,sync_manifest_blocked
        ld a,b
        or a
        jp nz,sync_validation_fail
        jr sync_manifest_blocker_valid
sync_manifest_blocked:
        ld a,b
        or a
        jp z,sync_validation_fail
sync_manifest_blocker_valid:

        ld de,SCM_INSTALLED_COUNT_OFFSET
        call sc_record_read_byte
        ret c
        ld (sync_installed_count),a
        ld (sync_loop_count),a
        ld hl,SCM_INSTALLED_FIRST_OFFSET
        ld (sync_cursor),hl
sync_manifest_artifact_loop:
        ld a,(sync_loop_count)
        or a
        jr z,sync_manifest_artifacts_done
        call sync_validate_artifact_descriptor
        ret c
        ld a,(sync_loop_count)
        dec a
        ld (sync_loop_count),a
        jr sync_manifest_artifact_loop

sync_manifest_artifacts_done:
        ld hl,(sync_cursor)
        ld (sync_removal_count_offset),hl
        push hl
        pop de
        call sc_record_read_byte
        ret c
        ld (sync_removal_count),a
        inc de
        ld (sync_removal_first_offset),de
        ld (sync_loop_count),a
sync_manifest_removal_loop:
        ld a,(sync_loop_count)
        or a
        jr z,sync_manifest_removals_done
        call sync_validate_removal_descriptor
        ret c
        ld a,(sync_loop_count)
        dec a
        ld (sync_loop_count),a
        jr sync_manifest_removal_loop

sync_manifest_removals_done:
        ; Copy the bounded ACK suffix to scratch RAM. A 6 KiB SCQ1 can contain
        ; at most 170 minimum-sized SCR1 records, so 510 bytes is sufficient.
        ld de,(sync_cursor)
        call sc_record_read_byte
        ret c
        ld (sync_ack_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp nz,sync_validation_fail
        ld a,(sync_ack_count)
        cp SCQ_MAX_RECORDS + 1
        jp nc,sync_validation_fail
        inc de
        ld hl,SYNC_ACK_BUFFER
        ld (sync_ack_pointer),hl
        ld a,(sync_ack_count)
        ld b,a
sync_manifest_ack_entry:
        ld a,b
        or a
        jr z,sync_manifest_ack_done
        push bc
        ld b,3
sync_manifest_ack_byte:
        call sc_record_read_byte
        jp c,sync_manifest_ack_copy_failed
        ld hl,(sync_ack_pointer)
        ld (hl),a
        inc hl
        ld (sync_ack_pointer),hl
        inc de
        djnz sync_manifest_ack_byte
        pop bc
        djnz sync_manifest_ack_entry
sync_manifest_ack_done:
        ; The manifest seals delivery intents independently from result ACKs.
        ; SCCAT retires only these request IDs from DSREQ; the shell validates
        ; the bounded suffix and preserves it in the committed DSINST copy.
        call sc_record_read_byte
        ret c
        ld (sync_request_ack_count),a
        cp SCD_MAX_RECORDS + 1
        jp nc,sync_validation_fail
        inc de
        ld b,a
sync_manifest_request_ack_entry:
        ld a,b
        or a
        jr z,sync_manifest_request_ack_done
        push bc
        ld b,3
sync_manifest_request_ack_byte:
        call sc_record_read_byte
        jp c,sync_manifest_request_ack_copy_failed
        inc de
        djnz sync_manifest_request_ack_byte
        pop bc
        djnz sync_manifest_request_ack_entry
sync_manifest_request_ack_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,sync_validation_fail
        ; A blocker manifest is status only. Never attempt its Catalog/install
        ; copies, particularly when the blocker says that storage is exhausted.
        ld a,(sync_manifest_flags)
        bit 0,a
        jr nz,sync_manifest_ready
        ld a,SC_SYNC_REJECTED
        ld (sync_status),a
        scf
        ret
sync_manifest_ready:
        or a
        ret
sync_manifest_ack_copy_failed:
        pop bc
        jp sync_validation_fail
sync_manifest_request_ack_copy_failed:
        pop bc
        jp sync_validation_fail

sync_validation_fail:
        scf
        ret

; Cursor points to one 52-byte installed descriptor.
sync_validate_artifact_descriptor:
        ld de,(sync_cursor)
        ld hl,sync_artifact_id + 8
        call sync_copy_ten_record_bytes
        ret c
        ld hl,sync_artifact_id + 8
        call sync_validate_base32_key
        ret c
        ld hl,(sync_cursor)
        ld de,10
        add hl,de
        push hl
        pop de
        ld hl,sync_artifact_name + 2
        call sync_copy_eight_record_bytes
        ret c
        ld hl,sync_artifact_name + 2
        call sync_validate_artifact_variable
        ret c
        ld hl,(sync_cursor)
        ld de,18
        add hl,de
        push hl
        pop de
        call sc_record_read_byte
        ret c
        ld (sync_expected_length),a
        inc de
        call sc_record_read_byte
        ret c
        ld (sync_expected_length + 1),a
        ld hl,(sync_cursor)
        ld de,SCM_ARTIFACT_DESCRIPTOR_BYTES
        add hl,de
        jp c,sync_validation_fail
        ld (sync_cursor),hl

        ld hl,sync_artifact_name
        ld de,scp1_magic
        call sc_record_open
        ret c
        ld hl,(sc_record_length)
        ld de,(sync_expected_length)
        or a
        sbc hl,de
        jp nz,sync_validation_fail
        ld de,(sc_record_root_offset)
        ld hl,field_schema
        call sc_map_find_literal
        ret c
        ld hl,package_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,sync_validation_fail
        ld de,(sc_record_root_offset)
        ld hl,field_artifact_id
        call sc_map_find_literal
        ret c
        ld hl,sync_artifact_id
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,sync_validation_fail
        or a
        ret

; Cursor points to one 18-byte removal descriptor. Validate only metadata;
; the old variable may already be absent on a cleanup retry.
sync_validate_removal_descriptor:
        ld de,(sync_cursor)
        ld hl,sync_artifact_id + 8
        call sync_copy_ten_record_bytes
        ret c
        ld hl,sync_artifact_id + 8
        call sync_validate_base32_key
        ret c
        ld hl,(sync_cursor)
        ld de,10
        add hl,de
        push hl
        pop de
        ld hl,sync_artifact_name + 2
        call sync_copy_eight_record_bytes
        ret c
        ld hl,sync_artifact_name + 2
        call sync_validate_artifact_variable
        ret c
        ld hl,(sync_cursor)
        ld de,SCM_REMOVAL_DESCRIPTOR_BYTES
        add hl,de
        ret c
        ld (sync_cursor),hl
        or a
        ret

; A selected SCL1 snapshot with the same keys and selected SCM1 generation is
; already committed. Return A=1. A missing snapshot returns A=0; corruption of
; a selected snapshot is an error (carry set).
sync_detect_committed:
        ld a,(SCL_FLAGS_ADDR)
        bit 7,a
        jr z,sync_not_committed
        ld hl,SCL_CATALOG_KEY_ADDR
        ld de,sync_catalog_key
        ld b,10
sync_committed_catalog_key_loop:
        ld a,(de)
        cp (hl)
        jr nz,sync_not_committed
        inc de
        inc hl
        djnz sync_committed_catalog_key_loop
        ld a,(SCL_FLAGS_ADDR)
        bit 6,a
        ld hl,dsinst0_name
        jr z,sync_committed_slot_ready
        ld hl,dsinst1_name
sync_committed_slot_ready:
        ld de,scm1_magic
        call sc_envelope_open
        ret c
        ld de,SCM_GENERATION_KEY_OFFSET
        ld hl,sync_generation_key
        ld b,10
sync_committed_generation_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jr nz,sync_not_committed
        inc de
        inc hl
        djnz sync_committed_generation_loop
        ld de,SCM_DEVICE_LENGTH_OFFSET
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(device_id_length)
        cp b
        jp nz,sync_validation_fail
        ld de,SCM_DEVICE_OFFSET
        ld hl,device_id_value
        ld b,16
sync_committed_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_committed_device_loop
        ld de,SCM_CATALOG_KEY_OFFSET
        ld hl,sync_catalog_key
        ld b,10
sync_committed_manifest_catalog_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_committed_manifest_catalog_loop
        call sync_validate_catalog_active
        ret c
        ld a,1
        or a
        ret
sync_not_committed:
        xor a
        ret

sync_validate_catalog_source:
        ld a,(sync_manifest_flags)
        bit 1,a
        ld hl,dscatnew_name
        jr nz,sync_validate_catalog
        jp sync_validate_catalog_active

sync_validate_catalog_active:
        ld a,(SCL_FLAGS_ADDR)
        bit 7,a
        jp z,sync_validation_fail
        bit 5,a
        ld hl,dscat0_name
        jr z,sync_validate_catalog
        ld hl,dscat1_name

sync_validate_catalog:
        ld de,scc1_magic
        call sc_record_open
        ret c
        ld de,(sc_record_root_offset)
        ld hl,field_schema
        call sc_map_find_literal
        ret c
        ld hl,catalog_schema
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,sync_validation_fail
        ld de,(sc_record_root_offset)
        ld hl,field_device_id
        call sc_map_find_literal
        ret c
        ld hl,device_id_value
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,sync_validation_fail
        ld de,(sc_record_root_offset)
        ld hl,field_generation_key
        call sc_map_find_literal
        ret c
        ld hl,sync_catalog_key
        call sc_node_string_equals_literal
        ret c
        or a
        jp z,sync_validation_fail
        or a
        ret

sync_commit_catalog:
        ld a,(SCL_FLAGS_ADDR)
        bit 7,a
        jr z,sync_catalog_first_slot
        and SCL_FLAG_CATALOG_SLOT_ONE
        jr z,sync_catalog_target_one
sync_catalog_first_slot:
        xor a
        ld (sync_catalog_target_slot),a
        ld de,dscat0_name
        jr sync_catalog_target_ready
sync_catalog_target_one:
        ld a,1
        ld (sync_catalog_target_slot),a
        ld de,dscat1_name
sync_catalog_target_ready:
        ld a,(sync_manifest_flags)
        bit 1,a
        jr z,sync_catalog_keep_active
        ld hl,dscatnew_name
        ld bc,scc1_magic
        jp sync_copy_record
sync_catalog_keep_active:
        ld a,(SCL_FLAGS_ADDR)
        and SCL_FLAG_CATALOG_SLOT_ONE
        jr z,sync_catalog_active_zero
        ld a,1
        ld (sync_catalog_target_slot),a
        or a
        ret
sync_catalog_active_zero:
        xor a
        ld (sync_catalog_target_slot),a
        ret

sync_commit_installed:
        ld a,(SCL_FLAGS_ADDR)
        bit 7,a
        jr z,sync_installed_first_slot
        and SCL_FLAG_INSTALL_SLOT_ONE
        jr z,sync_installed_target_one
sync_installed_first_slot:
        xor a
        ld (sync_installed_target_slot),a
        ld de,dsinst0_name
        jr sync_installed_target_ready
sync_installed_target_one:
        ld a,1
        ld (sync_installed_target_slot),a
        ld de,dsinst1_name
sync_installed_target_ready:
        ld hl,dssync_name
        ld bc,scm1_magic
        jp sync_copy_record

sync_commit_local_state:
        ld a,(SCL_FLAGS_ADDR)
        and 0x1F
        or SCL_FLAG_SYNC_SNAPSHOT
        ld b,a
        ld a,(sync_catalog_target_slot)
        or a
        jr z,sync_local_catalog_bit_ready
        ld a,b
        or SCL_FLAG_CATALOG_SLOT_ONE
        ld b,a
sync_local_catalog_bit_ready:
        ld a,(sync_installed_target_slot)
        or a
        jr z,sync_local_install_bit_ready
        ld a,b
        or SCL_FLAG_INSTALL_SLOT_ONE
        ld b,a
sync_local_install_bit_ready:
        ld a,b
        ld (SCL_FLAGS_ADDR),a
        ld hl,sync_catalog_key
        ld de,SCL_CATALOG_KEY_ADDR
        ld bc,10
        ldir
        call local_state_save
        ld a,(local_state_error)
        or a
        jr z,sync_local_state_committed
        ; Restore the in-RAM template from the still-authoritative old slot so
        ; a later navigation save cannot accidentally select orphan snapshots.
        call local_state_load
        scf
        ret
sync_local_state_committed:
        ret

; SCA1 independently mirrors the SCM1 acknowledgement suffix. Validate its
; device binding and exact sequence bytes before considering queue deletion.
sync_validate_acknowledgement:
        ld hl,dsacknew_name
        ld de,sca1_magic
        call sc_envelope_open
        ret c
        ld hl,SCA_MAX_RECORD_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(device_id_length)
        cp b
        jp nz,sync_validation_fail
        inc de
        ld hl,device_id_value
sync_ack_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_ack_device_loop
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(sync_ack_count)
        cp b
        jp nz,sync_validation_fail
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp nz,sync_validation_fail
        inc de
        ld hl,SYNC_ACK_BUFFER
        ld a,(sync_ack_count)
        ld (sync_loop_count),a
sync_ack_entry_loop:
        ld a,(sync_loop_count)
        or a
        jr z,sync_ack_end
        ld b,3
sync_ack_byte_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_ack_byte_loop
        ld a,(sync_loop_count)
        dec a
        ld (sync_loop_count),a
        jr sync_ack_entry_loop
sync_ack_end:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,sync_validation_fail
        ret

; v0 uses an atomic whole-batch queue acknowledgement. If every current SCQ1
; sequence appears in SCM1/SCA1, DSQ may be deleted. A partial batch remains
; byte-for-byte intact and safely replays through backend idempotency.
sync_validate_queue_ack:
        xor a
        ld (sync_queue_delete),a
        ld a,(sync_ack_count)
        or a
        ret z
        ld hl,dsq_name
        ld de,scq1_magic
        call sc_envelope_open
        jr nc,sync_queue_found
        ld a,(sc_record_error)
        cp SC_RECORD_ERROR_NOT_FOUND
        ret z
        scf
        ret
sync_queue_found:
        ld hl,SCQ_MAX_RECORD_BYTES
        ld de,(sc_record_length)
        or a
        sbc hl,de
        ret c
        ld de,7
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(device_id_length)
        cp b
        jp nz,sync_validation_fail
        inc de
        ld hl,device_id_value
sync_queue_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_queue_device_loop
        call sc_record_read_byte
        ret c
        ld (sync_queue_count),a
        inc de
        call sc_record_read_byte
        ret c
        or a
        jp nz,sync_validation_fail
        inc de
        ld a,(sync_queue_count)
        cp SCQ_MAX_RECORDS + 1
        jp nc,sync_validation_fail
        ld b,a
        ld a,(sync_ack_count)
        cp b
        jr z,sync_queue_count_matches
        xor a
        jr sync_queue_match_ready
sync_queue_count_matches:
        ld a,1
sync_queue_match_ready:
        ld (sync_queue_match),a
        ld hl,SYNC_ACK_BUFFER
        ld (sync_ack_pointer),hl
        ld a,(sync_queue_count)
        ld (sync_loop_count),a
sync_queue_record_loop:
        ld a,(sync_loop_count)
        or a
        jp z,sync_queue_records_done
        call sc_record_read_byte
        ret c
        ld l,a
        inc de
        call sc_record_read_byte
        ret c
        ld h,a
        inc de
        ld (sync_expected_length),hl
        ld (sync_queue_record_start),de
        add hl,de
        jp c,sync_validation_fail
        ld (sync_queue_record_end),hl
        push hl
        ld de,(sc_record_body_end)
        or a
        sbc hl,de
        pop hl
        jp nc,sync_queue_end_check
        jr sync_queue_bounds_ok
sync_queue_end_check:
        jp nz,sync_validation_fail
sync_queue_bounds_ok:
        ld de,(sync_queue_record_start)
        ld hl,8
        add hl,de
        push hl
        pop de
        call sc_record_read_byte
        ret c
        ld b,a
        ld a,(device_id_length)
        cp b
        jp nz,sync_validation_fail
        ld hl,(sync_expected_length)
        ld a,(device_id_length)
        add a,12
        ld e,a
        ld d,0
        or a
        sbc hl,de
        jp c,sync_validation_fail
        ld de,(sync_queue_record_start)
        ld hl,9
        add hl,de
        push hl
        pop de
        ld hl,device_id_value
        ld a,(device_id_length)
        ld b,a
sync_queue_record_device_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jp nz,sync_validation_fail
        inc de
        inc hl
        djnz sync_queue_record_device_loop
        ld a,(sync_queue_match)
        or a
        jr z,sync_queue_sequence_done
        ld hl,(sync_ack_pointer)
        ld b,3
sync_queue_sequence_loop:
        call sc_record_read_byte
        ret c
        cp (hl)
        jr z,sync_queue_sequence_equal
        xor a
        ld (sync_queue_match),a
sync_queue_sequence_equal:
        inc de
        inc hl
        djnz sync_queue_sequence_loop
        ld (sync_ack_pointer),hl
sync_queue_sequence_done:
        ld de,(sync_queue_record_end)
        ld a,(sync_loop_count)
        dec a
        ld (sync_loop_count),a
        jp sync_queue_record_loop
sync_queue_records_done:
        ld hl,(sc_record_body_end)
        or a
        sbc hl,de
        jp nz,sync_validation_fail
        ld a,(sync_queue_match)
        ld (sync_queue_delete),a
        ret

sync_commit_queue:
        ld a,(sync_queue_delete)
        or a
        ret z
        ld hl,dsq_name
        call sync_delete_if_present
        or a
        ret

sync_apply_removals:
        ld a,(sync_removal_count)
        or a
        ret z
        ld (sync_loop_count),a
        ld hl,(sync_removal_first_offset)
        ld (sync_cursor),hl
sync_apply_removal_loop:
        ; A deletion can relocate every remaining variable, including DSSYNC.
        ; Resolve the manifest again before reading the next descriptor.
        ld hl,dssync_name
        ld de,scm1_magic
        call sc_envelope_open
        ret c
        ld hl,(sync_cursor)
        ld de,10
        add hl,de
        push hl
        pop de
        ld hl,sync_artifact_name + 2
        call sync_copy_eight_record_bytes
        ret c
        ld hl,sync_artifact_name
        call sync_delete_if_present
        ld hl,(sync_cursor)
        ld de,SCM_REMOVAL_DESCRIPTOR_BYTES
        add hl,de
        ld (sync_cursor),hl
        ld a,(sync_loop_count)
        dec a
        ld (sync_loop_count),a
        jr nz,sync_apply_removal_loop
        or a
        ret

; HL source descriptor, DE target descriptor, BC expected magic.
sync_copy_record:
        ld (sync_copy_source),hl
        ld (sync_copy_target),de
        ld (sync_copy_magic),bc
        push de
        pop hl
        call sync_delete_if_present
        ld hl,(sync_copy_source)
        ld de,(sync_copy_magic)
        call sc_envelope_open
        ret c
        ld hl,(sc_record_length)
        ld (sync_copy_length),hl
        call _memchk
        or a
        jr nz,sync_copy_memory_ready
        ld de,(sync_copy_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jp c,sync_validation_fail
sync_copy_memory_ready:
        ld hl,(sync_copy_target)
        rst 0x20
        ld hl,(sync_copy_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (sync_copy_dest_addr),hl
        ld (sync_copy_dest_page),a
        ; Creating a String may relocate the source; resolve it again now.
        ld hl,(sync_copy_source)
        ld de,(sync_copy_magic)
        call sc_envelope_open
        jr c,sync_copy_delete_failed_target
        ld a,(sc_record_base_page)
        ld hl,(sc_record_base_addr)
        call _set_abs_src
        ld a,(sync_copy_dest_page)
        ld hl,(sync_copy_dest_addr)
        call _set_abs_dest
        xor a
        ld hl,(sync_copy_length)
        call _set_mm_bytes
        call _mm_ldir
        ld hl,(sync_copy_target)
        ld de,(sync_copy_magic)
        call sc_envelope_open
        jr c,sync_copy_delete_failed_target
        ld hl,(sc_record_length)
        ld de,(sync_copy_length)
        or a
        sbc hl,de
        ret z
sync_copy_delete_failed_target:
        ld hl,(sync_copy_target)
        call sync_delete_if_present
        scf
        ret

sync_delete_if_present:
        rst 0x20
        rst 0x10
        ret c
        call _delvar
        ret

; DE record offset, HL destination.
sync_copy_ten_record_bytes:
        ld b,10
        jr sync_copy_record_bytes
sync_copy_eight_record_bytes:
        ld b,8
sync_copy_record_bytes:
        call sc_record_read_byte
        ret c
        ld (hl),a
        inc hl
        inc de
        djnz sync_copy_record_bytes
        or a
        ret

; HL points to ten copied bytes.
sync_validate_base32_key:
        ld b,10
sync_validate_base32_loop:
        ld a,(hl)
        cp '2'
        jr c,sync_validate_base32_alpha
        cp '7' + 1
        jr c,sync_validate_base32_next
sync_validate_base32_alpha:
        cp 'A'
        jp c,sync_validation_fail
        cp 'Z' + 1
        jp nc,sync_validation_fail
sync_validate_base32_next:
        inc hl
        djnz sync_validate_base32_loop
        or a
        ret

; HL points to the eight-byte TI variable name (without descriptor prefix).
; The locator is not an independent claim: it must be exactly "DP" plus the
; first six characters of the already validated ten-character artifact key.
sync_validate_artifact_variable:
        ld a,(hl)
        cp 'D'
        jp nz,sync_validation_fail
        inc hl
        ld a,(hl)
        cp 'P'
        jp nz,sync_validation_fail
        inc hl
        ld de,sync_artifact_id + 8
        ld b,6
sync_validate_artifact_variable_loop:
        ld a,(de)
        cp (hl)
        jp nz,sync_validation_fail
sync_validate_artifact_variable_next:
        inc hl
        inc de
        djnz sync_validate_artifact_variable_loop
        or a
        ret

sync_status:                  defb SC_SYNC_NONE
sync_manifest_flags:          defb 0
sync_generation_key:          defs 10,0
sync_catalog_key:             defs 10,0
sync_installed_count:         defb 0
sync_removal_count:           defb 0
sync_loop_count:              defb 0
sync_catalog_target_slot:     defb 0
sync_installed_target_slot:   defb 0
sync_cursor:                  defw 0
sync_removal_count_offset:    defw 0
sync_removal_first_offset:    defw 0
sync_expected_length:         defw 0
sync_copy_source:             defw 0
sync_copy_target:             defw 0
sync_copy_magic:              defw 0
sync_copy_length:             defw 0
sync_copy_dest_page:          defb 0
sync_copy_dest_addr:          defw 0
sync_ack_count:               defb 0
sync_request_ack_count:       defb 0
sync_ack_pointer:             defw 0
sync_queue_count:             defb 0
sync_queue_match:             defb 0
sync_queue_delete:            defb 0
sync_queue_record_start:      defw 0
sync_queue_record_end:        defw 0

scm1_magic:            defb "SCM1"
sca1_magic:            defb "SCA1"
scq1_magic:            defb "SCQ1"
scc1_magic:            defb "SCC1"
scp1_magic:            defb "SCP1"
field_artifact_id:     defb "artifactId",0
field_generation_key: defb "generationKey",0
package_schema:        defb "school.calc.ti86-package/v2",0
catalog_schema:        defb "school.calc.catalog-projection/v1",0
sync_artifact_id:      defb "sc:ti86:",0,0,0,0,0,0,0,0,0,0,0

; Static and dynamic TI String descriptors (type, name length, eight bytes).
dssync_name:      defb 0x0C,6,"DSSYNC",0,0
dscatnew_name:    defb 0x0C,8,"DSCATNEW"
dsacknew_name:    defb 0x0C,8,"DSACKNEW"
dsq_name:         defb 0x0C,3,"DSQ",0,0,0,0,0
dscat0_name:      defb 0x0C,6,"DSCAT0",0,0
dscat1_name:      defb 0x0C,6,"DSCAT1",0,0
dsinst0_name:     defb 0x0C,7,"DSINST0",0
dsinst1_name:     defb 0x0C,7,"DSINST1",0
dsinst_name:      defb 0x0C,6,"DSINST",0,0
sync_artifact_name: defb 0x0C,8,0,0,0,0,0,0,0,0
