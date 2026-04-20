export class GetDashboardState {
  #configRepository;
  #haGateway;
  #logger;
  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('GetDashboardState: configRepository required');
    if (!haGateway)        throw new Error('GetDashboardState: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute() {
    const config = await this.#configRepository.load();
    const entityIds = this.#collectEntityIds(config);
    const states = await this.#haGateway.getStates(entityIds);

    return {
      summary: {
        weather:      config.summary?.weather ?? false,
        sceneButtons: (config.summary?.scenes || []).map(s => ({
          id: s.id, label: s.label, icon: s.icon,
        })),
      },
      rooms: (config.rooms || []).map(room => this.#shapeRoom(room, states)),
    };
  }

  #collectEntityIds(config) {
    const out = new Set();
    for (const room of config.rooms || []) {
      for (const l of room.lights || []) {
        if (l.entity) out.add(l.entity);
      }
      if (room.climate?.temp)     out.add(room.climate.temp);
      if (room.climate?.humidity) out.add(room.climate.humidity);
      if (room.motion)            out.add(room.motion);
      if (room.media)             out.add(room.media);
    }
    return [...out];
  }

  #shapeRoom(room, states) {
    const lights = (room.lights || []).map(l => {
      const s = states.get(l.entity);
      return {
        entityId:  l.entity,
        label:     l.label,
        on:        s?.state === 'on',
        available: Boolean(s) && s.state !== 'unavailable' && s.state !== 'unknown',
      };
    });

    const temp = room.climate?.temp ? states.get(room.climate.temp) : null;
    const hum  = room.climate?.humidity ? states.get(room.climate.humidity) : null;
    const climate = {
      tempF:       this.#asNumber(temp?.state),
      humidityPct: this.#asNumber(hum?.state),
      available:   Boolean(temp) || Boolean(hum),
    };

    let motion = null;
    if (room.motion) {
      const m = states.get(room.motion);
      motion = {
        state:          m?.state === 'on' ? 'motion' : 'clear',
        lastChangedIso: m?.lastChanged || null,
        available:      Boolean(m),
      };
    }

    let media = null;
    if (room.media) {
      const m = states.get(room.media);
      media = { state: m?.state || 'unknown', available: Boolean(m) };
    }

    return {
      id: room.id, label: room.label, icon: room.icon || null,
      camera: room.camera || null,
      lights, climate, motion, media,
    };
  }

  #asNumber(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
export default GetDashboardState;
