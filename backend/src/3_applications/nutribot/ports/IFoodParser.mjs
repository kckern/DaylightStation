// backend/src/3_applications/nutribot/ports/IFoodParser.mjs

/**
 * Port interface for AI food parsing
 * @interface IFoodParser
 */
export const IFoodParser = {
  async parseText(text, context = {}) {},
  async parseImage(imageUrl, context = {}) {},
  async parseVoice(audioBuffer, context = {}) {}
};

export function isFoodParser(obj) {
  return (
    obj &&
    typeof obj.parseText === 'function' &&
    typeof obj.parseImage === 'function'
  );
}
