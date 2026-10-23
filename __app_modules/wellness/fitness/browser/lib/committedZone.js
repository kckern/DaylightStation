// Records are ordered by authority. An explicit null or untrusted state is
// meaningful: never revive it from a lower-priority record or a raw HR zone.
export function committedZoneId(...records) {
  for (const record of records) {
    if (!record) continue;
    if (record.zoneTrusted === false) return null;
    const key = Object.hasOwn(record, 'currentZoneId') ? 'currentZoneId'
      : Object.hasOwn(record, 'zoneId') ? 'zoneId' : null;
    if (key) return record[key] ? String(record[key]).toLowerCase() : null;
  }
  return null;
}
