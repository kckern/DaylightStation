/**
 * Finance data generator
 * Generates budget config and transaction entries
 */

import {
  USERS,
  getActiveUsers,
  randomInt,
  randomFloat,
  randomChoice,
  randomBool,
  formatDate,
  addDays,
  pastDays,
  getDayOfWeek,
  isWeekday,
  uuid,
  shortId,
} from './utils.mjs';

// Budget categories with typical spending ranges
const BUDGET_CATEGORIES = [
  { domain: 'food', tier1: 'groceries', name: 'Groceries', period: 'WEEKLY', amount: 200, variance: 50 },
  { domain: 'food', tier1: 'dining', name: 'Dining Out', period: 'WEEKLY', amount: 100, variance: 40 },
  { domain: 'transportation', tier1: 'gas', name: 'Gas', period: 'MONTHLY', amount: 150, variance: 30 },
  { domain: 'transportation', tier1: 'rideshare', name: 'Rideshare', period: 'MONTHLY', amount: 50, variance: 30 },
  { domain: 'utilities', tier1: 'electricity', name: 'Electricity', period: 'MONTHLY', amount: 120, variance: 20 },
  { domain: 'utilities', tier1: 'internet', name: 'Internet', period: 'MONTHLY', amount: 80, variance: 0 },
  { domain: 'utilities', tier1: 'water', name: 'Water', period: 'MONTHLY', amount: 60, variance: 15 },
  { domain: 'entertainment', tier1: 'streaming', name: 'Streaming', period: 'MONTHLY', amount: 50, variance: 0 },
  { domain: 'entertainment', tier1: 'activities', name: 'Activities', period: 'MONTHLY', amount: 100, variance: 50 },
  { domain: 'shopping', tier1: 'clothing', name: 'Clothing', period: 'MONTHLY', amount: 100, variance: 80 },
  { domain: 'shopping', tier1: 'household', name: 'Household', period: 'MONTHLY', amount: 80, variance: 60 },
  { domain: 'health', tier1: 'gym', name: 'Gym Membership', period: 'MONTHLY', amount: 50, variance: 0 },
  { domain: 'health', tier1: 'pharmacy', name: 'Pharmacy', period: 'MONTHLY', amount: 40, variance: 30 },
  { domain: 'personal', tier1: 'subscriptions', name: 'Subscriptions', period: 'MONTHLY', amount: 30, variance: 10 },
];

// Common merchants per category
const MERCHANTS = {
  'food.groceries': ['Whole Foods', 'Trader Joes', 'Safeway', 'Costco', 'Sprouts'],
  'food.dining': ['Chipotle', 'Panda Express', 'Local Cafe', 'Pizza Place', 'Sushi Spot'],
  'transportation.gas': ['Shell', 'Chevron', '76', 'Costco Gas', 'Arco'],
  'transportation.rideshare': ['Uber', 'Lyft'],
  'utilities.electricity': ['PG&E', 'Edison'],
  'utilities.internet': ['Comcast', 'Spectrum', 'AT&T'],
  'utilities.water': ['City Water'],
  'entertainment.streaming': ['Netflix', 'Spotify', 'Disney+', 'HBO Max'],
  'entertainment.activities': ['AMC Theaters', 'Bowling Alley', 'Escape Room', 'Mini Golf'],
  'shopping.clothing': ['Target', 'Amazon', 'Old Navy', 'Nordstrom Rack'],
  'shopping.household': ['Target', 'Amazon', 'Home Depot', 'Bed Bath'],
  'health.gym': ['Planet Fitness', '24 Hour Fitness', 'LA Fitness'],
  'health.pharmacy': ['CVS', 'Walgreens', 'RiteAid'],
  'personal.subscriptions': ['iCloud', 'Dropbox', 'Adobe', 'Microsoft 365'],
};

// Income sources
const INCOME_SOURCES = [
  { name: 'Salary', amount: 5000, frequency: 'biweekly' },
  { name: 'Side Project', amount: 500, frequency: 'monthly', probability: 0.3 },
  { name: 'Dividend', amount: 50, frequency: 'quarterly', probability: 0.5 },
];

// Accounts
const ACCOUNTS = [
  { id: 'checking', name: 'Main Checking', type: 'checking', balance: 5000 },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 15000 },
  { id: 'credit', name: 'Credit Card', type: 'credit', balance: -500 },
];

/**
 * Generate budget configuration
 */
export function generateBudgetConfig() {
  return {
    budgets: BUDGET_CATEGORIES.map(cat => ({
      id: `budget-${cat.domain}-${cat.tier1}`,
      name: cat.name,
      category: {
        domain: cat.domain,
        tier1: cat.tier1,
      },
      period: cat.period,
      amount: cat.amount,
      currency: 'USD',
      alerts: {
        warning: 80,
        critical: 100,
      },
    })),
    accounts: ACCOUNTS.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
    })),
  };
}

/**
 * Generate account balances
 */
export function generateAccountBalances() {
  return {
    balances: ACCOUNTS.map(acc => ({
      accountId: acc.id,
      name: acc.name,
      type: acc.type,
      balance: acc.balance + randomInt(-500, 500),
      currency: 'USD',
      lastUpdated: formatDate(new Date()),
    })),
  };
}

/**
 * Generate a single transaction
 */
