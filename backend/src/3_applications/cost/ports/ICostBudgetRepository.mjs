/**
 * ICostBudgetRepository - Port interface for budget persistence
 * @module applications/cost/ports/ICostBudgetRepository
 *
 * Defines the contract for adapters that persist and retrieve budget definitions.
 * Budgets define spending limits for categories over time periods.
 *
 * @example
 * class YamlBudgetRepository extends ICostBudgetRepository {
 *   async findAll(householdId) { ... }
 *   async findByCategory(category) { ... }
 *   async save(budget) { ... }
 * }
 */

/**
 * ICostBudgetRepository interface
 * Abstract base class for budget persistence adapters
 *
 * @class ICostBudgetRepository
 */
export class ICostBudgetRepository {
  /**
   * Find all budgets for a household
   *
   * Returns all budget definitions for the given household,
   * including global budgets (category = null) and category-specific budgets.
   *
   * @param {string} householdId - Household identifier
   * @returns {Promise<CostBudget[]>} Array of budget definitions
   * @throws {Error} Must be implemented by concrete class
   */
  async findAll(householdId) {
    throw new Error('ICostBudgetRepository.findAll must be implemented');
  }

  /**
   * Find budgets for a specific category
   *
   * Returns budgets that apply to the given category.
   * Includes budgets that match the category exactly or match a parent category.
   *
   * @param {string|CostCategory} category - Category to find budgets for
   * @returns {Promise<CostBudget[]>} Array of matching budget definitions
   * @throws {Error} Must be implemented by concrete class
   */
  async findByCategory(category) {
    throw new Error('ICostBudgetRepository.findByCategory must be implemented');
  }

  /**
   * Save a budget definition
   *
   * Creates a new budget or updates an existing one (by ID).
   *
   * @param {CostBudget} budget - Budget to save
   * @returns {Promise<void>}
   * @throws {Error} Must be implemented by concrete class
   */
  async save(budget) {
    throw new Error('ICostBudgetRepository.save must be implemented');
  }
}

export default ICostBudgetRepository;
