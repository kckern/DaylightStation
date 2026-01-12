/**
 * IQuizRepository Port
 * @module journalist/application/ports/IQuizRepository
 *
 * Repository for quiz questions and answers.
 */

/**
 * @interface IQuizRepository
 */

/**
 * Load questions by category
 * @function
 * @name IQuizRepository#loadQuestions
 * @param {string} [category] - Optional category filter
 * @returns {Promise<QuizQuestion[]>}
 */

/**
 * Get next question to ask
 * @function
 * @name IQuizRepository#getNextQuestion
 * @param {string} category
 * @returns {Promise<QuizQuestion|null>}
 */

/**
 * Record an answer
 * @function
 * @name IQuizRepository#recordAnswer
 * @param {string} questionUuid
 * @param {QuizAnswer} answer
 * @returns {Promise<void>}
 */

/**
 * Reset a category (clear lastAsked)
 * @function
 * @name IQuizRepository#resetCategory
 * @param {string} category
 * @returns {Promise<void>}
 */

/**
 * Get answer history for a chat
 * @function
 * @name IQuizRepository#getAnswerHistory
 * @param {string} chatId
 * @param {object} [dateRange] - { start, end }
 * @returns {Promise<QuizAnswer[]>}
 */

// Export interface documentation
export const IQuizRepository = {
  name: 'IQuizRepository',
  methods: ['loadQuestions', 'getNextQuestion', 'recordAnswer', 'resetCategory', 'getAnswerHistory'],
};

export default IQuizRepository;
