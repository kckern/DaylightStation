/**
 * Fitness data generator
 * Generates fitness config and session data with realistic patterns
 */

import {
  USERS,
  getPrimaryFitnessUsers,
  randomInt,
  randomFloat,
  randomChoice,
  randomChoices,
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

// Heart rate zones (matches production config)
const HR_ZONES = ['cool', 'active', 'warm', 'hot', 'fire'];
const ZONE_COLORS = {
  cool: '#3498db',
  active: '#2ecc71',
  warm: '#f1c40f',
  hot: '#e67e22',
  fire: '#e74c3c',
};

// Equipment types
const EQUIPMENT = [
  { id: 'cycleace', name: 'CycleAce', type: 'bike' },
  { id: 'punching_bag', name: 'Punching Bag', type: 'bag' },
  { id: 'ab_roller', name: 'Ab Roller', type: 'accessory' },
  { id: 'treadmill', name: 'Treadmill', type: 'cardio' },
  { id: 'rowing_machine', name: 'Rowing Machine', type: 'cardio' },
];

/**
 * Generate fitness app config
 */
export function generateFitnessConfig() {
  const primaryUsers = getPrimaryFitnessUsers();
  const secondaryUsers = USERS.filter(u => !primaryUsers.includes(u));

  // Generate fake device IDs for heart rate monitors
  const devices = {
    heart_rate: {},
    cadence: {},
  };
  const device_colors = {
    heart_rate: {},
  };

  const hrColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7'];

  USERS.forEach((user, i) => {
    const hrDeviceId = String(100000 + i);
    devices.heart_rate[hrDeviceId] = user.id;
    device_colors.heart_rate[hrDeviceId] = hrColors[i % hrColors.length];
  });

  // Cadence sensor for bike
  devices.cadence['200001'] = 'cycleace';

  return {
    devices,
    device_colors,
    users: {
      primary: primaryUsers.map(u => ({
        id: u.id,
        name: u.name,
        hr: Object.keys(devices.heart_rate).find(k => devices.heart_rate[k] === u.id),
      })),
      secondary: secondaryUsers.map(u => ({
        id: u.id,
        name: u.name,
        hr: Object.keys(devices.heart_rate).find(k => devices.heart_rate[k] === u.id),
      })),
    },
    equipment: EQUIPMENT.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
    })),
    zones: {
      cool: { min: 0, max: 100, color: ZONE_COLORS.cool },
      active: { min: 100, max: 130, color: ZONE_COLORS.active },
      warm: { min: 130, max: 150, color: ZONE_COLORS.warm },
      hot: { min: 150, max: 170, color: ZONE_COLORS.hot },
      fire: { min: 170, max: 220, color: ZONE_COLORS.fire },
    },
  };
}

/**
 * Generate heart rate zones for a user based on their max/resting HR
 */
function getUserZones(user) {
  const maxHr = user.fitness?.max_hr || 180;
  const restingHr = user.fitness?.resting_hr || 60;
  const reserve = maxHr - restingHr;

  return {
    cool: { min: 0, max: Math.round(restingHr + reserve * 0.5) },
    active: { min: Math.round(restingHr + reserve * 0.5), max: Math.round(restingHr + reserve * 0.6) },
    warm: { min: Math.round(restingHr + reserve * 0.6), max: Math.round(restingHr + reserve * 0.7) },
    hot: { min: Math.round(restingHr + reserve * 0.7), max: Math.round(restingHr + reserve * 0.85) },
    fire: { min: Math.round(restingHr + reserve * 0.85), max: maxHr },
  };
}

/**
 * Get zone name for a given heart rate
 */
function getZoneForHr(hr, zones) {
  for (const [zoneName, zone] of Object.entries(zones)) {
    if (hr >= zone.min && hr < zone.max) {
      return zoneName;
    }
  }
  return hr >= zones.fire.min ? 'fire' : 'cool';
}

/**
 * Generate a realistic heart rate progression for a workout
 * Returns array of {second, hr} data points
 */
function generateHrTimeline(durationMinutes, intensity, user) {
  const zones = getUserZones(user);
  const maxHr = user.fitness?.max_hr || 180;
  const restingHr = user.fitness?.resting_hr || 60;

  const dataPoints = [];
  const totalSeconds = durationMinutes * 60;

  // Workout phases
  const warmupEnd = Math.floor(totalSeconds * 0.15);
  const mainEnd = Math.floor(totalSeconds * 0.85);

  // Target HR based on intensity
  const intensityTargets = {
    low: restingHr + (maxHr - restingHr) * 0.5,
    medium: restingHr + (maxHr - restingHr) * 0.65,
    high: restingHr + (maxHr - restingHr) * 0.8,
    max: restingHr + (maxHr - restingHr) * 0.9,
  };

  const targetHr = intensityTargets[intensity] || intensityTargets.medium;
  let currentHr = restingHr + 10; // Start slightly elevated

  for (let second = 0; second < totalSeconds; second += 5) {
    let targetForPhase;

    if (second < warmupEnd) {
      // Warmup: gradually increase
      const progress = second / warmupEnd;
      targetForPhase = restingHr + 10 + (targetHr - restingHr - 10) * progress;
    } else if (second < mainEnd) {
      // Main workout: fluctuate around target
      const variation = Math.sin(second / 60) * 10 + (Math.random() - 0.5) * 8;
      targetForPhase = targetHr + variation;
    } else {
      // Cooldown: gradually decrease
      const progress = (second - mainEnd) / (totalSeconds - mainEnd);
      targetForPhase = targetHr - (targetHr - restingHr - 20) * progress;
    }

    // Smooth transition to target
    currentHr = currentHr + (targetForPhase - currentHr) * 0.1;
    currentHr = Math.max(restingHr, Math.min(maxHr, currentHr));

    dataPoints.push({
      second,
      hr: Math.round(currentHr),
      zone: getZoneForHr(Math.round(currentHr), zones),
    });
  }

  return dataPoints;
}

