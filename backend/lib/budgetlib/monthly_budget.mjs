
import moment from 'moment';
import { findBucket } from './transactions.mjs';
import { loadFile, saveFile } from '../io.mjs';

export const getMonthlyBudget =  (config, transactions) => {

    const { timeframe } = config;
    const startDate = new Date(timeframe.start).toISOString().slice(0, 10);
    const endDate = new Date(timeframe.end).toISOString().slice(0, 10);
    const firstMonth = new Date(startDate).toISOString().slice(0, 7);
    const lastMonth = new Date(endDate).toISOString().slice(0, 7);
    
    const monthlyBudget = {};
    const listOfMonths = Array.from(
      { length: moment.utc(lastMonth, 'YYYY-MM').diff(moment.utc(firstMonth, 'YYYY-MM'), 'months') + 1 },
      (v, i) => moment.utc(firstMonth, 'YYYY-MM').add(i, 'months').format('YYYY-MM')
    );
    const todayMonth = moment().format('YYYY-MM');
    const fns = {
        future: futureMonthlyBudget,
        current: currentMonthlyBudget,
        past: pastMonthlyBudget
    }

    for(const month of listOfMonths){
        const isFuture = moment(month).isAfter(todayMonth);
        const isCurrent = month === todayMonth;
        const monthTransactions = transactions.filter(txn => txn.date.slice(0, 7) === month);
        monthlyBudget[month] = fns[isFuture ? 'future' : isCurrent ? 'current' : 'past']({month, config, transactions:monthTransactions});
    }
    return monthlyBudget;
}

