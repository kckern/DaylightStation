; SchoolCalc cooperative foreground cable-sync runtime.
;
; SCSYNC owns TI-86 port 7 only while this reviewed runtime is active. It
; initiates SCF1, carries one SCF1 frame in one ordinary TI DATA packet, and
; exposes a closed set of TI String variables to the relay. Every edge wait,
; packet, frame, operation sequence, chunk, and whole record is bounded.
; EXIT or CLEAR is polled directly while interrupts are disabled; every
; terminal path releases both link lines before restoring interrupts.

include "ti86asm.inc"

SCF_FRAME_HEADER_BYTES:      equ 10
SCF_FRAME_CRC_BYTES:         equ 2
SCF_FRAME_MAX_BYTES:         equ 268
SCF_PAYLOAD_MAX_BYTES:       equ 256
SCF_CHUNK_BYTES:             equ 128

SCF_TYPE_HELLO:              equ 0x01
SCF_TYPE_HELLO_ACK:          equ 0x02
SCF_TYPE_PHASE:              equ 0x03
SCF_TYPE_PING:               equ 0x04
SCF_TYPE_PONG:               equ 0x05
SCF_TYPE_READ_REQUEST:       equ 0x10
SCF_TYPE_VARIABLE_MISSING:   equ 0x11
SCF_TYPE_VARIABLE_BEGIN:     equ 0x12
SCF_TYPE_VARIABLE_CHUNK:     equ 0x13
SCF_TYPE_VARIABLE_END:       equ 0x14
SCF_TYPE_WRITE_BEGIN:        equ 0x20
SCF_TYPE_WRITE_READY:        equ 0x21
SCF_TYPE_WRITE_CHUNK:        equ 0x22
SCF_TYPE_WRITE_END:          equ 0x23
SCF_TYPE_VARIABLE_STORED:    equ 0x24
SCF_TYPE_ACK:                equ 0x30
SCF_TYPE_ERROR:              equ 0x31
SCF_TYPE_CANCEL:             equ 0x32
SCF_TYPE_COMPLETE:           equ 0x33

SCF_ERROR_INVALID_STATE:     equ 1
SCF_ERROR_INVALID_PAYLOAD:   equ 2
SCF_ERROR_UNEXPECTED_FRAME:  equ 3
SCF_ERROR_INVALID_SEQUENCE:  equ 4
SCF_ERROR_INVALID_NAME:      equ 5
SCF_ERROR_TOO_LARGE:         equ 6
SCF_ERROR_INVALID_OFFSET:    equ 7
SCF_ERROR_RECORD_CHECKSUM:   equ 8

SCF_COMPLETE_READY:          equ 1
SCF_COMPLETE_BLOCKED:        equ 2

TI_HOST_ID:                  equ 0x06
TI86_MACHINE_ID:             equ 0x86
TI_CMD_DATA:                 equ 0x15
TI_CMD_ACK:                  equ 0x56
TI_CMD_ERROR:                equ 0x5A
TI_PACKET_RETRIES:           equ 3

LINK_PORT:                   equ 7
KEY_PORT:                    equ 1
LINK_BOTH_RELEASED:          equ 0xC0
LINK_RED_LOW:                equ 0xD4
LINK_WHITE_LOW:              equ 0xE8
LINK_INPUT_BOTH_HIGH:        equ 3
LINK_INPUT_RED_LOW:          equ 2
LINK_INPUT_WHITE_LOW:        equ 1

LINK_ERROR_NONE:             equ 0
LINK_ERROR_TIMEOUT:          equ 1
LINK_ERROR_INVALID_EDGE:     equ 2
LINK_ERROR_CANCELLED:        equ 3
LINK_ERROR_PACKET:           equ 4
LINK_ERROR_CHECKSUM:         equ 5

SYNC_FAILURE_NONE:           equ 0
SYNC_FAILURE_LINK:           equ 1
SYNC_FAILURE_PROTOCOL:       equ 2

SYNC_TERM_READY:             equ 1
SYNC_TERM_BLOCKED:           equ 2
SYNC_TERM_CANCELLED:         equ 3
SYNC_TERM_DISCONNECTED:      equ 4
SYNC_TERM_PROTOCOL:          equ 5

READ_LIMIT_DSID:             equ 512
READ_LIMIT_DSINFO:           equ 4096
READ_LIMIT_DSINST:           equ 6144
READ_LIMIT_DSQ:              equ 6144
READ_LIMIT_DSREQ:            equ 2048
READ_LIMIT_DSTREQ:           equ 512
READ_LIMIT_DSENTRY:          equ 64
WRITE_LIMIT_DSUSRNEW:        equ 512
WRITE_LIMIT_DSCATNEW:        equ 5832
WRITE_LIMIT_DSACKNEW:        equ 544
WRITE_LIMIT_DSSYNC:          equ 6144
WRITE_LIMIT_DSTNEW:          equ 2048
WRITE_LIMIT_DSSTDNEW:        equ 512
WRITE_LIMIT_ARTIFACT:        equ 12288

org _asm_exec_ram

        nop
        jp sync_runtime_start
        defw 0
        defw sync_runtime_name
        defb "SCX1"
        defb 1                 ; runtime ABI
        defb 6                 ; closed registry code: foreground-sync
        defb 0
        defw 0
        defw 0
        defw 0

sync_runtime_name: defb 0

sync_runtime_start:
        ; SCHLCALC authenticates the immutable Program variable before TI-OS
        ; loads this mutable port-7 owner into the execution window.
        call _runindicoff
        call sync_generate_nonce
        call sync_reset_session
        call sync_render_waiting
        di
        call link_release_lines
        ld a,0xFF
        out (KEY_PORT),a
        call sync_send_hello
        jp c,sync_terminal_failure
        call sync_receive_hello_ack
        jp c,sync_terminal_failure
        ld a,1
        ld (sync_connected),a
        ld hl,1
        ld (sync_expected_sequence),hl
        call sync_render_connected

sync_event_loop:
        call scf_receive_long
        jp c,sync_terminal_failure
        call sync_require_expected_sequence
        jp c,sync_terminal_failure
        ld hl,(scf_rx_sequence)
        ld (sync_operation_sequence),hl
        ld a,(scf_rx_type)
        cp SCF_TYPE_PHASE
        jp z,sync_handle_phase
        cp SCF_TYPE_PING
        jp z,sync_handle_ping
        cp SCF_TYPE_READ_REQUEST
        jp z,sync_handle_read_request
        cp SCF_TYPE_WRITE_BEGIN
        jp z,sync_handle_write_begin
        cp SCF_TYPE_CANCEL
        jp z,sync_handle_peer_cancel
        cp SCF_TYPE_COMPLETE
        jp z,sync_handle_complete
        cp SCF_TYPE_ERROR
        jp z,sync_handle_peer_error
        ld a,SCF_ERROR_UNEXPECTED_FRAME
        call sync_mark_protocol_error
        jp sync_terminal_failure

; ---------------------------------------------------------------------------
; Session negotiation and operation dispatch

sync_reset_session:
        xor a
        ld (sync_connected),a
        ld (sync_safe_to_unplug),a
        ld (sync_cancel_requested),a
        ld (sync_failure_kind),a
        ld (sync_protocol_code),a
        ld (sync_write_active),a
        ld (link_error),a
        ld (sync_phase),a
        ld (sync_direction),a
        ld (sync_items_completed),a
        ld (sync_items_total),a
        ld hl,0
        ld (sync_transfer_offset),hl
        ret

sync_generate_nonce:
        ; This nonce is correlation, not cryptographic identity. Mix live free
        ; memory, the refresh register, stack position, and this SCX1 checksum
        ; so consecutive launches do not normally reuse a stale HELLO value.
        call _memchk
        ld (sync_nonce),hl
        ld (sync_nonce + 2),a
        ld a,r
        or 1
        ld (sync_nonce + 3),a
        ld hl,0
        add hl,sp
        ld (sync_nonce + 4),hl
        ld hl,(_asm_exec_ram + 12)
        ld (sync_nonce + 6),hl
        ret

sync_send_hello:
        ld hl,scf_tx_frame + SCF_FRAME_HEADER_BYTES
        ld (hl),1               ; protocol version
        inc hl
        ld (hl),0x86            ; platform: TI-86
        inc hl
        ld (hl),0x0B            ; variable I/O + phase + heartbeat
        inc hl
        ld (hl),0
        inc hl
        ld (hl),SCF_CHUNK_BYTES
        inc hl
        ld (hl),0
        inc hl
        ld de,sync_nonce
        ld bc,8
        ex de,hl
        ldir
        ld a,SCF_TYPE_HELLO
        ld hl,0
        ld bc,14
        jp scf_send

