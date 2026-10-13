/**
 * Check if content is currently within its allowed schedule.
 * @param {Object} schedule - The schedule config object (per-day time windows)
 * @returns {{ available: boolean, nextWindow: { day: string, start: string } | null }}
 */
export function checkSchedule(schedule) {
  if (!schedule) {
    return { available: true, nextWindow: null };
  }

  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = days[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const windows = schedule[today];
  if (!windows || windows.length === 0) {
    return { available: false, nextWindow: findNextWindow(schedule, now) };
  }

  const inWindow = windows.some(w => {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
  });

  if (!inWindow) {
    return { available: false, nextWindow: findNextWindowFromToday(schedule, now, windows) };
  }

  return { available: true, nextWindow: null };
}

function findNextWindow(schedule, now) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todayWindows = schedule[days[currentDay]] || [];
  for (const w of todayWindows) {
    const [sh, sm] = w.start.split(':').map(Number);
    if (sh * 60 + sm > currentMinutes) return { day: days[currentDay], start: w.start };
  }

  for (let i = 1; i <= 7; i++) {
    const dayIdx = (currentDay + i) % 7;
    const dayName = days[dayIdx];
    const dayWindows = schedule[dayName];
    if (dayWindows?.length > 0) {
      return { day: dayName, start: dayWindows[0].start };
    }
  }
  return null;
}

function findNextWindowFromToday(schedule, now, todayWindows) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const w of todayWindows) {
    const [sh, sm] = w.start.split(':').map(Number);
    if (sh * 60 + sm > currentMinutes) return { day: days[now.getDay()], start: w.start };
  }

  return findNextWindow(schedule, now);
}
