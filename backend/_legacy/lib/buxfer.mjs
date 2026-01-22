/**
 * Buxfer - Legacy Re-export Shim
 *
 * MIGRATION: This file wraps BuxferAdapter from the adapter layer.
 * Import from '#backend/src/2_adapters/finance/BuxferAdapter.mjs' instead.
 *
 * Example:
 *   // Old (deprecated):
 *   import { getTransactions } from '#backend/_legacy/lib/buxfer.mjs';
 *
 *   // New (preferred):
 *   import { BuxferAdapter } from '#backend/src/2_adapters/finance/BuxferAdapter.mjs';
 */

import { BuxferAdapter } from '../../src/2_adapters/finance/BuxferAdapter.mjs';
import { configService } from '../../src/0_infrastructure/config/index.mjs';
import axios from '../../src/0_infrastructure/http/httpClient.mjs';
import { createLogger } from '../../src/0_infrastructure/logging/logger.js';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { askGPT } from './gpt.mjs';
import isJSON from 'is-json';

const logger = createLogger({ source: 'backend', app: 'buxfer' });

// Lazy singleton
let adapterInstance = null;

function getAdapter() {
  if (!adapterInstance) {
    adapterInstance = new BuxferAdapter({
      httpClient: axios,
      getCredentials: () => configService.getUserAuth('buxfer'),
      logger
    });
  }
  return adapterInstance;
}

// Helper to get data path
const getDataPath = () => process.env.path?.data || '/app/data';

// ============ Wrapper functions matching legacy API ============

/**
 * Get transactions from Buxfer
 * @param {Object} options
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 * @param {string[]} options.accounts - Account names to query
 * @param {string} options.tagName - Filter by tag
 * @returns {Promise<Object[]>} Raw Buxfer transactions
 */
export const getTransactions = async (options) => {
  console.log(`Getting transactions from ${options.startDate} to ${options.endDate} for accounts: ${JSON.stringify(options.accounts)}`);
  return getAdapter().getTransactions(options);
};

/**
 * Delete a single transaction
 * @param {string} id - Transaction ID
 * @returns {Promise<Object>} Deletion result
 */
export const deleteTransaction = async (id) => {
  try {
    return await getAdapter().deleteTransaction(id);
  } catch (e) {
    console.log({ id, error: e.message });
  }
};

/**
 * Delete transactions matching a string
 * Note: This maintains legacy behavior of writing to deletedTransactions.yml
 * @param {Object} options
 * @param {string} options.accountId - Account name to search
 * @param {string} options.matchString - String to match in description
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 */
export const deleteTransactions = async ({ accountId, matchString, startDate, endDate }) => {
  const dataPath = getDataPath();
  const deletedTransactionsPath = `${dataPath}/households/default/apps/finances/deletedTransactions.yml`;

  // Load existing deleted transactions backup
  const deletedTransactions = (() => {
    try {
      return yaml.load(readFileSync(deletedTransactionsPath, 'utf8')) || {};
    } catch {
      return {};
    }
  })();

  const transactions = await getTransactions({ startDate, endDate, accounts: [accountId] });
  const transactionsToDelete = transactions.filter(txn => txn.description.includes(matchString));

  console.log(`Deleting ${transactionsToDelete.length} transactions...`);

  for (const txn of transactionsToDelete) {
    const { id, description, amount, date } = txn;
    await deleteTransaction(id);
    console.log(`Deleted: ${date} - ${id} - ${description} - ${amount}`);
    deletedTransactions[id] = { description, amount, date, accountId };
  }

  // Save backup
  const deletedTransactionsYml = yaml.dump(deletedTransactions);
  writeFileSync(deletedTransactionsPath, deletedTransactionsYml);
};

/**
 * Process mortgage transactions - simple wrapper
 * @param {Object} options
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string[]} options.accounts - Account names to query
 * @returns {Promise<Object[]>} Raw Buxfer transactions
 */
export const processMortgageTransactions = async ({ startDate, accounts }) => {
  console.log(`Processing mortgage transactions from ${startDate} for accounts: ${JSON.stringify(accounts)}`);
  if (!accounts) return [];
  return getAdapter().processMortgageTransactions({ startDate, accounts });
};

/**
 * Get account balances
 * Note: Returns legacy format (plain objects, not entities)
 * @param {Object} options
 * @param {string[]} options.accounts - Account names to query
 * @returns {Promise<Object[]>} Array of { name, balance }
 */