function generateTransaction(date, category, overrides = {}) {
  const categoryKey = `${category.domain}.${category.tier1}`;
  const merchants = MERCHANTS[categoryKey] || ['Unknown Merchant'];
  const merchant = randomChoice(merchants);

  // Base amount from category with variance
  const baseAmount = category.amount / (category.period === 'WEEKLY' ? 1 : 4);
  const amount = randomFloat(
    Math.max(1, baseAmount - category.variance / 4),
    baseAmount + category.variance / 4
  );

  const isCredit = category.domain !== 'utilities' && randomBool(0.7);
  const account = isCredit ? 'credit' : 'checking';

  return {
    id: `txn-${shortId()}`,
    occurredAt: `${formatDate(date)}T${String(randomInt(8, 21)).padStart(2, '0')}:${String(randomInt(0, 59)).padStart(2, '0')}:00Z`,
    amount: amount,
    currency: 'USD',
    description: merchant,
    category: {
      domain: category.domain,
      tier1: category.tier1,
    },
    type: 'expense',
    accountId: account,
    attribution: {
      householdId: 'demo',
      userId: randomChoice(getActiveUsers()).id,
      agentId: null,
    },
    reconcilesUsage: false,
    metadata: {
      source: isCredit ? 'credit_card' : 'bank',
    },
    ...overrides,
  };
}

/**
 * Generate income transaction
 */
function generateIncomeTransaction(date, source) {
  return {
    id: `txn-${shortId()}`,
    occurredAt: `${formatDate(date)}T09:00:00Z`,
    amount: source.amount,
    currency: 'USD',
    description: source.name,
    category: {
      domain: 'income',
      tier1: source.name.toLowerCase().replace(/\s+/g, '_'),
    },
    type: 'income',
    accountId: 'checking',
    attribution: {
      householdId: 'demo',
      userId: 'popeye', // Head of household gets income
      agentId: null,
    },
    reconcilesUsage: false,
    metadata: {},
  };
}

/**
 * Generate transactions for a date range
 */
export function generateTransactionsForRange(startDate, days) {
  const entries = [];
  const dates = pastDays(days);

  // Recurring monthly expenses (on specific days)
  const monthlyRecurring = [
    { category: BUDGET_CATEGORIES.find(c => c.tier1 === 'electricity'), dayOfMonth: 5 },
    { category: BUDGET_CATEGORIES.find(c => c.tier1 === 'internet'), dayOfMonth: 10 },
    { category: BUDGET_CATEGORIES.find(c => c.tier1 === 'water'), dayOfMonth: 15 },
    { category: BUDGET_CATEGORIES.find(c => c.tier1 === 'gym'), dayOfMonth: 1 },
    { category: BUDGET_CATEGORIES.find(c => c.tier1 === 'streaming'), dayOfMonth: 12 },
  ];

  // Weekly recurring
  const weeklyCategories = BUDGET_CATEGORIES.filter(c => c.period === 'WEEKLY');

  for (const date of dates) {
    const dayOfMonth = date.getDate();
    const dayOfWeek = getDayOfWeek(date);

    // Monthly recurring on their specific days
    for (const recurring of monthlyRecurring) {
      if (dayOfMonth === recurring.dayOfMonth && recurring.category) {
        entries.push(generateTransaction(date, recurring.category));
      }
    }

    // Income on 1st and 15th
    if (dayOfMonth === 1 || dayOfMonth === 15) {
      entries.push(generateIncomeTransaction(date, INCOME_SOURCES[0]));
    }

    // Weekly expenses - more on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Weekend - more dining and entertainment
      if (randomBool(0.6)) {
        entries.push(generateTransaction(date, BUDGET_CATEGORIES.find(c => c.tier1 === 'dining')));
      }
      if (randomBool(0.3)) {
        entries.push(generateTransaction(date, BUDGET_CATEGORIES.find(c => c.tier1 === 'activities')));
      }
    } else {
      // Weekday - groceries, occasional dining
      if (randomBool(0.2)) {
        entries.push(generateTransaction(date, BUDGET_CATEGORIES.find(c => c.tier1 === 'groceries')));
      }
      if (randomBool(0.15)) {
        entries.push(generateTransaction(date, BUDGET_CATEGORIES.find(c => c.tier1 === 'dining')));
      }
    }

    // Random shopping/errands
    if (randomBool(0.1)) {
      const randomCategory = randomChoice(BUDGET_CATEGORIES.filter(c =>
        ['clothing', 'household', 'pharmacy'].includes(c.tier1)
      ));
      if (randomCategory) {
        entries.push(generateTransaction(date, randomCategory));
      }
    }

    // Gas every 5-7 days
    if (dayOfMonth % 6 === 0) {
      entries.push(generateTransaction(date, BUDGET_CATEGORIES.find(c => c.tier1 === 'gas')));
    }
  }

  // Sort by date
  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return { entries };
}

/**
 * Group transactions by month for archival structure
 */
export function groupTransactionsByMonth(transactions) {
  const grouped = {};

  for (const txn of transactions.entries) {
    const month = txn.occurredAt.substring(0, 7); // YYYY-MM
    if (!grouped[month]) {
      grouped[month] = { entries: [] };
    }
    grouped[month].entries.push(txn);
  }

  return grouped;
}