sync_receive_hello_ack:
        call scf_receive_short
        ret c
        ld a,(scf_rx_type)
        cp SCF_TYPE_HELLO_ACK
        jr nz,sync_hello_unexpected
        ld hl,(scf_rx_sequence)
        ld a,h
        or l
        jr nz,sync_hello_sequence
        ld hl,(scf_rx_payload_length)
        ld de,14
        or a
        sbc hl,de
        jr nz,sync_hello_payload
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld a,(hl)
        cp 1
        jr nz,sync_hello_payload
        inc hl
        ld a,(hl)
        cp 0x86
        jr nz,sync_hello_payload
        inc hl
        ld a,(hl)
        cp 0x0B
        jr nz,sync_hello_payload
        inc hl
        ld a,(hl)
        or a
        jr nz,sync_hello_payload
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld a,d
        or a
        jr nz,sync_hello_payload
        ld a,e
        or a
        jr z,sync_hello_payload
        cp SCF_CHUNK_BYTES + 1
        jr nc,sync_hello_payload
        ld (sync_chunk_bytes),de
        inc hl
        ld de,sync_nonce
        ld b,8
sync_hello_nonce_loop:
        ld a,(de)
        cp (hl)
        jr nz,sync_hello_payload
        inc de
        inc hl
        djnz sync_hello_nonce_loop
        or a
        ret
sync_hello_unexpected:
        ld a,SCF_ERROR_UNEXPECTED_FRAME
        jp sync_mark_protocol_error
sync_hello_sequence:
        ld a,SCF_ERROR_INVALID_SEQUENCE
        jp sync_mark_protocol_error
sync_hello_payload:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        jp sync_mark_protocol_error

sync_require_expected_sequence:
        ld hl,(scf_rx_sequence)
        ld de,(sync_expected_sequence)
        or a
        sbc hl,de
        ret z
        ld a,SCF_ERROR_INVALID_SEQUENCE
        jp sync_mark_protocol_error

sync_advance_sequence:
        ld hl,(sync_expected_sequence)
        inc hl
        ld (sync_expected_sequence),hl
        ret

sync_handle_phase:
        ld hl,(scf_rx_payload_length)
        ld de,5
        or a
        sbc hl,de
        jr nz,sync_phase_invalid
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld a,(hl)
        or a
        jr z,sync_phase_invalid
        cp 14
        jr nc,sync_phase_invalid
        ld (sync_phase),a
        inc hl
        ld a,(hl)
        cp 5
        jr nc,sync_phase_invalid
        ld (sync_direction),a
        inc hl
        ld a,(hl)
        ld (sync_items_completed),a
        inc hl
        ld a,(hl)
        ld (sync_items_total),a
        ld b,a
        ld a,(sync_items_completed)
        ld c,a
        ld a,b
        or a
        jr nz,sync_phase_nonzero_total
        ld a,c
        or a
        jr nz,sync_phase_invalid
        jr sync_phase_progress_valid
sync_phase_nonzero_total:
        ld a,c
        cp b
        jr c,sync_phase_progress_valid
        jr z,sync_phase_progress_valid
        jr sync_phase_invalid
sync_phase_progress_valid:
        inc hl
        ld a,(hl)
        cp 2
        jr nc,sync_phase_invalid
        ld (sync_safe_to_unplug),a
        call sync_render_phase
        ld a,SCF_TYPE_PHASE
        ld hl,0
        call sync_send_ack
        jp c,sync_terminal_failure
        call sync_advance_sequence
        jp sync_event_loop
sync_phase_invalid:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        call sync_mark_protocol_error
        jp sync_terminal_failure

sync_handle_ping:
        ld hl,(scf_rx_payload_length)
        ld de,8
        or a
        sbc hl,de
        jr nz,sync_ping_invalid
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld de,scf_tx_frame + SCF_FRAME_HEADER_BYTES
        ld bc,8
        ldir
        ld a,SCF_TYPE_PONG
        ld hl,(sync_operation_sequence)
        ld bc,8
        call scf_send
        jp c,sync_terminal_failure
        call sync_advance_sequence
        jp sync_event_loop
sync_ping_invalid:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        call sync_mark_protocol_error
        jp sync_terminal_failure

sync_handle_peer_cancel:
        ld hl,(scf_rx_payload_length)
        ld a,h
        or l
        jr nz,sync_peer_terminal_invalid
        ld a,SCF_TYPE_CANCEL
        ld hl,0
        call sync_send_ack
        call sync_delete_partial_write
        call sync_release_transport
        ld a,SYNC_TERM_CANCELLED
        call sync_render_terminal
        jp sync_terminal_wait

sync_handle_complete:
        ld hl,(scf_rx_payload_length)
        ld de,1
        or a
        sbc hl,de
        jr nz,sync_peer_terminal_invalid
        ld a,(scf_rx_frame + SCF_FRAME_HEADER_BYTES)
        cp SCF_COMPLETE_READY
        jr z,sync_complete_valid
        cp SCF_COMPLETE_BLOCKED
        jr nz,sync_peer_terminal_invalid
sync_complete_valid:
        ld (sync_complete_code),a
        ld a,1
        ld (sync_safe_to_unplug),a
        ld a,SCF_TYPE_COMPLETE
        ld hl,0
        call sync_send_ack
        call sync_release_transport
        ld a,(sync_complete_code)
        cp SCF_COMPLETE_READY
        ld a,SYNC_TERM_READY
        jr z,sync_complete_render
        ld a,SYNC_TERM_BLOCKED
sync_complete_render:
        call sync_render_terminal
        jp sync_terminal_wait

sync_handle_peer_error:
        ld hl,(scf_rx_payload_length)
        ld de,4
        or a
        sbc hl,de
        jr nz,sync_peer_terminal_invalid
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld a,(hl)
        or a
        jr z,sync_peer_terminal_invalid
        cp 14
        jr nc,sync_peer_terminal_invalid
        inc hl
        ld a,(hl)
        call scf_type_valid
        jr c,sync_peer_terminal_invalid
        call sync_delete_partial_write
        call sync_release_transport
        ld a,SYNC_TERM_PROTOCOL
        call sync_render_terminal
        jp sync_terminal_wait

sync_peer_terminal_invalid:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        call sync_mark_protocol_error
        jp sync_terminal_failure

; ---------------------------------------------------------------------------
; Closed variable-name boundary

; Parse a name payload at rx payload start. A is the required trailing byte
; count (zero for READ_REQUEST, four for WRITE_BEGIN descriptor).
sync_parse_name:
        ld (sync_name_trailer),a
        ld hl,(scf_rx_payload_length)
        ld a,h
        or a
        jr nz,sync_name_invalid
        ld a,l
        cp 2
        jr c,sync_name_invalid
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld a,(hl)
        or a
        jr z,sync_name_invalid
        cp 9
        jr nc,sync_name_invalid
        ld (sync_name_length),a
        ld b,a
        inc a
        ld c,a
        ld a,(sync_name_trailer)
        add a,c
        ld c,a
        ld a,(scf_rx_payload_length)
        cp c
        jr nz,sync_name_invalid

        ld hl,sync_current_name
        ld (hl),0x0C
        inc hl
        ld a,b
        ld (hl),a
        inc hl
        push hl
        xor a
        ld c,8
sync_name_clear_loop:
        ld (hl),a
        inc hl
        dec c
        jr nz,sync_name_clear_loop
        pop de
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES + 1
sync_name_copy_loop:
        ld a,(hl)
        cp '0'
        jr c,sync_name_invalid
        cp '9' + 1
        jr c,sync_name_character_ok
        cp 'A'
        jr c,sync_name_invalid
        cp 'Z' + 1
        jr nc,sync_name_invalid
sync_name_character_ok:
        ld (de),a
        inc de
        inc hl
        djnz sync_name_copy_loop
        ld a,(sync_name_length)
        inc a
        ld (sync_name_payload_length),a
        or a
        ret
sync_name_invalid:
        ld a,SCF_ERROR_INVALID_NAME
        jp sync_mark_protocol_error

; A = expected length, HL = expected ASCII bytes. Return Z when equal.
sync_name_equals:
        ld b,a
        ld a,(sync_name_length)
        cp b
        ret nz
        ld de,sync_current_name + 2
sync_name_equals_loop:
        ld a,(de)
        cp (hl)
        ret nz
        inc de
        inc hl
        djnz sync_name_equals_loop
        xor a
        ret

sync_select_read_limit:
        ld a,4
        ld hl,sync_ascii_dsid
        call sync_name_equals
        jr z,sync_read_limit_dsid
        ld a,6
        ld hl,sync_ascii_dsinfo
        call sync_name_equals
        jr z,sync_read_limit_dsinfo
        ld a,6
        ld hl,sync_ascii_dsinst
        call sync_name_equals
        jr z,sync_read_limit_dsinst
        ld a,3
        ld hl,sync_ascii_dsq
        call sync_name_equals
        jr z,sync_read_limit_dsq
        ld a,5
        ld hl,sync_ascii_dsreq
        call sync_name_equals
        jr z,sync_read_limit_dsreq
        ld a,6
        ld hl,sync_ascii_dstreq
        call sync_name_equals
        jr z,sync_read_limit_dstreq
        ld a,7
        ld hl,sync_ascii_dsentry
        call sync_name_equals
        jr z,sync_read_limit_dsentry
        jp sync_name_not_allowed
