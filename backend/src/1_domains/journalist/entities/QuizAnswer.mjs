/**
 * QuizAnswer Entity
 * @module journalist/domain/entities/QuizAnswer
 *
 * Represents an answer to a quiz question.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * ValidationError for entity validation
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * QuizAnswer entity
 */
export class QuizAnswer {
  #uuid;
  #questionUuid;
  #chatId;
  #date;
  #answer;
  #answeredAt;

  /**
   * @param {object} props
   * @param {string} [props.uuid] - Answer ID
   * @param {string} props.questionUuid - Reference to question
   * @param {string} props.chatId - Chat ID
   * @param {string} props.date - Date of answer (YYYY-MM-DD)
   * @param {string|number} props.answer - The answer (text or choice index)
   * @param {string} [props.answeredAt] - When answered
   */
  constructor(props) {
    if (!props.questionUuid) {
      throw new ValidationError('questionUuid is required');
    }
    if (!props.chatId) {
      throw new ValidationError('chatId is required');
    }
    if (!props.date) {
      throw new ValidationError('date is required');
    }
    if (props.answer === undefined || props.answer === null) {
      throw new ValidationError('answer is required');
    }

    this.#uuid = props.uuid || uuidv4();
    this.#questionUuid = props.questionUuid;
    this.#chatId = props.chatId;
    this.#date = props.date;
    this.#answer = props.answer;
    this.#answeredAt = props.answeredAt || nowTs24();

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get uuid() {
    return this.#uuid;
  }
  get questionUuid() {
    return this.#questionUuid;
  }
  get chatId() {
    return this.#chatId;
  }
  get date() {
    return this.#date;
  }
  get answer() {
    return this.#answer;
  }
  get answeredAt() {
    return this.#answeredAt;
  }

  // ==================== Computed Properties ====================

  /**
   * Check if answer is numeric (choice index)
   * @returns {boolean}
   */
  get isNumericAnswer() {
    return typeof this.#answer === 'number';
  }

  /**
   * Check if answer is text
   * @returns {boolean}
   */
  get isTextAnswer() {
    return typeof this.#answer === 'string';
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new quiz answer
   * @param {object} props
   * @returns {QuizAnswer}
   */
  static create(props) {
    return new QuizAnswer(props);
  }

  /**
   * Create from question and answer choice
   * @param {import('./QuizQuestion.mjs').QuizQuestion} question
   * @param {string} chatId
   * @param {string} date
   * @param {number} choiceIndex
   * @returns {QuizAnswer}
   */
  static fromChoice(question, chatId, date, choiceIndex) {
    const choices = question.choices;
    if (choiceIndex < 0 || choiceIndex >= choices.length) {
      throw new ValidationError(`Invalid choice index: ${choiceIndex}`);
    }

    return new QuizAnswer({
      questionUuid: question.uuid,
      chatId,
      date,
      answer: choiceIndex,
    });
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      uuid: this.#uuid,
      questionUuid: this.#questionUuid,
      chatId: this.#chatId,
      date: this.#date,
      answer: this.#answer,
      answeredAt: this.#answeredAt,
    };
  }

  /**
   * Create from plain object
   * @param {object} data
   * @returns {QuizAnswer}
   */
  static from(data) {
    return new QuizAnswer(data);
  }
}

export default QuizAnswer;
