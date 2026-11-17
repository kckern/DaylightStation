import { LifelogAggregator } from "./application/LifelogAggregator.mjs";
import { HarvestedLifelogSourceRegistry } from "./adapters/HarvestedLifelogSourceRegistry.mjs";

export function createLifelogServices(config) {
  const { userLoadFile, logger = console, workActivityReader, userTimezone } = config;

  const lifelogAggregator = new LifelogAggregator({
    sourceRegistry: new HarvestedLifelogSourceRegistry({ userLoadFile, logger, workActivityReader, userTimezone }),
    logger
  });

  return {
    lifelogAggregator
  };
}

export function createHarvestedLifelogAggregator({ dataService, logger, workActivityReader, userTimezone }) {
  return new LifelogAggregator({
    sourceRegistry: new HarvestedLifelogSourceRegistry({ dataService, logger, workActivityReader, userTimezone }), logger,
  });
}
