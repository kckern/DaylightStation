/** Semantic read operations used by the deprecated local-content surface. */
export class LegacyLocalContentService {
  constructor({ repository, logger = console }) {
    if (!repository) throw new Error('LegacyLocalContentService requires repository');
    this.repository = repository;
    this.logger = logger;
  }

  #isConfigured() { return this.repository.isConfigured(); }

  async getScripture(input) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    const resolved = this.repository.resolveScripture(input);
    if (!resolved?.verseId || (!resolved?.path && (!resolved?.volume || !resolved?.version))) {
      return { kind: 'invalid', input };
    }
    const scripturePath = resolved.path ?? `${resolved.volume}/${resolved.version}/${resolved.verseId}`;
    const item = await this.repository.getItem(`scripture:${scripturePath}`);
    if (!item) return { kind: 'not_found', input, resolved: scripturePath };
    const volume = resolved.volume ?? item.metadata?.volume ?? null;
    const version = resolved.version;
    const verseId = resolved.verseId;
    const reference = item.metadata?.reference || this.repository.generateScriptureReference(verseId, input);
    return { kind: 'found', value: {
      input, reference, volume, version, verseId, assetId: scripturePath,
      duration: item.duration, verses: item.metadata?.verses || [],
    } };
  }

  async getHymn(number) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    const item = await this.repository.getItem(`hymn:${number}`);
    if (!item) return { kind: 'not_found', number };
    const hymnNumber = item.metadata.number || parseInt(number, 10);
    const duration = item.duration || item.metadata.duration || await this.repository.resolveAudioDuration('hymn', hymnNumber) || 0;
    return { kind: 'found', value: {
      title: item.title, number: hymnNumber, assetId: item.id,
      verses: item.metadata.verses, duration,
    } };
  }

  async getPrimary(number) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    const item = await this.repository.getItem(`primary:${number}`);
    if (!item) return { kind: 'not_found', number };
    const songNumber = item.metadata.number || parseInt(number, 10);
    const duration = item.duration || item.metadata.duration || await this.repository.resolveAudioDuration('primary', songNumber) || 0;
    return { kind: 'found', value: {
      title: item.title, number: songNumber, verses: item.metadata.verses, duration,
    } };
  }

  async getTalk(talkPath) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    let item = await this.repository.getItem(`talk:${talkPath}`);
    if (!item) return { kind: 'not_found', reason: 'talk_missing', path: talkPath };
    if (item.itemType === 'container' || !item.mediaUrl) {
      const list = await this.repository.getList(`talk:${talkPath}`);
      let children = list?.children || [];
      if (children.length > 0 && !children.some(child => child.mediaUrl)) {
        const latest = [...children].sort((a, b) => (b.localId || b.id || '').localeCompare(a.localId || a.id || ''))[0];
        const conferenceId = latest.id?.replace('talk:', '') || latest.localId;
        if (conferenceId) children = (await this.repository.getList(`talk:${conferenceId}`))?.children || [];
      }
      children = this.repository.filterPlayableTalks(children);
      let selected = null;
      const progress = await this.repository.getTalkProgress();
      if (progress !== null && children.length > 0) {
        const watchMap = new Map();
        for (const entry of progress) {
          const key = entry.contentId || '';
          let talkId = key.startsWith('plex:video/talks/') ? key.replace('plex:video/talks/', '')
            : key.startsWith('plex:talks/') ? key.replace('plex:talks/', '')
              : key.startsWith('talk:') ? key.replace('talk:', '') : null;
          if (!talkId) continue;
          const parts = talkId.split('/');
          if (parts.length < 2) continue;
          const normalized = `${parts.at(-2)}/${parts.at(-1)}`;
          watchMap.set(normalized, Math.max(watchMap.get(normalized) || 0, entry.percent || 0));
        }
        const sorted = [...children].sort((a, b) => (parseInt((a.localId || '').split('/').pop(), 10) || 0) - (parseInt((b.localId || '').split('/').pop(), 10) || 0));
        const percent = child => {
          const parts = (child.localId || '').split('/');
          return watchMap.get(`${parts.at(-2) || ''}/${parts.at(-1) || ''}`) || 0;
        };
        selected = sorted.find(child => percent(child) > 0 && percent(child) < 90)
          || sorted.find(child => percent(child) < 90) || sorted[0];
      }
      if (selected) item = selected;
      else {
        const firstPlayable = children.find(child => child.mediaUrl);
        if (firstPlayable) item = firstPlayable;
        else if (children.length > 0) {
          const childId = children[0].localId || children[0].id?.replace('talk:', '');
          if (childId) item = await this.repository.getItem(`talk:${childId}`);
        }
      }
      if (!item?.mediaUrl) return { kind: 'not_found', reason: 'no_playable_talks', path: talkPath };
    }
    const duration = item.duration || await this.repository.resolveTalkDuration(item) || 0;
    return { kind: 'found', value: {
      title: item.title, speaker: item.metadata?.speaker, assetId: item.id, mediaUrl: item.mediaUrl,
      duration, date: item.metadata?.date, description: item.metadata?.description, content: item.metadata?.content || [],
    } };
  }

  async getPoem(poemPath) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    const item = await this.repository.getItem(`poem:${poemPath}`);
    if (!item) return { kind: 'not_found', path: poemPath };
    return { kind: 'found', value: {
      title: item.title, author: item.metadata.author, condition: item.metadata.condition,
      alsoSuitableFor: item.metadata.also_suitable_for, poemId: item.metadata.poem_id,
      assetId: item.id, mediaUrl: item.mediaUrl, duration: item.duration, verses: item.metadata.verses,
    } };
  }

  async getCover(mediaKey) {
    if (!mediaKey) return { kind: 'invalid' };
    let coverArt = null;
    try { coverArt = await this.repository.getCoverArt(mediaKey); }
    catch (error) { this.logger.error?.('[localContent] cover art extraction error:', error.message); }
    const body = coverArt?.buffer || this.repository.createPlaceholder(mediaKey);
    return { kind: 'found', value: { buffer: body, mimeType: coverArt?.mimeType || 'image/png' } };
  }

  getCollectionCover(adapterName, collection, subPath) {
    const result = this.repository.getCollectionCover(adapterName, collection, subPath || undefined);
    if (result.error === 'unsupported') return { kind: 'unsupported' };
    if (!result.value) return { kind: 'not_found', collection, subPath };
    return { kind: 'found', value: result.value };
  }

  getCollectionIcon(adapterName, collection) {
    const result = this.repository.getCollectionIcon(adapterName, collection);
    if (result.error === 'unsupported') return { kind: 'unsupported' };
    if (!result.value) return { kind: 'not_found', collection };
    return { kind: 'found', value: result.value };
  }

  async getCollection(name) {
    if (!this.#isConfigured()) return { kind: 'unconfigured' };
    const items = await this.repository.listCollection(name);
    return { kind: 'found', value: { name, items: items.map(item => ({
      id: item.id, source: name, localId: item.localId, title: item.title,
      type: item.type || item.itemType || null, thumbnail: item.thumbnail || null,
    })) } };
  }
}

export default LegacyLocalContentService;