const futureMonthlyBudget = ({ month, config }) => {
    const { income: incomeData, monthly, dayToDay, cutoff } = config;
    const {
      salary: { amount: salaryAmount, payCheckCount, payFrequencyInDays, firstPaycheckDate, exceptions },
      extra,
    } = incomeData;
  
    // 1) PAYCHECKS
    const paycheckAmount = parseFloat((salaryAmount / payCheckCount).toFixed(2));
    // Generate all possible paychecks
    let paycheckDates = Array.from({ length: payCheckCount }, (_, i) =>
      moment(firstPaycheckDate).add(i * payFrequencyInDays, 'days').format('YYYY-MM-DD')
    );
    // Filter to only those in target month
    let paycheckDatesThisMonth = paycheckDates.filter(
      (date) => moment(date).format('YYYY-MM') === month
    );
    // If cutoff is set, ignore any paychecks before that date
    if (cutoff) {
      paycheckDatesThisMonth = paycheckDatesThisMonth.filter((date) =>
        moment(date).isSameOrAfter(moment(cutoff), 'day')
      );
    }
    // Build and sum the paychecks in this month
    const paychecks = paycheckDatesThisMonth.map((date) => ({
      date,
      amount: paycheckAmount,
    }));
    const payCheckIncomeAmount = paychecks.reduce((acc, p) => acc + p.amount, 0);
    const paycheckCountThisMonth = paychecks.length;
  
    // 2) EXTRA INCOME
    const extraIncomeTransactions = extra.reduce((acc, { amount, dates, description }) => {
      // Filter to dates in the target month
      let datesInMonth = dates.filter((d) => d.startsWith(month));
      // If cutoff is set, ignore any dates before cutoff
      if (cutoff) {
        datesInMonth = datesInMonth.filter((d) => moment(d).isSameOrAfter(moment(cutoff), 'day'));
      }
      if (datesInMonth.length === 0) return acc;
  
      const transactions = datesInMonth.map((date) => ({ date, amount, description }));
      return [...acc, ...transactions];
    }, []);
    const extraIncomeAmount = extraIncomeTransactions.reduce((acc, t) => acc + t.amount, 0);
  
    // 3) INCOME (paychecks + extra)
    const income = payCheckIncomeAmount + extraIncomeAmount;
    const incomeTransactions = [...paychecks, ...extraIncomeTransactions].sort((a, b) =>
      moment(a.date).diff(moment(b.date))
    );
  
    // 4) EXPENSES
    const monthlyCategories = monthly.reduce((acc, { label, amount, frequency, dates, exceptions }) => {
      // Check for exceptions for this month
      const exceptionalItem = exceptions?.find((ex) => ex[moment(month).format('YYYY-MM')]);
      const exceptionalAmount = exceptionalItem ? exceptionalItem[moment(month).format('YYYY-MM')] : null;
      let finalAmount = exceptionalAmount !== null ? exceptionalAmount : amount;
  
      // If this category has specific date(s), use them to decide whether to include or skip.
      if (dates) {
        // Filter for dates in month
        let validDatesInMonth = dates.filter((d) => d.startsWith(month));
        // If cutoff is set, ignore dates before cutoff
        if (cutoff) {
          validDatesInMonth = validDatesInMonth.filter((d) =>
            moment(d).isSameOrAfter(moment(cutoff), 'day')
          );
        }
        // If no valid date remains, treat amount as zero for this month
        if (validDatesInMonth.length === 0) {
          finalAmount = 0;
        }
      }
  
      // Multiply by paycheck count if needed
      const multiplier = frequency === 'paycheck' ? paycheckCountThisMonth : 1;
      finalAmount = finalAmount * multiplier;
  
      // Skip if finalAmount is zero
      if (!finalAmount) return acc;
  
      if (!acc[label]) {
        acc[label] = { amount: 0, debits: 0 };
      }
      acc[label].amount += finalAmount;
      acc[label].debits = acc[label].amount;
  
      return acc;
    }, {});
  
    const categorySpending = Object.values(monthlyCategories).reduce((acc, { amount }) => acc + amount, 0);
    const dayToDaySpending = dayToDay.amount;
    const monthlySpending = parseFloat(categorySpending.toFixed(2));
    const surplus = parseFloat((income - monthlySpending - dayToDaySpending).toFixed(2));
  
    return {
      income,
      incomeTransactions,
      monthlyCategories,
      monthlySpending,
      dayToDaySpending,
      surplus,
    };
  };
  export const currentMonthlyBudget = ({ month, config, transactions }) => {
    // 1) Get past actual data and future projections
    const pastData = pastMonthlyBudget({ month, config, transactions });
    const futureData = futureMonthlyBudget({ month, config });

    //write pastData to file for debugging
    saveFile(`${month}-pastData`, pastData);
    saveFile(`${month}-futureData`, futureData);
  
    // 2) Initialize current data from past data
    const currentData = { ...pastData };
    const endOfMonth = moment(month).endOf('month').format('YYYY-MM-DD');
  
    // 3) Calculate and append anticipated income
 
    const anticipatedIncome =  parseFloat(futureData.income) - parseFloat(pastData.nonBonusIncome);
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
        flag: 'Anticipated',
      },
    ];

    const anticipatedTaxRate = process.env.buxfer.taxRate || 0.2;
    //loop through anticipated income transactions and add anticipated tax txn to currentData.monthlyCategories['Taxes']
    currentData.incomeTransactions.forEach(txn => {
      if(txn.flag === 'Anticipated' && txn.transactionType === 'income'){
        const taxAmount = parseFloat((txn.amount * anticipatedTaxRate).toFixed(2));
        if(!currentData.monthlyCategories['Taxes']){
          currentData.monthlyCategories['Taxes'] = {amount: 0, credits: 0, debits: 0, transactions: []};
        }
        currentData.monthlyCategories['Taxes'].amount += taxAmount;
        currentData.monthlyCategories['Taxes'].debits += taxAmount;
        currentData.monthlyCategories['Taxes'].transactions.push({
          date: txn.date,
          transactionType: 'expense',
          amount: taxAmount,
          expenseAmount: taxAmount,
          description: 'Anticipated Withholding',
          tagNames: ['Taxes'],
          tag: 'Taxes',
        });
      }
    });



    // 5) Calculate and append anticipated day-to-day spending
    const anticipatedDayToDaySpending =
      parseFloat(futureData.dayToDaySpending) -
      parseFloat(pastData.dayToDaySpending);
  
    currentData.dayToDaySpending =
      parseFloat(pastData.dayToDaySpending) + anticipatedDayToDaySpending;
  
    currentData.dayToDayTransactions = [
      ...pastData.dayToDayTransactions,
      {
        date: endOfMonth,
        transactionType: 'expense',
        amount: anticipatedDayToDaySpending,
        description: 'Anticipated Day-to-Day Spending',
        tagNames: ['Groceries'],
        tag: 'Groceries',
      },
    ];

    //recalculate surplus
    currentData.surplus = parseFloat((currentData.income - currentData.monthlySpending - currentData.dayToDaySpending).toFixed(2));

  
    return currentData;
  };
  

