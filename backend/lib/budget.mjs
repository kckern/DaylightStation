import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from './budgetlib/build_budget.mjs';
import { processTransactions, processMortgageTransactions, getAccountBalances } from './buxfer.mjs';
import payrollSync from '../jobs/finance/payroll.mjs';

moment.tz.setDefault('America/Los_Angeles');

const dataPath = `${process.env.path.data}`;

const budgetPath            = `${dataPath}/budget/budget.config.yml`;
const budgetBasePath       = `${dataPath}/budget`;
const transactionPath       = `${dataPath}/budget/{{BUDGET_INDEX}}/transactions.yml`;
const mortgageTransactionPath = `${dataPath}/budget/mortgage.transactions.yml`;
const accountBalancePath = `${dataPath}/budget/account.balances.yml`;
const financesPath          = `${dataPath}/budget/finances.yml`;
const transactionMemoPath   = `${dataPath}/budget/transaction.memos.yml`;

export const payrollSyncJob = async (key,req) => payrollSync(key,req);

export const processMortgagePaymentPlans = (paymentPlans, balance, interestRate, minimumPayment, capital_extracted=0) => {
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
        //prevent running forever
        if(i++ > 1000) break;
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
          
          if(capital_extracted && item.amount > 0){
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

export const processMortgage = (mortgage, accountBalances, mortgageTransactions) => {
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

export const compileBudget = async () => {
    const budgetConfig = yaml.load(readFileSync(budgetPath, 'utf8'));
    const budgetStartDates = budgetConfig.budget.map(b => b.timeframe.start);
    const accountBalances = yaml.load(readFileSync(accountBalancePath, 'utf8')).accountBalances;
    const mortgageTransactions = yaml.load(readFileSync(mortgageTransactionPath, 'utf8')).mortgageTransactions;
    const budgetList = budgetConfig.budget.sort((b, a) => a.timeframe.start - b.timeframe.start);
    const mortgage = processMortgage(budgetConfig.mortgage, accountBalances, mortgageTransactions);
    const rawTransactions = budgetStartDates.map(date => {
      const transactionFileName = transactionPath.replace('{{BUDGET_INDEX}}', moment(date).utc().format('YYYY-MM-DD'));
      console.log(`Reading transactions from ${transactionFileName}`);
      return yaml.load(readFileSync(transactionFileName, 'utf8')).transactions;
    }).flat();
    //Apply Memos
    const transactionMemos = yaml.load(readFileSync(transactionMemoPath, 'utf8'));
   for(const txnId of Object.keys(transactionMemos)){
       
        const txnIndex = rawTransactions?.findIndex(txn => `${txn.id}` === txnId);
        if(txnIndex !== -1) rawTransactions[txnIndex]['memo'] = transactionMemos[txnId]; 
      
    }
    const budgets = {};
    for(const budget of budgetList){
        const budgetStart = moment(budget.timeframe.start).toISOString().slice(0, 10);
        const budgetEnd = moment(budget.timeframe.end).toISOString().slice(0, 10);
        const transactions = rawTransactions.filter(txn => txn.date >= budgetStart && txn.date <= budgetEnd);
        console.log(`\n\n #### Compiling budget for ${budgetStart} to ${budgetEnd} ####\n\n`);
        budgets[budgetStart] = buildBudget(budget, transactions);
    }
    writeFileSync(financesPath, yaml.dump({budgets,mortgage}));
    console.log(`Saved finances to ${financesPath}`);
    return { status: 'success' };
}

export const refreshFinancialData = async (noDL) => {


        const { budget:budgets, mortgage } = yaml.load(readFileSync(budgetPath, 'utf8'));
        const startDates = budgets.map(b => b.timeframe.start);
        console.log({startDates});
        const accounts = [];
        for (const budget of budgets)
        {
          const { timeframe: { start, end }, accounts:b_accounts, closed } = budget;
          if (closed) continue; 
            accounts.push(...b_accounts.filter(account => !accounts.includes(account)));
            const startDate = moment(start).utc().format('YYYY-MM-DD');
            const endDate = moment(end).utc().format('YYYY-MM-DD');
          console.log(`\n\n #### Refreshing financial data for ${startDate} to ${endDate} ####\n\n`);
          const transactions = await processTransactions({ startDate, endDate, accounts });
          const budgetTransactionPath = transactionPath.replace('{{BUDGET_INDEX}}', startDate);
          console.log(`Creating ${budgetBasePath}/${startDate}`);
          mkdirSync(`${budgetBasePath}/${startDate}`, { recursive: true });
          const txnCount = transactions.length;
          console.log(`Writing ${txnCount} transactions to ${budgetTransactionPath}`);
          writeFileSync(budgetTransactionPath, yaml.dump({ transactions }));
  
        }
        console.log("outside loop");
        const accountBalances = await getAccountBalances({ accounts: [...accounts, ...mortgage.accounts] });
        writeFileSync(accountBalancePath, yaml.dump({ accountBalances }));
        const mortgageTransactions = await processMortgageTransactions({ accounts: mortgage.accounts, startDate: mortgage.startDate});
        writeFileSync(mortgageTransactionPath, yaml.dump({ mortgageTransactions }));


    console.log(`Now compiling budget...`);
    await compileBudget();
    return { status: 'success', transactionCount: transactions?.length };
}