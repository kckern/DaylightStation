
import moment from 'moment';
import { findBucket } from './transactions.mjs';

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

const futureMonthlyBudget = ({month, config}) => {

    const { income: incomeData, monthly, dayToDay } = config;
    const {salary:{amount: salaryAmount, payCheckCount, payFrequencyInDays, firstPaycheckDate, exceptions}, extra} = incomeData;

    // PAYCHECKS
    const paycheckAmount = parseFloat((salaryAmount / payCheckCount).toFixed(2));    
    const paycheckDates = Array.from({length: payCheckCount}, (v, i) => moment(firstPaycheckDate).add(i * payFrequencyInDays, 'days').format('YYYY-MM-DD'));
    //process.exit(console.log({paycheckDates}));
    const paycheckDatesThisMonth = paycheckDates.filter(date => moment(date).format('YYYY-MM') === month);
   // console.log({paycheckDates,paycheckDatesThisMonth,month})
    const paychecks = paycheckDatesThisMonth.filter(date => (moment(date).format('YYYY-MM') === month)).map(date => ({date, amount: paycheckAmount}));
    const payCheckIncomeAmount = paychecks.reduce((acc, paycheck) => acc + paycheck.amount, 0);
    const paycheckCountThisMonth = paycheckDatesThisMonth.length;

    // EXTRA INCOME
    const extraIncomeTransactions = extra.reduce((acc, {amount, dates, description}) => {
        const dateIsInMonth = dates.map(date => moment(date).format('YYYY-MM')).includes(month);
        if(!dateIsInMonth) return acc;
        const date = `${month}-01`;
        return [...acc, {date, amount, description}];
    }, []);
    const extraIncomeAmount = extraIncomeTransactions.reduce((acc, transaction) => acc + transaction.amount, 0);

    // INCOME
    const income = payCheckIncomeAmount + extraIncomeAmount;
    const incomeTransactions = [...paychecks, ...extraIncomeTransactions].sort((a, b) => moment(a.date).diff(moment(b.date)));

    // SPENDING CATEGORIES
    const monthlyCategories = monthly.reduce((acc, {label, amount, frequency, months, exceptions}) => {
        const exceptionalItem = exceptions?.find(exception => (exception[moment(month).format('YYYY-MM')]))
        const exceptionalAmount = exceptionalItem ? exceptionalItem[moment(month).format('YYYY-MM')] : null;
        amount = exceptionalAmount !== null ? exceptionalAmount : amount;
        amount = months ? months?.includes(moment(month).format('YYYY-MM')) ? amount : 0 : amount;
       
        const multiplier = frequency === 'paycheck' ? paycheckCountThisMonth : 1;
        const finalAmount = amount * multiplier;
        if(!finalAmount) return acc;
        acc[label] = {amount: finalAmount};
        return acc;
    }, {});

    const categorySpending = Object.values(monthlyCategories).reduce((acc, {amount}) => acc + amount, 0);
    const dayToDaySpending = dayToDay.amount;
    const monthlySpending  = parseFloat((categorySpending + dayToDaySpending).toFixed(2));
    const surplus = parseFloat( (income - monthlySpending - dayToDaySpending).toFixed(2) );

    return {
        income,
        incomeTransactions,
        monthlyCategories,
        monthlySpending,
        dayToDaySpending,
        surplus
    }

}

const currentMonthlyBudget = ({month, config, transactions}) => {
    const today = moment().format('YYYY-MM-DD');
    return  pastMonthlyBudget({month, config, transactions});

}