const pastMonthlyBudget = ({month, config, transactions}) => {
    
    const incomeTransactions = [];
    const monthlyCategories = {};
    const shortTermTransactions = [];
    const dayToDayTransactions = [];
    const transferTransactions = [];

    for(const txn of transactions){
        const {label,bucket} = findBucket(config, txn);
        txn['label'] = label;
        txn['bucket'] = bucket;
        if(bucket === 'income') incomeTransactions.push(txn);
        else if(bucket === 'day') dayToDayTransactions.push(txn);
        else if(bucket === 'transfer') transferTransactions.push(txn);
        else if(bucket === 'monthly'){
            if(!monthlyCategories[label]) monthlyCategories[label] = {amount: 0, credits: 0, debits: 0, transactions: []};
            monthlyCategories[label].amount += txn.expenseAmount;
            monthlyCategories[label].credits += txn.expenseAmount < 0 ? Math.abs(txn.expenseAmount) : 0;
            monthlyCategories[label].debits += txn.expenseAmount > 0 ? txn.expenseAmount : 0;
            monthlyCategories[label].transactions.push(txn);

            monthlyCategories[label].amount = parseFloat(monthlyCategories[label].amount.toFixed(2));
            monthlyCategories[label].credits = parseFloat(monthlyCategories[label].credits.toFixed(2));
            monthlyCategories[label].debits = parseFloat(monthlyCategories[label].debits.toFixed(2));

        }
        else if(bucket === 'shortTerm'){
            shortTermTransactions.push(txn);
        }
        else{
            monthlyCategories['Unbudgeted'] = categories['Unbudgeted'] || {amount: 0, transactions: []};
            monthlyCategories['Unbudgeted'].amount += txn.amount;
            monthlyCategories['Unbudgeted'].transactions.push(txn);
        }
    }
    const income = parseFloat(incomeTransactions.reduce((acc, txn) => acc + txn.amount, 0).toFixed(2));
    const nonBonusIncome = parseFloat(incomeTransactions.filter(txn => txn.tagNames.includes('Income')).reduce((acc, txn) => acc + txn.amount, 0).toFixed(2));
    const monthlyCategorySpending = parseFloat(Object.values(monthlyCategories).reduce((acc, {amount}) => acc + amount, 0).toFixed(2));
    const dayToDaySpending = parseFloat(dayToDayTransactions.reduce((acc, txn) => acc + txn.amount, 0).toFixed(2));
    const monthlySpending = parseFloat((monthlyCategorySpending).toFixed(2));
    const spending = parseFloat((dayToDaySpending + monthlySpending).toFixed(2));
    const surplus = parseFloat((income - monthlySpending - dayToDaySpending).toFixed(2));

    const monthlyDebits = parseFloat(shortTermTransactions.filter(txn => txn.expenseAmount > 0).reduce((acc, txn) => acc + txn.expenseAmount, 0).toFixed(2));
    const monthlyCredits = Math.abs(parseFloat(shortTermTransactions.filter(txn => txn.expenseAmount < 0).reduce((acc, txn) => acc + txn.expenseAmount, 0).toFixed(2)));

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
    }


}


