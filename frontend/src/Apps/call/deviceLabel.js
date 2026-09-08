/**
 * How a screen is named to a person.
 *
 * The lobby must never show `yellow-room-tablet`. A slug is an internal key;
 * putting it in front of someone asks them to decode it. The declared `name`
 * in devices.yml is the answer, and enriching that file is the fix when one is
 * missing — but a missing name must still not produce kebab case on screen, so
 * this humanises the id as a last resort and the caller logs which devices
 * needed it (`devices.loaded` → `unnamed`).
 */

/** Words that are wrong when title-cased letter by letter. */
const ACRONYMS = new Map([['tv', 'TV'], ['pc', 'PC'], ['nvr', 'NVR'], ['midi', 'MIDI'], ['omr', 'OMR']]);

export function humanizeDeviceId(id) {
  return String(id || '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(word => ACRONYMS.get(word.toLowerCase()) ?? (word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

/** The name to show for a device record from GET /api/v1/device. */
export function deviceLabel(device) {
  return device?.name || humanizeDeviceId(device?.id);
}

export default deviceLabel;
