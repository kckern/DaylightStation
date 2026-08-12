const SKILLS = Object.freeze(['scale', 'chord', 'arpeggio', 'timed-pattern']);
const SKILL_LABELS = Object.freeze({
  scale: 'Scale', chord: 'Chord', arpeggio: 'Arpeggio', 'timed-pattern': 'Rhythm',
});

const localDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const allPokemon = (definition) => {
  const journey = definition.journey || {};
  const candidates = [
    ...(journey.partners || []),
    ...(journey.opponents || []),
    ...(journey.opponent_tiers || []).flatMap((tier) => tier.pool || []),
    ...(journey.gym?.opponents || []),
    ...(journey.gym?.role_pools || []).flatMap((role) => role.pool || []),
  ];
  return [...new Map(candidates.filter(Boolean).map((pokemon) => [pokemon.id, pokemon])).values()];
};

const eventTime = (session, event) => event.occurred_at || session.updated_at || session.created_at;

function skillStars(attempts) {
  return Object.fromEntries(SKILLS.map((kind) => {
    const scores = attempts
      .filter((attempt) => attempt.kind === kind && attempt.status === 'completed')
      .map((attempt) => Number(attempt.score))
      .filter(Number.isFinite);
    let stars = 0;
    if (scores.some((score) => score >= 0.6)) stars = 1;
    if (scores.filter((score) => score >= 0.8).length >= 2) stars = 2;
    if (scores.filter((score) => score >= 0.9).length >= 3) stars = 3;
    return [kind, {
      label: SKILL_LABELS[kind], stars, attempts: scores.length,
      best_score: scores.length ? Math.max(...scores) : null,
      next_threshold: stars === 0 ? 0.6 : stars === 1 ? 0.8 : stars === 2 ? 0.9 : null,
    }];
  }));
}

function bondRank({ wins, days, best_scores: bestScores, gym_victory: gymVictory }) {
  const atLeast = (threshold, count) => Object.values(bestScores || {}).filter((score) => score >= threshold).length >= count;
  if (wins >= 20 && days >= 8 && atLeast(0.9, 4) && gymVictory) return 5;
  if (wins >= 12 && days >= 5 && atLeast(0.8, 3)) return 4;
  if (wins >= 7 && days >= 3 && atLeast(0.75, 2)) return 3;
  if (wins >= 3 && days >= 2 && atLeast(0.6, 1)) return 2;
  return 1;
}

function bondChecklist(stats) {
  const best = stats.best_scores;
  const atLeast = (threshold, count) => Object.values(best).filter((score) => score >= threshold).length >= count;
  return [
    { rank: 2, complete: stats.wins >= 3 && stats.days >= 2 && atLeast(0.6, 1), label: '3 wins · 2 days · one skill at 60%' },
    { rank: 3, complete: stats.wins >= 7 && stats.days >= 3 && atLeast(0.75, 2), label: '7 wins · 3 days · two skills at 75%' },
    { rank: 4, complete: stats.wins >= 12 && stats.days >= 5 && atLeast(0.8, 3), label: '12 wins · 5 days · three skills at 80%' },
    { rank: 5, complete: stats.wins >= 20 && stats.days >= 8 && atLeast(0.9, 4) && stats.gym_victory, label: '20 wins · 8 days · four skills at 90% · gym win' },
  ];
}

function currentWeek(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDay(date);
  });
  return { start, days };
}

