

import { readFileSync, writeFileSync } from 'fs';
//import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


function buildBudget(budget)
{
    budget.timeframe.start = moment.utc(budget.timeframe.start).format('YYYY-MM-DD');
    budget.timeframe.end = moment.utc(budget.timeframe.end).format('YYYY-MM-DD');
    const {start: budgetStart, end: budgetEnd} = budget.timeframe;
    const accounts = budget.accounts;
    const dayToDayCategories = budget.dayToDay.tags;
    const {monthlyBudget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget, monthlyCategoryMap} = buildMonthlyBudget(budget.monthly,budget.dayToDay, budget.income, budgetStart, budgetEnd);
    const {shortTermBudget, shortTermCategories, shortTermCategoryMap} = buildshortTermBudget(shortTermBudgetAmount, budget.shortTerm);
    const {dayToDay} = budget;
    return {budgetStart, budgetEnd, accounts, dayToDayBudget, dayToDayCategories, monthlyBudget, monthlyCategories, shortTermBudget, shortTermCategories, shortTermCategoryMap, monthlyCategoryMap, shortTermBudgetAmount};
}
function buildshortTermBudget(shortTermBudgetAmount, shortTerm){
    const shortTermBudget = shortTerm.map(({tags, label, amount}) => {return {category:label, amount, tags}});
    const sumOfAllAmounts = shortTermBudget.map(({amount}) => amount).reduce((acc, val) => acc + parseInt(val, 10), 0);
    const remainingAmount = shortTermBudgetAmount - sumOfAllAmounts;
    if(remainingAmount > 0){ 
        shortTermBudget.push({category: 'Unbudgeted', amount: remainingAmount, tags: ['Shopping']});
    } else {
        // Subtract from largest categories, cascading down
        let remaining = Math.abs(remainingAmount);
        shortTermBudget.sort((a, b) => b.amount - a.amount);
        for(let i = 0; i < shortTermBudget.length; i++){
            if(remaining <= 0) break;
            const {amount} = shortTermBudget[i];
            const newAmount = amount - remaining;
            if(newAmount >= 0){
                shortTermBudget[i].amount = newAmount;
                break;
            } else {
                shortTermBudget[i].amount = 0;
                remaining += newAmount;
            }
        }
    }
    const shortTermCategoryMap = {};
    shortTermBudget.forEach(({ category, tags }) => {
      tags.forEach(tag =>  shortTermCategoryMap[tag] = category);
      shortTermCategoryMap[category] = category;
    });
    const shortTermCategories = shortTermBudget.map(({category,tags}) => [category,...tags]).flat();
    return {shortTermBudget, shortTermCategories,shortTermCategoryMap};
}


function buildMonthlyBudget(monthlyBudget, dayTodayData, incomeData, budgetStart, budgetEnd){

    const {amount:dayToDayAmount} = dayTodayData;
    monthlyBudget.push({
        label: 'Day-to-Day Spending',
        amount: dayToDayAmount,
        tags: ['[Daily]']
    });

    const months = Array.from({ length: moment(budgetEnd).diff(moment(budgetStart), 'months') + 1 }, 
            (_, i) => moment(budgetStart).add(i, 'months').format('YYYY-MM'));
    const [{salary, exceptions: salaryExceptions}, {extra: extraIncome}] = incomeData;
    const budget = {};
    const dayToDayBudget = {};
    for(const month of months){
        // Handle Day-to-Day Spending
        dayToDayBudget[month] = {amount: dayToDayAmount, transactions: []};
        
        // Load Budget
        budget[month] = budget[month] || {income: 0, expense: 0, surplus: 0, categories: {}};

        // Load Income
        budget[month].income += salaryExceptions?.[month] === null ? 0 : (salaryExceptions?.[month] || salary);
        const extraIncomeThisMonth = extraIncome.filter(({months}) => months.includes(month)).reduce((acc, {amount}) => acc + amount, 0);
        budget[month].income += extraIncomeThisMonth;

        // Load Monthly Expenses
        for(const item of monthlyBudget){
            const {tags, label, amount, months, exceptions} = item;
            if(months && !months.includes(month)) continue;
            if(exceptions && exceptions[month] === null) continue;
            
            budget[month].categories[label] = budget[month].categories[label] || {amount: 0, remaining: 0, transactions: []};
            const exceptionAmount = exceptions?.[month] === null ? 0 : (exceptions?.[month] || amount);
            budget[month].categories[label].amount += exceptionAmount;
            budget[month].categories[label].remaining += exceptionAmount;  // Initialize remaining with the amount
        }

        // Any remaining income is put into short term savings
        budget[month].expense = Object.values(budget[month].categories)
            .map(catObj => catObj.amount)
            .reduce((acc, val) => acc + parseInt(val, 10), 0);

        budget[month].surplus = budget[month].income - budget[month].expense;
    }

    const shortTermBudgetAmount = months.map(month => budget[month].surplus).reduce((acc, val) => acc + parseInt(val, 10), 0);


    const monthlyCategoryMap = {};
    monthlyBudget.forEach(({ label, tags }) => {
      tags.forEach(tag =>  monthlyCategoryMap[tag] = label);
      monthlyCategoryMap[label] = label;
    });
    const monthlyCategories = monthlyBudget.map(({label,tags}) => [label,...tags]).flat().filter((v, i, a) => a.indexOf(v) === i);


    return {monthlyBudget: budget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget, monthlyCategoryMap};
}


