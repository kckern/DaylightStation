/** Application facade for legacy home-control and e-ink photo operations. */
export class LegacyHomeAutomationService {
  constructor({
    tvGateway = null,
    kioskGateway = null,
    taskerGateway = null,
    remoteExecGateway = null,
    homeStateService = null,
    gallerySource = null,
    artSource = null,
    buildPhotoTitle = () => '',
    formatPhotoDate = () => '',
    orderPeopleByFace = (people) => people || [],
    random = Math.random,
    clock = Date.now,
    logger = console,
  } = {}) {
    Object.assign(this, {
      tvGateway, kioskGateway, taskerGateway, remoteExecGateway, homeStateService,
      gallerySource, artSource, buildPhotoTitle, formatPhotoDate, orderPeopleByFace,
      random, clock, logger,
    });
    this.photoCache = new Map();
  }

  async controlTv(state, location = undefined) {
    if (!this.tvGateway) return { kind: 'unavailable' };
    const invoke = (method) => location === undefined ? method.call(this.tvGateway) : method.call(this.tvGateway, location);
    if (state === 'toggle') return { kind: 'completed', value: await invoke(this.tvGateway.toggle) };
    if (state === 'on') return { kind: 'completed', value: await invoke(this.tvGateway.turnOn) };
    return { kind: 'completed', value: await invoke(this.tvGateway.turnOff) };
  }

  async controlVolume(level) {
    if (!this.remoteExecGateway || !this.homeStateService) return { kind: 'unavailable' };
    return { kind: 'completed', value: await this.homeStateService.controlVolume(level) };
  }

  async setAudioDevice(device) {
    if (!this.remoteExecGateway) return { kind: 'unavailable' };
    return { kind: 'completed', value: await this.remoteExecGateway.setAudioDevice(device) };
  }

  async executeRemote(command) {
    if (!this.remoteExecGateway) return { kind: 'unavailable' };
    return { kind: 'completed', value: await this.remoteExecGateway.execute(command) };
  }

  isRemoteExecutionAvailable() { return Boolean(this.remoteExecGateway); }

  getKeyboard(keyboardId) { return this.homeStateService?.getKeyboard(keyboardId) || { kind: 'unavailable' }; }
  async getWeather() {
    if (!this.homeStateService) return { kind: 'unavailable' };
    return { kind: 'found', value: await this.homeStateService.getWeather() };
  }
  getEvents() {
    return this.homeStateService
      ? { kind: 'found', value: this.homeStateService.getEvents() }
      : { kind: 'unavailable' };
  }

  async getPhoto({ favorites, collection, holdHours, holdKey }) {
    if (!this.gallerySource) return { kind: 'gallery_unavailable' };
    const holdMs = holdHours * 3600 * 1000;
    const key = JSON.stringify({ favorites, collection, holdHours, holdKey });
    const now = this.clock();
    const cached = this.photoCache.get(key);
    if (cached && now - cached.pickedAt < holdMs) {
      this.logger.info?.('home.photo.cached', { ageMs: now - cached.pickedAt, holdHours, holdKey, collection });
      return { kind: 'found', value: cached.payload };
    }

    let ids;
    if (collection) {
      if (!this.artSource?.collectionAssetIds) return { kind: 'art_unavailable' };
      ids = (await this.artSource.collectionAssetIds(collection)).slice().sort();
    } else {
      const result = await this.gallerySource.search({ favorites, mediaType: 'image', take: 1000 });
      ids = (result?.items || []).map((item) => item?.id).filter(Boolean).sort();
    }
    if (ids.length === 0) return { kind: 'not_found' };
    const picked = ids[Math.floor(this.random() * ids.length)];
    const viewable = await this.gallerySource.getViewable(picked);
    if (!viewable) return { kind: 'load_failed' };

    const meta = viewable.metadata || {};
    const people = this.orderPeopleByFace(meta.people, meta.exif?.orientation)
      .map((person) => person.name).filter(Boolean);
    const location = meta.exif?.city || meta.exif?.country || null;
    const when = meta.localDateTime || null;
    const payload = {
      id: viewable.id,
      imageUrl: viewable.imageUrl,
      title: this.buildPhotoTitle(people, location, when),
      date: this.formatPhotoDate(when) || '',
    };
    this.photoCache.set(key, { pickedAt: now, payload });
    this.logger.info?.('home.photo.picked', { id: picked, count: ids.length, holdHours, holdKey, collection });
    return { kind: 'found', value: payload };
  }

  getStatus() {
    return {
      ok: true,
      adapters: {
        tv: { configured: !!this.tvGateway, locations: this.tvGateway?.getLocations?.() || [], metrics: this.tvGateway?.getMetrics?.() },
        kiosk: { configured: this.kioskGateway?.isConfigured?.() || false, metrics: this.kioskGateway?.getMetrics?.() },
        tasker: { configured: this.taskerGateway?.isConfigured?.() || false, metrics: this.taskerGateway?.getMetrics?.() },
        remoteExec: { configured: this.remoteExecGateway?.isConfigured?.() || false, metrics: this.remoteExecGateway?.getMetrics?.() },
      },
    };
  }
}

export default LegacyHomeAutomationService;