export const getAccountBalances = async ({ accounts }) => {
  console.log(`Getting account balances for accounts: ${JSON.stringify(accounts)}`);
  return getAdapter().getAccountBalancesLegacy(accounts);
};

/**
 * Update a transaction
 * Note: Legacy uses positional args; adapter uses object
 * @param {string} id - Transaction ID
 * @param {string} description - New description
 * @param {string} tags - Tags (comma-separated or single)
 * @param {string} memo - Optional memo
 * @returns {Promise<Object>} Update result
 */
export const updateTransaction = async (id, description, tags, memo) => {
  try {
    return await getAdapter().updateTransaction(id, { description, tags, memo });
  } catch (e) {
    console.log({ id, description, tags, memo, error: e.message });
  }
};

/**
 * Add a new transaction
 * @param {Object} options - Transaction data
 * @returns {Promise<Object>} Created transaction
 */
export const addTransaction = async (options) => {
  try {
    return await getAdapter().addTransaction(options);
  } catch (e) {
    console.log({ ...options, error: e.message });
  }
};

/**
 * Process transactions - categorize via AI and apply delete rules
 *
 * This maintains legacy behavior:
 * - Loads validTags and chat prompts from gpt.yml
 * - Uses askGPT for categorization
 * - Deletes FDIC/Redemption transactions from accountId 732539
 *
 * @param {Object} options
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 * @param {string[]} options.accounts - Account names to process
 * @returns {Promise<Object[]>} Processed transactions (excluding deleted)
 */
export const processTransactions = async ({ startDate, endDate, accounts }) => {
  console.log(`Processing transactions from ${startDate} to ${endDate}`);

  const transactions = await getTransactions({ startDate, endDate, accounts });
  const dataPath = getDataPath();

  // Load AI config from gpt.yml (legacy behavior)
  const gptConfigPath = `${dataPath}/households/default/apps/finances/gpt.yml`;
  let validTags = [];
  let chat = [];

  if (existsSync(gptConfigPath)) {
    const gptConfig = yaml.load(readFileSync(gptConfigPath, 'utf8'));
    validTags = gptConfig.validTags || [];
    chat = gptConfig.chat || [];

    // Inject valid tags into system prompt
    if (chat[0]?.content) {
      chat[0].content = chat[0].content.replace('__VALID_TAGS__', JSON.stringify(validTags));
    }
  }

  // Legacy detection patterns
  const hasNoTag = (txn) => !txn.tagNames?.length;
  const hasRawDescription = (txn) => /(^Direct|Pwp|^xx|as of|\*|（|Privacycom)/ig.test(txn.description);

  const txnToProcess = transactions.filter(txn => {
    const noTag = hasNoTag(txn);
    const rawDesc = hasRawDescription(txn);
    return noTag || rawDesc;
  });

  txnToProcess.forEach(txn => console.log(`${txn.date} - ${txn.description}`));

  // Process with AI categorization
  for (const txn of txnToProcess) {
    const { description, id, date } = txn;
    const index = transactions.findIndex(t => t.id === id);
    const gptInput = [...chat, { role: 'user', content: description }];

    try {
      const jsonString = await askGPT(gptInput, 'gpt-4o', { response_format: { type: 'json_object' } });
      const isJson = isJSON(jsonString);
      const { category, friendlyName, memo } = isJson ? JSON.parse(jsonString) : {};

      if (friendlyName && validTags.includes(category)) {
        console.log(`${date} - ${id} - ${friendlyName} - ${category}`);
        await updateTransaction(id, friendlyName, category, memo);
        transactions[index].tagNames = [category];
        transactions[index].description = friendlyName;
      } else {
        console.log(`\x1b[31mFailed to categorize (${category}): ${date} - ${id} - ${description}\x1b[0m`);
      }
    } catch (e) {
      console.log(`\x1b[31mAI error for ${id}: ${e.message}\x1b[0m`);
    }
  }

  // Legacy auto-delete: FDIC/Redemption from Fidelity (accountId 732539)
  const deleteIds = transactions
    .filter(txn =>
      (txn.description.includes('FDIC') || txn.description.includes('Redemption')) &&
      txn.accountId === 732539
    )
    .map(txn => txn.id);

  for (const id of deleteIds) {
    await deleteTransaction(id);
    console.log(`Deleted: ${id}`);
  }

  const result = transactions.filter(txn => !deleteIds.includes(txn.id));
  return result;
};