export const dayToDayBudgetReducer = (acc, month, monthlyBudget, config) => {
  const transactions = monthlyBudget[month].dayToDayTransactions || [];
  if (!transactions.length) {
    return {
      ...acc,
      [month]: {
        spending: 0,
        budget: config.dayToDay.amount,
        balance: config.dayToDay.amount,
        transactions: [],
        dailyBalances: {}
      }
    };
  }

  const isCurrentMonth = moment(month).format('YYYY-MM') === moment().format('YYYY-MM');
  acc[month] = { spending: 0, budget: 0, balance: 0, transactions };

  acc[month].spending = parseFloat(
    transactions.reduce((innerAcc, txn) => innerAcc + txn.amount, 0).toFixed(2)
  );

  acc[month].budget = isCurrentMonth ? config.dayToDay.amount : acc[month].spending;
  acc[month].balance = parseFloat((acc[month].budget - acc[month].spending).toFixed(2));


  const daysInMonth = moment(month, 'YYYY-MM').daysInMonth();
  const daysArray = [0, ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
    .map(i => `${month}-${i.toString().padStart(2, '0')}`);
  acc[month].dailyBalances = daysArray.reduce((ccc, day) => {
    const dayTransactions = transactions.filter(txn => txn.date === day);
    const dayInt = parseInt(day.slice(-2));

    // Always reference the previous day if dayInt > 0, otherwise null for day 0
    const yesterDayString =
      dayInt > 0 ? `${month}-${(dayInt - 1).toString().padStart(2, '0')}` : null;

    const yesterday = yesterDayString ? ccc[yesterDayString] : null;
    const transactionCount = dayTransactions.length;

    // If there's no "yesterday" entry and we're not day 0, default to zero instead of budget
    const startingBalance = yesterday
      ? yesterday.endingBalance
      : dayInt === 0
        ? acc[month].budget
        : 0;

    const credits = parseFloat(
      dayTransactions
        .filter(txn => txn.expenseAmount < 0)
        .reduce((sum, txn) => sum + txn.expenseAmount, 0)
        .toFixed(2)
    );

    const debits = parseFloat(
      dayTransactions
        .filter(txn => txn.expenseAmount > 0)
        .reduce((sum, txn) => sum + txn.expenseAmount, 0)
        .toFixed(2)
    );

    const endingBalance = parseFloat(
      (startingBalance + credits - debits).toFixed(2)
    );

    ccc[day] = {
      dayInt,
      startingBalance,
      credits,
      debits,
      endingBalance,
      transactionCount
    };
    return ccc;
  }, {});


  const start = acc[month].spending;
  const balance = Math.round(Object.keys(acc[month].dailyBalances).map(day => acc[month].dailyBalances[day].endingBalance).pop() * 100) / 100;
  const spent = parseFloat((start - balance).toFixed(2));
  //end of month minus tomorrow, in days
 // const tomorrow = moment().add(1, 'days');
  const today = moment().startOf('day');
  const endOfMonth = moment(month, 'YYYY-MM').endOf('month');
  
  const daysRemaining = !isCurrentMonth ? 0 : endOfMonth.diff(today, 'days');
  

  const daysCompleted = daysInMonth - daysRemaining;
  const dailySpend = parseFloat((spent / daysCompleted).toFixed(2));
  const dailyBudget = parseFloat((balance / daysRemaining).toFixed(2));
  const diff = parseFloat((dailyBudget - dailySpend).toFixed(2));
  const adjustPercentage = parseFloat(((diff / dailySpend) * 100).toFixed(2));
  //const expectedBalanceAtEndOfMonth = parseFloat((dailyBudget * daysRemaining).toFixed(2));

  //saveFile(`${month}-dayToDayBudget`, {expectedBalanceAtEndOfMonth,dailyBudget, dailySpend, diff, adjustPercentage, daysRemaining, daysCompleted,tomorrow,endOfMonth});
  

 
  acc[month] = {
    ...acc[month],
    balance,
    spent,
    daysRemaining,
    dailySpend,
    dailyBudget,
    dailyAdjustment: adjustPercentage,
    adjustPercentage
  }

  delete monthlyBudget[month].dayToDayTransactions;
  return acc;
}

export const transferTransactionsReducer = (acc, month, monthlyBudget) => {
    const transactions = monthlyBudget[month].transferTransactions || [];
    const amount = transactions.reduce((bcc, txn) => bcc + txn.amount, 0);
    acc = acc || { amount: 0, transactions: [] };
    acc.amount = parseFloat((acc.amount + amount).toFixed(2));
    acc.transactions = Array.isArray(acc.transactions) ? acc.transactions : [];
    acc.transactions = [...acc.transactions, ...transactions];
    delete monthlyBudget[month].transferTransactions;
    return acc;
}
export const shortTermBudgetReducer = (acc, month, monthlyBudget, config) => {
    const {shortTermTransactions, amount} = monthlyBudget[month];
    if(!amount && !Array.isArray(shortTermTransactions) || !shortTermTransactions.length) return acc;
    for(const txn of shortTermTransactions){
        const {label} = findBucket(config, txn);
        if(!acc[label]) acc[label] = {spending: 0, transactions: []};
        const isExpense = txn.expenseAmount > 0;
        acc[label][isExpense ? 'debits' : 'credits'] = acc[label][isExpense ? 'debits' : 'credits'] || 0;
        acc[label][isExpense ? 'debits' : 'credits'] += Math.abs(txn.amount);
        acc[label].transactions.push(txn);       
    }
    
    const allLabels = config.shortTerm.map(item => item.label);
    for(const label of allLabels){
        const {debits, credits, transactions, flex} = acc[label] || {debits:0, credits:0, transactions: []};

        const budget = parseFloat((config.shortTerm.find(item => item.label === label)?.amount || 0).toFixed(2));
        const spending = parseFloat(((debits||0) - (credits||0) ).toFixed(2));
        const balance = parseFloat((budget - spending).toFixed(2));
        acc[label] = {
          budget: budget || 0,
          spending: spending || 0,
          flex: flex || 0.5, // default flex value
          debits: parseFloat((debits || 0).toFixed(2) || 0),
          credits: parseFloat((credits || 0).toFixed(2)),
          balance: balance || 0,
          transactions: transactions || []
        };

    }
    delete monthlyBudget[month].shortTermTransactions;
    return acc;
}