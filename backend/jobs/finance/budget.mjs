

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
    const dayToDayCategories = budget.dayToDay.categories;
    const {monthlyBudget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget} = buildMonthlyBudget(budget.monthly,budget.dayToDay, budget.income, budgetStart, budgetEnd);
    const {shortTermBudget, shortTermCategories} = buildshortTermBudget(shortTermBudgetAmount, budget.shortTerm);
    const {dayToDay} = budget;
    return {budgetStart, budgetEnd, accounts, dayToDayBudget, dayToDayCategories, monthlyBudget, monthlyCategories, shortTermBudget, shortTermCategories};
}
function buildshortTermBudget(shortTermBudgetAmount, shortTerm){
    const shortTermBudget = shortTerm.map(({category, amount}) => {return {category, amount}});
    const sumOfAllAmounts = shortTermBudget.map(({amount}) => amount).reduce((acc, val) => acc + parseInt(val, 10), 0);
    const remainingAmount = shortTermBudgetAmount - sumOfAllAmounts;
    if(remainingAmount > 0){ 
        shortTermBudget.push({category: 'Unbudgeted', amount: remainingAmount}); 
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
    const shortTermCategories = Array.from(new Set(shortTerm.flatMap(({category}) => 
        category.split(',').map(cat => cat.trim())
    ))).sort();
    return {shortTermBudget, shortTermCategories};
}

function buildMonthlyBudget(monthlyBudget, dayTodayData, incomeData, budgetStart, budgetEnd){

    const {amount:dayToDayAmount} = dayTodayData;
    monthlyBudget.push({
        category: 'Day-to-Day Spending',
        amount: dayToDayAmount,
    });

    const months = Array.from({ length: moment(budgetEnd).diff(moment(budgetStart), 'months') + 1 }, 
            (_, i) => moment(budgetStart).add(i, 'months').format('YYYY-MM'));
    const [{salary, exceptions: salaryExceptions}, {extra: extraIncome}] = incomeData;
    const budget = {};
    const dayToDayBudget = {};
    let monthlyCategories = [];
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
            const {category, amount, months, exceptions} = item;
            const splitCategories = category.split(',').map(cat => cat.trim());
            monthlyCategories = [...monthlyCategories, ...splitCategories];
            if(months && !months.includes(month)) continue;
            if(exceptions && exceptions[month] === null) continue;
            
            budget[month].categories[category] = budget[month].categories[category] || {amount: 0, remaining: 0, transactions: []};
            const exceptionAmount = exceptions?.[month] === null ? 0 : (exceptions?.[month] || amount);
            budget[month].categories[category].amount += exceptionAmount;
            budget[month].categories[category].remaining += exceptionAmount;  // Initialize remaining with the amount
        }

        // Any remaining income is put into short term savings
        budget[month].expense = Object.values(budget[month].categories)
            .map(catObj => catObj.amount)
            .reduce((acc, val) => acc + parseInt(val, 10), 0);

        budget[month].surplus = budget[month].income - budget[month].expense;
    }

    const shortTermBudgetAmount = months.map(month => budget[month].surplus).reduce((acc, val) => acc + parseInt(val, 10), 0);
    // Deduplicate and sort categories
    monthlyCategories = [...new Set(monthlyCategories)].sort();
    return {monthlyBudget: budget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget};
}


const isOverlap = (arr1, arr2) => {
  const match = arr1.find(tag => arr2.includes(tag));
  return match || false;
};
const fillBudgetWithTransactions = (budget) => {
    const {budgetStart, budgetEnd, accounts,  dayToDayCategories, monthlyCategories, shortTermCategories} = budget;
    const transactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions
        .filter(({date, accountName}) => date >= budgetStart && date <= budgetEnd && accounts.includes(accountName));


    for(let transaction of transactions) {

        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const month = moment(date).format('YYYY-MM');

        const isDayToDay    = isOverlap(tags, [...dayToDayCategories, "[Daily]"]);
        const isMonthly     = isOverlap(tags, [...monthlyCategories, "[Monthly]"]);
        const isShortTerm   = isOverlap(tags, [...shortTermCategories, "[Yearly]"]);


        const bucketKey = isDayToDay ? 'dayToDay' : isMonthly ? 'monthly' : 'shortTerm';


        //console.log( bucketKey, tags, transaction.description );

        const addTransaction = (month, bucket, transaction) => {
            const {tags:category} = transaction || {}; //todo: only 1 tag
            if(bucket === 'dayToDay') budget['dayToDayBudget'][month].transactions.push(transaction);
            if (bucket === 'monthly') {
              if (!budget['monthlyBudget'][month]) {
                budget['monthlyBudget'][month] = { categories: {} };
              }
              if (!budget['monthlyBudget'][month].categories[category]) {
                budget['monthlyBudget'][month].categories[category] = { transactions: [] };
              }
            
              // Now that we've ensured the structure exists, push the transaction
              budget['monthlyBudget'][month].categories[category].transactions.push(transaction);
            }
            if(bucket === 'shortTerm') {
                const hasUnbudgeted = budget['shortTermBudget'].find(({category: cat}) => cat === 'Unbudgeted');
                if(!hasUnbudgeted) budget['shortTermBudget'].push({category: 'Unbudgeted', transactions: []});
                const UnbudgetedKey = budget['shortTermBudget'].findIndex(({category: cat}) => cat === 'Unbudgeted');
                const shortTermIndex = budget['shortTermBudget'].findIndex(({category: cat}) => {
                    return new RegExp(category, 'i').test(cat);
                }) || UnbudgetedKey;
                const shortTermKey = shortTermIndex < 0 ? UnbudgetedKey : shortTermIndex;
                budget['shortTermBudget'][shortTermKey]['transactions'] = budget['shortTermBudget'][shortTermKey]?.['transactions'] || [];
                budget['shortTermBudget'][shortTermKey].transactions.push(transaction);
              }
            }
        addTransaction(month, bucketKey, transaction);
        
    }

    const tallyTransactions = ({amount, transactions}) => {
        transactions = transactions || [];
        const spent = transactions.reduce((acc, {amount}) => acc + amount, 0);
        const roundedSpent = Math.round(spent * 100) / 100; // Round spent to nearest cent
        const remaining = Math.round((amount - roundedSpent) * 100) / 100; // Round remaining to nearest cent
        const over = roundedSpent > amount ? Math.round((roundedSpent - amount) * 100) / 100 : 0; // Round over to nearest cent
        return {amount, spent: roundedSpent, remaining, over, transactions};
    }
    // Tally up Day to Day Spending
    for (const month in budget["dayToDayBudget"]) {
        budget["dayToDayBudget"][month] = tallyTransactions(budget["dayToDayBudget"][month]);
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
    }



    return budget;
};




(async () => {
    const budgetConfig = (yaml.load(readFileSync('data/budget/budget.yml', 'utf8'))).budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const budgets = {};
    for(const budget of budgetConfig){
        const emptyBudget = buildBudget(budget);
        const budgetStart = moment(emptyBudget.budgetStart).format('YYYY-MM-DD');
        const fullBudget = fillBudgetWithTransactions(emptyBudget);
        budgets[budgetStart] = fullBudget;
    }
    writeFileSync('data/budget/finances.yml', yaml.dump(budgets));
})();

