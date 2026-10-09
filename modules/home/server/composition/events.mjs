
export async function createHomeEvents({ configService, dataService, rootLogger }) {
  const { EventAggregationService } = await import("../application/EventAggregationService.mjs");
  const { DataServiceEventFeedRepository } = await import("../adapters/DataServiceEventFeedRepository.mjs");
  const eventAggregationService = new EventAggregationService({
    eventRepository: new DataServiceEventFeedRepository({
      dataService,
      defaultUser: () => configService.getHeadOfHousehold?.(),
    }),
    logger: rootLogger.child({ module: 'event-aggregation' }),
  });


return eventAggregationService;
}
