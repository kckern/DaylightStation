import { downsample } from '#apps/home-automation/services/TimeSeriesDownsampler.mjs';

const TARGET_POINTS = 150;

export class GetDashboardHistory {
  #configRepository;
  #haGateway;
  #clock;
  #logger;

  constructor({ configRepository, haGateway, clock, logger }) {
    if (!configRepository) throw new Error('GetDashboardHistory: configRepository required');
    if (!haGateway)        throw new Error('GetDashboardHistory: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#clock = clock || (() => new Date());
    this.#logger = logger || console;
  }

  async execute() {
    const config = await this.#configRepository.load();
    const tempCfg   = config.summary?.temp_chart;
    const energyCfg = config.summary?.energy_chart;

    const entityIds = new Set();
    const maxHours = Math.max(
      tempCfg?.hours   || 0,
      energyCfg?.hours || 0,
    );
    if (maxHours === 0) return { tempChart: null, energyChart: null };

    for (const s of tempCfg?.series || []) {
      if (s.entity) entityIds.add(s.entity);
    }
    if (energyCfg?.entity) entityIds.add(energyCfg.entity);

    const sinceIso = new Date(this.#clock().getTime() - maxHours * 3600_000).toISOString();
    const history = await this.#haGateway.getHistory([...entityIds], { sinceIso });

    const tempChart = tempCfg ? {
      title:  tempCfg.title || null,
      hours:  tempCfg.hours,
      series: (tempCfg.series || []).map(s => ({
        label:  s.label,
        color:  s.color,
        points: downsample(history.get(s.entity) || [], TARGET_POINTS),
      })),
    } : null;

    const energyChart = energyCfg ? {
      title:  energyCfg.title || null,
      hours:  energyCfg.hours,
      color:  energyCfg.color,
      points: downsample(history.get(energyCfg.entity) || [], TARGET_POINTS),
    } : null;

    return { tempChart, energyChart };
  }
}
export default GetDashboardHistory;
