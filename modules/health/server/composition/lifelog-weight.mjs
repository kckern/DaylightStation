import { DefaultPrincipalResolver } from '#apps/common/context/DefaultPrincipalResolver.mjs';
import { LifelogWeightService } from '../application/weight/LifelogWeightService.mjs';
import { DataServiceWeightHistorySource } from '../adapters/weight/DataServiceWeightHistorySource.mjs';

export function createLifelogWeightService({ dataService, configService }) {
  return new LifelogWeightService({
      principalResolver: new DefaultPrincipalResolver({
        headOfHousehold: () => configService?.getHeadOfHousehold?.(),
        fallback: 'user_1',
      }),
      weightHistorySource: new DataServiceWeightHistorySource({ dataService }),
    });
}
