/**
 * TI-86 ROM-call helpers for ordinary calculator variables.
 *
 * Addresses and calling conventions are from the source-included TI-86
 * development archive published by ticalc.org (`ti86asm.inc`, `Rom86.h`) and
 * the original TI-86 variable examples mirrored by The Guide.  SchoolCalc
 * uses TI-OS allocation instead of walking or mutating the VAT directly.
 */
export const TI86_ROM = Object.freeze({
  idle: 0x405C,
  resetAutomaticPowerDown: 0x4060,
  getKey: 0x4068,
  forceCommandNoCharacter: 0x409C,
  findSym: 0x46CB,
  createString: 0x472F,
  createProgram: 0x474F,
  deleteVariable: 0x475F,
  exchangeAhlBde: 0x45F3,
  addTwoAhl: 0x4C3F,
  setAbsoluteSource: 0x4647,
  setAbsoluteDestination: 0x5285,
  setMoveByteCount: 0x464F,
  absoluteLdir: 0x52ED,
  clearLcd: 0x4A7E,
  runIndicatorOff: 0x4AB1,
});

/** Raw scan codes used by the disposable TI-86 diagnostic at $4068. */
export const TI86_RAW_SCAN_CODE = Object.freeze({
  none: 0x00,
  down: 0x01,
  left: 0x02,
  right: 0x03,
  up: 0x04,
  enter: 0x09,
  clear: 0x0F,
  on: 0x29,
  f5: 0x31,
  f4: 0x32,
  f3: 0x33,
  f2: 0x34,
  f1: 0x35,
  second: 0x36,
  exit: 0x37,
  more: 0x38,
});

export const TI86_ON_INTERRUPT_FLAG = Object.freeze({ offset: 9, bit: 4 });

export const TI86_VARIABLE_TYPE = Object.freeze({
  string: 0x0C,
});

/** Build the ten-byte OP1 name descriptor expected by TI-86 variable calls. */
export function ti86VariableNameDescriptor(name, type = TI86_VARIABLE_TYPE.string) {
  const value = String(name ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(value)) {
    throw new Error('TI-86 variable name must be 1-8 uppercase letters/digits, starting with a letter');
  }
  if (!Number.isInteger(type) || type < 0 || type > 0xFF) {
    throw new Error('TI-86 variable type must be one byte');
  }
  const descriptor = Buffer.alloc(10, 0);
  descriptor[0] = type;
  descriptor[1] = value.length;
  descriptor.write(value, 2, 'ascii');
  return descriptor;
}

/**
 * Emit an in-place create-or-replace operation for one TI-86 String.
 *
 * The caller must define `nameLabel` as a ten-byte OP1 descriptor and
 * `dataLabel` as exactly `dataLength` bytes later in the same page-zero
 * assembly program.  The created TI String's OS-owned two-byte length prefix
 * is skipped before the SchoolCalc record is copied.
 */
export function emitReplaceTi86String(z, {
  nameLabel,
  dataLabel,
  dataLength,
} = {}) {
  if (!z || typeof z.emit !== 'function' || typeof z.wordLabel !== 'function') {
    throw new Error('emitReplaceTi86String requires a Z80Emitter');
  }
  if (!nameLabel || !dataLabel) throw new Error('TI-86 String labels are required');
  if (!Number.isInteger(dataLength) || dataLength < 0 || dataLength > 0xFFFF) {
    throw new Error('TI-86 String data length must fit u16');
  }

  z.emit(0x21); z.wordLabel(nameLabel);       // ld hl,name descriptor
  z.emit(0xE7);                              // rst 20h: _Mov10ToOP1
  z.emit(0xD7);                              // rst 10h: _FindSym
  z.emit(0xD4); z.word(TI86_ROM.deleteVariable); // call nc,_DelVar (found)

  z.emit(0x21); z.word(dataLength);           // ld hl,dataLength
  z.call(TI86_ROM.createString);              // BDE -> new String storage
  z.call(TI86_ROM.exchangeAhlBde);            // AHL -> String storage
  z.call(TI86_ROM.addTwoAhl);                 // skip TI String length word
  z.call(TI86_ROM.setAbsoluteDestination);

  z.emit(0xAF);                               // xor a: source is RAM page 0
  z.emit(0x21); z.wordLabel(dataLabel);       // ld hl,record bytes
  z.call(TI86_ROM.setAbsoluteSource);
  z.emit(0xAF);                               // AHL = dataLength
  z.emit(0x21); z.word(dataLength);
  z.call(TI86_ROM.setMoveByteCount);
  z.call(TI86_ROM.absoluteLdir);
}

/**
 * Emit an exact ordinary-variable replacement.  The input includes the
 * calculator's leading length word, which is copied too: TI Asm( Program
 * variables use a logical length that intentionally does not count `8E28`.
 * Allocating the full payload first and then copying the complete data makes
 * both Program and String variables byte-for-byte faithful to their .86p/.86s
 * transfer file without manipulating the VAT.
 */
export function emitReplaceTi86Variable(z, {
  nameLabel,
  dataLabel,
  variableDataLength,
  creator,
  progressAddress = null,
} = {}) {
  if (!z || typeof z.emit !== 'function' || typeof z.wordLabel !== 'function') {
    throw new Error('emitReplaceTi86Variable requires a Z80Emitter');
  }
  if (!nameLabel || !dataLabel) throw new Error('TI-86 variable labels are required');
  if (!Number.isInteger(variableDataLength) || variableDataLength < 2 || variableDataLength > 0xFFFF) {
    throw new Error('TI-86 variable data length must fit u16 and include a length word');
  }
  if (![TI86_ROM.createString, TI86_ROM.createProgram].includes(creator)) {
    throw new Error('TI-86 variable creator must be String or Program');
  }
  if (progressAddress !== null && (!Number.isInteger(progressAddress) || progressAddress < 0 || progressAddress > 0xFFFF)) {
    throw new Error('TI-86 variable progress address must fit u16');
  }
  const progress = (value) => {
    if (progressAddress === null) return;
    z.emit(0x3E, value, 0x32); z.word(progressAddress); // ld a,value / ld (address),a
  };

  z.emit(0x21); z.wordLabel(nameLabel);       // ld hl,name descriptor
  z.emit(0xE7);                              // rst 20h: _Mov10ToOP1
  progress(1);
  z.emit(0xD7);                              // rst 10h: _FindSym
  z.emit(0xD4); z.word(TI86_ROM.deleteVariable); // call nc,_DelVar (found)
  progress(2);

  z.emit(0x21); z.word(variableDataLength - 2);
  progress(3);
  z.call(creator);                            // BDE -> new variable storage
  progress(4);
  z.call(TI86_ROM.exchangeAhlBde);            // AHL -> leading length word
  progress(5);
  z.call(TI86_ROM.setAbsoluteDestination);
  progress(6);

  z.emit(0xAF);                               // source is page-zero assembly RAM
  z.emit(0x21); z.wordLabel(dataLabel);
  z.call(TI86_ROM.setAbsoluteSource);
  progress(7);
  z.emit(0xAF);
  z.emit(0x21); z.word(variableDataLength);
  z.call(TI86_ROM.setMoveByteCount);
  progress(8);
  z.call(TI86_ROM.absoluteLdir);
  progress(9);
}
