// backend/src/3_applications/nutribot/ports/IFoodParser.mjs

/**
 * Port interface for AI food parsing
 * @interface IFoodParser
 */
export class IFoodParser {
  async parseText(_text, _context = {}) { throw new Error('IFoodParser.parseText not implemented'); }
  async parseImage(_imageUrl, _context = {}) { throw new Error('IFoodParser.parseImage not implemented'); }
  async parseVoice(_audioBuffer, _context = {}) { throw new Error('IFoodParser.parseVoice not implemented'); }
}

export function isFoodParser(obj) {
  return (
    obj &&
    typeof obj.parseText === 'function' &&
    typeof obj.parseImage === 'function'
  );
}
