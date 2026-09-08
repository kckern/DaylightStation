// backend/src/3_applications/fitness/equipmentImages.mjs

/**
 * Equipment picture filenames, declared in fitness config.
 *
 * Equipment images have always been found by EQUIPMENT ID — the file at
 * `media/img/equipment/{id}.{ext}` is the picture, and a miss falls back to the
 * generic `equipment.png`. That works only while a device's id and its picture
 * happen to share a spelling, and it puts the filename in code rather than in
 * config. The pedaler is where it broke: id `generic_pedaler`, picture
 * `peddler.jpg`, and every surface silently showed the generic icon.
 *
 * An equipment entry may now name its own picture:
 *
 *   - name: Generic Pedaler
 *     id: generic_pedaler
 *     image: peddler.jpg
 *
 * The id convention still applies to every entry that declares no `image` — it
 * is the default, not a guess made after a declared name misses. A declared
 * name that does not resolve stays missing and falls through to the generic
 * icon, rather than quietly re-deriving one from the id.
 *
 * @param {Object} fitnessConfig - Raw household fitness config.
 * @returns {Object<string, string>} equipment id → declared filename.
 */
export function equipmentImageMap(fitnessConfig) {
  const equipment = fitnessConfig?.equipment;
  if (!Array.isArray(equipment)) return {};
  const map = {};
  for (const item of equipment) {
    const id = item?.id;
    const image = item?.image;
    if (typeof id === 'string' && id && typeof image === 'string' && image) {
      map[id] = image;
    }
  }
  return map;
}

export default equipmentImageMap;
