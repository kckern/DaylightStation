// backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs

export class WeeklyReviewImmichAdapter {
  #client;
  #priorityPeople;
  #proxyPath;
  #sessionGapMs;
  #logger;

  constructor(config = {}, deps = {}) {
    if (!deps.client) {
      throw new Error('WeeklyReviewImmichAdapter requires client dependency');
    }
    this.#client = deps.client;
    this.#priorityPeople = (config.priorityPeople || []).map(n => n.toLowerCase());
    this.#proxyPath = config.proxyPath || '/proxy/immich';
    this.#sessionGapMs = (config.sessionGapMinutes || 120) * 60 * 1000;
    this.#logger = deps.logger || console;
  }

  async getPhotosForDateRange(startDate, endDate) {
    const takenAfter = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    const endPlusOne = new Date(`${endDate}T00:00:00.000Z`);
    endPlusOne.setDate(endPlusOne.getDate() + 1);
    const takenBefore = endPlusOne.toISOString();

    this.#logger.debug?.('weekly-review.immich.search', { startDate, endDate, takenAfter, takenBefore });

    const result = await this.#client.searchMetadata({
      takenAfter,
      takenBefore,
      type: 'IMAGE',
      size: 500,
    });

    const assets = result.items || result || [];

    if (assets.filter(a => a.type === 'IMAGE').length === 0) {
      this.#logger.warn?.('weekly-review.immich.no-photos', { startDate, endDate });
    }

    const byDate = new Map();
    for (const asset of assets) {
      if (asset.type !== 'IMAGE') continue;
      const date = asset.localDateTime.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(asset);
    }

    const days = [];
    const cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayAssets = byDate.get(dateStr) || [];
      const processed = this.#processDay(dateStr, dayAssets);
      this.#logger.debug?.('weekly-review.immich.day-summary', {
        date: dateStr,
        photoCount: processed.photoCount,
        sessionCount: processed.sessions.length,
        heroSelected: processed.photos.some(p => p.isHero),
      });
      days.push(processed);
      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.info?.('weekly-review.immich.done', {
      totalPhotos: assets.filter(a => a.type === 'IMAGE').length,
      days: days.length,
    });

    return days;
  }

  #processDay(date, assets) {
    const scored = assets.map(asset => {
      const people = (asset.people || []).map(p => p.name);
      const priorityCount = people.filter(name =>
        this.#priorityPeople.includes(name.toLowerCase())
      ).length;
      return { asset, people, priorityCount };
    });

    scored.sort((a, b) => b.priorityCount - a.priorityCount);

    const sessions = this.#groupSessions(scored);

    const photos = scored.map((item, index) => ({
      id: item.asset.id,
      thumbnail: `${this.#proxyPath}/assets/${item.asset.id}/thumbnail`,
      original: `${this.#proxyPath}/assets/${item.asset.id}/original`,
      people: item.people,
      isHero: assets.length >= 3 && index === 0,
      sessionIndex: this.#findSessionIndex(sessions, item.asset),
      takenAt: item.asset.localDateTime,
    }));

    return {
      date,
      photos,
      photoCount: photos.length,
      sessions: sessions.map((s, i) => ({
        index: i,
        count: s.length,
        timeRange: this.#formatTimeRange(s),
      })),
    };
  }

  #groupSessions(scored) {
    if (scored.length === 0) return [];

    const byTime = [...scored].sort((a, b) =>
      new Date(a.asset.localDateTime) - new Date(b.asset.localDateTime)
    );

    const sessions = [[byTime[0]]];
    for (let i = 1; i < byTime.length; i++) {
      const prev = new Date(byTime[i - 1].asset.localDateTime);
      const curr = new Date(byTime[i].asset.localDateTime);
      if (curr - prev > this.#sessionGapMs) {
        sessions.push([byTime[i]]);
      } else {
        sessions[sessions.length - 1].push(byTime[i]);
      }
    }
    return sessions;
  }

  #findSessionIndex(sessions, asset) {
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].some(s => s.asset.id === asset.id)) return i;
    }
    return 0;
  }

  #formatTimeRange(session) {
    if (session.length === 0) return '';
    const times = session.map(s => new Date(s.asset.localDateTime));
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (earliest.getTime() === latest.getTime()) return fmt(earliest);
    return `${fmt(earliest)} – ${fmt(latest)}`;
  }
}
