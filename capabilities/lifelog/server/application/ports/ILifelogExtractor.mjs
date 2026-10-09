/** Port contract for a lifelog source extractor. */
export const ExtractorCategory = {
  HEALTH: 'health',
  FITNESS: 'fitness',
  CALENDAR: 'calendar',
  PRODUCTIVITY: 'productivity',
  SOCIAL: 'social',
  JOURNAL: 'journal',
  FINANCE: 'finance',
};

export class ILifelogExtractor {
  get source() { throw new Error('ILifelogExtractor.source must be implemented'); }
  get category() { throw new Error('ILifelogExtractor.category must be implemented'); }
  extractForDate() { throw new Error('ILifelogExtractor.extractForDate must be implemented'); }
  summarize() { throw new Error('ILifelogExtractor.summarize must be implemented'); }
}

export default ILifelogExtractor;
