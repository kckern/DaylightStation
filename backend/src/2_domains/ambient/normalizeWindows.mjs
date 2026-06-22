// backend/src/2_domains/ambient/normalizeWindows.mjs
// Pure: schedule (from artmode.yml) → normalized windows + warnings. No I/O.
import { parseHHMM } from './timeParts.mjs';

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function normalizeWindows(schedule, { defaultDevice = 'livingroom-tv' } = {}) {
  const windows = [];
  const warnings = [];
  const list = Array.isArray(schedule) ? schedule : [];

  list.forEach((w, index) => {
    const startMin = parseHHMM(w?.start);
    const endMin = parseHHMM(w?.end);
    const days = (Array.isArray(w?.days) ? w.days : [])
      .map((d) => DOW[String(d).toLowerCase()])
      .filter((d) => d !== undefined);
    const preset = w?.preset;
    const device = w?.device || defaultDevice;

    if (startMin == null || endMin == null || days.length === 0 || !preset) {
      warnings.push({ index, reason: 'invalid-window', window: w });
      return;
    }
    if (endMin <= startMin) {
      warnings.push({ index, reason: 'end-not-after-start', window: w });
      return;
    }
    const key = w?.name || `${device}|${w.start}|${w.end}|${preset}`;
    windows.push({ key, name: w?.name || null, days, startMin, endMin, preset, device });
  });

  return { windows, warnings };
}

export default normalizeWindows;
