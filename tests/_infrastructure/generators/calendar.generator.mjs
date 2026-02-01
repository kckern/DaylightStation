/**
 * Calendar data generator
 * Generates recurring and one-time events
 */

import {
  USERS,
  getActiveUsers,
  randomInt,
  randomChoice,
  randomBool,
  formatDate,
  formatDateTime,
  addDays,
  subDays,
  today,
  pastDays,
  getDayOfWeek,
  isWeekday,
  uuid,
  shortId,
} from './utils.mjs';

// Recurring event templates
const RECURRING_EVENTS = [
  {
    summary: 'Morning Workout',
    recurrence: 'MO,WE,FR',
    time: { start: '06:30', end: '07:30' },
    attendees: ['popeye', 'tintin'],
    color: '#4285f4',
  },
  {
    summary: 'Evening Cardio',
    recurrence: 'TU,TH',
    time: { start: '18:00', end: '19:00' },
    attendees: ['popeye'],
    color: '#4285f4',
  },
  {
    summary: 'Team Meeting',
    recurrence: 'MO',
    time: { start: '10:00', end: '11:00' },
    attendees: ['olive', 'mickey'],
    color: '#7986cb',
  },
  {
    summary: 'Weekly Planning',
    recurrence: 'SU',
    time: { start: '19:00', end: '20:00' },
    attendees: ['olive'],
    color: '#33b679',
  },
  {
    summary: 'Family Dinner',
    recurrence: 'SU',
    time: { start: '18:00', end: '19:30' },
    attendees: ['popeye', 'olive', 'mickey', 'betty'],
    color: '#f4511e',
  },
  {
    summary: 'Music Practice',
    recurrence: 'TU,TH,SA',
    time: { start: '16:00', end: '17:00' },
    attendees: ['betty'],
    color: '#e67c73',
  },
  {
    summary: 'Movie Night',
    recurrence: 'FR',
    time: { start: '20:00', end: '22:30' },
    attendees: ['mickey', 'betty'],
    color: '#8e24aa',
  },
];

// One-time event templates
const ONE_TIME_TEMPLATES = [
  { summary: 'Doctor Appointment', duration: 60, color: '#d50000' },
  { summary: 'Dentist Checkup', duration: 90, color: '#d50000' },
  { summary: 'Car Service', duration: 120, color: '#616161' },
  { summary: 'Birthday Party', duration: 180, color: '#f4511e' },
  { summary: 'Coffee with Friend', duration: 60, color: '#795548' },
  { summary: 'Home Repair', duration: 240, color: '#616161' },
  { summary: 'Grocery Run', duration: 45, color: '#33b679' },
  { summary: 'Haircut', duration: 45, color: '#795548' },
  { summary: 'Date Night', duration: 180, color: '#e67c73' },
  { summary: 'Concert', duration: 180, color: '#8e24aa' },
];

// All-day event templates
const ALL_DAY_TEMPLATES = [
  { summary: 'Vacation Day', color: '#039be5' },
  { summary: 'Work from Home', color: '#7986cb' },
  { summary: 'Holiday', color: '#f4511e' },
  { summary: 'Conference', color: '#0b8043' },
];

// Day name to number mapping
const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Parse time string to hours and minutes
 */
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Create a date with specific time
 */