sync_read_limit_dsid:
        ld hl,READ_LIMIT_DSID
        jr sync_store_name_limit
sync_read_limit_dsinfo:
        ld hl,READ_LIMIT_DSINFO
        jr sync_store_name_limit
sync_read_limit_dsinst:
        ld hl,READ_LIMIT_DSINST
        jr sync_store_name_limit
sync_read_limit_dsq:
        ld hl,READ_LIMIT_DSQ
        jr sync_store_name_limit
sync_read_limit_dsreq:
        ld hl,READ_LIMIT_DSREQ
        jr sync_store_name_limit
sync_read_limit_dstreq:
        ld hl,READ_LIMIT_DSTREQ
        jr sync_store_name_limit
sync_read_limit_dsentry:
        ld hl,READ_LIMIT_DSENTRY
sync_store_name_limit:
        ld (sync_name_limit),hl
        or a
        ret

sync_select_write_limit:
        ld a,8
        ld hl,sync_ascii_dsusrnew
        call sync_name_equals
        jr z,sync_write_limit_profiles
        ld a,8
        ld hl,sync_ascii_dscatnew
        call sync_name_equals
        jr z,sync_write_limit_catalog
        ld a,8
        ld hl,sync_ascii_dsacknew
        call sync_name_equals
        jr z,sync_write_limit_ack
        ld a,6
        ld hl,sync_ascii_dssync
        call sync_name_equals
        jr z,sync_write_limit_manifest
        ld a,6
        ld hl,sync_ascii_dstnew
        call sync_name_equals
        jr z,sync_write_limit_interaction
        ld a,8
        ld hl,sync_ascii_dsstdnew
        call sync_name_equals
        jr z,sync_write_limit_study
        call sync_validate_artifact_name
        jp c,sync_name_not_allowed
        ld hl,WRITE_LIMIT_ARTIFACT
        jr sync_store_name_limit
sync_write_limit_catalog:
        ld hl,WRITE_LIMIT_DSCATNEW
        jr sync_store_name_limit
sync_write_limit_profiles:
        ld hl,WRITE_LIMIT_DSUSRNEW
        jr sync_store_name_limit
sync_write_limit_ack:
        ld hl,WRITE_LIMIT_DSACKNEW
        jr sync_store_name_limit
sync_write_limit_manifest:
        ld hl,WRITE_LIMIT_DSSYNC
        jr sync_store_name_limit
sync_write_limit_interaction:
        ld hl,WRITE_LIMIT_DSTNEW
        jr sync_store_name_limit
sync_write_limit_study:
        ld hl,WRITE_LIMIT_DSSTDNEW
        jr sync_store_name_limit

sync_validate_artifact_name:
        ld a,(sync_name_length)
        cp 8
        jr nz,sync_artifact_name_invalid
        ld hl,sync_current_name + 2
        ld a,(hl)
        cp 'D'
        jr nz,sync_artifact_name_invalid
        inc hl
        ld a,(hl)
        cp 'P'
        jr nz,sync_artifact_name_invalid
        inc hl
        ld b,6
sync_artifact_name_loop:
        ld a,(hl)
        cp '2'
        jr c,sync_artifact_name_alpha
        cp '7' + 1
        jr c,sync_artifact_name_character_ok
sync_artifact_name_alpha:
        cp 'A'
        jr c,sync_artifact_name_invalid
        cp 'Z' + 1
        jr nc,sync_artifact_name_invalid
sync_artifact_name_character_ok:
        inc hl
        djnz sync_artifact_name_loop
        or a
        ret
sync_artifact_name_invalid:
        scf
        ret

sync_name_not_allowed:
        ld a,SCF_ERROR_INVALID_NAME
        jp sync_mark_protocol_error

; ---------------------------------------------------------------------------
; Calculator-to-relay variable reads

sync_handle_read_request:
        xor a
        call sync_parse_name
        jp c,sync_terminal_failure
        call sync_select_read_limit
        jp c,sync_terminal_failure
        ld hl,sync_current_name
        rst 0x20
        rst 0x10
        jp c,sync_read_missing
        call _ex_ahl_bde
        call _get_word_ahl
        ld (sync_record_length),de
        ld (sync_record_base_addr),hl
        ld (sync_record_base_page),a
        ld a,d
        or e
        jp z,sync_read_invalid
        ld hl,(sync_name_limit)
        or a
        sbc hl,de
        jp c,sync_read_too_large
        call sync_calculate_record_crc
        jp c,sync_terminal_failure
        ld hl,(sync_record_crc)
        ld (sync_record_expected_crc),hl

        call sync_copy_name_payload_to_tx
        ld a,(sync_name_payload_length)
        ld l,a
        ld h,0
        ld de,scf_tx_frame + SCF_FRAME_HEADER_BYTES
        add hl,de
        ld de,(sync_record_length)
        ld (hl),e
        inc hl
        ld (hl),d
        inc hl
        ld de,(sync_record_crc)
        ld (hl),e
        inc hl
        ld (hl),d
        ld a,(sync_name_payload_length)
        add a,4
        ld c,a
        ld b,0
        ld a,SCF_TYPE_VARIABLE_BEGIN
        ld hl,(sync_operation_sequence)
        call scf_send
        jp c,sync_terminal_failure
        ld a,SCF_TYPE_VARIABLE_BEGIN
        ld hl,0
        call sync_wait_ack
        jp c,sync_terminal_failure

        ld hl,0
        ld (sync_transfer_offset),hl
sync_read_chunk_loop:
        call sync_set_chunk_length
        jr z,sync_read_end
        call sync_copy_record_chunk_to_tx
        ld hl,(sync_transfer_offset)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES),hl
        ld hl,(sync_chunk_length)
        ld de,2
        add hl,de
        ld b,h
        ld c,l
        ld a,SCF_TYPE_VARIABLE_CHUNK
        ld hl,(sync_operation_sequence)
        call scf_send
        jp c,sync_terminal_failure
        ld hl,(sync_transfer_offset)
        ld de,(sync_chunk_length)
        add hl,de
        ld (sync_transfer_offset),hl
        ld a,SCF_TYPE_VARIABLE_CHUNK
        call sync_wait_ack
        jp c,sync_terminal_failure
        jp sync_read_chunk_loop

sync_read_end:
        call sync_build_transfer_end_payload
        ld a,SCF_TYPE_VARIABLE_END
        ld hl,(sync_operation_sequence)
        ld bc,4
        call scf_send
        jp c,sync_terminal_failure
        ld a,SCF_TYPE_VARIABLE_END
        ld hl,(sync_record_length)
        call sync_wait_ack
        jp c,sync_terminal_failure
        call sync_advance_sequence
        jp sync_event_loop

sync_read_missing:
        call sync_copy_name_payload_to_tx
        ld a,(sync_name_payload_length)
        ld c,a
        ld b,0
        ld a,SCF_TYPE_VARIABLE_MISSING
        ld hl,(sync_operation_sequence)
        call scf_send
        jp c,sync_terminal_failure
        ld a,SCF_TYPE_VARIABLE_MISSING
        ld hl,0
        call sync_wait_ack
        jp c,sync_terminal_failure
        call sync_advance_sequence
        jp sync_event_loop

sync_read_invalid:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        call sync_mark_protocol_error
        jp sync_terminal_failure
sync_read_too_large:
        ld hl,(sync_name_limit)
        ld (sync_transfer_offset),hl
        ld a,SCF_ERROR_TOO_LARGE
        call sync_mark_protocol_error
        jp sync_terminal_failure

sync_copy_name_payload_to_tx:
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        ld de,scf_tx_frame + SCF_FRAME_HEADER_BYTES
        ld a,(sync_name_payload_length)
        ld c,a
        ld b,0
        ldir
        ret

sync_calculate_record_crc:
        ld hl,0xFFFF
        ld (sync_record_crc),hl
        ld hl,0
        ld (sync_transfer_offset),hl
sync_crc_record_loop:
        call sync_set_chunk_length
        jr z,sync_crc_record_done
        call sync_copy_record_chunk_to_tx
        ld de,(sync_record_crc)
        ld hl,scf_tx_frame + SCF_FRAME_HEADER_BYTES + 2
        ld bc,(sync_chunk_length)
        call sync_crc_update
        ld (sync_record_crc),de
        ld hl,(sync_transfer_offset)
        ld de,(sync_chunk_length)
        add hl,de
        ld (sync_transfer_offset),hl
        jr sync_crc_record_loop
