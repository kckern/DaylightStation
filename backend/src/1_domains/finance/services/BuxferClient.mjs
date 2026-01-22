/**
 * BuxferClient - Buxfer API integration for transaction management
 *
 * Migrated from: backend/_legacy/lib/buxfer.mjs
 *
 * This service handles:
 * - Authentication with Buxfer API
 * - Fetching transactions from accounts
 * - Creating, updating, and deleting transactions
 * - AI-powered transaction categorization
 * - Account balance retrieval
 */

import axios from '#backend/_legacy/lib/http.mjs';
import { URLSearchParams } from 'url';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import isJSON from 'is-json';
import moment from 'moment';
import { createLogger } from '../../../0_infrastructure/logging/logger.js';
import { configService } from '../../../0_infrastructure/config/index.mjs';

const logger = createLogger({ app: 'buxfer' });

const __appDirectory = `/${(new URL(import.meta.url)).pathname.split('/').slice(1, -5).join('/')}`;

/**
 * Get the data path from environment
 * @returns {string}
 */
const getDataPath = () => process.env.path?.data || `${__appDirectory}/data`;

/**
 * Get credentials from ConfigService (single source of truth)
 * @returns {object} Credentials object with BUXFER_EMAIL and BUXFER_PW
 */
const getCredentials = () => {
  // Get from user auth via ConfigService
  const auth = configService.getUserAuth('buxfer');
  if (auth?.email && auth?.password) {
    return {
      BUXFER_EMAIL: auth.email,
      BUXFER_PW: auth.password
    };
  }

  // Fallback: try local secrets file (legacy)
  const secretspath = `${__appDirectory}/config.secrets.yml`;
  if (existsSync(secretspath)) {
    try {
      const secrets = yaml.load(readFileSync(secretspath, 'utf8'));
      return {
        BUXFER_EMAIL: secrets.BUXFER_EMAIL,
        BUXFER_PW: secrets.BUXFER_PW
      };
    } catch (err) {
      logger.warn('buxfer.secrets_load_failed', { error: err.message });
    }
  }
  return { BUXFER_EMAIL: null, BUXFER_PW: null };
};

/**
 * Get authentication token from Buxfer API
 * @returns {Promise<string>} API token
 */
const getToken = async () => {
  // If a token already exists in process.env, return it
  if (process.env.BUXFER_TOKEN) {
    return process.env.BUXFER_TOKEN;
  }

  const { BUXFER_EMAIL, BUXFER_PW } = getCredentials();
  const url = 'https://www.buxfer.com/api/login';
  const params = {
    email: BUXFER_EMAIL,
    password: BUXFER_PW
  };

  const { data: { response: { token } } } = await axios.post(url, params);

  // Save the token to process.env
  process.env.BUXFER_TOKEN = token;

  return token;
};

/**
 * Fetch transactions from Buxfer
 * @param {object} options - Query options
 * @param {string} [options.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [options.endDate] - End date (YYYY-MM-DD)
 * @param {string[]} [options.accounts] - Account names to query
 * @param {string} [options.tagName] - Filter by tag name
 * @returns {Promise<Array>} Array of transactions
 */