const isOverlap = (arr1, arr2) => {
  const match = arr1.find(tag => arr2.includes(tag));
  return match || false;
};

const shouldFilter = (transaction, {accounts, startDate, endDate}) => {
    const isInAccounts  = accounts.includes(transaction.accountName);
    const isAfterStart   = moment(transaction.date).isSameOrAfter(startDate);
    const isBeforeEnd    = moment(transaction.date).isSameOrBefore(endDate);
    const isOK = isInAccounts && isAfterStart && isBeforeEnd;
    if(!isOK) return false;
    return true;
};



const fillBudgetWithTransactions = (budget) => {
    const {budgetStart, budgetEnd, accounts,  dayToDayCategories, monthlyCategories, shortTermCategoryMap, monthlyCategoryMap} = budget;
    const rawTransactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions;
    const transactions =  rawTransactions.filter((transaction)=>shouldFilter(transaction, {accounts, startDate: budgetStart, endDate: budgetEnd}));
    const checkIfTransfer = ({tagNames, type}) => {
        if(/(transfer|investment)/i.test(type)) return true;
        if(isOverlap(tagNames, ['Transfer','Payroll'])) return true;
        return false;
    };


    for(let transaction of transactions) {

        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const month = moment(date).format('YYYY-MM');
        const isDayToDay    = isOverlap(tags, [...dayToDayCategories, "[Daily]"]);
        const isMonthly     = isOverlap(tags, [...monthlyCategories, "[Monthly]"]);
        const isTransfer    = checkIfTransfer(transaction);


        const bucketKey = isTransfer ? "transfer" : isDayToDay ? 'dayToDay' : isMonthly ? 'monthly' : 'shortTerm';


        const addTransaction = (month, bucket, transaction) => {

            const {tags:category} = transaction || {}; //todo: only 1 tag
            if(bucket === 'transfer') {
                budget['transfers'] = budget['transfers'] || {transactions: []};
                budget['transfers'].transactions.push(transaction);
            }
            if(bucket === 'dayToDay') budget['dayToDayBudget'][month].transactions.push(transaction);
            if (bucket === 'monthly') {
               const monthlyLabel = monthlyCategoryMap[category];
               if(!monthlyLabel) {
                bucket = 'shortTerm';
               }
               else{
                budget['monthlyBudget'][month].categories[monthlyLabel] = budget['monthlyBudget'][month].categories[monthlyLabel] 
                    || { transactions: [] , amount: 0, category: monthlyLabel};
                budget['monthlyBudget'][month].categories[monthlyLabel]['transactions'] = 
                    budget['monthlyBudget'][month].categories[monthlyLabel]?.['transactions'] || [];
                budget['monthlyBudget'][month].categories[monthlyLabel].transactions.push(transaction);
               }
            }
            if(bucket === 'shortTerm') {

                const shortTermLabel = shortTermCategoryMap[category] || "Unbudgeted";
                const shortTermKey = Object.keys(budget['shortTermBudget']).find(key => budget['shortTermBudget'][key].category === shortTermLabel);
                budget['shortTermBudget'][shortTermKey] = budget['shortTermBudget'][shortTermKey] || { transactions: [] , amount: 0, category: shortTermLabel};
                budget['shortTermBudget'][shortTermKey]['transactions'] = budget['shortTermBudget'][shortTermKey]?.['transactions'] || [];
                budget['shortTermBudget'][shortTermKey].transactions.push(transaction);
              }
            }
        addTransaction(month, bucketKey, transaction);
        
    }

    const tallyTransactions = ({amount, transactions, category}) => {
        transactions = transactions || [];
        const incomeTypes = ['income', 'investment sale'];
        const spent = transactions.reduce((acc, {transactionType,amount}) => acc + (!incomeTypes.includes(transactionType) ? amount : 0), 0);
        const gained = transactions.reduce((acc, {transactionType,amount}) => acc + (incomeTypes.includes(transactionType) ? amount : 0), 0);
        const roundedSpent = Math.round(spent * 100) / 100; // Round spent to nearest cent
        const remaining = Math.max(0,Math.round((amount - roundedSpent + gained) * 100) / 100); // Round remaining to nearest cent
        const over = Math.max(0, Math.round(((roundedSpent-gained) - amount) * 100) / 100); // Round over to nearest cent
        const planned = 0;
        amount = amount + gained;
        const r= {amount, gained, spent: roundedSpent, remaining, over, transactions, planned, category};
        if(!category) delete r.category;
        return r;
    }
    // Tally up Day to Day Spending
    for (const month in budget["dayToDayBudget"]) {
        budget["dayToDayBudget"][month] = tallyTransactions(budget["dayToDayBudget"][month]);
        budget["dayToDayBudget"][month] = fillDayToDayTransactions(budget["dayToDayBudget"][month], month);
    }
    // Tally up Monthly Expenses
    for (const month in budget["monthlyBudget"]) {
        for (const category in budget["monthlyBudget"][month].categories) {
            budget["monthlyBudget"][month].categories[category] = tallyTransactions(budget["monthlyBudget"][month].categories[category]);
        }
    }




    // Tally up Short Term Expenses
    for (const catKey in budget["shortTermBudget"]) {
        budget["shortTermBudget"][catKey] = tallyTransactions(budget["shortTermBudget"][catKey]);
        //sort by amount alrge to small

    }
    budget["shortTermStatus"] = { amount : budget["shortTermBudgetAmount"], gained:0, spent: 0, remaining: 0, over: 0};
    delete budget["shortTermBudgetAmount"];
    budget["shortTermStatus"]["gained"] = parseFloat(budget["shortTermBudget"].reduce((acc, {gained}) => acc + gained, 0).toFixed(2));
    budget["shortTermStatus"]["spent"] = parseFloat(budget["shortTermBudget"].reduce((acc, {spent}) => acc + spent, 0).toFixed(2));
    budget["shortTermStatus"]["remaining"] = parseFloat((budget["shortTermStatus"]["amount"] - budget["shortTermStatus"]["spent"]).toFixed(2));
    budget["shortTermStatus"]["over"] = parseFloat(Math.max(0, budget["shortTermStatus"]["spent"] - budget["shortTermStatus"]["amount"]).toFixed(2));

    budget["shortTermBudget"] = budget["shortTermBudget"].sort((a, b) => {
        if (a.category === "Unbudgeted") return 1;
        if (b.category === "Unbudgeted") return -1;
        return b.amount - a.amount;
    });
    

    return budget;
};

