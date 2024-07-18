

import { readFileSync, writeFileSync } from 'fs';
//import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


function buildBudget()
{
    const {budget} = yaml.load(readFileSync('data/budget/budget.yml', 'utf8'));
    budget.timeframe.start = moment.utc(budget.timeframe.start).format('YYYY-MM-DD');
    budget.timeframe.end = moment.utc(budget.timeframe.end).format('YYYY-MM-DD');
    const {start: budgetStart, end: budgetEnd} = budget.timeframe;
    const accounts = budget.accounts;
    const dayToDayCategories = budget.dayToDay.map(({category}) => category);
    const {monthlyBudget, periodicBudgetAmount, monthlyCategories} = buildMonthlyBudget(budget.monthly,budget.dayToDay, budget.income, budgetStart, budgetEnd);
    const {periodicBudget, periodicCategories} = buildPeriodicBudget(periodicBudgetAmount, budget.periodic);
    return {budgetStart, budgetEnd, accounts,dayToDayCategories, monthlyBudget, monthlyCategories, periodicBudget, periodicCategories};
}
function buildPeriodicBudget(periodicBudgetAmount, periodic){
    const periodicBudget = periodic.map(({category, amount}) => {return {category, amount}});
    const sumOfAllAmounts = periodicBudget.map(({amount}) => amount).reduce((acc, val) => acc + parseInt(val, 10), 0);
    const remainingAmount = periodicBudgetAmount - sumOfAllAmounts;
    if(remainingAmount > 0){ 
        periodicBudget.push({category: 'Unbudgeted', amount: remainingAmount}); 
    } else {
        // Subtract from largest categories, cascading down
        let remaining = Math.abs(remainingAmount);
        periodicBudget.sort((a, b) => b.amount - a.amount);
        for(let i = 0; i < periodicBudget.length; i++){
            if(remaining <= 0) break;
            const {amount} = periodicBudget[i];
            const newAmount = amount - remaining;
            if(newAmount >= 0){
                periodicBudget[i].amount = newAmount;
                break;
            } else {
                periodicBudget[i].amount = 0;
                remaining += newAmount;
            }
        }
    }
    const periodicCategories = Array.from(new Set(periodic.flatMap(({category}) => 
        category.split(',').map(cat => cat.trim())
    ))).sort();
    return {periodicBudget, periodicCategories};
}

function buildMonthlyBudget(monthlyBudget, dayTodayData, incomeData, budgetStart, budgetEnd){

    const [{amount:dayToDayAmount}] = dayTodayData;
    monthlyBudget.push({
        category: 'Day-to-Day Spending',
        amount: dayToDayAmount,
    });

    const months = Array.from({ length: moment(budgetEnd).diff(moment(budgetStart), 'months') + 1 }, 
            (_, i) => moment(budgetStart).add(i, 'months').format('YYYY-MM'));
    const [{salary, exceptions: salaryExceptions}, {extra: extraIncome}] = incomeData;
    const budget = {};
    let monthlyCategories = [];
    for(const month of months){
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

    const periodicBudgetAmount = months.map(month => budget[month].surplus).reduce((acc, val) => acc + parseInt(val, 10), 0);
    // Deduplicate and sort categories
    monthlyCategories = [...new Set(monthlyCategories)].sort();

    return {monthlyBudget: budget, periodicBudgetAmount, monthlyCategories};
}


const isOverlap = (arr1, arr2) => arr1.some(tag => arr2.includes(tag));
const fillBudgetWithTransactions = (budget) => {
    const {budgetStart, budgetEnd, accounts, dayToDayCategories, monthlyCategories, periodicCategories} = budget;
    const transactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions
        .filter(({date, accountName}) => date >= budgetStart && date <= budgetEnd && accounts.includes(accountName));

    for(let transaction of transactions) {
        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const month = moment(date).format('YYYY-MM');
        const isDayToDay = isOverlap(tags, dayToDayCategories);
        const isMonthly = isOverlap(tags, monthlyCategories);
        const isPeriodic = isOverlap(tags, periodicCategories);
        const isDailyOverride = isOverlap(tags, `[Daily]`);
        const isMonthlyOverride = isOverlap(tags, `[Monthly]`);
        const isPeriodicOverride = isOverlap(tags, `[Annual]`);

        const addTransaction = (month, category, amount) => {
            if (!budget[month]) {
                budget[month] = {income: 0, expense: 0, surplus: 0, categories: {}};
            }

            if (!budget[month].categories[category]) {
                budget[month].categories[category] = {amount: 0, remaining: 0, transactions: []};
            }

            budget[month].categories[category].amount += amount;
            budget[month].categories[category].remaining -= amount;
            budget[month].categories[category].transactions.push({description, amount, date, accountName});
        };
        
        if (isDayToDay || isDailyOverride) {
            addTransaction(month, 'Day-to-Day Spending', amount);
        } else if (isMonthly || isMonthlyOverride) {
            for (const category of monthlyCategories) {
                if (isOverlap(tags, category)) {
                    addTransaction(month, category, amount);
                }
            }
        } else if (isPeriodic || isPeriodicOverride) {
            for (const category of periodicCategories) {
                if (isOverlap(tags, category)) {
                    addTransaction(month, category, amount);
                }
            }
        } else {
            // Add to unbudgeted periodic
            addTransaction(month, 'Unbudgeted', amount);
        }
    }

    return budget;
};




(async () => {
    const emptyBudget = buildBudget();
   const fullBudget = fillBudgetWithTransactions(emptyBudget);
    writeFileSync('data/budget/finances.yml', yaml.dump({fullBudget}));
})();