/**
 * RLE encode a timeline of zones
 * Returns array of {zone, duration} objects
 */
function rleEncodeZones(dataPoints) {
  if (dataPoints.length === 0) return [];

  const encoded = [];
  let currentZone = dataPoints[0].zone;
  let duration = 0;

  for (const point of dataPoints) {
    if (point.zone === currentZone) {
      duration += 5; // 5-second intervals
    } else {
      encoded.push({ zone: currentZone, duration });
      currentZone = point.zone;
      duration = 5;
    }
  }
  encoded.push({ zone: currentZone, duration });

  return encoded;
}

/**
 * Generate a single fitness session
 */
export function generateSession(date, participants, sessionIndex = 0) {
  const startHour = randomChoice([6, 7, 8, 17, 18, 19, 20]);
  const startMinute = randomInt(0, 59);
  const startDate = new Date(date);
  startDate.setHours(startHour, startMinute, 0, 0);

  const durationMinutes = randomChoice([15, 20, 25, 30, 35, 40, 45, 60]);
  const intensity = randomChoice(['low', 'medium', 'medium', 'high', 'high', 'max']);
  const equipment = randomChoice(EQUIPMENT);

  // Generate data for each participant
  const participantData = {};
  let totalCalories = 0;
  let maxMaxHr = 0;
  let sumAvgHr = 0;

  for (const user of participants) {
    const hrTimeline = generateHrTimeline(durationMinutes, intensity, user);
    const zones = rleEncodeZones(hrTimeline);

    const hrs = hrTimeline.map(p => p.hr);
    const avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
    const maxHr = Math.max(...hrs);
    const minHr = Math.min(...hrs);

    // Estimate calories (very rough: duration * intensity factor * weight factor)
    const calories = Math.round(durationMinutes * (avgHr / 100) * randomFloat(0.8, 1.2));

    participantData[user.id] = {
      avg_hr: avgHr,
      max_hr: maxHr,
      min_hr: minHr,
      calories,
      zone_timeline: zones,
      time_in_zones: HR_ZONES.reduce((acc, zone) => {
        acc[zone] = zones.filter(z => z.zone === zone).reduce((sum, z) => sum + z.duration, 0);
        return acc;
      }, {}),
    };

    totalCalories += calories;
    maxMaxHr = Math.max(maxMaxHr, maxHr);
    sumAvgHr += avgHr;
  }

  const sessionId = `${formatDate(startDate).replace(/-/g, '')}-${String(sessionIndex).padStart(2, '0')}`;

  return {
    id: sessionId,
    start_time: formatDateTime(startDate),
    end_time: formatDateTime(new Date(startDate.getTime() + durationMinutes * 60000)),
    duration_minutes: durationMinutes,
    equipment: {
      id: equipment.id,
      name: equipment.name,
      type: equipment.type,
    },
    intensity,
    participants: participants.map(u => u.id),
    participant_data: participantData,
    summary: {
      total_participants: participants.length,
      avg_hr: Math.round(sumAvgHr / participants.length),
      max_hr: maxMaxHr,
      total_calories: totalCalories,
    },
  };
}

/**
 * Generate sessions for a date range
 * Returns object with date keys and arrays of sessions
 */
export function generateSessionsForRange(startDate, days, allUsers = USERS) {
  const sessions = {};
  const primaryUsers = getPrimaryFitnessUsers();

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const dateStr = formatDate(date);
    const dayOfWeek = getDayOfWeek(date);

    // Determine number of sessions for this day
    // More sessions on weekends, variable on weekdays
    let numSessions;
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Weekend: 1-3 sessions
      numSessions = randomInt(1, 3);
    } else {
      // Weekday: 0-2 sessions (sometimes rest day)
      numSessions = randomBool(0.8) ? randomInt(1, 2) : 0;
    }

    if (numSessions > 0) {
      sessions[dateStr] = [];

      for (let j = 0; j < numSessions; j++) {
        // Pick participants - primary users more likely, sometimes multi-user
        const numParticipants = randomBool(0.7) ? 1 : randomInt(2, 3);
        const participants = randomChoices(primaryUsers, numParticipants);

        // Occasionally add a secondary user
        if (randomBool(0.2) && numParticipants < 3) {
          const secondary = randomChoice(allUsers.filter(u => !participants.includes(u)));
          if (secondary) participants.push(secondary);
        }

        sessions[dateStr].push(generateSession(date, participants, j));
      }
    }
  }

  return sessions;
}

/**
 * Generate user fitness profile
 */
export function generateUserFitnessProfile(user) {
  const zones = getUserZones(user);
  return {
    id: user.id,
    name: user.name,
    fitness: {
      max_hr: user.fitness?.max_hr || 180,
      resting_hr: user.fitness?.resting_hr || 60,
      zones: Object.entries(zones).map(([name, range]) => ({
        name,
        min: range.min,
        max: range.max,
      })),
    },
  };
}

/**
 * Generate fitness lifelog for a user (summary of sessions)
 */
export function generateFitnessLifelog(userId, sessions) {
  const userSessions = [];

  for (const [dateStr, daySessions] of Object.entries(sessions)) {
    for (const session of daySessions) {
      if (session.participants.includes(userId)) {
        const userData = session.participant_data[userId];
        userSessions.push({
          date: dateStr,
          duration_minutes: session.duration_minutes,
          avg_hr: userData.avg_hr,
          max_hr: userData.max_hr,
          calories: userData.calories,
        });
      }
    }
  }

  return { sessions: userSessions };
}
