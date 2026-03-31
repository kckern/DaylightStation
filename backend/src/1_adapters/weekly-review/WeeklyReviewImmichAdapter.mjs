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
      size: 500,
    });

    const assets = result.items || result || [];

    if (assets.length === 0) {
      this.#logger.warn?.('weekly-review.immich.no-assets', { startDate, endDate });
    }

    const byDate = new Map();
    for (const asset of assets) {
      if (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') continue;
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
      totalVideos: assets.filter(a => a.type === 'VIDEO').length,
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
      type: item.asset.type === 'VIDEO' ? 'video' : 'image',
      thumbnail: `${this.#proxyPath}/assets/${item.asset.id}/thumbnail`,
      original: `${this.#proxyPath}/assets/${item.asset.id}/original`,
      people: item.people,
      isHero: assets.length >= 3 && index === 0 && item.asset.type !== 'VIDEO',
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

  /**
   * Parse local time from Immich's localDateTime string.
   * Immich appends Z but the time is actually local — don't let Date interpret as UTC.
   */
  #parseLocalTime(isoStr) {
    // "2026-03-25T09:01:00.000Z" → extract "09:01"
    const match = isoStr?.match(/T(\d{2}):(\d{2})/);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${ampm}`;
  }

  #formatTimeRange(session) {
    if (session.length === 0) return '';
    const sorted = [...session].sort((a, b) =>
      a.asset.localDateTime.localeCompare(b.asset.localDateTime)
    );
    const earliest = this.#parseLocalTime(sorted[0].asset.localDateTime);
    const latest = this.#parseLocalTime(sorted[sorted.length - 1].asset.localDateTime);
    if (!earliest) return '';
    if (earliest === latest) return earliest;
    return `${earliest} – ${latest}`;
  }
}
