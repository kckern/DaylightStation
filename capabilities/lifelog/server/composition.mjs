import { LifelogAggregator } from "./application/LifelogAggregator.mjs";
import { HarvestedLifelogSourceRegistry } from "./adapters/HarvestedLifelogSourceRegistry.mjs";

export function createLifelogServices(config) {
  const { userLoadFile, logger = console } = config;

  const lifelogAggregator = new LifelogAggregator({
    sourceRegistry: new HarvestedLifelogSourceRegistry({ userLoadFile, logger }),
    logger
  });

  return {
    lifelogAggregator
  };
}

export function createHarvestedLifelogAggregator({ dataService, logger }) {
  return new LifelogAggregator({
    sourceRegistry: new HarvestedLifelogSourceRegistry({ dataService, logger }), logger,
  });
}