function consecutiveDays(daySet, now) {
  let count = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!daySet.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(localDay(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

const featuredSkillForDay = (day) => {
  const date = new Date(`${day}T12:00:00`);
  return SKILLS[date.getDay() % SKILLS.length];
};

/**
 * Rebuild the durable Card Game projection from authoritative sessions.
 * The projection is deliberately foldable: deleting the cached response and
 * replaying session/event YAML produces the same milestones and totals.
 */
export function buildPokemonCampaignProgress({ definition, sessions = [], userId, now = new Date(), activeSession = null }) {
  const persistent = Boolean(userId && userId !== 'guest');
  const relevant = persistent ? sessions : [];
  const pokemon = allPokemon(definition);
  const starterIds = new Set((definition.journey.partners || []).map((partner) => partner.id));
  const attempts = relevant.flatMap((session) => session.state?.practice_attempts || []);
  const stars = skillStars(attempts);
  const seen = new Set();
  const caught = new Set(starterIds);
  const encounterCounts = new Map();
  const winCounts = new Map();
  const badges = new Map();
  const appliedMilestones = new Set();
  const trainingDays = new Map();
  const partnerWins = new Map();
  const partnerGymWins = new Set();

  for (const session of relevant) {
    const state = session.state || {};
    const partnerId = state.partner_id || session.setup?.partner_id;
    const day = localDay(session.updated_at || session.created_at);
    if (partnerId && day) {
      if (!trainingDays.has(partnerId)) trainingDays.set(partnerId, new Set());
      if ((state.practice_attempts || []).length > 0) trainingDays.get(partnerId).add(day);
    }
    for (const choice of state.recruitment_choices || []) {
      if (choice.recruit_id) {
        caught.add(choice.recruit_id);
        appliedMilestones.add(`catch:${choice.recruit_id}`);
      }
    }
    for (const id of [...(state.completed_ceremony_ids || []), ...(state.queued_ceremony_ids || [])]) appliedMilestones.add(id);
    const events = session.events || [];
    if (state.enemy?.id) {
      seen.add(state.enemy.id);
      if (!events.some((event) => event.type === 'encounter_started' && event.encounter_id === state.enemy.id)) {
        encounterCounts.set(state.enemy.id, (encounterCounts.get(state.enemy.id) || 0) + 1);
      }
    }
    if (events.length) {
      for (const event of events) {
        if (event.type === 'encounter_started' || event.type === 'encounter_completed') {
          seen.add(event.encounter_id);
          if (event.type === 'encounter_started') encounterCounts.set(event.encounter_id, (encounterCounts.get(event.encounter_id) || 0) + 1);
        }
        if (event.type === 'encounter_completed') {
          winCounts.set(event.encounter_id, (winCounts.get(event.encounter_id) || 0) + 1);
          if (partnerId) partnerWins.set(partnerId, (partnerWins.get(partnerId) || 0) + 1);
        }
        if (event.type === 'gym_completed') {
          const badgeId = event.badge_id || event.gym_id;
          badges.set(badgeId, { id: badgeId, earned_at: eventTime(session, event), gym_id: event.gym_id });
          if (partnerId) partnerGymWins.add(partnerId);
          appliedMilestones.add(`badge:${badgeId}`);
        }
      }
    } else {
      for (const opponentId of state.completed_encounters || []) {
        seen.add(opponentId);
        winCounts.set(opponentId, (winCounts.get(opponentId) || 0) + 1);
        encounterCounts.set(opponentId, (encounterCounts.get(opponentId) || 0) + 1);
        if (partnerId) partnerWins.set(partnerId, (partnerWins.get(partnerId) || 0) + 1);
      }
      if (state.enemy?.id) seen.add(state.enemy.id);
    }
  }

  const bonds = {};
  for (const partner of definition.journey.partners || []) {
    const partnerSessions = relevant.filter((session) => (session.state?.partner_id || session.setup?.partner_id) === partner.id);
    const partnerAttempts = partnerSessions.flatMap((session) => session.state?.practice_attempts || []);
    const bestScores = Object.fromEntries(SKILLS.map((kind) => [kind, Math.max(0, ...partnerAttempts
      .filter((attempt) => attempt.kind === kind && attempt.status === 'completed')
      .map((attempt) => Number(attempt.score) || 0))]));
    const stats = {
      wins: partnerWins.get(partner.id) || 0,
      days: trainingDays.get(partner.id)?.size || 0,
      best_scores: bestScores,
      gym_victory: partnerGymWins.has(partner.id),
    };
    const rank = bondRank(stats);
    bonds[partner.id] = { partner_id: partner.id, rank, ...stats, checklist: bondChecklist(stats) };
  }

  const pokedexEntries = pokemon.map((entry) => {
    const owned = caught.has(entry.id);
    const bond = bonds[entry.id] || null;
    const trained = owned && ((bond?.wins || 0) > 0 || attempts.length > 0 && starterIds.has(entry.id));
    const evolved = Boolean(bond && bond.rank >= 4);
    const mastered = Boolean(bond && bond.rank >= 5);
    const status = mastered ? 'mastered' : evolved ? (entry.evolution ? 'evolved' : 'veteran') : trained ? 'trained' : owned ? 'caught' : seen.has(entry.id) ? 'seen' : 'unknown';
    return {
      id: entry.id, name: status === 'unknown' ? null : entry.name, dex: entry.dex || null,
      type: entry.type || null, genus: entry.genus || null, habitat: entry.habitat || entry.tier || 'Stadium route',
      asset: status === 'unknown' ? null : entry.asset || null, status, seen: seen.has(entry.id) || owned,
      caught: owned, trainable: owned && starterIds.has(entry.id), encounter_count: encounterCounts.get(entry.id) || 0,
      battle_wins: winCounts.get(entry.id) || 0, distinct_training_days: bond?.days || 0,
      best_scores: bond?.best_scores || Object.fromEntries(SKILLS.map((kind) => [kind, null])),
      bond_rank: bond?.rank || (owned ? 1 : 0), bond_checklist: bond?.checklist || [],
      evolution: entry.evolution || null, ceremonies: [...appliedMilestones].filter((id) => id.endsWith(`:${entry.id}`)),
    };
  });

  const completedRuns = relevant.filter((session) => session.status === 'complete' && session.state?.journey_summary);
  const rankedRuns = completedRuns.filter((session) => session.state.journey_summary.qualified);
  const personalBest = rankedRuns.map((session) => ({
    session_id: session.session_id, score: session.state.journey_summary.score,
    partner_id: session.state.partner_id, completed_at: session.completed_at,
  })).sort((a, b) => b.score - a.score)[0] || null;

  const dayEvidence = new Map();
  for (const session of relevant) {
    const day = localDay(session.updated_at || session.created_at);
    if (!day) continue;
    const evidence = dayEvidence.get(day) || { battles: 0, skills: new Set() };
    evidence.battles += (session.state?.completed_encounters || []).length;
    for (const attempt of session.state?.practice_attempts || []) {
      if (attempt.status === 'completed' && attempt.score >= 0.5) evidence.skills.add(attempt.kind);
    }
    dayEvidence.set(day, evidence);
  }
  const completedDailyDays = new Set([...dayEvidence]
    .filter(([day, evidence]) => evidence.battles > 0 && evidence.skills.has(featuredSkillForDay(day)))
    .map(([day]) => day));
  const today = localDay(now);
  const featuredSkill = featuredSkillForDay(today);
  const todayEvidence = dayEvidence.get(today) || { battles: 0, skills: new Set() };
  const dailyCompleted = todayEvidence.battles > 0 && todayEvidence.skills.has(featuredSkill);
  const week = currentWeek(now);
  const stamps = week.days.filter((day) => completedDailyDays.has(day));
  const elapsedWeekDays = week.days.filter((day) => day < today).length;
  const missed = Math.max(0, elapsedWeekDays - stamps.filter((day) => day < today).length);
  const restTokensUsed = Math.min(2, missed);
  const ticketsSpent = relevant.reduce((sum, session) => sum + Number(session.state?.research_tickets_spent || 0), 0);
  const researchTickets = Math.max(0, Math.floor(stamps.length / 4) - ticketsSpent);

  const caughtEarned = pokedexEntries.filter((entry) => entry.caught && !starterIds.has(entry.id)).length;
  const masteredPartners = Object.values(bonds).filter((bond) => bond.rank >= 5).length;
  const xp = seen.size * 10 + caughtEarned * 50 + completedDailyDays.size * 25 + badges.size * 200 + masteredPartners * 150;
  const level = 1 + Math.floor(xp / 250);
  const favorite = Object.values(bonds).sort((a, b) => b.rank - a.rank || b.wins - a.wins)[0] || null;
  const latestBadge = [...badges.values()].sort((a, b) => String(b.earned_at).localeCompare(String(a.earned_at)))[0] || null;
  const partners = Object.fromEntries((definition.journey.partners || []).map((partner) => {
    const bond = bonds[partner.id];
    const completions = completedRuns.filter((session) => session.state?.partner_id === partner.id).length;
    return [partner.id, {
      owned: true, journeys_completed: completions, bond_rank: bond.rank,
      evolved: bond.rank >= 4, evolution: bond.rank >= 4 ? partner.evolution : null,
      mastery_aura: bond.rank >= 5,
    }];
  }));

  return {
    game_id: definition.game_id, user_id: userId || 'guest', persistent,
    score_version: definition.journey.score_version, journey_version: definition.journey.version,
    campaign: {
      chapter: completedRuns.length + 1,
      journeys_completed: completedRuns.length,
      active_session: activeSession ? {
        session_id: activeSession.session_id, phase: activeSession.state?.phase,
        battle: (activeSession.state?.current_encounter || 0) + 1,
        partner_id: activeSession.state?.partner_id, updated_at: activeSession.updated_at,
      } : null,
      next_gym: definition.journey.gym ? { id: definition.journey.gym.id, name: definition.journey.gym.name, badge: definition.journey.gym.badge || null } : null,
    },
    pokedex: {
      entries: pokedexEntries, caught: pokedexEntries.filter((entry) => entry.caught).length,
      seen: pokedexEntries.filter((entry) => entry.seen).length, target: 50,
      completion: Math.min(1, pokedexEntries.filter((entry) => entry.caught).length / 50),
    },
    trainer: {
      xp, level, next_level_xp: level * 250, xp_into_level: xp % 250,
      skill_stars: stars, title: level >= 5 ? 'Stadium Scholar' : level >= 3 ? 'Route Researcher' : 'Rookie Trainer',
      selectable_titles: ['Rookie Trainer', ...(level >= 3 ? ['Route Researcher'] : []), ...(level >= 5 ? ['Stadium Scholar'] : [])],
      coin_awards: completedDailyDays.size * 2,
    },
    daily: {
      date: today, featured_skill: featuredSkill, featured_skill_label: SKILL_LABELS[featuredSkill],
      battle_complete: todayEvidence.battles > 0, skill_complete: todayEvidence.skills.has(featuredSkill), completed: dailyCompleted,
      reward: { trainer_xp: 25, weekly_stamp: 1, bond_day: 1, coins: 2 },
    },
    weekly: {
      days: week.days, stamps, stamp_count: stamps.length, target: 4,
      research_tickets: researchTickets, rest_tokens_remaining: 2 - restTokensUsed,
    },
    streak: { days: consecutiveDays(completedDailyDays, now), protected_misses: restTokensUsed },
    badges: [...badges.values()], bonds, partners, skill_stars: stars,
    goals: {
      current: 'Complete a battle and play the featured skill at 50% or better.',
      collection: `${pokedexEntries.filter((entry) => entry.caught).length} / 50 Pokémon caught`,
      next: researchTickets > 0 ? 'Use a research ticket for an unseen encounter.' : `${Math.max(0, 4 - stamps.length)} stamps until a research ticket`,
    },
    favorite_partner: favorite ? { partner_id: favorite.partner_id, bond_rank: favorite.rank, wins: favorite.wins } : null,
    latest_badge: latestBadge,
    applied_milestone_ids: [...appliedMilestones].sort(),
    journeys_completed: completedRuns.length,
    personal_best: personalBest,
  };
}

export { SKILLS as PIANO_SKILL_KINDS };
