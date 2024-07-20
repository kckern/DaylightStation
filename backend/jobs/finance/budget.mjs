

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
    console.log(budget.dayToDay);
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


const isOverlap = (arr1, arr2) => arr1.some(tag => arr2.includes(tag));
const fillBudgetWithTransactions = (budget) => {
    const {budgetStart, budgetEnd, accounts,  dayToDayCategories, monthlyCategories, shortTermCategories} = budget;
    const transactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions
        .filter(({date, accountName}) => date >= budgetStart && date <= budgetEnd && accounts.includes(accountName));

    budget['dayToDayBudget'].transactions = [];

    for(let transaction of transactions) {

        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const month = moment(date).format('YYYY-MM');

        const isDayToDayCategory    = isOverlap(tags, dayToDayCategories);
        const isMonthlyCategory     = isOverlap(tags, monthlyCategories);
        const isShortTermCategory   = isOverlap(tags, shortTermCategories);
        const isDailyOverride       = isOverlap(tags, [`[Daily]`]);
        const isMonthlyOverride     = isOverlap(tags, [`[Monthly]`]);
        const isShortTermOverride   = isOverlap(tags, [`[Annual]`]);

        const isDayToDay = isDayToDayCategory || isDailyOverride;
        const isMonthly = isMonthlyCategory || isMonthlyOverride;
        const isShortTerm = isShortTermCategory || isShortTermOverride;

        const bucketKey = isDayToDay ? 'dayToDay' : isMonthly ? 'monthly' : 'shortTerm';

        const addTransaction = (month, bucket, transaction) => {
            const {tags:category} = transaction; //todo: only 1 tag
            if(bucket === 'dayToDay') budget['dayToDayBudget'][month].transactions.push(transaction);
            if(bucket === 'monthly') budget['monthlyBudget'][month].categories[category].transactions.push(transaction);
            if(bucket === 'shortTerm') {
                budget['shortTermBudget'][category] = budget['shortTermBudget'][category] || {amount: 0, transactions: []};
                budget['shortTermBudget'][category].transactions.push(transaction);
              }
            }
        addTransaction(month, bucketKey, transaction);
        
    }

    //calculate spent, remaining, over for month and categories in all the buckets
    const tallyTransactions = ({amount, transactions}) => {
        //return {amount, spent, remaining, over, transactions};
        const spent = transactions.reduce((acc, {amount}) => acc + amount, 0);
        const remaining = amount - spent;
        const over = spent > amount ? spent - amount : 0;
        return {amount, spent, remaining, over, transactions};
    }
    ['dayToDayBudget'].forEach(bucketKey => {
        for(const month in budget[bucketKey]) {
            console.log(budget[bucketKey][month], month);
            budget[bucketKey][month] = tallyTransactions(budget[bucketKey][month]);
        }
    });




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