sync_crc_record_done:
        or a
        ret

; Return Z when complete; otherwise store min(remaining, negotiated chunk).
sync_set_chunk_length:
        ld hl,(sync_record_length)
        ld de,(sync_transfer_offset)
        or a
        sbc hl,de
        ld a,h
        or l
        jr z,sync_chunk_none
        ld de,(sync_chunk_bytes)
        ld a,h
        or a
        jr nz,sync_chunk_use_limit
        ld a,l
        cp e
        jr c,sync_chunk_use_remaining
        jr z,sync_chunk_use_remaining
sync_chunk_use_limit:
        ex de,hl
        jr sync_chunk_store
sync_chunk_use_remaining:
sync_chunk_store:
        ld (sync_chunk_length),hl
        ld a,1
        or a
        ret
sync_chunk_none:
        ld (sync_chunk_length),hl
        xor a
        ret

sync_copy_record_chunk_to_tx:
        ld hl,(sync_record_base_addr)
        ld de,(sync_transfer_offset)
        add hl,de
        ld a,(sync_record_base_page)
        adc a,0
        call _set_abs_src
        xor a
        ld hl,scf_tx_frame + SCF_FRAME_HEADER_BYTES + 2
        call _set_abs_dest
        xor a
        ld hl,(sync_chunk_length)
        call _set_mm_bytes
        jp _mm_ldir

; ---------------------------------------------------------------------------
; Relay-to-calculator staged writes

sync_handle_write_begin:
        ld a,4
        call sync_parse_name
        jp c,sync_terminal_failure
        call sync_select_write_limit
        jp c,sync_terminal_failure
        ld a,(sync_name_payload_length)
        ld l,a
        ld h,0
        ld de,scf_rx_frame + SCF_FRAME_HEADER_BYTES
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld (sync_record_length),de
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld (sync_record_expected_crc),de
        ld a,(sync_record_length)
        ld hl,(sync_record_length)
        ld a,h
        or l
        jp z,sync_write_invalid
        ld de,(sync_name_limit)
        ex de,hl
        or a
        sbc hl,de
        jp c,sync_write_too_large
        call sync_create_write_variable
        jp c,sync_terminal_failure
        ld hl,0xFFFF
        ld (sync_record_crc),hl
        ld hl,0
        ld (sync_transfer_offset),hl
        call sync_build_transfer_end_payload
        ld a,SCF_TYPE_WRITE_READY
        ld hl,(sync_operation_sequence)
        ld bc,4
        call scf_send
        jp c,sync_terminal_failure

sync_write_receive_loop:
        call scf_receive_short
        jp c,sync_terminal_failure
        ld hl,(scf_rx_sequence)
        ld de,(sync_operation_sequence)
        or a
        sbc hl,de
        jp nz,sync_write_sequence_invalid
        ld a,(scf_rx_type)
        cp SCF_TYPE_WRITE_CHUNK
        jp z,sync_handle_write_chunk
        cp SCF_TYPE_WRITE_END
        jp z,sync_handle_write_end
        ld a,SCF_ERROR_UNEXPECTED_FRAME
        call sync_mark_protocol_error
        jp sync_terminal_failure

sync_handle_write_chunk:
        ld hl,(scf_rx_payload_length)
        ld de,3
        or a
        sbc hl,de
        jp c,sync_write_chunk_invalid
        ld hl,(scf_rx_payload_length)
        ld de,SCF_CHUNK_BYTES + 3
        or a
        sbc hl,de
        jp nc,sync_write_chunk_invalid
        ld hl,(scf_rx_frame + SCF_FRAME_HEADER_BYTES)
        ld de,(sync_transfer_offset)
        or a
        sbc hl,de
        jp nz,sync_write_offset_invalid
        ld hl,(scf_rx_payload_length)
        ld de,2
        or a
        sbc hl,de
        ld (sync_chunk_length),hl
        ld de,(sync_chunk_bytes)
        ex de,hl
        or a
        sbc hl,de
        jp c,sync_write_chunk_invalid
        ld hl,(sync_transfer_offset)
        ld de,(sync_chunk_length)
        add hl,de
        jp c,sync_write_chunk_invalid
        ld de,(sync_record_length)
        ex de,hl
        or a
        sbc hl,de
        jp c,sync_write_chunk_invalid
        ld de,(sync_record_crc)
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES + 2
        ld bc,(sync_chunk_length)
        call sync_crc_update
        ld (sync_record_crc),de
        call sync_copy_rx_chunk_to_record
        ld hl,(sync_transfer_offset)
        ld de,(sync_chunk_length)
        add hl,de
        ld (sync_transfer_offset),hl
        ld a,SCF_TYPE_WRITE_CHUNK
        ld hl,(sync_transfer_offset)
        call sync_send_ack
        jp c,sync_terminal_failure
        jp sync_write_receive_loop

sync_handle_write_end:
        ld hl,(scf_rx_payload_length)
        ld de,4
        or a
        sbc hl,de
        jr nz,sync_write_invalid
        ld hl,(sync_transfer_offset)
        ld de,(sync_record_length)
        or a
        sbc hl,de
        jr nz,sync_write_offset_invalid
        ld hl,(scf_rx_frame + SCF_FRAME_HEADER_BYTES)
        ld de,(sync_record_length)
        or a
        sbc hl,de
        jr nz,sync_write_invalid
        ld hl,(scf_rx_frame + SCF_FRAME_HEADER_BYTES + 2)
        ld de,(sync_record_expected_crc)
        or a
        sbc hl,de
        jr nz,sync_write_invalid
        ld hl,(sync_record_crc)
        or a
        sbc hl,de
        jr nz,sync_write_crc_invalid
        xor a
        ld (sync_write_active),a
        call sync_build_transfer_end_payload
        ld a,SCF_TYPE_VARIABLE_STORED
        ld hl,(sync_operation_sequence)
        ld bc,4
        call scf_send
        jp c,sync_terminal_failure
        call sync_advance_sequence
        jp sync_event_loop

sync_write_sequence_invalid:
        ld a,SCF_ERROR_INVALID_SEQUENCE
        call sync_mark_protocol_error
        jp sync_terminal_failure
sync_write_offset_invalid:
        ld a,SCF_ERROR_INVALID_OFFSET
        call sync_mark_protocol_error
        jp sync_terminal_failure
sync_write_chunk_invalid:
sync_write_invalid:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        call sync_mark_protocol_error
        jp sync_terminal_failure
sync_write_too_large:
        ld hl,(sync_name_limit)
        ld (sync_transfer_offset),hl
        ld a,SCF_ERROR_TOO_LARGE
        call sync_mark_protocol_error
        jp sync_terminal_failure
sync_write_crc_invalid:
        ld a,SCF_ERROR_RECORD_CHECKSUM
        call sync_mark_protocol_error
        jp sync_terminal_failure

sync_create_write_variable:
        call link_release_lines
        ld hl,sync_current_name
        rst 0x20
        rst 0x10
        call nc,_delvar
        call _memchk
        or a
        jr nz,sync_write_memory_ready
        ld de,(sync_record_length)
        ld bc,32
        ex de,hl
        add hl,bc
        ex de,hl
        or a
        sbc hl,de
        jr c,sync_write_memory_fail
sync_write_memory_ready:
        ld hl,sync_current_name
        rst 0x20
        ld hl,(sync_record_length)
        call _createstrng
        call _ex_ahl_bde
        call _ahl_plus_2_pg3
        ld (sync_record_base_addr),hl
        ld (sync_record_base_page),a
        ld a,1
        ld (sync_write_active),a
        or a
        ret
sync_write_memory_fail:
        ld a,SCF_ERROR_TOO_LARGE
        jp sync_mark_protocol_error

sync_copy_rx_chunk_to_record:
        xor a
        ld hl,scf_rx_frame + SCF_FRAME_HEADER_BYTES + 2
        call _set_abs_src
        ld hl,(sync_record_base_addr)
        ld de,(sync_transfer_offset)
        add hl,de
        ld a,(sync_record_base_page)
        adc a,0
        call _set_abs_dest
        xor a
        ld hl,(sync_chunk_length)
        call _set_mm_bytes
        jp _mm_ldir

sync_delete_partial_write:
        ld a,(sync_write_active)
        or a
        ret z
        call link_release_lines
        ld hl,sync_current_name
        rst 0x20
        rst 0x10
        call nc,_delvar
        xor a
        ld (sync_write_active),a
        ret

sync_build_transfer_end_payload:
        ld hl,(sync_record_length)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES),hl
        ld hl,(sync_record_expected_crc)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES + 2),hl
        ret

; ---------------------------------------------------------------------------
; SCF1 framing and operation acknowledgements

; A = acknowledged type, HL = next contiguous offset.
sync_send_ack:
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES),a
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES + 1),hl
        ld a,SCF_TYPE_ACK
        ld hl,(sync_operation_sequence)
        ld bc,3
        jp scf_send

