import { MidiRecordingStone } from '#domains/midi/MidiRecordingStone.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

export function parseMidiRecordingStone(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer ?? '');
  const marker = text.indexOf('jmxStoneHdr');
  if (marker === -1) throw new ValidationError('jmxStoneHdr not found in MIDI buffer', { code: 'JAMCORDER_NO_HEADER' });
  const braceStart = text.indexOf('{', marker);
  if (braceStart === -1) throw new ValidationError('jmxStoneHdr JSON start not found', { code: 'JAMCORDER_NO_HEADER' });
  let depth = 0; let end = -1;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new ValidationError('jmxStoneHdr JSON not terminated', { code: 'JAMCORDER_BAD_HEADER' });
  let hdr;
  try { hdr = JSON.parse(text.slice(braceStart, end + 1)); }
  catch (err) { throw new ValidationError(`jmxStoneHdr JSON parse failed: ${err.message}`, { code: 'JAMCORDER_BAD_HEADER' }); }
  const unixtime = hdr?.time?.unixtime;
  const localOffsetMin = hdr?.time?.localOffset;
  if (typeof unixtime !== 'number' || typeof localOffsetMin !== 'number') {
    throw new ValidationError('jmxStoneHdr missing time.unixtime/localOffset', { code: 'JAMCORDER_BAD_HEADER' });
  }
  return new MidiRecordingStone({
    unixtime, localOffsetMin,
    recorderName: hdr?.identities?.jamcorderName ?? null,
    performerName: hdr?.identities?.performerName ?? null,
    assetUuid: hdr?.asset?.assetUuid ?? null,
    assetIdx: hdr?.asset?.assetIdx ?? null,
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
export function archiveRelPathForStone(stone) {
  const date = new Date((stone.unixtime + stone.localOffsetMin * 60) * 1000);
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const stamp = `${year}-${month}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}.${pad2(date.getUTCMinutes())}.${pad2(date.getUTCSeconds())}`;
  return `${year}/${year}-${month}/${stamp}.mid`;
}
