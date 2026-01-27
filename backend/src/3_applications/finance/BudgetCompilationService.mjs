/**
 * BudgetCompilationService - Orchestrates complex budget compilation
 *
 * Coordinates domain services to build complete budget data including:
 * - Monthly budget breakdowns (past, current, future projections)
 * - Day-to-day spending analysis with daily balances
 * - Short-term bucket allocation with surplus distribution
 * - Mortgage status calculations
 *
 * Dependencies:
 * - TransactionClassifier (domain): Categorizes transactions into buckets
 * - MortgageCalculator (domain): Calculates mortgage projections
 * - YamlFinanceStore (adapter): Persistence for finance data
 */

import { TransactionClassifier, MortgageCalculator } from '#domains/finance/index.mjs';

export class BudgetCompilationService {
  #financeStore;
  #mortgageCalculator;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.financeStore - YamlFinanceStore instance
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ financeStore, logger }) {
    if (!financeStore) {
      throw new Error('BudgetCompilationService requires financeStore');
    }
    this.#financeStore = financeStore;
    this.#mortgageCalculator = new MortgageCalculator();
    this.#logger = logger || console;
  }

  /**
   * Compile complete budget data for a household
   *
   * @param {string} [householdId] - Household ID
   * @returns {Promise<{budgets: Object, mortgage: Object}>}
   */
  async compile(householdId) {
    const config = this.#financeStore.getBudgetConfig(householdId);
    if (!config) {
      throw new Error('Budget configuration not found');
    }

    const { budget: budgetConfigs, mortgage: mortgageConfig } = config;
    const budgetStartDates = budgetConfigs.map(b => this.#toDateString(b.timeframe.start));

    // Load all required data
    const accountBalances = this.#financeStore.getAccountBalances(householdId) || [];
    const mortgageTransactions = this.#financeStore.getMortgageTransactions(householdId) || [];

    // Load and merge all transactions across budget periods
    const rawTransactions = this.#loadAllTransactions(budgetStartDates, householdId);

    // Apply memos to transactions
    const transactions = this.#financeStore.applyMemos(rawTransactions, householdId);

    // Calculate mortgage status
    const mortgage = this.#compileMortgage(mortgageConfig, accountBalances, mortgageTransactions);

    // Compile each budget period
    const budgets = {};
    const sortedBudgets = [...budgetConfigs].sort(
      (a, b) => new Date(b.timeframe.start) - new Date(a.timeframe.start)
    );

    for (const budgetConfig of sortedBudgets) {
      const startDate = this.#toDateString(budgetConfig.timeframe.start);
      const endDate = this.#toDateString(budgetConfig.timeframe.end);

      const periodTransactions = transactions.filter(
        txn => txn.date >= startDate && txn.date <= endDate
      );

      this.#log('info', 'budget.compile.period', { start: startDate, end: endDate });
      budgets[startDate] = this.#compileBudgetPeriod(budgetConfig, periodTransactions);
    }

    // Save compiled finances
    this.#financeStore.saveCompiledFinances({ budgets, mortgage }, householdId);
    this.#log('info', 'budget.finances.saved');

    return { budgets, mortgage };
  }

  /**
   * Compile a single budget period
   *
   * @param {Object} config - Budget period configuration
   * @param {Object[]} transactions - Transactions in this period
   * @returns {Object} Compiled budget data
   */
  #compileBudgetPeriod(config, transactions) {
    const classifier = new TransactionClassifier(config);
    const budgetStart = this.#toDateString(config.timeframe.start);
    const budgetEnd = this.#toDateString(config.timeframe.end);

    // Get monthly breakdown
    const { monthlyBudget, totalBudget } = this.#getMonthlyBudget(config, transactions, classifier);
    const monthList = Object.keys(monthlyBudget);

    // Build derived budgets
    const dayToDayBudget = this.#buildDayToDayBudget(monthList, monthlyBudget, config);
    const transferTransactions = this.#buildTransferSummary(monthList, monthlyBudget);
    const shortTermBuckets = this.#buildShortTermBuckets(monthList, monthlyBudget, config);

    // Handle unbudgeted transactions and surplus allocation
    this.#allocateSurplus(monthlyBudget, shortTermBuckets, config);

    // Calculate short-term totals
    const shortTermStatus = this.#calculateShortTermStatus(shortTermBuckets);

    return {
      budgetStart,
      budgetEnd,
      accounts: config.accounts,
      dayToDayBudget,
      monthlyBudget,
      totalBudget,
      shortTermBuckets,
      shortTermStatus,
      transferTransactions
    };
  }

  /**
   * Get monthly budget breakdown
   */
  #getMonthlyBudget(config, transactions, classifier) {
    const startDate = this.#toDateString(config.timeframe.start);
    const endDate = this.#toDateString(config.timeframe.end);
    const firstMonth = startDate.slice(0, 7);
    const lastMonth = endDate.slice(0, 7);

    const monthList = this.#generateMonthList(firstMonth, lastMonth);
    const todayMonth = this.#getCurrentMonth();

    const monthlyBudget = {};

    for (const month of monthList) {
      const isFuture = month > todayMonth;
      const isCurrent = month === todayMonth;
      const monthTransactions = transactions.filter(txn => txn.date.slice(0, 7) === month);

      if (isFuture) {
        monthlyBudget[month] = this.#futureMonthlyBudget(month, config);
      } else if (isCurrent) {
        monthlyBudget[month] = this.#currentMonthlyBudget(month, config, monthTransactions, classifier);
      } else {
        monthlyBudget[month] = this.#pastMonthlyBudget(month, config, monthTransactions, classifier);
      }
    }

    // Calculate totals
    const totalBudget = this.#calculateTotalBudget(monthlyBudget);

    return { monthlyBudget, totalBudget };
  }

  /**
   * Calculate future month budget (projections only)
   */
  #futureMonthlyBudget(month, config) {
    const { income: incomeConfig, monthly, dayToDay, cutoff } = config;
    const {
      salary: { amount: salaryAmount, payCheckCount, payFrequencyInDays, firstPaycheckDate }
    } = incomeConfig;

    // Calculate paychecks for this month
    const paycheckAmount = this.#round(salaryAmount / payCheckCount);
    const paycheckDates = this.#generatePaycheckDates(
      firstPaycheckDate, payCheckCount, payFrequencyInDays
    );

    let paycheckDatesThisMonth = paycheckDates.filter(d => d.slice(0, 7) === month);
    if (cutoff) {
      paycheckDatesThisMonth = paycheckDatesThisMonth.filter(d => d >= cutoff);
    }

    const paychecks = paycheckDatesThisMonth.map(date => ({ date, amount: paycheckAmount }));
    const payCheckIncomeAmount = paychecks.reduce((acc, p) => acc + p.amount, 0);
    const paycheckCountThisMonth = paychecks.length;

    // Calculate extra income
    const extraIncomeTransactions = this.#getExtraIncomeForMonth(incomeConfig.extra, month, cutoff);
    const extraIncomeAmount = extraIncomeTransactions.reduce((acc, t) => acc + t.amount, 0);

    const income = payCheckIncomeAmount + extraIncomeAmount;
    const incomeTransactions = [...paychecks, ...extraIncomeTransactions].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    // Calculate monthly expenses
    const monthlyCategories = this.#calculateMonthlyCategories(monthly, month, cutoff, paycheckCountThisMonth);
    const categorySpending = Object.values(monthlyCategories).reduce((acc, { amount }) => acc + amount, 0);

    const dayToDaySpending = dayToDay.amount;
    const monthlySpending = this.#round(categorySpending);
    const surplus = this.#round(income - monthlySpending - dayToDaySpending);

    return {
      income,
      incomeTransactions,
      monthlyCategories,
      monthlySpending,
      dayToDaySpending,
      surplus
    };
  }

  /**
   * Calculate past month budget (actual data)
   */
  #pastMonthlyBudget(month, config, transactions, classifier) {
    const incomeTransactions = [];
    const monthlyCategories = {};
    const shortTermTransactions = [];
    const dayToDayTransactions = [];
    const transferTransactions = [];

    for (const txn of transactions) {
      const { label, bucket } = classifier.classify(txn);
      txn.label = label;
      txn.bucket = bucket;

      if (bucket === 'income') {
        incomeTransactions.push(txn);
      } else if (bucket === 'day') {
        dayToDayTransactions.push(txn);
      } else if (bucket === 'transfer') {
        transferTransactions.push(txn);
      } else if (bucket === 'monthly') {
        if (!monthlyCategories[label]) {
          monthlyCategories[label] = { amount: 0, credits: 0, debits: 0, transactions: [] };
        }
        monthlyCategories[label].amount += txn.expenseAmount;
        monthlyCategories[label].credits += txn.expenseAmount < 0 ? Math.abs(txn.expenseAmount) : 0;
        monthlyCategories[label].debits += txn.expenseAmount > 0 ? txn.expenseAmount : 0;
        monthlyCategories[label].transactions.push(txn);

        // Round values
        monthlyCategories[label].amount = this.#round(monthlyCategories[label].amount);
        monthlyCategories[label].credits = this.#round(monthlyCategories[label].credits);
        monthlyCategories[label].debits = this.#round(monthlyCategories[label].debits);
      } else if (bucket === 'shortTerm') {
        shortTermTransactions.push(txn);
      } else {
        // Unbudgeted
        if (!monthlyCategories['Unbudgeted']) {
          monthlyCategories['Unbudgeted'] = { amount: 0, transactions: [] };
        }
        monthlyCategories['Unbudgeted'].amount += txn.amount;
        monthlyCategories['Unbudgeted'].transactions.push(txn);
      }
    }

    const income = this.#round(incomeTransactions.reduce((acc, txn) => acc + txn.amount, 0));
    const nonBonusIncome = this.#round(
      incomeTransactions
        .filter(txn => txn.tagNames?.includes('Income'))
        .reduce((acc, txn) => acc + txn.amount, 0)
    );
    const monthlyCategorySpending = this.#round(
      Object.values(monthlyCategories).reduce((acc, { amount }) => acc + amount, 0)
    );
    const dayToDaySpending = this.#round(dayToDayTransactions.reduce((acc, txn) => acc + txn.amount, 0));
    const monthlySpending = this.#round(monthlyCategorySpending);
    const spending = this.#round(dayToDaySpending + monthlySpending);
    const surplus = this.#round(income - monthlySpending - dayToDaySpending);

    const monthlyDebits = this.#round(
      shortTermTransactions
        .filter(txn => txn.expenseAmount > 0)
        .reduce((acc, txn) => acc + txn.expenseAmount, 0)
    );
    const monthlyCredits = Math.abs(this.#round(
      shortTermTransactions
        .filter(txn => txn.expenseAmount < 0)
        .reduce((acc, txn) => acc + txn.expenseAmount, 0)
    ));

    return {
      income,
      nonBonusIncome,
      spending,
      surplus,
      monthlySpending,
      monthlyDebits,
      monthlyCredits,
      dayToDaySpending,
      incomeTransactions,
      monthlyCategories,
      dayToDayTransactions,
      shortTermTransactions,
      transferTransactions
    };
  }

  /**
   * Calculate current month budget (hybrid past + anticipated)
   */
  #currentMonthlyBudget(month, config, transactions, classifier) {
    const pastData = this.#pastMonthlyBudget(month, config, transactions, classifier);
    const futureData = this.#futureMonthlyBudget(month, config);
    const currentData = { ...pastData };

    const endOfMonth = this.#getEndOfMonth(month);

    // Calculate anticipated income
    const anticipatedIncome = parseFloat(futureData.income) - parseFloat(pastData.nonBonusIncome || 0);
    currentData.income = parseFloat(pastData.income) + anticipatedIncome;

    currentData.incomeTransactions = [
      ...pastData.incomeTransactions,
      {
        date: endOfMonth,
        transactionType: 'income',
        amount: anticipatedIncome,
        description: 'Anticipated Income',
        tagNames: ['Income'],
        tag: 'Income',
        flag: 'Anticipated'
      }
    ];

    // Add anticipated taxes
    const anticipatedTaxRate = 0.2; // Default tax rate
    const anticipatedTaxAmount = this.#round(anticipatedIncome * anticipatedTaxRate);

    if (anticipatedTaxAmount > 0) {
      if (!currentData.monthlyCategories['Taxes']) {
        currentData.monthlyCategories['Taxes'] = { amount: 0, credits: 0, debits: 0, transactions: [] };
      }
      currentData.monthlyCategories['Taxes'].amount += anticipatedTaxAmount;
      currentData.monthlyCategories['Taxes'].debits += anticipatedTaxAmount;
      currentData.monthlyCategories['Taxes'].transactions.push({
        date: endOfMonth,
        transactionType: 'expense',
        amount: anticipatedTaxAmount,
        expenseAmount: anticipatedTaxAmount,
        description: 'Anticipated Withholding',
        tagNames: ['Taxes'],
        tag: 'Taxes',
        flag: 'Anticipated'
      });
    }

    // Merge anticipated monthly categories
    for (const categoryLabel of Object.keys(futureData.monthlyCategories)) {
      const futureCategory = futureData.monthlyCategories[categoryLabel];
      const pastCategory = pastData.monthlyCategories[categoryLabel];
      const anticipatedAmount = this.#round(futureCategory.amount - (pastCategory?.amount || 0));

      if (anticipatedAmount > 0) {
        if (!currentData.monthlyCategories[categoryLabel]) {
          currentData.monthlyCategories[categoryLabel] = { amount: 0, credits: 0, debits: 0, transactions: [] };
        }
        currentData.monthlyCategories[categoryLabel].amount += anticipatedAmount;
        currentData.monthlyCategories[categoryLabel].debits += anticipatedAmount;
        currentData.monthlyCategories[categoryLabel].transactions.push({
          date: endOfMonth,
          transactionType: 'expense',
          amount: anticipatedAmount,
          expenseAmount: anticipatedAmount,
          description: `Anticipated ${categoryLabel}`,
          tagNames: [categoryLabel],
          tag: categoryLabel,
          flag: 'Anticipated'
        });
      }
    }

    // Calculate anticipated day-to-day spending
    const anticipatedDayToDaySpending = parseFloat(futureData.dayToDaySpending) - parseFloat(pastData.dayToDaySpending);
    currentData.dayToDaySpending = parseFloat(pastData.dayToDaySpending) + anticipatedDayToDaySpending;

    currentData.dayToDayTransactions = [
      ...pastData.dayToDayTransactions,
      {
        date: endOfMonth,
        transactionType: 'expense',
        amount: anticipatedDayToDaySpending,
        description: 'Anticipated Day-to-Day Spending',
        tagNames: ['Groceries'],
        tag: 'Groceries'
      }
    ];

    // Recalculate totals
    currentData.monthlySpending = Object.values(currentData.monthlyCategories)
      .reduce((acc, { amount }) => acc + amount, 0);
    currentData.surplus = this.#round(
      currentData.income - currentData.monthlySpending - currentData.dayToDaySpending
    );

    return currentData;
  }

  /**
   * Build day-to-day budget with daily balances
   */
  #buildDayToDayBudget(monthList, monthlyBudget, config) {
    const result = {};
    const today = new Date();
    const todayMonth = this.#getCurrentMonth();

    for (const month of monthList) {
      const transactions = monthlyBudget[month].dayToDayTransactions || [];
      const isCurrentMonth = month === todayMonth;

      if (!transactions.length) {
        result[month] = {
          spending: 0,
          budget: config.dayToDay.amount,
          balance: config.dayToDay.amount,
          transactions: [],
          dailyBalances: {}
        };
        continue;
      }

      const spending = this.#round(transactions.reduce((acc, txn) => acc + txn.amount, 0));
      const budget = isCurrentMonth ? config.dayToDay.amount : spending;
      const balance = this.#round(budget - spending);

      const dailyBalances = this.#calculateDailyBalances(month, transactions, budget);

      // Calculate daily metrics
      const daysInMonth = this.#getDaysInMonth(month);
      const lastBalance = Object.values(dailyBalances).pop()?.endingBalance || balance;
      const spent = this.#round(spending - lastBalance);

      const endOfMonth = new Date(`${month}-01`);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);

      const daysRemaining = isCurrentMonth
        ? Math.max(0, Math.ceil((endOfMonth - today) / (1000 * 60 * 60 * 24)))
        : 0;
      const daysCompleted = daysInMonth - daysRemaining;

      const dailySpend = daysCompleted > 0 ? this.#round(spent / daysCompleted) : 0;
      const dailyBudget = daysRemaining > 0 ? this.#round(lastBalance / daysRemaining) : 0;
      const diff = this.#round(dailyBudget - dailySpend);
      const adjustPercentage = dailySpend > 0 ? this.#round((diff / dailySpend) * 100) : 0;

      result[month] = {
        spending,
        budget,
        balance: lastBalance,
        transactions,
        dailyBalances,
        spent,
        daysRemaining,
        dailySpend,
        dailyBudget,
        dailyAdjustment: adjustPercentage,
        adjustPercentage
      };

      // Clean up monthly budget
      delete monthlyBudget[month].dayToDayTransactions;
    }

    return result;
  }

  /**
   * Calculate daily balances for a month
   */
  #calculateDailyBalances(month, transactions, budget) {
    const daysInMonth = this.#getDaysInMonth(month);
    const dailyBalances = {};

    // Start with day 0 (budget start)
    dailyBalances[`${month}-start`] = {
      dayInt: 0,
      startingBalance: budget,
      credits: 0,
      debits: 0,
      endingBalance: budget,
      transactionCount: 0
    };

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${month}-${String(day).padStart(2, '0')}`;
      const prevDayStr = day === 1 ? `${month}-start` : `${month}-${String(day - 1).padStart(2, '0')}`;
      const dayTransactions = transactions.filter(txn => txn.date === dayStr);

      const startingBalance = dailyBalances[prevDayStr]?.endingBalance || budget;
      const credits = this.#round(
        dayTransactions
          .filter(txn => txn.expenseAmount < 0)
          .reduce((sum, txn) => sum + txn.expenseAmount, 0)
      );
      const debits = this.#round(
        dayTransactions
          .filter(txn => txn.expenseAmount > 0)
          .reduce((sum, txn) => sum + txn.expenseAmount, 0)
      );
      const endingBalance = this.#round(startingBalance + credits - debits);

      dailyBalances[dayStr] = {
        dayInt: day,
        startingBalance,
        credits,
        debits,
        endingBalance,
        transactionCount: dayTransactions.length
      };
    }

    return dailyBalances;
  }

  /**
   * Build transfer transaction summary
   */
  #buildTransferSummary(monthList, monthlyBudget) {
    let totalAmount = 0;
    const allTransactions = [];

    for (const month of monthList) {
      const transactions = monthlyBudget[month].transferTransactions || [];
      const amount = transactions.reduce((acc, txn) => acc + txn.amount, 0);
      totalAmount += amount;
      allTransactions.push(...transactions);
      delete monthlyBudget[month].transferTransactions;
    }

    return {
      amount: this.#round(totalAmount),
      transactions: allTransactions
    };
  }

  /**
   * Build short-term buckets from transactions
   */
  #buildShortTermBuckets(monthList, monthlyBudget, config) {
    const buckets = {};

    for (const month of monthList) {
      const { shortTermTransactions } = monthlyBudget[month];
      if (!shortTermTransactions?.length) continue;

      for (const txn of shortTermTransactions) {
        const label = txn.label || 'Unbudgeted';
        if (!buckets[label]) {
          buckets[label] = { spending: 0, transactions: [], debits: 0, credits: 0 };
        }

        const isExpense = txn.expenseAmount > 0;
        buckets[label][isExpense ? 'debits' : 'credits'] += Math.abs(txn.amount);
        buckets[label].transactions.push(txn);
      }

      delete monthlyBudget[month].shortTermTransactions;
    }

    // Initialize all configured labels
    const allLabels = config.shortTerm.map(item => item.label);
    for (const label of allLabels) {
      const existing = buckets[label] || { debits: 0, credits: 0, transactions: [] };
      const configItem = config.shortTerm.find(item => item.label === label);
      const budget = this.#round(configItem?.amount || 0);
      const spending = this.#round((existing.debits || 0) - (existing.credits || 0));
      const balance = this.#round(budget - spending);

      buckets[label] = {
        budget,
        spending,
        flex: configItem?.flex || 0.5,
        debits: this.#round(existing.debits || 0),
        credits: this.#round(existing.credits || 0),
        balance,
        transactions: existing.transactions || []
      };
    }

    return buckets;
  }

  /**
   * Allocate surplus to flex buckets and handle unbudgeted transactions
   */
  #allocateSurplus(monthlyBudget, shortTermBuckets, config) {
    const unBudgetedTransactions = shortTermBuckets['Unbudgeted']?.transactions || [];
    const periodSurplus = Object.values(monthlyBudget).reduce((acc, { surplus }) => acc + surplus, 0);
    const shortTermBudgetPre = Object.values(shortTermBuckets).reduce((acc, { budget }) => acc + (budget || 0), 0);
    const unBudgetedAmount = this.#round(periodSurplus - shortTermBudgetPre);
    const unclassifiedTransactionSum = unBudgetedTransactions.reduce((acc, { amount }) => acc + amount, 0);

    if (unBudgetedTransactions.length) {
      shortTermBuckets['Unbudgeted'] = shortTermBuckets['Unbudgeted'] || {
        budget: 0, spending: 0, balance: 0, debits: 0, credits: 0, transactions: []
      };
      shortTermBuckets['Unbudgeted'].balance = -unclassifiedTransactionSum;
    }

    if (unBudgetedAmount !== 0) {
      let amountToAdjust = Math.abs(unBudgetedAmount);

      if (unBudgetedAmount > 0) {
        // Allocate surplus
        if (unclassifiedTransactionSum && unBudgetedAmount > unclassifiedTransactionSum) {
          shortTermBuckets['Unbudgeted'].budget = unclassifiedTransactionSum;
          shortTermBuckets['Unbudgeted'].balance = 0;
          shortTermBuckets['Unbudgeted'].spending = unclassifiedTransactionSum;
          shortTermBuckets['Unbudgeted'].debits = unclassifiedTransactionSum;
          shortTermBuckets['Unbudgeted'].credits = 0;
          amountToAdjust = unBudgetedAmount - unclassifiedTransactionSum;
        }

        // Distribute to flex buckets
        const flexibleBuckets = config.shortTerm
          .filter(({ flex }) => flex)
          .map(({ label, flex }) => ({ label, flex }));
        const flexWeightSum = flexibleBuckets.reduce((acc, { flex }) => acc + flex, 0);

        for (const { label, flex } of flexibleBuckets) {
          const percentage = flex / flexWeightSum;
          const allocation = this.#round(amountToAdjust * percentage);
          if (!shortTermBuckets[label]) continue;
          shortTermBuckets[label].budget = (shortTermBuckets[label].budget || 0) + allocation;
          shortTermBuckets[label].balance = (shortTermBuckets[label].balance || 0) + allocation;
        }
      } else {
        // Reduce from buckets with positive balance
        for (const label in shortTermBuckets) {
          const bucket = shortTermBuckets[label];
          if (bucket.balance > 0) {
            const reduction = Math.min(bucket.balance, amountToAdjust);
            bucket.budget -= reduction;
            bucket.balance -= reduction;
            amountToAdjust -= reduction;
            if (amountToAdjust <= 0) break;
          }
        }

        // If still need to reduce, use flex buckets
        if (amountToAdjust > 0) {
          const flexibleBuckets = config.shortTerm
            .filter(({ flex }) => flex)
            .map(({ label, flex }) => ({ label, flex }));
          const flexWeightSum = flexibleBuckets.reduce((acc, { flex }) => acc + flex, 0);

          for (const { label, flex } of flexibleBuckets) {
            const percentage = flex / flexWeightSum;
            const reduction = this.#round(amountToAdjust * percentage);
            shortTermBuckets[label].budget -= reduction;
            shortTermBuckets[label].balance -= reduction;
          }
        }
      }
    }

    // Handle buckets with <5% balance remaining
    for (const label in shortTermBuckets) {
      const bucket = shortTermBuckets[label];
      const percentLeft = Math.round(((bucket.balance / (bucket.budget + (bucket.credits || 0))) || 0) * 100);
      bucket.percentLeft = percentLeft;

      if (percentLeft < 5) {
        const amountToMove = Math.min(bucket.budget, bucket.balance);
        bucket.budget -= amountToMove;
        bucket.balance = 0;
        bucket.status = 'spent';

        // Move to bucket with most balance
        const targetBucket = Object.values(shortTermBuckets)
          .reduce((max, b) => (b.balance > max.balance ? b : max), { balance: 0 });
        if (targetBucket !== bucket && targetBucket.balance > 0) {
          targetBucket.budget += amountToMove;
          targetBucket.balance += amountToMove;
        }
      }
    }
  }

  /**
   * Calculate short-term totals
   */
  #calculateShortTermStatus(shortTermBuckets) {
    const budget = Object.values(shortTermBuckets).reduce((acc, { budget }) => acc + budget, 0);
    const spending = Object.values(shortTermBuckets).reduce((acc, { spending }) => acc + spending, 0);
    const debits = Object.values(shortTermBuckets).reduce((acc, { debits }) => acc + (debits || 0), 0);
    const credits = Object.values(shortTermBuckets).reduce((acc, { credits }) => acc + (credits || 0), 0);
    const balance = Object.values(shortTermBuckets).reduce((acc, { balance }) => acc + balance, 0);

    return {
      budget: this.#round(budget),
      spending: this.#round(spending),
      debits: this.#round(debits),
      credits: this.#round(credits),
      balance: this.#round(balance)
    };
  }

  /**
   * Compile mortgage status
   */
  #compileMortgage(config, accountBalances, transactions) {
    if (!config) return null;

    const balance = accountBalances
      .filter(acc => config.accounts?.includes(acc.name))
      .reduce((total, { balance }) => total + balance, 0);

    return this.#mortgageCalculator.calculateMortgageStatus({
      config,
      balance,
      transactions,
      asOfDate: new Date()
    });
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  #loadAllTransactions(budgetStartDates, householdId) {
    const allTransactions = [];
    for (const startDate of budgetStartDates) {
      const transactions = this.#financeStore.getTransactions(startDate, householdId);
      if (transactions) {
        allTransactions.push(...transactions);
      }
    }
    return allTransactions;
  }

  #calculateTotalBudget(monthlyBudget) {
    const keys = ['income', 'nonBonusIncome', 'spending', 'surplus', 'monthlySpending', 'monthlyDebits', 'monthlyCredits', 'dayToDaySpending'];
    return Object.keys(monthlyBudget).reduce((acc, month) => {
      keys.forEach(key => {
        acc[key] = this.#round((acc[key] || 0) + (monthlyBudget[month][key] || 0));
      });
      return acc;
    }, {});
  }

  #calculateMonthlyCategories(monthly, month, cutoff, paycheckCount) {
    const categories = {};

    for (const item of monthly) {
      const label = item.label || 'Shopping';
      const exceptionalItem = item.exceptions?.find(ex => ex[month]);
      const exceptionalAmount = exceptionalItem ? exceptionalItem[month] : null;
      let finalAmount = exceptionalAmount !== null ? exceptionalAmount : item.amount;

      if (item.dates) {
        let validDates = item.dates.filter(d => d.startsWith(month));
        if (cutoff) {
          validDates = validDates.filter(d => d >= cutoff);
        }
        if (validDates.length === 0) {
          finalAmount = 0;
        }
      }

      const multiplier = item.frequency === 'paycheck' ? paycheckCount : 1;
      finalAmount = finalAmount * multiplier;

      if (!finalAmount) continue;

      if (!categories[label]) {
        categories[label] = { amount: 0, debits: 0 };
      }
      categories[label].amount += finalAmount;
      categories[label].debits = categories[label].amount;
    }

    return categories;
  }

  #getExtraIncomeForMonth(extraConfig, month, cutoff) {
    return (extraConfig || []).reduce((acc, { amount, dates, description }) => {
      let datesInMonth = dates?.filter(d => d.startsWith(month)) || [];
      if (cutoff) {
        datesInMonth = datesInMonth.filter(d => d >= cutoff);
      }
      if (datesInMonth.length === 0) return acc;

      const transactions = datesInMonth.map(date => ({ date, amount, description }));
      return [...acc, ...transactions];
    }, []);
  }

  #generatePaycheckDates(firstPaycheckDate, count, frequencyDays) {
    const dates = [];
    const start = new Date(firstPaycheckDate);
    for (let i = 0; i < count; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i * frequencyDays);
      dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
  }

  #generateMonthList(firstMonth, lastMonth) {
    const months = [];
    const [startYear, startMonth] = firstMonth.split('-').map(Number);
    const [endYear, endMonth] = lastMonth.split('-').map(Number);

    let year = startYear;
    let month = startMonth;

    while (year < endYear || (year === endYear && month <= endMonth)) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }

    return months;
  }

  #getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  #getEndOfMonth(month) {
    const [year, mon] = month.split('-').map(Number);
    const date = new Date(year, mon, 0);
    return date.toISOString().slice(0, 10);
  }

  #getDaysInMonth(month) {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon, 0).getDate();
  }

  #toDateString(date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  #round(num) {
    return Math.round(num * 100) / 100;
  }

  #log(level, message, data = {}) {
    if (this.#logger[level]) {
      this.#logger[level](message, data);
    }
  }
}

export default BudgetCompilationService;
