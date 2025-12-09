#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from '../backend/lib/budgetlib/build_budget.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const log = (...args) => process.stdout.write(`${args.join(' ')}\n`);
const logError = (...args) => process.stderr.write(`${args.join(' ')}\n`);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load configuration
const isDocker = existsSync('/.dockerenv');
const appConfig = yaml.load(readFileSync(join(__dirname, '../config.app.yml'), 'utf8'));
const secretsConfig = yaml.load(readFileSync(join(__dirname, '../config.secrets.yml'), 'utf8'));
const localConfig = !isDocker ? yaml.load(readFileSync(join(__dirname, '../config.app-local.yml'), 'utf8')) : {};

// Set up process.env
process.env = { ...process.env, isDocker, ...appConfig, ...secretsConfig, ...localConfig };

moment.tz.setDefault('America/Los_Angeles');

// Set up data paths
const dataPath = process.env.path?.data || `${process.cwd()}/data`;

const budgetPath = `${dataPath}/budget/budget.config.yml`;
const transactionPath = `${dataPath}/budget/{{BUDGET_INDEX}}/transactions.yml`;
const mortgageTransactionPath = `${dataPath}/budget/mortgage.transactions.yml`;
const accountBalancePath = `${dataPath}/budget/account.balances.yml`;
const financesPath = `${dataPath}/budget/finances.yml`;
const transactionMemoPath = `${dataPath}/budget/transaction.memos.yml`;

const processMortgagePaymentPlans = (paymentPlans, balance, interestRate, minimumPayment, capital_extracted = 0) => {
  const principal = Math.abs(balance);
  const minPmt = parseFloat(minimumPayment) || 0;
  const startDate = moment().startOf("month");

  return paymentPlans.map((plan) => {
    const rateMap = (plan.rates || []).reduce((acc, { effectiveDate, rate, fee }) => {
      acc[moment(effectiveDate).format("YYYY-MM")] = { rate, fee: fee || 0 };
      return acc;
    }, {});

    let currentBalance = principal;
    let currentRate = interestRate;
    let currentDate = startDate.clone();

    let totalPaid = 0;
    let totalInterest = 0;
    const months = [];

    let i = 0;
    while (currentBalance > 0.01) {
      if (i++ > 1000) break;
      const ym = currentDate.format("YYYY-MM");

      if (rateMap[ym]) {
        currentRate = rateMap[ym].rate;
      }

      const accruedInterest = currentBalance * (currentRate / 12);
      const payments = [minPmt];

      if (rateMap[ym]?.fee) {
        payments.push(rateMap[ym].fee);
      }

      (plan.payments || []).forEach((item) => {
        if (item.regular && item.regular.includes(currentDate.month() + 1)) {
          payments.push(item.amount);
        }
        if (item.fixed && item.fixed.includes(ym)) {
          if (capital_extracted && item.amount > 0) {
            const captial_extracted_this_month = Math.max(minimumPayment, item.amount - capital_extracted);
            item.amount -= captial_extracted_this_month;
            capital_extracted -= captial_extracted_this_month;
          }
          payments.push(item.amount);
        }
      });

      let amountPaid = payments.reduce((a, b) => a + b, 0);

      if (currentBalance + accruedInterest < amountPaid) {
        amountPaid = currentBalance + accruedInterest;
      }

      const newBalance = currentBalance + accruedInterest - amountPaid;
      months.push({
        month: ym,
        startBalance: +currentBalance.toFixed(2),
        interestAccrued: +accruedInterest.toFixed(2),
        amountPaid: +amountPaid.toFixed(2),
        payments: payments.map((p) => +p.toFixed(2)),
        endBalance: newBalance > 0 ? +newBalance.toFixed(2) : 0
      });

      totalPaid += amountPaid;
      totalInterest += accruedInterest;
      currentBalance = newBalance > 0 ? newBalance : 0;
      currentDate.add(1, "month");
    }

    const payoff = months[months.length - 1]?.month || startDate.format("YYYY-MM");
    const totalMonths = months.length || 1;
    const info = {
      title: plan.title || "",
      subtitle: plan.subtitle || "",
      id: plan.id || "",
      totalPaid: +totalPaid.toFixed(2),
      totalInterest: +totalInterest.toFixed(2),
      totalPayments: totalMonths,
      totalYears: (totalMonths / 12).toFixed(2),
      payoffDate: moment(payoff, "YYYY-MM").format("MMMM YYYY"),
      rates: plan.rates || [],
      annualBudget: +(totalPaid / Math.max((totalMonths / 12), 1)).toFixed(2),
      avgMonthlyInterest: +(totalInterest / totalMonths).toFixed(2),
      avgMonthlyEquity: +(principal / totalMonths).toFixed(2)
    };

    return { info, months };
  });
};