; A = expected acknowledged type, HL = expected next offset.
sync_wait_ack:
        ld (sync_expected_ack_type),a
        ld (sync_expected_ack_offset),hl
        call scf_receive_short
        ret c
        ld a,(scf_rx_type)
        cp SCF_TYPE_ACK
        jr nz,sync_ack_unexpected
        ld hl,(scf_rx_sequence)
        ld de,(sync_operation_sequence)
        or a
        sbc hl,de
        jr nz,sync_ack_sequence
        ld hl,(scf_rx_payload_length)
        ld de,3
        or a
        sbc hl,de
        jr nz,sync_ack_payload
        ld a,(scf_rx_frame + SCF_FRAME_HEADER_BYTES)
        ld b,a
        ld a,(sync_expected_ack_type)
        cp b
        jr nz,sync_ack_offset
        ld hl,(scf_rx_frame + SCF_FRAME_HEADER_BYTES + 1)
        ld de,(sync_expected_ack_offset)
        or a
        sbc hl,de
        jr nz,sync_ack_offset
        or a
        ret
sync_ack_unexpected:
        ld a,SCF_ERROR_UNEXPECTED_FRAME
        jp sync_mark_protocol_error
sync_ack_sequence:
        ld a,SCF_ERROR_INVALID_SEQUENCE
        jp sync_mark_protocol_error
sync_ack_payload:
        ld a,SCF_ERROR_INVALID_PAYLOAD
        jp sync_mark_protocol_error
sync_ack_offset:
        ld a,SCF_ERROR_INVALID_OFFSET
        jp sync_mark_protocol_error

; A = frame type, HL = sequence, BC = payload bytes already at tx+10.
scf_send:
        ld (scf_tx_type),a
        ld (scf_tx_sequence),hl
        ld (scf_tx_payload_length),bc
        ld hl,scf_magic
        ld de,scf_tx_frame
        ld bc,4
        ldir
        ld a,(scf_tx_type)
        ld (scf_tx_frame + 4),a
        xor a
        ld (scf_tx_frame + 5),a
        ld hl,(scf_tx_sequence)
        ld (scf_tx_frame + 6),hl
        ld hl,(scf_tx_payload_length)
        ld (scf_tx_frame + 8),hl
        ld de,SCF_PAYLOAD_MAX_BYTES + 1
        or a
        sbc hl,de
        jr nc,scf_send_invalid
        ld hl,(scf_tx_payload_length)
        ld de,SCF_FRAME_HEADER_BYTES
        add hl,de
        ld (scf_tx_crc_length),hl
        ld b,h
        ld c,l
        ld hl,scf_tx_frame
        call crc16_ccitt_false
        ld hl,scf_tx_frame
        ld bc,(scf_tx_crc_length)
        add hl,bc
        ld (hl),e
        inc hl
        ld (hl),d
        ld hl,(scf_tx_crc_length)
        inc hl
        inc hl
        ld (scf_tx_length),hl
        jp ti_send_frame
scf_send_invalid:
        ld a,LINK_ERROR_PACKET
        ld (link_error),a
        ld a,SYNC_FAILURE_LINK
        ld (sync_failure_kind),a
        scf
        ret

scf_receive_long:
        ld a,180
        ld (ti_packet_wait_rounds),a
        jr scf_receive
scf_receive_short:
        ld a,8
        ld (ti_packet_wait_rounds),a
scf_receive:
        call ti_receive_frame
        ret c
        ld hl,(scf_rx_length)
        ld de,SCF_FRAME_HEADER_BYTES + SCF_FRAME_CRC_BYTES
        or a
        sbc hl,de
        jr c,scf_receive_invalid
        ld hl,scf_rx_frame
        ld de,scf_magic
        ld b,4
scf_receive_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,scf_receive_invalid
        inc de
        inc hl
        djnz scf_receive_magic_loop
        ld a,(scf_rx_frame + 4)
        call scf_type_valid
        jr c,scf_receive_invalid
        ld (scf_rx_type),a
        ld a,(scf_rx_frame + 5)
        or a
        jr nz,scf_receive_invalid
        ld hl,(scf_rx_frame + 6)
        ld (scf_rx_sequence),hl
        ld hl,(scf_rx_frame + 8)
        ld (scf_rx_payload_length),hl
        ld de,SCF_PAYLOAD_MAX_BYTES + 1
        or a
        sbc hl,de
        jr nc,scf_receive_invalid
        ld hl,(scf_rx_payload_length)
        ld de,SCF_FRAME_HEADER_BYTES + SCF_FRAME_CRC_BYTES
        add hl,de
        ld de,(scf_rx_length)
        or a
        sbc hl,de
        jr nz,scf_receive_invalid
        ld hl,(scf_rx_length)
        dec hl
        dec hl
        ld (scf_rx_crc_length),hl
        ld de,scf_rx_frame
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld (scf_rx_expected_crc),de
        ld bc,(scf_rx_crc_length)
        ld hl,scf_rx_frame
        call crc16_ccitt_false
        ld hl,(scf_rx_expected_crc)
        or a
        sbc hl,de
        jr nz,scf_receive_checksum
        or a
        ret
scf_receive_checksum:
        ld a,LINK_ERROR_CHECKSUM
        ld (link_error),a
scf_receive_invalid:
        ld a,SYNC_FAILURE_PROTOCOL
        ld (sync_failure_kind),a
        ld a,SCF_ERROR_INVALID_PAYLOAD
        ld (sync_protocol_code),a
        ld a,SCF_TYPE_ERROR
        ld (sync_offending_type),a
        ld hl,0
        ld (sync_protocol_offset),hl
        scf
        ret

; Carry clear for every locked v1 frame type.
scf_type_valid:
        cp 1
        jr c,scf_type_invalid
        cp 6
        jr c,scf_type_ok
        cp 0x10
        jr c,scf_type_invalid
        cp 0x15
        jr c,scf_type_ok
        cp 0x20
        jr c,scf_type_invalid
        cp 0x25
        jr c,scf_type_ok
        cp 0x30
        jr c,scf_type_invalid
        cp 0x34
        jr c,scf_type_ok
scf_type_invalid:
        scf
        ret
scf_type_ok:
        or a
        ret

sync_mark_protocol_error:
        ld (sync_protocol_code),a
        ld a,(scf_rx_type)
        ld (sync_offending_type),a
        ld hl,(sync_transfer_offset)
        ld (sync_protocol_offset),hl
        ld a,SYNC_FAILURE_PROTOCOL
        ld (sync_failure_kind),a
        scf
        ret

sync_send_protocol_error_best_effort:
        ld a,(link_error)
        or a
        ret nz
        ld a,(sync_protocol_code)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES),a
        ld a,(sync_offending_type)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES + 1),a
        ld hl,(sync_protocol_offset)
        ld (scf_tx_frame + SCF_FRAME_HEADER_BYTES + 2),hl
        ld a,SCF_TYPE_ERROR
        ld hl,(scf_rx_sequence)
        ld bc,4
        call scf_send
        ret

; Update CRC-16/CCITT-FALSE. Input/output DE=CRC, HL=bytes, BC=count.
sync_crc_update:
        ld a,b
        or c
        ret z
        ld a,(hl)
        inc hl
        xor d
        ld d,a
        push bc
        ld b,8
sync_crc_update_bit:
        bit 7,d
        jr z,sync_crc_update_shift
        sla e
        rl d
        ld a,d
        xor 0x10
        ld d,a
        ld a,e
        xor 0x21
        ld e,a
        jr sync_crc_update_bit_done
sync_crc_update_shift:
        sla e
        rl d
sync_crc_update_bit_done:
        djnz sync_crc_update_bit
        pop bc
        dec bc
        jr sync_crc_update

; ---------------------------------------------------------------------------
; TI packet layer: one SCF1 frame per TI DATA packet

ti_send_frame:
        ld a,TI_PACKET_RETRIES
        ld (ti_retry_count),a
ti_send_frame_retry:
        call link_release_lines
        ld a,TI86_MACHINE_ID
        call link_send_byte
        ret c
        ld a,TI_CMD_DATA
        call link_send_byte
        ret c
        ld hl,(scf_tx_length)
        ld a,l
        call link_send_byte
        ret c
        ld hl,(scf_tx_length)
        ld a,h
        call link_send_byte
        ret c
        ld hl,0
        ld (ti_checksum),hl
        ld hl,scf_tx_frame
        ld (ti_data_pointer),hl
        ld hl,(scf_tx_length)
        ld (ti_data_remaining),hl