function setTime(date, timeStr) {
  const { hours, minutes } = parseTime(timeStr);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Format time for Google Calendar-like format
 */
function formatCalendarDateTime(date) {
  return date.toISOString();
}

/**
 * Generate a calendar event
 */
function createEvent(baseDate, template, isRecurring = false) {
  const startDate = setTime(baseDate, template.time.start);
  const endDate = setTime(baseDate, template.time.end);

  return {
    id: `evt-${shortId()}`,
    summary: template.summary,
    start: {
      dateTime: formatCalendarDateTime(startDate),
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: formatCalendarDateTime(endDate),
      timeZone: 'America/Los_Angeles',
    },
    attendees: template.attendees.map(id => ({
      email: `${id}@demo.local`,
      displayName: USERS.find(u => u.id === id)?.name || id,
      responseStatus: 'accepted',
    })),
    colorId: template.color,
    status: 'confirmed',
    ...(isRecurring && {
      recurringEventId: `rec-${shortId()}`,
      recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${template.recurrence}`],
    }),
  };
}

/**
 * Generate a one-time event
 */
function createOneTimeEvent(date, template, user) {
  const startHour = randomInt(9, 17);
  const startDate = new Date(date);
  startDate.setHours(startHour, randomChoice([0, 15, 30, 45]), 0, 0);
  const endDate = new Date(startDate.getTime() + template.duration * 60000);

  return {
    id: `evt-${shortId()}`,
    summary: template.summary,
    start: {
      dateTime: formatCalendarDateTime(startDate),
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: formatCalendarDateTime(endDate),
      timeZone: 'America/Los_Angeles',
    },
    attendees: [{
      email: `${user.id}@demo.local`,
      displayName: user.name,
      responseStatus: 'accepted',
    }],
    colorId: template.color,
    status: 'confirmed',
  };
}

/**
 * Generate an all-day event
 */
function createAllDayEvent(date, template, users) {
  return {
    id: `evt-${shortId()}`,
    summary: template.summary,
    start: {
      date: formatDate(date),
    },
    end: {
      date: formatDate(addDays(date, 1)),
    },
    attendees: users.map(user => ({
      email: `${user.id}@demo.local`,
      displayName: user.name,
      responseStatus: 'accepted',
    })),
    colorId: template.color,
    status: 'confirmed',
  };
}

/**
 * Generate calendar events for a date range
 */
export function generateCalendarEvents(startDate, days) {
  const events = [];
  const endDate = addDays(startDate, days);

  // Generate recurring event instances
  let current = new Date(startDate);
  while (current <= endDate) {
    const dayOfWeek = getDayOfWeek(current);

    for (const template of RECURRING_EVENTS) {
      const recurrenceDays = template.recurrence.split(',').map(d => DAY_MAP[d]);
      if (recurrenceDays.includes(dayOfWeek)) {
        events.push(createEvent(current, template, true));
      }
    }

    current = addDays(current, 1);
  }

  // Generate random one-time events (about 1-2 per week)
  const users = getActiveUsers();
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);

    // About 20% chance of a one-time event per day
    if (randomBool(0.2)) {
      const template = randomChoice(ONE_TIME_TEMPLATES);
      const user = randomChoice(users);
      events.push(createOneTimeEvent(date, template, user));
    }

    // About 5% chance of an all-day event
    if (randomBool(0.05)) {
      const template = randomChoice(ALL_DAY_TEMPLATES);
      const numAttendees = randomBool(0.7) ? 1 : randomInt(2, 4);
      const attendees = users.slice(0, numAttendees);
      events.push(createAllDayEvent(date, template, attendees));
    }
  }

  // Sort by start time
  events.sort((a, b) => {
    const aTime = a.start.dateTime || a.start.date;
    const bTime = b.start.dateTime || b.start.date;
    return aTime.localeCompare(bTime);
  });

  return {
    kind: 'calendar#events',
    summary: 'Demo Calendar',
    timeZone: 'America/Los_Angeles',
    items: events,
  };
}

/**
 * Generate a simple shared events structure
 */
export function generateSharedEvents(startDate, days) {
  const events = [];

  // Generate some shared household events
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const dayOfWeek = getDayOfWeek(date);

    // Sunday family dinner
    if (dayOfWeek === 0) {
      events.push({
        id: `shared-${shortId()}`,
        title: 'Family Dinner',
        date: formatDate(date),
        time: '18:00',
        type: 'recurring',
        participants: ['popeye', 'olive', 'mickey', 'betty'],
      });
    }

    // Random household events
    if (randomBool(0.1)) {
      events.push({
        id: `shared-${shortId()}`,
        title: randomChoice(['House Cleaning', 'Yard Work', 'Laundry Day', 'Grocery Shopping']),
        date: formatDate(date),
        time: randomChoice(['09:00', '10:00', '14:00', '15:00']),
        type: 'household',
        participants: randomChoice([['olive'], ['popeye', 'olive'], ['mickey']]),
      });
    }
  }

  return { events };
}
