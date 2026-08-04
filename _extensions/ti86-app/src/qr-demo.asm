; qr-demo.asm — TI-86 QR display proof of concept.
;
; Assemble as a TI-86 RAM assembly program (.86p) with ti86asm.inc available
; beside this source.  It has no input path yet: rebuild the included frame
; with `node tools/generate-demo.mjs --score N`, transfer, then run QRDEMO.
;
; The 1024-byte frame is 16 bytes × 64 LCD rows.  Copying it to $FC00 is both
; faster and less error-prone than plotting 1,764 individual 2× QR pixels.

#include "ti86asm.inc"

.org _asm_exec_ram

    call _clrLCD
    ld hl,QR_FRAME
    ld de,VideoRam
    ld bc,1024
    ldir
    ret

#include "generated/qr-frame.inc"

.end