function fillDayToDayTransactions(monthlyDayToDayBudget, month){
    const {transactions} = monthlyDayToDayBudget;
    const todaysDate = moment().format('YYYY-MM-DD');
    const firstDay = moment(month).format('YYYY-MM-01');
    const lastDay = moment(month).endOf('month').format('YYYY-MM-DD');
    const numDays = moment(lastDay).diff(firstDay, 'days') + 1;
    const dailyBudget = Array.from({ length: numDays }, (_, i) => i +1);
    const dailyBalances = {};
    const averageDailySpend = transactions.filter(({date}) => moment(date).isBefore(todaysDate))
    .reduce((acc, {amount, transactionType}) => acc + (transactionType !== 'income' ? amount : 0), 0) / dailyBudget.length;

    for(const day of dailyBudget){
        const date = `${month}-${day.toString().padStart(2, '0')}`;
        const prevDate = day ===1 ? null : moment(date).subtract(1, 'days').format('YYYY-MM-DD') || null;
        const isFuture = moment(date).isAfter(todaysDate);
        const startingBalance = dailyBalances[prevDate] ? parseFloat(dailyBalances[prevDate].endingBalance.toFixed(2)) : parseFloat(monthlyDayToDayBudget.amount.toFixed(2));
        dailyBalances[date] = {startingBalance, endingBalance: 0, spent: 0, gained: 0};
        if(!isFuture){
            const dailyTransactions = transactions.filter(({date: transactionDate}) => transactionDate === date);
            const dailySpend = dailyTransactions.reduce((acc, {amount, transactionType}) => acc + (transactionType !== 'income' ? amount : 0), 0);
            const dailyGain = dailyTransactions.reduce((acc, {amount, transactionType}) => acc + (transactionType === 'income' ? amount : 0), 0);
            dailyBalances[date].spent = parseFloat(dailySpend.toFixed(2));
            dailyBalances[date].gained = parseFloat(dailyGain.toFixed(2));
            dailyBalances[date].endingBalance = parseFloat((startingBalance + dailyGain - dailySpend).toFixed(2));
        }
        else{
            dailyBalances[date].spent = parseFloat(averageDailySpend.toFixed(2));
            dailyBalances[date].gained = 0;
            dailyBalances[date].endingBalance = parseFloat((startingBalance - averageDailySpend).toFixed(2));
            dailyBalances[date].isFuture = true;
        }
    }


    monthlyDayToDayBudget.dailyBalances = dailyBalances;

    return monthlyDayToDayBudget;
}


(async () => {
    const budgetConfig = (yaml.load(readFileSync('data/budget/budget.yml', 'utf8'))).budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const budgets = {};
    for(const budget of budgetConfig){
        const emptyBudget = buildBudget(budget);
        const budgetStart = moment(emptyBudget.budgetStart).format('YYYY-MM-DD');
        const fullBudget = fillBudgetWithTransactions(emptyBudget);
        delete fullBudget.shortTermCategoryMap;
        budgets[budgetStart] = fullBudget;
    }
    writeFileSync('data/budget/finances.yml', yaml.dump(budgets));
})();

