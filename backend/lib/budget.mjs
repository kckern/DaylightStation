import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from './budgetlib/build_budget.mjs';
import { processTransactions, processMortgageTransactions, getAccountBalances } from './buxfer.mjs';

moment.tz.setDefault('America/Los_Angeles');

const dataPath = `${process.env.path.data}`;

const budgetPath            = `${dataPath}/budget/budget.config.yml`;
const transactionPath       = `${dataPath}/budget/transactions.yml`;
const mortgageTransactionPath = `${dataPath}/budget/mortgage.transactions.yml`;
const accountBalancePath = `${dataPath}/budget/account.balances.yml`;
const financesPath          = `${dataPath}/budget/finances.yml`;
const transactionMemoPath   = `${dataPath}/budget/transaction.memos.yml`;



export const processMortgagePaymentPlans = (paymentPlans, balance, interestRate, minimumPayment) => {
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

export const processMortgage = (mortgage, accountBalances, mortgageTransactions, ) => {
    const { interestRate, accounts, paymentPlans, minimumPayment } = mortgage;
  
    // Current (final) balance across matching accounts
    const balance = accountBalances
      .filter((acc) => accounts.includes(acc.name))
      .reduce((total, { balance }) => total + balance, 0);
  
    // Sort transactions chronologically
    const sortedTransactions = [...mortgageTransactions].sort(
      (a, b) => moment(a.date).diff(moment(b.date))
    );
  
    // Sum of all transaction amounts
    const sumOfTransactions = sortedTransactions.reduce(
      (total, { amount }) => total + amount,
      0
    );
  
    // Calculate starting balance as finalBalance - sumOfTransactions
    const startingBalance = Math.round((balance - sumOfTransactions) * 100) / 100;
  
    // Build transactions list with runningBalance based on startingBalance
    let runningTotal = 0;
    const transactions = sortedTransactions.map((txn) => {
      runningTotal += txn.amount;
      return {
        ...txn,
        runningBalance: startingBalance + runningTotal,
      };
    }).map((txn) => {
        txn.runningBalance = Math.round(txn.runningBalance * 100) / 100;
        return txn;
        });

        const paymentPlansFilled = processMortgagePaymentPlans(paymentPlans || [], balance || 0, interestRate || 0, minimumPayment || 0);
        const totalPaid = transactions.reduce((total, { amount }) => total + (amount || 0), 0);
        const { earliestPayoff, latestPayoff } = paymentPlansFilled.reduce((acc, { info }) => {
            const payoffDate = moment(info.payoffDate, "MMMM YYYY");
            if (!acc.earliestPayoff || payoffDate.isBefore(acc.earliestPayoff)) acc.earliestPayoff = payoffDate;
            if (!acc.latestPayoff || payoffDate.isAfter(acc.latestPayoff)) acc.latestPayoff = payoffDate;
            return acc;
        }, {});

    return {
      startingBalance,
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
    const accountBalances = yaml.load(readFileSync(accountBalancePath, 'utf8')).accountBalances;
    const mortgageTransactions = yaml.load(readFileSync(mortgageTransactionPath, 'utf8')).mortgageTransactions;
    const budgetList = budgetConfig.budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const mortgage = processMortgage(budgetConfig.mortgage, accountBalances, mortgageTransactions);
    const rawTransactions = yaml.load(readFileSync(transactionPath, 'utf8')).transactions;
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
        budgets[budgetStart] = buildBudget(budget, transactions);
    }
    writeFileSync(financesPath, yaml.dump({budgets,mortgage}));
    console.log(`Saved finances to ${financesPath}`);
    return { status: 'success' };
}

export const refreshFinancialData = async (noDL) => {
    console.log('Refreshing financial data');
    let transactions;
    noDL = false;
    if (noDL) {
        const { budget, mortgage } = yaml.load(readFileSync(budgetPath, 'utf8'));
        const [{ timeframe: { start, end }, accounts }] = budget;

        const accountBalances = await getAccountBalances({ accounts: [...accounts, ...mortgage.accounts] });
        writeFileSync(accountBalancePath, yaml.dump({ accountBalances }));

        const startDate = moment(start).format('YYYY-MM-DD')
        const endDate = moment(end).format('YYYY-MM-DD');
        transactions = await processTransactions({ startDate, endDate, accounts });
        writeFileSync(transactionPath, yaml.dump({ transactions }));

        const mortgageTransactions = await processMortgageTransactions({ accounts: mortgage.accounts, startDate: mortgage.startDate});
        writeFileSync(mortgageTransactionPath, yaml.dump({ mortgageTransactions }));


    } else {
        ({ transactions } = yaml.load(readFileSync(transactionPath, 'utf8')));
    }

    await compileBudget();
    return { status: 'success', transactionCount: transactions?.length };
}