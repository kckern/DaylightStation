/**
 * Synthetic data factory for lifeplan tests.
 * Deterministic output via seeded PRNG (mulberry32).
 */

// --- Seeded PRNG (mulberry32) ---

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startStr, endStr) {
  const s = new Date(startStr + 'T00:00:00Z');
  const e = new Date(endStr + 'T00:00:00Z');
  return Math.round((e - s) / 86400000);
}

// --- Generators ---

const PURPOSE_STATEMENTS = [
  'To maximize joy through meaningful contribution to others',
  'To build and share knowledge that empowers human flourishing',
  'To create lasting impact through disciplined excellence',
  'To live fully, love deeply, and leave the world better',
];

const QUALITY_TEMPLATES = [
  {
    id: 'physical-vitality', name: 'Physical Vitality',
    description: 'Maintain peak physical health and energy',
    principles: ['Prioritize sleep', 'Move daily', 'Eat whole foods'],
    rules: [
      { id: 'tired-walk', trigger: 'feeling tired', action: 'walk instead of caffeine', times_triggered: 12, times_followed: 8, times_helped: 6 },
      { id: 'morning-movement', trigger: 'morning', action: '20 min movement before screens', times_triggered: 30, times_followed: 22, times_helped: 20 },
    ],
  },
  {
    id: 'intellectual-growth', name: 'Intellectual Growth',
    description: 'Continuously expand knowledge and skills',
    principles: ['Read daily', 'Seek challenging problems', 'Teach what you learn'],
    rules: [
      { id: 'daily-reading', trigger: 'evening', action: 'read 30 min before bed', times_triggered: 20, times_followed: 14, times_helped: 12 },
    ],
  },
  {
    id: 'relational-depth', name: 'Relational Depth',
    description: 'Build and nurture meaningful relationships',
    principles: ['Be present', 'Listen more than speak', 'Show up consistently'],
    rules: [
      { id: 'phone-away', trigger: 'family time', action: 'phone in another room', times_triggered: 15, times_followed: 10, times_helped: 9 },
    ],
  },
];

const VALUE_NAMES = ['health', 'family', 'craft', 'adventure', 'wealth', 'community', 'freedom', 'creativity'];

const BELIEF_TEMPLATES = [
  { id: 'exercise-energy', if: 'I exercise regularly', then: 'I have more energy', foundational: false },
  { id: 'deep-work-output', if: 'I do deep work in the morning', then: 'I produce higher quality output', foundational: false },
  { id: 'sleep-performance', if: 'I get 7+ hours of sleep', then: 'I perform better the next day', foundational: false },
  { id: 'relationships-matter', if: 'I invest in relationships', then: 'I feel more connected and fulfilled', foundational: true },
  { id: 'compound-growth', if: 'I improve 1% daily', then: 'Results compound dramatically over time', foundational: true },
  { id: 'nature-restores', if: 'I spend time in nature', then: 'My stress levels decrease', foundational: false },
];

const GOAL_TEMPLATES = [
  { name: 'Run a marathon', quality: 'physical-vitality', metrics: [{ name: 'weekly_miles', target: 30 }] },
  { name: 'Write a book', quality: 'intellectual-growth', metrics: [{ name: 'words_written', target: 50000 }] },
  { name: 'Learn a new language', quality: 'intellectual-growth', metrics: [{ name: 'lessons_completed', target: 100 }] },
  { name: 'Build emergency fund', quality: 'financial', metrics: [{ name: 'savings_amount', target: 10000 }] },
  { name: 'Ship side project', quality: 'craft', metrics: [{ name: 'features_shipped', target: 10 }] },
  { name: 'Complete certification', quality: 'intellectual-growth', metrics: [{ name: 'modules_completed', target: 12 }] },
  { name: 'Run 100 mile week', quality: 'physical-vitality', metrics: [{ name: 'weekly_miles', target: 100 }] },
  { name: 'Cook 50 new recipes', quality: 'physical-vitality', metrics: [{ name: 'recipes_cooked', target: 50 }] },
];

const GOAL_STATE_DISTRIBUTION = ['dream', 'dream', 'considered', 'ready', 'committed', 'committed', 'achieved', 'abandoned'];

const EVIDENCE_TYPES = ['confirmation', 'disconfirmation', 'spurious', 'untested'];

function generatePurpose(rng) {
  return {
    statement: pick(rng, PURPOSE_STATEMENTS),
    grounded_in: [],
    last_reviewed: null,
  };
}

function generateQualities(rng) {
  return QUALITY_TEMPLATES.map(q => ({
    id: q.id,
    name: q.name,
    description: q.description,
    principles: q.principles,
    rules: q.rules.map(r => ({
      ...r,
      state: r.times_followed > r.times_triggered * 0.7 ? 'effective' : 'mixed',
    })),
    grounded_in: { beliefs: [], values: [] },
    shadow: null,
    shadow_state: 'dormant',
  }));
}