ti_send_data_loop:
        ld hl,(ti_data_remaining)
        ld a,h
        or l
        jr z,ti_send_checksum
        dec hl
        ld (ti_data_remaining),hl
        ld hl,(ti_data_pointer)
        ld a,(hl)
        inc hl
        ld (ti_data_pointer),hl
        push af
        ld e,a
        ld d,0
        ld hl,(ti_checksum)
        add hl,de
        ld (ti_checksum),hl
        pop af
        call link_send_byte
        ret c
        jr ti_send_data_loop
ti_send_checksum:
        ld hl,(ti_checksum)
        ld a,l
        call link_send_byte
        ret c
        ld hl,(ti_checksum)
        ld a,h
        call link_send_byte
        ret c
        call ti_receive_control
        ret c
        cp TI_CMD_ACK
        jr z,ti_packet_success
        cp TI_CMD_ERROR
        jp nz,ti_packet_invalid
        ld a,(ti_retry_count)
        dec a
        ld (ti_retry_count),a
        jr nz,ti_send_frame_retry
        ld a,LINK_ERROR_CHECKSUM
        jp ti_packet_fail_with_a

ti_receive_frame:
        ld a,TI_PACKET_RETRIES
        ld (ti_retry_count),a
ti_receive_frame_retry:
        call ti_receive_data_packet
        jr nc,ti_receive_frame_valid
        ld a,(link_error)
        cp LINK_ERROR_CHECKSUM
        ret nz
        call ti_send_error_control
        ret c
        ld a,(ti_retry_count)
        dec a
        ld (ti_retry_count),a
        jr nz,ti_receive_frame_retry
        scf
        ret
ti_receive_frame_valid:
        call ti_send_ack_control
        ret c
ti_packet_success:
        xor a
        ld (link_error),a
        ret

ti_receive_control:
        ld a,8
        ld (link_wait_rounds),a
        call link_receive_byte
        ret c
        cp TI_HOST_ID
        jp nz,ti_packet_invalid
        call link_receive_byte_short
        ret c
        ld (ti_control_command),a
        call link_receive_byte_short
        ret c
        or a
        jp nz,ti_packet_invalid
        call link_receive_byte_short
        ret c
        or a
        jp nz,ti_packet_invalid
        ld a,(ti_control_command)
        ret

ti_receive_data_packet:
        ld a,(ti_packet_wait_rounds)
        ld (link_wait_rounds),a
        call link_receive_byte
        ret c
        cp TI_HOST_ID
        jp nz,ti_receive_packet_invalid
        call link_receive_byte_short
        ret c
        cp TI_CMD_DATA
        jp nz,ti_receive_packet_invalid
        call link_receive_byte_short
        ret c
        ld (ti_received_length_low),a
        call link_receive_byte_short
        ret c
        ld h,a
        ld a,(ti_received_length_low)
        ld l,a
        ld (scf_rx_length),hl
        ld a,h
        or l
        jr z,ti_receive_packet_invalid
        ld de,SCF_FRAME_MAX_BYTES + 1
        or a
        sbc hl,de
        jr nc,ti_receive_packet_invalid
        ld hl,0
        ld (ti_checksum),hl
        ld hl,scf_rx_frame
        ld (ti_data_pointer),hl
        ld hl,(scf_rx_length)
        ld (ti_data_remaining),hl
ti_receive_data_loop:
        ld hl,(ti_data_remaining)
        ld a,h
        or l
        jr z,ti_receive_checksum
        dec hl
        ld (ti_data_remaining),hl
        call link_receive_byte_short
        ret c
        push af
        ld hl,(ti_data_pointer)
        ld (hl),a
        inc hl
        ld (ti_data_pointer),hl
        pop af
        ld e,a
        ld d,0
        ld hl,(ti_checksum)
        add hl,de
        ld (ti_checksum),hl
        jr ti_receive_data_loop
ti_receive_checksum:
        call link_receive_byte_short
        ret c
        ld (ti_received_checksum),a
        call link_receive_byte_short
        ret c
        ld (ti_received_checksum + 1),a
        ld de,(ti_received_checksum)
        ld hl,(ti_checksum)
        or a
        sbc hl,de
        jr nz,ti_receive_checksum_invalid
        or a
        ret
ti_receive_checksum_invalid:
        ld a,LINK_ERROR_CHECKSUM
        ld (link_error),a
        ld a,SYNC_FAILURE_LINK
        ld (sync_failure_kind),a
        scf
        ret
ti_receive_packet_invalid:
ti_packet_invalid:
        ld a,LINK_ERROR_PACKET
ti_packet_fail_with_a:
        ld (link_error),a
        ld a,SYNC_FAILURE_LINK
        ld (sync_failure_kind),a
        scf
        ret

ti_send_ack_control:
        ld a,TI_CMD_ACK
        jr ti_send_control
ti_send_error_control:
        ld a,TI_CMD_ERROR
ti_send_control:
        ld (ti_control_command),a
        call link_release_lines
        ld a,TI86_MACHINE_ID
        call link_send_byte
        ret c
        ld a,(ti_control_command)
        call link_send_byte
        ret c
        xor a
        call link_send_byte
        ret c
        xor a
        jp link_send_byte

; ---------------------------------------------------------------------------
; TI-86 link-port bit handshake, least-significant bit first

link_release_lines:
        ld a,LINK_BOTH_RELEASED
        out (LINK_PORT),a
        ret

link_send_byte:
        ld (link_tx_byte),a
        ld a,8
        ld (link_bit_count),a
link_send_byte_loop:
        ld a,(link_tx_byte)
        and 1
        call link_send_bit
        ret c
        ld hl,link_tx_byte
        srl (hl)
        ld a,(link_bit_count)
        dec a
        ld (link_bit_count),a
        jr nz,link_send_byte_loop
        or a
        ret

link_send_bit:
        ld (link_tx_bit),a
        ld a,LINK_INPUT_BOTH_HIGH
        call link_wait_exact
        ret c
        ld a,(link_tx_bit)
        or a
        ld a,LINK_RED_LOW
        jr z,link_send_assert
        ld a,LINK_WHITE_LOW
link_send_assert:
        out (LINK_PORT),a
        xor a
        call link_wait_exact
        jr c,link_send_bit_fail
        call link_release_lines
        ld a,LINK_INPUT_BOTH_HIGH
        call link_wait_exact
        ret
link_send_bit_fail:
        call link_release_lines
        scf
        ret

link_receive_byte_short:
        ld a,8
        ld (link_wait_rounds),a
link_receive_byte:
        xor a
        ld (link_rx_byte),a
        ld a,1
        ld (link_bit_mask),a
        ld a,8
        ld (link_bit_count),a
link_receive_byte_loop:
        call link_receive_bit
        ret c
        or a
        jr z,link_receive_bit_stored
        ld a,(link_bit_mask)
        ld hl,link_rx_byte
        or (hl)
        ld (hl),a
link_receive_bit_stored:
        ld hl,link_bit_mask
        sla (hl)
        ld a,8
        ld (link_wait_rounds),a
        ld a,(link_bit_count)
        dec a
        ld (link_bit_count),a
        jr nz,link_receive_byte_loop
        ld a,(link_rx_byte)
        or a
        ret

link_receive_bit:
        call link_wait_signal
        ret c
        cp LINK_INPUT_RED_LOW
        jr z,link_receive_zero
        ld a,1
        ld (link_rx_bit),a
        ld a,LINK_RED_LOW
        ld (link_ack_output),a
        ld a,LINK_INPUT_RED_LOW
        ld (link_release_state),a
        jr link_receive_ack
link_receive_zero:
        xor a
        ld (link_rx_bit),a
        ld a,LINK_WHITE_LOW
        ld (link_ack_output),a
        ld a,LINK_INPUT_WHITE_LOW
        ld (link_release_state),a
link_receive_ack:
        ld a,(link_ack_output)
        out (LINK_PORT),a
        ld a,(link_release_state)
        call link_wait_exact
        jr c,link_receive_bit_fail
        call link_release_lines
        ld a,LINK_INPUT_BOTH_HIGH
        call link_wait_exact
        jr c,link_receive_bit_fail
        ld a,(link_rx_bit)
        or a
        ret
link_receive_bit_fail:
        call link_release_lines
        scf
        ret

; A = exact two-line input state. One 16-bit bounded poll window.
link_wait_exact:
        ld (link_expected_state),a
        ld bc,0
link_wait_exact_loop:
        in a,(LINK_PORT)
        and 3
        ld d,a
        ld a,(link_expected_state)
        cp d
        jr z,link_wait_ok
        ld a,c
        or a
        call z,link_cancel_probe
        ret c
        dec bc
        ld a,b
        or c
        jr nz,link_wait_exact_loop
        jp link_timeout

; Wait up to link_wait_rounds poll windows for a sender to assert one line.
link_wait_signal:
        ld a,(link_wait_rounds)
        or a
        jr nz,link_wait_signal_rounds_ready
        inc a
link_wait_signal_rounds_ready:
        ld (link_rounds_remaining),a
link_wait_signal_round:
        ld bc,0
