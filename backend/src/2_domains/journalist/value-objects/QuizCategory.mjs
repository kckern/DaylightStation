/**
 * QuizCategory Value Object
 * @module journalist/domain/value-objects/QuizCategory
 *
 * Defines categories for quiz questions in journaling.
 */

/**
 * @enum {string}
 */
export const QuizCategory = Object.freeze({
  MOOD: 'mood',
  GOALS: 'goals',
  GRATITUDE: 'gratitude',
  REFLECTION: 'reflection',
  HABITS: 'habits',
});

/**
 * All valid quiz categories
 * @type {string[]}
 */
export const ALL_QUIZ_CATEGORIES = Object.freeze(Object.values(QuizCategory));

/**
 * Check if a value is a valid quiz category
 * @param {string} category
 * @returns {boolean}
 */
export function isValidQuizCategory(category) {
  return ALL_QUIZ_CATEGORIES.includes(category);
}

/**
 * Get emoji for quiz category
 * @param {string} category
 * @returns {string}
 */
export function quizCategoryEmoji(category) {
  const emojis = {
    [QuizCategory.MOOD]: '😊',
    [QuizCategory.GOALS]: '🎯',
    [QuizCategory.GRATITUDE]: '🙏',
    [QuizCategory.REFLECTION]: '💭',
    [QuizCategory.HABITS]: '✅',
  };
  return emojis[category] || '📋';
}

/**
 * Get description for quiz category
 * @param {string} category
 * @returns {string}
 */
export function quizCategoryDescription(category) {
  const descriptions = {
    [QuizCategory.MOOD]: 'Emotional state and feelings',
    [QuizCategory.GOALS]: 'Progress toward goals',
    [QuizCategory.GRATITUDE]: 'Things to be thankful for',
    [QuizCategory.REFLECTION]: 'Looking back on events',
    [QuizCategory.HABITS]: 'Daily habits and routines',
  };
  return descriptions[category] || 'Unknown category';
}

export default QuizCategory;