const processMortgage = (mortgage, accountBalances, mortgageTransactions) => {
  const { mortgageStartValue, accountId, startDate, interestRate, accounts, paymentPlans, minimumPayment } = mortgage;

  const balance = accountBalances
    .filter((acc) => accounts.includes(acc.name))
    .reduce((total, { balance }) => total + balance, 0);

  const sortedTransactions = [...mortgageTransactions].sort(
    (a, b) => moment(a.date).diff(moment(b.date))
  );

  const sumOfTransactions = sortedTransactions.reduce(
    (total, { amount }) => total + amount,
    0
  );

  const startingBalanceNeg = Math.round((balance - sumOfTransactions) * 100) / 100;
  const startingBalance = Math.abs(startingBalanceNeg);

  let runningTotal = 0;
  const transactions = sortedTransactions.map((txn) => {
    runningTotal += txn.amount;
    return {
      ...txn,
      runningBalance: Math.round((startingBalanceNeg + runningTotal) * 100) / 100,
    };
  });

  const paymentPlansFilled = processMortgagePaymentPlans(paymentPlans || [], balance || 0, interestRate || 0, minimumPayment || 0, 0);

  const totalPaid = transactions.reduce((total, { amount }) => total + (amount || 0), 0);

  const { earliestPayoff, latestPayoff } = paymentPlansFilled.reduce((acc, { info }) => {
    const payoffDate = moment(info.payoffDate, "MMMM YYYY");
    if (!acc.earliestPayoff || payoffDate.isBefore(acc.earliestPayoff)) acc.earliestPayoff = payoffDate;
    if (!acc.latestPayoff || payoffDate.isAfter(acc.latestPayoff)) acc.latestPayoff = payoffDate;
    return acc;
  }, {});

  const monthsSinceStart = moment().diff(moment(startDate), "months");

  const totalInterestPaid = startingBalance - mortgageStartValue;
  const totalPrincipalPaid = totalPaid - totalInterestPaid;
  const percentPaidOff = (startingBalance - balance) / startingBalance;

  const monthlyRent = Math.round((totalInterestPaid / monthsSinceStart) * 100) / 100;
  const monthlyEquity = Math.round((totalPrincipalPaid / monthsSinceStart) * 100) / 100;

  return {
    accountId,
    mortgageStartValue,
    startingBalance,
    totalInterestPaid,
    totalPrincipalPaid,
    monthlyRent,
    monthlyEquity,
    percentPaidOff,
    balance,
    interestRate,
    earliestPayoff: earliestPayoff?.format("YYYY-MM") || "",
    latestPayoff: latestPayoff?.format("YYYY-MM") || "",
    totalPaid,
    transactions,
    paymentPlans: paymentPlansFilled,
  };
};

const compileBudget = async () => {
  log('Starting budget compilation...');
  
  const budgetConfig = yaml.load(readFileSync(budgetPath, 'utf8'));
  const budgetStartDates = budgetConfig.budget.map(b => b.timeframe.start);
  const accountBalances = yaml.load(readFileSync(accountBalancePath, 'utf8')).accountBalances;
  const mortgageTransactions = yaml.load(readFileSync(mortgageTransactionPath, 'utf8')).mortgageTransactions;
  const budgetList = budgetConfig.budget.sort((b, a) => a.timeframe.start - b.timeframe.start);
  const mortgage = processMortgage(budgetConfig.mortgage, accountBalances, mortgageTransactions);
  
  const rawTransactions = budgetStartDates.map(date => {
    const transactionFileName = transactionPath.replace('{{BUDGET_INDEX}}', moment(date).utc().format('YYYY-MM-DD'));
    log(`Reading transactions from ${transactionFileName}`);
    return yaml.load(readFileSync(transactionFileName, 'utf8')).transactions;
  }).flat();
  
  // Apply Memos
  const transactionMemos = yaml.load(readFileSync(transactionMemoPath, 'utf8'));
  for (const txnId of Object.keys(transactionMemos)) {
    const txnIndex = rawTransactions?.findIndex(txn => `${txn.id}` === txnId);
    if (txnIndex !== -1) rawTransactions[txnIndex]['memo'] = transactionMemos[txnId];
  }
  
  const budgets = {};
  for (const budget of budgetList) {
    const budgetStart = moment(budget.timeframe.start).toISOString().slice(0, 10);
    const budgetEnd = moment(budget.timeframe.end).toISOString().slice(0, 10);
    const transactions = rawTransactions.filter(txn => txn.date >= budgetStart && txn.date <= budgetEnd);
    log(`\n\n #### Compiling budget for ${budgetStart} to ${budgetEnd} ####\n\n`);
    budgets[budgetStart] = buildBudget(budget, transactions);
  }
  
  writeFileSync(financesPath, yaml.dump({ budgets, mortgage }));
  log(`Saved finances to ${financesPath}`);
  return { status: 'success' };
};

// Execute the function
compileBudget()
  .then(result => {
    log('Budget compilation completed successfully:', result);
    log(`\nOutput file: ${financesPath}`);
    process.exit(0);
  })
  .catch(error => {
    logError('Error compiling budget:', error);
    process.exit(1);
  });