link_wait_signal_loop:
        in a,(LINK_PORT)
        and 3
        cp LINK_INPUT_RED_LOW
        jr z,link_wait_ok
        cp LINK_INPUT_WHITE_LOW
        jr z,link_wait_ok
        or a
        jr z,link_invalid_edge
        ld a,c
        or a
        call z,link_cancel_probe
        ret c
        dec bc
        ld a,b
        or c
        jr nz,link_wait_signal_loop
        ld a,(link_rounds_remaining)
        dec a
        ld (link_rounds_remaining),a
        jr nz,link_wait_signal_round
link_timeout:
        ld a,LINK_ERROR_TIMEOUT
        jr link_fail_with_a
link_invalid_edge:
        ld a,LINK_ERROR_INVALID_EDGE
link_fail_with_a:
        ld (link_error),a
        ld a,SYNC_FAILURE_LINK
        ld (sync_failure_kind),a
        scf
        ret
link_wait_ok:
        ; `link_wait_exact` reaches here after `cp d`, so A already equals
        ; the observed line state. `link_wait_signal` reaches here directly
        ; from `cp` with that same input still in A. Preserve A for both paths
        ; while clearing carry; the two-byte encoding keeps the runtime's
        ; fixed data addresses stable.
        and 0xff
        ret

; Direct matrix polling remains available while DI prevents TI-OS key input.
; EXIT: row $BF, bit 6. CLEAR: row $FD, bit 7. Both are active low.
link_cancel_probe:
        push bc
        push de
        push hl
        xor a
        ld (link_probe_cancelled),a
        ld a,0xBF
        out (KEY_PORT),a
        in a,(KEY_PORT)
        bit 6,a
        jr z,link_cancel_pressed
        ld a,0xFD
        out (KEY_PORT),a
        in a,(KEY_PORT)
        bit 7,a
        jr nz,link_cancel_probe_done
link_cancel_pressed:
        ld a,1
        ld (link_probe_cancelled),a
link_cancel_probe_done:
        ld a,0xFF
        out (KEY_PORT),a
        pop hl
        pop de
        pop bc
        ld a,(link_probe_cancelled)
        or a
        ret z
        ld a,1
        ld (sync_cancel_requested),a
        ld a,LINK_ERROR_CANCELLED
        ld (link_error),a
        ld a,SYNC_FAILURE_LINK
        ld (sync_failure_kind),a
        scf
        ret

; ---------------------------------------------------------------------------
; Transport-aware UI and terminal cleanup

sync_release_transport:
        call link_release_lines
        ld a,0xFF
        out (KEY_PORT),a
        ei
        ret

sync_terminal_failure:
        ld a,(sync_cancel_requested)
        or a
        jr nz,sync_terminal_cancelled
        ld a,(sync_failure_kind)
        cp SYNC_FAILURE_PROTOCOL
        call z,sync_send_protocol_error_best_effort
        call sync_delete_partial_write
        call sync_release_transport
        ld a,(sync_failure_kind)
        cp SYNC_FAILURE_PROTOCOL
        ld a,SYNC_TERM_PROTOCOL
        jr z,sync_terminal_failure_render
        ld a,SYNC_TERM_DISCONNECTED
sync_terminal_failure_render:
        call sync_render_terminal
        jr sync_terminal_wait
sync_terminal_cancelled:
        call sync_delete_partial_write
        call sync_release_transport
        ld a,SYNC_TERM_CANCELLED
        call sync_render_terminal

sync_terminal_wait:
        call sc_input_init
sync_terminal_key_loop:
        call sc_input_wait
        cp SC_SCAN_ENTER
        ret z
        cp SC_SCAN_EXIT
        ret z
        cp SC_SCAN_LEFT
        ret z
        jr sync_terminal_key_loop

sync_render_waiting:
        ld hl,sync_ui_waiting
        ld de,sync_ui_cable
        call sync_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,sync_ui_checking
        ld b,3
        ld c,13
        call ui_draw_text
        ld hl,sync_ui_wait_relay
        ld b,3
        ld c,23
        call ui_draw_text
        ld hl,sync_ui_no_transfer
        ld b,3
        ld c,33
        jp ui_draw_text

sync_render_connected:
        ld hl,sync_ui_sync
        ld de,sync_ui_linked
        call sync_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,sync_ui_connected
        ld b,3
        ld c,13
        call ui_draw_text
        ld hl,sync_ui_verified
        ld b,3
        ld c,23
        call ui_draw_text
        ld hl,sync_ui_negotiated
        ld b,3
        ld c,33
        jp ui_draw_text

sync_render_phase:
        ld hl,sync_ui_sync
        ld de,sync_ui_linked
        call sync_render_header
        call ui_mode_set
        call ui_select_compact
        ld a,(sync_phase)
        dec a
        add a,a
        ld e,a
        ld d,0
        ld hl,sync_phase_text_table
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ex de,hl
        ld b,3
        ld c,12
        call ui_draw_text
        ld a,(sync_direction)
        add a,a
        ld e,a
        ld d,0
        ld hl,sync_direction_text_table
        add hl,de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ex de,hl
        ld b,3
        ld c,22
        call ui_draw_text
        call sync_render_progress_bar
        ld a,(sync_safe_to_unplug)
        or a
        ld hl,sync_ui_keep_connected
        jr z,sync_render_safety_ready
        ld hl,sync_ui_safe_unplug
sync_render_safety_ready:
        ld b,3
        ld c,50
        jp ui_draw_text

sync_render_progress_bar:
        call ui_mode_set
        ld b,3
        ld c,38
        ld d,122
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        ld b,4
        ld c,39
        ld d,120
        ld e,6
        call ui_fill_rect
        call sync_progress_width
        or a
        ret z
        ld d,a
        call ui_mode_set
        ld b,4
        ld c,39
        ld e,6
        jp ui_fill_rect

sync_progress_width:
        ld a,(sync_items_total)
        or a
        ret z
        ld b,a
        ld a,(sync_items_completed)
        cp b
        jr c,sync_progress_fraction
        ld a,120
        ret
sync_progress_fraction:
        ld e,a
        ld d,0
        ld hl,0
        ld b,120
sync_progress_multiply:
        add hl,de
        djnz sync_progress_multiply
        ld a,(sync_items_total)
        ld e,a
        ld d,0
        ld b,0
sync_progress_divide:
        or a
        sbc hl,de
        jr c,sync_progress_divide_done
        inc b
        jr sync_progress_divide
sync_progress_divide_done:
        ld a,b
        ret

; A = SYNC_TERM_*.
sync_render_terminal:
        ld (sync_terminal_code),a
        cp SYNC_TERM_READY
        jr z,sync_render_terminal_ready
        cp SYNC_TERM_BLOCKED
        jr z,sync_render_terminal_blocked
        cp SYNC_TERM_CANCELLED
        jr z,sync_render_terminal_cancelled
        cp SYNC_TERM_DISCONNECTED
        jr z,sync_render_terminal_disconnected
        ld hl,sync_ui_protocol_stopped
        ld de,sync_ui_stopped
        ld bc,sync_ui_data_preserved
        jr sync_render_terminal_common
sync_render_terminal_ready:
        ld hl,sync_ui_transfer_received
        ld de,sync_ui_done
        ld bc,sync_ui_commit_return
        jr sync_render_terminal_common
sync_render_terminal_blocked:
        ld hl,sync_ui_sync_blocked
        ld de,sync_ui_stopped
        ld bc,sync_ui_queue_preserved
        jr sync_render_terminal_common
sync_render_terminal_cancelled:
        ld hl,sync_ui_cancelled
        ld de,sync_ui_stopped
        ld bc,sync_ui_data_preserved
        jr sync_render_terminal_common
sync_render_terminal_disconnected:
        ld hl,sync_ui_disconnected
        ld de,sync_ui_stopped
        ld bc,sync_ui_data_preserved
sync_render_terminal_common:
        ld (sync_terminal_title),hl
        ld (sync_terminal_context),de
        ld (sync_terminal_detail),bc
        ld hl,sync_ui_sync
        ld de,(sync_terminal_context)
        call sync_render_header
        call ui_mode_set
        call ui_select_compact
        ld hl,(sync_terminal_title)
        ld b,3
        ld c,14
        call ui_draw_text
        ld hl,(sync_terminal_detail)
        ld b,3
        ld c,26
        call ui_draw_text
        ld hl,sync_ui_safe_unplug
        ld b,3
        ld c,38
        call ui_draw_text
        ld hl,sync_ui_enter_returns
        ld b,3
        ld c,50
        jp ui_draw_text

; HL = title, DE = right-side context.
sync_render_header:
        ld (sync_header_title),hl
        ld (sync_header_context),de
        call _clrLCD
        call ui_mode_set
        ld b,0
        ld c,0
        ld d,128
        ld e,8
        call ui_fill_rect
        call ui_mode_clear
        call ui_select_compact
        ld hl,(sync_header_title)
        ld b,1
        ld c,1
        call ui_draw_text
        ld hl,(sync_header_context)
        ld c,1
        ld d,124
        call ui_draw_text_right
        jp ui_mode_set