function generateValues(rng, count) {
  // Shuffle pool using Fisher-Yates, then take first `count`
  const pool = [...VALUE_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const selected = pool.slice(0, Math.min(count, pool.length));
  return selected.map((name, rank) => ({
    id: name,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    rank: rank + 1,
    justified_by: [],
    alignment_state: 'aligned',
    conflicts_with: [],
  }));
}

function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateBeliefs(rng, count, startDate, spanMonths) {
  const pool = shuffle(rng, BELIEF_TEMPLATES);
  const beliefs = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const template = pool[i];
    const confidence = 0.4 + rng() * 0.5; // 0.4 - 0.9
    const evidenceCount = Math.floor(rng() * 6);
    const evidence = [];

    for (let e = 0; e < evidenceCount; e++) {
      const dayOffset = Math.floor(rng() * spanMonths * 30);
      const type = pick(rng, EVIDENCE_TYPES);
      evidence.push({
        date: addDays(startDate, dayOffset),
        type,
        did_if: type !== 'spurious',
        got_then: type === 'confirmation' || type === 'spurious',
        notes: `Evidence ${e + 1} for ${template.id}`,
      });
    }

    beliefs.push({
      id: template.id,
      if: template.if,
      then: template.then,
      foundational: template.foundational,
      depends_on: [],
      confidence: Math.round(confidence * 100) / 100,
      state: confidence > 0.8 ? 'confirmed' : confidence > 0.4 ? 'uncertain' : 'hypothesized',
      evidence,
      evidence_quality: {
        sample_size: evidenceCount,
        biases_considered: [],
        raw_confidence: Math.round(confidence * 100) / 100,
        total_bias_adjustment: 0,
        effective_confidence: Math.round(confidence * 100) / 100,
      },
      last_tested: evidenceCount > 0 ? evidence[evidence.length - 1].date : null,
      if_signal: null,
      then_signal: null,
      origin: null,
    });
  }
  return beliefs;
}

function generateGoals(rng, count, startDate, spanMonths) {
  const pool = shuffle(rng, GOAL_TEMPLATES);
  const goals = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const template = pool[i];
    const state = pick(rng, GOAL_STATE_DISTRIBUTION);
    const createdOffset = Math.floor(rng() * Math.max(1, spanMonths * 15));
    const createdDate = addDays(startDate, createdOffset);
    const deadlineOffset = createdOffset + 60 + Math.floor(rng() * 120);
    const deadline = addDays(startDate, deadlineOffset);

    const goal = {
      id: template.name.toLowerCase().replace(/\s+/g, '-'),
      name: template.name,
      quality: template.quality,
      state,
      why: `Pursuing ${template.name} to grow in ${template.quality}`,
      state_history: [{ state: 'dream', date: createdDate, reason: 'Initial creation' }],
      milestones: [],
      dependencies: [],
    };

    if (['considered', 'ready', 'committed', 'achieved', 'abandoned'].includes(state)) {
      goal.estimated_sacrifice = `${Math.floor(rng() * 10 + 5)} hours per week`;
      goal.state_history.push({
        state: 'considered',
        date: addDays(createdDate, Math.floor(rng() * 14) + 1),
        reason: 'Exploring feasibility',
      });
    }

    if (['committed', 'achieved'].includes(state)) {
      goal.deadline = deadline;
      goal.metrics = template.metrics.map(m => ({
        ...m,
        current: Math.floor(m.target * rng()),
      }));
      goal.sacrifice = goal.estimated_sacrifice;
      goal.audacity = pick(rng, ['moderate', 'high', 'extreme']);
      goal.state_history.push({
        state: 'committed',
        date: addDays(createdDate, Math.floor(rng() * 14) + 15),
        reason: 'Committed to pursue',
      });
    }

    if (state === 'achieved') {
      goal.achieved_date = addDays(createdDate, Math.floor(rng() * 60) + 30);
      goal.retrospective = 'Completed successfully.';
      goal.state_history.push({
        state: 'achieved',
        date: goal.achieved_date,
        reason: 'Goal met',
      });
    }

    if (state === 'abandoned') {
      goal.abandoned_reason = 'Priorities shifted';
      goal.abandoned_from_state = 'considered';
      goal.state_history.push({
        state: 'abandoned',
        date: addDays(createdDate, Math.floor(rng() * 30) + 10),
        reason: 'Priorities shifted',
      });
    }

    goals.push(goal);
  }
  return goals;
}