const pastMonthlyBudget = ({month, config, transactions}) => {
    
    const incomeTransactions = [];
    const monthlyCategories = {};
    const shortTermTransactions = [];
    const dayToDayTransactions = [];
    const transferTransactions = [];

    for(const txn of transactions){
        const {label,bucket} = findBucket(config, txn);
        if(bucket === 'income') incomeTransactions.push(txn);
        else if(bucket === 'day') dayToDayTransactions.push(txn);
        else if(bucket === 'transfer') transferTransactions.push(txn);
        else if(bucket === 'monthly'){
            if(!monthlyCategories[label]) monthlyCategories[label] = {amount: 0, transactions: []};
            monthlyCategories[label].amount += txn.expenseAmount;
            monthlyCategories[label].transactions.push(txn);
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
    const monthlyCategorySpending = parseFloat(Object.values(monthlyCategories).reduce((acc, {amount}) => acc + amount, 0).toFixed(2));
    const dayToDaySpending = parseFloat(dayToDayTransactions.reduce((acc, txn) => acc + txn.amount, 0).toFixed(2));
    const monthlySpending = parseFloat((monthlyCategorySpending + dayToDaySpending).toFixed(2));
    const spending = parseFloat((dayToDaySpending + monthlySpending).toFixed(2));
    const surplus = parseFloat((income - monthlySpending - dayToDaySpending).toFixed(2));
    return {
        income,
        spending,
        surplus,
        monthlySpending,
        dayToDaySpending,

        incomeTransactions,
        monthlyCategories,
        dayToDayTransactions,
        shortTermTransactions,
        transferTransactions
    }


}


export const dayToDayBudgetReducer = (acc, month, monthlyBudget,config) => {
    const transactions = monthlyBudget[month].dayToDayTransactions || [];
    if(!transactions.length) return {...acc, [month]: {spending: 0, budget: config.dayToDay.amount, balance: config.dayToDay.amount, transactions: [], dailyBalances: {}}};
    acc[month] = {spending: 0, budget: 0, balance:0, transactions};
    acc[month].spending = parseFloat( (transactions.reduce((acc, txn) => acc + txn.amount, 0)).toFixed(2) );
    acc[month].budget = config.dayToDay.amount;
    acc[month].balance = parseFloat((acc[month].budget - acc[month].spending).toFixed(2));
    const daysInMonth = moment(month, 'YYYY-MM').daysInMonth();
    const daysArray = [0,...Array.from({length: daysInMonth}, (v, i) => i + 1)].map(i => `${month}-${i.toString().padStart(2, '0')}`);
    acc[month].dailyBalances = daysArray.reduce((ccc, day) => {
        const dayTransactions = transactions.filter(txn => txn.date === day);
        const dayInt = parseInt(day.slice(-2));
        let yesterDayString = dayInt >= 2 ? `${month}-${(dayInt - 1).toString().padStart(2, '0')}` : null;
        const yesterday = ccc[yesterDayString] || {startingBalance: acc[month].budget};
        const transactionCount = dayTransactions.length;
        const startingBalance = yesterday.endingBalance || acc[month].budget;
        const credits = parseFloat(dayTransactions.filter(txn => txn.expenseAmount < 0).reduce((bcc, txn) => bcc + txn.expenseAmount, 0).toFixed(2));
        const debits = parseFloat(dayTransactions.filter(txn => txn.expenseAmount > 0).reduce((bcc, txn) => bcc + txn.expenseAmount, 0).toFixed(2));
        const endingBalance = parseFloat((startingBalance + credits - debits).toFixed(2));
        ccc[day] = {startingBalance, credits, debits, endingBalance, transactionCount};
        return ccc;
    },{});
    //todo add daily balance
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
export const shortTermBudgetReducer = (acc, month, monthlyBudget,config) => {
    const {shortTermTransactions} = monthlyBudget[month];
    if(!Array.isArray(shortTermTransactions) || !shortTermTransactions.length) return acc;
    for(const txn of shortTermTransactions){
        const {label} = findBucket(config, txn);
        if(!acc[label]) acc[label] = {spending: 0, transactions: []};
        acc[label].spending = parseFloat((acc[label].spending + txn.expenseAmount).toFixed(2));
        acc[label].transactions.push(txn);
    }

    const allLabels = Object.keys(acc);
    for(const label of allLabels){
        const {spending, transactions} = acc[label];
        const budget = config.shortTerm.find(item => item.label === label)?.amount || 0;
        const balance = parseFloat((budget - spending).toFixed(2));
        acc[label] = {budget, spending, balance, transactions};
    }

    delete monthlyBudget[month].shortTermTransactions;
    return acc;
}