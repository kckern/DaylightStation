import { GratitudeService } from '../application/services/GratitudeService.mjs';
import { YamlGratitudeDatastore } from '../adapters/persistence/YamlGratitudeDatastore.mjs';

/** Explicit installed owner factory; the caller supplies its actual persistence authority. */
export function createGratitudeServices({dataService, logger=console}) {
  const gratitudeStore=new YamlGratitudeDatastore({dataService,logger});
  const gratitudeService=new GratitudeService({store:gratitudeStore});
  return {
    gratitudeStore, gratitudeService,
    readSelectionQuotes: () => dataService.household.read('gratitude/selections.gratitude.yml'),
    addSelections: (...args) => gratitudeService.addSelections(...args)
  };
}
