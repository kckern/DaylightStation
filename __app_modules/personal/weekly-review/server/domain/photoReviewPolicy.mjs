function parseLocalTime(isoStr) {
  const match = isoStr?.match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${hours}:${match[2]} ${suffix}`;
}

function formatTimeRange(session) {
  if (!session.length) return '';
  const sorted = [...session].sort((a, b) => a.asset.localDateTime.localeCompare(b.asset.localDateTime));
  const earliest = parseLocalTime(sorted[0].asset.localDateTime);
  const latest = parseLocalTime(sorted.at(-1).asset.localDateTime);
  if (!earliest) return '';
  return earliest === latest ? earliest : `${earliest} – ${latest}`;
}

function groupSessions(scored, sessionGapMs) {
  if (!scored.length) return [];
  const byTime = [...scored].sort((a, b) => new Date(a.asset.localDateTime) - new Date(b.asset.localDateTime));
  const sessions = [[byTime[0]]];
  for (let i = 1; i < byTime.length; i++) {
    const previous = new Date(byTime[i - 1].asset.localDateTime);
    const current = new Date(byTime[i].asset.localDateTime);
    if (current - previous > sessionGapMs) sessions.push([byTime[i]]);
    else sessions.at(-1).push(byTime[i]);
  }
  return sessions;
}

export function buildPhotoReviewDay({ date, assets, priorityPeople = [], sessionGapMs, projectAsset }) {
  const priorities = new Set(priorityPeople.map(name => name.toLowerCase()));
  const scored = assets.map(asset => {
    const people = (asset.people || []).map(person => person.name);
    return { asset, people, priorityCount: people.filter(name => priorities.has(name.toLowerCase())).length };
  });
  const byPriority = [...scored].sort((a, b) => b.priorityCount - a.priorityCount);
  const hero = assets.length >= 3 && byPriority[0]?.asset.type !== 'VIDEO' ? byPriority[0].asset : null;
  const sessions = groupSessions(scored, sessionGapMs);
  const chronological = [...scored].sort((a, b) => new Date(a.asset.localDateTime) - new Date(b.asset.localDateTime));
  const photos = chronological.map(item => {
    const sessionIndex = sessions.findIndex(session => session.some(row => row.asset.id === item.asset.id));
    return projectAsset(item.asset, {
      people: item.people,
      isHero: item.asset === hero,
      sessionIndex: sessionIndex < 0 ? 0 : sessionIndex,
    });
  });
  return {
    date,
    photos,
    photoCount: photos.length,
    sessions: sessions.map((session, index) => ({ index, count: session.length, timeRange: formatTimeRange(session) })),
  };
}