; ---------------------------------------------------------------------------
; SCX1 self-validation and immutable data

sync_scx_validate_self:
        ld a,(_asm_exec_ram)
        cp 0xC3
        jr nz,sync_scx_fail
        ld hl,(_asm_exec_ram + 1)
        ld de,_asm_exec_ram + 16
        or a
        sbc hl,de
        jr nz,sync_scx_fail
        ld hl,_asm_exec_ram + 3
        ld de,sync_scx_magic
        ld b,4
sync_scx_magic_loop:
        ld a,(de)
        cp (hl)
        jr nz,sync_scx_fail
        inc de
        inc hl
        djnz sync_scx_magic_loop
        ld a,(_asm_exec_ram + 7)
        cp 1
        jr nz,sync_scx_fail
        ld a,(_asm_exec_ram + 8)
        cp 6
        jr nz,sync_scx_fail
        ld a,(_asm_exec_ram + 9)
        or a
        jr nz,sync_scx_fail
        ld hl,(_asm_exec_ram + 14)
        ld a,h
        or l
        jr nz,sync_scx_fail
        ld bc,(_asm_exec_ram + 10)
        push bc
        pop hl
        ld de,16
        or a
        sbc hl,de
        jr c,sync_scx_fail
        push hl
        ld de,8192 - 16
        ex de,hl
        or a
        sbc hl,de
        pop bc
        jr c,sync_scx_fail
        ld hl,_asm_exec_ram + 16
        call crc16_ccitt_false
        ld hl,(_asm_exec_ram + 12)
        or a
        sbc hl,de
        jr nz,sync_scx_fail
        or a
        ret
sync_scx_fail:
        scf
        ret

sync_connected:             defb 0
sync_safe_to_unplug:        defb 0
sync_cancel_requested:      defb 0
sync_failure_kind:          defb 0
sync_protocol_code:         defb 0
sync_offending_type:        defb 0
sync_protocol_offset:       defw 0
sync_expected_sequence:     defw 0
sync_operation_sequence:    defw 0
sync_phase:                 defb 0
sync_direction:             defb 0
sync_items_completed:       defb 0
sync_items_total:           defb 0
sync_complete_code:         defb 0
sync_chunk_bytes:           defw SCF_CHUNK_BYTES
sync_chunk_length:          defw 0
sync_transfer_offset:       defw 0
sync_record_length:         defw 0
sync_record_crc:            defw 0
sync_record_expected_crc:   defw 0
sync_record_base_addr:      defw 0
sync_record_base_page:      defb 0
sync_write_active:          defb 0
sync_name_trailer:          defb 0
sync_name_length:           defb 0
sync_name_payload_length:   defb 0
sync_name_limit:            defw 0
sync_current_name:          defs 10,0
sync_nonce:                 defs 8,0

scf_tx_type:                defb 0
scf_tx_sequence:            defw 0
scf_tx_payload_length:      defw 0
scf_tx_crc_length:          defw 0
scf_tx_length:              defw 0
scf_rx_type:                defb 0
scf_rx_sequence:            defw 0
scf_rx_payload_length:      defw 0
scf_rx_crc_length:          defw 0
scf_rx_expected_crc:        defw 0
scf_rx_length:              defw 0
sync_expected_ack_type:     defb 0
sync_expected_ack_offset:   defw 0

ti_checksum:                defw 0
ti_data_pointer:            defw 0
ti_data_remaining:          defw 0
ti_control_command:         defb 0
ti_retry_count:             defb 0
ti_packet_wait_rounds:      defb 0
ti_received_length_low:     defb 0
ti_received_checksum:       defw 0

link_error:                 defb 0
link_wait_rounds:           defb 0
link_rounds_remaining:      defb 0
link_expected_state:        defb 0
link_tx_byte:               defb 0
link_tx_bit:                defb 0
link_rx_byte:               defb 0
link_rx_bit:                defb 0
link_bit_mask:              defb 0
link_bit_count:             defb 0
link_ack_output:            defb 0
link_release_state:         defb 0
link_probe_cancelled:       defb 0

sync_terminal_code:         defb 0
sync_terminal_title:        defw 0
sync_terminal_context:      defw 0
sync_terminal_detail:       defw 0
sync_header_title:          defw 0
sync_header_context:        defw 0

scf_magic:                  defb "SCF1"
sync_scx_magic:             defb "SCX1"

sync_ascii_dsid:            defb "DSID"
sync_ascii_dsinfo:          defb "DSINFO"
sync_ascii_dsinst:          defb "DSINST"
sync_ascii_dsq:             defb "DSQ"
sync_ascii_dsreq:           defb "DSREQ"
sync_ascii_dstreq:          defb "DSTREQ"
sync_ascii_dsentry:         defb "DSENTRY"
sync_ascii_dsusrnew:        defb "DSUSRNEW"
sync_ascii_dscatnew:        defb "DSCATNEW"
sync_ascii_dsacknew:        defb "DSACKNEW"
sync_ascii_dssync:          defb "DSSYNC"
sync_ascii_dstnew:          defb "DSTNEW"
sync_ascii_dsstdnew:        defb "DSSTDNEW"

sync_ui_sync:               defb "SchoolCalc",0
sync_ui_waiting:            defb "Sync",0
sync_ui_cable:              defb "CABLE",0
sync_ui_linked:             defb "LINKED",0
sync_ui_done:               defb "DONE",0
sync_ui_stopped:            defb "STOP",0
sync_ui_checking:           defb "Cable: checking...",0
sync_ui_wait_relay:         defb "Relay: waiting",0
sync_ui_no_transfer:        defb "No data moving",0
sync_ui_connected:          defb "Cable: connected",0
sync_ui_verified:           defb "Relay: verified",0
sync_ui_negotiated:         defb "Session negotiated",0
sync_ui_keep_connected:     defb "Keep cable connected",0
sync_ui_safe_unplug:        defb "Safe to unplug",0
sync_ui_transfer_received:  defb "Transfer received",0
sync_ui_sync_blocked:       defb "Sync blocked",0
sync_ui_cancelled:          defb "Sync cancelled",0
sync_ui_disconnected:       defb "Cable disconnected",0
sync_ui_protocol_stopped:   defb "Protocol stopped",0
sync_ui_commit_return:      defb "Return commits safely",0
sync_ui_queue_preserved:    defb "Queue/content preserved",0
sync_ui_data_preserved:     defb "Local data preserved",0
sync_ui_enter_returns:      defb "ENTER returns",0

sync_phase_1:               defb "Reading identity",0
sync_phase_2:               defb "Identifying device",0
sync_phase_3:               defb "Reading offline data",0
sync_phase_4:               defb "Synchronizing",0
sync_phase_5:               defb "Staging profiles",0
sync_phase_6:               defb "Staging Catalog",0
sync_phase_7:               defb "Staging content",0
sync_phase_8:               defb "Staging receipts",0
sync_phase_9:               defb "Publishing manifest",0
sync_phase_10:              defb "Ready to commit",0
sync_phase_11:              defb "Sync failed",0
sync_phase_12:              defb "Staging progress",0
sync_phase_13:              defb "Staging tutor turn",0
sync_phase_text_table:
        defw sync_phase_1,sync_phase_2,sync_phase_3,sync_phase_4,sync_phase_5
        defw sync_phase_6,sync_phase_7,sync_phase_8,sync_phase_9,sync_phase_10
        defw sync_phase_11,sync_phase_12,sync_phase_13

sync_direction_0:           defb "Connected - idle",0
sync_direction_1:           defb "Negotiating",0
sync_direction_2:           defb "Sending to relay",0
sync_direction_3:           defb "Server exchange",0
sync_direction_4:           defb "Receiving from relay",0
sync_direction_text_table:
        defw sync_direction_0,sync_direction_1,sync_direction_2
        defw sync_direction_3,sync_direction_4

; Frame storage is fixed and never aliases the page-zero UI scratch area.
scf_tx_frame:               defs SCF_FRAME_MAX_BYTES,0
scf_rx_frame:               defs SCF_FRAME_MAX_BYTES,0

include "crc16-ccitt.asm"
UI_RENDER_PROFILE_FULL: equ 0
UI_RENDER_INCLUDE_COMPACT: equ 1
UI_RENDER_INCLUDE_READER: equ 0
UI_RENDER_INCLUDE_DISPLAY: equ 0
UI_RENDER_INCLUDE_ICONS: equ 0
UI_RENDER_COPIED_TEXT_LENGTH: equ 0
include "ui-renderer.asm"
include "input.asm"
include "generated/ui-sync-runtime-assets.inc"

end
