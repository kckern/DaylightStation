/**
 * QuizQuestion Entity
 * @module journalist/domain/entities/QuizQuestion
 * 
 * Represents a quiz question for structured journaling.
 */

import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../../_lib/errors/index.mjs';
import { QuizCategory, isValidQuizCategory } from '../value-objects/QuizCategory.mjs';

/**
 * QuizQuestion entity
 */
export class QuizQuestion {
  #uuid;
  #category;
  #question;
  #choices;
  #lastAsked;

  /**
   * @param {object} props
   * @param {string} [props.uuid] - Question ID
   * @param {string} props.category - Quiz category
   * @param {string} props.question - Question text
   * @param {string[]} props.choices - Answer choices
   * @param {string|null} [props.lastAsked] - When last asked
   */
  constructor(props) {
    if (!props.category || !isValidQuizCategory(props.category)) {
      throw new ValidationError(`Invalid quiz category: ${props.category}`);
    }
    if (!props.question) {
      throw new ValidationError('question is required');
    }
    if (!Array.isArray(props.choices) || props.choices.length < 2) {
      throw new ValidationError('choices must be an array with at least 2 options');
    }

    this.#uuid = props.uuid || uuidv4();
    this.#category = props.category;
    this.#question = props.question;
    this.#choices = Object.freeze([...props.choices]);
    this.#lastAsked = props.lastAsked || null;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get uuid() { return this.#uuid; }
  get category() { return this.#category; }
  get question() { return this.#question; }
  get choices() { return [...this.#choices]; }
  get lastAsked() { return this.#lastAsked; }

  // ==================== Computed Properties ====================

  /**
   * Check if question has been asked before
   * @returns {boolean}
   */
  get hasBeenAsked() {
    return this.#lastAsked !== null;
  }

  /**
   * Get days since last asked
   * @returns {number|null}
   */
  get daysSinceAsked() {
    if (!this.#lastAsked) return null;
    const diff = Date.now() - new Date(this.#lastAsked).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  // ==================== Mutation Methods ====================

  /**
   * Mark question as asked
   * @returns {QuizQuestion}
   */
  markAsked() {
    return new QuizQuestion({
      ...this.toJSON(),
      lastAsked: new Date().toISOString(),
    });
  }

  /**
   * Update choices
   * @param {string[]} choices
   * @returns {QuizQuestion}
   */
  withChoices(choices) {
    return new QuizQuestion({
      ...this.toJSON(),
      choices,
    });
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new quiz question
   * @param {object} props
   * @returns {QuizQuestion}
   */
  static create(props) {
    return new QuizQuestion(props);
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      uuid: this.#uuid,
      category: this.#category,
      question: this.#question,
      choices: [...this.#choices],
      lastAsked: this.#lastAsked,
    };
  }

  /**
   * Create from plain object
   * @param {object} data
   * @returns {QuizQuestion}
   */
  static from(data) {
    return new QuizQuestion(data);
  }
}

export default QuizQuestion;