function generateCeremonyConfig() {
  return {
    config: {
      unit_intention: { enabled: true, timing: 'unit_start', duration_target: 10 },
      unit_capture: { enabled: true, timing: 'unit_end', duration_target: 10 },
      cycle_retro: { enabled: true, timing: 'cycle_end', duration_target: 20 },
      phase_review: { enabled: true, timing: 'phase_end', duration_target: 45 },
      season_review: { enabled: true, timing: 'season_end', duration_target: 90 },
      era_review: { enabled: false, timing: 'era_end', duration_target: 240 },
    },
  };
}

// --- Public API ---

export function createTestLifeplan(options = {}) {
  const {
    startDate = '2025-01-01',
    spanMonths = 6,
    goalCount = 5,
    beliefCount = 4,
    valueCount = 5,
    cadence = null,
    seed = 42,
  } = options;

  const rng = mulberry32(seed);

  const defaultCadence = {
    unit: { duration: '1 day', alias: 'day' },
    cycle: { duration: '7 days', alias: 'week' },
    phase: { duration: '30 days', alias: 'month' },
    season: { duration: '90 days', alias: 'quarter' },
    era: { duration: '365 days', alias: 'year' },
  };

  return {
    meta: { version: '2.0', testdata: true, seed, created: startDate },
    cadence: cadence || defaultCadence,
    purpose: generatePurpose(rng),
    qualities: generateQualities(rng),
    values: generateValues(rng, valueCount),
    beliefs: generateBeliefs(rng, beliefCount, startDate, spanMonths),
    goals: generateGoals(rng, goalCount, startDate, spanMonths),
    life_events: [],
    anti_goals: [],
    dependencies: [],
    cycles: [],
    ceremonies: generateCeremonyConfig(),
    feedback: [],
    tasks: [],
    value_mapping: {
      category_defaults: {
        health: 'health',
        fitness: 'health',
        calendar: null,
        productivity: 'craft',
        social: 'family',
        journal: null,
        finance: 'wealth',
      },
      calendar_rules: [
        { match: { calendarName: 'Work' }, value: 'craft' },
        { match: { calendarName: 'Family' }, value: 'family' },
        { match: { summary_contains: 'gym' }, value: 'health' },
        { default: 'craft' },
      ],
      extractor_overrides: {},
    },
  };
}

export function createMatchingLifelog(lifeplan, options = {}) {
  const { seed = lifeplan.meta.seed || 42 } = options;
  const rng = mulberry32(seed + 1000); // offset seed for different data
  const startDate = lifeplan.meta.created;
  const totalDays = (options.spanDays) || daysBetween(startDate, addDays(startDate, 30));

  const strava = {};
  const calendar = {};
  const weight = {};
  const todoist = {};

  const activityTypes = ['Run', 'Ride', 'Walk', 'Swim'];
  const baseWeight = 170 + rng() * 30;

  for (let d = 0; d < totalDays; d++) {
    const date = addDays(startDate, d);
    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    // Strava: ~3 activities per week
    if (rng() < 0.43) {
      const type = pick(rng, activityTypes);
      const duration = 20 + Math.floor(rng() * 60);
      strava[date] = [{
        title: `${type === 'Run' ? 'Morning' : 'Evening'} ${type}`,
        type,
        duration,
        distance: type === 'Swim' ? duration * 0.05 : duration * 0.1,
        avgHR: 120 + Math.floor(rng() * 40),
      }];
    } else {
      strava[date] = [];
    }

    // Calendar: work on weekdays, family on weekends
    const events = [];
    if (isWeekday) {
      events.push({
        summary: 'Work Block',
        calendarName: 'Work',
        time: '09:00',
        endTime: '17:00',
      });
      if (rng() < 0.3) {
        events.push({
          summary: 'Team Meeting',
          calendarName: 'Work',
          time: '14:00',
          endTime: '15:00',
        });
      }
    } else {
      if (rng() < 0.6) {
        events.push({
          summary: pick(rng, ['Family dinner', 'Park with kids', 'Game night']),
          calendarName: 'Family',
          time: '17:00',
          endTime: '19:00',
        });
      }
    }
    calendar[date] = events;

    // Weight: daily with small variance
    weight[date] = {
      lbs: Math.round((baseWeight + (rng() - 0.5) * 2) * 10) / 10,
    };

    // Todoist: tasks on weekdays
    if (isWeekday) {
      const taskCount = 2 + Math.floor(rng() * 5);
      todoist[date] = Array.from({ length: taskCount }, (_, i) => ({
        title: `Task ${i + 1}`,
        completed: true,
        project: pick(rng, ['Work', 'Personal', 'Side Project']),
      }));
    } else {
      todoist[date] = [];
    }
  }

  return { strava, calendar, weight, todoist };
}
