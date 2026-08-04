import { TI86_ASM_EXEC_RAM, TI86_VIDEO_RAM, readTi86VariableFile } from './ti86-program.mjs';
import { TI86_ROM, emitReplaceTi86Variable, ti86VariableNameDescriptor } from './ti86-os-vars.mjs';
import { Z80Emitter } from './z80-emitter.mjs';

/** Scratch byte outside the executable window, written after one install. */
export const TI86_MAME_INSTALL_MARKER = 0xD740;
export const TI86_MAME_INSTALL_STARTED = 0xD741;
export const TI86_MAME_INSTALL_PROGRESS = 0xD742;

/**
 * Build one tiny, TI-OS-mediated installer for every exact release transfer.
 * This is an emulator transport only: the byte input is the unmodified
 * release file which will later be sent through Graph Link to hardware.
 */
export function createTi86MameReleaseInstallers({ transferFiles, origin = TI86_ASM_EXEC_RAM } = {}) {
  if (!Array.isArray(transferFiles) || transferFiles.length === 0) {
    throw new Error('MAME release provisioning requires at least one transfer file');
  }
  return Object.freeze(transferFiles.map(({ fileName, bytes }) => {
    const variable = readTi86VariableFile(Buffer.from(bytes));
    const creator = creatorForType(variable.type, fileName);
    const z = new Z80Emitter({ origin });
    z.emit(0x3E, 0x5A);                       // ld a,$5A: installer reached RAM
    z.emit(0x32); z.word(TI86_MAME_INSTALL_STARTED); // ld (started),a
    emitReplaceTi86Variable(z, {
      nameLabel: 'name',
      dataLabel: 'data',
      variableDataLength: variable.variableData.length,
      creator,
      progressAddress: TI86_MAME_INSTALL_PROGRESS,
    });
    z.emit(0x3E, 0xA5);                       // ld a,$A5: install complete marker
    z.emit(0x32); z.word(TI86_MAME_INSTALL_MARKER); // ld (marker),a
    z.emit(0xC3); z.word(TI86_ROM.forceCommandNoCharacter);
    z.label('name'); z.emit(...ti86VariableNameDescriptor(variable.name, variable.type));
    z.label('data'); z.emit(...variable.variableData);
    const code = z.finish();
    if (origin + code.length >= TI86_VIDEO_RAM) {
      throw new Error(`MAME installer for ${fileName} overlaps TI-86 video RAM`);
    }
    return Object.freeze({
      fileName: String(fileName),
      name: variable.name,
      type: variable.type,
      variableData: variable.variableData,
      code,
    });
  }));
}

function creatorForType(type, fileName) {
  if (type === 0x0C) return TI86_ROM.createString;
  if (type === 0x12) return TI86_ROM.createProgram;
  throw new Error(`MAME provisioning does not support TI-86 variable type 0x${type.toString(16)} in ${fileName}`);
}