export const getTransactions = async ({ startDate, endDate, accounts, tagName }) => {
  console.log(`Getting transactions from ${startDate} to ${endDate} for accounts: ${JSON.stringify(accounts)}`);
  const token = await getToken();
  startDate = startDate || '2022-01-01';
  endDate = endDate || '2024-12-31';
  accounts = accounts || ["Fidelity", "CaptialOne", "Payroll"];
  const command = 'transactions';
  let transactions = [];

  for (let account of accounts) {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const params = { page, accountName: account, startDate, endDate };
      if (tagName) params.tagName = tagName;
      const url = `https://www.buxfer.com/api/${command}?token=${token}&${new URLSearchParams(params).toString()}`;
      const { data: { response } } = await axios.get(url);
      transactions = [...transactions, ...response.transactions];
      if (response.transactions.length === 0) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return transactions;
};

/**
 * Delete transactions matching criteria
 * @param {object} options - Delete options
 * @param {string} options.accountId - Account ID
 * @param {string} options.matchString - String to match in description
 * @param {string} options.startDate - Start date
 * @param {string} options.endDate - End date
 * @returns {Promise<void>}
 */
export const deleteTransactions = async ({ accountId, matchString, startDate, endDate }) => {
  const dataPath = getDataPath();
  const deletedTransactions = (() => {
    try {
      return yaml.load(readFileSync(`${dataPath}/households/default/apps/finances/deletedTransactions.yml`, 'utf8')) || [];
    } catch {
      return {};
    }
  })();

  const transactions = await getTransactions({ startDate, endDate, accounts: [accountId] });
  const transactionsToDelete = transactions.filter(txn => txn.description.includes(matchString));
  console.log(`Deleting ${transactionsToDelete.length} transactions...`);

  for (let txn of transactionsToDelete) {
    const { id, description, amount, date } = txn;
    const r = await deleteTransaction(id);
    console.log(`Deleted: ${date} - ${id} - ${description} - ${amount}`);
    deletedTransactions[id] = { description, amount, date, accountId };
  }

  const deletedTransactionsYml = yaml.dump(deletedTransactions);
  writeFileSync(`${dataPath}/households/default/apps/finances/deletedTransactions.yml`, deletedTransactionsYml);
};

/**
 * Delete a single transaction
 * @param {string} id - Transaction ID
 * @returns {Promise<object>} API response
 */
export const deleteTransaction = async (id) => {
  try {
    const token = await getToken();
    const url = `https://www.buxfer.com/api/transaction_delete?token=${token}`;
    const params = { id };
    const { data: { response } } = await axios.post(url, params);
    return response;
  } catch (e) {
    console.log({ id, error: e.message });
  }
};

/**
 * Process mortgage transactions
 * @param {object} options - Query options
 * @param {string} options.startDate - Start date
 * @param {string[]} options.accounts - Account names
 * @returns {Promise<Array>} Mortgage transactions
 */
export const processMortgageTransactions = async ({ startDate, accounts }) => {
  console.log(`Processing mortgage transactions from ${startDate} for accounts: ${JSON.stringify(accounts)}`);
  if (!accounts) return [];
  const endDate = moment().format('YYYY-MM-DD');
  const transactions = await getTransactions({ startDate, endDate, accounts });
  return transactions;
};

/**
 * Get account balances
 * @param {object} options - Query options
 * @param {string[]} options.accounts - Account names
 * @returns {Promise<Array>} Account balances
 */
export const getAccountBalances = async ({ accounts }) => {
  console.log(`Getting account balances for accounts: ${JSON.stringify(accounts)}`);
  const token = await getToken();
  const command = 'accounts';
  const url = `https://www.buxfer.com/api/${command}?token=${token}`;
  const { data: { response } } = await axios.get(url);
  const balances = response.accounts.filter(acc => accounts.includes(acc.name)).map(acc => ({ name: acc.name, balance: acc.balance }));
  return balances;
};

/**
 * Process transactions with AI categorization
 * @param {object} options - Processing options
 * @param {string} options.startDate - Start date
 * @param {string} options.endDate - End date
 * @param {string[]} options.accounts - Account names
 * @returns {Promise<Array>} Processed transactions
 */
export const processTransactions = async ({ startDate, endDate, accounts }) => {
  console.log(`Processing transactions from ${startDate} to ${endDate}`);
  const transactions = await getTransactions({ startDate, endDate, accounts });

  const hasNoTag = (txn) => !txn.tagNames.length;
  const hasRawDescription = (txn) => /(^Direct|Pwp|^xx|as of|\*|（|Privacycom)/ig.test(txn.description);

  const txn_to_process = transactions.filter(txn => {
    const noTag = hasNoTag(txn);
    const rawDesc = hasRawDescription(txn);
    if (noTag || rawDesc) {
      return true;
    }
    return false;
  });

  txn_to_process.forEach(txn => console.log(`${txn.date} - ${txn.description}`));

  const dataPath = getDataPath();
  const { validTags, chat } = yaml.load(readFileSync(`${dataPath}/households/default/apps/finances/gpt.yml`, 'utf8'));
  chat[0].content = chat[0].content.replace("__VALID_TAGS__", JSON.stringify(validTags));

  // Dynamic import for GPT integration
  const { askGPT } = await import('#backend/_legacy/lib/gpt.mjs');

  for (let txn of txn_to_process) {
    const { description, id, tags, date } = txn;
    const index = transactions.findIndex(t => t.id === id);
    const gpt_input = [...chat, { role: "user", content: description }];
    const json_string = await askGPT(gpt_input, 'gpt-4o', { response_format: { type: "json_object" } });
    const is_json = isJSON(json_string);
    const { category, friendlyName, memo } = is_json ? JSON.parse(json_string) : {};
    if (friendlyName && validTags.includes(category)) {
      console.log(`${date} - ${id} - ${friendlyName} - ${category}`);
      const r = await updateTransaction(id, friendlyName, category, memo);
      transactions[index].tagNames = [category];
      transactions[index].description = friendlyName;
    } else {
      console.log(`\x1b[31mFailed to categorize (${category}): ${date} - ${id} - ${description}\x1b[0m`);
    }
  }

  // Delete comp transactions from Fidelity
  const deleteIds = transactions
    .filter(txn =>
      (txn.description.includes('FDIC') || txn.description.includes('Redemption')) &&
      txn.accountId === 732539
    )
    .map(txn => txn.id);

  for (let id of deleteIds) {
    const r = await deleteTransaction(id);
    console.log(`Deleted: ${id}`);
  }

  const saveMe = transactions.filter(txn => !deleteIds.includes(txn.id));
  return saveMe;
};

/**
 * Update a transaction
 * @param {string} id - Transaction ID
 * @param {string} description - New description
 * @param {string} tags - New tags
 * @param {string} memo - New memo
 * @returns {Promise<object>} API response
 */
export const updateTransaction = async (id, description, tags, memo) => {
  try {
    const token = await getToken();
    const url = `https://www.buxfer.com/api/transaction_edit?token=${token}`;
    const params = { id, description, tags, memo };
    const { data: { response } } = await axios.post(url, params);
    return response;
  } catch (e) {
    console.log({ id, description, tags, memo, error: e.message });
  }
};

/**
 * Add a new transaction
 * @param {object} options - Transaction details
 * @returns {Promise<object>} API response
 */
export const addTransaction = async ({ accountId, amount, date, description, tags, type, status, toAccountId, fromAccountId }) => {
  try {
    const token = await getToken();
    const url = `https://www.buxfer.com/api/transaction_add?token=${token}`;
    const tagsString = Array.isArray(tags) ? tags.join(',') : tags;
    const params = { accountId, amount, date, description, tags: tagsString, type, status };
    if (toAccountId) params['toAccountId'] = toAccountId;
    if (fromAccountId) params['fromAccountId'] = fromAccountId;
    const { data: { response } } = await axios.post(url, params);
    return response;
  } catch (e) {
    console.log({ accountId, amount, date, description, tags, type, status, error: e.message });
  }
};

// Default export for module compatibility
export default {
  getTransactions,
  deleteTransactions,
  deleteTransaction,
  processMortgageTransactions,
  getAccountBalances,
  processTransactions,
  updateTransaction,
  addTransaction
};
