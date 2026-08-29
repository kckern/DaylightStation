import { selectItemsForPrint } from '#domains/gratitude/services/PrintSelectionService.mjs';

/** Selects and projects the items drawn on a gratitude card. */
export class GratitudePrintPresentationService {
  constructor({ gratitude, resolveGroupLabel, clock, random, counts = { gratitude: 2, hopes: 2 } }) {
    this.gratitude = gratitude;
    this.resolveGroupLabel = resolveGroupLabel;
    this.clock = clock;
    this.random = random;
    this.counts = counts;
  }

  async prepare(householdId) {
    const selections = await this.gratitude.getSelectionsForPrint(householdId, this.resolveGroupLabel);
    if (!selections) return null;
    const nowMs = this.clock.now();
    const pick = (items, count) => (items?.length > 0
      ? selectItemsForPrint(items, count, nowMs, this.random).map((selection) => ({
          id: selection.id,
          text: selection.item.text,
          displayName: selection.displayName,
        }))
      : []);
    return {
      gratitude: pick(selections.gratitude, this.counts.gratitude),
      hopes: pick(selections.hopes, this.counts.hopes),
    };
  }
}

export default GratitudePrintPresentationService;
